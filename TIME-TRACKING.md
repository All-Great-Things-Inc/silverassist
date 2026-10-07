# Time tracking implementation

Phase 1: Calendar hours implemented; local tests pass for title prefix/word matching, ambiguity, elapsed time, start-date clipping, DST spring/fall and midnight splitting, duplicates, overlap review/merge, pagination, OAuth state binding/replay, encryption binding, server 401/403, non-200/no-store failure, and success-only cache. Settings live in `time_settings`; one server defaults source initializes unconfigured workspaces. No real Google connection or hosted migration verified.

Calendar OAuth is separate from portal authentication. Required runtime values: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TIME_TOKEN_KEY` (random 32-byte key encoded as 64 hex characters). Store in ignored local `.dev.vars` or the existing staging Worker's runtime secrets, never build variables or client code. Preserve the encryption key securely for recovery. Tokens remain AES-GCM encrypted in D1; access tokens exist only during server requests. Disconnect deletes portal credentials; Google grant revocation is a separate Google account action.

Register exactly `https://silverassist.allgreatthings.app/api/time/calendar/callback` and, for local testing, `http://localhost:5173/api/time/calendar/callback`. Enable Calendar API in a dedicated approved Google Cloud project. Request only `calendar.readonly`. Workspace Internal consent is suitable only if the project belongs to the connecting account's Workspace organization; otherwise review External publishing/testing expiry with the operator. See [Google OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).

Unmatched event contents are not persisted: review shows the date and an anonymous unmatched-event label. Ambiguous/overlapping matching titles are visible only to the owner. Calendar-recorded hours are elapsed event duration, not independent proof of completed work. Unexpected overlaps default to flagged summed hours; editable merge mode removes duplicate minutes.

Deployment: follow existing Workers Builds/reviewed PR process. No shell deployment, remote migration or provider provisioning performed. Migration 0010 is additive schema only; apply separately through the operator's reviewed migration procedure before enabling Time. The existing public checkout has no GitHub Actions or lint configuration. `npm run check` now also runs the time tests, using isolated in-memory SQLite and synthetic provider responses; these do not establish a live Calendar connection or workerd/D1 acceptance.

Phase 2: Time page with owner navigation, rollups/estimated value using effective rate history, cap-aware progress, no-cap monthly pace, monthly bars, daily heatmap/table, review items, connect/reconnect/disconnect, and stale/error messaging. Typecheck and synthetic Chrome browser checks pass at desktop and 390px mobile. Browser fixture: 23:00–02:00 Central => 1h + 2h, all rollups 3h. Initial failure displays no totals; refresh failure keeps prior totals explicitly labelled stale. Evidence is ignored under `.local/time-ui/`. Local Chrome launch requires OS permission outside the filesystem sandbox. No live provider test.

The supplied Google project is `time-tracking-portal` in the connecting account's Workspace organization, Internal audience. Existing runtime names are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Request only Calendar read-only permission even if the OAuth consent project lists additional identity scopes. Both callback URLs above still require registration by the owner/operator.

Phase 3: additive migration 0011, owner-only monthly invoice creation/list/detail/status updates/voiding and immutable audit. Creation freshly fetches Calendar, rejects unfinished months and overlaps, groups frozen rate history into invoice lines and retains the daily breakdown. Invoice numbering increments atomically with creation; one active invoice per client/month prevents double billing. Voiding preserves records and permits reissue. Mark-paid, undo-paid, totals by currency, optional block alerts and completed-month alerts are implemented. Twelve synthetic logic/database/API tests pass, including duplicate rollback, snapshot immutability, stale edits, audit, tax/extra-line totals and 401/403. Bill-from/to are deliberately empty until the owner completes settings. No issued financial record is editable after creation; use void/reissue.


Phase 4: server-side `pdf-lib` 1.17.1 generation from the frozen snapshot, multipage wrapping, date/number/status/terms/parties/line items/totals, Create & download and per-invoice PDF. The owner settings screen edits Calendar/account/timezone/week/title rules, rate/cap histories, monthly billing/optional block, terms, parties, currency/tax, payment details, numbering/filename, pace/cache/heatmap parameters. Save checks versions and writes immutable activity; changing account requires reconnect and invalidates cache. No prepaid mode was enabled: this engagement uses monthly arrears billing. PDFs use built-in Helvetica, no logo or email/archived binary. Unsupported PDF font characters are rejected before invoice issuance; custom fonts remain unsupported.

Verification: `npm run check` passes typecheck, production Worker/frontend builds, staging configuration/public-assets scan, fifteen synthetic pure-logic/database/provider tests and an actual isolated workerd/D1 suite with real Better Auth sessions. The latter checks all migrations, 401/403 for time/invoice methods, owner settings persistence, disconnected non-200 and immediate membership revocation. `npm run test:time-ui` passes synthetic Chrome desktop/390px mobile, direct Time routing, hand-computed 3h midnight fixture, initial error with no hour cards, stale refresh error, and settings save/layout. Browser suite currently uses Chrome's macOS executable; set `CHROME_EXECUTABLE` for another installation. It refuses an occupied preview port. PDF sample is 2.5h × $300 = $750; Poppler page rendering and pypdf extraction checked parties, total, terms and multipage layout. Evidence is ignored under `.local/time-tests`, `.local/time-ui`, `.local/time-runtime`, `.local/time-pdf`.

Online npm audit reports four high advisory entries in the existing Cloudflare dev-tool chain (`sharp` via Miniflare/Wrangler/Vite plugin), none in `pdf-lib`. Its suggested fixes downgrade the chosen toolchain; do not apply audit --force as part of this feature. A separate compatibility/security update is required. Offline audit output is not evidence that advisories disappeared.

## Handoff definition of done (local evidence versus live acceptance)

| Item | Evidence/status |
| --- | --- |
| Connect/disconnect; no visible tokens | Implemented; synthetic OAuth success/cancel/replay/wrong-account and encryption/disconnect tests pass. Real consent pending callbacks + runtime credentials. |
| Correct titled, midnight and in-progress hours | Pure tests pass, including start clipping and spring/fall DST. Browser sample reconciles 1h + 2h = 3h. Real Calendar sample pending. |
| Exclusions; ambiguous/unmatched review | Tests and owner UI pass. Unmatched personal titles are anonymous; overlap days remain tracked even if the attention list is truncated. |
| Failure banner, non-200, no error cache | Regression and browser checks pass; existing success data retained as explicitly stale, initial failure shows no hours. |
| Rollups/bars/pace/months/heatmap | Browser fixture passes; no-cap clients show no cap instead of an invented target. Cap history/projection/block math tested separately. |
| Billing server 401/403 | All methods tested in route fixtures and actual Worker/D1 with signed sessions; revoked ownership fails immediately. |
| Frozen invoice/PDF total | Snapshot, duplicate rollback, immutable SQL trigger and $750 PDF content/render tests pass. Create/download and per-row route implemented; real issued invoice pending. |
| Block/paid/outstanding | Pure threshold/ledger and audited paid/void tests pass. Monthly completed-period alert replaces blocks by default. |
| Editable business settings | Owner form and versioned save tests pass; Calendar/API/page/PDF read the same settings source or invoice snapshot. |
| Tests/build/CI | `npm run check` passes and is the existing Workers Builds build command. No lint script exists. No hosted build/deployment acceptance yet. |

## Exact remaining operator actions

1. Register both callback URLs shown above in the supplied Internal Google project.
2. Supply `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and an independent random `TIME_TOKEN_KEY` in ignored local configuration and separately in the existing staging Worker's runtime secret store. The workspace-level `secrets/` directory was empty when checked; no provider values were copied or logged. Never put these in build variables or Git.
3. Review additive migrations 0010–0012 and apply to the existing staging database through the reviewed operator migration procedure, with a backup. Build/install does not migrate remotely.
4. Review the four phase commits/PR before merging through the existing Workers Builds flow. No agent-shell deployment is permitted.
5. In the owner UI connect Calendar, verify a controlled titled event, reconnect/disconnect and failure behavior, then complete bill-from/to and payment instructions. First monthly period is October 2026 with hours included only from October 5; issue no earlier than November 1. An October/November invoice's default Net 30 due date is computed from its actual issue date.

No real Google connection, remote migration, provider configuration, email or production shell deployment occurred. This feature fetches Calendar on page/API requests with successful-result caching; it does not schedule unattended synchronization.
