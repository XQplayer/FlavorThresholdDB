"""Conservative ChEBI to Rhea to UniProt evidence-graph orchestration."""

from __future__ import annotations

from datetime import datetime, timezone

from biochemistry_chebi import resolve_chebi
from biochemistry_rhea import query_rhea
from biochemistry_uniprot import query_uniprot


def resolve_biochemistry(target: dict, chebi_resolver=resolve_chebi, rhea_query=query_rhea, uniprot_query=query_uniprot) -> dict:
    chebi = chebi_resolver(target)
    sources = {"ChEBI": {"status": chebi.get("status", "unknown"), "source_url": chebi.get("source_url", "")}, "Rhea": {"status": "not_requested"}, "UniProt": {"status": "not_requested"}}
    result = {"compound": target, "chebi": chebi.get("entity"), "reactions": [], "proteins": [], "edges": [], "sources": sources, "retrieved_at": datetime.now(timezone.utc).isoformat()}
    entity = chebi.get("entity") or {}
    if not (entity.get("identity_match") or {}).get("verified"):
        sources["Rhea"]["status"] = "blocked_unverified_identity"
        sources["UniProt"]["status"] = "blocked_unverified_identity"
        return result
    rhea = rhea_query(entity.get("chebi_id"))
    sources["Rhea"] = {"status": rhea.get("status", "unknown"), "source_url": rhea.get("source_url", "")}
    reactions = rhea.get("reactions", [])
    result["reactions"] = reactions
    for reaction in reactions:
        result["edges"].append({"from": entity.get("chebi_id"), "to": reaction["rhea_id"], "type": "participates_in"})
        proteins = uniprot_query(reaction["rhea_id"])
        sources["UniProt"] = {"status": proteins.get("status", "unknown"), "source_url": proteins.get("source_url", "")}
        for protein in proteins.get("proteins", []):
            if not any(item.get("accession") == protein.get("accession") for item in result["proteins"]):
                result["proteins"].append(protein)
            result["edges"].append({"from": reaction["rhea_id"], "to": protein.get("accession"), "type": "catalyzed_by"})
    if not reactions:
        sources["UniProt"]["status"] = "not_requested"
    return result
