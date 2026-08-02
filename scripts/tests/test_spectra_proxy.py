import json
import threading
from http.server import ThreadingHTTPServer
import unittest
from unittest.mock import patch
from urllib.request import urlopen
from urllib.error import HTTPError
from urllib.request import Request
from pathlib import Path
import tempfile

from fema_proxy_server import (
    Handler,
    aggregate_open_spectra,
    fetch_open_spectrum,
)
from spectra_cache import OpenSpectraCache


class OpenSpectraAggregationTests(unittest.TestCase):
    def test_search_and_permitted_detail_use_open_spectra_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = OpenSpectraCache(Path(directory) / "spectra.json")
            search_calls = []
            detail_calls = []

            def massbank_query(_target):
                search_calls.append(1)
                return {"source": "MassBank", "status": "ok", "records": []}

            target = {"inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N"}
            aggregate_open_spectra(target, massbank_query=massbank_query, gnps_query=lambda _target: {"source": "GNPS", "status": "ok", "records": []}, cache=cache)
            aggregate_open_spectra(target, massbank_query=massbank_query, gnps_query=lambda _target: {"source": "GNPS", "status": "ok", "records": []}, cache=cache)
            self.assertEqual(len(search_calls), 1)

            def fetcher(identifier):
                detail_calls.append(identifier)
                return {"source": "MassBank", "spectrum_id": identifier, "license": "CC BY", "peaks": [[43, 100]]}

            fetch_open_spectrum("MassBank", "MB-1", massbank_fetch=fetcher, cache=cache)
            fetch_open_spectrum("MassBank", "MB-1", massbank_fetch=fetcher, cache=cache)
            self.assertEqual(detail_calls, ["MB-1"])

    def test_one_failed_source_does_not_erase_the_other(self):
        def massbank(_target):
            raise OSError("MassBank offline")

        def gnps(_target):
            return {
                "source": "GNPS",
                "status": "ok",
                "records": [{"spectrum_id": "GNPS2LIB1", "source": "GNPS", "spectrum_type": "MS2"}],
            }

        result = aggregate_open_spectra(
            {"inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N"},
            massbank_query=massbank,
            gnps_query=gnps,
        )
        self.assertEqual(result["sources"]["MassBank"]["status"], "upstream_unavailable")
        self.assertEqual(result["sources"]["GNPS"]["status"], "ok")
        self.assertEqual(result["summary"]["total"], 1)
        self.assertEqual(result["records"][0]["spectrum_id"], "GNPS2LIB1")

    def test_detail_dispatches_by_normalized_source(self):
        massbank = fetch_open_spectrum(
            "massbank",
            "MB-1",
            massbank_fetch=lambda accession: {"source": "MassBank", "spectrum_id": accession},
        )
        gnps = fetch_open_spectrum(
            "GNPS",
            "GNPS2LIB1",
            gnps_fetch=lambda identifier: {"source": "GNPS", "spectrum_id": identifier},
        )
        self.assertEqual(massbank["spectrum_id"], "MB-1")
        self.assertEqual(gnps["spectrum_id"], "GNPS2LIB1")
        with self.assertRaises(ValueError):
            fetch_open_spectrum("unknown", "1")


class OpenSpectraRouteTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_search_route_passes_compound_identity_to_aggregator(self):
        payload = {"summary": {"total": 0}, "records": [], "sources": {}}
        with patch("fema_proxy_server.aggregate_open_spectra", return_value=payload) as mocked:
            with urlopen(
                self.base
                + "/spectra/search?inchikey=XEKOWRVHYACXOJ-UHFFFAOYSA-N&cas=141-78-6"
                + "&smiles=CCOC%28%3DO%29C&name=ethyl%20acetate",
                timeout=5,
            ) as response:
                body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body, payload)
        target = mocked.call_args.args[0]
        self.assertEqual(target["cas"], "141-78-6")
        self.assertEqual(target["names"], ["ethyl acetate"])

    def test_detail_route_dispatches_source_and_identifier(self):
        payload = {"source": "GNPS", "spectrum_id": "GNPS2LIB00000000001", "peaks": []}
        with patch("fema_proxy_server.fetch_open_spectrum", return_value=payload) as mocked:
            with urlopen(self.base + "/spectra/GNPS/GNPS2LIB00000000001", timeout=5) as response:
                body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(body, payload)
        mocked.assert_called_once_with("GNPS", "GNPS2LIB00000000001")

    def test_download_route_returns_export_for_permitted_record(self):
        record = {
            "source": "MassBank", "spectrum_id": "MB-1", "license": "CC BY",
            "source_url": "https://example.test/MB-1", "peaks": [[43, 100]],
            "compound_identity": {"name": "Example"},
        }
        with patch("fema_proxy_server.fetch_open_spectrum", return_value=record):
            with urlopen(self.base + "/spectra/MassBank/MB-1/download?format=msp", timeout=5) as response:
                body = response.read().decode("utf-8")
                disposition = response.headers["Content-Disposition"]
        self.assertIn("Name: Example", body)
        self.assertIn("MB-1.msp", disposition)

    def test_download_route_rejects_unreviewed_license(self):
        record = {"source": "GNPS", "spectrum_id": "G-1", "license": "needs_review", "peaks": [[43, 100]]}
        with patch("fema_proxy_server.fetch_open_spectrum", return_value=record):
            with self.assertRaises(HTTPError) as raised:
                urlopen(self.base + "/spectra/GNPS/G-1/download?format=json", timeout=5)
        self.assertEqual(raised.exception.code, 403)

    def test_compare_route_refetches_both_spectra(self):
        spectra = {
            ("MassBank", "A"): {"spectrum_type": "EI", "ms_level": 1, "peaks": [[43, 100]]},
            ("MassBank", "B"): {"spectrum_type": "EI", "ms_level": 1, "peaks": [[43, 100]]},
        }
        body = json.dumps({
            "a_source": "MassBank", "a_id": "A", "b_source": "MassBank", "b_id": "B", "tolerance": 0.1
        }).encode("utf-8")
        request = Request(self.base + "/spectra/compare", data=body, method="POST", headers={"Content-Type": "application/json"})
        with patch("fema_proxy_server.fetch_open_spectrum", side_effect=lambda source, identifier: spectra[(source, identifier)]):
            with urlopen(request, timeout=5) as response:
                result = json.loads(response.read().decode("utf-8"))
        self.assertEqual(result["similarity"], 1.0)
        self.assertEqual(result["matched_peak_count"], 1)


if __name__ == "__main__":
    unittest.main()
