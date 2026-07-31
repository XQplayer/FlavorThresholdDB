# FlavorThresholdDB Migration Repair Design

## Goal

Make `E:\codex\Projects\FlavorThresholdDB` the sole active local working tree after the project move, while preserving the former directory in a recoverable archive.

## Design

- Replace obsolete absolute development and release paths in project documentation with the current project root.
- Keep project scripts location-independent by resolving files relative to the script directory. The local launcher will use an installed runtime first and then the bundled Codex runtime when available.
- Produce a real `/aroma-threshold/` build entry so GitHub Pages can return HTTP 200 for that direct URL; retain `404.html` as the fallback for unknown SPA routes.
- Reconstruct the missing v1.3.1 release candidate directly from Git commit `4cbe586`, not from the dirty working tree, and record integrity metadata.
- Compare the former directory with the current tree, then move the whole former directory into `E:\codex\Projects\_migration-archive` instead of deleting it.

## Safety and verification

- Do not commit, push, tag, or deploy.
- Do not overwrite the existing final v1.3.1 backup.
- Verify tests, lint, production build, route artifacts, Git identity, archive integrity, release-candidate commit identity, and absence of active old-path references.

