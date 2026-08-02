import unittest

from bioactivity_service import (
    parse_pubchem_assay_summary,
    query_chembl,
    query_gtopdb,
    resolve_bioactivity,
)


class BioactivityServiceTests(unittest.TestCase):
    def test_pubchem_summary_maps_columns_without_losing_assay_identifier(self):
        payload = {"Table": {"Columns": {"Column": ["AID", "CID", "Activity Outcome", "Target Accession", "Activity Value [uM]", "Assay Name"]}, "Row": [{"Cell": ["421", "8857", "Inactive", "P12345", "12.5", "Example assay"]}]}}
        rows = parse_pubchem_assay_summary(payload)
        self.assertEqual(rows[0]["aid"], "421")
        self.assertEqual(rows[0]["target_accession"], "P12345")
        self.assertEqual(rows[0]["source_url"], "https://pubchem.ncbi.nlm.nih.gov/bioassay/421")

    def test_chembl_requires_exact_inchikey_before_querying_activity(self):
        calls = []
        def fetch(url):
            calls.append(url)
            if "molecule.json" in url:
                return {"molecules": [{"molecule_chembl_id": "CHEMBL14152", "molecule_structures": {"standard_inchi_key": "XEKOWRVHYACXOJ-UHFFFAOYSA-N"}}]}
            return {"activities": [{"activity_id": 7, "molecule_chembl_id": "CHEMBL14152", "target_chembl_id": "CHEMBL_TARGET", "standard_type": "IC50", "standard_value": "10", "standard_units": "uM"}]}
        result = query_chembl("XEKOWRVHYACXOJ-UHFFFAOYSA-N", fetch_json=fetch)
        self.assertEqual(result["activities"][0]["target_id"], "CHEMBL_TARGET")
        self.assertEqual(len(calls), 2)

    def test_gtopdb_stops_when_exact_ligand_is_absent(self):
        result = query_gtopdb("XEKOWRVHYACXOJ-UHFFFAOYSA-N", 8857, fetch_json=lambda _url: [])
        self.assertEqual(result["status"], "no_data")
        self.assertEqual(result["interactions"], [])

    def test_service_preserves_each_source_status_and_bindingdb_exact_mode(self):
        result = resolve_bioactivity(
            {"cid": 8857, "inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N", "smiles": "CCOC(=O)C"},
            pubchem_query=lambda _cid: {"status": "ok", "assays": [{"aid": "1"}]},
            chembl_query=lambda _key: {"status": "no_data", "activities": []},
            gtopdb_query=lambda _key, _cid: {"status": "no_data", "interactions": []},
            bindingdb_query=lambda _smiles: {"status": "no_data", "interactions": [], "match_mode": "exact_structure"},
        )
        self.assertEqual(result["sources"]["PubChem BioAssay"]["status"], "ok")
        self.assertEqual(result["sources"]["BindingDB"]["match_mode"], "exact_structure")


if __name__ == "__main__":
    unittest.main()
