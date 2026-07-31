# Deployment

FlavorThresholdDB uses a static frontend plus an external Python data proxy.

## Production components

| Component | Platform | Configuration |
| --- | --- | --- |
| React frontend | GitHub Pages | `.github/workflows/deploy-pages.yml` |
| Data proxy | Render | `render.yaml` and `fema_proxy_server.py` |
| Analytics | Supabase | `supabase/migrations/` and GitHub variables/secrets |

## GitHub Pages

Pushes to `main` trigger the Pages workflow. The build uses Node 22 and pnpm 11
and generates `dist/404.html` for direct route access.

Required repository configuration:

- Variable `FEMA_API_URL`: public Render service base URL.
- Variable `SUPABASE_URL`: Supabase project URL when analytics is enabled.
- Secret `SUPABASE_ANON_KEY`: Supabase anonymous client key.

Never commit production credentials to `.env`, source files, or documentation.

## Render API

The included Blueprint starts `python fema_proxy_server.py` and checks
`/health`. The public service currently supports:

- `/fema`
- `/compound`
- `/pubchem`
- `/flavordb`
- PubChem image, 3D, coordinate, and crystal helper routes

After deployment, verify `/health` before updating `FEMA_API_URL`.

## Local development

Start the API proxy and Vite frontend with `start_local.cmd`, or run them
separately. The default API fallback is `http://127.0.0.1:8787`.

Local-only files, release candidates, publication media, and backups belong
under `_local/` and are excluded from Git.

## Rollback

1. Identify the last verified Git tag.
2. Re-deploy that exact commit through GitHub Actions and Render.
3. Verify public routes and representative source queries.
4. Record the rollback reason in `CHANGELOG.md` before the next release.
