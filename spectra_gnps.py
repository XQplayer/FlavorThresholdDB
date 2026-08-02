"""GNPS2 identity-index and single-spectrum adapters."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

from scripts.spectra.rebuild_gnps_index import DEFAULT_INDEX_PATH, query_gnps_index
from spectra_service import normalize_peaks, normalize_spectrum_record, rank_identity_match


GNPS_LIBRARY_URL = "https://library.gnps2.org"
GNPS_LEGACY_SPECTRUM_URL = "https://external.gnps2.org/gnpsspectrum"
GNPS_USI_URL = "https://metabolomics-usi.gnps2.org/json/"


def _fetch_json(url: str):
    with urlopen(url, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def _retrieved_at() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _text(value) -> str:
    return str(value or "").strip()


def _source_url(spectrum_id: str) -> str:
    if spectrum_id.upper().startswith("GNPS2LIB"):
        return f"{GNPS_LIBRARY_URL}/api/spectra/{quote(spectrum_id, safe='')}"
    return f"{GNPS_LEGACY_SPECTRUM_URL}?SpectrumID={quote(spectrum_id, safe='')}"


def _indexed_record(row: dict, target: dict) -> dict:
    candidate = {
        "inchikey": row.get("inchikey"),
        "smiles": row.get("smiles"),
        "name": row.get("compound_name"),
    }
    identity = rank_identity_match(target, candidate)
    record = normalize_spectrum_record(
        {
            "spectrum_id": row.get("spectrum_id"),
            "source": "GNPS",
            "source_url": _source_url(_text(row.get("spectrum_id"))),
            "license": row.get("license_status") or "needs_review",
            "retrieved_at": "",
            "compound_identity": {
                **candidate,
                "match_type": identity["type"],
                "match_rank": identity["rank"],
                "verified": identity["verified"],
            },
            "spectrum_type": "MS2",
            "ms_level": 2,
            "ion_mode": row.get("ion_mode"),
            "ionization": row.get("ion_source") or "unknown",
            "adduct": row.get("adduct"),
            "precursor_mz": row.get("precursor_mz"),
            "instrument": row.get("instrument"),
            "peaks": [],
        }
    )
    record.update(
        {
            "library_name": _text(row.get("library_name")),
            "license_status": _text(row.get("license_status")) or "needs_review",
            "detail_loaded": False,
        }
    )
    return record


def search_gnps_records(target: dict, index_path: Path | str = DEFAULT_INDEX_PATH) -> dict:
    path = Path(index_path)
    if not path.exists():
        return {"source": "GNPS", "status": "index_unavailable", "records": []}
    rows = query_gnps_index(path, inchikey=target.get("inchikey", ""))
    if not rows:
        for name in target.get("names", []):
            rows = query_gnps_index(path, name=name)
            if rows:
                break
    records = [_indexed_record(row, target) for row in rows]
    return {
        "source": "GNPS",
        "status": "ok" if records else "no_data",
        "records": records,
        "index_path": str(path.resolve()),
    }


def _parse_gnps2_detail(spectrum_id: str, payload: dict) -> dict:
    record = normalize_spectrum_record(
        {
            "spectrum_id": spectrum_id,
            "source": "GNPS",
            "source_url": _source_url(spectrum_id),
            "license": "needs_review",
            "retrieved_at": _retrieved_at(),
            "compound_identity": {
                "inchikey": payload.get("inchikey"),
                "smiles": payload.get("smiles"),
                "name": payload.get("compound_name"),
                "match_type": "source_record",
                "verified": False,
            },
            "spectrum_type": "MS2",
            "ms_level": payload.get("ms_level") or 2,
            "ion_mode": payload.get("ion_mode"),
            "ionization": payload.get("ion_source") or "unknown",
            "adduct": payload.get("adduct"),
            "precursor_mz": payload.get("precursor_mz"),
            "collision_energy": payload.get("collision_energy"),
            "instrument": payload.get("instrument"),
            "peaks": payload.get("peaks"),
        }
    )
    record.update(
        {
            "library_name": _text(payload.get("library")),
            "license_status": "needs_review",
            "detail_loaded": True,
        }
    )
    return record


def _parse_legacy_detail(spectrum_id: str, payload: dict) -> dict:
    annotations = payload.get("annotations") or []
    annotation = annotations[0] if annotations and isinstance(annotations[0], dict) else {}
    info = payload.get("spectruminfo") or {}
    try:
        peaks = json.loads(info.get("peaks_json") or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        peaks = []
    record = normalize_spectrum_record(
        {
            "spectrum_id": spectrum_id,
            "source": "GNPS",
            "source_url": _source_url(spectrum_id),
            "license": "needs_review",
            "retrieved_at": _retrieved_at(),
            "compound_identity": {
                "cas": annotation.get("CAS_Number"),
                "smiles": annotation.get("Smiles"),
                "name": annotation.get("Compound_Name"),
                "match_type": "source_record",
                "verified": False,
            },
            "spectrum_type": "MS2",
            "ms_level": info.get("ms_level") or 2,
            "ion_mode": annotation.get("Ion_Mode"),
            "ionization": annotation.get("Ion_Source") or "unknown",
            "adduct": annotation.get("Adduct"),
            "precursor_mz": annotation.get("Precursor_MZ"),
            "instrument": annotation.get("Instrument"),
            "peaks": peaks,
        }
    )
    record.update(
        {
            "library_name": _text(info.get("library_membership")),
            "license_status": "needs_review",
            "detail_loaded": True,
        }
    )
    return record


def fetch_gnps_spectrum(spectrum_id: str, fetch_json=None) -> dict:
    identifier = _text(spectrum_id)
    if not identifier:
        raise ValueError("spectrum_id is required")
    fetcher = fetch_json or _fetch_json
    if identifier.upper().startswith("GNPS2LIB"):
        payload = fetcher(f"{GNPS_LIBRARY_URL}/api/spectra/{quote(identifier, safe='')}")
        if not isinstance(payload, dict):
            raise ValueError("invalid GNPS2 spectrum response")
        return _parse_gnps2_detail(identifier, payload)
    payload = fetcher(f"{GNPS_LEGACY_SPECTRUM_URL}?SpectrumID={quote(identifier, safe='')}")
    if not isinstance(payload, dict):
        raise ValueError("invalid GNPS spectrum response")
    return _parse_legacy_detail(identifier, payload)


def fetch_gnps_usi(usi: str, fetch_json=None) -> dict:
    identifier = _text(usi)
    if not identifier:
        raise ValueError("usi is required")
    fetcher = fetch_json or _fetch_json
    payload = fetcher(f"{GNPS_USI_URL}?usi1={quote(identifier, safe='')}")
    if not isinstance(payload, dict):
        raise ValueError("invalid GNPS USI response")
    peaks = normalize_peaks(payload.get("peaks"))
    return {
        "usi": identifier,
        "n_peaks": len(peaks),
        "peaks": peaks,
        "precursor_charge": payload.get("precursor_charge"),
        "precursor_mz": payload.get("precursor_mz"),
        "splash": _text(payload.get("splash")),
        "source_url": f"{GNPS_USI_URL}?usi1={quote(identifier, safe='')}",
        "retrieved_at": _retrieved_at(),
    }
