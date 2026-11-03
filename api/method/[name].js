// Vercel serverless proxy: browser -> this function -> your Frappe site.
// The Frappe API key/secret stay here (server-side env vars), never in the browser bundle.
//
// Vercel env vars (do NOT prefix with VITE_):
//   FRAPPE_URL       https://your-site.com            (no trailing slash)
//   FRAPPE_TOKEN     api_key:api_secret
//   ACCESS_PASSWORD  the password people type once to use the tool
import { timingSafeEqual } from 'node:crypto'

const ALLOWED = new Set([
  'lead_finder_start', 'lead_finder_status', 'lead_finder_stop', 'lead_finder_runs',
  'lead_finder_suggest_areas', 'lead_finder_history', 'lead_finder_stored',
])

const same = (a, b) => {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && timingSafeEqual(x, y)
}

const fail = (res, status, message) =>
  res.status(status).json({ _server_messages: JSON.stringify([JSON.stringify({ message })]) })

export default async function handler(req, res) {
  const name = String(req.query.name || '')
  if (!ALLOWED.has(name)) return fail(res, 404, 'Not found.')
  if (req.method !== 'POST') return fail(res, 405, 'POST only.')

  const { FRAPPE_URL, FRAPPE_TOKEN, ACCESS_PASSWORD } = process.env
  if (!FRAPPE_URL || !FRAPPE_TOKEN || !ACCESS_PASSWORD) {
    return fail(res, 500, 'Server is not configured: set FRAPPE_URL, FRAPPE_TOKEN and ACCESS_PASSWORD in Vercel.')
  }
  if (!same(req.headers['x-access-password'], ACCESS_PASSWORD)) return fail(res, 401, 'Wrong access password.')

  try {
    const upstream = await fetch(FRAPPE_URL.replace(/\/+$/, '') + '/api/method/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'token ' + FRAPPE_TOKEN },
      body: JSON.stringify(req.body || {}),
    })
    res.status(upstream.status).setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.send(await upstream.text())
  } catch (e) {
    fail(res, 502, 'Could not reach the Frappe site.')
  }
}
