# Release Checklist

## Scope

- [ ] Version number and intended changes are defined.
- [ ] `git status` contains only release-related changes.
- [ ] Data-source and license implications were reviewed.
- [ ] `README.md`, `CHANGELOG.md`, and relevant docs are updated.

## Local verification

- [ ] `pnpm run lint` passes in `frontend/`.
- [ ] `pnpm run build` passes in `frontend/`.
- [ ] `pnpm audit --prod` reports no high or critical production vulnerabilities.
- [ ] `pnpm run test:e2e` passes desktop, mobile, and external-service failure isolation.
- [ ] Local startup leaves exactly one project-owned frontend process on 5174 and one proxy process on 8787（单实例）.
- [ ] PubChem PUG View cache entries use the current schema/parser version and a direct refresh matches the cached scientific classification.
- [ ] Home and search pages load without console errors.
- [ ] Chinese and English interfaces work.
- [ ] Exact, fuzzy, and batch searches work.
- [ ] Filters independently control chemical, medium, source, and threshold results.
- [ ] Compact and detailed CSV exports match the selected filters.
- [ ] CAS values remain Excel-safe text in exported CSV files.
- [ ] Desktop, tablet, and mobile layouts have no horizontal overflow.
- [ ] Keyboard focus and reduced-motion behavior are usable.
- [ ] FEMA, PubChem, FlavorDB2, and book records were spot-checked.

## Candidate and publication

- [ ] Changes were committed locally.
- [ ] Candidate snapshot was generated from the exact release commit.
- [ ] Candidate was verified without editing it directly.
- [ ] Annotated version tag was created.
- [ ] Commit and tag were pushed to GitHub.
- [ ] GitHub Actions and Pages deployment succeeded.
- [ ] Render `/health` and representative API queries succeeded.
- [ ] Public home, direct search route, and CSV export were verified.

## Backup

- [ ] Source archive was written to `_local/backups/`.
- [ ] SHA-256 was calculated and recorded.
- [ ] Release commit, tag, deployment result, and known warnings were recorded.
