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

The included Blueprint starts `python fema_proxy_server.py`, enables automatic
deployment, and checks `/health`. The health response includes `api_version`
and Render's `deploy_commit` so a frontend release can be tied to a specific API
deployment. The public service supports:

- `/fema`
- `/compound`
- `/pubchem`
- `/flavordb`
- PubChem image, 3D, coordinate, and crystal helper routes
- `/spectra/*`, `/nist-webbook`, and `/biochemistry/resolve`
- `/biological-context/resolve`, `/bioactivity/resolve`, and `/structures/resolve`

After deployment, verify `/health` before updating `FEMA_API_URL`.

If Render auto-deploy is disabled, create a Render Deploy Hook and save it as
the protected GitHub Actions secret `RENDER_DEPLOY_HOOK_URL`. Then run the
`Deploy Render API` workflow with the expected API version. The workflow waits
for the versioned health response and verifies all public evidence endpoints;
the hook URL must never be committed or printed.

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
