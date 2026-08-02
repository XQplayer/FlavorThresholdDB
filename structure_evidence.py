"""Protein structure evidence from RCSB PDB, AlphaFold DB, and GPCRdb."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.error import HTTPError
from urllib.request import Request, urlopen


USER_AGENT = "FlavorThresholdDB/1.4 (public scientific data integration)"


def _fetch_json(url):
    with urlopen(Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT}), timeout=30) as response:
        return json.load(response)


def _post_json(url, body):
    request = Request(url, data=json.dumps(body).encode("utf-8"), headers={"Accept": "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT}, method="POST")
    with urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw.strip() else {"result_set": []}


def query_alphafold(accession, fetch_json=None):
    accession = str(accession or "").strip().upper()
    url = f"https://alphafold.ebi.ac.uk/api/prediction/{accession}"
    try:
        payload = (fetch_json or _fetch_json)(url)
    except HTTPError as exc:
        if exc.code == 404:
            return {"status": "no_data", "models": [], "source_url": url}
        return {"status": "upstream_unavailable", "models": [], "error": str(exc), "source_url": url}
    except Exception as exc:
        return {"status": "upstream_unavailable", "models": [], "error": str(exc), "source_url": url}
    models = []
    for item in payload if isinstance(payload, list) else []:
        model_id = item.get("modelEntityId") or ""
        models.append({"model_id": model_id, "accession": accession, "evidence_type": "predicted_structure", "global_plddt": item.get("globalMetricValue"), "version": item.get("latestVersion"), "pdb_url": item.get("pdbUrl") or "", "cif_url": item.get("cifUrl") or "", "source_url": f"https://alphafold.ebi.ac.uk/entry/{model_id}"})
    return {"status": "ok" if models else "no_data", "models": models, "source_url": url}


def query_gpcrdb(accession, fetch_json=None):
    accession = str(accession or "").strip().upper()
    url = f"https://gpcrdb.org/services/protein/accession/{accession}/"
    try:
        item = (fetch_json or _fetch_json)(url)
    except HTTPError as exc:
        if exc.code == 404:
            return {"status": "no_data", "protein": None, "source_url": url}
        return {"status": "upstream_unavailable", "protein": None, "error": str(exc), "source_url": url}
    except Exception as exc:
        return {"status": "upstream_unavailable", "protein": None, "error": str(exc), "source_url": url}
    if str(item.get("accession") or "").upper() != accession:
        return {"status": "no_data", "protein": None, "source_url": url}
    protein = {"accession": accession, "entry_name": item.get("entry_name") or "", "name": item.get("name") or "", "family": item.get("family") or "", "species": item.get("species") or "", "source_url": f"https://gpcrdb.org/protein/{item.get('entry_name')}/"}
    return {"status": "ok", "protein": protein, "source_url": url}


def query_rcsb(accession, post_json=None):
    accession = str(accession or "").strip().upper()
    url = "https://search.rcsb.org/rcsbsearch/v2/query"
    body = {"query": {"type": "terminal", "service": "text", "parameters": {"attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession", "operator": "exact_match", "value": accession}}, "return_type": "polymer_entity", "request_options": {"paginate": {"start": 0, "rows": 100}}}
    try:
        payload = (post_json or _post_json)(url, body)
    except HTTPError as exc:
        if exc.code == 404:
            return {"status": "no_data", "structures": [], "source_url": url}
        return {"status": "upstream_unavailable", "structures": [], "error": str(exc), "source_url": url}
    except Exception as exc:
        return {"status": "upstream_unavailable", "structures": [], "error": str(exc), "source_url": url}
    structures, seen = [], set()
    for item in payload.get("result_set", []):
        pdb_id = str(item.get("identifier") or "").split("_")[0].upper()
        if pdb_id and pdb_id not in seen:
            seen.add(pdb_id)
            structures.append({"pdb_id": pdb_id, "accession": accession, "evidence_type": "experimental_structure", "source_url": f"https://www.rcsb.org/structure/{pdb_id}", "download_url": f"https://files.rcsb.org/download/{pdb_id}.cif"})
    return {"status": "ok" if structures else "no_data", "structures": structures, "source_url": url}


def resolve_structure_evidence(biochemistry, *, rcsb_query=query_rcsb, alphafold_query=query_alphafold, gpcrdb_query=query_gpcrdb, cache=None):
    experimental, predicted, gpcrs, requests = [], [], [], {"RCSB PDB": [], "AlphaFold DB": [], "GPCRdb": []}
    accessions = list(dict.fromkeys(str(item.get("accession") or "").strip().upper() for item in biochemistry.get("proteins", []) if item.get("accession")))[:25]
    def cached(source, accession, loader):
        if cache:
            value = cache.get(source, accession)
            if value is not None:
                return value
        value = loader()
        if cache:
            cache.set(source, accession, value)
        return value
    def load_accession(accession):
        rcsb = cached("RCSB PDB", accession, lambda accession=accession: rcsb_query(accession))
        alpha = cached("AlphaFold DB", accession, lambda accession=accession: alphafold_query(accession))
        gpcr = cached("GPCRdb", accession, lambda accession=accession: gpcrdb_query(accession))
        return accession, rcsb, alpha, gpcr
    loaded = []
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = [executor.submit(load_accession, accession) for accession in accessions]
        for future in as_completed(futures):
            loaded.append(future.result())
    for accession, rcsb, alpha, gpcr in sorted(loaded, key=lambda item: accessions.index(item[0])):
        experimental.extend(rcsb.get("structures", [])); predicted.extend(alpha.get("models", []))
        if gpcr.get("protein"): gpcrs.append(gpcr["protein"])
        for name, result in (("RCSB PDB", rcsb), ("AlphaFold DB", alpha), ("GPCRdb", gpcr)):
            requests[name].append({"accession": accession, "status": result.get("status", "unknown")})
    def status(rows):
        states = {row["status"] for row in rows}
        if "ok" in states: return "ok" if states <= {"ok", "no_data"} else "partial_failure"
        if "upstream_unavailable" in states: return "upstream_unavailable"
        return "no_data" if rows else "not_requested"
    return {"experimental_structures": experimental, "predicted_models": predicted, "gpcr_proteins": gpcrs, "sources": {name: {"status": status(rows), "requests": rows} for name, rows in requests.items()}}
