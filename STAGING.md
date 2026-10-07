# Staging source handoff to Jason

Repository: `All-Great-Things-Inc/silverassist`, branch `main`, root directory `/`.

| Setting | Value |
| --- | --- |
| Existing Worker | `silverassist-advisory-staging` |
| Cloudflare account | `e17f444f4a1bb3af2c1cb0f6d26441bc` |
| D1 binding | `DB` |
| Existing D1 database | `silverassist-advisory-staging` |
| D1 database ID | `ceaebbde-035f-4ab5-9168-8502b29a5ce8` |
| Attached hostname | `https://silverassist.allgreatthings.app/` |
| Dependency install | `npm ci` |
| Build command | `npm run check` |
| Deployment command, for Jason's Workers Builds settings only | `npx wrangler deploy` |

The top-level `wrangler.jsonc` has no environment blocks, routes, or custom domains. No `--env` flag is needed. `workers_dev` and preview URLs are disabled. Vite builds both the API Worker and the interface assets and generates the deployment configuration automatically. Keep its generated configuration redirect when deploying the build.

Jason connects the existing Worker to this repository's `main` branch through Workers Builds. A source push has no deployment effect before that connection. Configure the settings above for the existing staging Worker only; the deployment command is documented here, not executed by this handoff. [Cloudflare Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## Runtime prerequisites and limits

- The checked-in variables set `APP_ENV=staging` and `AUTH_BASE_URL` to `https://silverassist.allgreatthings.app`.
- The application needs a staging-only `AUTH_SECRET` installed in the Worker's runtime secret store. Never copy local secrets or put runtime credentials into Git/build assets.
- Set `AUTH_ALLOWED_EMAILS` as a runtime secret containing the exact approved account email addresses. Missing/empty configuration denies access. Runtime secrets are separate from Workers Builds variables.
- Numbered SQL files in `migrations/` provide schema only. Install/build does not apply migrations remotely or insert any rows.
- There is no hosted mail provider. Hosted sign-up marks an allowlisted address verified and does not send mail. Password reset and invitation delivery still require a mail provider.
- The first hosted account, and only that account, becomes owner of the SilverAssist Advisory workspace. Every later hosted account joins that workspace as a viewer. No saved local content is copied.
- Private/shared role behavior and the staging runtime still require live verification after Jason connects Builds. Source/build checks do not constitute a live acceptance test.

`silverassist.allgreatthings.app` is the attached hostname. The `silverassist-staging` hostname is removed. The production Worker and production database remain unused. Do not order a certificate and do not reattach the staging hostname.
