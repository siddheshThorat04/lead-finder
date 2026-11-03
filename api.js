// Talks to the Frappe Server Script APIs. Set VITE_MOCK=1 for sample data without a server.
export const MOCK = import.meta.env.VITE_MOCK === '1'
// Rough Google Places Text Search price per request (USD). Check current pricing and adjust.
export const PRICE_PER_REQUEST = 0.035

const BASE = '' // always same origin; the Vite proxy forwards /api/ to your Frappe site in dev
// Dev only: "api_key:api_secret" for the local Vite proxy. Never used in a production build,
// where the Vercel function holds the token and people enter ACCESS_PASSWORD instead.
const TOKEN = import.meta.env.DEV ? (import.meta.env.VITE_FRAPPE_TOKEN || '') : ''

async function call(method, params = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (import.meta.env.PROD) {
    let pass = ''
    try { pass = sessionStorage.getItem('lf-pass') || '' } catch (e) { /* storage blocked */ }
    if (!pass) {
      pass = window.prompt('Enter the access password for the Lead Finder') || ''
      try { sessionStorage.setItem('lf-pass', pass) } catch (e) { /* storage blocked */ }
    }
    headers['X-Access-Password'] = pass
  } else if (TOKEN) headers.Authorization = 'token ' + TOKEN
  else if (window.csrf_token) headers['X-Frappe-CSRF-Token'] = window.csrf_token
  const res = await fetch(BASE + '/api/method/' + method, {
    method: 'POST', headers, credentials: 'include', body: JSON.stringify(params),
  })
  let data = {}
  try { data = await res.json() } catch (e) { /* not json */ }
  if (res.status === 401 && import.meta.env.PROD) { try { sessionStorage.removeItem('lf-pass') } catch (e) { /* ignore */ } }
  if (!res.ok) {
    let msg = 'Request failed (' + res.status + ')'
    try {
      const m = JSON.parse(data._server_messages || '[]')
      if (m.length) msg = JSON.parse(m[0]).message.replace(/<[^>]+>/g, '')
    } catch (e) { /* keep default */ }
    throw new Error(msg)
  }
  return data.message
}

// ---- tiny in-memory mock ----
let mockRows = []
let mockStart = 0
const mockRun = () => {
  const done = Math.min(mockRows.length, 8)
  const finished = Date.now() - mockStart > 6000
  return { name: 'LFR-00001', city: 'Demo City', status: finished ? 'Done' : 'Running', tasks_total: 8,
    tasks_done: finished ? 8 : done, areas_covered: finished ? 2 : 1, results_count: mockRows.length,
    requests_used: 12, failed_tasks: 0, current_area: 'Demo Area', last_error: '', elapsed: Math.round((Date.now() - mockStart) / 1000) }
}

export const suggestAreas = (city) => MOCK ? Promise.resolve(['Demo Area', 'Sample Nagar']) : call('lead_finder_suggest_areas', { city })
export const listRuns = () => MOCK ? Promise.resolve([]) : call('lead_finder_runs')
export const getHistory = (city) => MOCK ? Promise.resolve({ searches: [], results: 0 }) : call('lead_finder_history', { city })
export const getStored = (city, start = 0) => MOCK ? Promise.resolve({ rows: [], next: 0, has_more: false, total: 0 }) : call('lead_finder_stored', { city, start })
export const stopRun = (run) => MOCK ? Promise.resolve({ run }) : call('lead_finder_stop', { run })
export const startRun = (payload) => {
  if (!MOCK) return call('lead_finder_start', payload)
  mockStart = Date.now()
  mockRows = Array.from({ length: 30 }, (_, i) => ({
    seq: i + 1, place_id: 'p' + i, name: 'Sample Dental Clinic ' + (i + 1), phone: '098765 4' + String(3210 + i),
    intl: '+91 98765 4' + String(3210 + i), website: '', address: 'Street ' + (i + 1) + ', Demo Area', area: 'Demo Area',
    rating: 3.5 + (i % 15) / 10, reviews: 10 + i * 7, status: 'OPERATIONAL', maps_url: 'https://maps.google.com',
  }))
  return Promise.resolve({ run: 'LFR-00001', tasks: 8, skipped: 0, max_requests: 24 })
}
export const getRun = (run, after = 0) => {
  if (!MOCK) return call('lead_finder_status', { run, after })
  const elapsed = Math.min(30, Math.floor((Date.now() - mockStart) / 200))
  const rows = mockRows.slice(0, elapsed).filter((r) => r.seq > after)
  return Promise.resolve({ run: mockRun(), rows, after: rows.length ? rows[rows.length - 1].seq : after, has_more: false })
}
