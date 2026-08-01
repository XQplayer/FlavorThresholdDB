from __future__ import annotations

import html
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8787"))
BASE_URL = "https://www.femaflavor.org"
PUBCHEM_BASE_URL = "https://pubchem.ncbi.nlm.nih.gov"
FLAVORDB_BASE_URL = "https://cosylab.iiitd.edu.in/flavordb"
CACHE_PATH = Path(__file__).resolve().with_name("fema_flavor_cache.json")


def load_cache() -> dict[str, dict]:
    if not CACHE_PATH.exists():
        return {}
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(cache: dict[str, dict]) -> None:
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=25) as resp:
        return resp.read().decode("utf-8", errors="replace")


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
    "atm-cu m/mole": "atm·m³/mol",
    "mg/l": "mg/L",
    "°c": "°C",
}


def parse_pubchem_property_text(raw_value: str) -> dict:
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

    state_matches = re.findall(r"\b(liquid|solid|gas)\b", text, re.I)
    has_state_negation = re.search(r"\b(?:not|no|without)\b|\bnon[- ]", text, re.I)
    if len(state_matches) == 1 and not has_state_negation:
        result["normalized_value"] = state_matches[0].lower()
        return result
    if state_matches:
        return result

    temperature = re.search(r"(-?\d+(?:\.\d+)?)\s*°\s*C\b", text, re.I)
    if temperature:
        result["temperature"] = f"{temperature.group(1)} °C"

    medium = re.search(r"\b(?:in|soluble in)\s+(water)\b", text, re.I)
    if medium:
        result["medium"] = medium.group(1).lower()

    number_pattern = r"[+-]?\d+(?:\.\d+)?(?:\s*[x×]\s*10[+-]?\d+)?"
    aliases = sorted(PUBCHEM_PROPERTY_UNIT_ALIASES, key=len, reverse=True)
    unit_pattern = "|".join(re.escape(alias) for alias in aliases if alias != "°c")
    value_match = re.search(
        rf"(?P<number>{number_pattern})\s*(?P<unit>{unit_pattern})(?![A-Za-z])",
        text,
        re.I,
    )
    if not value_match:
        return result

    normalized_number = re.sub(r"\s*[x×]\s*10", "e", value_match.group("number"), flags=re.I)
    try:
        result["normalized_value"] = float(normalized_number)
    except ValueError:
        return result
    result["unit"] = PUBCHEM_PROPERTY_UNIT_ALIASES[value_match.group("unit").lower()]

    pressure_condition = re.search(
        rf"\bat\s+({number_pattern})\s*(mm\s*hg|mmhg|atm)\b",
        text,
        re.I,
    )
    if pressure_condition:
        pressure_unit = pressure_condition.group(2).lower().replace(" ", "")
        pressure_unit = "mmHg" if pressure_unit == "mmhg" else "atm"
        result["pressure"] = f"{pressure_condition.group(1)} {pressure_unit}"
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


def _parse_pubchem_volatile_record(information: dict, references: dict) -> list[dict]:
    reference_number = information.get("ReferenceNumber")
    reference = references.get(reference_number, {})
    records = []
    for raw_value in _pubchem_information_strings(information):
        record = {
            "raw_value": raw_value,
            "reference_number": reference_number,
            "source": reference.get("SourceName", ""),
        }
        record.update(parse_pubchem_property_text(raw_value))
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
                    parsed.extend(_parse_pubchem_volatile_record(information, references))
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
        "source": "FlavorDB",
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
        if parsed.path not in {"/fema", "/pubchem", "/flavordb", "/compound"}:
            self.send_json(404, {"error": "Not found"})
            return

        params = parse_qs(parsed.query)
        query = (params.get("cas") or params.get("q") or [""])[0].strip()
        cid = (params.get("cid") or [""])[0].strip()

        if parsed.path == "/flavordb":
            if not cid:
                self.send_json(400, {"found": False, "error": "Missing cid"})
                return
            key = f"flavordb:{cid}"
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
                if pubchem.get("found") and pubchem.get("cid"):
                    flavordb_key = f"flavordb:{pubchem['cid']}"
                    if flavordb_key not in self.cache:
                        self.cache[flavordb_key] = query_flavordb(pubchem["cid"])
                        save_cache(self.cache)
                    flavordb = self.cache[flavordb_key]
                self.send_json(200, {"query": query, "pubchem": pubchem, "flavordb": flavordb})
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
