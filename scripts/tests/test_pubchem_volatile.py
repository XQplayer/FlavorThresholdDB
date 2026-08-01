import unittest

from fema_proxy_server import parse_pubchem_property_text, parse_pubchem_volatile_properties


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
                parsed = parse_pubchem_property_text(raw)
                self.assertEqual(parsed["normalized_value"], state)
                record = parse_pubchem_volatile_properties(payload, 8857)["properties"]["physical_state"][0]
                self.assertEqual(record["raw_value"], raw)
                self.assertEqual(record["normalized_value"], state)

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


if __name__ == "__main__":
    unittest.main()
