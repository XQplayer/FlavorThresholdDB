import hashlib
import json
import tempfile
import time
import unittest
from pathlib import Path

from shimadzu_analysis_service import STAGES, ShimadzuAnalysisError, ShimadzuAnalysisService


EXPECTED_STAGE_DIRS = [
    "00_输入配置与清单",
    "01_Hit1整理",
    "02_化合物筛查",
    "03_平行峰面积处理",
    "04_跨样品合并与半定量",
    "05_统计_CV_CAS与QC",
    "06_按矩阵拆分",
]


def wait_for(service, job_id, statuses, timeout=4):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = service.get_job(job_id)
        if job["status"] in statuses:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job did not reach {statuses}: {service.get_job(job_id)}")


class FakeRunner:
    def __init__(self, fail_stage=None):
        self.commands = []
        self.fail_stage = fail_stage

    def __call__(self, command, cwd, log_path):
        self.commands.append(list(command))
        action = command[2]
        output_root = Path(command[command.index("--output-root") + 1])
        if action.startswith("stage"):
            index = int(action.removeprefix("stage"))
            if self.fail_stage == index:
                return 1, "", f"stage {index} failed"
            stage_dir = output_root / EXPECTED_STAGE_DIRS[index]
            stage_dir.mkdir(parents=True)
            manifest = {
                "stage": EXPECTED_STAGE_DIRS[index],
                "severity": "WARN" if index == 1 else "PASS",
                "canAdvance": True,
                "counts": {"records": index + 1},
                "outputHashes": [],
            }
            manifest_path = stage_dir / "manifest.json"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
            (stage_dir / "manifest.sha256").write_text(
                hashlib.sha256(manifest_path.read_bytes()).hexdigest(), encoding="ascii"
            )
            return 0, json.dumps({"status": "PASS"}), ""
        if action == "verify":
            report_dir = output_root / "完整性验证"
            report_dir.mkdir(parents=True)
            report = {"status": "PASS", "oavExecuted": False, "stageResults": []}
            report_path = report_dir / "v2-completeness-verification.json"
            report_path.write_text(json.dumps(report), encoding="utf-8")
            return 0, json.dumps({"status": "PASS", "reportPath": str(report_path)}), ""
        raise AssertionError(command)


class ShimadzuAnalysisServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.skill = self.root / "skill"
        (self.skill / "scripts").mkdir(parents=True)
        (self.skill / "scripts" / "v2-cli.mjs").write_text("// fixture", encoding="utf-8")
        self.node = self.root / "node.exe"
        self.node.write_bytes(b"node")
        self.modules = self.root / "node_modules"
        self.modules.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def make_service(self, runner=None, **kwargs):
        return ShimadzuAnalysisService(
            self.root / "runtime",
            skill_path=self.skill,
            node_path=self.node,
            node_modules_path=self.modules,
            runner=runner or FakeRunner(),
            prepare_runtime=False,
            **kwargs,
        )

    def create_job(self, service, mode="continuous"):
        return service.create_job(
            raw_filename="raw.xlsx",
            raw_bytes=b"raw-workbook",
            samples_filename="samples.xlsx",
            samples_bytes=b"sample-workbook",
            options={"mode": mode, "name": "CT JX test"},
        )

    def test_capabilities_expose_exact_stage_scope_and_locked_parameters(self):
        service = self.make_service()
        capabilities = service.capabilities()
        self.assertEqual([item["directory"] for item in capabilities["stages"]], EXPECTED_STAGE_DIRS)
        self.assertEqual(capabilities["locked_parameters"]["cv_threshold_percent"], 30)
        self.assertEqual(capabilities["locked_parameters"]["response_factor"], 1)
        self.assertFalse(capabilities["oav_enabled"])
        self.assertTrue(capabilities["available"])

    def test_template_downloads_are_limited_to_declared_workbooks(self):
        template_dir = self.root / "templates"
        template_dir.mkdir()
        raw = template_dir / "Shimadzu_Raw_Workbook_Example.xlsx"
        samples = template_dir / "Shimadzu_Sample_Internal_Standard_Template.xlsx"
        raw.write_bytes(b"raw-template")
        samples.write_bytes(b"sample-template")
        service = self.make_service(template_dir=template_dir)
        self.assertEqual(service.get_template_path("raw-example"), raw)
        self.assertEqual(service.get_template_path("sample-info"), samples)
        with self.assertRaises(ShimadzuAnalysisError) as caught:
            service.get_template_path("../job.json")
        self.assertEqual(caught.exception.code, "TEMPLATE_NOT_FOUND")

    def test_create_job_uses_uuid_directory_and_fixed_input_names(self):
        service = self.make_service()
        job = self.create_job(service)
        job_root = self.root / "runtime" / "jobs" / job["id"]
        self.assertEqual((job_root / "input" / "raw.xlsx").read_bytes(), b"raw-workbook")
        self.assertEqual((job_root / "input" / "samples.xlsx").read_bytes(), b"sample-workbook")
        self.assertEqual(job["source_files"]["raw"]["original_name"], "raw.xlsx")
        self.assertEqual([item["status"] for item in job["stages"]], ["pending"] * 7)
        self.assertNotIn("CT JX test", str(job_root))

    def test_running_job_status_reads_the_current_log_tail(self):
        service = self.make_service()
        job = self.create_job(service)
        internal = service._load_job(job["id"])
        internal["status"] = "running"
        internal["stages"][0]["status"] = "running"
        Path(internal["stages"][0]["log_path"]).write_text("读取工作簿\n校验样品名称\n", encoding="utf-8")
        service._write_job(internal)
        refreshed = service.get_job(job["id"])
        self.assertIn("校验样品名称", refreshed["stages"][0]["log_tail"])

    def test_create_job_rejects_non_xlsx_and_oversized_inputs(self):
        service = self.make_service()
        with self.assertRaisesRegex(ShimadzuAnalysisError, "INVALID_UPLOAD"):
            service.create_job("raw.xls", b"x", "samples.xlsx", b"y", {})
        service.max_file_bytes = 2
        with self.assertRaisesRegex(ShimadzuAnalysisError, "UPLOAD_TOO_LARGE"):
            service.create_job("raw.xlsx", b"xxx", "samples.xlsx", b"y", {})

    def test_continuous_mode_runs_all_stages_verifies_and_packages(self):
        runner = FakeRunner()
        service = self.make_service(runner)
        job = self.create_job(service, "continuous")
        service.start(job["id"])
        completed = wait_for(service, job["id"], {"complete", "failed"})
        self.assertEqual(completed["status"], "complete")
        self.assertEqual([item["status"] for item in completed["stages"]], ["PASS", "WARN", "PASS", "PASS", "PASS", "PASS", "PASS"])
        self.assertEqual(completed["completeness"]["status"], "PASS")
        self.assertFalse(completed["completeness"]["oavExecuted"])
        self.assertTrue(Path(completed["download_path"]).is_file())
        self.assertEqual([command[2] for command in runner.commands], [f"stage{i}" for i in range(7)] + ["verify"])

    def test_step_mode_stops_after_each_stage_until_continue(self):
        service = self.make_service(FakeRunner())
        job = self.create_job(service, "step")
        service.start(job["id"])
        waiting = wait_for(service, job["id"], {"waiting_review", "failed"})
        self.assertEqual(waiting["next_stage"], 1)
        self.assertEqual(waiting["stages"][0]["status"], "PASS")
        service.continue_job(job["id"])
        waiting = wait_for(service, job["id"], {"waiting_review", "failed"})
        self.assertEqual(waiting["next_stage"], 2)

    def test_failed_stage_stops_pipeline_and_blocks_download(self):
        service = self.make_service(FakeRunner(fail_stage=2))
        job = self.create_job(service)
        service.start(job["id"])
        failed = wait_for(service, job["id"], {"failed"})
        self.assertEqual(failed["stages"][2]["status"], "FAIL")
        self.assertEqual(failed["error"]["code"], "STAGE_FAILED")
        with self.assertRaisesRegex(ShimadzuAnalysisError, "DOWNLOAD_NOT_READY"):
            service.get_download_path(job["id"])

    def test_invalid_job_ids_never_escape_jobs_root(self):
        service = self.make_service()
        for job_id in ("../outside", "x/y", "not-a-uuid"):
            with self.assertRaisesRegex(ShimadzuAnalysisError, "JOB_NOT_FOUND"):
                service.get_job(job_id)


if __name__ == "__main__":
    unittest.main()
