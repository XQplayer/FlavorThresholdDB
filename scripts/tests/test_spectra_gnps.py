import json
from pathlib import Path
import tempfile
import unittest

from scripts.spectra.rebuild_gnps_index import build_gnps_index
from spectra_gnps import (
    GNPS_LEGACY_SPECTRUM_URL,
    GNPS_LIBRARY_URL,
    GNPS_USI_URL,
    fetch_gnps_spectrum,
    fetch_gnps_usi,
    search_gnps_records,
)


FIXTURES = Path(__file__).parent / "fixtures"


class GnpsSpectrumAdapterTests(unittest.TestCase):
    def setUp(self):
        self.detail = json.loads((FIXTURES / "gnps_record.json").read_text(encoding="utf-8"))
        self.target = {
            "inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N",
            "cas": "141-78-6",
            "smiles": "CCOC(=O)C",
            "names": ["ethyl acetate"],
        }

    def test_fetches_gnps2lib_detail_by_spectrum_id(self):
        seen = []

        def fetch_json(url):
            seen.append(url)
            return self.detail["gnps2"]

        result = fetch_gnps_spectrum("GNPS2LIB00000000001", fetch_json=fetch_json)
        self.assertEqual(seen, [f"{GNPS_LIBRARY_URL}/api/spectra/GNPS2LIB00000000001"])
        self.assertEqual(result["spectrum_id"], "GNPS2LIB00000000001")
        self.assertEqual(result["spectrum_type"], "MS2")
        self.assertEqual(result["peaks"][1], [107.0502, 100.0])
        self.assertEqual(result["license_status"], "needs_review")

    def test_fetches_legacy_ccmslib_detail_and_parses_peaks_json(self):
        result = fetch_gnps_spectrum(
            "CCMSLIB00000579358",
            fetch_json=lambda _url: self.detail["legacy"],
        )
        self.assertEqual(result["source_url"], f"{GNPS_LEGACY_SPECTRUM_URL}?SpectrumID=CCMSLIB00000579358")
        self.assertEqual(len(result["peaks"]), 2)
        self.assertEqual(result["compound_identity"]["name"], "Theophyllin")

    def test_fetches_peak_table_by_usi(self):
        seen = []

        def fetch_json(url):
            seen.append(url)
            return self.detail["usi"]

        usi = "mzspec:GNPS:GNPS-LIBRARY:accession:CCMSLIB00000579358"
        result = fetch_gnps_usi(usi, fetch_json=fetch_json)
        self.assertEqual(seen, [f"{GNPS_USI_URL}?usi1=mzspec%3AGNPS%3AGNPS-LIBRARY%3Aaccession%3ACCMSLIB00000579358"])
        self.assertEqual(result["n_peaks"], 2)
        self.assertEqual(len(result["peaks"]), 2)

    def test_searches_local_index_without_downloading_peaks(self):
        libraries = json.loads((FIXTURES / "gnps_libraries.json").read_text(encoding="utf-8"))
        spectra = json.loads((FIXTURES / "gnps_search.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tempdir:
            index = Path(tempdir) / "gnps.sqlite"
            build_gnps_index(index, fetch_json=lambda url: libraries if url.endswith("/libraries") else spectra)
            result = search_gnps_records(self.target, index_path=index)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(result["records"]), 2)
        self.assertEqual(result["records"][0]["peaks"], [])
        self.assertEqual(result["records"][0]["compound_identity"]["match_type"], "inchikey_exact")


if __name__ == "__main__":
    unittest.main()
