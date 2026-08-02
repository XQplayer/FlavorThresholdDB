import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from scripts.spectra.rebuild_gnps_index import (
    GNPS_LIBRARY_API_URL,
    build_gnps_index,
    query_gnps_index,
)


FIXTURES = Path(__file__).parent / "fixtures"


class GnpsIndexTests(unittest.TestCase):
    def setUp(self):
        self.libraries = json.loads((FIXTURES / "gnps_libraries.json").read_text(encoding="utf-8"))
        self.spectra = json.loads((FIXTURES / "gnps_search.json").read_text(encoding="utf-8"))
        self.tempdir = tempfile.TemporaryDirectory()
        self.index_path = Path(self.tempdir.name) / "gnps.sqlite"

    def tearDown(self):
        self.tempdir.cleanup()

    def test_builds_queryable_identity_index_from_official_slim_endpoints(self):
        seen = []

        def fetch_json(url):
            seen.append(url)
            return self.libraries if url == f"{GNPS_LIBRARY_API_URL}/libraries" else self.spectra

        report = build_gnps_index(self.index_path, fetch_json=fetch_json)
        rows = query_gnps_index(self.index_path, inchikey="XEKOWRVHYACXOJ-UHFFFAOYSA-N")

        self.assertEqual(report["libraries_updated"], 1)
        self.assertEqual(report["spectra_indexed"], 2)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["library_name"], "TEST-GNPS-LIBRARY")
        self.assertEqual(rows[0]["license_status"], "needs_review")
        self.assertEqual(
            seen,
            [
                f"{GNPS_LIBRARY_API_URL}/libraries",
                f"{GNPS_LIBRARY_API_URL}/libraries/TEST-GNPS-LIBRARY/spectra",
            ],
        )

    def test_unchanged_library_is_not_downloaded_again(self):
        def first_fetch(url):
            return self.libraries if url.endswith("/libraries") else self.spectra

        build_gnps_index(self.index_path, fetch_json=first_fetch)
        seen = []

        def second_fetch(url):
            seen.append(url)
            return self.libraries

        report = build_gnps_index(self.index_path, fetch_json=second_fetch)
        self.assertEqual(report["libraries_skipped"], 1)
        self.assertEqual(seen, [f"{GNPS_LIBRARY_API_URL}/libraries"])

    def test_failed_refresh_preserves_previous_library_rows(self):
        def first_fetch(url):
            return self.libraries if url.endswith("/libraries") else self.spectra

        build_gnps_index(self.index_path, fetch_json=first_fetch)
        changed = [{**self.libraries[0], "imported_at": "2026-08-02T00:00:00+00:00"}]

        def failing_fetch(url):
            if url.endswith("/libraries"):
                return changed
            raise OSError("interrupted")

        report = build_gnps_index(self.index_path, fetch_json=failing_fetch)
        rows = query_gnps_index(self.index_path, inchikey="XEKOWRVHYACXOJ-UHFFFAOYSA-N")
        self.assertEqual(report["libraries_failed"], 1)
        self.assertEqual(len(rows), 2)

    def test_connectivity_block_lookup_finds_stereochemical_records(self):
        def fetch_json(url):
            return self.libraries if url.endswith("/libraries") else self.spectra

        build_gnps_index(self.index_path, fetch_json=fetch_json)
        rows = query_gnps_index(self.index_path, inchikey="XEKOWRVHYACXOJ-AAAAAAAAAA-N")
        self.assertEqual(len(rows), 2)

    def test_duplicate_spectrum_ids_are_deduplicated_within_one_library(self):
        duplicated = [self.spectra[0], {**self.spectra[0], "compound_name": "duplicate"}]

        def fetch_json(url):
            return self.libraries if url.endswith("/libraries") else duplicated

        report = build_gnps_index(self.index_path, fetch_json=fetch_json)
        rows = query_gnps_index(self.index_path, inchikey="XEKOWRVHYACXOJ-UHFFFAOYSA-N")
        self.assertEqual(report["libraries_failed"], 0)
        self.assertEqual(report["spectra_indexed"], 1)
        self.assertEqual(report["duplicate_spectrum_ids"], 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["compound_name"], "Ethyl acetate")


if __name__ == "__main__":
    unittest.main()
