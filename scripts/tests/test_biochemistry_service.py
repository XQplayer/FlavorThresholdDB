import unittest

from biochemistry_chebi import resolve_chebi
from biochemistry_rhea import parse_rhea_tsv
from biochemistry_uniprot import parse_uniprot_results
from biochemistry_uniprot import query_uniprot
from biochemistry_service import resolve_biochemistry


class BiochemistryAdapterTests(unittest.TestCase):
    def test_chebi_prefers_exact_inchikey_and_marks_name_only_unverified(self):
        payload = {"results": [{"_source": {"chebi_accession": "CHEBI:27750", "name": "ethyl acetate", "inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N", "formula": "C4H8O2", "charge": 0}}]}
        exact = resolve_chebi({"inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N", "names": ["ethyl acetate"]}, fetch_json=lambda _url: payload)
        named = resolve_chebi({"names": ["ethyl acetate"]}, fetch_json=lambda _url: payload)
        self.assertEqual(exact["entity"]["chebi_id"], "CHEBI:27750")
        self.assertTrue(exact["entity"]["identity_match"]["verified"])
        self.assertFalse(named["entity"]["identity_match"]["verified"])

    def test_rhea_and_uniprot_preserve_identifiers_and_organism(self):
        tsv = "Reaction identifier\tEquation\tChEBI identifier\tEC number\tEnzymes\nRHEA:10020\tA = B\tCHEBI:1; CHEBI:2\tEC 1.1.1.1\t2\n"
        reactions = parse_rhea_tsv(tsv)
        self.assertEqual(reactions[0]["rhea_id"], "RHEA:10020")
        self.assertEqual(reactions[0]["chebi_ids"], ["CHEBI:1", "CHEBI:2"])
        proteins = parse_uniprot_results({"results": [{"primaryAccession": "P12345", "uniProtkbId": "TEST_HUMAN", "proteinDescription": {"recommendedName": {"fullName": {"value": "Example enzyme"}, "ecNumbers": [{"value": "1.1.1.1"}]}}, "genes": [{"geneName": {"value": "GENE1"}}], "organism": {"scientificName": "Homo sapiens", "taxonId": 9606}}]}, "RHEA:10020")
        self.assertEqual(proteins[0]["organism"]["taxon_id"], 9606)
        self.assertEqual(proteins[0]["ec_numbers"], ["1.1.1.1"])

    def test_service_stops_after_unverified_chebi_candidate(self):
        chebi = lambda _target: {"status": "candidate", "entity": {"chebi_id": "CHEBI:1", "identity_match": {"verified": False}}}
        result = resolve_biochemistry({"names": ["example"]}, chebi_resolver=chebi, rhea_query=lambda _id: self.fail("Rhea should not run"), uniprot_query=lambda _id: self.fail("UniProt should not run"))
        self.assertEqual(result["sources"]["Rhea"]["status"], "blocked_unverified_identity")
        self.assertEqual(result["reactions"], [])

    def test_uniprot_follows_pagination_and_deduplicates_accessions(self):
        pages = {
            "first": ({"results": [{"primaryAccession": "P1"}]}, "second"),
            "second": ({"results": [{"primaryAccession": "P1"}, {"primaryAccession": "P2"}]}, None),
        }
        calls = []
        def fetch_page(url):
            calls.append(url)
            return pages["first" if len(calls) == 1 else "second"]
        result = query_uniprot("RHEA:10020", fetch_page=fetch_page)
        self.assertEqual([protein["accession"] for protein in result["proteins"]], ["P1", "P2"])
        self.assertEqual(len(calls), 2)

    def test_service_reuses_each_source_cache_without_calling_upstreams(self):
        class Cache:
            values = {
                ("ChEBI", "XEKOWRVHYACXOJ-UHFFFAOYSA-N|141-78-6|ethyl acetate"): {"status": "ok", "entity": {"chebi_id": "CHEBI:27750", "identity_match": {"verified": True}}},
                ("Rhea", "CHEBI:27750"): {"status": "ok", "reactions": [{"rhea_id": "RHEA:1"}]},
                ("UniProt", "RHEA:1"): {"status": "ok", "proteins": [{"accession": "P1", "rhea_id": "RHEA:1"}]},
            }
            def get(self, source, key): return self.values.get((source, key))
            def set(self, *_args, **_kwargs): self.fail("cache write should not occur")
        result = resolve_biochemistry(
            {"inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N", "cas": "141-78-6", "names": ["ethyl acetate"]},
            chebi_resolver=lambda _target: self.fail("ChEBI should be cached"),
            rhea_query=lambda _id: self.fail("Rhea should be cached"),
            uniprot_query=lambda _id: self.fail("UniProt should be cached"),
            cache=Cache(),
        )
        self.assertEqual(result["proteins"][0]["accession"], "P1")


if __name__ == "__main__":
    unittest.main()
