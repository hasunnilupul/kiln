// Smoke test for an unzipped client build (M4 exit). Plain Node.js with no dependencies, so it runs
// on a clean machine that has only Node.js and PostgreSQL.
//
//   node smoke-check-client.mjs <base url> <admin email> <initial admin password>
//
// Waits for the POS to start, then checks health, database, licence, first sign-in, the till,
// the admin, the branding logo and the PWA manifest. Exits non-zero on the first failure.

const [baseUrl = 'http://localhost:3000', email, password] = process.argv.slice(2)

function check(condition, message) {
  if (!condition) {
    console.error(`✖ ${message}`)
    process.exit(1)
  }
  console.log(`✔ ${message}`)
}

async function waitForHealth(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let last = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      const body = await response.json()
      if (response.ok) return body
      last = `${response.status} ${JSON.stringify(body)}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  console.error(`✖ POS did not become healthy: ${last}`)
  process.exit(1)
}

const health = await waitForHealth()
check(health.app === 'ok', 'app is up')
check(health.database === 'ok', 'database is reachable and migrated')
check(health.licence?.status === 'valid', `licence is valid (${JSON.stringify(health.licence)})`)

if (email && password) {
  const login = await fetch(`${baseUrl}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await login.json().catch(() => ({}))
  check(login.ok, `seeded admin can sign in (${login.status})`)
  check(body.user?.mustChangePassword === true, 'first sign-in forces a password change')
}

for (const [path, expected] of [
  ['/', 'the cashier screen'],
  ['/admin/login', 'the admin'],
  ['/branding/logo.svg', 'the branding logo'],
]) {
  const response = await fetch(`${baseUrl}${path}`)
  check(response.ok, `${expected} is served (${path} → ${response.status})`)
}

const manifest = await fetch(`${baseUrl}/manifest.webmanifest`).then((r) => r.json())
check(
  typeof manifest.name === 'string' && manifest.name.endsWith('POS'),
  `PWA manifest is branded ("${manifest.name}")`,
)

console.log('\nClient build works.')
