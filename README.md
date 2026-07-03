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

## Local Development

```powershell
uv sync
uv run pytest -q
uv run uvicorn magnetron.app:app --host 0.0.0.0 --port 8080
```

## OCI Image

The GitHub Actions workflow packages Magnetron as an APK with melange, builds a
minimal Wolfi OCI image with apko, publishes it to GHCR, and signs published
image tags with Sigstore Cosign keyless signing through GitHub OIDC:

```text
ghcr.io/amoenus/magnetron:main
ghcr.io/amoenus/magnetron:<git-sha>
ghcr.io/amoenus/magnetron:v0.1.0
```

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

The repository also publishes a small KCL module that exports the pinned
runtime image coordinates for GitOps consumers:

```kcl
import magnetron.image

image.repository
image.tag
image.digest
image.ref
```

Published module:

```text
oci://ghcr.io/amoenus/magnetron-kcl:0.1.5
```
