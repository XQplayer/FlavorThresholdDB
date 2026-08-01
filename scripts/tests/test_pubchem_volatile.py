import io
import json
import socket
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
from unittest.mock import patch

import fema_proxy_server
from fema_proxy_server import (
    Handler,
    ThreadingHTTPServer,
    parse_pubchem_property_text,
    parse_pubchem_volatile_properties,
)


PROPERTY_KEYS = {
    "boiling_point",
    "vapor_pressure",
    "henrys_law_constant",
    "water_solubility",
    "experimental_logp",
    "density",
    "melting_point",
    "physical_state",
}


def information(raw_value, reference_number):
    return {
        "ReferenceNumber": reference_number,
        "Value": {"StringWithMarkup": [{"String": raw_value}]},
    }


class PubChemVolatilePropertyParserTests(unittest.TestCase):
    def test_maps_all_supported_upstream_headings_to_stable_keys(self):
        cases = [
            ("Boiling Point", "boiling_point"),
            ("Vapor Pressure", "vapor_pressure"),
            ("Henry's Law Constant", "henrys_law_constant"),
            ("Solubility", "water_solubility"),
            ("LogP", "experimental_logp"),
            ("Density", "density"),
            ("Melting Point", "melting_point"),
            ("Physical Description", "physical_state"),
        ]
        for heading, expected_key in cases:
            payload = {
                "Record": {
                    "Section": [{
                        "TOCHeading": heading,
                        "Information": [information("reported value", 1)],
                    }],
                },
            }
            with self.subTest(heading=heading):
                result = parse_pubchem_volatile_properties(payload, "8857")
                self.assertEqual(len(result["properties"][expected_key]), 1)

    def test_normalizes_only_explicit_property_values_and_conditions(self):
        cases = [
            ("93.2 mm Hg at 25 °C", 93.2, "mmHg", "25 °C", ""),
            ("Henry's Law constant = 1.34X10-4 atm-cu m/mole at 25 °C", 1.34e-4, "atm·m³/mol", "25 °C", ""),
            ("In water, 8.0X10+4 mg/L at 25 °C", 8.0e4, "mg/L", "25 °C", "water"),
            ("Miscible with ethanol and ether", None, "", "", ""),
        ]
        for raw, value, unit, temperature, medium in cases:
            with self.subTest(raw=raw):
                parsed = parse_pubchem_property_text(raw)
                self.assertEqual(parsed["normalized_value"], value)
                self.assertEqual(parsed["unit"], unit)
                self.assertEqual(parsed["temperature"], temperature)
                self.assertEqual(parsed["medium"], medium)

    def test_uses_property_context_to_separate_primary_value_from_conditions(self):
        parsed = parse_pubchem_property_text("78 °C at 760 mm Hg", "boiling_point")

        self.assertEqual(parsed["normalized_value"], 78.0)
        self.assertEqual(parsed["unit"], "°C")
        self.assertEqual(parsed["temperature"], "")
        self.assertEqual(parsed["pressure"], "760 mmHg")

    def test_supports_complete_scientific_notation_without_partial_matches(self):
        cases = [
            ("1.2e-3 mg/L", 1.2e-3),
            ("1.2E+3 mg/L", 1.2e3),
            ("1.2E3 mg/L", 1.2e3),
            ("1.2X10-3 mg/L", 1.2e-3),
            ("1.2×10+3 mg/L", 1.2e3),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                parsed = parse_pubchem_property_text(raw, "water_solubility")
                self.assertEqual(parsed["normalized_value"], expected)
                self.assertEqual(parsed["unit"], "mg/L")

        for raw in ("1.2e mg/L", "1.2e- mg/L", "value e-3 mg/L"):
            with self.subTest(raw=raw):
                parsed = parse_pubchem_property_text(raw, "water_solubility")
                self.assertIsNone(parsed["normalized_value"])
                self.assertEqual(parsed["unit"], "")

    def test_rejects_ambiguous_multiple_range_and_alternative_values(self):
        cases = [
            ("93.2 mm Hg at 25 °C and 100 mm Hg at 30 °C", "vapor_pressure"),
            ("70-80 °C", "boiling_point"),
            ("93.2 mm Hg or 100 mm Hg", "vapor_pressure"),
        ]
        for raw, property_key in cases:
            with self.subTest(raw=raw):
                parsed = parse_pubchem_property_text(raw, property_key)
                self.assertIsNone(parsed["normalized_value"])
                self.assertEqual(parsed["unit"], "")
                self.assertEqual(parsed["temperature"], "")
                self.assertEqual(parsed["pressure"], "")

    def test_normalizes_typical_values_for_all_target_property_types(self):
        cases = [
            ("boiling_point", "77.1 °C", 77.1, "°C", "", ""),
            ("vapor_pressure", "93.2 mm Hg at 25 °C", 93.2, "mmHg", "25 °C", ""),
            ("henrys_law_constant", "1.34E-4 atm-cu m/mole at 25 °C", 1.34e-4, "atm·m³/mol", "25 °C", ""),
            ("water_solubility", "In water, 8.0E+4 mg/L at 25 °C", 8.0e4, "mg/L", "25 °C", "water"),
            ("experimental_logp", "Log Kow = 2.3", 2.3, "", "", ""),
            ("density", "0.9003 g/cm3", 0.9003, "g/cm³", "", ""),
            ("melting_point", "-20 °C", -20.0, "°C", "", ""),
            ("physical_state", "Colorless liquid", "liquid", "", "", ""),
        ]
        for property_key, raw, value, unit, temperature, medium in cases:
            with self.subTest(property_key=property_key):
                parsed = parse_pubchem_property_text(raw, property_key)
                self.assertEqual(parsed["normalized_value"], value)
                self.assertEqual(parsed["unit"], unit)
                self.assertEqual(parsed["temperature"], temperature)
                self.assertEqual(parsed["medium"], medium)

    def test_recognizes_explicit_physical_states_without_replacing_raw_description(self):
        cases = [
            ("A colorless liquid with a fruity odor", "liquid"),
            ("White crystalline solid", "solid"),
            ("Colorless gas", "gas"),
        ]
        for raw, state in cases:
            payload = {
                "Record": {
                    "Section": [{
                        "TOCHeading": "Physical Description",
                        "Information": [information(raw, 1)],
                    }],
                },
            }
            with self.subTest(raw=raw):
                parsed = parse_pubchem_property_text(raw, "physical_state")
                self.assertEqual(parsed["normalized_value"], state)
                record = parse_pubchem_volatile_properties(payload, 8857)["properties"]["physical_state"][0]
                self.assertEqual(record["raw_value"], raw)
                self.assertEqual(record["normalized_value"], state)

    def test_leaves_negated_or_multiple_physical_states_empty(self):
        cases = [
            "liquid or gas",
            "not a liquid, but a solid",
        ]
        for raw in cases:
            with self.subTest(raw=raw):
                parsed = parse_pubchem_property_text(raw, "physical_state")
                self.assertIsNone(parsed["normalized_value"])

    def test_physical_state_deduplicates_repetitions_and_scopes_negation(self):
        cases = [
            ("colorless liquid with no characteristic odor", "liquid"),
            ("liquid; remains liquid at room temperature", "liquid"),
            ("not a liquid", None),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                parsed = parse_pubchem_property_text(raw, "physical_state")
                self.assertEqual(parsed["normalized_value"], expected)

        self.assertIsNone(parse_pubchem_property_text("Colorless liquid")["normalized_value"])

    def test_parses_nested_experimental_properties_and_references(self):
        payload = {
            "Record": {
                "Reference": [
                    {"ReferenceNumber": 1, "SourceName": "HSDB", "URL": "https://example.test/hsdb/1"},
                    {"ReferenceNumber": 2, "SourceName": "HSDB", "URL": "https://example.test/hsdb/2"},
                ],
                "Section": [{
                    "TOCHeading": "Chemical and Physical Properties",
                    "Section": [{
                        "TOCHeading": "Experimental Properties",
                        "Section": [
                            {
                                "TOCHeading": "Boiling Point",
                                "Information": [
                                    information("77.1 °C", 1),
                                    information("77.1 °C", 1),
                                    information("77.1 °C", 2),
                                ],
                            },
                            {
                                "TOCHeading": "Vapor Pressure",
                                "Information": [information("100 mm Hg at 25 °C", 1)],
                            },
                        ],
                    }],
                }],
            },
        }

        result = parse_pubchem_volatile_properties(payload, "8857")

        self.assertTrue(result["found"])
        self.assertEqual(result["cid"], "8857")
        self.assertEqual(
            result["url"],
            "https://pubchem.ncbi.nlm.nih.gov/compound/8857#section=Experimental-Properties",
        )
        self.assertEqual(result["properties"]["boiling_point"][0]["raw_value"], "77.1 °C")
        self.assertEqual(result["properties"]["boiling_point"][0]["source"], "HSDB")
        self.assertEqual(result["properties"]["boiling_point"][0]["source_url"], "https://example.test/hsdb/1")
        self.assertEqual(result["properties"]["vapor_pressure"][0]["temperature"], "25 °C")
        self.assertEqual(len(result["properties"]["boiling_point"]), 2)
        self.assertEqual(
            {record["reference_number"] for record in result["properties"]["boiling_point"]},
            {1, 2},
        )

    def test_missing_sections_still_return_all_property_keys(self):
        result = parse_pubchem_volatile_properties({"Record": {}}, 8857)

        self.assertFalse(result["found"])
        self.assertEqual(set(result["properties"]), PROPERTY_KEYS)
        self.assertTrue(all(records == [] for records in result["properties"].values()))


class PubChemVolatilePropertyQueryTests(unittest.TestCase):
    def test_query_function_is_exposed(self):
        self.assertTrue(hasattr(fema_proxy_server, "query_pubchem_volatile_properties"))

    def test_fetches_experimental_properties_once_at_exact_url(self):
        calls = []
        payload = {"Record": {"Reference": [], "Section": [{
            "TOCHeading": "Boiling Point",
            "Information": [information("77.1 C", 1)],
        }]}}

        result = fema_proxy_server.query_pubchem_volatile_properties(
            " 8857 ", lambda url: calls.append(url) or json.dumps(payload)
        )

        self.assertEqual(calls, [
            "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/8857/JSON?heading=Experimental%20Properties"
        ])
        self.assertEqual(result["status"], "ok")
        self.assertIn("retrieved_at", result)

    def test_optional_record_collections_are_valid_no_data(self):
        for body in (
            '{"Record": {}}',
            '{"Record": {"Section": []}}',
            '{"Record": {"Reference": []}}',
            '{"Record": {"Section": [], "Reference": []}}',
        ):
            with self.subTest(body=body):
                result = fema_proxy_server.query_pubchem_volatile_properties(
                    "8857", lambda _url, value=body: value
                )
                self.assertEqual(result["status"], "no_data")
                self.assertEqual(set(result["properties"]), PROPERTY_KEYS)
                self.assertTrue(all(value == [] for value in result["properties"].values()))
                self.assertIn("retrieved_at", result)

    def test_invalid_cid_does_not_fetch(self):
        for cid in ("8x57", "0", "-1", "１２３"):
            with self.subTest(cid=cid):
                result = fema_proxy_server.query_pubchem_volatile_properties(
                    cid, lambda _url: self.fail("must not fetch")
                )
                self.assertEqual(result["status"], "invalid_cid")
                self.assertEqual(set(result["properties"]), PROPERTY_KEYS)

    def test_canonicalizes_leading_zero_cid(self):
        calls = []
        result = fema_proxy_server.query_pubchem_volatile_properties(
            "0008857",
            lambda url: calls.append(url) or '{"Record": {"Section": [], "Reference": []}}',
        )
        self.assertEqual(result["cid"], "8857")
        self.assertIn("/compound/8857/", calls[0])

    def test_classifies_http_failures(self):
        for code, expected in ((404, "no_data"), (429, "upstream_unavailable"), (500, "upstream_unavailable"), (503, "upstream_unavailable")):
            def fail(url, status=code):
                raise HTTPError(url, status, "failure", {}, io.BytesIO())

            with self.subTest(code=code):
                result = fema_proxy_server.query_pubchem_volatile_properties("8857", fail)
                self.assertEqual(result["status"], expected)

    def test_classifies_transport_failures(self):
        for error in (TimeoutError(), socket.timeout(), URLError("offline")):
            with self.subTest(error=type(error).__name__):
                def fail(_url, exc=error):
                    raise exc
                result = fema_proxy_server.query_pubchem_volatile_properties("8857", fail)
                self.assertEqual(result["status"], "upstream_unavailable")

    def test_classifies_invalid_json_and_html(self):
        for body in (
            "not json",
            "<!doctype html><html></html>",
            "[]",
            '{"Record": null}',
            '{"Record": []}',
        ):
            with self.subTest(body=body):
                result = fema_proxy_server.query_pubchem_volatile_properties("8857", lambda _url, value=body: value)
                self.assertEqual(result["status"], "invalid_response")

    def test_missing_record_is_invalid_response_without_calling_parser(self):
        for body in ("{}", '{"unexpected": true}'):
            with (
                self.subTest(body=body),
                patch.object(fema_proxy_server, "parse_pubchem_volatile_properties") as parser,
            ):
                result = fema_proxy_server.query_pubchem_volatile_properties(
                    "8857", lambda _url, value=body: value
                )
                self.assertEqual(result["status"], "invalid_response")
                parser.assert_not_called()

    def test_malformed_optional_record_collections_do_not_call_parser(self):
        for body in (
            '{"Record": {"Section": null}}',
            '{"Record": {"Section": "bad"}}',
            '{"Record": {"Section": {}}}',
            '{"Record": {"Reference": null}}',
            '{"Record": {"Reference": "bad"}}',
            '{"Record": {"Reference": {}}}',
        ):
            with (
                self.subTest(body=body),
                patch.object(fema_proxy_server, "parse_pubchem_volatile_properties") as parser,
            ):
                result = fema_proxy_server.query_pubchem_volatile_properties(
                    "8857", lambda _url, value=body: value
                )
                self.assertEqual(result["status"], "invalid_response")
                parser.assert_not_called()

    def test_does_not_hide_parser_programming_errors(self):
        for error in (KeyError("bug"), TypeError("bug")):
            with self.subTest(error=type(error).__name__):
                with (
                    patch.object(fema_proxy_server, "parse_pubchem_volatile_properties", side_effect=error),
                    self.assertRaises(type(error)),
                ):
                    fema_proxy_server.query_pubchem_volatile_properties(
                        "8857", lambda _url: '{"Record": {"Section": [], "Reference": []}}'
                    )

    def test_throttle_enforces_five_requests_per_second_without_real_sleep(self):
        now = [10.0]
        sleeps = []
        fema_proxy_server._reset_pubchem_volatile_throttle_for_tests()

        def clock():
            return now[0]

        def sleeper(delay):
            sleeps.append(delay)
            now[0] += delay

        fema_proxy_server._throttled_pubchem_volatile_fetch("one", lambda _url: "{}", clock, sleeper)
        fema_proxy_server._throttled_pubchem_volatile_fetch("two", lambda _url: "{}", clock, sleeper)

        self.assertEqual(sleeps, [0.2])


class PubChemVolatilePropertyHandlerTests(unittest.TestCase):
    def setUp(self):
        Handler.cache = {}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def get_json(self, path):
        with urlopen(f"http://127.0.0.1:{self.server.server_port}{path}") as response:
            return response.status, json.loads(response.read()), response.headers

    def get_error_json(self, path):
        try:
            self.get_json(path)
        except HTTPError as error:
            return error.code, json.loads(error.read()), error.headers
        self.fail("expected HTTP error response")

    def test_pubchem_volatile_endpoint_returns_contract_and_caches_ok(self):
        response = {
            **parse_pubchem_volatile_properties({"Record": {"Section": []}}, "8857"),
            "status": "ok",
            "retrieved_at": "2026-08-02T00:00:00Z",
        }
        with (
            patch.object(fema_proxy_server, "query_pubchem_volatile_properties", return_value=response) as query,
            patch.object(fema_proxy_server, "save_cache"),
        ):
            status, first, headers = self.get_json("/pubchem-volatile?cid=8857")
            _, second, _ = self.get_json("/pubchem-volatile?cid=8857")

        self.assertEqual(status, 200)
        self.assertEqual(set(first["properties"]), PROPERTY_KEYS)
        self.assertEqual(first["status"], "ok")
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(query.call_count, 1)
        self.assertEqual(second["status"], "ok")

    def test_compound_adds_pubchem_volatile_without_removing_existing_fields(self):
        Handler.cache = {
            "pubchem:test": {"found": True, "cid": 8857, "name": "existing"},
            "flavordb:8857": {"found": True, "marker": "flavordb"},
            "flavordb2:molecule:8857": {"found": True, "marker": "flavordb"},
            "flavordb2:compound-entities:8857": {"found": True, "entities": []},
        }
        volatile = {
            **parse_pubchem_volatile_properties({"Record": {}}, "8857"),
            "status": "no_data",
            "retrieved_at": "2026-08-02T00:00:00Z",
        }
        with (
            patch.object(fema_proxy_server, "query_pubchem_volatile_properties", return_value=volatile),
            patch.object(fema_proxy_server, "save_cache"),
        ):
            status, result, _ = self.get_json("/compound?q=test")
            _, cached_result, _ = self.get_json("/compound?q=test")

        self.assertEqual(status, 200)
        self.assertEqual(result["pubchem"]["name"], "existing")
        self.assertEqual(result["flavordb"]["marker"], "flavordb")
        self.assertEqual(result["pubchem_volatile"]["status"], "no_data")
        self.assertFalse(result["pubchem_volatile"]["cached"])
        self.assertTrue(cached_result["pubchem_volatile"]["cached"])

    def test_endpoint_does_not_cache_transient_or_invalid_results(self):
        for result_status in ("upstream_unavailable", "invalid_response", "invalid_cid"):
            Handler.cache = {}
            response = fema_proxy_server._empty_pubchem_volatile("8857", result_status)
            with (
                patch.object(fema_proxy_server, "query_pubchem_volatile_properties", return_value=response) as query,
                patch.object(fema_proxy_server, "save_cache") as save,
            ):
                for _ in range(2):
                    try:
                        self.get_json("/pubchem-volatile?cid=8857")
                    except HTTPError:
                        pass

            with self.subTest(status=result_status):
                self.assertEqual(query.call_count, 2)
                save.assert_not_called()
                self.assertNotIn("pubchem-volatile:8857", Handler.cache)

    def test_no_data_is_cached_with_consistent_cached_flag(self):
        response = {
            **fema_proxy_server._empty_pubchem_volatile("8857", "no_data"),
            "retrieved_at": "2026-08-02T00:00:00Z",
        }
        with (
            patch.object(fema_proxy_server, "query_pubchem_volatile_properties", return_value=response) as query,
            patch.object(fema_proxy_server, "save_cache"),
        ):
            _, first, _ = self.get_json("/pubchem-volatile?cid=0008857")
            _, second, _ = self.get_json("/pubchem-volatile?cid=8857")
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(query.call_count, 1)

    def test_concurrent_same_cid_uses_single_upstream_query(self):
        release = threading.Event()
        started = threading.Event()
        response = {
            **fema_proxy_server._empty_pubchem_volatile("8857", "no_data"),
            "retrieved_at": "2026-08-02T00:00:00Z",
        }

        def slow_query(_cid):
            started.set()
            release.wait(timeout=2)
            return response

        with (
            patch.object(fema_proxy_server, "query_pubchem_volatile_properties", side_effect=slow_query) as query,
            patch.object(fema_proxy_server, "save_cache"),
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            first = pool.submit(self.get_json, "/pubchem-volatile?cid=8857")
            started.wait(timeout=1)
            second = pool.submit(self.get_json, "/pubchem-volatile?cid=0008857")
            release.set()
            results = [first.result(timeout=2), second.result(timeout=2)]

        self.assertEqual(query.call_count, 1)
        self.assertEqual({item[1]["status"] for item in results}, {"no_data"})

    def test_compound_keeps_existing_data_when_volatile_transport_fails(self):
        Handler.cache = {
            "pubchem:test": {"found": True, "cid": 8857, "name": "existing"},
            "flavordb:8857": {"found": True, "marker": "flavordb"},
            "flavordb2:molecule:8857": {"found": True, "marker": "flavordb"},
            "flavordb2:compound-entities:8857": {"found": True, "entities": []},
        }
        unavailable = fema_proxy_server._empty_pubchem_volatile("8857", "upstream_unavailable")
        with patch.object(fema_proxy_server, "query_pubchem_volatile_properties", return_value=unavailable):
            status, result, _ = self.get_json("/compound?q=test")
        self.assertEqual(status, 200)
        self.assertEqual(result["pubchem"]["name"], "existing")
        self.assertEqual(result["flavordb"]["marker"], "flavordb")
        self.assertEqual(result["pubchem_volatile"]["status"], "upstream_unavailable")
        self.assertFalse(result["pubchem_volatile"]["cached"])

    def test_endpoint_returns_stable_json_when_query_raises_transport_error(self):
        with patch.object(fema_proxy_server, "query_pubchem_volatile_properties", side_effect=TimeoutError()):
            status, result, headers = self.get_error_json("/pubchem-volatile?cid=8857")
        self.assertEqual(status, 502)
        self.assertEqual(result["status"], "upstream_unavailable")
        self.assertFalse(result["cached"])
        self.assertEqual(set(result["properties"]), PROPERTY_KEYS)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")

    def test_single_flight_cleans_up_after_exception(self):
        response = {
            **fema_proxy_server._empty_pubchem_volatile("8857", "no_data"),
            "retrieved_at": "2026-08-02T00:00:00Z",
        }
        with (
            patch.object(
                fema_proxy_server,
                "query_pubchem_volatile_properties",
                side_effect=[KeyError("parser bug"), response],
            ),
            patch.object(fema_proxy_server, "save_cache"),
        ):
            with self.assertRaises(KeyError):
                fema_proxy_server._get_pubchem_volatile_cached(Handler.cache, "8857")
            result, cached = fema_proxy_server._get_pubchem_volatile_cached(Handler.cache, "8857")
        self.assertEqual(result["status"], "no_data")
        self.assertFalse(cached)

    def test_concurrent_different_cids_preserve_both_cache_entries_on_disk(self):
        cache = {}

        def result_for(cid):
            return {
                **fema_proxy_server._empty_pubchem_volatile(cid, "no_data"),
                "retrieved_at": "2026-08-02T00:00:00Z",
            }

        with tempfile.TemporaryDirectory() as directory:
            cache_path = fema_proxy_server.Path(directory) / "cache.json"
            with (
                patch.object(fema_proxy_server, "CACHE_PATH", cache_path),
                patch.object(fema_proxy_server, "query_pubchem_volatile_properties", side_effect=result_for),
                ThreadPoolExecutor(max_workers=2) as pool,
            ):
                futures = [
                    pool.submit(fema_proxy_server._get_pubchem_volatile_cached, cache, cid)
                    for cid in ("8857", "176")
                ]
                results = [future.result(timeout=2) for future in futures]

            persisted = json.loads(cache_path.read_text(encoding="utf-8"))

        self.assertEqual(set(cache), {"pubchem-volatile:8857", "pubchem-volatile:176"})
        self.assertEqual(set(persisted), set(cache))
        self.assertTrue(all(cached is False for _, cached in results))

    def test_save_failure_rolls_back_cache_and_cleans_flight(self):
        cache = {}
        response = {
            **fema_proxy_server._empty_pubchem_volatile("8857", "no_data"),
            "retrieved_at": "2026-08-02T00:00:00Z",
        }
        with (
            patch.object(fema_proxy_server, "query_pubchem_volatile_properties", return_value=response) as query,
            patch.object(fema_proxy_server, "save_cache", side_effect=[OSError("disk full"), None]),
        ):
            first, first_cached = fema_proxy_server._get_pubchem_volatile_cached(cache, "8857")
            self.assertNotIn("pubchem-volatile:8857", cache)
            second, second_cached = fema_proxy_server._get_pubchem_volatile_cached(cache, "8857")

        self.assertEqual(first["status"], "no_data")
        self.assertFalse(first_cached)
        self.assertFalse(second_cached)
        self.assertEqual(query.call_count, 2)
        self.assertIn("pubchem-volatile:8857", cache)

    def test_concurrent_transient_followers_are_not_reported_as_cached(self):
        cache = {}
        release = threading.Event()
        started = threading.Event()
        response = fema_proxy_server._empty_pubchem_volatile("8857", "upstream_unavailable")

        def slow_query(_cid):
            started.set()
            release.wait(timeout=2)
            return response

        with (
            patch.object(fema_proxy_server, "query_pubchem_volatile_properties", side_effect=slow_query) as query,
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            first = pool.submit(fema_proxy_server._get_pubchem_volatile_cached, cache, "8857")
            started.wait(timeout=1)
            second = pool.submit(fema_proxy_server._get_pubchem_volatile_cached, cache, "0008857")
            release.set()
            results = [first.result(timeout=2), second.result(timeout=2)]

        self.assertEqual(query.call_count, 1)
        self.assertTrue(all(cached is False for _, cached in results))
        self.assertNotIn("pubchem-volatile:8857", cache)


if __name__ == "__main__":
    unittest.main()
