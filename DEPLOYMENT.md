# Open TradeFXBook online

This is a Flask application. GitHub Pages cannot execute its Python API, CSV
indexer, replay order execution or journal persistence. Publishing only its
HTML would produce a broken app.

## GitHub Codespaces

After the repository and dataset package are uploaded, choose Code → Codespaces
→ Create codespace. The included devcontainer restores the actual local CSV
files, installs requirements and starts port 5050. Open the private forwarded
TradeFXBook port. Codespaces may incur charges after account allowances; it is
a development environment, not an always-on public host.

## Render

Connect the GitHub repository in Render and use its Blueprint (`render.yaml`).
Review the Starter service and persistent disk charges before deploying. Set
TRADEFXBOOK_OWNER_PASSWORD when prompted; username is `trader`. Keep the generated
TRADEFXBOOK_SECRET. The container restores the real CSV files during its build.
The service's HTTPS URL opens the entire app after owner authentication.

State and the historical index go on the persistent disk. Use only one worker:
the current application is a single-owner workspace backed by a JSON store,
not an isolated multi-user SaaS database. Avoid multiple replicas. Back up the
persistent state file. Local account/journal data is intentionally not published.
If needed, privately transfer backend/store.json to the disk while the service
is stopped, never through a public repository.

## Share a github.io link

After the full app is live, set repository Settings → Pages → Source to
GitHub Actions. In Actions → Publish website link → Run workflow, supply the
actual Render HTTPS application URL. The workflow checks its health and publishes
the entry page at https://prog-anshu36.github.io/intensefxtrades/.
That shareable link redirects the browser to the full hosted app. GitHub Pages
does not execute Python, and the backend must remain running. No invented or
unverified live URL is embedded in the repository. The hosted app requires the
owner gate credentials; share access deliberately. It is currently a shared
single-owner workspace, not independently isolated accounts for each visitor.

## CSV transport

The original `XAUUSD_Data` has a file larger than GitHub's regular per-file
limit. `python scripts/dataset_package.py pack` creates deterministic gzip parts
of at most 4 MiB with a SHA-256 manifest. Commit `dataset-package/`, not the raw
CSV directory or SQLite caches. `python scripts/dataset_package.py restore`
restores the original filenames and exact bytes, verifying every part and final
CSV. It downloads nothing, changes no candle, and rejects conflicting existing
CSVs. Keep this repository private if your data is not licensed for redistribution.

The first history request builds the local index and may take time. Health checks
use `/healthz` and do not index data. No synthetic XAUUSD fallback is introduced.

## Local startup

Use a stable Python interpreter with Flask installed:

```powershell
python -m pip install -r requirements.txt
python backend/app.py
```

Open http://127.0.0.1:5050. Python installations have independent packages;
selecting a different interpreter in VS Code may require installing dependencies
for that interpreter too.
