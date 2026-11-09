// Synthetic source documents. The agents read these; the demo never types a conclusion
// the model is supposed to reach. Shared by the browser (for display) and the API (as model input).

export const DOCS: Record<string, string> = {
  'web-app/src/api/session.ts': `// Starts a signed-in session after any login method succeeds.
import { post } from './http'

export const startSession = (token: string) =>
  post("/v1/session", { token })

export const endSession = () => post("/v1/session/end", {})`,

  'web-app/src/auth/password.ts': `// Email and password login. Must keep working after Google sign-in ships.
import { startSession } from '../api/session'

export async function loginWithPassword(email: string, password: string) {
  const { token } = await post('/auth/password', { email, password })
  return startSession(token)
}`,

  'web-app/src/pages/SignIn.tsx': `// The sign-in page: email field, password field, Sign in button.
export function SignIn() {
  return (
    <Form onSubmit={loginWithPassword}>
      <EmailField />
      <PasswordField />
      <Button type="submit">Sign in</Button>
    </Form>
  )
}`,

  'auth-spec.md': `# Google sign-in: design spec (Design team, Nov 4)

Frame 1: today's sign-in page, unchanged for email and password.
Frame 2: "Continue with Google" sits above the email field, full width, with an "or" divider below it.
Frame 3: errors show under the button, for example "Google sign-in was cancelled. Try again."

Both login methods stay. Ships with Friday's deploy, Nov 13.`,

  'e2e-tests/email-login.spec.ts': `test('email login', async ({ page }) => {
  await page.goto('/sign-in')
  await page.fill('[name=email]', 'qa@example.com')
  await page.fill('[name=password]', process.env.QA_PASSWORD)
  await page.click('text=Sign in')
  await expect(page).toHaveURL('/home')
})`,

  'e2e-tests/signup.spec.ts': `test('sign up', async ({ page }) => {
  await page.goto('/sign-up')
  // creates a user, then lands on /home
})`,

  'e2e-tests/reset-password.spec.ts': `test('reset password', async ({ page }) => {
  await page.goto('/reset')
  // sends a reset email through the staging mailbox
})`,

  'session-api-v2/CHANGELOG.md': `# Session API v2: changelog (Platform team)

## Nov 8
- /v1/session removed from staging. Removed from production Nov 12.
- Use POST /v2/session. It takes { token, provider } and returns the same session cookie.

## Oct 27
- POST /v2/session available on staging and production.
- /v1/session deprecated.`,

  'session-api-v2/README.md': `# Session API v2 (Platform team)

One endpoint for every login method: POST /v2/session with { token, provider }.
provider is "password", "google" or "sso".
Questions: #platform-sessions.`,

  'oauth-security.md': `# OAuth, done safely (Security team skill)
- Always send a state parameter and check it on the callback.
- Use PKCE for every authorization code flow.
- Never log access_token or id_token, not even at debug level.
- Store client secrets only in the secret manager.`,

  'react-components.md': `# Component patterns (Web team skill)
- Use <Button variant="provider"> for third-party sign-in.
- Errors go in <FieldError> under the control they belong to.
- Full-width buttons in auth forms.`,

  'lesson-check-changelogs.md': `# Lesson: check changelogs (saved from your last harvest)
Before a task calls another team's API, attach that project's changelog.`,
}

// What the neighbouring project (Session API v2) shares with other farms.
export const NEIGHBOUR_DOCS = ['session-api-v2/CHANGELOG.md', 'session-api-v2/README.md']

// A signpost can be a single file or a folder; a folder expands to every document inside it.
export function expandSignposts(names: string[]) {
  const out: string[] = []
  for (const n of names) {
    const hits = n.endsWith('/') ? Object.keys(DOCS).filter((k) => k.startsWith(n)) : DOCS[n] ? [n] : []
    for (const h of hits) if (!out.includes(h)) out.push(h)
  }
  return out
}
