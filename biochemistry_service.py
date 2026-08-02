"""Conservative ChEBI to Rhea to UniProt evidence-graph orchestration."""

from __future__ import annotations

from datetime import datetime, timezone

from biochemistry_chebi import resolve_chebi
from biochemistry_rhea import query_rhea
from biochemistry_uniprot import query_uniprot


def _target_key(target: dict) -> str:
    names = ",".join(str(name).strip().casefold() for name in target.get("names", []) if str(name).strip())
    return f"{str(target.get('inchikey') or '').strip().upper()}|{str(target.get('cas') or '').strip()}|{names}"


def _cached(cache, source: str, key: str, loader):
    if cache:
        value = cache.get(source, key)
        if value is not None:
            return value, True
    value = loader()
    if cache:
        cache.set(source, key, value)
    return value, False


def resolve_biochemistry(target: dict, chebi_resolver=resolve_chebi, rhea_query=query_rhea, uniprot_query=query_uniprot, cache=None) -> dict:
    chebi, chebi_cached = _cached(cache, "ChEBI", _target_key(target), lambda: chebi_resolver(target))
    sources = {"ChEBI": {"status": chebi.get("status", "unknown"), "source_url": chebi.get("source_url", "")}, "Rhea": {"status": "not_requested"}, "UniProt": {"status": "not_requested"}}
    sources["ChEBI"]["cached"] = chebi_cached
    result = {"compound": target, "chebi": chebi.get("entity"), "reactions": [], "proteins": [], "edges": [], "sources": sources, "retrieved_at": datetime.now(timezone.utc).isoformat()}
    entity = chebi.get("entity") or {}
    if not (entity.get("identity_match") or {}).get("verified"):
        sources["Rhea"]["status"] = "blocked_unverified_identity"
        sources["UniProt"]["status"] = "blocked_unverified_identity"
        return result
    rhea, rhea_cached = _cached(cache, "Rhea", entity.get("chebi_id"), lambda: rhea_query(entity.get("chebi_id")))
    sources["Rhea"] = {"status": rhea.get("status", "unknown"), "source_url": rhea.get("source_url", ""), "cached": rhea_cached}
    reactions = rhea.get("reactions", [])
    result["reactions"] = reactions
    for reaction in reactions:
        result["edges"].append({"from": entity.get("chebi_id"), "to": reaction["rhea_id"], "type": "participates_in"})
        proteins, proteins_cached = _cached(cache, "UniProt", reaction["rhea_id"], lambda: uniprot_query(reaction["rhea_id"]))
        source_status = sources["UniProt"].setdefault("requests", [])
        source_status.append({"rhea_id": reaction["rhea_id"], "status": proteins.get("status", "unknown"), "source_url": proteins.get("source_url", ""), "cached": proteins_cached})
        for protein in proteins.get("proteins", []):
            if not any(item.get("accession") == protein.get("accession") for item in result["proteins"]):
                result["proteins"].append(protein)
            result["edges"].append({"from": reaction["rhea_id"], "to": protein.get("accession"), "type": "catalyzed_by"})
    if not reactions:
        sources["UniProt"]["status"] = "not_requested"
    elif any(item["status"] == "ok" for item in sources["UniProt"].get("requests", [])):
        sources["UniProt"]["status"] = "ok"
    elif any(item["status"] in {"upstream_unavailable", "invalid_response"} for item in sources["UniProt"].get("requests", [])):
        sources["UniProt"]["status"] = "partial_failure"
    else:
        sources["UniProt"]["status"] = "no_data"
    return result
