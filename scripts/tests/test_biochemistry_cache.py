from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from biochemistry_cache import BiochemistryCache


class BiochemistryCacheTests(unittest.TestCase):
    def test_source_specific_ttls_and_transient_failure_exclusion(self):
        now = datetime(2026, 8, 2, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            cache = BiochemistryCache(Path(directory) / "cache.json")
            cache.set("ChEBI", "compound", {"status": "ok"}, now=now)
            cache.set("Rhea", "CHEBI:1", {"status": "ok"}, now=now)
            cache.set("UniProt", "RHEA:1", {"status": "upstream_unavailable"}, now=now)
            self.assertIsNotNone(cache.get("ChEBI", "compound", now=now + timedelta(days=20)))
            self.assertIsNone(cache.get("Rhea", "CHEBI:1", now=now + timedelta(days=8)))
            self.assertIsNone(cache.get("UniProt", "RHEA:1", now=now))

    def test_cache_reloads_from_disk(self):
        now = datetime(2026, 8, 2, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            BiochemistryCache(path).set("Rhea", "CHEBI:1", {"status": "no_data"}, now=now)
            self.assertEqual(BiochemistryCache(path).get("Rhea", "CHEBI:1", now=now)["status"], "no_data")


if __name__ == "__main__":
    unittest.main()
