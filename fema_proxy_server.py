from __future__ import annotations

import html
import json
import os
import re
import socket
import threading
import time
import tempfile
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8787"))
BASE_URL = "https://www.femaflavor.org"
PUBCHEM_BASE_URL = "https://pubchem.ncbi.nlm.nih.gov"
FLAVORDB_BASE_URL = "https://cosylab.iiitd.edu.in/flavordb2"
CACHE_PATH = Path(__file__).resolve().with_name("fema_flavor_cache.json")
_CACHE_PERSIST_LOCK = threading.RLock()


def load_cache() -> dict[str, dict]:
    if not CACHE_PATH.exists():
        return {}
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(cache: dict[str, dict]) -> None:
    temporary_path = None
    with _CACHE_PERSIST_LOCK:
        snapshot = dict(cache)
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            dir=CACHE_PATH.parent,
            prefix=f".{CACHE_PATH.name}.",
            suffix=".tmp",
        )
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(snapshot, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, CACHE_PATH)
            temporary_path = None
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)


_CACHE_MISSING = object()


def _store_cache_result(cache: dict, key: str, result: dict) -> None:
    with _CACHE_PERSIST_LOCK:
        previous = cache.get(key, _CACHE_MISSING)
        cache[key] = result
        try:
            save_cache(cache)
        except Exception:
            if previous is _CACHE_MISSING:
                cache.pop(key, None)
            else:
                cache[key] = previous
            raise


def fetch_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=25) as resp:
        return resp.read().decode("utf-8", errors="replace")


_PUBCHEM_VOLATILE_RATE_LOCK = threading.Lock()
_PUBCHEM_VOLATILE_LAST_REQUEST = None
_PUBCHEM_VOLATILE_MIN_INTERVAL = 0.2
_PUBCHEM_VOLATILE_FLIGHTS_LOCK = threading.Lock()
_PUBCHEM_VOLATILE_FLIGHTS = {}
PUBCHEM_VOLATILE_CACHE_SCHEMA_VERSION = 1
PUBCHEM_VOLATILE_PARSER_VERSION = "2026-08-02-water-medium-v2"
PUBCHEM_VOLATILE_CACHE_TTL = timedelta(days=30)


def _parse_utc_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def is_pubchem_volatile_cache_entry_current(
    entry: dict,
    *,
    now: datetime | None = None,
) -> bool:
    if not isinstance(entry, dict):
        return False
    if entry.get("schema_version") != PUBCHEM_VOLATILE_CACHE_SCHEMA_VERSION:
        return False
    if entry.get("parser_version") != PUBCHEM_VOLATILE_PARSER_VERSION:
        return False
    retrieved_at = _parse_utc_timestamp(entry.get("retrieved_at"))
    reference_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if retrieved_at is None or retrieved_at > reference_time:
        return False
    return reference_time - retrieved_at <= PUBCHEM_VOLATILE_CACHE_TTL


def _stamp_pubchem_volatile_cache_metadata(result: dict) -> dict:
    return {
        **result,
        "schema_version": PUBCHEM_VOLATILE_CACHE_SCHEMA_VERSION,
        "parser_version": PUBCHEM_VOLATILE_PARSER_VERSION,
    }


def _reset_pubchem_volatile_throttle_for_tests() -> None:
    global _PUBCHEM_VOLATILE_LAST_REQUEST
    with _PUBCHEM_VOLATILE_RATE_LOCK:
        _PUBCHEM_VOLATILE_LAST_REQUEST = None


def _throttled_pubchem_volatile_fetch(url, fetcher=fetch_text, clock=time.monotonic, sleeper=time.sleep):
    global _PUBCHEM_VOLATILE_LAST_REQUEST
    with _PUBCHEM_VOLATILE_RATE_LOCK:
        now = clock()
        if _PUBCHEM_VOLATILE_LAST_REQUEST is not None:
            delay = _PUBCHEM_VOLATILE_MIN_INTERVAL - (now - _PUBCHEM_VOLATILE_LAST_REQUEST)
            if delay > 0:
                sleeper(delay)
                now = clock()
        _PUBCHEM_VOLATILE_LAST_REQUEST = now
    return fetcher(url)


def fetch_bytes(url: str) -> tuple[bytes, str]:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=25) as resp:
        return resp.read(), resp.headers.get_content_type()


def strip_tags(value: str) -> str:
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"</p\s*>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r"\n\s+", "\n", value)
    return value.strip()


def first_match(pattern: str, text: str, flags: int = re.S | re.I) -> str:
    match = re.search(pattern, text, flags)
    return match.group(1).strip() if match else ""


def parse_detail(detail_html: str, url: str) -> dict:
    title = first_match(r"<h1[^>]*>\s*([^<]*?)<strong>\s*<span>(.*?)</span>", detail_html)
    name_match = re.search(r"<h1[^>]*>\s*([^<]*?)<strong>\s*<span>(.*?)</span>", detail_html, re.S | re.I)
    fema_number = strip_tags(name_match.group(1)) if name_match else ""
    name = strip_tags(name_match.group(2)) if name_match else ""

    cas = first_match(
        r'field--name-field-cas[\s\S]*?<div class="field__item">([\s\S]*?)</div>',
        detail_html,
    )
    flavor_profile_raw = first_match(
        r'<div class="field[^"]*field--name-field-flavor-profile[^"]*"[^>]*>([\s\S]*?)</div>',
        detail_html,
    )
    jecfa = first_match(
        r'field--name-field-jecfa-number[\s\S]*?<div class="field__item">([\s\S]*?)</div>',
        detail_html,
    )

    return {
        "found": bool(flavor_profile_raw or name),
        "name": name,
        "cas": strip_tags(cas),
        "fema_number": fema_number,
        "jecfa_number": strip_tags(jecfa),
        "flavor_profile": strip_tags(flavor_profile_raw),
        "url": url,
        "source": "FEMA Flavor Library",
    }


def query_fema(cas_or_query: str) -> dict:
    query = cas_or_query.strip()
    if not query:
        return {"found": False, "error": "Missing query"}

    search_url = f"{BASE_URL}/flavor-library/search?fulltext={quote(query)}"
    search_html = fetch_text(search_url)
    href = first_match(r'<div class="views-row ingredient-item">\s*<a href="([^"]+)"', search_html)
    if not href:
        return {
            "found": False,
            "query": query,
            "search_url": search_url,
            "error": "No FEMA result",
        }

    detail_url = href if href.startswith("http") else BASE_URL + href
    detail_html = fetch_text(detail_url)
    result = parse_detail(detail_html, detail_url)
    result["query"] = query
    result["search_url"] = search_url
    return result


def query_pubchem(cas_or_query: str) -> dict:
    query = cas_or_query.strip()
    if not query:
        return {"found": False, "error": "Missing query"}

    properties = ",".join([
        "Title",
        "IUPACName",
        "MolecularFormula",
        "MolecularWeight",
        "CanonicalSMILES",
        "IsomericSMILES",
        "InChIKey",
        "XLogP",
        "TPSA",
        "HBondDonorCount",
        "HBondAcceptorCount",
    ])
    url = f"{PUBCHEM_BASE_URL}/rest/pug/compound/name/{quote(query, safe='')}/property/{properties}/JSON"
    try:
        payload = json.loads(fetch_text(url))
    except HTTPError as exc:
        if exc.code == 404:
            return {"found": False, "query": query, "error": "No PubChem result"}
        raise

    records = payload.get("PropertyTable", {}).get("Properties", [])
    if not records:
        return {"found": False, "query": query, "error": "No PubChem result"}

    record = records[0]
    cid = record.get("CID")
    return {
        "found": True,
        "query": query,
        "cid": cid,
        "title": record.get("Title", ""),
        "iupac_name": record.get("IUPACName", ""),
        "molecular_formula": record.get("MolecularFormula", ""),
        "molecular_weight": record.get("MolecularWeight", ""),
        "smiles": record.get("SMILES") or record.get("ConnectivitySMILES", ""),
        "connectivity_smiles": record.get("ConnectivitySMILES", ""),
        "inchi_key": record.get("InChIKey", ""),
        "xlogp": record.get("XLogP"),
        "tpsa": record.get("TPSA"),
        "h_bond_donor_count": record.get("HBondDonorCount"),
        "h_bond_acceptor_count": record.get("HBondAcceptorCount"),
        "url": f"{PUBCHEM_BASE_URL}/compound/{cid}",
        "image_path": f"/pubchem-image?cid={cid}",
        "source": "PubChem",
    }


PUBCHEM_VOLATILE_PROPERTY_HEADINGS = {
    "Boiling Point": "boiling_point",
    "Vapor Pressure": "vapor_pressure",
    "Henry's Law Constant": "henrys_law_constant",
    "Solubility": "water_solubility",
    "LogP": "experimental_logp",
    "Density": "density",
    "Melting Point": "melting_point",
    "Physical Description": "physical_state",
}

PUBCHEM_PROPERTY_UNIT_ALIASES = {
    "mm hg": "mmHg",
    "mmhg": "mmHg",
    "atm": "atm",
    "atm-cu m/mole": "atm·m³/mol",
    "mg/l": "mg/L",
    "g/cm3": "g/cm³",
    "g/cm³": "g/cm³",
    "°c": "°C",
}

PUBCHEM_PROPERTY_PRIMARY_UNITS = {
    "boiling_point": {"°C"},
    "vapor_pressure": {"mmHg", "atm"},
    "henrys_law_constant": {"atm·m³/mol"},
    "water_solubility": {"mg/L"},
    "density": {"g/cm³"},
    "melting_point": {"°C"},
}


def parse_pubchem_property_text(raw_value: str, property_key: str = "") -> dict:
    """Conservatively extract explicit PubChem property values and conditions."""
    result = {
        "raw_value": raw_value,
        "normalized_value": None,
        "unit": "",
        "temperature": "",
        "pressure": "",
        "medium": "",
    }
    text = str(raw_value)

    if property_key == "physical_state":
        states = {state.lower() for state in re.findall(r"\b(liquid|solid|gas)\b", text, re.I)}
        negated_state = re.search(
            r"\b(?:not|no|without)\s+(?:an?\s+)?(?:liquid|solid|gas)\b|\bnon[- ](?:liquid|solid|gas)\b",
            text,
            re.I,
        )
        if len(states) == 1 and not negated_state:
            result["normalized_value"] = next(iter(states))
        return result

    aqueous_medium = re.search(r"\bwater\b|\baqueous\b|\baqua(?:tic)?\b", text, re.I)
    if aqueous_medium:
        result["medium"] = "water"

    number_pattern = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:(?:[eE][+-]?\d+)|(?:\s*[x×]\s*10[+-]?\d+))?"
    malformed_exponent = re.search(r"\d(?:\.\d+)?[eE](?:[+-](?!\d)|(?![+\-\d]))", text)
    numeric_range = re.search(
        r"(?<![x×X])\b\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?\b",
        text,
    )
    if malformed_exponent or numeric_range:
        result["medium"] = ""
        return result

    aliases = sorted(PUBCHEM_PROPERTY_UNIT_ALIASES, key=len, reverse=True)
    unit_pattern = "|".join(re.escape(alias) for alias in aliases)
    value_pattern = re.compile(
        rf"(?<![\w.+-])(?P<number>{number_pattern})\s*(?P<unit>{unit_pattern})(?![A-Za-z0-9])",
        re.I,
    )
    candidates = [
        {
            "number": match.group("number"),
            "unit": PUBCHEM_PROPERTY_UNIT_ALIASES[match.group("unit").lower()],
        }
        for match in value_pattern.finditer(text)
    ]

    if property_key == "experimental_logp":
        logp_matches = re.findall(
            rf"\bLog\s+(?:Kow|P)\s*=\s*(?P<number>{number_pattern})(?![\w.+-])",
            text,
            re.I,
        )
        if len(logp_matches) != 1:
            result["medium"] = ""
            return result
        result["normalized_value"] = float(
            re.sub(r"\s*[x×]\s*10", "e", logp_matches[0], flags=re.I)
        )
        return result

    expected_units = PUBCHEM_PROPERTY_PRIMARY_UNITS.get(property_key)
    if expected_units is None:
        non_temperature = [candidate for candidate in candidates if candidate["unit"] != "°C"]
        primary_candidates = non_temperature or candidates
    else:
        primary_candidates = [candidate for candidate in candidates if candidate["unit"] in expected_units]

    temperatures = [candidate for candidate in candidates if candidate["unit"] == "°C"]
    pressures = [candidate for candidate in candidates if candidate["unit"] in {"mmHg", "atm"}]
    if len(primary_candidates) != 1 or len(temperatures) > 1 or (
        property_key not in {"vapor_pressure"} and len(pressures) > 1
    ):
        result["medium"] = ""
        return result

    primary = primary_candidates[0]
    normalized_number = re.sub(r"\s*[x×]\s*10", "e", primary["number"], flags=re.I)
    try:
        result["normalized_value"] = float(normalized_number)
    except ValueError:
        result["medium"] = ""
        return result
    result["unit"] = primary["unit"]

    if primary["unit"] != "°C" and len(temperatures) == 1:
        result["temperature"] = f"{temperatures[0]['number']} °C"
    pressure_conditions = [candidate for candidate in pressures if candidate is not primary]
    if len(pressure_conditions) > 1:
        return {
            **result,
            "normalized_value": None,
            "unit": "",
            "temperature": "",
            "pressure": "",
            "medium": "",
        }
    if pressure_conditions:
        pressure = pressure_conditions[0]
        result["pressure"] = f"{pressure['number']} {pressure['unit']}"
    return result


def _pubchem_information_strings(information: dict) -> list[str]:
    value = information.get("Value", {})
    strings = []
    for item in value.get("StringWithMarkup", []):
        text = item.get("String", "") if isinstance(item, dict) else str(item)
        if text.strip():
            strings.append(text.strip())
    if not strings and isinstance(value.get("String"), str) and value["String"].strip():
        strings.append(value["String"].strip())
    return strings


def _pubchem_has_aqueous_context(information: dict, raw_value: str) -> bool:
    context_parts = [raw_value]

    def collect_strings(value: object) -> None:
        if isinstance(value, str):
            context_parts.append(value)
        elif isinstance(value, dict):
            for nested in value.values():
                collect_strings(nested)
        elif isinstance(value, list):
            for nested in value:
                collect_strings(nested)

    collect_strings(information.get("Description", ""))
    context = " ".join(context_parts)
    return bool(re.search(r"\bwater\b|\baqueous\b|\baqua(?:tic)?\b", context, re.I))


def _parse_pubchem_volatile_record(information: dict, references: dict, property_key: str) -> list[dict]:
    reference_number = information.get("ReferenceNumber")
    reference = references.get(reference_number, {})
    records = []
    for raw_value in _pubchem_information_strings(information):
        if property_key == "water_solubility" and not _pubchem_has_aqueous_context(information, raw_value):
            continue
        record = {
            "raw_value": raw_value,
            "reference_number": reference_number,
            "source": reference.get("SourceName", ""),
        }
        record.update(parse_pubchem_property_text(raw_value, property_key))
        if reference.get("URL"):
            record["source_url"] = reference["URL"]
        records.append(record)
    return records


def _deduplicate_pubchem_records(records: list[dict]) -> list[dict]:
    unique = []
    seen = set()
    for record in records:
        key = (record.get("raw_value"), record.get("reference_number"))
        if key not in seen:
            seen.add(key)
            unique.append(record)
    return unique


def parse_pubchem_volatile_properties(payload: dict, cid: int | str) -> dict:
    properties = {key: [] for key in PUBCHEM_VOLATILE_PROPERTY_HEADINGS.values()}
    record = payload.get("Record", {})
    references = {
        reference.get("ReferenceNumber"): reference
        for reference in record.get("Reference", [])
        if reference.get("ReferenceNumber") is not None
    }

    def parse_property_sections(sections: list[dict]) -> None:
        for section in sections or []:
            property_key = PUBCHEM_VOLATILE_PROPERTY_HEADINGS.get(section.get("TOCHeading"))
            if property_key:
                parsed = []
                for information in section.get("Information", []):
                    parsed.extend(_parse_pubchem_volatile_record(information, references, property_key))
                properties[property_key].extend(parsed)
            parse_property_sections(section.get("Section", []))

    parse_property_sections(record.get("Section", []))
    for property_key, records in properties.items():
        properties[property_key] = _deduplicate_pubchem_records(records)

    cid_text = str(cid)
    return {
        "found": any(properties.values()),
        "cid": cid_text,
        "properties": properties,
        "source": "PubChem PUG View",
        "url": f"{PUBCHEM_BASE_URL}/compound/{cid_text}#section=Experimental-Properties",
    }


def _empty_pubchem_volatile(cid: int | str, status: str) -> dict:
    cid_text = str(cid).strip()
    return {
        "found": False,
        "status": status,
        "cid": cid_text,
        "properties": {key: [] for key in PUBCHEM_VOLATILE_PROPERTY_HEADINGS.values()},
        "source": "PubChem PUG View",
        "url": f"{PUBCHEM_BASE_URL}/compound/{cid_text}#section=Experimental-Properties",
    }


def _canonical_pubchem_cid(cid: int | str) -> str | None:
    cid_text = str(cid).strip()
    if not re.fullmatch(r"[0-9]+", cid_text):
        return None
    canonical = str(int(cid_text))
    return canonical if canonical != "0" else None


def query_pubchem_volatile_properties(cid: int | str, fetcher=None) -> dict:
    cid_text = str(cid).strip()
    canonical_cid = _canonical_pubchem_cid(cid_text)
    if canonical_cid is None:
        return _empty_pubchem_volatile(cid_text, "invalid_cid")
    cid_text = canonical_cid

    retrieved_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    url = (
        f"{PUBCHEM_BASE_URL}/rest/pug_view/data/compound/{cid_text}/JSON"
        "?heading=Experimental%20Properties"
    )
    try:
        payload_text = (
            _throttled_pubchem_volatile_fetch(url)
            if fetcher is None
            else fetcher(url)
        )
    except HTTPError as exc:
        if exc.code == 404:
            return _stamp_pubchem_volatile_cache_metadata({
                **_empty_pubchem_volatile(cid_text, "no_data"),
                "retrieved_at": retrieved_at,
            })
        if exc.code in {408, 425, 429} or 500 <= exc.code <= 599:
            return _empty_pubchem_volatile(cid_text, "upstream_unavailable")
        raise
    except (TimeoutError, socket.timeout, URLError):
        return _empty_pubchem_volatile(cid_text, "upstream_unavailable")

    if not isinstance(payload_text, str) or re.match(r"^\s*(?:<!doctype\s+html|<html\b)", payload_text, re.I):
        return _empty_pubchem_volatile(cid_text, "invalid_response")
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError:
        return _empty_pubchem_volatile(cid_text, "invalid_response")
    if not isinstance(payload, dict) or not isinstance(payload.get("Record"), dict):
        return _empty_pubchem_volatile(cid_text, "invalid_response")
    record = payload["Record"]
    if (
        ("Section" in record and not isinstance(record["Section"], list))
        or ("Reference" in record and not isinstance(record["Reference"], list))
    ):
        return _empty_pubchem_volatile(cid_text, "invalid_response")

    result = parse_pubchem_volatile_properties(payload, cid_text)

    status = "ok" if result["found"] else "no_data"
    return _stamp_pubchem_volatile_cache_metadata({
        **result,
        "status": status,
        "retrieved_at": retrieved_at,
    })


def _get_pubchem_volatile_cached(cache: dict, cid: int | str) -> tuple[dict, bool]:
    canonical_cid = _canonical_pubchem_cid(cid)
    if canonical_cid is None:
        return query_pubchem_volatile_properties(cid), False
    cache_key = f"pubchem-volatile:{canonical_cid}"

    with _PUBCHEM_VOLATILE_FLIGHTS_LOCK:
        cached_result = cache.get(cache_key)
        if cached_result is not None and is_pubchem_volatile_cache_entry_current(cached_result):
            return cached_result, True
        flight = _PUBCHEM_VOLATILE_FLIGHTS.get(canonical_cid)
        if flight is None:
            flight = {
                "event": threading.Event(),
                "result": None,
                "error": None,
                "persisted": False,
            }
            _PUBCHEM_VOLATILE_FLIGHTS[canonical_cid] = flight
            leader = True
        else:
            leader = False

    if not leader:
        flight["event"].wait()
        if flight["error"] is not None:
            raise flight["error"]
        return flight["result"], flight["persisted"]

    try:
        result = _stamp_pubchem_volatile_cache_metadata(
            query_pubchem_volatile_properties(canonical_cid)
        )
        flight["result"] = result
        if result["status"] in {"ok", "no_data"}:
            with _CACHE_PERSIST_LOCK:
                previous = cache.get(cache_key)
                cache[cache_key] = result
                try:
                    save_cache(cache)
                except OSError:
                    if previous is None:
                        cache.pop(cache_key, None)
                    else:
                        cache[cache_key] = previous
                else:
                    flight["persisted"] = True
        return result, False
    except BaseException as exc:
        flight["error"] = exc
        raise
    finally:
        with _PUBCHEM_VOLATILE_FLIGHTS_LOCK:
            _PUBCHEM_VOLATILE_FLIGHTS.pop(canonical_cid, None)
            flight["event"].set()


def query_pubchem_crystal_structures(cid: str) -> dict:
    url = f"{PUBCHEM_BASE_URL}/rest/pug_view/data/compound/{cid}/JSON?heading=Crystal%20Structures"
    payload = json.loads(fetch_text(url))

    crystal_section = None

    def find_section(sections: list[dict]) -> None:
        nonlocal crystal_section
        for section in sections or []:
            if section.get("TOCHeading") == "Crystal Structures":
                crystal_section = section
                return
            find_section(section.get("Section", []))
            if crystal_section:
                return

    find_section(payload.get("Record", {}).get("Section", []))
    if not crystal_section:
        return {"found": False, "cid": cid, "records": []}

    records: dict[int, dict] = {}
    for section in crystal_section.get("Section", []):
        for info in section.get("Information", []):
            reference_number = info.get("ReferenceNumber")
            if reference_number is None:
                continue
            record = records.setdefault(reference_number, {"reference_number": reference_number})
            value = info.get("Value", {})
            strings = value.get("StringWithMarkup", [])
            text = strings[0].get("String", "") if strings else ""
            name = info.get("Name", "")

            if name == "CCDC Number":
                record["ccdc_number"] = text
                record["ccdc_url"] = info.get("URL", "")
            elif name == "Crystal Structure Data":
                record["doi"] = text.removeprefix("DOI:")
                record["article_url"] = info.get("URL", "")
            elif name == "Crystal Structure Depiction":
                image_urls = value.get("ExternalDataURL", [])
                record["image_url"] = image_urls[0] if image_urls else ""

    usable_records = [
        record for record in records.values()
        if record.get("ccdc_number") or record.get("doi") or record.get("image_url")
    ]
    return {
        "found": bool(usable_records),
        "cid": cid,
        "records": usable_records[:6],
        "url": f"{PUBCHEM_BASE_URL}/compound/{cid}#section=Crystal-Structures",
        "source": "PubChem PUG View",
    }


def parse_flavordb2_molecule_entities(detail_html: str, cid: int | str) -> dict:
    entities = []
    seen_ids = set()
    pattern = r'href=["\']/flavordb2/entity_details\?id=(\d+)["\'][^>]*>\s*(?:<strong[^>]*>)?([^<]+)'
    for entity_id_text, name_html in re.findall(pattern, detail_html, re.I):
        entity_id = int(entity_id_text)
        if entity_id in seen_ids:
            continue
        seen_ids.add(entity_id)
        entities.append({
            "id": entity_id,
            "name": strip_tags(name_html),
            "url": f"{FLAVORDB_BASE_URL}/entity_details?id={entity_id}",
        })
    return {
        "found": bool(entities),
        "cid": str(cid),
        "entities": entities,
        "source": "FlavorDB2",
        "url": f"{FLAVORDB_BASE_URL}/molecules_details?id={cid}",
    }


def parse_flavordb2_entities(payload_text: str) -> list[dict]:
    payload = json.loads(payload_text)
    if isinstance(payload, str):
        payload = json.loads(payload)
    results = []
    for entity in payload or []:
        entity_id = entity.get("entity_id")
        results.append({
            "id": entity_id,
            "name": entity.get("entity_alias_readable") or entity.get("entity_alias") or "",
            "category": entity.get("category_readable") or entity.get("category") or "",
            "synonyms": entity.get("entity_alias_synonyms") or "",
            "natural_source": {
                "name": entity.get("natural_source_name") or "",
                "url": entity.get("natural_source_url") or "",
            },
            "url": f"{FLAVORDB_BASE_URL}/entity_details?id={entity_id}",
        })
    return results


def _flavordb2_label_value(detail_html: str, label: str) -> str:
    patterns = [
        rf'<t[dh][^>]*>\s*(?:<strong[^>]*>)?{re.escape(label)}\s*:?(?:</strong>)?\s*</t[dh]>\s*<td[^>]*>([\s\S]*?)</td>',
        rf'<h[1-6][^>]*>\s*{re.escape(label)}\s*:\s*<strong[^>]*>([\s\S]*?)</strong>\s*</h[1-6]>',
        rf'<strong[^>]*>\s*{re.escape(label)}\s*:?</strong>\s*([^<]+)',
    ]
    for pattern in patterns:
        value = first_match(pattern, detail_html)
        if value:
            return strip_tags(value)
    return ""


def parse_flavordb2_entity_detail(detail_html: str, entity_id: int | str) -> dict:
    name = strip_tags(first_match(r'<div[^>]+id=["\']entity_details["\'][\s\S]*?<h1[^>]*>([\s\S]*?)</h1>', detail_html))
    category = _flavordb2_label_value(detail_html, "Category")
    synonyms = _flavordb2_label_value(detail_html, "Synonyms")
    natural_source_name = first_match(
        r'Natural Source of[\s\S]*?</t[dh]>\s*<td[^>]*>([\s\S]*?)</td>',
        detail_html,
    )
    if not natural_source_name:
        natural_source_name = first_match(
            r'Natural Source of[\s\S]*?</a>\s*:\s*<a[^>]*>([\s\S]*?)</a>',
            detail_html,
        )
    taxonomy = {}
    for label in ("Kingdom", "Phylum", "Class", "Order", "Family", "Genus", "Species"):
        value = _flavordb2_label_value(detail_html, label)
        if value:
            taxonomy[label.lower()] = value

    compounds = []
    table_body = first_match(r'<table[^>]+id=["\']molecules["\'][^>]*>[\s\S]*?<tbody[^>]*>([\s\S]*?)</tbody>', detail_html)
    for row_html in re.findall(r'<tr[^>]*>([\s\S]*?)</tr>', table_body, re.I):
        cid_match = re.search(r'pubchem\.ncbi\.nlm\.nih\.gov/compound/(\d+)', row_html, re.I)
        cells = re.findall(r'<td[^>]*>([\s\S]*?)</td>', row_html, re.I)
        if not cid_match or not cells:
            continue
        profile = [
            strip_tags(term)
            for term in re.findall(r'<a[^>]*>([\s\S]*?)</a>', cells[2] if len(cells) > 2 else "", re.I)
            if strip_tags(term)
        ]
        compounds.append({
            "cid": int(cid_match.group(1)),
            "name": strip_tags(cells[0]),
            "flavor_profile": profile,
            "url": f"{PUBCHEM_BASE_URL}/compound/{cid_match.group(1)}",
        })

    entity_id_text = str(entity_id)
    return {
        "found": bool(name),
        "id": int(entity_id_text) if entity_id_text.isdigit() else entity_id_text,
        "name": name,
        "category": category,
        "synonyms": [part.strip() for part in synonyms.split(",") if part.strip()],
        "natural_source": {
            "name": strip_tags(natural_source_name),
            "taxonomy": taxonomy,
        },
        "compounds": compounds,
        "source": "FlavorDB2",
        "url": f"{FLAVORDB_BASE_URL}/entity_details?id={entity_id_text}",
    }


def query_flavordb2_molecule_entities(
    cid: int | str,
    fetcher=fetch_text,
) -> dict:
    cid_text = str(cid).strip()
    if not cid_text.isdigit():
        return {"found": False, "cid": cid_text, "entities": [], "error": "Missing or invalid PubChem CID"}
    url = f"{FLAVORDB_BASE_URL}/molecules_details?id={cid_text}"
    return parse_flavordb2_molecule_entities(fetcher(url), cid_text)


def query_flavordb2_entities(query: str, fetcher=fetch_text) -> dict:
    query_text = str(query).strip()
    if not query_text:
        return {"found": False, "query": query_text, "entities": [], "error": "Missing entity query"}
    url = f"{FLAVORDB_BASE_URL}/entities?entity={quote(query_text, safe='')}"
    entities = parse_flavordb2_entities(fetcher(url))
    return {
        "found": bool(entities),
        "query": query_text,
        "entities": entities,
        "source": "FlavorDB2",
        "url": url,
    }


def query_flavordb2_entity(entity_id: int | str, fetcher=fetch_text) -> dict:
    entity_id_text = str(entity_id).strip()
    if not entity_id_text.isdigit():
        return {"found": False, "id": entity_id_text, "error": "Missing or invalid entity id"}
    url = f"{FLAVORDB_BASE_URL}/entity_details?id={entity_id_text}"
    return parse_flavordb2_entity_detail(fetcher(url), entity_id_text)


def query_flavordb(cid: int | str) -> dict:
    cid_text = str(cid).strip()
    if not cid_text.isdigit():
        return {"found": False, "error": "Missing or invalid PubChem CID"}

    json_url = f"{FLAVORDB_BASE_URL}/molecules_json?id={cid_text}"
    try:
        payload = json.loads(fetch_text(json_url))
    except HTTPError as exc:
        if exc.code == 404:
            return {"found": False, "cid": cid_text, "error": "No FlavorDB result"}
        raise

    if not payload or not payload.get("pubchem_id"):
        return {"found": False, "cid": cid_text, "error": "No FlavorDB result"}

    def split_values(value: object) -> list[str]:
        if value is None:
            return []
        return [part.strip() for part in re.split(r"[@,]", str(value)) if part.strip()]

    return {
        "found": True,
        "cid": payload.get("pubchem_id"),
        "common_name": payload.get("common_name", ""),
        "iupac_name": payload.get("iupac_name", ""),
        "cas_numbers": split_values(payload.get("cas_id")),
        "flavor_profile": split_values(payload.get("flavor_profile")),
        "fema_flavor_profile": split_values(payload.get("fema_flavor_profile")),
        "fema_number": payload.get("fema_number", ""),
        "taste": split_values(payload.get("taste")),
        "odor": split_values(payload.get("odor")),
        "functional_groups": split_values(payload.get("functional_groups")),
        "fooddb_id": payload.get("fooddb_id", ""),
        "smiles": payload.get("smile", ""),
        "url": f"{FLAVORDB_BASE_URL}/molecules?pubchem_id={cid_text}",
        "json_url": json_url,
        "image_url": f"{FLAVORDB_BASE_URL}/static/molecules_images/{cid_text}.png",
        "source": "FlavorDB2",
        "license": "CC BY-NC-SA 3.0",
    }


class Handler(BaseHTTPRequestHandler):
    cache = load_cache()

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_binary(
        self,
        status: int,
        body: bytes,
        content_type: str,
        filename: str = "",
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=604800")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_json(200, {"ok": True})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json(200, {"ok": True, "service": "flavor_data_proxy"})
            return
        if parsed.path == "/pubchem-image":
            params = parse_qs(parsed.query)
            cid = (params.get("cid") or [""])[0].strip()
            size = (params.get("size") or ["240x240"])[0].strip()
            download = (params.get("download") or [""])[0] == "1"
            if not cid.isdigit():
                self.send_json(400, {"error": "Missing or invalid cid"})
                return
            if size not in {"100x100", "240x240", "300x300", "500x500"}:
                self.send_json(400, {"error": "Unsupported image size"})
                return
            try:
                body, content_type = fetch_bytes(
                    f"{PUBCHEM_BASE_URL}/rest/pug/compound/cid/{cid}/PNG?image_size={size}"
                )
                filename = f"pubchem-cid-{cid}-{size}.png" if download else ""
                self.send_binary(200, body, content_type, filename)
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
            return
        if parsed.path == "/pubchem-3d":
            cid = (parse_qs(parsed.query).get("cid") or [""])[0].strip()
            if not cid.isdigit():
                self.send_json(400, {"error": "Missing or invalid cid"})
                return
            try:
                body, content_type = fetch_bytes(
                    f"{PUBCHEM_BASE_URL}/rest/pug/compound/cid/{cid}/record/SDF?record_type=3d"
                )
                self.send_binary(200, body, content_type)
            except HTTPError as exc:
                if exc.code in {404, 501}:
                    self.send_json(404, {"found": False, "error": "No PubChem 3D conformer"})
                else:
                    self.send_json(502, {"error": str(exc)})
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
            return
        if parsed.path == "/pubchem-coordinates":
            params = parse_qs(parsed.query)
            cid = (params.get("cid") or [""])[0].strip()
            output_format = (params.get("format") or ["sdf"])[0].strip().lower()
            record_type = (params.get("record_type") or ["2d"])[0].strip().lower()
            download = (params.get("download") or [""])[0] == "1"
            format_map = {"sdf": "SDF", "json": "JSON", "xml": "XML", "asnt": "ASNT"}
            extension_map = {"sdf": "sdf", "json": "json", "xml": "xml", "asnt": "txt"}
            if not cid.isdigit():
                self.send_json(400, {"error": "Missing or invalid cid"})
                return
            if output_format not in format_map or record_type not in {"2d", "3d"}:
                self.send_json(400, {"error": "Unsupported coordinate format or record type"})
                return
            try:
                body, content_type = fetch_bytes(
                    f"{PUBCHEM_BASE_URL}/rest/pug/compound/cid/{cid}/record/"
                    f"{format_map[output_format]}?record_type={record_type}"
                )
                filename = (
                    f"pubchem-cid-{cid}-{record_type}.{extension_map[output_format]}"
                    if download else ""
                )
                self.send_binary(200, body, content_type, filename)
            except HTTPError as exc:
                if exc.code in {404, 501}:
                    self.send_json(404, {"error": f"No PubChem {record_type.upper()} record"})
                else:
                    self.send_json(502, {"error": str(exc)})
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
            return
        if parsed.path == "/pubchem-crystal":
            cid = (parse_qs(parsed.query).get("cid") or [""])[0].strip()
            if not cid.isdigit():
                self.send_json(400, {"error": "Missing or invalid cid"})
                return
            try:
                self.send_json(200, query_pubchem_crystal_structures(cid))
            except HTTPError as exc:
                if exc.code == 404:
                    self.send_json(200, {"found": False, "cid": cid, "records": []})
                else:
                    self.send_json(502, {"error": str(exc)})
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
            return
        if parsed.path not in {
            "/fema",
            "/pubchem",
            "/pubchem-volatile",
            "/flavordb",
            "/compound",
            "/flavordb2/compound-entities",
            "/flavordb2/entities",
            "/flavordb2/entity",
        }:
            self.send_json(404, {"error": "Not found"})
            return

        params = parse_qs(parsed.query)
        query = (params.get("cas") or params.get("q") or [""])[0].strip()
        cid = (params.get("cid") or [""])[0].strip()

        if parsed.path == "/pubchem-volatile":
            try:
                result, cached = _get_pubchem_volatile_cached(self.cache, cid)
            except (HTTPError, URLError, TimeoutError, socket.timeout):
                result = _empty_pubchem_volatile(cid, "upstream_unavailable")
                cached = False
            status_code = 200
            if result["status"] == "invalid_cid":
                status_code = 400
            elif result["status"] in {"upstream_unavailable", "invalid_response"}:
                status_code = 502
            self.send_json(status_code, {**result, "cached": cached})
            return

        if parsed.path == "/flavordb2/compound-entities":
            if not cid.isdigit():
                self.send_json(400, {"found": False, "entities": [], "error": "Missing or invalid cid"})
                return
            cache_key = f"flavordb2:compound-entities:{cid}"
            try:
                if cache_key not in self.cache:
                    result = query_flavordb2_molecule_entities(cid)
                    _store_cache_result(self.cache, cache_key, result)
                self.send_json(200, {**self.cache[cache_key], "cached": True})
            except Exception as exc:
                self.send_json(502, {
                    "found": False,
                    "cid": cid,
                    "entities": [],
                    "cached": False,
                    "error": str(exc),
                })
            return

        if parsed.path == "/flavordb2/entities":
            entity_query = (params.get("q") or params.get("entity") or [""])[0].strip()
            if not entity_query:
                self.send_json(400, {"found": False, "entities": [], "error": "Missing entity query"})
                return
            cache_key = f"flavordb2:entities:{entity_query.lower()}"
            try:
                if cache_key not in self.cache:
                    result = query_flavordb2_entities(entity_query)
                    _store_cache_result(self.cache, cache_key, result)
                self.send_json(200, {**self.cache[cache_key], "cached": True})
            except Exception as exc:
                self.send_json(502, {
                    "found": False,
                    "query": entity_query,
                    "entities": [],
                    "cached": False,
                    "error": str(exc),
                })
            return

        if parsed.path == "/flavordb2/entity":
            entity_id = (params.get("id") or [""])[0].strip()
            if not entity_id.isdigit():
                self.send_json(400, {"found": False, "error": "Missing or invalid entity id"})
                return
            cache_key = f"flavordb2:entity:{entity_id}"
            try:
                if cache_key not in self.cache:
                    result = query_flavordb2_entity(entity_id)
                    _store_cache_result(self.cache, cache_key, result)
                self.send_json(200, {**self.cache[cache_key], "cached": True})
            except Exception as exc:
                self.send_json(502, {
                    "found": False,
                    "id": entity_id,
                    "cached": False,
                    "error": str(exc),
                })
            return

        if parsed.path == "/flavordb":
            if not cid:
                self.send_json(400, {"found": False, "error": "Missing cid"})
                return
            key = f"flavordb2:molecule:{cid}"
            if key not in self.cache:
                try:
                    self.cache[key] = query_flavordb(cid)
                    save_cache(self.cache)
                except Exception as exc:
                    self.send_json(502, {"found": False, "cid": cid, "error": str(exc)})
                    return
            self.send_json(200, {**self.cache[key], "cached": key in self.cache})
            return

        key = query.lower()
        if not query:
            self.send_json(400, {"found": False, "error": "Missing cas or q"})
            return

        if parsed.path in {"/pubchem", "/compound"}:
            pubchem_key = f"pubchem:{key}"
            try:
                if pubchem_key not in self.cache:
                    self.cache[pubchem_key] = query_pubchem(query)
                    save_cache(self.cache)
                pubchem = self.cache[pubchem_key]
                if parsed.path == "/pubchem":
                    self.send_json(200, {**pubchem, "cached": True})
                    return

                flavordb = {"found": False, "error": "PubChem CID unavailable"}
                flavordb2_entities = {"found": False, "entities": [], "error": "PubChem CID unavailable"}
                pubchem_volatile = {
                    **_empty_pubchem_volatile("", "invalid_cid"),
                    "cached": False,
                }
                if pubchem.get("found") and pubchem.get("cid"):
                    flavordb_key = f"flavordb2:molecule:{pubchem['cid']}"
                    if flavordb_key not in self.cache:
                        try:
                            self.cache[flavordb_key] = query_flavordb(pubchem["cid"])
                            save_cache(self.cache)
                        except Exception as exc:
                            self.cache.pop(flavordb_key, None)
                            flavordb = {
                                "found": False,
                                "cid": str(pubchem["cid"]),
                                "status": (
                                    "upstream_unavailable"
                                    if isinstance(exc, (TimeoutError, socket.timeout, URLError))
                                    else "error"
                                ),
                                "error": str(exc),
                            }
                    if flavordb_key in self.cache:
                        flavordb = self.cache[flavordb_key]
                    entities_key = f"flavordb2:compound-entities:{pubchem['cid']}"
                    if entities_key not in self.cache:
                        try:
                            self.cache[entities_key] = query_flavordb2_molecule_entities(pubchem["cid"])
                            save_cache(self.cache)
                        except Exception as exc:
                            self.cache.pop(entities_key, None)
                            flavordb2_entities = {
                                "found": False,
                                "cid": str(pubchem["cid"]),
                                "entities": [],
                                "status": (
                                    "upstream_unavailable"
                                    if isinstance(exc, (TimeoutError, socket.timeout, URLError))
                                    else "error"
                                ),
                                "error": str(exc),
                            }
                    if entities_key in self.cache:
                        flavordb2_entities = self.cache[entities_key]
                    try:
                        volatile_result, volatile_cached = _get_pubchem_volatile_cached(
                            self.cache, pubchem["cid"]
                        )
                    except (HTTPError, URLError, TimeoutError, socket.timeout):
                        volatile_result = _empty_pubchem_volatile(
                            pubchem["cid"], "upstream_unavailable"
                        )
                        volatile_cached = False
                    pubchem_volatile = {**volatile_result, "cached": volatile_cached}
                self.send_json(200, {
                    "query": query,
                    "pubchem": pubchem,
                    "flavordb": flavordb,
                    "flavordb2_entities": flavordb2_entities,
                    "pubchem_volatile": pubchem_volatile,
                })
            except Exception as exc:
                self.send_json(502, {"query": query, "pubchem": {"found": False}, "flavordb": {"found": False}, "error": str(exc)})
            return

        if key in self.cache:
            self.send_json(200, {**self.cache[key], "cached": True})
            return

        try:
            result = query_fema(query)
            self.cache[key] = result
            save_cache(self.cache)
            self.send_json(200, {**result, "cached": False})
        except Exception as exc:
            self.send_json(502, {"found": False, "query": query, "error": str(exc)})

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"FEMA proxy running at http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
