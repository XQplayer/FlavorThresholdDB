"""Validation and installation primitives for public spectrum indexes."""

from __future__ import annotations

from datetime import datetime
import re
from urllib.parse import urlparse


PUBLIC_INDEX_SCHEMA_VERSION = 1
REQUIRED_MANIFEST_FIELDS = {
    "schema_version", "index_version", "asset_url", "compression", "sha256",
    "compressed_bytes", "sqlite_bytes", "spectrum_count", "library_count",
    "created_at", "minimum_proxy_version",
}


def validate_index_manifest(manifest: dict) -> dict:
    if not isinstance(manifest, dict):
        raise ValueError("index manifest must be an object")
    missing = REQUIRED_MANIFEST_FIELDS - manifest.keys()
    if missing:
        raise ValueError(f"index manifest missing fields: {', '.join(sorted(missing))}")
    if manifest["schema_version"] != PUBLIC_INDEX_SCHEMA_VERSION:
        raise ValueError("unsupported public index schema")
    if not str(manifest["index_version"]).strip():
        raise ValueError("index version is required")
    parsed_url = urlparse(str(manifest["asset_url"]))
    if parsed_url.scheme != "https" or not parsed_url.netloc:
        raise ValueError("index asset URL must use HTTPS")
    if manifest["compression"] != "gzip":
        raise ValueError("unsupported index compression")
    if not re.fullmatch(r"[0-9a-f]{64}", str(manifest["sha256"])):
        raise ValueError("index SHA-256 must be lowercase hexadecimal")
    for field in ("compressed_bytes", "sqlite_bytes", "minimum_proxy_version"):
        if not isinstance(manifest[field], int) or manifest[field] <= 0:
            raise ValueError(f"{field} must be a positive integer")
    for field in ("spectrum_count", "library_count"):
        if not isinstance(manifest[field], int) or manifest[field] < 0:
            raise ValueError(f"{field} must be a non-negative integer")
    if manifest["compressed_bytes"] > manifest["sqlite_bytes"]:
        raise ValueError("compressed index cannot exceed declared SQLite size")
    try:
        datetime.fromisoformat(str(manifest["created_at"]).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("created_at must be an ISO-8601 timestamp") from exc
    return dict(manifest)


def find_forbidden_tracked_index_files(paths) -> list[str]:
    forbidden = re.compile(r"(?:\.sqlite(?:-(?:wal|shm|journal))?|\.db|\.sqlite\.(?:gz|zst)|gnps[^/]*\.(?:gz|zst))$", re.IGNORECASE)
    return [str(path) for path in paths if forbidden.search(str(path).replace("\\", "/"))]
