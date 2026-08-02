"""Identity-safe bioactivity aggregation across public scientific services."""

from __future__ import annotations

import json
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


USER_AGENT = "FlavorThresholdDB/1.4 (public scientific data integration)"


def _fetch_json(url: str):
    with urlopen(Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT}), timeout=35) as response:
        raw = response.read()
        return json.loads(raw) if raw.strip() else []


def parse_pubchem_assay_summary(payload: dict) -> list[dict]:
    table = payload.get("Table", {}) if isinstance(payload, dict) else {}
    columns = table.get("Columns", {}).get("Column", [])
    rows = []
    for raw in table.get("Row", []):
        record = dict(zip(columns, raw.get("Cell", [])))
        aid = str(record.get("AID") or "").strip()
        if not aid:
            continue
        rows.append({
            "aid": aid,
            "cid": str(record.get("CID") or ""),
            "outcome": record.get("Activity Outcome") or "",
            "target_accession": record.get("Target Accession") or "",
            "target_gene_id": str(record.get("Target GeneID") or ""),
            "activity_value_um": record.get("Activity Value [uM]") or "",
            "activity_name": record.get("Activity Name") or "",
            "assay_name": record.get("Assay Name") or "",
            "assay_type": record.get("Assay Type") or "",
            "pubmed_id": str(record.get("PubMed ID") or ""),
            "source_url": f"https://pubchem.ncbi.nlm.nih.gov/bioassay/{aid}",
        })
    return rows


def query_pubchem_bioassay(cid: int | str, fetch_json=None) -> dict:
    value = str(cid or "").strip()
    if not value.isdigit():
        return {"status": "invalid_query", "assays": [], "error": "numeric CID is required"}
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{value}/assaysummary/JSON"
    try:
        assays = parse_pubchem_assay_summary((fetch_json or _fetch_json)(url))
    except HTTPError as exc:
        if exc.code == 404:
            return {"status": "no_data", "assays": [], "source_url": url}
        return {"status": "upstream_unavailable", "assays": [], "error": str(exc), "source_url": url}
    except Exception as exc:
        return {"status": "upstream_unavailable", "assays": [], "error": str(exc), "source_url": url}
    return {"status": "ok" if assays else "no_data", "assays": assays[:100], "total": len(assays), "source_url": url}


def query_chembl(inchikey: str, fetch_json=None) -> dict:
    key = str(inchikey or "").strip().upper()
    if not key:
        return {"status": "invalid_query", "activities": [], "error": "InChIKey is required"}
    fetch = fetch_json or _fetch_json
    molecule_url = f"https://www.ebi.ac.uk/chembl/api/data/molecule.json?{urlencode({'molecule_structures__standard_inchi_key': key, 'limit': 5})}"
    try:
        molecules = fetch(molecule_url).get("molecules", [])
        exact = next((item for item in molecules if (item.get("molecule_structures") or {}).get("standard_inchi_key", "").upper() == key), None)
        if not exact:
            return {"status": "no_data", "activities": [], "source_url": molecule_url}
        chembl_id = exact.get("molecule_chembl_id")
        activity_url = f"https://www.ebi.ac.uk/chembl/api/data/activity.json?{urlencode({'molecule_chembl_id': chembl_id, 'limit': 100, 'order_by': '-standard_value'})}"
        payload = fetch(activity_url)
    except Exception as exc:
        return {"status": "upstream_unavailable", "activities": [], "error": str(exc), "source_url": molecule_url}
    activities = []
    for item in payload.get("activities", []):
        activity_id = item.get("activity_id")
        activities.append({
            "activity_id": activity_id,
            "molecule_id": chembl_id,
            "target_id": item.get("target_chembl_id") or "",
            "target_name": item.get("target_pref_name") or "",
            "assay_id": item.get("assay_chembl_id") or "",
            "type": item.get("standard_type") or item.get("type") or "",
            "relation": item.get("standard_relation") or item.get("relation") or "",
            "value": item.get("standard_value") or item.get("value") or "",
            "units": item.get("standard_units") or item.get("units") or "",
            "organism": item.get("target_organism") or "",
            "source_url": f"https://www.ebi.ac.uk/chembl/explore/activity/{activity_id}" if activity_id else f"https://www.ebi.ac.uk/chembl/explore/compound/{chembl_id}",
        })
    return {"status": "ok" if activities else "no_data", "molecule_id": chembl_id, "activities": activities, "total": payload.get("page_meta", {}).get("total_count", len(activities)), "source_url": f"https://www.ebi.ac.uk/chembl/explore/compound/{chembl_id}"}


def query_gtopdb(inchikey: str, cid: int | str = "", fetch_json=None) -> dict:
    key = str(inchikey or "").strip().upper()
    fetch = fetch_json or _fetch_json
    ligand_url = f"https://www.guidetopharmacology.org/services/ligands?{urlencode({'inchikey': key})}"
    try:
        ligands = fetch(ligand_url)
    except HTTPError as exc:
        if exc.code == 404:
            return {"status": "no_data", "interactions": [], "source_url": ligand_url}
        return {"status": "upstream_unavailable", "interactions": [], "error": str(exc), "source_url": ligand_url}
    except Exception as exc:
        return {"status": "upstream_unavailable", "interactions": [], "error": str(exc), "source_url": ligand_url}
    if isinstance(ligands, dict):
        ligands = [ligands]
    exact = next((item for item in ligands or [] if str(item.get("inchikey") or item.get("inChIKey") or "").upper() == key), None)
    if not exact and cid:
        cid_url = f"https://www.guidetopharmacology.org/services/ligands?{urlencode({'database': 'PubChemCID', 'accession': str(cid)})}"
        try:
            candidates = fetch(cid_url)
            if isinstance(candidates, dict):
                candidates = [candidates]
            exact = (candidates or [None])[0]
            ligand_url = cid_url
        except Exception:
            exact = None
    ligand_id = (exact or {}).get("ligandId") or (exact or {}).get("ligand_id")
    if not ligand_id:
        return {"status": "no_data", "interactions": [], "source_url": ligand_url}
    interactions_url = f"https://www.guidetopharmacology.org/services/ligands/{ligand_id}/interactions"
    try:
        raw = fetch(interactions_url)
    except Exception as exc:
        return {"status": "upstream_unavailable", "interactions": [], "error": str(exc), "source_url": interactions_url}
    interactions = []
    for item in raw if isinstance(raw, list) else []:
        interaction_id = item.get("interactionId") or item.get("interaction_id")
        interactions.append({
            "interaction_id": interaction_id,
            "ligand_id": ligand_id,
            "target_id": item.get("targetId"),
            "target_name": item.get("targetName") or "",
            "species": item.get("targetSpecies") or "",
            "action": item.get("action") or item.get("type") or "",
            "affinity": item.get("affinity") or "",
            "affinity_parameter": item.get("affinityParameter") or "",
            "source_url": f"https://www.guidetopharmacology.org/GRAC/InteractionDisplayForward?interactionId={interaction_id}" if interaction_id else f"https://www.guidetopharmacology.org/GRAC/LigandDisplayForward?ligandId={ligand_id}",
        })
    return {"status": "ok" if interactions else "no_data", "ligand_id": ligand_id, "interactions": interactions, "source_url": f"https://www.guidetopharmacology.org/GRAC/LigandDisplayForward?ligandId={ligand_id}", "license": "ODbL / CC BY-SA 4.0"}


def query_bindingdb(smiles: str, fetch_json=None) -> dict:
    structure = str(smiles or "").strip()
    if not structure:
        return {"status": "invalid_query", "interactions": [], "match_mode": "exact_structure", "error": "SMILES is required"}
    url = f"https://bindingdb.org/rest/getTargetByCompound?{urlencode({'smiles': structure, 'cutoff': '1.0', 'response': 'application/json'})}"
    try:
        payload = (fetch_json or _fetch_json)(url)
    except Exception as exc:
        return {"status": "upstream_unavailable", "interactions": [], "match_mode": "exact_structure", "error": str(exc), "source_url": url}
    if isinstance(payload, list):
        rows = payload
    else:
        rows = payload.get("affinities") or payload.get("getTargetByCompoundResponse") or payload.get("results") or [] if isinstance(payload, dict) else []
    if isinstance(rows, dict):
        rows = rows.get("affinity") or rows.get("results") or [rows]
    interactions = [{**row, "source_url": "https://www.bindingdb.org/rwd/bind/index.jsp"} for row in rows[:100] if isinstance(row, dict)]
    return {"status": "ok" if interactions else "no_data", "interactions": interactions, "match_mode": "exact_structure", "similarity_cutoff": 1.0, "source_url": url}


def resolve_bioactivity(target: dict, *, pubchem_query=query_pubchem_bioassay, chembl_query=query_chembl, gtopdb_query=query_gtopdb, bindingdb_query=query_bindingdb, cache=None) -> dict:
    def cached(source, key, loader):
        if cache:
            value = cache.get(source, str(key or ""))
            if value is not None:
                return value
        value = loader()
        if cache:
            cache.set(source, str(key or ""), value)
        return value
    pubchem = cached("PubChem BioAssay", target.get("cid"), lambda: pubchem_query(target.get("cid")))
    chembl = cached("ChEMBL", target.get("inchikey"), lambda: chembl_query(target.get("inchikey")))
    gtopdb = cached("GtoPdb", f"{target.get('inchikey', '')}|{target.get('cid', '')}", lambda: gtopdb_query(target.get("inchikey"), target.get("cid")))
    bindingdb = cached("BindingDB", target.get("smiles"), lambda: bindingdb_query(target.get("smiles")))
    return {
        "pubchem_assays": pubchem.get("assays", []),
        "chembl_activities": chembl.get("activities", []),
        "gtopdb_interactions": gtopdb.get("interactions", []),
        "bindingdb_interactions": bindingdb.get("interactions", []),
        "sources": {
            "PubChem BioAssay": {"status": pubchem.get("status", "unknown"), "total": pubchem.get("total", len(pubchem.get("assays", []))), "source_url": pubchem.get("source_url", "")},
            "ChEMBL": {"status": chembl.get("status", "unknown"), "total": chembl.get("total", len(chembl.get("activities", []))), "source_url": chembl.get("source_url", "")},
            "GtoPdb": {"status": gtopdb.get("status", "unknown"), "license": gtopdb.get("license", "ODbL / CC BY-SA 4.0"), "source_url": gtopdb.get("source_url", "")},
            "BindingDB": {"status": bindingdb.get("status", "unknown"), "match_mode": bindingdb.get("match_mode", "exact_structure"), "similarity_cutoff": bindingdb.get("similarity_cutoff", 1.0), "source_url": bindingdb.get("source_url", "")},
        },
    }
