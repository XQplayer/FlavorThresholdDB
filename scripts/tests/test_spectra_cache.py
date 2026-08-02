from datetime import datetime, timedelta, timezone
import tempfile
from pathlib import Path
import unittest

from spectra_cache import OpenSpectraCache


class OpenSpectraCacheTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "spectra.json"
        self.now = datetime(2026, 8, 2, 12, 0, tzinfo=timezone.utc)
        self.cache = OpenSpectraCache(self.path, now=lambda: self.now)

    def tearDown(self):
        self.tempdir.cleanup()

    def test_search_cache_expires_after_24_hours_and_is_schema_versioned(self):
        self.cache.put_search("identity", {"records": [1]})
        self.assertEqual(self.cache.get_search("identity"), {"records": [1]})
        self.now += timedelta(hours=25)
        self.assertIsNone(self.cache.get_search("identity"))

    def test_permitted_peak_record_persists_for_30_days(self):
        record = {"source": "MassBank", "spectrum_id": "MB-1", "license": "CC BY", "peaks": [[43, 100]]}
        self.cache.put_detail("MassBank", "MB-1", record)
        reloaded = OpenSpectraCache(self.path, now=lambda: self.now)
        self.assertEqual(reloaded.get_detail("MassBank", "MB-1")["peaks"], [[43, 100]])

    def test_unclear_license_peak_record_is_memory_only(self):
        record = {"source": "GNPS", "spectrum_id": "G-1", "license": "needs_review", "license_status": "needs_review", "peaks": [[43, 100]]}
        self.cache.put_detail("GNPS", "G-1", record)
        self.assertEqual(self.cache.get_detail("GNPS", "G-1")["peaks"], [[43, 100]])
        reloaded = OpenSpectraCache(self.path, now=lambda: self.now)
        self.assertIsNone(reloaded.get_detail("GNPS", "G-1"))


if __name__ == "__main__":
    unittest.main()
