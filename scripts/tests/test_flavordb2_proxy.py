import json
import threading
import unittest
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
from unittest.mock import patch

import fema_proxy_server

from fema_proxy_server import (
    FLAVORDB_BASE_URL,
    Handler,
    ThreadingHTTPServer,
    parse_flavordb2_entities,
    parse_flavordb2_entity_detail,
    parse_flavordb2_molecule_entities,
    query_flavordb2_entities,
    query_flavordb2_entity,
    query_flavordb2_molecule_entities,
)


class FlavorDB2ProxyParsingTests(unittest.TestCase):
    def test_uses_flavordb2_as_the_upstream(self):
        self.assertEqual(FLAVORDB_BASE_URL, "https://cosylab.iiitd.edu.in/flavordb2")

    def test_parses_compound_to_food_entity_relationships(self):
        html = """
        <h4>Entities that contain <strong>Ethyl Acetate</strong></h4>
        <li><a href="/flavordb2/entity_details?id=2"><strong>Bread</strong></a></li>
        <li><a href="/flavordb2/entity_details?id=245"><strong>Vanilla</strong></a></li>
        """

        result = parse_flavordb2_molecule_entities(html, "8857")

        self.assertTrue(result["found"])
        self.assertEqual(result["cid"], "8857")
        self.assertEqual(
            result["entities"],
            [
                {
                    "id": 2,
                    "name": "Bread",
                    "url": "https://cosylab.iiitd.edu.in/flavordb2/entity_details?id=2",
                },
                {
                    "id": 245,
                    "name": "Vanilla",
                    "url": "https://cosylab.iiitd.edu.in/flavordb2/entity_details?id=245",
                },
            ],
        )

    def test_decodes_entity_search_double_encoded_json(self):
        upstream = json.dumps(json.dumps([
            {
                "entity_id": 245,
                "category_readable": "Fruit Essence",
                "entity_alias_readable": "Vanilla",
                "entity_alias_synonyms": "Vanilla",
                "natural_source_name": "Vanilla",
                "natural_source_url": "https://en.wikipedia.org/wiki/Vanilla_(genus)",
            }
        ]))

        result = parse_flavordb2_entities(upstream)

        self.assertEqual(result[0]["id"], 245)
        self.assertEqual(result[0]["name"], "Vanilla")
        self.assertEqual(result[0]["category"], "Fruit Essence")
        self.assertEqual(result[0]["natural_source"]["name"], "Vanilla")

    def test_parses_food_entity_and_its_compounds(self):
        html = """
        <div id="entity_details"><h1>Vanilla</h1>
          <h5>Category: <strong><span>Fruit Essence</span></strong></h5>
          <h5>Synonyms: <strong><span>Vanilla, Bourbon vanilla</span></strong></h5>
          <td>Natural Source of <strong>Vanilla</strong>:</td><td>Vanilla</td>
          <tr><td>Kingdom:</td><td>Plantae</td></tr>
          <tr><td>Family:</td><td>Orchidaceae</td></tr>
        </div>
        <h2>Flavor Molecules in <strong>Vanilla</strong></h2>
        <table id="molecules"><tbody>
          <tr><td>coumarin</td><td><a href="https://pubchem.ncbi.nlm.nih.gov/compound/323">323</a></td>
              <td><a>sweet</a>, <a>green</a></td><td><button id="323">More info.</button></td></tr>
        </tbody></table>
        """

        result = parse_flavordb2_entity_detail(html, "245")

        self.assertTrue(result["found"])
        self.assertEqual(result["name"], "Vanilla")
        self.assertEqual(result["category"], "Fruit Essence")
        self.assertEqual(result["natural_source"]["taxonomy"]["kingdom"], "Plantae")
        self.assertEqual(result["compounds"][0]["cid"], 323)
        self.assertEqual(result["compounds"][0]["flavor_profile"], ["sweet", "green"])

    def test_queries_each_official_flavordb2_endpoint(self):
        requested_urls = []

        def fetcher(url):
            requested_urls.append(url)
            if "/molecules_details" in url:
                return '<a href="/flavordb2/entity_details?id=245"><strong>Vanilla</strong></a>'
            if "/entity_details" in url:
                return '<div id="entity_details"><h1>Vanilla</h1></div>'
            return json.dumps(json.dumps([{"entity_id": 245, "entity_alias_readable": "Vanilla"}]))

        related = query_flavordb2_molecule_entities("8857", fetcher=fetcher)
        search = query_flavordb2_entities("vanilla", fetcher=fetcher)
        entity = query_flavordb2_entity("245", fetcher=fetcher)

        self.assertEqual(related["entities"][0]["id"], 245)
        self.assertEqual(search["entities"][0]["name"], "Vanilla")
        self.assertEqual(entity["name"], "Vanilla")
        self.assertEqual(requested_urls, [
            "https://cosylab.iiitd.edu.in/flavordb2/molecules_details?id=8857",
            "https://cosylab.iiitd.edu.in/flavordb2/entities?entity=vanilla",
            "https://cosylab.iiitd.edu.in/flavordb2/entity_details?id=245",
        ])


class FlavorDB2CompoundIsolationTests(unittest.TestCase):
    def setUp(self):
        Handler.cache = {
            "pubchem:test": {"found": True, "cid": 8857, "name": "existing"},
            "flavordb2:molecule:8857": {"found": True, "marker": "legacy-flavordb"},
            "pubchem-volatile:8857": {
                **fema_proxy_server._empty_pubchem_volatile("8857", "no_data"),
                "schema_version": fema_proxy_server.PUBCHEM_VOLATILE_CACHE_SCHEMA_VERSION,
                "parser_version": fema_proxy_server.PUBCHEM_VOLATILE_PARSER_VERSION,
                "retrieved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            },
        }
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def get_compound(self):
        with urlopen(f"http://127.0.0.1:{self.server.server_port}/compound?q=test") as response:
            return response.status, json.loads(response.read())

    def test_entity_enrichment_failures_do_not_break_compound(self):
        for error in (TimeoutError(), URLError("offline"), RuntimeError("bad response")):
            Handler.cache.pop("flavordb2:compound-entities:8857", None)
            with (
                self.subTest(error=type(error).__name__),
                patch.object(
                    fema_proxy_server,
                    "query_flavordb2_molecule_entities",
                    side_effect=error,
                ),
                patch.object(fema_proxy_server, "save_cache"),
            ):
                status, result = self.get_compound()

            self.assertEqual(status, 200)
            self.assertEqual(result["pubchem"]["name"], "existing")
            self.assertEqual(result["flavordb"]["marker"], "legacy-flavordb")
            self.assertEqual(result["pubchem_volatile"]["status"], "no_data")
            self.assertFalse(result["flavordb2_entities"]["found"])
            self.assertIn("error", result["flavordb2_entities"])

    def test_legacy_flavordb_enrichment_failure_still_returns_volatile(self):
        Handler.cache.pop("flavordb2:molecule:8857", None)
        Handler.cache["flavordb2:compound-entities:8857"] = {"found": True, "entities": []}
        with (
            patch.object(fema_proxy_server, "query_flavordb", side_effect=RuntimeError("legacy failed")),
            patch.object(fema_proxy_server, "save_cache"),
        ):
            status, result = self.get_compound()

        self.assertEqual(status, 200)
        self.assertFalse(result["flavordb"]["found"])
        self.assertIn("legacy failed", result["flavordb"]["error"])
        self.assertEqual(result["pubchem_volatile"]["status"], "no_data")


class FlavorDB2EndpointCacheFailureTests(unittest.TestCase):
    def setUp(self):
        Handler.cache = {}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def get_error_json(self, path):
        try:
            urlopen(f"http://127.0.0.1:{self.server.server_port}{path}")
        except HTTPError as error:
            return error.code, json.loads(error.read())
        self.fail("expected endpoint failure")

    def test_save_failure_rolls_back_each_endpoint_cache_entry(self):
        cases = (
            (
                "/flavordb2/compound-entities?cid=8857",
                "flavordb2:compound-entities:8857",
                "query_flavordb2_molecule_entities",
                {"found": True, "cid": "8857", "entities": []},
            ),
            (
                "/flavordb2/entities?q=vanilla",
                "flavordb2:entities:vanilla",
                "query_flavordb2_entities",
                {"found": True, "query": "vanilla", "entities": []},
            ),
            (
                "/flavordb2/entity?id=245",
                "flavordb2:entity:245",
                "query_flavordb2_entity",
                {"found": True, "id": 245, "name": "Vanilla"},
            ),
        )
        for path, cache_key, query_name, response in cases:
            Handler.cache = {}
            with (
                self.subTest(path=path),
                patch.object(
                    fema_proxy_server,
                    query_name,
                    side_effect=[response, AssertionError("must query again")],
                ) as query,
                patch.object(fema_proxy_server, "save_cache", side_effect=OSError("disk full")),
            ):
                first_status, first = self.get_error_json(path)
                second_status, second = self.get_error_json(path)

            self.assertEqual((first_status, second_status), (502, 502))
            self.assertFalse(first["cached"])
            self.assertFalse(second["cached"])
            self.assertNotIn(cache_key, Handler.cache)
            self.assertEqual(query.call_count, 2)


if __name__ == "__main__":
    unittest.main()
