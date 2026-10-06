# SilverAssist Advisory source

Preserve the existing React portal, Worker authorization, versioned records, rich text editor, and private-by-default access. Source control contains application code and schema only; saved advisory content, account data, documents, secrets, and local state stay outside this public repository.

The top-level Wrangler configuration targets only the existing `silverassist-advisory-staging` Worker and its `DB` binding. Keep the specified account/database IDs. Do not add environment blocks, environment flags, routes, custom domains, or production resources. The staging hostname is managed separately in Cloudflare.

Jennifer authorized publishing this app source on `main`. Jason will connect Cloudflare Workers Builds. Do not run Cloudflare login/deployment/provisioning, change DNS or certificates, insert sample/customer rows, or configure/send email as part of this source handoff. Repository pushes are separate from deployment until Jason connects Builds.

Use `npm run check` to verify the build and staging configuration. Local development uses `wrangler.local.jsonc` and local simulated bindings. No automatic migrations, seeding, owner bootstrap, or data import run during install/build. Authentication requires runtime secrets, schema initialization, and separately approved owner onboarding before hosted use. Development email and local access shortcuts are unavailable in hosted builds.
