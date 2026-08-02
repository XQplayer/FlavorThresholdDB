"""Validation and installation primitives for public spectrum indexes."""

from __future__ import annotations

from datetime import datetime
import gzip
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from urllib.parse import urlparse
from urllib.request import Request, urlopen


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


def inspect_public_index(path: Path, *, full: bool = True) -> dict:
    path = Path(path)
    if not path.exists():
        raise ValueError("public spectrum index is missing")
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        if full and connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("public spectrum index failed integrity check")
        metadata = dict(connection.execute("SELECT key, value FROM metadata"))
        if int(metadata.get("schema_version", 0)) != PUBLIC_INDEX_SCHEMA_VERSION:
            raise ValueError("public spectrum index schema mismatch")
        return {
            "index_version": metadata.get("index_version", ""),
            "schema_version": int(metadata["schema_version"]),
            "spectrum_count": connection.execute("SELECT COUNT(*) FROM spectra").fetchone()[0],
            "library_count": connection.execute("SELECT COUNT(*) FROM libraries").fetchone()[0],
        }
    finally:
        connection.close()


def _download_to_path(url: str, path: Path):
    request = Request(url, headers={"User-Agent": "FlavorThresholdDB/1 public-index-installer"})
    with urlopen(request, timeout=120) as response, path.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def install_public_index(manifest: dict, runtime_dir: Path, *, fetch_to_path=None, proxy_version: int = 1) -> dict:
    manifest = validate_index_manifest(manifest)
    runtime_dir = Path(runtime_dir).resolve()
    runtime_dir.mkdir(parents=True, exist_ok=True)
    index_path = runtime_dir / "public_spectrum_index.sqlite"
    old_info = None
    try:
        # A candidate receives a full integrity check before atomic install.
        # Startup reuse only verifies schema/version/counts so a 1 GB index does
        # not block every proxy restart for minutes.
        old_info = inspect_public_index(index_path, full=False)
    except (ValueError, OSError, sqlite3.Error):
        pass
    if old_info and old_info["index_version"] == manifest["index_version"] and old_info["spectrum_count"] == manifest["spectrum_count"] and old_info["library_count"] == manifest["library_count"]:
        return {"status": "ready", "installed": False, "index_path": str(index_path), **old_info}
    if proxy_version < manifest["minimum_proxy_version"]:
        return {"status": "stale" if old_info else "invalid", "installed": False, "index_path": str(index_path), "error": "proxy version is below manifest minimum"}

    archive_fd, archive_name = tempfile.mkstemp(dir=runtime_dir, prefix=".public-spectrum-", suffix=".sqlite.gz")
    os.close(archive_fd)
    sqlite_fd, sqlite_name = tempfile.mkstemp(dir=runtime_dir, prefix=".public-spectrum-", suffix=".sqlite")
    os.close(sqlite_fd)
    archive_path = Path(archive_name)
    candidate_path = Path(sqlite_name)
    try:
        (fetch_to_path or _download_to_path)(manifest["asset_url"], archive_path)
        if archive_path.stat().st_size != manifest["compressed_bytes"]:
            raise ValueError("downloaded index size mismatch")
        digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        if digest != manifest["sha256"]:
            raise ValueError("downloaded index SHA-256 mismatch")
        with gzip.open(archive_path, "rb") as compressed, candidate_path.open("wb") as output:
            while chunk := compressed.read(1024 * 1024):
                output.write(chunk)
        if candidate_path.stat().st_size != manifest["sqlite_bytes"]:
            raise ValueError("decompressed index size mismatch")
        candidate_info = inspect_public_index(candidate_path)
        for field in ("index_version", "spectrum_count", "library_count"):
            if candidate_info[field] != manifest[field]:
                raise ValueError(f"public spectrum index {field} mismatch")
        os.replace(candidate_path, index_path)
        return {"status": "ready", "installed": True, "index_path": str(index_path), **candidate_info}
    except Exception as exc:
        return {"status": "stale" if old_info else "invalid", "installed": False, "index_path": str(index_path), "error": str(exc), **(old_info or {})}
    finally:
        archive_path.unlink(missing_ok=True)
        candidate_path.unlink(missing_ok=True)
