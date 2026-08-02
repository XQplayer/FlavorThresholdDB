import json
from pathlib import Path
import unittest

from spectra_massbank import MASSBANK_API_URL, parse_massbank_record, query_massbank_records


FIXTURE = Path(__file__).parent / "fixtures" / "massbank_record.json"


class MassBankAdapterTests(unittest.TestCase):
    def setUp(self):
        self.record = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.target = {
            "inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N",
            "cas": "141-78-6",
            "smiles": "CCOC(=O)C",
            "names": ["乙酸乙酯", "ethyl acetate"],
        }

    def test_parses_real_massbank_shape_into_shared_contract(self):
        result = parse_massbank_record(self.record, self.target, "2026-08-02T12:00:00Z")
        self.assertEqual(result["spectrum_id"], "MSBNK-Fac_Eng_Univ_Tokyo-JP001519")
        self.assertEqual(result["source"], "MassBank")
        self.assertEqual(result["spectrum_type"], "EI")
        self.assertEqual(result["ionization"], "EI")
        self.assertEqual(result["ion_mode"], "positive")
        self.assertEqual(result["instrument"], "HITACHI RMU-6M")
        self.assertEqual(result["collision_energy"], "70 eV")
        self.assertEqual(result["license"], "CC BY-NC-SA")
        self.assertEqual(result["compound_identity"]["match_type"], "inchikey_exact")
        self.assertTrue(result["compound_identity"]["verified"])
        self.assertEqual(result["peaks"], [[43.0, 100.0], [61.0, 40.0]])

    def test_queries_official_inchikey_filter_and_returns_records(self):
        seen = []

        def fetch_json(url):
            seen.append(url)
            return [self.record]

        result = query_massbank_records(self.target, fetch_json=fetch_json)
        self.assertEqual(seen, [f"{MASSBANK_API_URL}/records?inchi_key=XEKOWRVHYACXOJ-UHFFFAOYSA-N"])
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(result["records"]), 1)

    def test_upstream_failure_is_distinct_from_no_records(self):
        def failing_fetcher(_url):
            raise OSError("offline")

        result = query_massbank_records(self.target, fetch_json=failing_fetcher)
        self.assertEqual(result["status"], "upstream_unavailable")
        self.assertEqual(result["records"], [])

    def test_missing_inchikey_does_not_make_unbounded_request(self):
        result = query_massbank_records({"names": ["ethyl acetate"]}, fetch_json=lambda _url: [])
        self.assertEqual(result["status"], "identity_required")
        self.assertEqual(result["records"], [])


if __name__ == "__main__":
    unittest.main()
