from pathlib import Path
import unittest

from nist_webbook import build_nist_url, parse_nist_presence, query_nist_webbook


FIXTURES = Path(__file__).parent / "fixtures"


class NistWebbookTests(unittest.TestCase):
    def test_builds_canonical_cas_url(self):
        self.assertEqual(build_nist_url("141-78-6"), "https://webbook.nist.gov/cgi/cbook.cgi?ID=C141786&Units=SI&Mask=FFFF")
        with self.assertRaises(ValueError):
            build_nist_url("not-cas")

    def test_parses_supported_presence_sections_without_spectrum_content(self):
        result = parse_nist_presence(FIXTURES.joinpath("nist_webbook_ethyl_acetate.html").read_text(encoding="utf-8"), "141-78-6")
        self.assertEqual([section["type"] for section in result["sections"]], ["ei_ms", "ir", "gc", "vapor_pressure", "henry_constant", "thermochemistry"])
        self.assertTrue(all(section["url"].startswith("https://webbook.nist.gov/") for section in result["sections"]))
        self.assertNotIn("peaks", result)

    def test_valid_page_without_sections_is_no_data(self):
        result = parse_nist_presence(FIXTURES.joinpath("nist_webbook_empty.html").read_text(encoding="utf-8"), "141-78-6")
        self.assertEqual(result["status"], "no_data")
        self.assertEqual(result["sections"], [])

    def test_detects_vapor_pressure_from_antoine_heading(self):
        html = '<html><body><h2 id="Thermo-Phase">Phase change data</h2><h3>Antoine Equation Parameters</h3></body></html>'
        result = parse_nist_presence(html, "141-78-6")
        self.assertEqual(result["sections"], [{"type": "vapor_pressure", "label": "Vapor pressure", "url": build_nist_url("141-78-6") + "#Thermo-Phase"}])

    def test_query_distinguishes_transport_failure(self):
        result = query_nist_webbook("141-78-6", fetch_text=lambda _url: (_ for _ in ()).throw(TimeoutError("offline")))
        self.assertEqual(result["status"], "upstream_unavailable")


if __name__ == "__main__":
    unittest.main()
