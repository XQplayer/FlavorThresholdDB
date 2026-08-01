import unittest

from fema_proxy_server import parse_pubchem_volatile_properties


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
    def test_parses_nested_experimental_properties_and_references(self):
        payload = {
            "Record": {
                "Reference": [
                    {"ReferenceNumber": 1, "SourceName": "HSDB"},
                    {"ReferenceNumber": 2, "SourceName": "ECHA"},
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
        self.assertEqual(result["properties"]["vapor_pressure"][0]["temperature"], "25 °C")
        self.assertEqual(len(result["properties"]["boiling_point"]), 2)

    def test_missing_sections_still_return_all_property_keys(self):
        result = parse_pubchem_volatile_properties({"Record": {}}, 8857)

        self.assertFalse(result["found"])
        self.assertEqual(set(result["properties"]), PROPERTY_KEYS)
        self.assertTrue(all(records == [] for records in result["properties"].values()))


if __name__ == "__main__":
    unittest.main()
