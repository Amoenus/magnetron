# Magnetron

Magnetron is a personal manual intake console for selected magnet links. It
submits a magnet to bitmagnet, qBittorrent, or both, then shows only what can be
read back from bitmagnet catalog history.

This version is a T3 rewrite:

- Next.js App Router
- TypeScript
- tRPC
- Tailwind CSS v4
- shadcn/ui with Radix primitives
- React Hook Form + Zod for in-place validation

## Why The Pivot

The Python/FastAPI proof of concept proved the integration shape, but the UI was
doing too much by hand. The T3 stack gives Magnetron typed server/client calls,
strong environment validation, a modern component workflow, and a much better
base for richer app interactions.

## Runtime Behavior

- Submissions call downstream services directly.
- Catalog rows come only from bitmagnet GraphQL history.
- If bitmagnet history is unavailable, Magnetron shows an unavailable state and
  no local fallback rows.
- Validation happens inline on field blur.
- TMDB search is optional and enabled by `TMDB_API_KEY`.
- qBittorrent API-key requests use `Authorization: Bearer <key>`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` locally, `8080` in the OCI image | Next.js listen port. |
| `BITMAGNET_URL` | `http://bitmagnet:3333` | bitmagnet base URL. |
| `BITMAGNET_SOURCE` | `manual-web` | bitmagnet import source and history filter. |
| `QBITTORRENT_URL` | `http://qbittorrent:8080` | qBittorrent base URL. |
| `QBITTORRENT_API_KEY` | empty | API key for download mode. |
| `QBITTORRENT_CATEGORY` | `discord-intake` | qBittorrent category. |
| `QBITTORRENT_TAGS` | `discord-intake` | qBittorrent tags. |
| `TMDB_API_KEY` | empty | Optional TMDB API key or read token for title search. |
| `DEFAULT_ACTION` | `index` | Default intake action: `index`, `download`, or `both`. |

## Local Development

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

Useful checks:

```powershell
npm run typecheck
npm run build
```

## Hardened OCI Image

```powershell
go install chainguard.dev/melange@v0.56.0
go install chainguard.dev/apko@v1.2.21
melange keygen
melange build melange.yaml --arch amd64 --signing-key melange.rsa
apko build apko.yaml magnetron:dev magnetron.tar -k melange.rsa.pub
```

The release workflow keeps the original hardened supply-chain shape: melange
packages Magnetron as an APK, apko builds a minimal Wolfi OCI image, the image
runs as a nonroot user, and published images are signed with Sigstore Cosign.
The runtime payload is now Next.js standalone output executed by Wolfi
`nodejs-24`, not Python.

Verify a published signature:

```powershell
cosign verify ghcr.io/amoenus/magnetron:main `
  --certificate-identity-regexp "https://github.com/Amoenus/magnetron/.github/workflows/oci-image.yaml@refs/heads/main" `
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## KCL Module

The repository still publishes a KCL module that exports pinned runtime image
coordinates and minimal Kubernetes Resource Model manifests for GitOps
consumers:

```kcl
import magnetron.image

image.repository
image.tag
image.digest
image.ref
```

Render the default Kubernetes manifests:

```powershell
kcl run kubernetes.k
```

## Notes For Future Agents

The T3 scaffold was created with:

```powershell
npm create t3-app@latest -- C:\Git\_magnetron_t3_scaffold --CI --trpc --tailwind --appRouter --noGit --noInstall
```

shadcn/ui was initialized with Radix primitives:

```powershell
npx shadcn@latest init --defaults --base radix --yes --pointer
```

Use `npx shadcn@latest info` and `npx shadcn@latest docs <component>` before
adding or heavily changing UI primitives.
