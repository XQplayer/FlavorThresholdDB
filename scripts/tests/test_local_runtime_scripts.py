from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
RUNTIME_SCRIPT = ROOT / "scripts" / "local_runtime.ps1"
CMD_WRAPPER = ROOT / "start_local.cmd"


class LocalRuntimeScriptTests(unittest.TestCase):
    def test_runtime_controller_uses_project_ports_and_health_checks(self):
        script = RUNTIME_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("[ValidateSet('start', 'check', 'stop')]", script)
        self.assertIn("5174", script)
        self.assertIn("8787", script)
        self.assertIn("--strictPort", script)
        self.assertIn("-WindowStyle Hidden", script)
        self.assertIn("/FlavorThresholdDB/aroma-threshold/", script)
        self.assertIn("/health", script)

    def test_runtime_controller_validates_project_ownership(self):
        script = RUNTIME_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("Get-NetTCPConnection", script)
        self.assertIn("Get-CimInstance", script)
        self.assertIn("fema_proxy_server.py", script)
        self.assertIn("vite", script.lower())
        self.assertIn("Refusing to manage", script)

    def test_cmd_is_only_a_compatibility_wrapper(self):
        wrapper = CMD_WRAPPER.read_text(encoding="utf-8")

        self.assertIn("scripts\\local_runtime.ps1", wrapper)
        self.assertNotIn("npm run dev", wrapper)
        self.assertNotIn("start \"FEMA flavor proxy\"", wrapper)


if __name__ == "__main__":
    unittest.main()
