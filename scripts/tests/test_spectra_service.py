import unittest

from spectra_service import (
    assess_compatibility,
    compare_spectra,
    match_peaks,
    normalize_spectrum_record,
    rank_identity_match,
)


class SpectrumIdentityTests(unittest.TestCase):
    def setUp(self):
        self.target = {
            "inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N",
            "cas": "141-78-6",
            "smiles": "CCOC(=O)C",
            "names": ["乙酸乙酯", "ethyl acetate"],
        }

    def test_full_inchikey_is_the_strongest_identity_match(self):
        match = rank_identity_match(
            self.target,
            {"inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N", "cas": "999-99-9"},
        )
        self.assertEqual(match, {"type": "inchikey_exact", "rank": 5, "verified": True})

    def test_connectivity_inchikey_is_flagged_for_structure_review(self):
        match = rank_identity_match(
            self.target,
            {"inchikey": "XEKOWRVHYACXOJ-AAAAAAAAAA-N"},
        )
        self.assertEqual(match, {"type": "inchikey_connectivity", "rank": 4, "verified": True})

    def test_cas_exact_match_is_verified(self):
        match = rank_identity_match(self.target, {"cas": "141-78-6"})
        self.assertEqual(match, {"type": "cas_exact", "rank": 3, "verified": True})

    def test_smiles_exact_match_is_verified_below_cas(self):
        match = rank_identity_match(self.target, {"smiles": "CCOC(=O)C"})
        self.assertEqual(match, {"type": "smiles_exact", "rank": 2, "verified": True})

    def test_name_only_match_remains_unverified(self):
        match = rank_identity_match(self.target, {"name": " Ethyl   Acetate "})
        self.assertEqual(match, {"type": "name_exact", "rank": 1, "verified": False})


class SpectrumContractTests(unittest.TestCase):
    def test_normalizes_peaks_and_retains_provenance(self):
        record = normalize_spectrum_record(
            {
                "spectrum_id": "CCMSLIB00000000001",
                "source": "GNPS",
                "source_url": "https://example.test/spectrum/1",
                "license": "CC0-1.0",
                "retrieved_at": "2026-08-02T12:00:00Z",
                "compound_identity": {
                    "inchikey": "XEKOWRVHYACXOJ-UHFFFAOYSA-N",
                    "match_type": "inchikey_exact",
                },
                "spectrum_type": "MS2",
                "ms_level": "2",
                "ion_mode": " Positive ",
                "ionization": "ESI",
                "adduct": "M+H",
                "precursor_mz": "89.0597",
                "peaks": [[61.0287, 10], [43.0182, 20], [43.0182, 5], [99, -1], ["bad", 4]],
            }
        )

        self.assertEqual(record["ms_level"], 2)
        self.assertEqual(record["ion_mode"], "positive")
        self.assertEqual(record["adduct"], "[M+H]+")
        self.assertEqual(record["precursor_mz"], 89.0597)
        self.assertEqual(record["peaks"], [[43.0182, 100.0], [61.0287, 40.0]])
        self.assertEqual(record["source"], "GNPS")
        self.assertEqual(record["source_url"], "https://example.test/spectrum/1")
        self.assertEqual(record["license"], "CC0-1.0")
        self.assertEqual(record["retrieved_at"], "2026-08-02T12:00:00Z")

    def test_required_provenance_fields_are_always_present(self):
        record = normalize_spectrum_record({"spectrum_id": "MB-1", "source": "MassBank", "peaks": []})
        for field in ("spectrum_id", "source", "source_url", "license", "retrieved_at"):
            self.assertIn(field, record)


class SpectrumComparisonTests(unittest.TestCase):
    def test_ei_and_ms2_are_not_scored_together(self):
        compatibility = assess_compatibility(
            {"spectrum_type": "EI", "ms_level": 1, "ion_mode": "positive"},
            {"spectrum_type": "MS2", "ms_level": 2, "ion_mode": "positive"},
        )
        self.assertFalse(compatibility["comparable"])
        self.assertIn("spectrum_type", compatibility["blocking_reasons"])

    def test_ms2_with_different_ion_modes_is_scored_with_warning(self):
        compatibility = assess_compatibility(
            {"spectrum_type": "MS2", "ms_level": 2, "ion_mode": "positive"},
            {"spectrum_type": "MS2", "ms_level": 2, "ion_mode": "negative"},
        )
        self.assertTrue(compatibility["comparable"])
        self.assertIn("ion_mode", compatibility["warnings"])

    def test_tolerance_boundary_is_inclusive_and_peak_is_used_once(self):
        matches = match_peaks(
            [[100.0, 100.0], [100.01, 50.0]],
            [[100.02, 80.0]],
            tolerance=0.02,
        )
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["a_index"], 1)
        self.assertEqual(matches[0]["b_index"], 0)

    def test_identical_spectra_have_unit_score_and_complete_coverage(self):
        result = compare_spectra(
            {"spectrum_type": "EI", "ms_level": 1, "peaks": [[43, 100], [61, 50]]},
            {"spectrum_type": "EI", "ms_level": 1, "peaks": [[43, 100], [61, 50]]},
            tolerance=0.1,
        )
        self.assertEqual(result["similarity"], 1.0)
        self.assertEqual(result["matched_peak_count"], 2)
        self.assertEqual(result["coverage_a"], 1.0)
        self.assertEqual(result["coverage_b"], 1.0)

    def test_incompatible_spectra_return_no_similarity(self):
        result = compare_spectra(
            {"spectrum_type": "EI", "ms_level": 1, "peaks": [[43, 100]]},
            {"spectrum_type": "MS2", "ms_level": 2, "peaks": [[43, 100]]},
        )
        self.assertIsNone(result["similarity"])
        self.assertEqual(result["matched_peak_count"], 0)


if __name__ == "__main__":
    unittest.main()
