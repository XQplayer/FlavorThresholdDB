import unittest
from urllib.parse import parse_qs, urlparse

from biological_context import (
    build_biological_context,
    query_metabolights,
    query_ncbi_gene,
    query_ncbi_taxonomy,
)


class BiologicalContextTests(unittest.TestCase):
    def test_ncbi_gene_preserves_gene_and_taxonomy_identifiers(self):
        search = {"esearchresult": {"idlist": ["123", "456"]}}
        summary = {"result": {
            "uids": ["123", "456"],
            "123": {"uid": "123", "name": "ADH1", "description": "alcohol dehydrogenase", "organism": {"scientificname": "Saccharomyces cerevisiae", "taxid": 4932}},
            "456": {"uid": "456", "name": "ADH1", "description": "duplicate", "organism": {"scientificname": "Saccharomyces cerevisiae", "taxid": 4932}},
        }}
        calls = []
        def fetch(url):
            calls.append(url)
            return search if "esearch.fcgi" in url else summary
        result = query_ncbi_gene("ADH1", 4932, fetch_json=fetch)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["genes"][0]["gene_id"], "123")
        self.assertEqual(result["genes"][0]["taxon_id"], 4932)
        self.assertIn("4932[Taxonomy ID]", parse_qs(urlparse(calls[0]).query)["term"][0])

    def test_ncbi_taxonomy_returns_rank_and_lineage(self):
        payload = {"result": {"uids": ["4932"], "4932": {"uid": "4932", "scientificname": "Saccharomyces cerevisiae", "rank": "species", "lineage": "Eukaryota; Fungi"}}}
        result = query_ncbi_taxonomy(4932, fetch_json=lambda _url: payload)
        self.assertEqual(result["entity"]["rank"], "species")
        self.assertEqual(result["entity"]["lineage"], ["Eukaryota", "Fungi"])

    def test_metabolights_uses_public_ebi_search_and_keeps_accessions(self):
        payload = {"hitCount": 2, "entries": [{"id": "MTBLS1", "source": "metabolights"}, {"id": "MTBLS2", "source": "metabolights"}]}
        result = query_metabolights(["ethyl acetate"], "141-78-6", fetch_json=lambda _url: payload)
        self.assertEqual(result["hit_count"], 2)
        self.assertEqual(result["studies"][0]["accession"], "MTBLS1")
        self.assertTrue(result["studies"][0]["source_url"].endswith("/MTBLS1"))

    def test_context_only_queries_genes_supported_by_protein_evidence(self):
        calls = []
        biochemistry = {"proteins": [
            {"accession": "P1", "gene_names": ["ADH1"], "organism": {"taxon_id": 4932, "scientific_name": "Saccharomyces cerevisiae"}, "ec_numbers": ["1.1.1.1"]},
            {"accession": "P2", "gene_names": ["ADH1"], "organism": {"taxon_id": 4932, "scientific_name": "Saccharomyces cerevisiae"}, "ec_numbers": ["1.1.1.1"]},
        ]}
        result = build_biological_context(
            {"cas": "141-78-6", "names": ["ethyl acetate"]},
            biochemistry,
            gene_query=lambda gene, taxon: calls.append((gene, taxon)) or {"status": "ok", "genes": [{"gene_id": "1", "symbol": gene, "taxon_id": taxon}]},
            taxonomy_query=lambda taxon: {"status": "ok", "entity": {"taxon_id": taxon}},
            metabolights_query=lambda names, cas: {"status": "no_data", "studies": [], "hit_count": 0},
        )
        self.assertEqual(calls, [("ADH1", 4932)])
        self.assertEqual(len(result["genes"]), 1)
        self.assertEqual(result["sources"]["NCBI Gene"]["status"], "ok")
        self.assertEqual(len(result["sources"]["NCBI Gene"]["requests"]), 1)
        self.assertEqual(result["links"]["BRENDA"][0]["ec_number"], "1.1.1.1")
        self.assertEqual(result["links"]["HMDB"]["integration_mode"], "link_only")


if __name__ == "__main__":
    unittest.main()
