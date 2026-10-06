# SilverAssist Advisory

The existing advisory portal: dashboard, workstream navigation, editable scope and version history, workstream items, formatted notes, decision workflow, workspace access, and account screens. Private/shared visibility is enforced by the Worker and workspace membership.

React/Vite serves the interface; a Cloudflare Worker provides the API with D1 persistence and Better Auth email/password accounts. This repository contains app source and schema, not saved engagement or account data.

## Staging handoff

This source targets the existing **silverassist-advisory-staging** Worker and dedicated staging D1 database. See [STAGING.md](STAGING.md) for Jason's Workers Builds settings and current limitations. The hostname is already managed in Cloudflare; no routes or custom domains are declared here.

Pushing source to `main` does not deploy until Jason connects Workers Builds. No deployment, database initialization/import, account creation, sample data insertion, email service, DNS change, or production setup is performed by install/build.

## Build and verify

Use Node.js 22.12 or later (tested locally with 22.21.1) and the checked-in dependency lockfile.

```sh
npm ci
npm run check
```

`check` runs TypeScript, builds the existing interface and Worker, and verifies the staging target, build output, and local/hosted separation. Output is under ignored `dist/`. It contains `dist/client` plus the compiled Worker configuration; the app requires both its Worker and assets.

## Local development

```sh
npm run setup:local
npm run dev
```

The setup command creates an ignored local authentication secret only and preserves an existing file. Add the exact approved local addresses as `AUTH_ALLOWED_EMAILS` in ignored `.dev.vars`. Empty/missing approval configuration denies access. Local development uses `wrangler.local.jsonc`, a placeholder local D1 ID, and a simulated mail bucket; remote bindings are disabled. The explicit `db:migrate:local` command applies schema only to local storage; it does not populate records.

Fresh local state has no accounts or workspace records. The existing owner's original local checkout and data remain separate and are not replaced by this source checkout. Existing private initialization, account-recovery tools, test evidence, planning seeds, and project handoffs were intentionally retained locally outside the public repository.

Real verification/recovery/invitation email remains unconfigured. Hosted onboarding and transfer of saved local records require a separate approved procedure. Signup does not grant workspace ownership. Local development mail and one-use local access do not provide hosted access.

## Privacy and data

Keep `.env`/`.dev.vars`, credentials, passwords, sessions, databases, exports, uploaded documents, screenshots, mail links, and advisory notes outside Git. The account and database IDs in Wrangler are public resource identifiers. No automatic seed/import runs in this app. Decisions have an independent progress state; sharing remains an explicit owner action.
