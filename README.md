# Magnetron

Magnetron is a small web UI and JSON API for manually sending selected magnet
links into a media stack. It can index a magnet in bitmagnet, submit it to
qBittorrent, or do both in one request.

The app is intentionally boring:

- Configured only by environment variables.
- No Kubernetes API access.
- No secrets in files or Git.
- Stateless, with bounded in-memory recent submission history.
- FastAPI application managed with `uv`.

## Runtime API

```text
GET  /healthz
GET  /readyz
GET  /api/intake/recent
POST /api/intake/magnet
GET  /settings
POST /settings
```

`POST /api/intake/magnet` accepts:

```json
{
  "magnet": "magnet:?xt=urn:btih:...",
  "action": "index",
  "contentType": "tv_show",
  "contentSource": "tmdb",
  "contentId": "89180"
}
```

`action` can be `index`, `download`, or `both`.
`contentType` defaults to `tv_show`; use `movie` or `unknown` when the manual
submission is not a TV episode. `contentSource` and `contentId` are optional
paired fields for known external IDs; supported sources are `tmdb` and `imdb`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port. |
| `BASE_URL` | `http://localhost:8080` | UI base URL. |
| `BITMAGNET_URL` | `http://bitmagnet:3333` | bitmagnet base URL. |
| `BITMAGNET_SOURCE` | `manual-web` | bitmagnet source label. |
| `QBITTORRENT_URL` | `http://qbittorrent:8080` | qBittorrent base URL. |
| `QBITTORRENT_API_KEY` | empty | qBittorrent API key for download mode. |
| `QBITTORRENT_CATEGORY` | `discord-intake` | qBittorrent category. |
| `QBITTORRENT_TAGS` | `discord-intake` | qBittorrent tags. |
| `DEFAULT_ACTION` | `index` | Default UI action. |
| `MAGNETRON_CONFIG_PATH` | `$XDG_CONFIG_HOME/magnetron/config.json` or `~/.config/magnetron/config.json` | UI-managed settings file path. |

Environment variables are authoritative. The settings UI can only edit fields
that are not configured through environment variables. Sensitive values such as
`QBITTORRENT_API_KEY` are masked in the UI and preserved when the settings form
is saved with the password field left blank.

## UI Architecture

The UI remains server-rendered with FastAPI and Jinja2. Templates are split into
a base layout, reusable form macros, and fragments. HTMX is used for small
partial updates, such as refreshing the recent submissions table, while standard
synchronous form submission remains the fallback path.

Recent submission history is sourced from bitmagnet through its GraphQL API when
available, filtered by the configured `BITMAGNET_SOURCE`. The in-memory local
history is retained as a short-lived fallback for just-submitted items and for
cases where bitmagnet history is temporarily unavailable. The normalized history
view includes bitmagnet-discovered metadata when available.

## Local Development

```powershell
uv sync
uv run pytest -q
uv run uvicorn magnetron.app:app --host 0.0.0.0 --port 8080
```

Optional CSS toolchain:

```powershell
volta install node
npm install
npm run css:build
```

`src/magnetron/static/app.css` remains checked in and is served directly by
FastAPI. The Tailwind CLI scaffold is intentionally minimal so the Python
application does not require a frontend dev server. Node and npm versions are
pinned through Volta in `package.json`.

## OCI Image

The GitHub Actions workflow packages Magnetron as an APK with melange, builds a
minimal Wolfi OCI image with apko, publishes it to GHCR, and signs published
image tags with Sigstore Cosign keyless signing through GitHub OIDC:

```text
ghcr.io/amoenus/magnetron:main
ghcr.io/amoenus/magnetron:sha-<short-sha>
ghcr.io/amoenus/magnetron:vX.Y.Z
```

Release image tags are convenience references. For reproducible deployments,
prefer the immutable digest shown in the GitHub Release and exported by the KCL
module.

Local OCI build prerequisites are Go, apko, melange, and uv:

```powershell
go install chainguard.dev/melange@v0.56.0
go install chainguard.dev/apko@v1.2.21
melange keygen
melange build melange.yaml --arch amd64 --signing-key melange.rsa
apko build apko.yaml magnetron:dev magnetron.tar -k melange.rsa.pub
```

Verify a published signature:

```powershell
cosign verify ghcr.io/amoenus/magnetron:main `
  --certificate-identity-regexp "https://github.com/Amoenus/magnetron/.github/workflows/oci-image.yaml@refs/heads/main" `
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## KCL Module

The repository also publishes a KCL module that exports the pinned runtime
image coordinates and minimal Kubernetes Resource Model manifests for GitOps
consumers:

```kcl
import magnetron.image

image.repository
image.tag
image.digest
image.ref
```

Published module:

```text
oci://ghcr.io/amoenus/magnetron-kcl:latest
oci://ghcr.io/amoenus/magnetron-kcl:X.Y.Z
```

Use `latest` for quick evaluation. Use the `X.Y.Z` module tag for reproducible
GitOps inputs. The generated Kubernetes deployment uses `image.ref`, so the
runtime image remains digest-pinned.

Render the default Kubernetes manifests:

```powershell
kcl run kubernetes.k
```

## Releases

Release versions come from Git tags. Use `vX.Y.Z` for GitHub releases and OCI
image tags; package and module metadata use the plain `X.Y.Z` value derived from
the tag.

```powershell
git tag vX.Y.Z
git push origin vX.Y.Z
```

Tag builds inject the derived version into release artifacts, publish and sign
the OCI image, publish the KCL module as both `X.Y.Z` and `latest`, and create a
GitHub Release that documents the human-readable image tag, immutable image
digest, and KCL module references.
