# Magnetron

Magnetron is a small web UI and JSON API for manually sending selected magnet
links into a media stack. It can index a magnet in bitmagnet, submit it to
qBittorrent, or do both in one request.

The app is intentionally boring:

- Configured only by environment variables.
- No Kubernetes API access.
- No secrets in files or Git.
- Stateless, with bounded in-memory recent submission history.
- Dependency-free at runtime.

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
python -m pip install -e .[dev]
python -m pytest -q
python -m magnetron.app
```

## OCI Image

The GitHub Actions workflow publishes images to GHCR:

```text
ghcr.io/amoenus/magnetron:main
ghcr.io/amoenus/magnetron:<git-sha>
ghcr.io/amoenus/magnetron:v0.1.0
```

Build locally:

```powershell
docker build -t magnetron:dev .
docker run --rm -p 8080:8080 magnetron:dev
```
