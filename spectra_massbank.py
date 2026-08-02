"""MassBank Europe adapter for the shared public-spectrum contract."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from urllib.parse import quote
from urllib.request import urlopen

from spectra_service import normalize_spectrum_record, rank_identity_match


MASSBANK_API_URL = "https://massbank.eu/MassBank-api"


def _fetch_json(url: str):
    with urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _database_identifier(links, database: str) -> str:
    wanted = database.casefold()
    for link in links or []:
        if str(link.get("database", "")).casefold() == wanted:
            return str(link.get("identifier", "")).strip()
    return ""


def _subtag_value(subtags, name: str) -> str:
    wanted = name.casefold()
    for item in subtags or []:
        if str(item.get("subtag", "")).casefold() == wanted:
            return str(item.get("value", "")).strip()
    return ""


def _massbank_peaks(record: dict) -> list[list[float]]:
    values = (((record.get("peak") or {}).get("peak") or {}).get("values") or [])
    return [[item.get("mz"), item.get("intensity", item.get("rel"))] for item in values]


def parse_massbank_record(record: dict, target: dict, retrieved_at: str) -> dict:
    compound = record.get("compound") or {}
    acquisition = record.get("acquisition") or {}
    acquisition_ms = acquisition.get("mass_spectrometry") or {}
    record_ms = record.get("mass_spectrometry") or {}
    instrument_type = str(acquisition.get("instrument_type") or "")
    ms_type = str(acquisition_ms.get("ms_type") or "").upper()
    ionization = instrument_type.split("-")[0].upper() if instrument_type else "unknown"
    spectrum_type = "EI" if ionization == "EI" else ("MS2" if ms_type == "MS2" else ms_type)
    candidate = {
        "inchikey": _database_identifier(compound.get("link"), "INCHIKEY"),
        "cas": _database_identifier(compound.get("link"), "CAS"),
        "smiles": compound.get("smiles"),
        "name": (compound.get("names") or [""])[0],
    }
    identity_match = rank_identity_match(target, candidate)
    accession = str(record.get("accession") or "").strip()
    return normalize_spectrum_record(
        {
            "spectrum_id": accession,
            "source": "MassBank",
            "source_url": f"{MASSBANK_API_URL}/records/{quote(accession, safe='')}" if accession else "",
            "license": record.get("license") or "unknown",
            "retrieved_at": retrieved_at,
            "compound_identity": {
                **candidate,
                "match_type": identity_match["type"],
                "match_rank": identity_match["rank"],
                "verified": identity_match["verified"],
            },
            "spectrum_type": spectrum_type,
            "ms_level": 2 if ms_type == "MS2" else 1,
            "ion_mode": acquisition_ms.get("ion_mode"),
            "ionization": ionization,
            "adduct": _subtag_value(record_ms.get("focused_ion"), "ION_TYPE"),
            "collision_energy": _subtag_value(acquisition_ms.get("subtags"), "COLLISION_ENERGY")
            or _subtag_value(acquisition_ms.get("subtags"), "IONIZATION_ENERGY"),
            "instrument": acquisition.get("instrument"),
            "peaks": _massbank_peaks(record),
        }
    )


def query_massbank_records(target: dict, fetch_json=None) -> dict:
    inchikey = str(target.get("inchikey") or "").strip().upper()
    if not inchikey:
        return {"source": "MassBank", "status": "identity_required", "records": []}
    fetcher = fetch_json or _fetch_json
    url = f"{MASSBANK_API_URL}/records?inchi_key={quote(inchikey, safe='-')}"
    try:
        payload = fetcher(url)
    except (OSError, TimeoutError, ValueError):
        return {"source": "MassBank", "status": "upstream_unavailable", "records": []}
    if not isinstance(payload, list):
        return {"source": "MassBank", "status": "invalid_response", "records": []}
    retrieved_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "source": "MassBank",
        "status": "ok" if payload else "no_data",
        "records": [parse_massbank_record(record, target, retrieved_at) for record in payload if isinstance(record, dict)],
        "retrieved_at": retrieved_at,
    }


def fetch_massbank_record(accession: str, target: dict | None = None, fetch_json=None) -> dict:
    identifier = str(accession or "").strip()
    if not identifier:
        raise ValueError("accession is required")
    fetcher = fetch_json or _fetch_json
    payload = fetcher(f"{MASSBANK_API_URL}/records/{quote(identifier, safe='-_')}")
    if not isinstance(payload, dict):
        raise ValueError("invalid MassBank record response")
    return parse_massbank_record(payload, target or {}, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
