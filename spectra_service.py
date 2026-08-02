"""Shared normalization and identity rules for public mass spectra."""

from __future__ import annotations

from collections.abc import Iterable
import csv
import io
import json
from math import isfinite
from math import sqrt
import re


EMPTY_MATCH = {"type": "none", "rank": 0, "verified": False}


def _clean_text(value) -> str:
    return str(value or "").strip()


def _normalized_name(value) -> str:
    return re.sub(r"\s+", " ", _clean_text(value)).casefold()


def _normalized_cas(value) -> str:
    return re.sub(r"\s+", "", _clean_text(value))


def _normalized_smiles(value) -> str:
    return re.sub(r"\s+", "", _clean_text(value))


def _inchikey(value) -> str:
    candidate = _clean_text(value).upper()
    return candidate if re.fullmatch(r"[A-Z]{14}-[A-Z]{10}-[A-Z]", candidate) else ""


def rank_identity_match(target: dict, candidate: dict) -> dict:
    """Rank explicit identity evidence without treating a name as verified."""
    target_key = _inchikey(target.get("inchikey"))
    candidate_key = _inchikey(candidate.get("inchikey"))
    if target_key and candidate_key:
        if target_key == candidate_key:
            return {"type": "inchikey_exact", "rank": 5, "verified": True}
        if target_key[:14] == candidate_key[:14]:
            return {"type": "inchikey_connectivity", "rank": 4, "verified": True}

    target_cas = _normalized_cas(target.get("cas"))
    candidate_cas = _normalized_cas(candidate.get("cas"))
    if target_cas and candidate_cas and target_cas == candidate_cas:
        return {"type": "cas_exact", "rank": 3, "verified": True}

    target_smiles = _normalized_smiles(target.get("smiles"))
    candidate_smiles = _normalized_smiles(candidate.get("smiles"))
    if target_smiles and candidate_smiles and target_smiles == candidate_smiles:
        return {"type": "smiles_exact", "rank": 2, "verified": True}

    target_names = {_normalized_name(name) for name in target.get("names", []) if _normalized_name(name)}
    candidate_name = _normalized_name(candidate.get("name"))
    if candidate_name and candidate_name in target_names:
        return {"type": "name_exact", "rank": 1, "verified": False}
    return dict(EMPTY_MATCH)


def _finite_number(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if isfinite(number) else None


def normalize_peaks(peaks: Iterable | None) -> list[list[float]]:
    """Validate, merge duplicate m/z values, sort, and base-peak normalize."""
    merged: dict[float, float] = {}
    for peak in peaks or []:
        if not isinstance(peak, (list, tuple)) or len(peak) < 2:
            continue
        mz = _finite_number(peak[0])
        intensity = _finite_number(peak[1])
        if mz is None or intensity is None or mz < 0 or intensity <= 0:
            continue
        merged[mz] = merged.get(mz, 0.0) + intensity
    if not merged:
        return []
    base_peak = max(merged.values())
    return [[mz, round(intensity / base_peak * 100, 6)] for mz, intensity in sorted(merged.items())]


def _normalized_ion_mode(value) -> str:
    mode = _normalized_name(value)
    if mode in {"positive", "pos", "+"}:
        return "positive"
    if mode in {"negative", "neg", "-"}:
        return "negative"
    return "unknown"


def _normalized_adduct(value, ion_mode: str) -> str:
    adduct = re.sub(r"\s+", "", _clean_text(value))
    if not adduct:
        return ""
    if not adduct.startswith("["):
        adduct = f"[{adduct}]"
    if adduct[-1] == "]":
        if ion_mode == "positive":
            adduct += "+"
        elif ion_mode == "negative":
            adduct += "-"
    return adduct


def normalize_spectrum_record(raw: dict) -> dict:
    """Convert one adapter record into the stable public-spectrum contract."""
    ion_mode = _normalized_ion_mode(raw.get("ion_mode"))
    precursor_mz = _finite_number(raw.get("precursor_mz"))
    try:
        ms_level = int(raw.get("ms_level") or 0)
    except (TypeError, ValueError):
        ms_level = 0
    return {
        "spectrum_id": _clean_text(raw.get("spectrum_id")),
        "source": _clean_text(raw.get("source")),
        "source_url": _clean_text(raw.get("source_url")),
        "license": _clean_text(raw.get("license")) or "unknown",
        "retrieved_at": _clean_text(raw.get("retrieved_at")),
        "compound_identity": dict(raw.get("compound_identity") or {}),
        "spectrum_type": _clean_text(raw.get("spectrum_type")).upper() or "UNKNOWN",
        "ms_level": ms_level,
        "ion_mode": ion_mode,
        "ionization": _clean_text(raw.get("ionization")).upper() or "unknown",
        "adduct": _normalized_adduct(raw.get("adduct"), ion_mode),
        "precursor_mz": precursor_mz,
        "collision_energy": _clean_text(raw.get("collision_energy")),
        "instrument": _clean_text(raw.get("instrument")),
        "peaks": normalize_peaks(raw.get("peaks")),
    }


def _spectrum_family(record: dict) -> str:
    spectrum_type = _clean_text(record.get("spectrum_type")).upper()
    if spectrum_type == "EI" or _clean_text(record.get("ionization")).upper() == "EI":
        return "EI"
    if spectrum_type in {"MS2", "MS/MS", "MSMS"} or record.get("ms_level") == 2:
        return "MS2"
    return spectrum_type or "UNKNOWN"


def assess_compatibility(spectrum_a: dict, spectrum_b: dict) -> dict:
    """Describe whether a similarity score is meaningful for two spectra."""
    family_a = _spectrum_family(spectrum_a)
    family_b = _spectrum_family(spectrum_b)
    blocking_reasons = []
    warnings = []
    if family_a != family_b or family_a not in {"EI", "MS2"}:
        blocking_reasons.append("spectrum_type")
    if family_a == family_b == "MS2":
        for field in ("ion_mode", "adduct", "precursor_mz", "collision_energy"):
            value_a = spectrum_a.get(field)
            value_b = spectrum_b.get(field)
            if value_a not in (None, "", "unknown") and value_b not in (None, "", "unknown") and value_a != value_b:
                warnings.append(field)
    return {
        "comparable": not blocking_reasons,
        "family_a": family_a,
        "family_b": family_b,
        "blocking_reasons": blocking_reasons,
        "warnings": warnings,
    }


def match_peaks(peaks_a: list, peaks_b: list, tolerance: float = 0.1) -> list[dict]:
    """Greedily select the closest one-to-one peak pairs within a Da tolerance."""
    if tolerance < 0:
        raise ValueError("tolerance must be non-negative")
    candidates = []
    for a_index, peak_a in enumerate(peaks_a):
        for b_index, peak_b in enumerate(peaks_b):
            delta = abs(float(peak_a[0]) - float(peak_b[0]))
            if delta <= tolerance + 1e-12:
                candidates.append((delta, -min(float(peak_a[1]), float(peak_b[1])), a_index, b_index))
    used_a = set()
    used_b = set()
    matches = []
    for delta, _, a_index, b_index in sorted(candidates):
        if a_index in used_a or b_index in used_b:
            continue
        used_a.add(a_index)
        used_b.add(b_index)
        matches.append(
            {
                "a_index": a_index,
                "b_index": b_index,
                "mz_a": float(peaks_a[a_index][0]),
                "mz_b": float(peaks_b[b_index][0]),
                "intensity_a": float(peaks_a[a_index][1]),
                "intensity_b": float(peaks_b[b_index][1]),
                "delta_da": round(delta, 8),
            }
        )
    return sorted(matches, key=lambda item: (item["mz_a"], item["mz_b"]))


def compare_spectra(spectrum_a: dict, spectrum_b: dict, tolerance: float = 0.1) -> dict:
    """Return transparent cosine and peak-coverage metrics for compatible spectra."""
    compatibility = assess_compatibility(spectrum_a, spectrum_b)
    if not compatibility["comparable"]:
        return {
            "compatibility": compatibility,
            "tolerance_da": tolerance,
            "similarity": None,
            "matched_peak_count": 0,
            "coverage_a": 0.0,
            "coverage_b": 0.0,
            "matches": [],
        }
    peaks_a = normalize_peaks(spectrum_a.get("peaks"))
    peaks_b = normalize_peaks(spectrum_b.get("peaks"))
    matches = match_peaks(peaks_a, peaks_b, tolerance)
    norm_a = sqrt(sum(float(peak[1]) ** 2 for peak in peaks_a))
    norm_b = sqrt(sum(float(peak[1]) ** 2 for peak in peaks_b))
    dot_product = sum(match["intensity_a"] * match["intensity_b"] for match in matches)
    similarity = dot_product / (norm_a * norm_b) if norm_a and norm_b else 0.0
    return {
        "compatibility": compatibility,
        "tolerance_da": tolerance,
        "similarity": round(similarity, 6),
        "matched_peak_count": len(matches),
        "coverage_a": round(len(matches) / len(peaks_a), 6) if peaks_a else 0.0,
        "coverage_b": round(len(matches) / len(peaks_b), 6) if peaks_b else 0.0,
        "matches": matches,
    }


def license_policy(record: dict) -> dict:
    license_text = _clean_text(record.get("license"))
    status = _clean_text(record.get("license_status")).casefold()
    normalized = license_text.casefold()
    allowed = status not in {"needs_review", "restricted", "link_only"} and (
        normalized.startswith("cc ")
        or normalized.startswith("cc0")
        or normalized in {"public domain", "pddl"}
    )
    return {
        "download_allowed": allowed,
        "attribution_required": allowed and not (normalized.startswith("cc0") or normalized == "public domain"),
        "license": license_text or "unknown",
        "status": status or ("permitted" if allowed else "needs_review"),
    }


def serialize_spectrum(record: dict, output_format: str) -> tuple[str, str, str]:
    policy = license_policy(record)
    if not policy["download_allowed"]:
        raise PermissionError("spectrum license does not permit proxy download")
    output = _clean_text(output_format).casefold()
    peaks = record.get("peaks") or []
    name = _clean_text((record.get("compound_identity") or {}).get("name")) or record.get("spectrum_id", "Spectrum")
    if output == "json":
        payload = {**record, "license_policy": policy}
        return json.dumps(payload, ensure_ascii=False, indent=2), "application/json; charset=utf-8", "json"
    if output == "csv":
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow(["source", record.get("source", "")])
        writer.writerow(["spectrum_id", record.get("spectrum_id", "")])
        writer.writerow(["source_url", record.get("source_url", "")])
        writer.writerow(["license", policy["license"]])
        writer.writerow(["retrieved_at", record.get("retrieved_at", "")])
        writer.writerow([])
        writer.writerow(["mz", "relative_intensity"])
        writer.writerows(peaks)
        return stream.getvalue(), "text/csv; charset=utf-8", "csv"
    if output == "msp":
        lines = [
            f"Name: {name}",
            f"DB#: {record.get('spectrum_id', '')}",
            f"Source: {record.get('source', '')}",
            f"Source URL: {record.get('source_url', '')}",
            f"License: {policy['license']}",
            f"Num Peaks: {len(peaks)}",
        ]
        lines.extend(f"{mz} {intensity}" for mz, intensity in peaks)
        return "\n".join(lines) + "\n", "chemical/x-msp; charset=utf-8", "msp"
    if output == "mgf":
        identity = record.get("compound_identity") or {}
        lines = [
            "BEGIN IONS",
            f"TITLE={name}",
            f"SPECTRUMID={record.get('spectrum_id', '')}",
            f"SOURCE={record.get('source', '')}",
            f"SOURCE_URL={record.get('source_url', '')}",
            f"LICENSE={policy['license']}",
        ]
        if record.get("precursor_mz") is not None:
            lines.append(f"PEPMASS={record['precursor_mz']}")
        if record.get("ion_mode"):
            lines.append(f"IONMODE={record['ion_mode']}")
        if identity.get("smiles"):
            lines.append(f"SMILES={identity['smiles']}")
        lines.extend(f"{mz} {intensity}" for mz, intensity in peaks)
        lines.append("END IONS")
        return "\n".join(lines) + "\n", "chemical/x-mgf; charset=utf-8", "mgf"
    raise ValueError("unsupported spectrum export format")
