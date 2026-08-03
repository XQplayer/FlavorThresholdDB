from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import fema_proxy_server
from shimadzu_analysis_service import ShimadzuAnalysisError


class FakeService:
    def __init__(self):
        self.created = None
        self.template_root = tempfile.TemporaryDirectory()
        self.template_path = f"{self.template_root.name}/template.xlsx"
        with open(self.template_path, "wb") as handle:
            handle.write(b"xlsx-template")

    def capabilities(self):
        return {"available": True, "stages": [{"index": 0}], "oav_enabled": False}

    def create_job(self, raw_name, raw_bytes, samples_name, samples_bytes, options):
        self.created = (raw_name, raw_bytes, samples_name, samples_bytes, options)
        return {"id": "11111111-1111-1111-1111-111111111111", "status": "created"}

    def start(self, job_id):
        return {"id": job_id, "status": "queued"}

    def continue_job(self, job_id):
        return {"id": job_id, "status": "queued"}

    def get_job(self, job_id):
        if job_id == "missing":
            raise ShimadzuAnalysisError("JOB_NOT_FOUND", "job does not exist", 404)
        return {"id": job_id, "status": "running"}

    def get_download_path(self, job_id):
        raise ShimadzuAnalysisError("DOWNLOAD_NOT_READY", "not ready", 409)

    def get_template_path(self, template_id):
        if template_id not in {"raw-example", "sample-info"}:
            raise ShimadzuAnalysisError("TEMPLATE_NOT_FOUND", "missing", 404)
        from pathlib import Path
        return Path(self.template_path)


def multipart_body(fields, files):
    boundary = "----shimadzu-test-boundary"
    chunks = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            str(value).encode("utf-8"),
            b"\r\n",
        ])
    for name, filename, content in files:
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode(),
            b"Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n",
            content,
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return boundary, b"".join(chunks)


class ShimadzuProxyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_service = getattr(fema_proxy_server, "SHIMADZU_SERVICE", None)
        cls.service = FakeService()
        fema_proxy_server.SHIMADZU_SERVICE = cls.service
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), fema_proxy_server.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        if cls.original_service is None:
            delattr(fema_proxy_server, "SHIMADZU_SERVICE")
        else:
            fema_proxy_server.SHIMADZU_SERVICE = cls.original_service

    def request_json(self, path, *, method="GET", body=None, headers=None):
        request = urllib.request.Request(self.base + path, data=body, method=method, headers=headers or {})
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_capabilities_and_job_status_routes(self):
        status, payload = self.request_json("/shimadzu/capabilities")
        self.assertEqual(status, 200)
        self.assertTrue(payload["available"])
        status, payload = self.request_json("/shimadzu/jobs/job-1")
        self.assertEqual((status, payload["status"]), (200, "running"))

    def test_template_download_route_returns_xlsx(self):
        request = urllib.request.Request(self.base + "/shimadzu/templates/raw-example")
        with urllib.request.urlopen(request, timeout=3) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            self.assertEqual(response.read(), b"xlsx-template")

    def test_create_job_accepts_two_workbooks_and_options(self):
        boundary, body = multipart_body(
            {"options": json.dumps({"mode": "step", "name": "CT batch"})},
            [("raw", "raw.xlsx", b"raw"), ("samples", "samples.xlsx", b"samples")],
        )
        status, payload = self.request_json(
            "/shimadzu/jobs",
            method="POST",
            body=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        self.assertEqual((status, payload["status"]), (201, "created"))
        self.assertEqual(self.service.created[0:4], ("raw.xlsx", b"raw", "samples.xlsx", b"samples"))
        self.assertEqual(self.service.created[4]["mode"], "step")

    def test_run_continue_and_structured_service_error(self):
        for action in ("run", "continue"):
            status, payload = self.request_json(f"/shimadzu/jobs/job-1/{action}", method="POST", body=b"{}", headers={"Content-Type": "application/json"})
            self.assertEqual((status, payload["status"]), (202, "queued"))
        request = urllib.request.Request(self.base + "/shimadzu/jobs/missing")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=3)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual((caught.exception.code, payload["code"]), (404, "JOB_NOT_FOUND"))


if __name__ == "__main__":
    unittest.main()
