"""Small atomic persistent cache with source-specific biochemical TTLs."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path


SCHEMA_VERSION = 1
TTLS = {
    "ChEBI": timedelta(days=30),
    "Rhea": timedelta(days=7),
    "UniProt": timedelta(days=7),
    "NCBI Gene": timedelta(days=7),
    "NCBI Taxonomy": timedelta(days=30),
    "MetaboLights": timedelta(days=1),
    "PubChem BioAssay": timedelta(days=1),
    "ChEMBL": timedelta(days=7),
    "GtoPdb": timedelta(days=7),
    "BindingDB": timedelta(days=7),
}
PERSISTABLE = {"ok", "no_data", "candidate"}


class BiochemistryCache:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self._lock = threading.RLock()

    def _load(self) -> dict:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            return payload if payload.get("schema_version") == SCHEMA_VERSION else {"schema_version": SCHEMA_VERSION, "entries": {}}
        except Exception:
            return {"schema_version": SCHEMA_VERSION, "entries": {}}

    def get(self, source: str, key: str, *, now=None):
        reference = now or datetime.now(timezone.utc)
        entry = self._load().get("entries", {}).get(f"{source}:{key}")
        if not isinstance(entry, dict):
            return None
        try:
            stored = datetime.fromisoformat(entry["stored_at"].replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            return None
        if reference - stored > TTLS.get(source, timedelta(0)):
            return None
        return entry.get("value")

    def set(self, source: str, key: str, value: dict, *, now=None) -> bool:
        if value.get("status") not in PERSISTABLE:
            return False
        reference = now or datetime.now(timezone.utc)
        with self._lock:
            payload = self._load()
            payload.setdefault("entries", {})[f"{source}:{key}"] = {"stored_at": reference.isoformat(), "value": value}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, name = tempfile.mkstemp(dir=self.path.parent, prefix=f".{self.path.name}.", suffix=".tmp")
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                    json.dump(payload, handle, ensure_ascii=False, indent=2)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(name, self.path)
            finally:
                Path(name).unlink(missing_ok=True)
        return True
