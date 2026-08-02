import unittest
from pathlib import Path
import gzip
import json
import sqlite3
import tempfile

from spectra_index_distribution import (
    find_forbidden_tracked_index_files,
    validate_index_manifest,
)
from scripts.spectra.build_public_spectrum_index import build_public_index


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


class PublicSpectrumIndexBuilderTests(unittest.TestCase):
    def test_builds_integrity_checked_slim_index_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.sqlite"
            connection = sqlite3.connect(source)
            connection.executescript("""
                CREATE TABLE libraries (name TEXT PRIMARY KEY, data_source TEXT, display_source TEXT, description TEXT, library_type TEXT, imported_at TEXT, spectra_count INTEGER, indexed_at TEXT);
                CREATE TABLE spectra (spectrum_id TEXT, library_name TEXT, spectrum_index INTEGER, inchikey TEXT, inchikey_2d TEXT, compound_name TEXT, normalized_name TEXT, smiles TEXT, ion_mode TEXT, ion_source TEXT, adduct TEXT, precursor_mz REAL, exact_mass REAL, instrument TEXT, charge INTEGER, license_status TEXT, PRIMARY KEY (library_name, spectrum_id));
                INSERT INTO libraries VALUES ('GNPS-LIB', 'gnps', 'GNPS', 'large description', 'community', '', 2, '2026-08-02T00:00:00Z');
                INSERT INTO spectra VALUES ('S1','GNPS-LIB',1,'XEKOWRVHYACXOJ-UHFFFAOYSA-N','XEKOWRVHYACXOJ','Ethyl acetate','ethyl acetate','CCOC(=O)C','positive','ESI','M+H',89.1,88.1,'Orbitrap',1,'cc0');
                INSERT INTO spectra VALUES ('S2','GNPS-LIB',2,'','','Unknown','unknown','','negative','ESI','',NULL,NULL,'',-1,'needs_review');
            """)
            connection.commit()
            connection.close()

            result = build_public_index(source, root / "out", version="2026.08.02", asset_url="https://github.com/XQplayer/FlavorThresholdDB/releases/download/test/public.sqlite.gz")
            manifest = json.loads(result["manifest_path"].read_text(encoding="utf-8"))
            self.assertEqual(manifest["spectrum_count"], 2)
            self.assertEqual(manifest["library_count"], 1)
            self.assertEqual(manifest["compression"], "gzip")
            self.assertEqual(len(manifest["sha256"]), 64)
            decompressed = root / "decompressed.sqlite"
            with gzip.open(result["archive_path"], "rb") as source_handle, decompressed.open("wb") as target_handle:
                target_handle.write(source_handle.read())
            output = sqlite3.connect(decompressed)
            self.assertEqual(output.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            columns = [row[1] for row in output.execute("PRAGMA table_info(spectra)")]
            self.assertNotIn("peaks", columns)
            self.assertEqual(output.execute("SELECT inchikey_2d FROM spectra WHERE spectrum_id='S1'").fetchone()[0], "XEKOWRVHYACXOJ")
            self.assertEqual(output.execute("SELECT COUNT(*) FROM spectra").fetchone()[0], 2)
            output.close()


if __name__ == "__main__":
    unittest.main()
