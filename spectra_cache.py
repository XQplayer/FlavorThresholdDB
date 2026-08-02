"""Schema-versioned, license-aware cache for the open spectra layer."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import threading

from spectra_service import license_policy


SCHEMA_VERSION = 1
SEARCH_TTL = timedelta(hours=24)
DETAIL_TTL = timedelta(days=30)


class OpenSpectraCache:
    def __init__(self, path: Path, *, now=None):
        self.path = Path(path)
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._lock = threading.RLock()
        self._memory_details = {}
        self._persistent = self._load()

    def _load(self):
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"schema_version": SCHEMA_VERSION, "search": {}, "details": {}}
        if payload.get("schema_version") != SCHEMA_VERSION:
            return {"schema_version": SCHEMA_VERSION, "search": {}, "details": {}}
        payload.setdefault("search", {})
        payload.setdefault("details", {})
        return payload

    def _timestamp(self):
        return self._now().astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    def _current(self, entry, ttl):
        if not isinstance(entry, dict) or "value" not in entry:
            return False
        try:
            stored = datetime.fromisoformat(str(entry["stored_at"]).replace("Z", "+00:00"))
        except (KeyError, ValueError):
            return False
        age = self._now().astimezone(timezone.utc) - stored.astimezone(timezone.utc)
        return timedelta(0) <= age <= ttl

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(dir=self.path.parent, prefix=f".{self.path.name}.", suffix=".tmp")
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(self._persistent, handle, ensure_ascii=False, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def get_search(self, key):
        with self._lock:
            entry = self._persistent["search"].get(str(key))
            return entry["value"] if self._current(entry, SEARCH_TTL) else None

    def put_search(self, key, value):
        with self._lock:
            self._persistent["search"][str(key)] = {"stored_at": self._timestamp(), "value": value}
            self._save()

    @staticmethod
    def _detail_key(source, spectrum_id):
        return f"{str(source).casefold()}:{spectrum_id}"

    def get_detail(self, source, spectrum_id):
        key = self._detail_key(source, spectrum_id)
        with self._lock:
            memory = self._memory_details.get(key)
            if self._current(memory, DETAIL_TTL):
                return memory["value"]
            persistent = self._persistent["details"].get(key)
            return persistent["value"] if self._current(persistent, DETAIL_TTL) else None

    def put_detail(self, source, spectrum_id, record):
        key = self._detail_key(source, spectrum_id)
        entry = {"stored_at": self._timestamp(), "value": record}
        with self._lock:
            if license_policy(record)["download_allowed"]:
                self._persistent["details"][key] = entry
                self._save()
            else:
                self._memory_details[key] = entry
