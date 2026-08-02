"""Rhea TSV adapter using stable ChEBI and Rhea identifiers."""

from __future__ import annotations

import csv
import io
from urllib.parse import urlencode
from urllib.request import Request, urlopen


RHEA_BASE_URL = "https://www.rhea-db.org/rhea/"


def _split(value: str) -> list[str]:
    return [part.strip() for part in (value or "").split(";") if part.strip()]


def parse_rhea_tsv(text: str) -> list[dict]:
    if not text or text.lstrip().lower().startswith("<!doctype html") or text.lstrip().lower().startswith("<html"):
        return []
    rows = []
    for raw in csv.DictReader(io.StringIO(text), delimiter="\t"):
        rhea_id = (raw.get("Reaction identifier") or raw.get("Rhea ID") or raw.get("rhea-id") or "").strip()
        if not rhea_id:
            continue
        rows.append({
            "rhea_id": rhea_id,
            "equation": (raw.get("Equation") or raw.get("equation") or "").strip(),
            "chebi_ids": _split(raw.get("ChEBI identifier") or raw.get("chebi-id") or ""),
            "ec_numbers": [value.removeprefix("EC ").strip() for value in _split(raw.get("EC number") or raw.get("ec") or "")],
            "enzyme_count": (raw.get("Enzymes") or raw.get("uniprot") or "").strip(),
            "source_url": f"https://www.rhea-db.org/rhea/{rhea_id.removeprefix('RHEA:')}",
        })
    return rows


def query_rhea(chebi_id: str, fetch_text=None) -> dict:
    numeric = str(chebi_id).upper().removeprefix("CHEBI:")
    params = urlencode({"query": f"chebi_exact:{numeric}", "columns": "rhea-id,equation,chebi-id,ec,uniprot", "format": "tsv", "limit": 100})
    url = f"{RHEA_BASE_URL}?{params}"
    try:
        if fetch_text:
            text = fetch_text(url)
        else:
            with urlopen(Request(url, headers={"Accept": "text/tab-separated-values", "User-Agent": "FlavorThresholdDB/1.3"}), timeout=25) as response:
                text = response.read().decode("utf-8")
    except Exception as exc:
        return {"status": "upstream_unavailable", "reactions": [], "error": str(exc), "source_url": url}
    if text.lstrip().lower().startswith(("<html", "<!doctype html")):
        return {"status": "invalid_response", "reactions": [], "source_url": url}
    reactions = parse_rhea_tsv(text)
    return {"status": "ok" if reactions else "no_data", "reactions": reactions, "source_url": url}
