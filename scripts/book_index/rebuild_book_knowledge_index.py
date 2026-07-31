"""Rebuild the Wine Flavor Chemistry knowledge index from the enhanced scan.

Pipeline:
1. Render every PDF page to a temporary JPEG.
2. Re-OCR every page with RapidOCR and retain line boxes/confidence.
3. Recover chapter/section/paragraph structure.
4. Extract compound entities, aliases, CAS numbers, media and thresholds.
5. Write a browser-ready full-text index plus an entity index and QA report.

The OCR stage is resumable: one JSON file is written per completed page.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from pypdf import PdfReader


BOOK_TITLE = "酒类风味化学"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PDF = PROJECT_ROOT / "data" / "raw" / "books" / "EcodexFlavorThresholdDB(已优化).pdf"
PUBLIC_OUT = PROJECT_ROOT / "frontend" / "public" / "book_flavor_chemistry_index.json"
DIST_OUT = PROJECT_ROOT / "frontend" / "dist" / "book_flavor_chemistry_index.json"
ENTITY_OUT = PROJECT_ROOT / "frontend" / "public" / "book_flavor_chemistry_entities.json"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
QA_OUT = PROCESSED_DIR / "book_index_qa_report.json"
WORK_ROOT = PROJECT_ROOT / "data" / "work" / "book_index_rebuild"
GOLD_STANDARD_PATH = Path(__file__).with_name("book_index_gold_standard.json")
THRESHOLD_GOLD_STANDARD_PATH = Path(__file__).with_name("book_threshold_gold_standard.json")
THRESHOLD_CORRECTIONS_PATH = Path(__file__).with_name("book_threshold_source_corrections.json")
THRESHOLD_MEDIUM_RESOLUTIONS_PATH = Path(__file__).with_name("book_threshold_medium_resolutions.json")
THRESHOLD_SUBJECT_RESOLUTIONS_PATH = Path(__file__).with_name("book_threshold_subject_resolutions.json")
THRESHOLD_SUPPLEMENTS_PATH = Path(__file__).with_name("book_threshold_supplements.json")
IDENTITY_RESOLUTIONS_PATH = Path(__file__).with_name("book_identity_conflict_resolutions.json")
ENTITY_DISPLAY_NAMES_PATH = Path(__file__).with_name("book_entity_display_names.json")
RECORD_IDENTITY_CORRECTIONS_PATH = Path(__file__).with_name("book_record_identity_corrections.json")
STRUCTURED_TABLES_PATH = Path(__file__).with_name("book_table_structured_rows.json")
QUALITY_GATES_PATH = Path(__file__).with_name("book_index_quality_gates.json")

CAS_RE = re.compile(r"(?<!\d)(\d{2,7}-\d{2}-\d)(?!\d)")
CHAPTER_RE = re.compile(r"第\s*([一二三四五六七八九十百0-9_]+)\s*章\s*([^\n]{0,32})")
SECTION_RE = re.compile(r"第\s*([一二三四五六七八九十百0-9_]+)\s*节\s*([^\n]{0,36})")
ENTITY_RE = re.compile(
    r"(?:[（(]?\s*\d{1,3}\s*[）)]\s*)?"
    r"(?P<cn>[0-9\u3400-\u9fff·,，-]{2,32})\s*"
    r"[（(](?P<aliases>[^()（）\n]{2,180}[A-Za-z][^()（）\n]{0,120})[）)]"
    r"[^\n]{0,160}?CAS\s*(?:号|No\.?|number)?\s*[:：]?\s*(?P<cas>\d{2,7}-\d{2}-\d)",
    re.IGNORECASE,
)

MEDIA_PATTERNS = [
    ("模拟葡萄酒", re.compile(r"(?:模拟|模型|重构)[^，。；]{0,24}?葡\s*萄\s*酒(?:（[^）]{0,100}）)?(?:中|溶液)")),
    ("空气", re.compile(r"空\s*气\s*中|气相中")),
    ("乙醇-水", re.compile(r"(?:\d+(?:\.\d+)?\s*%\s*(?:vol|[（(]\s*质量分数\s*[）)])?\s*)?(?:酒精|乙醇)[-－—]?水\s*溶\s*液(?:（[^）]{0,80}）)?\s*中", re.I)),
    ("水", re.compile(r"(?:纯)?水\s*中|水\s*溶\s*液(?:\s*中|(?=\s*(?:苦味|甜味|酸味|鲜味|涩味|厚味|咸味|嗅|味)?阈\s*值))")),
    ("白酒", re.compile(r"白酒中|白酒的")),
    ("啤酒", re.compile(r"啤酒\s*中|啤酒的")),
    ("葡萄酒", re.compile(r"(?:非芳香强化|白|红|除香)?葡\s*萄\s*酒(?:（[^）]{0,100}）)?\s*中|葡萄酒的")),
    ("黄酒", re.compile(r"黄酒中|黄酒的")),
    ("果酒", re.compile(r"果酒中|苹果酒中")),
    ("清酒", re.compile(r"清酒中|清酒的")),
    ("蒸馏酒", re.compile(r"(?:水果或葡萄|水果|葡萄)?蒸馏酒中")),
    ("威士忌", re.compile(r"威士忌中|威士忌的")),
    ("干酪", re.compile(r"干酪中|干酪水溶液")),
    ("乳脂", re.compile(r"乳脂中")),
    ("椰子脂", re.compile(r"椰子脂中")),
    ("乳浊液", re.compile(r"(?:水)?乳浊液(?:中|下)|mg/kg乳浊液")),
    ("牛乳", re.compile(r"牛乳中|UHT牛乳|UTH牛乳")),
    ("糖-酸溶液", re.compile(r"糖[-－—]酸溶液中")),
    ("MSG溶液", re.compile(r"MSG\s*溶液中", re.I)),
    ("IMP溶液", re.compile(r"IMP\s*溶液中", re.I)),
    ("果汁", re.compile(r"(?:无嗅|无噢|无嘎|商业)?(?:苹果|橘子|水果)?\s*汁中")),
    ("椰子粉", re.compile(r"椰子粉中")),
    ("鸡汤", re.compile(r"鸡汤中")),
    ("油相", re.compile(r"(?:植物油|葵花籽油|玉米油|油相|油)中")),
    ("可可粉", re.compile(r"可可粉中")),
    ("面粉", re.compile(r"面粉中")),
    ("淀粉", re.compile(r"淀粉中")),
    ("纤维素", re.compile(r"纤维素中")),
    ("其他", re.compile(r"醋中|果汁中|牛奶中|酒精中")),
]
THRESHOLD_SIGNAL_RE = re.compile(r"嗅阈值|味阈值|觉察\s*阈值|识别\s*(?:气味\s*)?(?:阈\s*)?值|阈\s*值|threshold", re.I)
STAGE_THRESHOLD_SIGNAL_RE = re.compile(
    r"(?:气味|嗅觉)?觉察\s*阈\s*值|(?:气味|嗅觉)?识别\s*(?:气味\s*)?(?:阈\s*)?值|"
    r"(?:前鼻|后鼻)?(?:气味)?嗅\s*阈\s*值|(?<!气)味\s*阈\s*值",
    re.I,
)
VALUE_UNIT_RE = re.compile(
    r"(?P<low>(?:nd|小于|大于|不低于|不高于|<|>|≤|≥)?\s*\d+(?:\.\d+)?)"
    r"(?:\s*[~～-]\s*(?P<high>\d+(?:\.\d+)?))?\s*"
    r"(?P<unit>μg|ug|µg|mg|ng|g|pg|mmol|μmol|umol|nmol|mol)\s*/\s*(?P<denom>m3|m³|L|l|kg)",
    re.I,
)
THRESHOLD_CLAUSE_RE = re.compile(
    r"(?=(?:在)?(?:(?<!\d)\d+(?:\.\d+)?\s*%\s*(?:vol|[（(]\s*质量分数\s*[）)])\s*(?:酒精|乙醇)[-－—]?水\s*溶\s*液\s*中|"
    r"(?:(?<!\d)\d+(?:\.\d+)?\s*%\s*vol\s*)?(?:模拟|模型|重构)(?:的)?葡萄酒(?:（[^）]{0,100}）)?中|"
    r"空\s*气\s*中|气相中|(?:纯)?水\s*中|水\s*溶\s*液\s*中|"
    r"(?<!模拟)(?<!模型)(?<!重构)(?<!红)(?<!白)(?<!除香)(?:非芳香强化|白|红|除香)?葡\s*萄\s*酒(?:（[^）]{0,100}）)?\s*中|啤酒\s*中|黄酒中|白酒中|果酒中|苹果酒中|清酒中|(?:水果或葡萄|水果|葡萄)?蒸馏酒中|"
    r"葵花籽油中|玉米油中|(?:植物)?油中|可可粉中|面粉中|淀粉中|纤维素中|乳脂中|椰子脂中|(?:水)?乳浊液(?:中|下)|牛乳中|"
    r"糖[-－—]酸溶液中|(?:在)?\d+(?:\.\d+)?\s*mmol\s*/\s*L\s*的?\s*(?:MSG|IMP)\s*溶液中|(?:无嗅|无噢|无嘎|商业)?(?:苹果|橘子|水果)?\s*汁中))",
    re.I,
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def normalize_text(text: str) -> str:
    text = (text or "").replace("\u00ad", "")
    text = text.replace("µ", "μ")
    text = re.sub(r"(?<=\d)\s*[pP]\s*[lL]g\s*/", "μg/", text)
    text = re.sub(r"(?<=\d)\s*[uU]\s*g\s*/", "μg/", text)
    text = re.sub(r"(?<=\d)\s*[uU]\s*mol\s*/", "μmol/", text)
    text = re.sub(r"(?<=\d)\s*μ\s*g\s*/", "μg/", text)
    text = re.sub(r"(?i)(?<![A-Za-z])p?u\s*g\s*/", "μg/", text)
    text = re.sub(r"(?i)μ\s*u\s*g\s*/", "μg/", text)
    text = re.sub(r"(?i)(m|n|μ|p|g)g\s*/\s*[lI]\b", lambda m: f"{m.group(1)}g/L", text)
    text = re.sub(r"(?i)(m|n|μ|p|g)g\s*/\s*Lo\b", lambda m: f"{m.group(1)}g/L。", text)
    text = re.sub(r"噢\s*(?=[闯闽阙國国阅阈]值|阈)", "嗅", text)
    text = re.sub(r"嘎(?=阈\s*值)", "嗅", text)
    text = re.sub(r"[闯闽阙國国阅阀]值", "阈值", text)
    text = re.sub(r"识\s+别(?=\s*(?:阈\s*)?值)", "识别", text)
    text = re.sub(r"嗅\s+阈", "嗅阈", text)
    text = re.sub(r"\bCAS\s*号\s*[:：]?\s*([0-9]+)\s*[—–－]\s*([0-9]+)\s*[—–－]\s*([0-9]+)", r"CAS号 \1-\2-\3", text, flags=re.I)
    text = re.sub(r"(?<!\d)(\d{2,7})\s*-\s*(\d{2})\s*-\s*(\d)(?!\d)", r"\1-\2-\3", text)
    text = re.sub(r"(?<!\d)(\d{2,7})-(\d{2})=(\d)(?!\d)", r"\1-\2-\3", text)
    text = re.sub(r"\s*([，。；：！？、])\s*", r"\1", text)
    text = re.sub(r"\s*([~～])\s*", r"\1", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def normalize_alias(alias: str) -> str:
    alias = normalize_text(alias)
    alias = re.sub(r"\b(?:FEMA|CAS|RI).*", "", alias, flags=re.I).strip(" ,，;；")
    return alias


def normalize_numeric_bound(value: str) -> str:
    value = value.replace(" ", "")
    for source, target in (("不低于", "≥"), ("不高于", "≤"), ("大于", ">"), ("小于", "<")):
        if value.startswith(source):
            return f"{target}{value[len(source):]}"
    return value


def split_aliases(raw: str) -> list[str]:
    raw = normalize_alias(raw)
    aliases = []
    for part in re.split(r"[,，;/；]", raw):
        english_parts = re.findall(r"[A-Za-z][A-Za-z0-9' -]{1,60}", part)
        aliases.extend(normalize_text(value).lower().strip(" -") for value in english_parts)
    return list(dict.fromkeys(alias for alias in aliases if len(alias) >= 3 and re.search(r"[a-z]", alias)))


def clean_heading(text: str) -> str:
    text = normalize_text(text.replace("\n", " "))
    chapter_titles = {
        "一": "第一章 绪论", "二": "第二章 醇类化合物风味", "三": "第三章 羰基化合物风味",
        "四": "第四章 有机酸风味", "五": "第五章 酯类风味", "六": "第六章 芳香族化合物风味",
        "七": "第七章 酚类化合物风味", "八": "第八章 多酚及其衍生物风味",
        "九": "第九章 含氧杂环化合物风味", "十": "第十章 含氮杂环化合物风味",
        "十一": "第十一章 氨基酸与多肽风味", "十二": "第十二章 含硫化合物风味",
        "十三": "第十三章 萜烯类化合物风味", "十四": "第十四章 糖与糖醇类化合物风味",
        "十五": "第十五章 卤代化合物与无机离子风味",
    }
    match = re.match(r"^第\s*([一二三四五六七八九十百0-9_]+)\s*章", text)
    if match and match.group(1) in chapter_titles:
        return chapter_titles[match.group(1)]
    text = re.sub(r"\s*\d{3}\s*$", "", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def clean_ocr_chinese_name(value: str) -> str:
    value = normalize_text(value).strip("-—－ 、，。")
    if len(value) % 2 == 0 and value[: len(value) // 2] == value[len(value) // 2 :]:
        value = value[: len(value) // 2]
    return value


def english_name_compatible(canonical: str, aliases: list[str]) -> bool:
    def key(value: str) -> str:
        return re.sub(r"[^a-z0-9]", "", value.lower())

    def fingerprint(value: str) -> str:
        normalized = value.lower()
        normalized = re.sub(r"\b(?:cis|trans|[ezrs])\b", "", normalized)
        normalized = re.sub(r"\d+", "", normalized)
        normalized = re.sub(r"[^a-z]", "", normalized)
        normalized = normalized.replace("sulph", "sulf")
        normalized = normalized.replace("propandiol", "propanediol")
        return normalized

    def token_fingerprint(value: str) -> str:
        normalized = re.sub(r"\b(?:cis|trans|[ezrs])\b|\d+", " ", value.lower())
        tokens = re.findall(
            r"(?:isobutyl|secbutyl|methyl|ethyl|propyl|butyl|methoxy|mercapto|hydroxy|"
            r"furan|thiol|pyrazine|propanol|butanol|octanone)",
            normalized.replace("-", ""),
        )
        return "|".join(sorted(tokens)) if len(tokens) >= 2 else ""

    canonical_keys = [key(value) for value in re.split(r"[(),;/]", canonical) if key(value)]
    alias_keys = {key(alias) for alias in aliases if key(alias)}
    if bool(canonical_keys) and any(value in alias_keys for value in canonical_keys):
        return True
    canonical_parts = [value for value in re.split(r"[(),;/]", canonical) if value.strip()]
    alias_parts = [*aliases, " ".join(aliases)]
    for left in canonical_parts:
        for right in alias_parts:
            left_fingerprint = fingerprint(left)
            right_fingerprint = fingerprint(right)
            if len(left_fingerprint) >= 7 and left_fingerprint == right_fingerprint:
                return True
            left_tokens = token_fingerprint(left)
            right_tokens = token_fingerprint(right)
            if left_tokens and left_tokens == right_tokens:
                return True
    return False


def classify_canonical_conflict(
    book_chinese: str,
    book_english: list[str],
    canonical_chinese: str,
    canonical_english: str,
) -> str:
    def key(value: str) -> str:
        return re.sub(r"[^a-z0-9\u3400-\u9fff]", "", value.lower())

    book_cn = key(book_chinese)
    canonical_cn = key(canonical_chinese)
    if "已" in book_cn and book_cn.replace("已", "己") in canonical_cn:
        return "likely_ocr_error"
    if not book_english or re.search(r"酒类风味化学|水果和饮料酒中|最重要的", book_chinese):
        return "insufficient_extraction"
    canonical_en_keys = [key(value) for value in re.split(r"[(),;/]", canonical_english) if key(value)]
    book_en_keys = [key(value) for value in book_english if key(value) not in {"iupac"}]
    def strip_locant(value: str) -> str:
        return re.sub(r"^(?:(?:cis|trans|[ezrs])|[0-9])+", "", value)

    if any(
        len(strip_locant(left)) >= 6 and strip_locant(left) == strip_locant(right)
        for left in book_en_keys for right in canonical_en_keys
    ):
        return "name_variant"
    reduced_book_cn = re.sub(r"^(?:正|仲|异|邻|间|对|[0-9]+)", "", book_cn)
    reduced_canonical_cn = re.sub(r"^(?:正|仲|异|邻|间|对|[0-9]+)", "", canonical_cn)
    if len(reduced_book_cn) >= 2 and (
        reduced_book_cn in reduced_canonical_cn or reduced_canonical_cn in reduced_book_cn
    ):
        return "name_variant"
    return "identity_conflict"


def load_identity_conflict_resolutions() -> list[dict[str, Any]]:
    if not IDENTITY_RESOLUTIONS_PATH.exists():
        return []
    return json.loads(IDENTITY_RESOLUTIONS_PATH.read_text(encoding="utf-8"))


def load_entity_display_names() -> dict[str, str]:
    if not ENTITY_DISPLAY_NAMES_PATH.exists():
        return {}
    return json.loads(ENTITY_DISPLAY_NAMES_PATH.read_text(encoding="utf-8"))


def load_record_identity_corrections() -> list[dict[str, Any]]:
    if not RECORD_IDENTITY_CORRECTIONS_PATH.exists():
        return []
    return json.loads(RECORD_IDENTITY_CORRECTIONS_PATH.read_text(encoding="utf-8"))


def find_record_identity_correction(
    corrections: list[dict[str, Any]], page: int, block: int
) -> dict[str, Any] | None:
    for correction in corrections:
        if correction.get("page") != page:
            continue
        if correction.get("start_block", block) <= block <= correction.get("end_block", block):
            return correction
    return None


def find_identity_conflict_resolution(
    resolutions: list[dict[str, Any]],
    cas: str,
    page: int,
    source_name: str,
) -> dict[str, Any] | None:
    normalized_source = re.sub(r"\s+", "", source_name)
    for resolution in resolutions:
        if resolution.get("cas") != cas or resolution.get("page") != page:
            continue
        expected_source = re.sub(r"\s+", "", resolution.get("source_name", ""))
        if not expected_source or expected_source not in normalized_source:
            continue
        return dict(resolution)
    return None


def resolved_conflict_type(resolution: dict[str, Any]) -> str:
    if resolution.get("resolution_type") == "source_cas_name_conflict":
        return "source_identity_error"
    return "verified_name_variant"


def is_heading_match(match: re.Match[str] | None, text: str) -> bool:
    """Reject chapter references embedded in prose while keeping running page headings."""
    return bool(match and match.start() <= 3 and len(text.strip()) <= 100)


def is_running_page_header(text: str) -> bool:
    return bool(CHAPTER_RE.search(text) and re.search(r"\d{2,3}\s*$", text.strip()))


def is_topic_heading(text: str) -> bool:
    stripped = text.strip()
    return bool(re.match(r"^[一二三四五六七八九十]+、\s*\S", stripped) and len(stripped) <= 24)


def extract_retention_indices(text: str) -> list[dict[str, Any]]:
    groups = []
    for match in re.finditer(r"\bRI[^0-9]{0,5}((?:\d{3,4}\s*(?:(?:或|、|,|，)\s*)?)+)", text, re.I):
        values = [int(value) for value in re.findall(r"\d{3,4}", match.group(1))]
        if values:
            groups.append(values)
    if len(groups) >= 3:
        labels = ["RI_np", "RI_mp", "RI_p"]
    elif len(groups) == 2:
        labels = ["RI_np", "RI_p"]
    else:
        labels = ["RI_unspecified"]
    return [{"type": labels[min(index, len(labels) - 1)], "values": values} for index, values in enumerate(groups)]


def image_page_number(path: Path) -> int:
    match = re.search(r"-(\d+)\.(?:jpg|jpeg|png)$", path.name, re.I)
    if not match:
        raise ValueError(f"Cannot parse page number from {path.name}")
    return int(match.group(1))


_OCR_ENGINE = None
_OCR_DIR: Path | None = None


def init_ocr_worker(ocr_dir: str) -> None:
    global _OCR_ENGINE, _OCR_DIR
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")
    from rapidocr_onnxruntime import RapidOCR

    _OCR_ENGINE = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)
    _OCR_DIR = Path(ocr_dir)


def ocr_one_page(image_path: str) -> dict[str, Any]:
    assert _OCR_ENGINE is not None and _OCR_DIR is not None
    image = Path(image_path)
    page = image_page_number(image)
    out = _OCR_DIR / f"page-{page:04d}.json"
    if out.exists():
        return {"page": page, "status": "cached"}

    result, elapsed = _OCR_ENGINE(str(image))
    lines = []
    for box, text, confidence in result or []:
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        lines.append(
            {
                "box": [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)],
                "text": normalize_text(text),
                "confidence": round(float(confidence), 4),
            }
        )
    lines.sort(key=lambda item: (item["box"][1], item["box"][0]))
    payload = {"page": page, "lines": lines, "elapsed": elapsed}
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return {"page": page, "status": "done", "lines": len(lines)}


def render_pages(pdf: Path, image_dir: Path, pdftoppm: Path, pages: int, dpi: int) -> list[Path]:
    image_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(image_dir.glob("page-*.jpg"), key=image_page_number)
    if len(existing) == pages:
        return existing

    for old in existing:
        old.unlink()
    prefix = image_dir / "page"
    command = [
        str(pdftoppm), "-jpeg", "-r", str(dpi), "-jpegopt", "quality=92,progressive=y",
        str(pdf), str(prefix),
    ]
    subprocess.run(command, check=True)
    rendered = sorted(image_dir.glob("page-*.jpg"), key=image_page_number)
    if len(rendered) != pages:
        raise RuntimeError(f"Rendered {len(rendered)} pages, expected {pages}")
    return rendered


def run_ocr(images: list[Path], ocr_dir: Path, workers: int) -> None:
    ocr_dir.mkdir(parents=True, exist_ok=True)
    missing = [image for image in images if not (ocr_dir / f"page-{image_page_number(image):04d}.json").exists()]
    if not missing:
        print("OCR cache complete; skipping OCR stage.")
        return

    print(f"OCR pages pending: {len(missing)} / {len(images)}; workers={workers}")
    ctx = mp.get_context("spawn")
    started = time.time()
    with ctx.Pool(workers, initializer=init_ocr_worker, initargs=(str(ocr_dir),)) as pool:
        for completed, result in enumerate(pool.imap_unordered(ocr_one_page, map(str, missing)), start=1):
            if completed == 1 or completed % 10 == 0 or completed == len(missing):
                elapsed = time.time() - started
                rate = completed / max(elapsed, 0.1)
                remaining = (len(missing) - completed) / max(rate, 0.001)
                print(f"OCR {completed}/{len(missing)} page={result['page']} ETA={remaining/60:.1f} min", flush=True)


def load_ocr_pages(ocr_dir: Path, expected_pages: int) -> list[dict[str, Any]]:
    pages = []
    for page in range(1, expected_pages + 1):
        path = ocr_dir / f"page-{page:04d}.json"
        if not path.exists():
            raise FileNotFoundError(f"Missing OCR result: {path}")
        pages.append(json.loads(path.read_text(encoding="utf-8")))
    return pages


def line_height(line: dict[str, Any]) -> float:
    return max(1.0, line["box"][3] - line["box"][1])


def page_to_blocks(page: dict[str, Any]) -> list[dict[str, Any]]:
    lines = [line for line in page["lines"] if line["text"] and line["confidence"] >= 0.45]
    if not lines:
        return []
    median_height = statistics.median(line_height(line) for line in lines)
    blocks: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        text = normalize_text(" ".join(line["text"] for line in current))
        boxes = [line["box"] for line in current]
        blocks.append(
            {
                "text": text,
                "box": [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)],
                "confidence": round(sum(line["confidence"] for line in current) / len(current), 4),
            }
        )
        current = []

    for line in lines:
        if not current:
            current = [line]
            continue
        previous = current[-1]
        vertical_gap = line["box"][1] - previous["box"][3]
        previous_text = previous["text"]
        starts_heading = bool(CHAPTER_RE.search(line["text"]) or SECTION_RE.search(line["text"]))
        new_paragraph = (
            starts_heading
            or vertical_gap > median_height * 1.15
            or (previous_text.endswith(("。", "！", "？", "；")) and line["box"][0] > previous["box"][0] + median_height)
        )
        if new_paragraph:
            flush()
        current.append(line)
    flush()
    return blocks


def block_type(text: str) -> str:
    if CHAPTER_RE.search(text):
        return "chapter_heading"
    if SECTION_RE.search(text):
        return "section_heading"
    if is_topic_heading(text):
        return "section_heading"
    if ENTITY_RE.search(text) or (CAS_RE.search(text) and re.search(r"FEMA|呈|香气", text, re.I)):
        return "compound_profile"
    if THRESHOLD_SIGNAL_RE.search(text):
        return "threshold"
    if re.search(r"参考文献|REFERENCES", text, re.I):
        return "references"
    if len(re.findall(r"\d+(?:\.\d+)?", text)) >= 5 and len(text) < 500:
        return "table_or_data"
    return "paragraph"


def extract_entities_from_text(text: str, page: int, chapter: str, section: str) -> list[dict[str, Any]]:
    entities = []
    matches = list(ENTITY_RE.finditer(text))
    for index, match in enumerate(matches):
        profile_end = matches[index + 1].start() if index + 1 < len(matches) else min(len(text), match.end() + 500)
        profile_text = text[match.start() : profile_end]
        cn = clean_ocr_chinese_name(match.group("cn"))
        cn = re.sub(r"^(?:及|和|或|为|是|中|的)+", "", cn)
        aliases = split_aliases(match.group("aliases"))
        entities.append(
            {
                "cas": match.group("cas"),
                "chinese_name": cn,
                "english_names": aliases,
                "aliases": list(dict.fromkeys([cn, *aliases])),
                "first_page": page,
                "chapter": chapter,
                "section": section,
                "fema_number": (re.search(r"FEMA\s*(?:号|No\.?)?\s*[:：]?\s*(\d{3,5})", profile_text, re.I) or [None, None])[1],
                "retention_indices": extract_retention_indices(profile_text),
            }
        )
    return entities


def recover_canonical_entities_from_cas(
    text: str,
    page: int,
    chapter: str,
    section: str,
    canonical_compounds: dict[str, dict[str, str]],
    already_extracted: set[str],
) -> list[dict[str, Any]]:
    recovered = []
    for cas in dict.fromkeys(CAS_RE.findall(text)):
        if cas in already_extracted or cas not in canonical_compounds:
            continue
        canonical = canonical_compounds[cas]
        chinese_name = canonical.get("chinese_name", "").strip()
        english_name = canonical.get("english_name", "").strip()
        if not chinese_name and not english_name:
            continue
        aliases = [value for value in [chinese_name, english_name] if value]
        recovered.append({
            "cas": cas,
            "chinese_name": chinese_name,
            "english_names": [english_name] if english_name else [],
            "aliases": aliases,
            "first_page": page,
            "chapter": chapter,
            "section": section,
            "fema_number": (re.search(r"FEMA\s*(?:号|No\.?)?\s*[:：]?\s*(\d{3,5})", text, re.I) or [None, None])[1],
            "retention_indices": extract_retention_indices(text),
            "extraction_method": "canonical_cas_fallback",
        })
    return recovered


def extract_casless_profile_subject(text: str) -> str | None:
    if CAS_RE.search(text):
        return None
    match = re.match(
        r"^\s*(?:[（(]?\d{1,3}[）)]\s*)?"
        r"(?P<subject>[0-9\u3400-\u9fff·,，-]{2,32})\s*"
        r"(?:\[[^\]]{1,140}[A-Za-z][^\]]*\]|[（(][^()（）]{1,140}[A-Za-z][^()（）]*[）)])",
        text,
    )
    if not match:
        return None
    subject = clean_ocr_chinese_name(match.group("subject"))
    if re.search(r"(?:葡萄酒|啤酒|白酒|黄酒|果酒|果汁|溶液|乳浊液|油相)$", subject):
        return None
    return subject


def resolve_block_entity(
    text: str,
    known_entity_cas: set[str],
    active_entity: str | None,
) -> tuple[str | None, str, str]:
    exact = [cas for cas in dict.fromkeys(CAS_RE.findall(text)) if cas in known_entity_cas]
    if len(exact) == 1:
        return exact[0], "exact_block_cas", "high"
    if active_entity:
        return active_entity, "inherited_context", "medium"
    return None, "unresolved", "low"


def split_entity_profile_segments(
    text: str, known_entity_cas: set[str]
) -> list[tuple[str, str]]:
    matches = [
        (match.start(), match.group("cas"))
        for match in ENTITY_RE.finditer(text)
        if match.group("cas") in known_entity_cas
    ]
    if len(matches) < 2:
        return []
    return [
        (cas, text[start : matches[index + 1][0] if index + 1 < len(matches) else len(text)].strip())
        for index, (start, cas) in enumerate(matches)
    ]


def split_transitioning_entity_segments(
    text: str, known_entity_cas: set[str], active_entity: str | None
) -> list[tuple[str, str]]:
    if not active_entity:
        return []
    matches = [
        (match.start(), match.group(0))
        for match in CAS_RE.finditer(text)
        if match.group(0) in known_entity_cas and match.group(0) != active_entity
    ]
    if len(matches) != 1:
        return []
    cas_start, new_cas = matches[0]
    threshold_signal = THRESHOLD_SIGNAL_RE.search(text)
    if not threshold_signal or threshold_signal.start() >= cas_start:
        return []
    return [
        (active_entity, text[:cas_start].strip()),
        (new_cas, text[cas_start:].strip()),
    ]


def split_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[。；;！？])", text) if part.strip()]


def split_sensory_stage_clauses(clause: str) -> list[str]:
    matches = list(STAGE_THRESHOLD_SIGNAL_RE.finditer(clause))
    if len(matches) < 2:
        return [clause]
    medium_prefix = clause[:matches[0].start()]
    return [
        f"{medium_prefix}{clause[match.start():matches[index + 1].start() if index + 1 < len(matches) else len(clause)].lstrip(' ，,；;')}"
        for index, match in enumerate(matches)
    ]


def threshold_type(text: str) -> str:
    if re.search(r"觉察\s*阈|检测\s*阈|detection\s+threshold", text, re.I):
        return "detection"
    if re.search(r"识别\s*(?:气味\s*)?(?:阈\s*)?值|recognition", text, re.I):
        return "recognition"
    if re.search(r"嗅觉?\s*阈\s*值|气味\s*阈\s*值|气味闽值|气味阙值", text):
        return "odor"
    if re.search(r"(?<!气)味觉?\s*阈\s*值|口感\s*阈\s*值", text):
        return "taste"
    if re.search(r"消费者(?:可以)?接受(?:的)?\s*阈|拒绝\s*阈", text):
        return "acceptance"
    if re.search(r"感官\s*阈\s*值", text):
        return "sensory"
    if re.search(r"(?:苦|甜|酸|咸|鲜|涩|厚)\s*味", text) and re.search(r"阈\s*值", text):
        return "taste"
    return "unspecified"


def sensory_route(text: str) -> str:
    if re.search(r"后\s*鼻", text):
        return "retronasal"
    if re.search(r"前\s*鼻", text):
        return "orthonasal"
    return "unspecified"


def threshold_review_flags(
    clause: str,
    media: list[str],
    values: list[dict[str, str | None]],
    entity_cas: str | None,
    subject_label: str | None = None,
) -> list[dict[str, str]]:
    flags = []
    if any(value["unit"].lower().startswith("pg/") for value in values):
        flags.append({
            "category": "ambiguous_unit",
            "severity": "high",
            "evidence": "pg may be literal or an OCR substitution for μg",
        })
    if media == ["未明确"]:
        flags.append({
            "category": "unknown_medium",
            "severity": "medium",
            "evidence": clause,
        })
    if not entity_cas and not subject_label:
        flags.append({
            "category": "missing_entity",
            "severity": "high",
            "evidence": clause,
        })
    sensory_type = threshold_type(clause)
    for value in values:
        number = float(value["high"] or re.sub(r"^[<>=≤≥]+", "", value["low"]))
        if sensory_type != "taste" and value["unit"].lower() == "mg/l" and number >= 1000:
            flags.append({
                "category": "suspicious_magnitude",
                "severity": "high",
                "evidence": f"{value['low']}{value['unit']}",
            })
            break
    return flags


MATRIX_COMPONENT_RE = re.compile(r"^(?:的)?(?:甘油|酒石酸|蔗糖|糖|葡萄糖|果糖|酸|乙酸|醋酸|MSG|IMP|K2CO|碳酸钾)", re.I)


def concentration_role(clause: str, match: re.Match[str]) -> str:
    before = clause[max(0, match.start() - 32) : match.start()]
    after = clause[match.end() : match.end() + 20].lstrip(" ）)]，,；;")
    if MATRIX_COMPONENT_RE.search(after):
        return "matrix_component"
    recent_segment = re.split(r"[，,；;。]", before)[-1]
    if re.search(r"(?:含量|浓度|检出量|平均含量)", recent_segment):
        return "sample_concentration"
    return "threshold"


def apply_source_verified_threshold_corrections(
    clause: str,
    page: int,
    entity_cas: str | None,
    record_id: str | None,
) -> tuple[str, list[dict[str, str]]]:
    if not THRESHOLD_CORRECTIONS_PATH.exists():
        return clause, []
    corrections = json.loads(THRESHOLD_CORRECTIONS_PATH.read_text(encoding="utf-8"))
    applied = []
    corrected = clause
    for correction in corrections:
        if correction["page"] != page:
            continue
        if correction.get("entity_cas") != entity_cas:
            continue
        if correction.get("record_id") and correction["record_id"] != record_id:
            continue
        source = correction["source_text"]
        if source not in corrected:
            continue
        corrected = corrected.replace(source, correction["corrected_text"], 1)
        applied.append({
            "source_text": source,
            "corrected_text": correction["corrected_text"],
            "reason": correction.get("reason", "verified_against_source_page"),
        })
    return corrected, applied


def find_source_verified_medium_resolution(
    clause: str,
    page: int,
    entity_cas: str | None,
    record_id: str | None,
    subject_label: str | None,
) -> dict[str, Any] | None:
    """Return only an exact, page-audited medium resolution for this clause."""
    if not THRESHOLD_MEDIUM_RESOLUTIONS_PATH.exists():
        return None
    resolutions = json.loads(THRESHOLD_MEDIUM_RESOLUTIONS_PATH.read_text(encoding="utf-8"))
    for resolution in resolutions:
        if resolution["page"] != page:
            continue
        if resolution.get("entity_cas") is not None and resolution["entity_cas"] != entity_cas:
            continue
        if resolution.get("record_id") and resolution["record_id"] != record_id:
            continue
        if resolution.get("subject_label") and resolution["subject_label"] != subject_label:
            continue
        if resolution["evidence_contains"] not in clause:
            continue
        return dict(resolution)
    return None


def find_source_verified_subject_resolution(
    clause: str,
    page: int,
    entity_cas: str | None,
    record_id: str | None,
) -> dict[str, Any] | None:
    """Return only an exact, page-audited threshold-subject resolution."""
    if not THRESHOLD_SUBJECT_RESOLUTIONS_PATH.exists():
        return None
    resolutions = json.loads(THRESHOLD_SUBJECT_RESOLUTIONS_PATH.read_text(encoding="utf-8"))
    for resolution in resolutions:
        if resolution["page"] != page:
            continue
        if resolution.get("entity_cas") is not None and resolution["entity_cas"] != entity_cas:
            continue
        if resolution.get("record_id") and resolution["record_id"] != record_id:
            continue
        if resolution["evidence_contains"] not in clause:
            continue
        return dict(resolution)
    return None


def load_source_verified_threshold_supplements() -> list[dict[str, Any]]:
    """Load page-audited threshold rows omitted when OCR split a source sentence."""
    if not THRESHOLD_SUPPLEMENTS_PATH.exists():
        return []
    return json.loads(THRESHOLD_SUPPLEMENTS_PATH.read_text(encoding="utf-8"))


def extract_medium_detail(clause: str) -> str | None:
    threshold_signal = THRESHOLD_SIGNAL_RE.search(clause)
    medium_prefix = clause[:threshold_signal.start()] if threshold_signal else clause
    match = re.search(r"(?<!\d)(\d+(?:\.\d+)?)\s*%\s*vol", medium_prefix, re.I)
    if match:
        return f"{match.group(1)}%vol"
    match = re.search(r"(?<!\d)(\d+(?:\.\d+)?)\s*%\s*[（(]\s*质量分数\s*[）)]", medium_prefix)
    return f"{match.group(1)}% w/w" if match else None


def extract_table_metadata(text: str) -> dict[str, Any] | None:
    match = re.match(r"^\s*表\s*(?P<id>\d+\s*[-－—]\s*\d+)\s*(?P<body>.*)$", text)
    if not match:
        return None
    body = match.group("body").strip()
    if re.match(r"^(?:是|见|中|所示|列出|给出)", body):
        return None
    unit_match = re.search(r"单位\s*[:：]\s*(?P<unit>[^\s，,；;]{1,16})", body)
    unit = unit_match.group("unit") if unit_match else None
    if unit_match:
        body = f"{body[:unit_match.start()]} {body[unit_match.end():]}".strip()
    title = re.split(
        r"\s+(?=\d+(?:\.\d+)?\s*%\s*vol|化合物\s+阈值|OT\s*/|序号\s+|编号\s+)",
        body,
        maxsplit=1,
        flags=re.I,
    )[0]
    title = re.sub(r"\s+", " ", title).strip(" ，,；;")[:160]
    return {
        "table_id": re.sub(r"\s+", "", match.group("id")).replace("－", "-").replace("—", "-"),
        "title": title or None,
        "unit": unit,
        "structure_status": "linearized_ocr",
        "needs_review": True,
    }


def load_structured_tables() -> list[dict[str, Any]]:
    if not STRUCTURED_TABLES_PATH.exists():
        return []
    return json.loads(STRUCTURED_TABLES_PATH.read_text(encoding="utf-8"))


def find_structured_table(
    structured_tables: list[dict[str, Any]], table_id: str, page: int
) -> dict[str, Any] | None:
    for table in structured_tables:
        if table.get("table_id") == table_id and table.get("page") == page:
            return dict(table)
    return None


def extract_threshold_subject(sentence: str) -> str | None:
    alias_match = re.search(
        r"即\s*(?P<subject>[^，,\[]+?)\s*(?:\[[^\]]+\])?\s*(?=，|,)",
        sentence,
    )
    if alias_match and re.search(r"[㐀-鿿]", alias_match.group("subject")):
        return alias_match.group("subject").strip()
    latin_match = re.match(
        r"^\s*(?:[（(]?\d+[）)]?\s*)?(?:[一二三四五六七八九十百]+肽\s*)?"
        r"(?P<subject>[A-Za-zΑ-ωα-ω][A-Za-z0-9Α-ωα-ω\-–—]{1,60})"
        r"(?=\s*[，,]?\s*(?:即|呈|或许|[（(]))",
        sentence,
    )
    if latin_match:
        return latin_match.group("subject")
    peptide_match = re.search(
        r"(?:[一二三四五六七八九十百]+肽)?(?P<subject>[A-Z][A-Za-z]*(?:-[A-Za-z]+){1,14})(?=\s*[，,]?\s*(?:即|呈|或许))",
        sentence,
    )
    if peptide_match:
        return peptide_match.group("subject")
    possessive_match = re.match(
        r"^\s*(?:比如[，,])?\s*(?P<subject>[\u3400-\u9fff·](?:\s*[\u3400-\u9fff·]){1,15}?)"
        r"的(?=(?:气味|嗅|味|苦味|甜味|酸味|鲜味|涩味|厚味)?阈\s*值)",
        sentence,
    )
    if possessive_match:
        return re.sub(r"\s+", "", possessive_match.group("subject"))
    medium_match = re.match(
        r"^\s*(?:葡萄酒|啤酒|白酒|黄酒|水)(?:中的|中)"
        r"(?P<subject>[0-9A-Za-z\u3400-\u9fff,，·\-]{2,30})(?=[（(，,])",
        sentence,
    )
    if medium_match:
        return medium_match.group("subject").replace("，", ",")
    chinese_match = re.match(
        r"^\s*(?P<subject>[\u3400-\u9fff·](?:\s*[\u3400-\u9fff·]){1,15}?)(?=呈|水中|空气中|前鼻|后鼻)",
        sentence,
    )
    return re.sub(r"\s+", "", chinese_match.group("subject")) if chinese_match else None


def extract_trailing_subject_fragment(text: str) -> str | None:
    match = re.search(r"(?P<subject>[A-Za-zΑ-ωα-ω]+(?:-[A-Za-zΑ-ωα-ω]+){1,14})\s*$", text)
    return match.group("subject") if match else None


def extract_thresholds(
    text: str,
    page: int,
    entity_cas: str | None,
    record_id: str | None = None,
    association_method: str = "unresolved",
    association_confidence: str = "low",
    fallback_subject: str | None = None,
) -> list[dict[str, Any]]:
    text = normalize_text(text)
    thresholds = []
    active_subject: str | None = fallback_subject
    for sentence in split_sentences(text):
        if not THRESHOLD_SIGNAL_RE.search(sentence):
            continue
        explicit_subject = extract_threshold_subject(sentence)
        if explicit_subject:
            active_subject = explicit_subject
        subject_label = explicit_subject or (active_subject if not entity_cas else None)
        raw_clauses = [
            part.strip(" ，,；;")
            for part in THRESHOLD_CLAUSE_RE.split(sentence)
            if part.strip(" ，,；;")
        ]
        clauses: list[str] = []
        for part in raw_clauses:
            if clauses and clauses[-1].rstrip().endswith(("酒精-", "酒精－", "酒精—", "乙醇-", "乙醇－", "乙醇—")):
                clauses[-1] = f"{clauses[-1]}{part}"
            elif clauses and re.fullmatch(r"\d+(?:\.\d+)?\s*%\s*vol", clauses[-1], re.I):
                clauses[-1] = f"{clauses[-1]}{part}"
            else:
                clauses.append(part)
        clauses = [
            stage_clause
            for clause in clauses
            for stage_clause in split_sensory_stage_clauses(clause)
        ]
        for clause in clauses:
            if not THRESHOLD_SIGNAL_RE.search(clause):
                continue
            raw_ocr_text = clause
            clause, source_corrections = apply_source_verified_threshold_corrections(
                clause, page, entity_cas, record_id
            )
            subject_resolution = find_source_verified_subject_resolution(
                clause, page, entity_cas, record_id
            )
            resolved_subject_label = (
                subject_resolution["subject_label"] if subject_resolution else subject_label
            )
            media = next(([name] for name, pattern in MEDIA_PATTERNS if pattern.search(clause)), ["未明确"])
            medium_resolution = None
            if media == ["未明确"]:
                medium_resolution = find_source_verified_medium_resolution(
                    clause, page, entity_cas, record_id, resolved_subject_label
                )
                if medium_resolution:
                    media = [medium_resolution["medium"]]
            values = []
            context_values = []
            for match in VALUE_UNIT_RE.finditer(clause):
                normalized_unit = (
                    match.group("unit")
                    .replace("ug", "μg")
                    .replace("µg", "μg")
                    .replace("umol", "μmol")
                )
                unit = f"{normalized_unit}/{match.group('denom').replace('l', 'L')}"
                value = {
                    "low": normalize_numeric_bound(match.group("low")),
                    "high": match.group("high"),
                    "unit": unit,
                    "role": concentration_role(clause, match),
                }
                if value["role"] == "threshold":
                    values.append(value)
                else:
                    context_values.append(value)
            if not values:
                continue
            review_flags = threshold_review_flags(clause, media, values, entity_cas, resolved_subject_label)
            if any(
                correction.get("reason") == "source_verified_literal_unit"
                for correction in source_corrections
            ):
                review_flags = [
                    flag for flag in review_flags if flag.get("category") != "ambiguous_unit"
                ]
            if any(
                correction.get("reason") == "source_verified_literal_magnitude"
                for correction in source_corrections
            ):
                review_flags = [
                    flag for flag in review_flags if flag.get("category") != "suspicious_magnitude"
                ]
            resolved_method = association_method
            resolved_confidence = association_confidence
            if not entity_cas and resolved_subject_label:
                resolved_method = "clause_subject"
                resolved_confidence = "medium"
            thresholds.append(
                {
                    "entity_cas": entity_cas,
                    "subject_label": resolved_subject_label,
                    "subject_resolution": subject_resolution,
                    "subject_identity_type": "cas" if entity_cas else ("name_only" if resolved_subject_label else "unresolved"),
                    "page": page,
                    "record_id": record_id,
                    "association_method": resolved_method,
                    "association_confidence": resolved_confidence,
                    "media": media,
                    "medium_detail": (
                        medium_resolution.get("medium_detail")
                        if medium_resolution and "medium_detail" in medium_resolution
                        else extract_medium_detail(clause)
                    ),
                    "medium_resolution": medium_resolution,
                    "threshold_type": threshold_type(clause),
                    "sensory_route": sensory_route(clause),
                    "values": values,
                    "context_values": context_values,
                    "raw_text": clause,
                    "raw_ocr_text": raw_ocr_text if source_corrections else None,
                    "source_corrections": source_corrections,
                    "review_flags": review_flags,
                    "review_status": "needs_review" if review_flags else "clean",
                }
            )
    unique_thresholds = []
    seen_thresholds = set()
    for threshold in thresholds:
        marker = json.dumps(threshold, ensure_ascii=False, sort_keys=True)
        if marker in seen_thresholds:
            continue
        seen_thresholds.add(marker)
        unique_thresholds.append(threshold)
    return unique_thresholds


def load_canonical_compounds() -> dict[str, dict[str, str]]:
    path = PROJECT_ROOT / "frontend" / "public" / "aroma_data_merged.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    canonical: dict[str, dict[str, str]] = {}
    for item in data:
        cas = item.get("cas")
        if not cas:
            continue
        entry = canonical.setdefault(cas, {"chinese_name": "", "english_name": ""})
        if item.get("chinese_name"):
            entry["chinese_name"] = item["chinese_name"].strip()
        if item.get("english_name"):
            entry["english_name"] = item["english_name"].strip().lower()
    return canonical


def build_indexes(pages: list[dict[str, Any]], source_pdf: Path, source_sha256: str) -> dict[str, Any]:
    records = []
    tables = []
    entities: dict[str, dict[str, Any]] = {}
    thresholds: list[dict[str, Any]] = []
    chapter = ""
    section = ""
    active_entity: str | None = None
    active_name_subject: str | None = None
    canonical_compounds = load_canonical_compounds()
    identity_resolutions = load_identity_conflict_resolutions()
    entity_display_names = load_entity_display_names()
    record_identity_corrections = load_record_identity_corrections()
    structured_tables = load_structured_tables()

    for page in pages:
        page_no = page["page"]
        blocks = page_to_blocks(page)
        page_text = "\n".join(block["text"] for block in blocks)

        chapter_matches = [
            match for block in blocks[:4]
            if (match := CHAPTER_RE.search(block["text"])) and is_heading_match(match, block["text"])
        ] if page_no >= 12 else []
        if chapter_matches:
            match = chapter_matches[0]
            chapter = clean_heading(match.group(0))
            section = ""
        section_matches = [
            match for block in blocks[:5]
            if (match := SECTION_RE.search(block["text"])) and is_heading_match(match, block["text"])
        ] if page_no >= 12 else []
        if section_matches:
            section = clean_heading(section_matches[0].group(0))

        found_entities = extract_entities_from_text(page_text, page_no, chapter, section)
        found_entities.extend(recover_canonical_entities_from_cas(
            page_text,
            page_no,
            chapter,
            section,
            canonical_compounds,
            {entity["cas"] for entity in found_entities},
        ))
        entity_positions = []
        for entity in found_entities:
            cas = entity["cas"]
            canonical = canonical_compounds.get(cas, {})
            compatible = english_name_compatible(canonical.get("english_name", ""), entity["english_names"])
            same_chinese = bool(
                canonical.get("chinese_name")
                and canonical["chinese_name"].replace(" ", "") in entity["chinese_name"].replace(" ", "")
            )
            compatible = compatible or same_chinese
            if canonical.get("chinese_name") and compatible:
                entity["ocr_chinese_name"] = entity["chinese_name"]
                entity["chinese_name"] = canonical["chinese_name"]
            elif canonical.get("english_name") and not compatible:
                conflict = {
                    "chinese_name": canonical.get("chinese_name", ""),
                    "english_name": canonical["english_name"],
                    "type": classify_canonical_conflict(
                        entity["chinese_name"],
                        entity["english_names"],
                        canonical.get("chinese_name", ""),
                        canonical["english_name"],
                    ),
                    "reason": "CAS resolves to a different compound name in the threshold master database",
                }
                resolution = find_identity_conflict_resolution(
                    identity_resolutions, cas, page_no, entity["chinese_name"]
                )
                if resolution:
                    conflict["type"] = resolved_conflict_type(resolution)
                    conflict["resolution"] = resolution
                    if conflict["type"] == "source_identity_error":
                        conflict["reason"] = "Source page has a verified CAS/name mismatch"
                    else:
                        conflict["reason"] = "Source alias was verified against the page and canonical CAS identity"
                        entity["ocr_chinese_name"] = entity["chinese_name"]
                        entity["chinese_name"] = resolution.get(
                            "authoritative_chinese_name",
                            entity_display_names.get(cas, entity["chinese_name"]),
                        )
                        if canonical["english_name"] not in entity["english_names"]:
                            entity["english_names"].append(canonical["english_name"])
                            entity["aliases"].append(canonical["english_name"])
                entity["canonical_conflict"] = conflict
            if canonical.get("english_name") and compatible and canonical["english_name"] not in entity["english_names"]:
                entity["english_names"].append(canonical["english_name"])
                entity["aliases"].append(canonical["english_name"])
            entity["aliases"] = list(dict.fromkeys([entity["chinese_name"], *entity["aliases"]]))
            entity_positions.append((page_text.find(cas), cas))
            if cas not in entities:
                entities[cas] = {**entity, "pages": [], "record_ids": [], "thresholds": []}
            else:
                existing = entities[cas]
                existing["aliases"] = list(dict.fromkeys([*existing["aliases"], *entity["aliases"]]))
                existing["english_names"] = list(dict.fromkeys([*existing["english_names"], *entity["english_names"]]))
        entity_positions.sort()

        for block_index, block in enumerate(blocks, start=1):
            text = block["text"]
            chapter_match = CHAPTER_RE.search(text)
            section_match = SECTION_RE.search(text)
            if page_no >= 12 and is_heading_match(chapter_match, text):
                chapter = clean_heading(chapter_match.group(0))
                section = ""
                if not is_running_page_header(text):
                    active_entity = None
                    active_name_subject = None
            if page_no >= 12 and is_heading_match(section_match, text):
                section = clean_heading(section_match.group(0))
                active_entity = None
                active_name_subject = None
            if is_topic_heading(text):
                section = text.strip()
                active_entity = None
                active_name_subject = None

            previous_active_entity = active_entity
            block_entities = extract_entities_from_text(text, page_no, chapter, section)
            casless_profile_subject = extract_casless_profile_subject(text)
            if casless_profile_subject:
                active_entity = None
                active_name_subject = casless_profile_subject
            if not active_entity and len(entity_positions) == 1 and not casless_profile_subject:
                active_entity = entity_positions[0][1]
            resolved_entity, association_method, association_confidence = resolve_block_entity(
                text,
                set(entities),
                active_entity,
            )
            profile_segments = split_entity_profile_segments(text, set(entities))
            if not profile_segments:
                profile_segments = split_transitioning_entity_segments(
                    text, set(entities), previous_active_entity
                )
            record_entity = resolved_entity
            if profile_segments:
                record_entity = None
                active_entity = profile_segments[-1][0]
                association_method = "multiple_exact_block_cas"
                association_confidence = "high"
            else:
                active_entity = resolved_entity
            if association_method in {"exact_block_cas", "multiple_exact_block_cas"}:
                active_name_subject = None

            kind = block_type(text)
            record_id = f"book-flavor-chemistry-p{page_no:04d}-b{block_index:02d}"
            identity_correction = find_record_identity_correction(
                record_identity_corrections, page_no, block_index
            )
            if identity_correction:
                corrected_cas = identity_correction["corrected_cas"]
                record_entity = corrected_cas
                active_entity = corrected_cas
                profile_segments = []
                association_method = "source_verified_page_identity"
                association_confidence = "high"
                active_name_subject = None
                if corrected_cas not in entities:
                    source_name = identity_correction["source_name"]
                    source_english_name = identity_correction.get("source_english_name", "")
                    aliases = [source_name]
                    english_names = []
                    if source_english_name:
                        aliases.append(source_english_name)
                        english_names.append(source_english_name)
                    entities[corrected_cas] = {
                        "cas": corrected_cas,
                        "chinese_name": source_name,
                        "english_names": english_names,
                        "aliases": aliases,
                        "first_page": page_no,
                        "chapter": chapter,
                        "section": section,
                        "fema_number": identity_correction.get("fema_number"),
                        "retention_indices": [],
                        "extraction_method": "source_verified_page_identity",
                        "source_page_evidence": identity_correction["source_page_evidence"],
                        "pages": [],
                        "record_ids": [],
                        "thresholds": [],
                    }
            record = {
                "id": record_id,
                "book_title": BOOK_TITLE,
                "page": page_no,
                "block": block_index,
                "chunk": block_index,
                "chapter": chapter,
                "section": section,
                "block_type": kind,
                "entity_cas": record_entity,
                "entity_cas_list": [cas for cas, _ in profile_segments] if profile_segments else None,
                "subject_label": active_name_subject if not record_entity else None,
                "association_method": association_method,
                "association_confidence": association_confidence,
                "text": text,
                "confidence": block["confidence"],
                "box": block["box"],
            }
            if identity_correction:
                record["identity_correction"] = {
                    "corrected_cas": identity_correction["corrected_cas"],
                    "source_name": identity_correction["source_name"],
                    "source_page_evidence": identity_correction["source_page_evidence"],
                    "reason": identity_correction["reason"],
                }
            if table_metadata := extract_table_metadata(text):
                if structured := find_structured_table(
                    structured_tables, table_metadata["table_id"], page_no
                ):
                    table_metadata.update({
                        "title": structured.get("title") or table_metadata.get("title"),
                        "columns": structured["columns"],
                        "rows": structured["rows"],
                        "source_page_evidence": structured["source_page_evidence"],
                        "verification": structured["verification"],
                        "structure_status": "source_verified_rows",
                        "needs_review": False,
                    })
                    record["structured_search_text"] = " ".join(
                        str(value)
                        for row in structured["rows"]
                        for value in row.values()
                        if value is not None
                    )
                record["table_metadata"] = table_metadata
                tables.append({
                    "record_id": record_id,
                    "page": page_no,
                    **table_metadata,
                    "raw_text": text,
                })
            records.append(record)
            linked_entities = [cas for cas, _ in profile_segments] if profile_segments else [active_entity]
            for linked_cas in dict.fromkeys(cas for cas in linked_entities if cas):
                if linked_cas not in entities:
                    continue
                entity = entities[linked_cas]
                if page_no not in entity["pages"]:
                    entity["pages"].append(page_no)
                entity["record_ids"].append(record_id)

            if profile_segments:
                extracted = []
                for segment_cas, segment_text in profile_segments:
                    segment_thresholds = extract_thresholds(
                        segment_text,
                        page_no,
                        segment_cas,
                        record_id,
                        "exact_profile_segment",
                        "high",
                    )
                    extracted.extend(segment_thresholds)
                    entities[segment_cas]["thresholds"].extend(segment_thresholds)
            else:
                extracted = extract_thresholds(
                    text,
                    page_no,
                    active_entity,
                    record_id,
                    association_method,
                    association_confidence,
                    active_name_subject,
                )
                if active_entity and active_entity in entities:
                    entities[active_entity]["thresholds"].extend(extracted)
            thresholds.extend(extracted)
            if not active_entity:
                if trailing_subject := extract_trailing_subject_fragment(text):
                    active_name_subject = trailing_subject
                else:
                    named_subjects = [item.get("subject_label") for item in extracted if item.get("subject_label")]
                    if named_subjects:
                        active_name_subject = named_subjects[-1]

    thresholds.extend(load_source_verified_threshold_supplements())
    entity_list = sorted(entities.values(), key=lambda item: (item["first_page"], item["cas"]))
    payload = {
        "schema_version": 2,
        "source": BOOK_TITLE,
        "source_file": source_pdf.name,
        "source_sha256": source_sha256,
        "pages": len(pages),
        "record_count": len(records),
        "entity_count": len(entity_list),
        "threshold_count": len(thresholds),
        "table_count": len(tables),
        "records": records,
        "entities": entity_list,
        "thresholds": thresholds,
        "tables": tables,
    }
    return payload


def query_matches(payload: dict[str, Any], query: str) -> list[dict[str, Any]]:
    normalized = normalize_text(query).lower()
    terms = {normalized}
    for entity in payload["entities"]:
        entity_terms = {
            entity["cas"].lower(), entity["chinese_name"].lower(),
            *[name.lower() for name in entity["english_names"]],
            *[name.lower() for name in entity.get("aliases", [])],
        }
        if any(normalized == term or normalized in term for term in entity_terms):
            terms.update(entity_terms)
    hits = []
    for record in payload["records"]:
        text = record["text"].lower()
        score = sum(100 if CAS_RE.fullmatch(term) else 50 for term in terms if term and term in text)
        if score:
            hits.append({"page": record["page"], "id": record["id"], "score": score, "text": record["text"][:220]})
    return sorted(hits, key=lambda item: (-item["score"], item["page"]))[:5]


def identity_key(value: str) -> str:
    return re.sub(r"[^a-z0-9\u3400-\u9fff]", "", value.lower())


def validate_gold_standard(payload: dict[str, Any], cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    entities = {entity["cas"]: entity for entity in payload["entities"]}
    results = []
    for case in cases:
        entity = entities.get(case["cas"])
        issues = []
        if entity is None:
            issues.append("missing_entity")
        else:
            aliases = [
                entity.get("chinese_name", ""),
                *entity.get("english_names", []),
                *entity.get("aliases", []),
            ]
            alias_keys = {identity_key(alias) for alias in aliases}
            alias_keys.update(
                identity_key(prefix)
                for alias in aliases
                if (prefix := alias.split("(", 1)[0]).strip()
            )
            if identity_key(entity.get("chinese_name", "")) != identity_key(case["chinese_name"]):
                issues.append("chinese_name_mismatch")
            if identity_key(case["english_alias"]) not in alias_keys:
                issues.append("english_alias_mismatch")
            if entity.get("first_page") != case["first_page"]:
                issues.append("first_page_mismatch")
            forbidden = {identity_key(alias) for alias in case.get("forbidden_aliases", [])}
            if forbidden & alias_keys:
                issues.append("forbidden_alias")
        results.append({"cas": case["cas"], "passed": not issues, "issues": issues})
    return results


def validate_threshold_gold_standard(
    payload: dict[str, Any], cases: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    results = []
    for case in cases:
        candidates = [
            threshold for threshold in payload["thresholds"]
            if threshold.get("page") == case["page"]
            and threshold.get("record_id") == case["record_id"]
            and threshold.get("entity_cas") == case.get("entity_cas")
            and (
                not case.get("subject_label")
                or identity_key(threshold.get("subject_label") or "") == identity_key(case["subject_label"])
            )
        ]
        issues = []
        if not candidates:
            issues.append("missing_threshold")
        else:
            matching_context = [
                item for item in candidates
                if case["medium"] in item.get("media", [])
                and item.get("threshold_type") == case["threshold_type"]
                and case.get("medium_detail") == item.get("medium_detail")
            ]
            if not matching_context:
                issues.append("context_mismatch")
            else:
                expected = case["value"]
                has_value = any(
                    value.get("low") == expected["low"]
                    and value.get("high") == expected.get("high")
                    and value.get("unit") == expected["unit"]
                    for item in matching_context
                    for value in item.get("values", [])
                )
                if not has_value:
                    issues.append("value_mismatch")
                if not any(
                    case["evidence_contains"] in item.get("raw_text", "")
                    for item in matching_context
                ):
                    issues.append("evidence_mismatch")
        results.append({"id": case["id"], "passed": not issues, "issues": issues})
    return results


def evaluate_quality_gates(qa: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, passed: bool, actual: Any, expected: Any) -> None:
        checks.append({"name": name, "passed": passed, "actual": actual, "expected": expected})

    for name, minimum in config.get("minimum_counts", {}).items():
        actual = qa.get(name, 0)
        add(name, actual >= minimum, actual, {"minimum": minimum})
    anomaly_summary = qa.get("anomaly_summary", {})
    for name, maximum in config.get("maximum_anomalies", {}).items():
        actual = anomaly_summary.get(name, 0)
        add(f"anomaly:{name}", actual <= maximum, actual, {"maximum": maximum})
    if config.get("require_zero_bad_patterns"):
        actual = {name: count for name, count in qa.get("bad_patterns", {}).items() if count}
        add("bad_patterns", not actual, actual, {})
    if config.get("require_all_gold"):
        for name in ("gold_standard", "threshold_gold_standard"):
            result = qa.get(name, {})
            add(name, result.get("passed") == result.get("total"), result, "all_passed")
    if config.get("require_no_missed_queries"):
        actual = qa.get("queries_without_hits", [])
        add("queries_without_hits", not actual, actual, [])
    return {
        "passed": all(check["passed"] for check in checks),
        "checks": checks,
        "failed_checks": [check for check in checks if not check["passed"]],
    }


def build_qa(payload: dict[str, Any]) -> dict[str, Any]:
    fixed_queries = [
        "141-78-6", "乙酸乙酯", "ethyl acetate", "554-12-1", "丙酸乙酯",
        "己酸乙酯", "苯乙醇", "ethyl hexanoate", "啤酒中嗅阈值", "葡萄酒中嗅阈值",
    ]
    query_results = {query: query_matches(payload, query) for query in fixed_queries}
    text = "\n".join(record["text"] for record in payload["records"])
    bad_patterns = {
        "pipe_ig_unit": len(re.findall(r"\|\s*i?g\s*/", text, re.I)),
        "plg_unit": len(re.findall(r"pLg\s*/", text, re.I)),
        "ug_ascii_unit": len(re.findall(r"\bug\s*/", text, re.I)),
        "mg_Lo": len(re.findall(r"mg\s*/\s*Lo\b", text, re.I)),
    }
    anomalies = []
    for threshold in payload["thresholds"]:
        for flag in threshold.get("review_flags", []):
            anomalies.append({
                "category": flag["category"],
                "severity": flag["severity"],
                "page": threshold["page"],
                "record_id": threshold.get("record_id"),
                "entity_cas": threshold.get("entity_cas"),
                "evidence": flag["evidence"],
                "status": threshold.get("review_status", "needs_review"),
            })
    for entity in payload["entities"]:
        if conflict := entity.get("canonical_conflict"):
            conflict_type = conflict.get("type", "identity_conflict")
            severity = {
                "name_variant": "low",
                "likely_ocr_error": "medium",
                "insufficient_extraction": "high",
                "identity_conflict": "high",
                "source_identity_error": "medium",
                "verified_name_variant": "low",
            }[conflict_type]
            anomalies.append({
                "category": f"canonical_{conflict_type}",
                "severity": severity,
                "page": entity["first_page"],
                "record_id": None,
                "entity_cas": entity["cas"],
                "evidence": conflict["reason"],
                "status": "source_verified" if conflict_type == "verified_name_variant" else "needs_review",
            })
    gold_cases = json.loads(GOLD_STANDARD_PATH.read_text(encoding="utf-8")) if GOLD_STANDARD_PATH.exists() else []
    gold_results = validate_gold_standard(payload, gold_cases)
    threshold_gold_cases = (
        json.loads(THRESHOLD_GOLD_STANDARD_PATH.read_text(encoding="utf-8"))
        if THRESHOLD_GOLD_STANDARD_PATH.exists()
        else []
    )
    threshold_gold_results = validate_threshold_gold_standard(payload, threshold_gold_cases)
    return {
        "schema_version": payload["schema_version"],
        "pages": payload["pages"],
        "records": payload["record_count"],
        "entities": payload["entity_count"],
        "thresholds": payload["threshold_count"],
        "tables": payload.get("table_count", len(payload.get("tables", []))),
        "structured_tables": sum(
            table.get("structure_status") == "source_verified_rows"
            for table in payload.get("tables", [])
        ),
        "structured_table_rows": sum(
            len(table.get("rows", []))
            for table in payload.get("tables", [])
            if table.get("structure_status") == "source_verified_rows"
        ),
        "blocks_by_type": Counter(record["block_type"] for record in payload["records"]),
        "threshold_media": Counter(media for item in payload["thresholds"] for media in item["media"]),
        "bad_patterns": bad_patterns,
        "anomaly_summary": Counter(item["category"] for item in anomalies),
        "anomalies": anomalies,
        "gold_standard": {
            "total": len(gold_results),
            "passed": sum(item["passed"] for item in gold_results),
            "results": gold_results,
        },
        "threshold_gold_standard": {
            "total": len(threshold_gold_results),
            "passed": sum(item["passed"] for item in threshold_gold_results),
            "results": threshold_gold_results,
        },
        "fixed_queries": query_results,
        "queries_without_hits": [query for query, hits in query_results.items() if not hits],
    }


def write_json(path: Path, payload: Any, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2 if pretty else None, default=dict),
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--pdftoppm", type=Path, help="Path to pdftoppm; required unless --skip-render is used")
    parser.add_argument("--work-root", type=Path, default=WORK_ROOT)
    parser.add_argument("--workers", type=int, default=max(1, min(4, (os.cpu_count() or 4) // 2)))
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--skip-render", action="store_true")
    parser.add_argument("--skip-ocr", action="store_true")
    parser.add_argument("--keep-images", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pdf = args.pdf.resolve()
    if not pdf.exists():
        raise FileNotFoundError(pdf)
    if not args.skip_render and not args.pdftoppm:
        discovered = shutil.which("pdftoppm")
        if not discovered:
            raise RuntimeError("pdftoppm was not found; install Poppler or pass --pdftoppm")
        args.pdftoppm = Path(discovered)
    reader = PdfReader(str(pdf))
    pages = len(reader.pages)
    source_hash = sha256_file(pdf)
    print(f"source={pdf}")
    print(f"sha256={source_hash}")
    print(f"pages={pages}")

    image_dir = args.work_root / "images"
    ocr_dir = args.work_root / "ocr_pages"
    if args.skip_render:
        images = sorted(image_dir.glob("page-*.jpg"), key=image_page_number)
    else:
        images = render_pages(pdf, image_dir, args.pdftoppm.resolve(), pages, args.dpi)
    if len(images) != pages:
        raise RuntimeError(f"Expected {pages} rendered images, found {len(images)}")
    if not args.skip_ocr:
        run_ocr(images, ocr_dir, max(1, args.workers))

    ocr_pages = load_ocr_pages(ocr_dir, pages)
    payload = build_indexes(ocr_pages, pdf, source_hash)
    qa = build_qa(payload)
    quality_gate_config = (
        json.loads(QUALITY_GATES_PATH.read_text(encoding="utf-8"))
        if QUALITY_GATES_PATH.exists()
        else {}
    )
    qa["quality_gates"] = evaluate_quality_gates(qa, quality_gate_config)

    write_json(PUBLIC_OUT, payload)
    write_json(ENTITY_OUT, {key: payload[key] for key in ["schema_version", "source", "source_file", "source_sha256", "entities", "thresholds"]})
    write_json(DIST_OUT, payload)
    write_json(PROCESSED_DIR / PUBLIC_OUT.name, payload)
    write_json(PROCESSED_DIR / ENTITY_OUT.name, {key: payload[key] for key in ["schema_version", "source", "source_file", "source_sha256", "entities", "thresholds"]})
    write_json(QA_OUT, qa, pretty=True)
    print(json.dumps({
        **{key: qa[key] for key in ["pages", "records", "entities", "thresholds", "bad_patterns", "queries_without_hits"]},
        "quality_gates_passed": qa["quality_gates"]["passed"],
    }, ensure_ascii=False, indent=2))

    if not qa["quality_gates"]["passed"]:
        failed = ", ".join(check["name"] for check in qa["quality_gates"]["failed_checks"])
        raise RuntimeError(f"Book index quality gates failed: {failed}")

    if not args.keep_images:
        shutil.rmtree(image_dir, ignore_errors=True)


if __name__ == "__main__":
    mp.freeze_support()
    main()
