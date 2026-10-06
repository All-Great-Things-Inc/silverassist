import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

const source = JSON.parse(await readFile('wrangler.jsonc', 'utf8'))
assert.equal(source.name, 'silverassist-advisory-staging')
assert.equal(source.account_id, 'e17f444f4a1bb3af2c1cb0f6d26441bc')
assert.equal(source.compatibility_date, '2026-10-06')
assert.equal(source.workers_dev, false)
assert.equal(source.preview_urls, false)
assert.equal(source.vars.APP_ENV, 'staging')
assert.equal(source.vars.AUTH_BASE_URL, 'https://silverassist.allgreatthings.app')
for (const key of ['env', 'routes', 'r2_buckets', 'kv_namespaces']) assert.equal(key in source, false)
for (const key of ['AUTH_SECRET', 'AUTH_ALLOWED_EMAILS']) assert.equal(key in source.vars, false)
assert.deepEqual(source.d1_databases, [{
  binding: 'DB', database_name: 'silverassist-advisory-staging',
  database_id: 'ceaebbde-035f-4ab5-9168-8502b29a5ce8', migrations_dir: 'migrations',
}])

const redirectPath = resolve('.wrangler/deploy/config.json')
const redirect = JSON.parse(await readFile(redirectPath, 'utf8'))
const builtPath = resolve(dirname(redirectPath), redirect.configPath)
const built = JSON.parse(await readFile(builtPath, 'utf8'))
for (const key of ['name', 'account_id', 'compatibility_date', 'workers_dev', 'preview_urls']) {
  assert.equal(built[key], source[key])
}
assert.equal(built.d1_databases.length, 1)
for (const key of ['binding', 'database_name', 'database_id']) {
  assert.equal(built.d1_databases[0][key], source.d1_databases[0][key])
}
assert.equal(resolve(dirname(builtPath), built.d1_databases[0].migrations_dir), resolve('migrations'))
assert.deepEqual(built.vars, source.vars)
assert.equal(Object.keys(built.env ?? {}).length, 0)
assert.equal((built.routes ?? []).length, 0)
assert.equal((built.r2_buckets ?? []).length, 0)
assert.equal(built.assets.not_found_handling, 'single-page-application')
assert.deepEqual(built.assets.run_worker_first, ['/api/*'])
const worker = await readFile(resolve(dirname(builtPath), built.main), 'utf8')
assert.equal(worker.includes('silverassist-local-mail'), false)
assert.equal(worker.includes('local-owner-access:'), false, 'CLI capability redemption must be absent from the hosted Worker')

async function inspectAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    assert.equal(/^(?:\.env|\.dev\.vars|\.wrangler|\.local)/.test(entry.name), false)
    if (entry.isDirectory()) await inspectAssets(path)
    else {
      const contents = await readFile(path, 'utf8')
      assert.equal(/AUTH_SECRET=|github_pat_|ghp_[A-Za-z0-9]{20}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(contents), false)
      assert.equal(contents.includes('ceaebbde-035f-4ab5-9168-8502b29a5ce8'), false)
      assert.equal(/[\w.+-]+@(?:allgreatthings\.io|silverassist\.com)/.test(contents), false)
    }
  }
}
await inspectAssets(resolve('dist/client'))
assert.match(await readFile('dist/client/index.html', 'utf8'), /SilverAssist Advisory/)

const local = JSON.parse(await readFile('wrangler.local.jsonc', 'utf8'))
assert.equal(local.account_id, undefined)
assert.equal(local.vars.APP_ENV, 'local')
assert.equal(local.vars.AUTH_BASE_URL, 'http://localhost:5173')
assert.equal(local.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000001')
assert.equal(local.d1_databases[0].remote, false)
assert.equal(local.r2_buckets[0].remote, false)
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
for (const value of Object.values(pkg.scripts)) {
  assert.equal(/(?:\blogin\b|\bdeploy\b|--remote|--env|seed|bootstrap)/.test(value), false)
}
console.log('PASS exact staging target, generated Worker/assets, hosted capability exclusion, public asset scan, and isolated local bindings; no rows or remote resources changed.')
