import unittest

from spectra_index_distribution import (
    find_forbidden_tracked_index_files,
    validate_index_manifest,
)


class SpectrumIndexManifestTests(unittest.TestCase):
    def setUp(self):
        self.manifest = {
            "schema_version": 1,
            "index_version": "2026.08.02",
            "asset_url": "https://github.com/XQplayer/FlavorThresholdDB/releases/download/spectra-2026.08/gnps-public.sqlite.gz",
            "compression": "gzip",
            "sha256": "a" * 64,
            "compressed_bytes": 100,
            "sqlite_bytes": 1000,
            "spectrum_count": 20,
            "library_count": 3,
            "created_at": "2026-08-02T12:00:00Z",
            "minimum_proxy_version": 1,
        }

    def test_accepts_canonical_manifest(self):
        self.assertEqual(validate_index_manifest(self.manifest)["index_version"], "2026.08.02")

    def test_rejects_missing_fields_unsafe_url_hash_and_impossible_sizes(self):
        for change in (
            {"asset_url": "http://example.test/index.gz"},
            {"sha256": "bad"},
            {"compressed_bytes": 0},
            {"sqlite_bytes": 10, "compressed_bytes": 100},
            {"spectrum_count": -1},
            {"schema_version": 2},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_index_manifest({**self.manifest, **change})

    def test_rejects_forbidden_tracked_database_and_archive_paths(self):
        paths = ["README.md", "_local/index.sqlite", "data/public.db", "index.sqlite-wal", "release/gnps.sqlite.gz"]
        self.assertEqual(find_forbidden_tracked_index_files(paths), paths[1:])

    def test_allows_committed_json_manifest(self):
        self.assertEqual(find_forbidden_tracked_index_files(["data/manifests/public_spectrum_index.json"]), [])


if __name__ == "__main__":
    unittest.main()
