"""Build a deterministic slim public spectrum identity index."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

from spectra_index_distribution import PUBLIC_INDEX_SCHEMA_VERSION, validate_index_manifest


SPECTRUM_COLUMNS = (
    "spectrum_id", "library_name", "inchikey", "inchikey_2d", "compound_name",
    "normalized_name", "smiles", "ion_mode", "ion_source", "adduct",
    "precursor_mz", "exact_mass", "instrument", "charge", "license_status",
)


def _create_schema(connection):
    connection.executescript("""
        PRAGMA foreign_keys=ON;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE libraries (
            name TEXT PRIMARY KEY,
            data_source TEXT NOT NULL DEFAULT '',
            display_source TEXT NOT NULL DEFAULT '',
            library_type TEXT NOT NULL DEFAULT '',
            spectra_count INTEGER NOT NULL DEFAULT 0,
            indexed_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE spectra (
            spectrum_id TEXT NOT NULL,
            library_name TEXT NOT NULL,
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
        CREATE INDEX idx_public_spectra_inchikey ON spectra(inchikey);
        CREATE INDEX idx_public_spectra_inchikey_2d ON spectra(inchikey_2d);
        CREATE INDEX idx_public_spectra_name ON spectra(normalized_name);
    """)


def build_public_index(source_path: Path, output_dir: Path, *, version: str, asset_url: str) -> dict:
    source_path = Path(source_path).resolve(strict=True)
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    final_sqlite = output_dir / f"public_spectrum_index-{version}.sqlite"
    archive_path = output_dir / f"public_spectrum_index-{version}.sqlite.gz"
    manifest_path = output_dir / f"public_spectrum_index-{version}.manifest.json"
    descriptor, temporary_name = tempfile.mkstemp(dir=output_dir, prefix=".public-spectrum-", suffix=".sqlite")
    os.close(descriptor)
    Path(temporary_name).unlink(missing_ok=True)
    try:
        target = sqlite3.connect(temporary_name)
        _create_schema(target)
        target.execute("ATTACH DATABASE ? AS source", (str(source_path),))
        target.execute("INSERT INTO libraries SELECT name, data_source, display_source, library_type, spectra_count, indexed_at FROM source.libraries ORDER BY name")
        select_columns = ",".join(SPECTRUM_COLUMNS)
        target.execute(f"""
            INSERT INTO spectra ({select_columns})
            SELECT spectrum_id, library_name, inchikey,
                   CASE WHEN inchikey_2d = '' AND inchikey != '' THEN substr(inchikey, 1, 14) ELSE inchikey_2d END,
                   compound_name, normalized_name, smiles, ion_mode, ion_source, adduct,
                   precursor_mz, exact_mass, instrument, charge, license_status
            FROM source.spectra ORDER BY library_name, spectrum_id
        """)
        target.executemany("INSERT INTO metadata VALUES (?,?)", [
            ("schema_version", str(PUBLIC_INDEX_SCHEMA_VERSION)),
            ("index_version", version),
        ])
        target.commit()
        target.execute("DETACH DATABASE source")
        integrity = target.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError(f"public index integrity check failed: {integrity}")
        target.execute("VACUUM")
        spectrum_count = target.execute("SELECT COUNT(*) FROM spectra").fetchone()[0]
        library_count = target.execute("SELECT COUNT(*) FROM libraries").fetchone()[0]
        target.close()
        shutil.move(temporary_name, final_sqlite)
        with final_sqlite.open("rb") as input_handle, archive_path.open("wb") as raw_output:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw_output, mtime=0) as compressed:
                shutil.copyfileobj(input_handle, compressed)
        digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        manifest = validate_index_manifest({
            "schema_version": PUBLIC_INDEX_SCHEMA_VERSION,
            "index_version": version,
            "asset_url": asset_url,
            "compression": "gzip",
            "sha256": digest,
            "compressed_bytes": archive_path.stat().st_size,
            "sqlite_bytes": final_sqlite.stat().st_size,
            "spectrum_count": spectrum_count,
            "library_count": library_count,
            "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "minimum_proxy_version": 1,
        })
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return {"sqlite_path": final_sqlite, "archive_path": archive_path, "manifest_path": manifest_path, "manifest": manifest}
    finally:
        Path(temporary_name).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--asset-url", required=True)
    args = parser.parse_args()
    result = build_public_index(args.source, args.output_dir, version=args.version, asset_url=args.asset_url)
    print(json.dumps({key: str(value) for key, value in result.items() if key.endswith("_path")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
