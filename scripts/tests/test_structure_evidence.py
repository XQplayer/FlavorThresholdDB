import unittest

from structure_evidence import query_alphafold, query_gpcrdb, query_rcsb, resolve_structure_evidence


class StructureEvidenceTests(unittest.TestCase):
    def test_alphafold_is_labeled_predicted_with_confidence(self):
        payload = [{"modelEntityId": "AF-P53208-F1", "globalMetricValue": 90.75, "latestVersion": 6, "pdbUrl": "https://example/model.pdb"}]
        result = query_alphafold("P53208", fetch_json=lambda _url: payload)
        self.assertEqual(result["models"][0]["evidence_type"], "predicted_structure")
        self.assertEqual(result["models"][0]["global_plddt"], 90.75)

    def test_gpcrdb_requires_exact_accession(self):
        result = query_gpcrdb("P07550", fetch_json=lambda _url: {"accession": "P07550", "entry_name": "adrb2_human", "name": "beta-2 receptor"})
        self.assertEqual(result["protein"]["entry_name"], "adrb2_human")
        mismatch = query_gpcrdb("P07550", fetch_json=lambda _url: {"accession": "P00000"})
        self.assertEqual(mismatch["status"], "no_data")

    def test_rcsb_deduplicates_entry_identifiers(self):
        payload = {"result_set": [{"identifier": "1ABC_1"}, {"identifier": "1ABC_2"}, {"identifier": "2DEF_1"}]}
        result = query_rcsb("P12345", post_json=lambda _url, _body: payload)
        self.assertEqual([row["pdb_id"] for row in result["structures"]], ["1ABC", "2DEF"])
        self.assertTrue(all(row["evidence_type"] == "experimental_structure" for row in result["structures"]))

    def test_resolver_keeps_experimental_and_predicted_records_separate(self):
        bio = {"proteins": [{"accession": "P1"}, {"accession": "P1"}, {"accession": "P2"}]}
        result = resolve_structure_evidence(
            bio,
            rcsb_query=lambda accession: {"status": "ok", "structures": [{"pdb_id": accession, "evidence_type": "experimental_structure"}]},
            alphafold_query=lambda accession: {"status": "ok", "models": [{"model_id": accession, "evidence_type": "predicted_structure"}]},
            gpcrdb_query=lambda accession: {"status": "no_data", "protein": None},
        )
        self.assertEqual(len(result["experimental_structures"]), 2)
        self.assertEqual(len(result["predicted_models"]), 2)


if __name__ == "__main__":
    unittest.main()
