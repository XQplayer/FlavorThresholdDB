"""Evidence-bound biological context adapters for public scientific resources."""

from __future__ import annotations

import json
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


NCBI_EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
EBI_SEARCH = "https://www.ebi.ac.uk/ebisearch/ws/rest/metabolights"
USER_AGENT = "FlavorThresholdDB/1.4 (public scientific data integration)"


def _fetch_json(url: str) -> dict:
    with urlopen(Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT}), timeout=25) as response:
        return json.load(response)


def _source_result(status: str, **values) -> dict:
    return {"status": status, **values}


def query_ncbi_gene(gene_name: str, taxon_id: int | str, fetch_json=None) -> dict:
    gene_name = str(gene_name or "").strip()
    taxon_id = str(taxon_id or "").strip()
    if not gene_name or not taxon_id.isdigit():
        return _source_result("invalid_query", genes=[], error="gene name and numeric taxonomy identifier are required")
    fetch = fetch_json or _fetch_json
    term = f'{gene_name}[Gene Name] AND {taxon_id}[Taxonomy ID]'
    search_url = f"{NCBI_EUTILS}/esearch.fcgi?{urlencode({'db': 'gene', 'term': term, 'retmode': 'json', 'retmax': 10, 'tool': 'FlavorThresholdDB'})}"
    try:
        ids = fetch(search_url).get("esearchresult", {}).get("idlist", [])
        if not ids:
            return _source_result("no_data", genes=[], source_url=search_url)
        summary_url = f"{NCBI_EUTILS}/esummary.fcgi?{urlencode({'db': 'gene', 'id': ','.join(ids), 'retmode': 'json', 'tool': 'FlavorThresholdDB'})}"
        payload = fetch(summary_url).get("result", {})
    except Exception as exc:
        return _source_result("upstream_unavailable", genes=[], error=str(exc), source_url=search_url)
    genes = []
    for gene_id in payload.get("uids", []):
        item = payload.get(str(gene_id), {})
        organism = item.get("organism") or {}
        genes.append({
            "gene_id": str(item.get("uid") or gene_id),
            "symbol": item.get("name") or gene_name,
            "description": item.get("description") or "",
            "taxon_id": organism.get("taxid") or int(taxon_id),
            "organism": organism.get("scientificname") or "",
            "source_url": f"https://www.ncbi.nlm.nih.gov/gene/{item.get('uid') or gene_id}",
        })
    return _source_result("ok" if genes else "no_data", genes=genes, source_url=search_url)


def query_ncbi_taxonomy(taxon_id: int | str, fetch_json=None) -> dict:
    value = str(taxon_id or "").strip()
    if not value.isdigit():
        return _source_result("invalid_query", entity=None, error="numeric taxonomy identifier is required")
    url = f"{NCBI_EUTILS}/esummary.fcgi?{urlencode({'db': 'taxonomy', 'id': value, 'retmode': 'json', 'tool': 'FlavorThresholdDB'})}"
    try:
        payload = (fetch_json or _fetch_json)(url).get("result", {})
        item = payload.get(value, {})
    except Exception as exc:
        return _source_result("upstream_unavailable", entity=None, error=str(exc), source_url=url)
    if not item:
        return _source_result("no_data", entity=None, source_url=url)
    lineage = [part.strip() for part in str(item.get("lineage") or "").split(";") if part.strip()]
    entity = {
        "taxon_id": int(value),
        "scientific_name": item.get("scientificname") or "",
        "common_name": item.get("commonname") or "",
        "rank": item.get("rank") or "",
        "lineage": lineage,
        "source_url": f"https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id={value}",
    }
    return _source_result("ok", entity=entity, source_url=url)


def query_metabolights(names: list[str], cas: str = "", fetch_json=None) -> dict:
    terms = [str(name).strip() for name in names or [] if str(name).strip()]
    if str(cas or "").strip():
        terms.append(str(cas).strip())
    if not terms:
        return _source_result("invalid_query", studies=[], hit_count=0, error="name or CAS is required")
    query = " OR ".join(f'"{term}"' for term in dict.fromkeys(terms[:4]))
    url = f"{EBI_SEARCH}?{urlencode({'query': query, 'format': 'json', 'size': 10})}"
    try:
        payload = (fetch_json or _fetch_json)(url)
    except Exception as exc:
        return _source_result("upstream_unavailable", studies=[], hit_count=0, error=str(exc), source_url=url)
    studies = []
    for item in payload.get("entries", []) if isinstance(payload, dict) else []:
        accession = str(item.get("id") or "").strip()
        if accession.startswith("MTBLS"):
            studies.append({"accession": accession, "source_url": f"https://www.ebi.ac.uk/metabolights/{quote(accession)}"})
    count = int(payload.get("hitCount") or len(studies)) if isinstance(payload, dict) else len(studies)
    return _source_result("ok" if studies else "no_data", studies=studies, hit_count=count, source_url=url)


def build_biological_context(target: dict, biochemistry: dict, *, gene_query=query_ncbi_gene, taxonomy_query=query_ncbi_taxonomy, metabolights_query=query_metabolights, cache=None) -> dict:
    def cached(source, key, loader):
        if cache:
            value = cache.get(source, key)
            if value is not None:
                return value
        value = loader()
        if cache:
            cache.set(source, key, value)
        return value

    genes, taxa, seen_queries, seen_gene_ids = [], [], set(), set()
    ec_numbers = set()
    source_states = {
        "NCBI Gene": {"status": "not_requested", "requests": []},
        "NCBI Taxonomy": {"status": "not_requested", "requests": []},
    }
    for protein in biochemistry.get("proteins", []):
        organism = protein.get("organism") or {}
        taxon_id = organism.get("taxon_id")
        ec_numbers.update(str(value).strip() for value in protein.get("ec_numbers", []) if str(value).strip())
        for gene_name in protein.get("gene_names", []):
            query_key = (str(gene_name).strip(), taxon_id)
            if not query_key[0] or not query_key[1] or query_key in seen_queries:
                continue
            seen_queries.add(query_key)
            result = cached("NCBI Gene", f"{query_key[0]}|{query_key[1]}", lambda: gene_query(*query_key))
            source_states["NCBI Gene"]["requests"].append({"gene_name": query_key[0], "taxon_id": query_key[1], "status": result.get("status", "unknown"), "source_url": result.get("source_url", "")})
            for gene in result.get("genes", []):
                if gene.get("gene_id") not in seen_gene_ids:
                    seen_gene_ids.add(gene.get("gene_id"))
                    genes.append({**gene, "evidence": {"uniprot_accession": protein.get("accession"), "gene_name": query_key[0], "taxon_id": query_key[1]}})
        if taxon_id and not any(item.get("taxon_id") == int(taxon_id) for item in taxa):
            result = cached("NCBI Taxonomy", str(taxon_id), lambda: taxonomy_query(taxon_id))
            source_states["NCBI Taxonomy"]["requests"].append({"taxon_id": taxon_id, "status": result.get("status", "unknown"), "source_url": result.get("source_url", "")})
            if result.get("entity"):
                taxa.append(result["entity"])
    study_key = "|".join([str(target.get("cas") or "").strip(), *[str(name).strip().casefold() for name in target.get("names", []) if str(name).strip()]])
    metabolights = cached("MetaboLights", study_key, lambda: metabolights_query(target.get("names", []), target.get("cas", "")))
    for source in ("NCBI Gene", "NCBI Taxonomy"):
        requests = source_states[source]["requests"]
        statuses = {item["status"] for item in requests}
        if "ok" in statuses:
            source_states[source]["status"] = "ok" if statuses <= {"ok", "no_data"} else "partial_failure"
        elif "upstream_unavailable" in statuses:
            source_states[source]["status"] = "upstream_unavailable"
        elif requests:
            source_states[source]["status"] = "no_data"
    source_states["MetaboLights"] = {"status": metabolights.get("status", "unknown"), "source_url": metabolights.get("source_url", "")}
    brenda = [{"ec_number": ec, "source_url": f"https://www.brenda-enzymes.org/enzyme.php?ecno={quote(ec)}"} for ec in sorted(ec_numbers)]
    hmdb_query = target.get("cas") or next(iter(target.get("names", [])), "")
    return {
        "genes": genes,
        "taxa": taxa,
        "studies": metabolights.get("studies", []),
        "study_hit_count": metabolights.get("hit_count", 0),
        "sources": source_states,
        "links": {
            "BRENDA": brenda,
            "HMDB": {"integration_mode": "link_only", "reason": "license_restricted_redistribution", "source_url": f"https://www.hmdb.ca/unearth/q?query={quote(str(hmdb_query))}&searcher=metabolites"},
        },
    }
