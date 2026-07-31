import json
import unittest
from pathlib import Path

import rebuild_book_knowledge_index as pipeline


class BookIndexPipelineTests(unittest.TestCase):
    def test_quality_gates_fail_on_regressed_counts_or_gold_cases(self):
        qa = {
            "pages": 640,
            "records": 4863,
            "entities": 627,
            "thresholds": 1970,
            "bad_patterns": {"bad_unit": 0},
            "anomaly_summary": {"unknown_medium": 43},
            "gold_standard": {"total": 5, "passed": 5},
            "threshold_gold_standard": {"total": 81, "passed": 80},
            "queries_without_hits": [],
        }
        config = {
            "minimum_counts": {"pages": 640, "records": 4800, "entities": 620, "thresholds": 1900},
            "maximum_anomalies": {"unknown_medium": 43, "ambiguous_unit": 0},
            "require_zero_bad_patterns": True,
            "require_all_gold": True,
            "require_no_missed_queries": True,
        }
        result = pipeline.evaluate_quality_gates(qa, config)
        self.assertFalse(result["passed"])
        self.assertIn("threshold_gold_standard", [check["name"] for check in result["failed_checks"]])

    def test_finds_only_source_verified_record_identity_correction_in_block_range(self):
        corrections = [{
            "page": 511,
            "start_block": 3,
            "end_block": 5,
            "corrected_cas": "80-56-8",
        }]
        self.assertEqual(
            pipeline.find_record_identity_correction(corrections, 511, 4)["corrected_cas"],
            "80-56-8",
        )
        self.assertIsNone(pipeline.find_record_identity_correction(corrections, 511, 6))
        self.assertIsNone(pipeline.find_record_identity_correction(corrections, 510, 4))

    def test_splits_leading_threshold_from_new_entity_profile_in_same_block(self):
        text = "PCA呈霉味，嗅阈值4μg/L。TBA（tribromoanisole），CAS号607-99-8。"
        segments = pipeline.split_transitioning_entity_segments(
            text, {"1825-21-4", "607-99-8"}, "1825-21-4"
        )
        self.assertEqual([cas for cas, _ in segments], ["1825-21-4", "607-99-8"])
        self.assertIn("嗅阈值4μg/L", segments[0][1])

    def test_does_not_treat_parenthesized_wine_medium_as_casless_compound_profile(self):
        text = "非芳香强化白葡萄酒（用乙醇强化至酒精度约21%vol）中嗅阈值1600μg/L。"
        self.assertIsNone(pipeline.extract_casless_profile_subject(text))
        thresholds = pipeline.extract_thresholds(text, page=531, entity_cas="43052-87-5")
        self.assertEqual(thresholds[0]["media"], ["葡萄酒"])
        self.assertEqual(thresholds[0]["medium_detail"], "21%vol")

    def test_extracts_prefixed_peptide_and_alias_subjects(self):
        self.assertEqual(
            pipeline.extract_threshold_subject("八肽Arg-Arg-Pro-Pro-Pro-Phe-Phe-Phe，呈苦味，水中苦味阈值0.002mmol/L。"),
            "Arg-Arg-Pro-Pro-Pro-Phe-Phe-Phe",
        )
        self.assertEqual(
            pipeline.extract_threshold_subject("九肽YPFPGPIPN呈苦味，水中苦味阈值230μmol/L。"),
            "YPFPGPIPN",
        )
        self.assertEqual(
            pipeline.extract_threshold_subject("最新发现的结合物，即（S）-莫雷德[（S）-morelid]，分子式C10H16O10，呈鲜味，水中鲜味阈值6mmol/L。"),
            "（S）-莫雷德",
        )

    def test_extracts_trailing_peptide_fragment_for_next_ocr_block(self):
        self.assertEqual(pipeline.extract_trailing_subject_fragment("Leu-Asp呈苦味。Leu-Gly"), "Leu-Gly")

    def test_normalizes_common_ocr_unit_errors(self):
        text = "水中阈值 10pLg/L，空气中阈值 20ug/L，另有 3mg/Lo 和230umol/L"
        normalized = pipeline.normalize_text(text)
        self.assertIn("10μg/L", normalized)
        self.assertIn("20μg/L", normalized)
        self.assertIn("3mg/L", normalized)
        self.assertIn("230μmol/L", normalized)
        self.assertEqual(pipeline.normalize_text("模拟葡萄酒中嘎阈值20μg/L"), "模拟葡萄酒中嗅阈值20μg/L")

    def test_normalizes_spaces_inside_cas_numbers(self):
        normalized = pipeline.normalize_text("CAS号600- 07-7，另见 75 -07- 0。")
        self.assertIn("600-07-7", normalized)
        self.assertIn("75-07-0", normalized)
        self.assertIn("53448-07-0", pipeline.normalize_text("CAS号53448-07=0"))

    def test_preserves_ambiguous_pg_and_alcohol_percentages(self):
        text = "水中阈值0.05pg/L，另在4%vol和6%vol酒精水溶液中测定。"
        normalized = pipeline.normalize_text(text)
        self.assertIn("0.05pg/L", normalized)
        self.assertIn("4%vol", normalized)
        self.assertIn("6%vol", normalized)

    def test_splits_thresholds_by_medium_clause(self):
        text = (
            "水中嗅阈值10μg/L或20μg/L，10%vol酒精-水溶液中嗅阈值1.8mg/L，"
            "啤酒中嗅阈值1000μg/L。"
        )
        thresholds = pipeline.extract_thresholds(text, page=10, entity_cas="554-12-1")
        self.assertEqual([item["media"][0] for item in thresholds], ["水", "乙醇-水", "啤酒"])
        self.assertEqual(thresholds[0]["values"][0]["unit"], "μg/L")
        self.assertEqual(thresholds[1]["values"][0]["low"], "1.8")
        self.assertTrue(thresholds[1]["raw_text"].startswith("10%vol"))

    def test_splits_ocr_spaced_alcohol_medium_and_ignores_incidental_detection_word(self):
        text = (
            "水中嗅阈值130μg/L，10%vol酒精-水溶液 中嗅阈值15mg/L。"
            "水中嗅阈值4μg/L，已经在啤酒中检测到。"
        )
        thresholds = pipeline.extract_thresholds(text, page=1, entity_cas="123-45-6")
        self.assertEqual([item["media"][0] for item in thresholds], ["水", "乙醇-水", "水"])
        self.assertEqual([item["threshold_type"] for item in thresholds], ["odor", "odor", "odor"])
        self.assertIsNone(thresholds[0]["medium_detail"])
        self.assertEqual(thresholds[1]["medium_detail"], "10%vol")

    def test_splits_detection_and_recognition_values_with_shared_medium(self):
        thresholds = pipeline.extract_thresholds(
            "水中嗅觉觉察阈值27μg/L，识别阈值47μg/L或50~200μg/L。",
            page=227,
            entity_cas="123-11-5",
        )
        self.assertEqual(len(thresholds), 2)
        self.assertEqual([item["media"] for item in thresholds], [["水"], ["水"]])
        self.assertEqual([item["threshold_type"] for item in thresholds], ["detection", "recognition"])
        self.assertEqual([value["low"] for value in thresholds[0]["values"]], ["27"])
        self.assertEqual([value["low"] for value in thresholds[1]["values"]], ["47", "50"])

    def test_normalizes_ocr_recognition_valve_variant_before_stage_split(self):
        thresholds = pipeline.extract_thresholds(
            "水中嗅觉觉察阈值9.7μg/L，识别阀值27μg/L或30~65μg/L。",
            page=346,
            entity_cas="104-61-0",
        )
        self.assertEqual(len(thresholds), 2)
        self.assertEqual([item["threshold_type"] for item in thresholds], ["detection", "recognition"])
        self.assertEqual([value["low"] for value in thresholds[0]["values"]], ["9.7"])
        self.assertEqual([value["low"] for value in thresholds[1]["values"]], ["27", "30"])

    def test_normalizes_ocr_space_inside_recognition_before_stage_split(self):
        thresholds = pipeline.extract_thresholds(
            "水中嗅觉觉察阈值0.43μg/L，嗅觉识 别阈值1.4μg/L或0.2μg/L。",
            page=461,
            entity_cas="3268-49-3",
        )
        self.assertEqual(len(thresholds), 2)
        self.assertEqual([item["threshold_type"] for item in thresholds], ["detection", "recognition"])
        self.assertEqual([value["low"] for value in thresholds[0]["values"]], ["0.43"])
        self.assertEqual([value["low"] for value in thresholds[1]["values"]], ["1.4", "0.2"])

    def test_preserves_orthonasal_and_retronasal_routes_when_splitting_stages(self):
        thresholds = pipeline.extract_thresholds(
            "水中癸醛前鼻嗅阈值2μg/L，后鼻嗅阈值3.2μg/L。",
            page=25,
            entity_cas=None,
            record_id="book-flavor-chemistry-p0025-b02",
        )
        self.assertEqual([item["sensory_route"] for item in thresholds], ["orthonasal", "retronasal"])
        self.assertIn("前鼻嗅阈值2μg/L", thresholds[0]["raw_text"])
        self.assertIn("后鼻嗅阈值3.2μg/L", thresholds[1]["raw_text"])
        self.assertNotIn("前鼻嗅阈值3.2μg/L", thresholds[1]["raw_text"])

    def test_splits_mass_fraction_alcohol_water_medium(self):
        thresholds = pipeline.extract_thresholds(
            "水中嗅阈值5~10μg/L，10%（质量分数）酒精-水溶液中阈值0.8μg/L。",
            page=459,
            entity_cas="7783-06-4",
        )
        self.assertEqual([item["media"] for item in thresholds], [["水"], ["乙醇-水"]])
        self.assertEqual([item["medium_detail"] for item in thresholds], [None, "10% w/w"])
        self.assertEqual([value["low"] for value in thresholds[0]["values"]], ["5"])
        self.assertEqual([value["low"] for value in thresholds[1]["values"]], ["0.8"])

    def test_splits_starch_and_cellulose_after_alcohol_medium(self):
        thresholds = pipeline.extract_thresholds(
            "46%vol酒精-水溶液中嗅阈值7.12μg/L，淀粉中嗅阈值0.27μg/kg，纤维素中嗅阈值9μg/kg。",
            page=461,
            entity_cas="3268-49-3",
        )
        self.assertEqual([item["media"] for item in thresholds], [["乙醇-水"], ["淀粉"], ["纤维素"]])
        self.assertEqual([item["medium_detail"] for item in thresholds], ["46%vol", None, None])

    def test_normalizes_spaces_and_ocr_variants_in_odor_threshold_signal(self):
        thresholds = pipeline.extract_thresholds(
            "水中嗅 阈值1.3μg/L，葡萄酒中噢 阈值4.3μg/L。",
            page=1,
            entity_cas="123-45-6",
        )
        self.assertEqual([item["threshold_type"] for item in thresholds], ["odor", "odor"])
        self.assertEqual([item["media"] for item in thresholds], [["水"], ["葡萄酒"]])

    def test_splits_recognition_odor_word_order_variant(self):
        thresholds = pipeline.extract_thresholds(
            "水中嗅觉觉察阈值14μg/L，识别气味阈值41μg/L或6μg/L。",
            page=511,
            entity_cas="80-56-8",
        )
        self.assertEqual([item["threshold_type"] for item in thresholds], ["detection", "recognition"])
        self.assertEqual([value["low"] for value in thresholds[0]["values"]], ["14"])
        self.assertEqual([value["low"] for value in thresholds[1]["values"]], ["41", "6"])

    def test_recognizes_specialized_food_and_model_media(self):
        text = (
            "模拟葡萄酒中嗅阈值1μg/L。"
            "干酪中味阈值2μmol/kg。"
            "鸡汤中厚味阈值0.2mmol/L。"
            "油中前鼻嗅阈值3μg/kg。"
            "水溶液苦味阈值4mmol/L。"
            "12%vol酒精-水溶液（pH3.4）中嗅阈值0.5μg/L。"
        )
        thresholds = pipeline.extract_thresholds(text, page=1, entity_cas="123-45-6")
        self.assertEqual(
            [item["media"][0] for item in thresholds],
            ["模拟葡萄酒", "干酪", "鸡汤", "油相", "水", "乙醇-水"],
        )

    def test_splits_msg_and_imp_experimental_media(self):
        thresholds = pipeline.extract_thresholds(
            "在5mmol/L的MSG溶液中酸味阈值0.019mg/L，在5mmol/L的IMP溶液中酸味阈值0.3mg/L。",
            page=154,
            entity_cas="526-83-0",
        )
        self.assertEqual([item["media"][0] for item in thresholds], ["MSG溶液", "IMP溶液"])
        self.assertEqual(thresholds[0]["context_values"][0]["low"], "5")
        self.assertEqual(thresholds[1]["context_values"][0]["low"], "5")

    def test_recognizes_ocr_spaced_and_dairy_media(self):
        text = (
            "在空 气中嗅阈值0.02ng/L。"
            "啤酒 中嗅阈值1.5ng/L。"
            "红葡 萄酒中嗅阈值75μg/L。"
            "乳脂中味阈值60mg/kg。"
            "椰子脂中味阈值160mg/kg。"
            "牛乳中苦味阈值1100mg/kg。"
            "糖-酸溶液中嗅阈值0.9μg/L。"
            "无嗅橘子汁中味阈值4μg/L。"
        )
        thresholds = pipeline.extract_thresholds(text, page=1, entity_cas="123-45-6")
        self.assertEqual(
            [item["media"][0] for item in thresholds],
            ["空气", "啤酒", "葡萄酒", "乳脂", "椰子脂", "牛乳", "糖-酸溶液", "果汁"],
        )

    def test_flags_ambiguous_thresholds_without_changing_source_values(self):
        thresholds = pipeline.extract_thresholds(
            "嗅阈值0.05pg/L，水中嗅阈值9999mg/L。",
            page=100,
            entity_cas=None,
        )
        self.assertEqual(thresholds[0]["values"][0]["unit"], "pg/L")
        self.assertEqual(thresholds[0]["review_status"], "needs_review")
        self.assertEqual(
            {flag["category"] for flag in thresholds[0]["review_flags"]},
            {"ambiguous_unit", "unknown_medium", "missing_entity"},
        )
        self.assertIn(
            "suspicious_magnitude",
            {flag["category"] for flag in thresholds[1]["review_flags"]},
        )

    def test_preserves_chinese_threshold_comparators_as_machine_readable_bounds(self):
        thresholds = pipeline.extract_thresholds(
            "苹果汁中识别阈值大于250μg/L，水中嗅阈值不低于2μg/L。",
            page=1,
            entity_cas="123-45-6",
        )
        self.assertEqual(thresholds[0]["values"][0]["low"], ">250")
        self.assertEqual(thresholds[1]["values"][0]["low"], "≥2")

    def test_does_not_flag_plausible_high_taste_thresholds_as_magnitude_errors(self):
        taste = pipeline.extract_thresholds(
            "亮氨酸呈苦味，水溶液中苦味阈值1900mg/L。",
            page=422,
            entity_cas="61-90-5",
        )
        self.assertNotIn(
            "suspicious_magnitude",
            {flag["category"] for flag in taste[0]["review_flags"]},
        )
        odor = pipeline.extract_thresholds(
            "水中嗅阈值1900mg/L。",
            page=1,
            entity_cas="123-45-6",
        )
        self.assertIn(
            "suspicious_magnitude",
            {flag["category"] for flag in odor[0]["review_flags"]},
        )

    def test_classifies_chinese_odor_and_taste_thresholds_without_overlap(self):
        odor = pipeline.extract_thresholds(
            "啤酒中气味阈值500μg/L。", page=45, entity_cas="112-42-5"
        )
        taste = pipeline.extract_thresholds(
            "水中味阈值500μg/L。", page=45, entity_cas="112-42-5"
        )
        self.assertEqual(odor[0]["threshold_type"], "odor")
        self.assertEqual(taste[0]["threshold_type"], "taste")

    def test_classifies_spaced_generic_and_acceptance_threshold_labels(self):
        self.assertEqual(pipeline.threshold_type("10%vol酒精-水溶液中气味 阈值306mg/L"), "odor")
        self.assertEqual(pipeline.threshold_type("水中苦味 阈值10mmol/L"), "taste")
        self.assertEqual(pipeline.threshold_type("水溶液中口感阈值0.12mmol/L"), "taste")
        self.assertEqual(pipeline.threshold_type("消费者可以接受的阈值是27.5μg/L"), "acceptance")
        self.assertEqual(pipeline.threshold_type("有着低感官阈值5~20ng/L"), "sensory")
        self.assertEqual(pipeline.threshold_type("该化合物阈值20μg/L"), "unspecified")

    def test_separates_thresholds_from_matrix_components_and_sample_concentrations(self):
        text = (
            "模拟葡萄酒（10%vol酒精-水溶液，7g/L甘油，5g/L酒石酸）中嗅阈值0.5μg/L；"
            "葡萄酒中含量17μg/L，嗅阈值200μg/L。"
        )
        thresholds = pipeline.extract_thresholds(text, page=20, entity_cas="123-45-6")
        self.assertEqual(
            [[value["low"] for value in item["values"]] for item in thresholds],
            [["0.5"], ["200"]],
        )
        self.assertEqual(
            [value["role"] for value in thresholds[0]["context_values"]],
            ["matrix_component", "matrix_component"],
        )
        self.assertEqual(thresholds[1]["context_values"][0]["role"], "sample_concentration")

    def test_splits_media_clauses_even_when_ocr_inserts_spaces(self):
        thresholds = pipeline.extract_thresholds(
            "14%vol酒精-水溶液中嗅阈值5mg/L，46%vol酒精-水溶 液中嗅阈值19.02mg/L。",
            page=183,
            entity_cas="554-12-1",
            record_id="book-flavor-chemistry-p0183-b11",
        )
        self.assertEqual(len(thresholds), 2)
        self.assertEqual([item["values"][0]["low"] for item in thresholds], ["5", "19.02"])
        self.assertEqual([item["medium_detail"] for item in thresholds], ["14%vol", "46%vol"])

    def test_splits_repeated_odor_stages_when_the_medium_changes(self):
        thresholds = pipeline.extract_thresholds(
            "模型葡萄酒中嗅阈值100mg/L，清酒中嗅阈值25mg/L，葡萄蒸馏酒中嗅阈值30mg/L，油中嗅阈值0.2μg/kg。",
            page=78,
            entity_cas="75-07-0",
        )
        self.assertEqual(
            [item["media"][0] for item in thresholds],
            ["模拟葡萄酒", "清酒", "蒸馏酒", "油相"],
        )

    def test_preserves_strength_prefix_for_model_wine(self):
        thresholds = pipeline.extract_thresholds(
            "10%vol酒精-水溶液中嗅阈值10mg/L，11%vol模拟葡萄酒中嗅阈值14mg/L。",
            page=222,
            entity_cas="60-12-8",
            record_id="book-flavor-chemistry-p0222-b09",
        )
        self.assertEqual(len(thresholds), 2)
        self.assertEqual(thresholds[1]["media"], ["模拟葡萄酒"])
        self.assertEqual(thresholds[1]["medium_detail"], "11%vol")

    def test_medium_detail_ignores_strength_from_a_trailing_incomplete_medium(self):
        clause = "水中觉察阈值490μg/L，识别阈值1.2mg/L，10%vol酒精-"
        self.assertIsNone(pipeline.extract_medium_detail(clause))

    def test_splits_model_wine_from_following_wine_medium(self):
        thresholds = pipeline.extract_thresholds(
            "模拟葡萄酒中嗅阈值20μg/L，红葡萄酒中嗅阈值40μg/L。",
            page=54,
            entity_cas="3391-86-4",
        )
        self.assertEqual([item["media"][0] for item in thresholds], ["模拟葡萄酒", "葡萄酒"])
        self.assertEqual([item["values"][0]["low"] for item in thresholds], ["20", "40"])
        self.assertTrue(thresholds[1]["raw_text"].startswith("红葡萄酒中"))

    def test_applies_only_source_verified_threshold_corrections(self):
        thresholds = pipeline.extract_thresholds(
            "啤酒中嗅阈值1000pg/L。",
            page=183,
            entity_cas="554-12-1",
            record_id="book-flavor-chemistry-p0183-b11",
        )
        self.assertEqual(thresholds[0]["values"][0]["unit"], "μg/L")
        self.assertEqual(thresholds[0]["source_corrections"][0]["reason"], "verified_against_source_page")
        unverified = pipeline.extract_thresholds(
            "水中嗅阈值20pg/L。",
            page=184,
            entity_cas="554-12-1",
            record_id="book-flavor-chemistry-p0184-b01",
        )
        self.assertEqual(unverified[0]["values"][0]["unit"], "pg/L")

    def test_source_verified_literal_pg_is_not_left_in_ambiguous_review_queue(self):
        thresholds = pipeline.extract_thresholds(
            "空气中嗅阈值0.02pg/L。",
            page=351,
            entity_cas="182699-77-0",
            record_id="book-flavor-chemistry-p0351-b04",
        )
        self.assertEqual(thresholds[0]["values"][0]["unit"], "pg/L")
        self.assertEqual(thresholds[0]["source_corrections"][0]["reason"], "source_verified_literal_unit")
        self.assertEqual(thresholds[0]["review_status"], "clean")

    def test_source_verified_high_magnitude_is_not_left_in_review_queue(self):
        thresholds = pipeline.extract_thresholds(
            "14%vol酒精-水溶液中嗅阈值为1000mg/L。",
            page=49,
            entity_cas="78-92-2",
            record_id="book-flavor-chemistry-p0049-b08",
        )
        self.assertEqual(thresholds[0]["source_corrections"][0]["reason"], "source_verified_literal_magnitude")
        self.assertEqual(thresholds[0]["review_status"], "clean")

    def test_applies_source_verified_context_medium_and_clears_unknown_flag(self):
        original_path = pipeline.THRESHOLD_MEDIUM_RESOLUTIONS_PATH
        fixture_path = Path(__file__).with_name("_test_medium_resolutions.json")
        fixture_path.write_text(json.dumps([{
            "page": 25,
            "record_id": "book-flavor-chemistry-p0025-b02",
            "subject_label": "癸醛",
            "evidence_contains": "癸醛前鼻嗅阈值2μg/L",
            "medium": "水",
            "resolution_type": "source_verified_context_medium",
            "source_page_evidence": "同一连续列举句开头明确为水中前鼻嗅阈值",
        }], ensure_ascii=False), encoding="utf-8")
        try:
            pipeline.THRESHOLD_MEDIUM_RESOLUTIONS_PATH = fixture_path
            thresholds = pipeline.extract_thresholds(
                "癸醛前鼻嗅阈值2μg/L。",
                page=25,
                entity_cas=None,
                record_id="book-flavor-chemistry-p0025-b02",
            )
        finally:
            pipeline.THRESHOLD_MEDIUM_RESOLUTIONS_PATH = original_path
            fixture_path.unlink(missing_ok=True)
        self.assertEqual(thresholds[0]["media"], ["水"])
        self.assertEqual(
            thresholds[0]["medium_resolution"]["resolution_type"],
            "source_verified_context_medium",
        )
        self.assertNotIn("unknown_medium", {f["category"] for f in thresholds[0]["review_flags"]})

    def test_marks_source_verified_unspecified_medium_without_fabricating_matrix(self):
        original_path = pipeline.THRESHOLD_MEDIUM_RESOLUTIONS_PATH
        fixture_path = Path(__file__).with_name("_test_medium_resolutions.json")
        fixture_path.write_text(json.dumps([{
            "page": 466,
            "entity_cas": "40800-76-8",
            "evidence_contains": "阈值500ng/L",
            "medium": "原文未说明",
            "resolution_type": "source_verified_unspecified_medium",
            "source_page_evidence": "原页仅写阈值500ng/L，未标注介质",
        }], ensure_ascii=False), encoding="utf-8")
        try:
            pipeline.THRESHOLD_MEDIUM_RESOLUTIONS_PATH = fixture_path
            thresholds = pipeline.extract_thresholds(
                "呈硫化物气味，阈值500ng/L。",
                page=466,
                entity_cas="40800-76-8",
                record_id="book-flavor-chemistry-p0466-b12",
            )
        finally:
            pipeline.THRESHOLD_MEDIUM_RESOLUTIONS_PATH = original_path
            fixture_path.unlink(missing_ok=True)
        self.assertEqual(thresholds[0]["media"], ["原文未说明"])
        self.assertEqual(thresholds[0]["review_status"], "clean")

    def test_extracts_compound_entity_and_english_aliases(self):
        text = "（3）丙酸乙酯（ethyl propanoate, ethyl propionate），CAS号554-12-1，呈水果香。"
        entities = pipeline.extract_entities_from_text(text, 183, "第五章 酯类风味", "第一节 饱和酯类")
        self.assertEqual(len(entities), 1)
        self.assertEqual(entities[0]["cas"], "554-12-1")
        self.assertIn("ethyl propanoate", entities[0]["english_names"])
        self.assertIn("ethyl propionate", entities[0]["english_names"])

    def test_extracts_multiple_fullwidth_parenthesized_entities_without_crossing_cas(self):
        text = (
            "3-甲基戊酸乙酯（ethyl 3-methylpentanoate），CAS号5870-68-8，呈草莓香。"
            "4-甲基戊酸乙酯（ethyl 4-methylpentanoate，ethyl 4-methylvalerate），"
            "CAS号25415-67-2，呈水果香。"
        )
        entities = pipeline.extract_entities_from_text(text, 193, "第五章", "")
        self.assertEqual([item["cas"] for item in entities], ["5870-68-8", "25415-67-2"])
        self.assertEqual([item["chinese_name"] for item in entities], ["3-甲基戊酸乙酯", "4-甲基戊酸乙酯"])
        self.assertEqual(entities[1]["english_names"][0], "ethyl 4-methylpentanoate")

    def test_resolves_block_entity_by_exact_cas_before_context_inheritance(self):
        resolved = pipeline.resolve_block_entity(
            "排版异常的化合物，CAS号141-78-6，水中嗅阈值5mg/L。",
            {"141-78-6", "554-12-1"},
            active_entity="554-12-1",
        )
        self.assertEqual(resolved, ("141-78-6", "exact_block_cas", "high"))

        inherited = pipeline.resolve_block_entity(
            "水中嗅阈值5mg/L。",
            {"141-78-6"},
            active_entity="141-78-6",
        )
        self.assertEqual(inherited, ("141-78-6", "inherited_context", "medium"))

    def test_splits_multiple_compound_profiles_in_one_ocr_block(self):
        text = (
            "丁酸丙酯（propyl butanoate），CAS号105-66-8，水中嗅阈值160μg/L。"
            "丁酸异戊酯（isoamyl butyrate），CAS号106-27-4，46%vol酒精-水溶液中嗅阈值915μg/L。"
        )
        segments = pipeline.split_entity_profile_segments(text, {"105-66-8", "106-27-4"})
        self.assertEqual([item[0] for item in segments], ["105-66-8", "106-27-4"])
        self.assertIn("160μg/L", segments[0][1])
        self.assertNotIn("915μg/L", segments[0][1])
        self.assertIn("915μg/L", segments[1][1])

    def test_recovers_canonical_entity_when_source_layout_evades_profile_regex(self):
        canonical = {
            "6789-80-6": {"chinese_name": "顺-3-己烯醛", "english_name": "cis-3-hexenal"}
        }
        recovered = pipeline.recover_canonical_entities_from_cas(
            "顺-3-己烯醛[cis-3-hexenal]，CAS号6789-80-6，FEMA号2561。",
            page=89,
            chapter="第三章 羰基化合物风味",
            section="顺式不饱和醛",
            canonical_compounds=canonical,
            already_extracted=set(),
        )
        self.assertEqual(len(recovered), 1)
        self.assertEqual(recovered[0]["cas"], "6789-80-6")
        self.assertEqual(recovered[0]["chinese_name"], "顺-3-己烯醛")
        self.assertEqual(recovered[0]["extraction_method"], "canonical_cas_fallback")

        self.assertEqual(
            pipeline.recover_canonical_entities_from_cas(
                "CAS号6789-80-6", 89, "", "", canonical, {"6789-80-6"}
            ),
            [],
        )

    def test_casless_compound_profile_resets_inherited_identity_and_preserves_name(self):
        text = "顺-4-庚烯醛[cis-4-heptenal，（Z)-4-heptenal]，呈鱼腥味，在水中觉察阈值0.87ng/L。"
        self.assertEqual(pipeline.extract_casless_profile_subject(text), "顺-4-庚烯醛")
        thresholds = pipeline.extract_thresholds(
            text,
            page=89,
            entity_cas=None,
            fallback_subject="顺-4-庚烯醛",
        )
        self.assertEqual(thresholds[0]["subject_label"], "顺-4-庚烯醛")
        self.assertEqual(thresholds[0]["subject_identity_type"], "name_only")
        self.assertNotIn(
            "missing_entity",
            {flag["category"] for flag in thresholds[0]["review_flags"]},
        )

    def test_running_page_headers_do_not_reset_entity_context(self):
        self.assertTrue(pipeline.is_running_page_header("第三章羰基化合物风味067"))
        self.assertFalse(pipeline.is_running_page_header("第三章 羰基化合物风味"))
        self.assertTrue(pipeline.is_topic_heading("一、呈苦味肽"))
        self.assertFalse(pipeline.is_topic_heading("一、呈苦味肽在水中有较低的阈值，因此需要继续研究。"))

    def test_preserves_named_peptide_subject_without_claiming_a_missing_cas(self):
        thresholds = pipeline.extract_thresholds(
            "Ala-Leu呈苦味，水溶液中苦味阈值20mmol/L。",
            page=432,
            entity_cas=None,
            record_id="book-flavor-chemistry-p0432-b07",
        )
        self.assertEqual(thresholds[0]["subject_label"], "Ala-Leu")
        self.assertEqual(thresholds[0]["subject_identity_type"], "name_only")
        self.assertNotIn(
            "missing_entity",
            {flag["category"] for flag in thresholds[0]["review_flags"]},
        )

    def test_inherits_explicit_subject_within_the_same_ocr_block(self):
        thresholds = pipeline.extract_thresholds(
            "y-Glu-Leu呈厚味，水溶液中厚味阈值9.4mmol/L；涩味阈值9.4mmol/L。",
            page=437,
            entity_cas=None,
            record_id="book-flavor-chemistry-p0437-b03",
        )
        self.assertEqual([item["subject_label"] for item in thresholds], ["y-Glu-Leu", "y-Glu-Leu"])
        self.assertTrue(all(item["subject_identity_type"] == "name_only" for item in thresholds))

    def test_extracts_possessive_and_embedded_threshold_subjects(self):
        cases = [
            ("比如，蔗糖的味阈值是12mmol/L。", "蔗糖"),
            ("五肽Asn-Ala-Leu-Pro-Arg即NALPR，呈苦味，其苦味阈值0.420mmol/L。", "Asn-Ala-Leu-Pro-Arg"),
            ("IPPLTQTPVVVPP或许呈苦味，但其苦味阈值大于6.0mmol/L。", "IPPLTQTPVVVPP"),
            ("甲 醇呈化学品气味，在酒精-水溶液中气味阈值668mg/L。", "甲醇"),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                thresholds = pipeline.extract_thresholds(text, page=1, entity_cas=None)
                self.assertEqual(thresholds[0]["subject_label"], expected)

    def test_extracts_explicit_chinese_threshold_subjects(self):
        cases = [
            ("壬醛水中前鼻嗅阈值2.5μg/L。", "壬醛"),
            ("葡萄酒中的1,8-桉树脑（1,8-cineole），消费者可以接受的阈值是27.5μg/L。", "1,8-桉树脑"),
            ("甲醇呈化学品气味，在酒精-水溶液中气味阈值668mg/L。", "甲醇"),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                thresholds = pipeline.extract_thresholds(text, page=20, entity_cas=None)
                self.assertEqual(thresholds[0]["subject_label"], expected)

    def test_classifies_canonical_name_conflicts_by_risk(self):
        self.assertEqual(
            pipeline.classify_canonical_conflict("已醇", ["hexanol"], "正己醇", "1-hexanol"),
            "likely_ocr_error",
        )
        self.assertEqual(
            pipeline.classify_canonical_conflict("庚醇", ["heptanol"], "正庚醇", "1-heptanol"),
            "name_variant",
        )
        self.assertEqual(
            pipeline.classify_canonical_conflict("丙酸乙酯", ["ethyl propanoate"], "丙酸甲酯", "methyl propanoate"),
            "identity_conflict",
        )
        self.assertEqual(
            pipeline.classify_canonical_conflict("水果和饮料酒中以", [], "某化合物", "compound"),
            "insufficient_extraction",
        )

    def test_chemical_name_compatibility_handles_locants_and_word_order(self):
        self.assertTrue(pipeline.english_name_compatible(
            "2-methyl-1-propanol (isobutyl alcohol, isobutanol)",
            ["methylpropanol"],
        ))
        self.assertTrue(pipeline.english_name_compatible("3-octanone", ["octan-3-one"]))
        self.assertTrue(pipeline.english_name_compatible(
            "2-isobutyl-3-methoxypyrazine",
            ["2-methoxy-3-isobutylpyrazine"],
        ))
        self.assertFalse(pipeline.english_name_compatible("methyl propanoate", ["ethyl propanoate"]))

    def test_applies_only_matching_source_verified_identity_resolution(self):
        resolutions = [{
            "cas": "554-12-1",
            "page": 183,
            "source_name": "丙酸乙酯",
            "authoritative_name": "methyl propanoate",
            "resolution_type": "source_cas_name_conflict",
            "authority": "PubChem",
            "authority_url": "https://pubchem.ncbi.nlm.nih.gov/compound/11124",
        }]
        resolved = pipeline.find_identity_conflict_resolution(
            resolutions, "554-12-1", 183, "丙酸乙酯"
        )
        self.assertEqual(resolved["resolution_type"], "source_cas_name_conflict")
        self.assertEqual(resolved["authoritative_name"], "methyl propanoate")
        self.assertIsNone(pipeline.find_identity_conflict_resolution(
            resolutions, "554-12-1", 184, "丙酸乙酯"
        ))
        self.assertIsNone(pipeline.find_identity_conflict_resolution(
            resolutions, "554-12-1", 183, "丙酸甲酯"
        ))

    def test_verified_source_alias_resolution_is_not_treated_as_identity_conflict(self):
        self.assertEqual(
            pipeline.resolved_conflict_type({"resolution_type": "source_alias_matches_canonical_cas"}),
            "verified_name_variant",
        )
        self.assertEqual(
            pipeline.resolved_conflict_type({"resolution_type": "source_cas_name_conflict"}),
            "source_identity_error",
        )

    def test_qa_lists_traceable_threshold_and_entity_anomalies(self):
        payload = {
            "schema_version": 2,
            "pages": 1,
            "record_count": 1,
            "entity_count": 1,
            "threshold_count": 1,
            "records": [{"id": "p1-b1", "page": 1, "block_type": "threshold", "text": "嗅阈值0.05pg/L"}],
            "entities": [{
                "cas": "123-45-6",
                "first_page": 1,
                "chinese_name": "测试物",
                "english_names": [],
                "aliases": ["测试物"],
                "canonical_conflict": {"reason": "CAS resolves to a different compound"},
            }],
            "thresholds": [{
                "entity_cas": None,
                "page": 1,
                "record_id": "p1-b1",
                "media": ["未明确"],
                "review_status": "needs_review",
                "review_flags": [{"category": "ambiguous_unit", "severity": "high", "evidence": "0.05pg/L"}],
            }],
        }
        qa = pipeline.build_qa(payload)
        self.assertEqual(qa["anomaly_summary"], {"ambiguous_unit": 1, "canonical_identity_conflict": 1})
        self.assertEqual(qa["anomalies"][0]["record_id"], "p1-b1")
        self.assertEqual(qa["anomalies"][0]["status"], "needs_review")
        self.assertEqual(qa["anomalies"][1]["entity_cas"], "123-45-6")

    def test_gold_standard_requires_exact_identity_and_rejects_forbidden_aliases(self):
        cases = json.loads(
            (Path(__file__).with_name("book_index_gold_standard.json")).read_text(encoding="utf-8")
        )
        entities = [{
            "cas": case["cas"],
            "chinese_name": case["chinese_name"],
            "english_names": [case["english_alias"]],
            "aliases": [case["chinese_name"], case["english_alias"]],
            "first_page": case["first_page"],
        } for case in cases]
        results = pipeline.validate_gold_standard({"entities": entities}, cases)
        self.assertTrue(all(item["passed"] for item in results))

        entities[2]["aliases"].append("methyl hexanoate")
        failed = pipeline.validate_gold_standard({"entities": entities}, cases)
        self.assertFalse(failed[2]["passed"])
        self.assertIn("forbidden_alias", failed[2]["issues"])

    def test_threshold_gold_standard_checks_value_unit_medium_and_source_locator(self):
        cases = [{
            "id": "p0183-propionate-beer",
            "page": 183,
            "record_id": "book-flavor-chemistry-p0183-b11",
            "entity_cas": "554-12-1",
            "medium": "啤酒",
            "threshold_type": "odor",
            "value": {"low": "1000", "high": None, "unit": "μg/L"},
            "evidence_contains": "啤酒中嗅阈值1000μg/L",
        }]
        payload = {"thresholds": [{
            "page": 183,
            "record_id": "book-flavor-chemistry-p0183-b11",
            "entity_cas": "554-12-1",
            "subject_label": "丙酸乙酯",
            "media": ["啤酒"],
            "threshold_type": "odor",
            "values": [{"low": "1000", "high": None, "unit": "μg/L", "role": "threshold"}],
            "raw_text": "啤酒中嗅阈值1000μg/L",
        }]}
        results = pipeline.validate_threshold_gold_standard(payload, cases)
        self.assertEqual(results, [{"id": "p0183-propionate-beer", "passed": True, "issues": []}])

        payload["thresholds"][0]["values"][0]["unit"] = "pg/L"
        failed = pipeline.validate_threshold_gold_standard(payload, cases)
        self.assertFalse(failed[0]["passed"])
        self.assertIn("value_mismatch", failed[0]["issues"])

    def test_extracts_traceable_metadata_from_numbered_tables(self):
        metadata = pipeline.extract_table_metadata(
            "表1-1 单位：h 一些化合物在不同溶剂中38℃时的半衰期 2%vol酒精水溶液"
        )
        self.assertEqual(metadata["table_id"], "1-1")
        self.assertEqual(metadata["unit"], "h")
        self.assertEqual(metadata["title"], "一些化合物在不同溶剂中38℃时的半衰期")
        self.assertEqual(metadata["structure_status"], "linearized_ocr")
        self.assertTrue(metadata["needs_review"])
        self.assertIsNone(pipeline.extract_table_metadata("普通段落包含数值 1-1，但不是表格。"))
        self.assertIsNone(pipeline.extract_table_metadata("表1-2是一些化合物在水中的阈值说明。"))

        header = pipeline.extract_table_metadata(
            "表1-2 一些风味化合物在水中气味阈值（20℃） 化合物 阈值/（mg/L） 苯乙醛 0.004"
        )
        self.assertEqual(header["title"], "一些风味化合物在水中气味阈值（20℃）")

    def test_source_verified_table_rows_require_matching_id_and_page(self):
        tables = [{"table_id": "1-7", "page": 24, "rows": [{"compound": "正丁醇"}]}]
        self.assertEqual(
            pipeline.find_structured_table(tables, "1-7", 24)["rows"][0]["compound"],
            "正丁醇",
        )
        self.assertIsNone(pipeline.find_structured_table(tables, "1-7", 25))
        self.assertIsNone(pipeline.find_structured_table(tables, "1-8", 24))

    def test_curated_structured_tables_have_unique_keys_and_verified_threshold_rows(self):
        tables = pipeline.load_structured_tables()
        keys = [(table["table_id"], table["page"]) for table in tables]
        self.assertEqual(len(keys), len(set(keys)))
        table_12 = pipeline.find_structured_table(tables, "1-2", 20)
        self.assertEqual(len(table_12["rows"]), 19)
        thiol = next(row for row in table_12["rows"] if row["compound"] == "1-p-孟烯-8-硫醇")
        self.assertEqual((thiol["threshold"], thiol["unit"]), ("0.00000002", "mg/L"))
        self.assertEqual(len(pipeline.find_structured_table(tables, "14-1", 578)["rows"]), 23)
        self.assertEqual(len(pipeline.find_structured_table(tables, "15-1", 607)["rows"]), 9)

    def test_source_verified_cross_block_supplements_are_complete_and_traceable(self):
        supplements = pipeline.load_source_verified_threshold_supplements()
        self.assertEqual(len(supplements), 4)
        self.assertTrue(all(item["association_method"] == "source_verified_page_supplement" for item in supplements))
        white_juice = next(item for item in supplements if item["medium_detail"] == "白葡萄汁")
        self.assertEqual(
            [(value["low"], value["unit"]) for value in white_juice["values"]],
            [("0.22", "g/L"), ("3.77", "mmol/L"), ("1.53", "g/L"), ("26.22", "mmol/L")],
        )


if __name__ == "__main__":
    unittest.main()
