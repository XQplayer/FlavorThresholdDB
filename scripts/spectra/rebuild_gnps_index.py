"""Build a local identity index from GNPS2 per-library slim metadata."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from urllib.parse import quote
from urllib.request import urlopen


GNPS_LIBRARY_API_URL = "https://library.gnps2.org/api"
DEFAULT_INDEX_PATH = Path(__file__).resolve().parents[2] / "_local" / "indexes" / "gnps_spectra.sqlite"
SCHEMA_VERSION = 1


def fetch_json(url: str):
    with urlopen(url, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def _connect(index_path: Path | str) -> sqlite3.Connection:
    path = Path(index_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _initialize(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS libraries (
            name TEXT PRIMARY KEY,
            data_source TEXT NOT NULL DEFAULT '',
            display_source TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            library_type TEXT NOT NULL DEFAULT '',
            imported_at TEXT NOT NULL DEFAULT '',
            spectra_count INTEGER NOT NULL DEFAULT 0,
            indexed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS spectra (
            spectrum_id TEXT NOT NULL,
            library_name TEXT NOT NULL,
            spectrum_index INTEGER,
            inchikey TEXT NOT NULL DEFAULT '',
            inchikey_2d TEXT NOT NULL DEFAULT '',
            compound_name TEXT NOT NULL DEFAULT '',
            normalized_name TEXT NOT NULL DEFAULT '',
            smiles TEXT NOT NULL DEFAULT '',
            ion_mode TEXT NOT NULL DEFAULT '',
            ion_source TEXT NOT NULL DEFAULT '',
            adduct TEXT NOT NULL DEFAULT '',
            precursor_mz REAL,
            exact_mass REAL,
            instrument TEXT NOT NULL DEFAULT '',
            charge INTEGER,
            license_status TEXT NOT NULL DEFAULT 'needs_review',
            PRIMARY KEY (library_name, spectrum_id),
            FOREIGN KEY (library_name) REFERENCES libraries(name) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_gnps_spectra_inchikey ON spectra(inchikey);
        CREATE INDEX IF NOT EXISTS idx_gnps_spectra_inchikey_2d ON spectra(inchikey_2d);
        CREATE INDEX IF NOT EXISTS idx_gnps_spectra_name ON spectra(normalized_name);
        """
    )
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    connection.commit()


def _text(value) -> str:
    return str(value or "").strip()


def _normalized_name(value) -> str:
    return " ".join(_text(value).casefold().split())


def _number(value):
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _integer(value):
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _library_is_current(connection: sqlite3.Connection, library: dict) -> bool:
    row = connection.execute(
        "SELECT imported_at, spectra_count FROM libraries WHERE name = ?",
        (_text(library.get("name")),),
    ).fetchone()
    return bool(
        row
        and row["imported_at"] == _text(library.get("imported_at"))
        and row["spectra_count"] == int(library.get("spectra_count") or 0)
    )


def _replace_library(connection: sqlite3.Connection, library: dict, records: list[dict]) -> tuple[int, int]:
    name = _text(library.get("name"))
    indexed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    with connection:
        connection.execute("DELETE FROM spectra WHERE library_name = ?", (name,))
        connection.execute(
            """
            INSERT INTO libraries(
                name, data_source, display_source, description, library_type,
                imported_at, spectra_count, indexed_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                data_source=excluded.data_source,
                display_source=excluded.display_source,
                description=excluded.description,
                library_type=excluded.library_type,
                imported_at=excluded.imported_at,
                spectra_count=excluded.spectra_count,
                indexed_at=excluded.indexed_at
            """,
            (
                name,
                _text(library.get("data_source")),
                _text(library.get("display_source")),
                _text(library.get("description")),
                _text(library.get("type")),
                _text(library.get("imported_at")),
                int(library.get("spectra_count") or len(records)),
                indexed_at,
            ),
        )
        rows = []
        seen_spectrum_ids = set()
        duplicate_count = 0
        for record in records:
            spectrum_id = _text(record.get("spectrum_id"))
            if not spectrum_id:
                continue
            if spectrum_id in seen_spectrum_ids:
                duplicate_count += 1
                continue
            seen_spectrum_ids.add(spectrum_id)
            inchikey = _text(record.get("inchikey")).upper()
            rows.append(
                (
                    spectrum_id,
                    name,
                    _integer(record.get("spectrum_index")),
                    inchikey,
                    inchikey[:14] if len(inchikey) >= 14 else "",
                    _text(record.get("compound_name")),
                    _normalized_name(record.get("compound_name")),
                    _text(record.get("smiles")),
                    _text(record.get("ion_mode")),
                    _text(record.get("ion_source")),
                    _text(record.get("adduct")),
                    _number(record.get("precursor_mz")),
                    _number(record.get("exact_mass")),
                    _text(record.get("instrument")),
                    _integer(record.get("charge")),
                    "needs_review",
                )
            )
        connection.executemany(
            """
            INSERT INTO spectra(
                spectrum_id, library_name, spectrum_index, inchikey, inchikey_2d,
                compound_name, normalized_name, smiles, ion_mode, ion_source,
                adduct, precursor_mz, exact_mass, instrument, charge, license_status
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
    return len(rows), duplicate_count


def build_gnps_index(index_path=DEFAULT_INDEX_PATH, fetch_json=None, library_names=None) -> dict:
    fetcher = fetch_json or globals()["fetch_json"]
    report = {
        "libraries_total": 0,
        "libraries_updated": 0,
        "libraries_skipped": 0,
        "libraries_failed": 0,
        "spectra_indexed": 0,
        "duplicate_spectrum_ids": 0,
        "failures": [],
    }
    connection = _connect(index_path)
    try:
        _initialize(connection)
        libraries = fetcher(f"{GNPS_LIBRARY_API_URL}/libraries")
        if not isinstance(libraries, list):
            raise ValueError("GNPS library list is not an array")
        selected = set(library_names or [])
        libraries = [item for item in libraries if isinstance(item, dict) and (not selected or item.get("name") in selected)]
        report["libraries_total"] = len(libraries)
        for library in libraries:
            name = _text(library.get("name"))
            if not name:
                continue
            if _library_is_current(connection, library):
                report["libraries_skipped"] += 1
                continue
            try:
                records = fetcher(f"{GNPS_LIBRARY_API_URL}/libraries/{quote(name, safe='')}/spectra")
                if not isinstance(records, list):
                    raise ValueError("slim metadata response is not an array")
                inserted_count, duplicate_count = _replace_library(connection, library, records)
            except (OSError, TimeoutError, ValueError, sqlite3.Error) as exc:
                report["libraries_failed"] += 1
                report["failures"].append({"library": name, "error": str(exc)})
                continue
            report["libraries_updated"] += 1
            report["spectra_indexed"] += inserted_count
            report["duplicate_spectrum_ids"] += duplicate_count
        report["index_path"] = str(Path(index_path).resolve())
        return report
    finally:
        connection.close()


def query_gnps_index(index_path=DEFAULT_INDEX_PATH, inchikey="", name="", limit=500) -> list[dict]:
    path = Path(index_path)
    if not path.exists():
        return []
    connection = _connect(path)
    try:
        _initialize(connection)
        key = _text(inchikey).upper()
        if key:
            rows = connection.execute(
                """
                SELECT * FROM spectra
                WHERE inchikey = ? OR inchikey_2d = ?
                ORDER BY CASE WHEN inchikey = ? THEN 0 ELSE 1 END, library_name, spectrum_id
                LIMIT ?
                """,
                (key, key[:14], key, int(limit)),
            ).fetchall()
        elif _normalized_name(name):
            rows = connection.execute(
                "SELECT * FROM spectra WHERE normalized_name = ? ORDER BY library_name, spectrum_id LIMIT ?",
                (_normalized_name(name), int(limit)),
            ).fetchall()
        else:
            return []
        return [dict(row) for row in rows]
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX_PATH)
    parser.add_argument("--library", action="append", dest="libraries")
    args = parser.parse_args()
    print(json.dumps(build_gnps_index(args.index, library_names=args.libraries), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
