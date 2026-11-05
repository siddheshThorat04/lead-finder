export const uniq = (list) => {
  const seen = new Set()
  return list.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
}

export const splitList = (text) => text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)

// Words from the city name, used to keep only results whose address mentions the city.
export const cityWords = (city) => (city || '').toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 3)

// Indian numbers: +91 then 10 digits starting 6-9 is a mobile. Anything else is treated as a landline.
export const phoneType = (intl) => {
  const d = (intl || '').replace(/[^\d]/g, '')
  if (!d) return ''
  if (d.startsWith('91') && d.length === 12) return /^[6-9]/.test(d.slice(2)) ? 'Mobile' : 'Landline'
  return ''
}

// [1, '…a', 4, 5, 6, '…b', 20]; strings are gaps and need unique keys.
export const pageList = (cur, count) => {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const out = [1]
  if (cur > 3) out.push('gap-a')
  for (let p = Math.max(2, cur - 1); p <= Math.min(count - 1, cur + 1); p++) out.push(p)
  if (cur < count - 2) out.push('gap-b')
  out.push(count)
  return out
}

const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'
const slug = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40)

// city_keyword_date.csv, e.g. mumbai_gym_2026-11-05.csv
// keyword = the search term(s) found in the rows; several terms are joined, many become "multiple".
const csvName = (rows, city, fallbackKeyword) => {
  const found = uniq(rows.map((r) => r.term).filter(Boolean))
  const keyword = found.length === 0 ? fallbackKeyword : found.length <= 3 ? found.join('-') : 'multiple'
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  return (slug(city) || 'leads') + '_' + (slug(keyword) || 'all') + '_' + date + '.csv'
}

export const downloadCsv = (rows, city, fallbackKeyword) => {
  const head = ['Name', 'Found by', 'Phone', 'International phone', 'Rating', 'Reviews', 'Address', 'Area', 'Website', 'Google Maps']
  const lines = [head.map(esc).join(',')].concat(rows.map((r) =>
    [r.name, r.term, r.phone, r.intl, r.rating, r.reviews, r.address, r.area, r.website, r.maps_url].map(esc).join(',')))
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = csvName(rows, city, fallbackKeyword)
  a.click()
  URL.revokeObjectURL(a.href)
}

// Same normalisation the server uses for area / term / city keys.
export const norm = (s) => String(s || '').toLowerCase().split(/\s+/).filter(Boolean).join(' ')
