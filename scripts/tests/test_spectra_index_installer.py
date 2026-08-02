import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from spectra_index_distribution import install_public_index


def make_index(path, version="v1", rows=1):
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE libraries (name TEXT PRIMARY KEY);
        CREATE TABLE spectra (spectrum_id TEXT PRIMARY KEY);
    """)
    connection.execute("INSERT INTO metadata VALUES ('schema_version','1')")
    connection.execute("INSERT INTO metadata VALUES ('index_version',?)", (version,))
    connection.execute("INSERT INTO libraries VALUES ('L1')")
    connection.executemany("INSERT INTO spectra VALUES (?)", [(f"S{i}",) for i in range(rows)])
    connection.commit()
    connection.close()


def query_one(path, query):
    connection = sqlite3.connect(path)
    try:
        return connection.execute(query).fetchone()[0]
    finally:
        connection.close()


class PublicSpectrumIndexInstallerTests(unittest.TestCase):
    def test_installs_verified_archive_and_reuses_current_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.sqlite"
            archive = root / "source.sqlite.gz"
            make_index(source, rows=2)
            with source.open("rb") as input_handle, gzip.open(archive, "wb") as output_handle:
                output_handle.write(input_handle.read())
            body = archive.read_bytes()
            manifest = {
                "schema_version": 1, "index_version": "v1", "asset_url": "https://example.test/index.gz",
                "compression": "gzip", "sha256": hashlib.sha256(body).hexdigest(), "compressed_bytes": len(body),
                "sqlite_bytes": source.stat().st_size, "spectrum_count": 2, "library_count": 1,
                "created_at": "2026-08-02T00:00:00Z", "minimum_proxy_version": 1,
            }
            calls = []
            result = install_public_index(manifest, root / "runtime", fetch_to_path=lambda _url, path: (calls.append(path), path.write_bytes(body)))
            self.assertEqual(result["status"], "ready")
            self.assertEqual(result["installed"], True)
            self.assertEqual(query_one(result["index_path"], "SELECT COUNT(*) FROM spectra"), 2)
            reused = install_public_index(manifest, root / "runtime", fetch_to_path=lambda *_args: self.fail("downloaded current index"))
            self.assertEqual(reused["installed"], False)
            self.assertEqual(len(calls), 1)

    def test_hash_failure_preserves_valid_old_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / "runtime"
            runtime.mkdir()
            old = runtime / "public_spectrum_index.sqlite"
            make_index(old, version="old", rows=1)
            manifest = {
                "schema_version": 1, "index_version": "v2", "asset_url": "https://example.test/index.gz",
                "compression": "gzip", "sha256": "a" * 64, "compressed_bytes": 6,
                "sqlite_bytes": 100, "spectrum_count": 2, "library_count": 1,
                "created_at": "2026-08-02T00:00:00Z", "minimum_proxy_version": 1,
            }
            result = install_public_index(manifest, runtime, fetch_to_path=lambda _url, path: path.write_bytes(b"broken"))
            self.assertEqual(result["status"], "stale")
            self.assertEqual(query_one(old, "SELECT value FROM metadata WHERE key='index_version'"), "old")


if __name__ == "__main__":
    unittest.main()
