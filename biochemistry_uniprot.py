"""UniProt reviewed-protein adapter for Rhea reaction identifiers."""

from __future__ import annotations

import json
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen


UNIPROT_URL = "https://rest.uniprot.org/uniprotkb/search"


def _value(data, *path, default=""):
    for key in path:
        if not isinstance(data, dict):
            return default
        data = data.get(key)
    return data if data is not None else default


def parse_uniprot_results(payload: dict, rhea_id: str) -> list[dict]:
    proteins = []
    for raw in payload.get("results", []) if isinstance(payload, dict) else []:
        description = raw.get("proteinDescription") or {}
        recommended = description.get("recommendedName") or {}
        proteins.append({
            "accession": raw.get("primaryAccession") or "",
            "entry_id": raw.get("uniProtkbId") or "",
            "protein_name": _value(recommended, "fullName", "value"),
            "gene_names": [_value(gene, "geneName", "value") for gene in raw.get("genes", []) if _value(gene, "geneName", "value")],
            "organism": {"scientific_name": _value(raw, "organism", "scientificName"), "taxon_id": _value(raw, "organism", "taxonId", default=None)},
            "ec_numbers": [item.get("value") for item in recommended.get("ecNumbers", []) if item.get("value")],
            "rhea_id": rhea_id,
            "source_url": f"https://www.uniprot.org/uniprotkb/{raw.get('primaryAccession', '')}/entry",
        })
    return proteins


def _fetch_page(url: str) -> tuple[dict, str | None]:
    with urlopen(Request(url, headers={"Accept": "application/json", "User-Agent": "FlavorThresholdDB/1.3"}), timeout=25) as response:
        payload = json.load(response)
        link = response.headers.get("Link", "")
    match = re.search(r'<([^>]+)>;\s*rel="next"', link)
    return payload, match.group(1) if match else None


def query_uniprot(rhea_id: str, fetch_json=None, fetch_page=None) -> dict:
    query = f'(cc_catalytic_activity:"{rhea_id.lower()}") AND reviewed:true AND fragment:false'
    url = f"{UNIPROT_URL}?{urlencode({'query': query, 'format': 'json', 'size': 100})}"
    try:
        if fetch_json:
            pages = [(fetch_json(url), None)]
        else:
            pages = []
            next_url = url
            loader = fetch_page or _fetch_page
            while next_url:
                payload, next_url = loader(next_url)
                pages.append((payload, next_url))
    except Exception as exc:
        return {"status": "upstream_unavailable", "proteins": [], "error": str(exc), "source_url": url}
    proteins = []
    seen = set()
    for payload, _next in pages:
        for protein in parse_uniprot_results(payload, rhea_id):
            if protein["accession"] and protein["accession"] not in seen:
                seen.add(protein["accession"])
                proteins.append(protein)
    return {"status": "ok" if proteins else "no_data", "proteins": proteins, "source_url": url}
