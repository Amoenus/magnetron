# AGENTS.md

## Setup

- Install dependencies: `npm install`
- Start dev server: `npm run dev`
- Typecheck: `npm run typecheck`
- Production build: `npm run build`

## Stack

- T3 scaffold with Next.js App Router, TypeScript, tRPC, Tailwind CSS v4.
- shadcn/ui v4 with Radix primitives and Lucide icons.
- React Hook Form + Zod for client-side form validation.
- Prefer dark product UI for this app unless the user asks otherwise.

## Product Rules

- Catalog history must come from bitmagnet. Do not add local fallback rows.
- Submission success means downstream calls succeeded; display verification only
  after bitmagnet returns the item in history.
- Keep live status compact and contextual. Row-level status belongs in rows.
- Validation should appear inline on blur, not only after submit.
- TMDB search is optional and controlled by `TMDB_API_KEY`.
- qBittorrent 5.2 API-key auth uses `Authorization: Bearer <key>`.

## shadcn

- Check project component context with `npx shadcn@latest info`.
- Use `npx shadcn@latest docs <component>` before adding unfamiliar components.
- Prefer composing existing `src/components/ui/*` primitives over inventing
  bespoke controls.
