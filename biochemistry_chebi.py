"""Identity-safe ChEBI resolver backed by the official public search API."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from urllib.parse import quote
from urllib.request import Request, urlopen

from spectra_service import rank_identity_match


CHEBI_SEARCH_URL = "https://www.ebi.ac.uk/chebi/backend/api/public/es_search/?term={}"


def _fetch_json(url: str) -> dict:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "FlavorThresholdDB/1.3"})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def _candidate(source: dict) -> dict:
    return {
        "chebi_id": source.get("chebi_accession") or source.get("id") or "",
        "name": source.get("name") or "",
        "formula": source.get("formula") or "",
        "charge": source.get("charge"),
        "inchikey": source.get("inchikey") or "",
        "smiles": source.get("smiles") or "",
        "cas": source.get("cas") or "",
    }


def resolve_chebi(target: dict, fetch_json=None) -> dict:
    fetcher = fetch_json or _fetch_json
    names = [str(value).strip() for value in target.get("names", []) if str(value).strip()]
    term = str(target.get("inchikey") or target.get("cas") or (names[0] if names else "")).strip()
    if not term:
        return {"status": "invalid_query", "entity": None, "candidates": []}
    url = CHEBI_SEARCH_URL.format(quote(term))
    try:
        payload = fetcher(url)
    except Exception as exc:
        return {"status": "upstream_unavailable", "entity": None, "candidates": [], "error": str(exc), "source_url": url}
    results = payload.get("results", []) if isinstance(payload, dict) else []
    candidates = []
    for item in results if isinstance(results, list) else []:
        source = item.get("_source", item) if isinstance(item, dict) else {}
        candidate = _candidate(source)
        candidate["identity_match"] = rank_identity_match(target, candidate)
        candidate["source_url"] = f"https://www.ebi.ac.uk/chebi/searchId.do?chebiId={candidate['chebi_id']}"
        candidates.append(candidate)
    candidates.sort(key=lambda row: row["identity_match"].get("rank", 0), reverse=True)
    entity = candidates[0] if candidates else None
    status = "ok" if entity and entity["identity_match"].get("verified") else ("candidate" if entity else "no_data")
    return {"status": status, "entity": entity, "candidates": candidates, "source_url": url, "retrieved_at": datetime.now(timezone.utc).isoformat()}
