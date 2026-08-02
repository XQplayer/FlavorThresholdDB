"""Conservative link-and-presence adapter for NIST Chemistry WebBook."""

from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
import re
from urllib.error import URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


NIST_BASE = "https://webbook.nist.gov"
PARSER_VERSION = "2026-08-02-presence-v1"
SECTION_RULES = (
    ("ei_ms", "EI mass spectrum", ("mass spectrum (electron ionization)", "electron ionization mass")),
    ("ir", "IR spectrum", ("ir spectrum", "infrared spectrum")),
    ("gc", "Gas chromatography", ("gas chromatography", "retention index")),
    ("vapor_pressure", "Vapor pressure", ("vapor pressure",)),
    ("henry_constant", "Henry's law constant", ("henry's law", "henry law")),
    ("thermochemistry", "Thermochemistry", ("thermochemistry",)),
)


def build_nist_url(cas: str) -> str:
    normalized = str(cas or "").strip()
    if not re.fullmatch(r"\d{2,7}-\d{2}-\d", normalized):
        raise ValueError("valid CAS is required")
    return f"{NIST_BASE}/cgi/cbook.cgi?ID=C{normalized.replace('-', '')}&Units=SI&Mask=FFFF"


class _LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self._href = None
        self._text = []

    def handle_starttag(self, tag, attrs):
        if tag.casefold() == "a":
            self._href = dict(attrs).get("href", "")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.casefold() == "a" and self._href is not None:
            self.links.append((" ".join(self._text).strip(), self._href))
            self._href = None
            self._text = []


def parse_nist_presence(html: str, cas: str) -> dict:
    url = build_nist_url(cas)
    if not isinstance(html, str) or "<html" not in html.casefold():
        return {"found": False, "status": "invalid_response", "cas": cas, "url": url, "sections": [], "source": "NIST Chemistry WebBook", "parser_version": PARSER_VERSION}
    parser = _LinkParser()
    parser.feed(html)
    sections = []
    for section_type, label, needles in SECTION_RULES:
        match = next(((text, href) for text, href in parser.links if any(needle in text.casefold() for needle in needles)), None)
        if match:
            sections.append({"type": section_type, "label": label, "url": urljoin(url, match[1])})
        elif section_type == "vapor_pressure" and "antoine equation parameters" in html.casefold():
            sections.append({"type": section_type, "label": label, "url": f"{url}#Thermo-Phase"})
    return {
        "found": bool(sections),
        "status": "ok" if sections else "no_data",
        "cas": cas,
        "url": url,
        "sections": sections,
        "source": "NIST Chemistry WebBook",
        "parser_version": PARSER_VERSION,
    }


def _fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "FlavorThresholdDB/1 academic-link-checker"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def query_nist_webbook(cas: str, *, fetch_text=None) -> dict:
    url = build_nist_url(cas)
    try:
        result = parse_nist_presence((fetch_text or _fetch_text)(url), cas)
    except (TimeoutError, URLError, OSError):
        result = {"found": False, "status": "upstream_unavailable", "cas": cas, "url": url, "sections": [], "source": "NIST Chemistry WebBook", "parser_version": PARSER_VERSION}
    result["retrieved_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return result
