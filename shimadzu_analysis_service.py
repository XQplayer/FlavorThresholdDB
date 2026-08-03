from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


STAGES = (
    {"index": 0, "directory": "00_输入配置与清单", "label": "输入配置与清单"},
    {"index": 1, "directory": "01_Hit1整理", "label": "Hit #1整理"},
    {"index": 2, "directory": "02_化合物筛查", "label": "化合物筛查"},
    {"index": 3, "directory": "03_平行峰面积处理", "label": "平行峰面积处理"},
    {"index": 4, "directory": "04_跨样品合并与半定量", "label": "跨样品合并与半定量"},
    {"index": 5, "directory": "05_统计_CV_CAS与QC", "label": "统计、CV、CAS与QC"},
    {"index": 6, "directory": "06_按矩阵拆分", "label": "按矩阵拆分"},
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ShimadzuAnalysisError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.status = status


class ShimadzuAnalysisService:
    max_file_bytes = 100 * 1024 * 1024

    def __init__(
        self,
        root: Path | str,
        *,
        skill_path: Path | str | None = None,
        node_path: Path | str | None = None,
        node_modules_path: Path | str | None = None,
        template_dir: Path | str | None = None,
        runner: Callable | None = None,
        prepare_runtime: bool = True,
    ) -> None:
        self.root = Path(root).resolve()
        self.jobs_root = self.root / "jobs"
        self.runtime_skill = self.root / "runtime" / "skill"
        project_parent = Path(__file__).resolve().parent.parent
        default_skill = project_parent / "Aroma analysis" / "岛津" / "skills" / "shimadzu-flavor-data-processing"
        user_profile = Path(os.environ.get("USERPROFILE") or Path.home())
        self.skill_path = Path(skill_path or os.environ.get("SHIMADZU_SKILL_PATH") or default_skill).resolve()
        self.node_path = Path(
            node_path
            or os.environ.get("SHIMADZU_NODE_PATH")
            or user_profile / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node.exe"
        ).resolve()
        self.node_modules_path = Path(
            node_modules_path
            or os.environ.get("SHIMADZU_NODE_MODULES")
            or user_profile / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "node_modules"
        ).resolve()
        self.template_dir = Path(template_dir or Path(__file__).resolve().parent / "resources" / "shimadzu" / "templates").resolve()
        self.runner = runner or self._run_command
        self.prepare_runtime_enabled = prepare_runtime
        self._lock = threading.RLock()
        self._threads: dict[str, threading.Thread] = {}
        self.jobs_root.mkdir(parents=True, exist_ok=True)

    def capabilities(self) -> dict:
        missing = []
        if not (self.skill_path / "scripts" / "v2-cli.mjs").is_file():
            missing.append("deployed_skill")
        if not self.node_path.is_file():
            missing.append("node")
        if not self.node_modules_path.is_dir():
            missing.append("node_modules")
        return {
            "available": not missing,
            "missing": missing,
            "skill_path": str(self.skill_path),
            "node_path": str(self.node_path),
            "stages": [dict(item) for item in STAGES],
            "oav_enabled": False,
            "max_file_bytes": self.max_file_bytes,
            "locked_parameters": {
                "cv_threshold_percent": 30,
                "response_factor": 1,
                "internal_standard_parameters": "sample_workbook",
                "include_spike_volume": "sample_workbook_default_true",
                "oav": "disabled",
            },
        }

    def create_job(
        self,
        raw_filename: str,
        raw_bytes: bytes,
        samples_filename: str,
        samples_bytes: bytes,
        options: dict | None = None,
    ) -> dict:
        options = dict(options or {})
        self._validate_upload(raw_filename, raw_bytes)
        self._validate_upload(samples_filename, samples_bytes)
        mode = str(options.get("mode") or "continuous").strip().lower()
        if mode not in {"continuous", "step"}:
            raise ShimadzuAnalysisError("INVALID_MODE", "mode must be continuous or step")
        job_id = str(uuid.uuid4())
        job_root = self.jobs_root / job_id
        input_dir = job_root / "input"
        output_dir = job_root / "output"
        log_dir = job_root / "logs"
        input_dir.mkdir(parents=True)
        output_dir.mkdir()
        log_dir.mkdir()
        raw_path = input_dir / "raw.xlsx"
        samples_path = input_dir / "samples.xlsx"
        raw_path.write_bytes(raw_bytes)
        samples_path.write_bytes(samples_bytes)
        created_at = _utc_now()
        job = {
            "schema_version": 1,
            "id": job_id,
            "name": str(options.get("name") or "岛津气质分析").strip()[:120] or "岛津气质分析",
            "mode": mode,
            "status": "created",
            "created_at": created_at,
            "updated_at": created_at,
            "started_at": None,
            "completed_at": None,
            "next_stage": 0,
            "source_files": {
                "raw": {"original_name": Path(raw_filename).name, "path": str(raw_path), "size": len(raw_bytes), "sha256": _sha256(raw_path)},
                "samples": {"original_name": Path(samples_filename).name, "path": str(samples_path), "size": len(samples_bytes), "sha256": _sha256(samples_path)},
            },
            "output_root": str(output_dir),
            "stages": [
                {
                    **dict(stage),
                    "status": "pending",
                    "severity": None,
                    "can_advance": None,
                    "counts": {},
                    "started_at": None,
                    "completed_at": None,
                    "log_path": str(log_dir / f"stage{stage['index']}.log"),
                    "log_tail": "",
                }
                for stage in STAGES
            ],
            "completeness": None,
            "download_path": None,
            "error": None,
        }
        self._write_job(job)
        return self._public_job(job)

    def start(self, job_id: str) -> dict:
        with self._lock:
            job = self._load_job(job_id)
            if job["status"] != "created":
                raise ShimadzuAnalysisError("JOB_ALREADY_STARTED", "job is not in created state", 409)
            job["status"] = "queued"
            job["started_at"] = _utc_now()
            self._write_job(job)
            self._launch(job_id)
            return self._public_job(job)

    def continue_job(self, job_id: str) -> dict:
        with self._lock:
            job = self._load_job(job_id)
            if job["mode"] != "step" or job["status"] != "waiting_review":
                raise ShimadzuAnalysisError("INVALID_JOB_STATE", "job is not waiting for step review", 409)
            job["status"] = "queued"
            self._write_job(job)
            self._launch(job_id)
            return self._public_job(job)

    def get_job(self, job_id: str) -> dict:
        with self._lock:
            job = self._load_job(job_id)
            if job.get("status") == "running":
                for stage in job.get("stages", []):
                    if stage.get("status") != "running":
                        continue
                    log_path = Path(stage.get("log_path") or "")
                    if log_path.is_file():
                        stage["log_tail"] = log_path.read_text(encoding="utf-8", errors="replace")[-5000:]
                    break
            return self._public_job(job)

    def get_download_path(self, job_id: str) -> Path:
        job = self._load_job(job_id)
        path = Path(job.get("download_path") or "")
        if job["status"] != "complete" or not path.is_file():
            raise ShimadzuAnalysisError("DOWNLOAD_NOT_READY", "verified result archive is not ready", 409)
        return path

    def get_template_path(self, template_id: str) -> Path:
        names = {
            "raw-example": "Shimadzu_Raw_Workbook_Example.xlsx",
            "sample-info": "Shimadzu_Sample_Internal_Standard_Template.xlsx",
        }
        filename = names.get(template_id)
        path = self.template_dir / filename if filename else None
        if path is None or not path.is_file():
            raise ShimadzuAnalysisError("TEMPLATE_NOT_FOUND", "requested template is unavailable", 404)
        return path

    def _validate_upload(self, filename: str, content: bytes) -> None:
        if Path(filename or "").suffix.lower() != ".xlsx" or not content:
            raise ShimadzuAnalysisError("INVALID_UPLOAD", "two non-empty .xlsx workbooks are required")
        if len(content) > self.max_file_bytes:
            raise ShimadzuAnalysisError("UPLOAD_TOO_LARGE", "each workbook must be 100 MB or smaller", 413)

    def _job_root(self, job_id: str) -> Path:
        try:
            canonical = str(uuid.UUID(job_id))
        except (ValueError, TypeError, AttributeError):
            raise ShimadzuAnalysisError("JOB_NOT_FOUND", "job does not exist", 404)
        root = (self.jobs_root / canonical).resolve()
        if root.parent != self.jobs_root:
            raise ShimadzuAnalysisError("JOB_NOT_FOUND", "job does not exist", 404)
        return root

    def _load_job(self, job_id: str) -> dict:
        path = self._job_root(job_id) / "job.json"
        if not path.is_file():
            raise ShimadzuAnalysisError("JOB_NOT_FOUND", "job does not exist", 404)
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_job(self, job: dict) -> None:
        job["updated_at"] = _utc_now()
        path = self._job_root(job["id"]) / "job.json"
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, path)

    @staticmethod
    def _public_job(job: dict) -> dict:
        return json.loads(json.dumps(job, ensure_ascii=False))

    def _launch(self, job_id: str) -> None:
        active = self._threads.get(job_id)
        if active and active.is_alive():
            raise ShimadzuAnalysisError("JOB_ALREADY_RUNNING", "job is already running", 409)
        thread = threading.Thread(target=self._execute, args=(job_id,), daemon=True, name=f"shimadzu-{job_id[:8]}")
        self._threads[job_id] = thread
        thread.start()

    def _execute(self, job_id: str) -> None:
        try:
            if self.prepare_runtime_enabled:
                self._prepare_runtime()
            while True:
                with self._lock:
                    job = self._load_job(job_id)
                    index = int(job["next_stage"])
                    if index >= len(STAGES):
                        break
                    job["status"] = "running"
                    stage = job["stages"][index]
                    stage["status"] = "running"
                    stage["started_at"] = _utc_now()
                    self._write_job(job)
                self._run_stage(job_id, index)
                with self._lock:
                    job = self._load_job(job_id)
                    job["next_stage"] = index + 1
                    if job["mode"] == "step" and job["next_stage"] < len(STAGES):
                        job["status"] = "waiting_review"
                        self._write_job(job)
                        return
                    self._write_job(job)
            self._finalize(job_id)
        except ShimadzuAnalysisError as exc:
            self._mark_failed(job_id, exc)
        except Exception as exc:  # defensive boundary for background workers
            self._mark_failed(job_id, ShimadzuAnalysisError("ANALYSIS_INTERNAL_ERROR", str(exc), 500))

    def _run_stage(self, job_id: str, index: int) -> None:
        job = self._load_job(job_id)
        output_root = Path(job["output_root"])
        raw_path = Path(job["source_files"]["raw"]["path"])
        samples_path = Path(job["source_files"]["samples"]["path"])
        command = [str(self.node_path), str(self._cli_path()), f"stage{index}"]
        if index in {0, 1}:
            command.extend(["--raw", str(raw_path)])
        if index == 0:
            command.extend(["--samples", str(samples_path)])
        command.extend(["--output-root", str(output_root)])
        log_path = Path(job["stages"][index]["log_path"])
        code, stdout, stderr = self.runner(command, self.runtime_skill, log_path)
        log_text = "\n".join(part for part in (stdout.strip(), stderr.strip()) if part)
        log_path.write_text(log_text, encoding="utf-8")
        if code != 0:
            raise ShimadzuAnalysisError("STAGE_FAILED", f"stage {index} failed: {stderr.strip() or stdout.strip()}")
        manifest_path = output_root / STAGES[index]["directory"] / "manifest.json"
        if not manifest_path.is_file():
            raise ShimadzuAnalysisError("STAGE_FAILED", f"stage {index} did not produce manifest.json")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        severity = str(manifest.get("severity") or "PASS").upper()
        if severity not in {"PASS", "WARN", "REVIEW"}:
            severity = "FAIL"
        can_advance = manifest.get("canAdvance") is not False
        with self._lock:
            current = self._load_job(job_id)
            stage = current["stages"][index]
            stage.update(
                {
                    "status": severity,
                    "severity": severity,
                    "can_advance": can_advance,
                    "counts": manifest.get("counts") or {},
                    "completed_at": _utc_now(),
                    "manifest_path": str(manifest_path),
                    "log_tail": log_text[-5000:],
                }
            )
            self._write_job(current)
        if not can_advance or severity == "FAIL":
            raise ShimadzuAnalysisError("STAGE_FAILED", f"stage {index} failed its manifest gate")

    def _finalize(self, job_id: str) -> None:
        job = self._load_job(job_id)
        output_root = Path(job["output_root"])
        command = [str(self.node_path), str(self._cli_path()), "verify", "--output-root", str(output_root)]
        log_path = self._job_root(job_id) / "logs" / "verify.log"
        code, stdout, stderr = self.runner(command, self.runtime_skill, log_path)
        log_path.write_text("\n".join(part for part in (stdout.strip(), stderr.strip()) if part), encoding="utf-8")
        if code != 0:
            raise ShimadzuAnalysisError("COMPLETENESS_FAILED", stderr.strip() or stdout.strip())
        report_path = output_root / "完整性验证" / "v2-completeness-verification.json"
        if not report_path.is_file():
            raise ShimadzuAnalysisError("COMPLETENESS_FAILED", "completeness report is missing")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if report.get("status") != "PASS" or report.get("oavExecuted") is not False:
            raise ShimadzuAnalysisError("COMPLETENESS_FAILED", "completeness report did not pass the Stage 0-6 boundary")
        archive_base = self._job_root(job_id) / f"{self._safe_archive_name(job['name'])}-{job_id[:8]}"
        archive_path = Path(shutil.make_archive(str(archive_base), "zip", root_dir=self._job_root(job_id), base_dir="output"))
        with self._lock:
            current = self._load_job(job_id)
            current["status"] = "complete"
            current["completed_at"] = _utc_now()
            current["completeness"] = report
            current["download_path"] = str(archive_path)
            self._write_job(current)

    @staticmethod
    def _safe_archive_name(name: str) -> str:
        safe = "".join(character if character.isalnum() or character in "-_" else "_" for character in name)
        return safe.strip("_")[:60] or "shimadzu-analysis"

    def _mark_failed(self, job_id: str, error: ShimadzuAnalysisError) -> None:
        with self._lock:
            try:
                job = self._load_job(job_id)
            except ShimadzuAnalysisError:
                return
            index = int(job.get("next_stage") or 0)
            if index < len(job["stages"]) and job["stages"][index]["status"] == "running":
                job["stages"][index]["status"] = "FAIL"
                job["stages"][index]["severity"] = "FAIL"
                job["stages"][index]["completed_at"] = _utc_now()
            job["status"] = "failed"
            job["completed_at"] = _utc_now()
            job["error"] = {"code": error.code, "message": error.message}
            self._write_job(job)

    def _cli_path(self) -> Path:
        root = self.runtime_skill if self.prepare_runtime_enabled else self.skill_path
        return root / "scripts" / "v2-cli.mjs"

    def _prepare_runtime(self) -> None:
        capabilities = self.capabilities()
        if not capabilities["available"]:
            raise ShimadzuAnalysisError("SKILL_UNAVAILABLE", f"missing: {', '.join(capabilities['missing'])}", 503)
        cli_path = self.runtime_skill / "scripts" / "v2-cli.mjs"
        if not cli_path.is_file():
            self.runtime_skill.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(self.skill_path, self.runtime_skill)
        link = self.runtime_skill / "node_modules"
        if link.exists():
            return
        if os.name != "nt":
            os.symlink(self.node_modules_path, link, target_is_directory=True)
            return
        def powershell_literal(path: Path) -> str:
            return "'" + str(path).replace("'", "''") + "'"

        script = (
            f"New-Item -ItemType Junction -Path {powershell_literal(link)} "
            f"-Target {powershell_literal(self.node_modules_path)} | Out-Null"
        )
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
            check=False,
        )
        if completed.returncode != 0 or not link.exists():
            raise ShimadzuAnalysisError("SKILL_UNAVAILABLE", f"could not prepare Node dependency junction: {completed.stderr}", 503)

    @staticmethod
    def _run_command(command: list[str], cwd: Path, log_path: Path) -> tuple[int, str, str]:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + 60 * 60
        with log_path.open("w", encoding="utf-8", errors="replace") as handle:
            process = subprocess.Popen(
                command,
                cwd=cwd,
                stdout=handle,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            while process.poll() is None:
                if time.monotonic() >= deadline:
                    process.kill()
                    process.wait(timeout=10)
                    return 124, log_path.read_text(encoding="utf-8", errors="replace"), "stage timed out"
                time.sleep(0.2)
        output = log_path.read_text(encoding="utf-8", errors="replace")
        return process.returncode, output, ""
