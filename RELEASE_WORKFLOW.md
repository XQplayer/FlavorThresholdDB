# FlavorThresholdDB Local Release Workflow

`E:\codex\Projects\FlavorThresholdDB` is the only development working tree and the
canonical local Git repository.

Local-only release material is stored under `_local/`:

- `_local/release-candidates/`: immutable snapshots prepared from a specific
  local Git commit for final release verification.
- `_local/backups/`: source backups created after a public release has been
  verified.
- `_local/publication-assets/`: local videos, covers, presentations, and other
  publication material that is not part of the deployed application.

The entire `_local/` directory is ignored by Git and must not be uploaded to
GitHub or deployed to GitHub Pages or Render.

## Release sequence

1. Finish and verify changes in the repository working tree.
2. Run frontend lint and production build checks.
3. Review the Git diff and commit the intended release locally.
4. Create a release-candidate snapshot from that exact commit under
   `_local/release-candidates/<version>-<timestamp>/`.
5. Verify the candidate frontend, API routes, CSV exports, and responsive UI.
6. Push the same commit and version tag to GitHub.
7. Verify GitHub Actions, GitHub Pages, Render health, and public data queries.
8. Create a final source archive under `_local/backups/` and record its SHA-256.

Do not edit a release candidate directly. Any fix must be made in the main
working tree, committed, and used to generate a new candidate snapshot.
