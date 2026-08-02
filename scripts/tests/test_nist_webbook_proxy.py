from datetime import datetime, timedelta, timezone
import unittest

from fema_proxy_server import get_nist_webbook_cached


class NistWebbookCacheTests(unittest.TestCase):
    def test_cache_reuses_current_entry_and_expires_after_seven_days(self):
        now = datetime(2026, 8, 2, tzinfo=timezone.utc)
        calls = []
        cache = {}
        query = lambda cas: calls.append(cas) or {"status": "ok", "found": True, "cas": cas, "sections": [], "retrieved_at": now.isoformat()}
        first, first_cached = get_nist_webbook_cached(cache, "141-78-6", query=query, now=now, persist=lambda *_args: None)
        second, second_cached = get_nist_webbook_cached(cache, "141-78-6", query=query, now=now + timedelta(days=1), persist=lambda *_args: None)
        third, third_cached = get_nist_webbook_cached(cache, "141-78-6", query=query, now=now + timedelta(days=8), persist=lambda *_args: None)
        self.assertEqual(calls, ["141-78-6", "141-78-6"])
        self.assertEqual((first_cached, second_cached, third_cached), (False, True, False))
        self.assertEqual(first["cache_schema_version"], 1)
        self.assertEqual(second["parser_version"], third["parser_version"])

    def test_transient_failure_is_not_cached(self):
        cache = {}
        result, cached = get_nist_webbook_cached(cache, "141-78-6", query=lambda _cas: {"status": "upstream_unavailable"}, persist=lambda *_args: None)
        self.assertFalse(cached)
        self.assertEqual(cache, {})
        self.assertEqual(result["status"], "upstream_unavailable")


if __name__ == "__main__":
    unittest.main()
