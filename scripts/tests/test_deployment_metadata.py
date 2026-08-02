import os
import unittest
from unittest.mock import patch

from fema_proxy_server import build_health_payload


class DeploymentMetadataTests(unittest.TestCase):
    def test_health_exposes_api_version_and_optional_render_commit(self):
        with patch.dict(os.environ, {"API_VERSION": "1.5.0", "RENDER_GIT_COMMIT": "abc123"}, clear=False):
            payload = build_health_payload()
        self.assertEqual(payload["api_version"], "1.5.0")
        self.assertEqual(payload["deploy_commit"], "abc123")
        self.assertTrue(payload["ok"])


if __name__ == "__main__":
    unittest.main()
