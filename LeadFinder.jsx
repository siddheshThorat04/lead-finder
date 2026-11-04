import { useMemo, useRef, useState, useEffect } from 'react'
import { MOCK, PRICE_PER_REQUEST, getHistory, getRun, getStored, listRuns, startRun, stopRun, suggestAreas } from './api.js'
import { cityWords, downloadCsv, norm, pageList, phoneType, splitList, uniq } from './utils.js'

const STORE = 'lead-finder.v1'
const PAGE = 25
const ACTIVE = ['Queued', 'Running']
const DEFAULT_TERMS = []
const DEFAULT_ADV = { pages: 3, onlyPhone: false, minRating: 0, match: '', region: 'IN', force: false }

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') } catch (e) { return {} }
}

const Svg = ({ children, size = 24, fill = 'currentColor', stroke = 'none' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const ToothIcon = ({ size = 44 }) => (
  <Svg size={size} fill="none" stroke="currentColor"><path d="M3 9l1.500-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6" /></Svg>
)
const PinIcon = () => <Svg><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.500A2.500 2.500 0 1 1 12 6.500a2.500 2.500 0 0 1 0 5z" /></Svg>
const StarIcon = ({ size = 24 }) => <Svg size={size}><path d="M12 2l3 6.600 7.200.8-5.400 4.900 1.500 7.100L12 17.800 5.700 21.400l1.500-7.100L1.800 9.400 9 8.600z" /></Svg>
const ClinicIcon = () => <Svg><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z" /></Svg>
const ClockIcon = () => <Svg fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
const LinkIcon = () => <Svg size={18} fill="none" stroke="currentColor"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>

function ChipInput({ items, onChange, placeholder, disabled, scroll, doneSet }) {
  const [text, setText] = useState('')
  const add = () => { if (text.trim()) onChange(uniq([...items, ...splitList(text)])); setText('') }
  return (
    <div className="chipbox">
      <div className={'chips' + (scroll ? ' scroll' : '')}>
        {items.map((it) => (
          <span className={'chip' + (doneSet && doneSet.has(it) ? ' done' : '')} key={it} title={doneSet && doneSet.has(it) ? 'Already searched for every term, will be skipped' : undefined}>{doneSet && doneSet.has(it) ? '\u2713 ' : ''}{it}
            <button type="button" aria-label={'Remove ' + it} disabled={disabled} onClick={() => onChange(items.filter((x) => x !== it))}>×</button>
          </span>
        ))}
      </div>
      <input value={text} disabled={disabled} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }} onBlur={add} />
    </div>
  )
}

export default function LeadFinder() {
  const saved = useMemo(loadSaved, [])
  const [city, setCity] = useState(saved.city || '')
  const [areas, setAreas] = useState(saved.areas || [])
  const [terms, setTerms] = useState(saved.terms || DEFAULT_TERMS)
  const [adv, setAdv] = useState({ ...DEFAULT_ADV, ...(saved.adv || {}) })
  const [runName, setRunName] = useState(saved.runName || '')
  const [info, setInfo] = useState(null) // progress of the run, from the server
  const [rows, setRows] = useState([])
  const [runs, setRuns] = useState([])
  const [error, setError] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState({ key: 'reviews', dir: -1 })
  const [page, setPage] = useState(1)
  const [hist, setHist] = useState({ keys: {}, results: 0 }) // searches already done for this city
  const [stored, setStored] = useState([]) // businesses already saved for this city
  const [debCity, setDebCity] = useState('')
  const [doneTick, setDoneTick] = useState(0)
  const [termFilter, setTermFilter] = useState('') // show one search term only
  const [scope, setScope] = useState('run') // 'run' = only the open search, 'city' = everything saved for the city
  const after = useRef(0)
  const running = Boolean(info) && ACTIVE.includes(info.status)

  const refreshRuns = () => listRuns().then(setRuns).catch(() => {})
  useEffect(() => { refreshRuns() }, [])

  // Once the city box settles, load what is already saved for that city.
  useEffect(() => {
    const t = setTimeout(() => setDebCity(city.trim()), 500)
    return () => clearTimeout(t)
  }, [city])

  useEffect(() => {
    if (debCity.length < 2) { setHist({ keys: {}, results: 0 }); setStored([]); return undefined }
    let dead = false
    ;(async () => {
      try {
        const h = await getHistory(debCity)
        if (dead) return
        const keys = {}
        h.searches.forEach(([a, t, p]) => { keys[a + '|' + t] = p })
        setHist({ keys, results: h.results })
        let start = 0
        let all = []
        for (;;) {
          const res = await getStored(debCity, start)
          if (dead) return
          all = all.concat(res.rows)
          start = res.next
          if (!res.has_more) break
        }
        setStored(all)
      } catch (e) { /* history is a bonus; searching still works without it */ }
    })()
    return () => { dead = true }
  }, [debCity, doneTick])

  // Remember the settings and which search was open (the results themselves live on the server).
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ city, areas, terms, adv, runName })) } catch (e) { /* storage blocked */ }
  }, [city, areas, terms, adv, runName])

  // Follow the open search: load its rows, then keep checking every 2 seconds while it runs.
  useEffect(() => {
    if (!runName) return undefined
    let dead = false
    let timer = 0
    const pullAll = async () => {
      let res = await getRun(runName, after.current)
      for (;;) {
        if (dead) return res
        after.current = res.after
        if (res.rows.length) setRows((prev) => prev.concat(res.rows))
        setInfo(res.run)
        if (!res.has_more) return res
        res = await getRun(runName, after.current)
      }
    }
    const loop = async () => {
      try {
        const res = await pullAll()
        if (dead) return
        if (ACTIVE.includes(res.run.status)) timer = setTimeout(loop, 2000)
        else { refreshRuns(); setDoneTick((t) => t + 1); if (res.run.last_error) setError(res.run.last_error) }
      } catch (e) {
        if (dead) return
        if (/not found/i.test(e.message)) { setRunName(''); setInfo(null); return }
        setError(e.message)
        timer = setTimeout(loop, 5000)
      }
    }
    loop()
    return () => { dead = true; clearTimeout(timer) }
  }, [runName])

  const openRun = (name) => {
    setScope('run')
    if (!name || name === runName) return
    const hit = runs.find((r) => r.name === name)
    if (hit) setCity(hit.city)
    setRows([]); after.current = 0; setInfo(null); setError(''); setPage(1); setFilter('')
    setRunName(name)
  }

  const taskCount = areas.length * terms.length
  const doneFor = (a) => terms.filter((t) => (hist.keys[norm(a) + '|' + norm(t)] || 0) >= adv.pages).length
  const doneAreas = useMemo(
    () => (adv.force || !terms.length ? new Set() : new Set(areas.filter((a) => doneFor(a) === terms.length))),
    [areas, terms, hist, adv.pages, adv.force]
  )
  const skipCount = adv.force ? 0 : areas.reduce((n, a) => n + doneFor(a), 0)
  const newTasks = taskCount - skipCount
  const maxRequests = newTasks * adv.pages
  const perTask = 0.9 + (adv.pages - 1) * 0.8 // rough seconds per search on the server
  const fmtMin = (sec) => (sec < 60 ? '< 1 min' : '~ ' + Math.ceil(sec / 60) + ' min')

  const findAreas = async () => {
    setError(''); setSuggesting(true)
    try {
      const found = await suggestAreas(city.trim())
      if (!found.length) setError('No areas found automatically for this city. Type them in below.')
      setAreas((prev) => uniq([...prev, ...found]))
    } catch (e) { setError(e.message) }
    setSuggesting(false)
  }

  const start = async () => {
    setError('')
    if (!city.trim()) return setError('Enter a city first.')
    if (!areas.length) return setError('Add at least one area, or press "Find areas".')
    if (!terms.length) return setError('Add at least one search term.')
    if (newTasks === 0) return setError('Every area and term you picked was already searched for ' + city.trim() + ', so there is nothing new to run. The saved businesses are on the right. Tick "Search again even if already done" in Advanced options to repeat them.')
    const worst = newTasks * adv.pages
    const msg = 'About to run ' + newTasks + ' new searches' + (skipCount ? ' (' + skipCount + ' already done, skipped)' : '') + ' (up to ' + worst + ' Google requests, roughly $' + (worst * PRICE_PER_REQUEST).toFixed(0) + ').' +
      '\nIt keeps running on the server even if you close this page. Your previous searches stay available.\n\nContinue?'
    if (!window.confirm(msg)) return
    const words = (adv.match.trim() ? adv.match.split(',') : cityWords(city)).map((x) => x.trim()).filter(Boolean)
    setStarting(true)
    try {
      const res = await startRun({
        city: city.trim(), areas, terms,
        options: { pages: adv.pages, only_phone: adv.onlyPhone, min_rating: adv.minRating, match: words, region: adv.region.trim(), force: adv.force },
      })
      if (!res.run) { setError('Everything was already searched, so nothing new was started.'); setStarting(false); return }
      setRows([]); after.current = 0; setPage(1); setFilter(''); setScope('run')
      setInfo({ name: res.run, city: city.trim(), status: 'Queued', tasks_total: res.tasks, tasks_done: 0, areas_covered: 0, results_count: 0, requests_used: 0, failed_tasks: 0, current_area: '', last_error: '', elapsed: 0 })
      setRunName(res.run)
      refreshRuns()
    } catch (e) { setError(e.message) }
    setStarting(false)
  }

  const stop = () => { stopRun(runName).catch((e) => setError(e.message)) }
  const reset = () => {
    if (running) return
    setCity(''); setAreas([]); setTerms(DEFAULT_TERMS); setAdv(DEFAULT_ADV); setRows([]); setError('')
    after.current = 0; setInfo(null); setRunName('')
  }

  // ----- results table -----
  // Saved businesses for the city plus whatever the open search has found, one row per place.
  const runRows = info && city.trim() && norm(info.city) !== norm(city) ? [] : rows
  const all = useMemo(() => {
    const seen = new Set()
    const out = []
    stored.concat(runRows).forEach((r) => {
      if (r.place_id) { if (seen.has(r.place_id)) return; seen.add(r.place_id) }
      out.push(r)
    })
    return out
  }, [stored, runRows])
  const scoped = info && scope === 'run' ? rows : all // what the table, stats and CSV show
  const termList = useMemo(() => uniq(scoped.map((r) => r.term).filter(Boolean)).sort(), [scoped])
  const activeTerm = termList.includes(termFilter) ? termFilter : ''
  const view = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const base = activeTerm ? scoped.filter((x) => (x.term || '') === activeTerm) : scoped
    let r = q ? base.filter((x) => (x.name + ' ' + x.address + ' ' + x.phone + ' ' + x.area + ' ' + (x.term || '')).toLowerCase().includes(q)) : base
    const { key, dir } = sort
    return [...r].sort((a, b) => {
      const av = a[key] == null ? -1 : a[key], bv = b[key] == null ? -1 : b[key]
      return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir
    })
  }, [scoped, filter, sort, activeTerm])
  const pageCount = Math.max(1, Math.ceil(view.length / PAGE))
  const cur = Math.min(page, pageCount)
  const slice = view.slice((cur - 1) * PAGE, cur * PAGE)
  const sortBy = (key) => { setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'name' || key === 'term' ? 1 : -1 })); setPage(1) }
  const arrow = (key) => (sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')

  const rated = scoped.filter((r) => r.rating)
  const avg = rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : '\u2013'
  const withPhone = scoped.filter((r) => r.phone).length
  const pct = info && info.tasks_total ? Math.round((info.tasks_done / info.tasks_total) * 100) : 0
  const covered = info ? info.areas_covered : 0
  let timeLabel = 'Est. time', timeValue = fmtMin(newTasks * perTask)
  if (running) timeValue = fmtMin((info.tasks_total - info.tasks_done) * perTask)
  else if (info) { timeLabel = 'Time taken'; timeValue = fmtMin(info.elapsed) }

  return (
    <div className="lf">
      <div className="shell">
        <header className="head">
          <span className="logo"><ToothIcon /></span>
          <div className="title">
            <h1>Business Lead Finder</h1>
            <p>Pull any kind of business from Google Places for any city, then download a call list</p>
          </div>
          <div className="power">{MOCK ? <span className="demo">Sample data mode</span> : <><b>Connected to</b> your Frappe site</>}</div>
        </header>

        <div className="layout">
          {/* ---------------- settings ---------------- */}
          <aside className="panel">
            <h2 className="panel-h">Search settings</h2>

            <label className="lbl" htmlFor="city">City</label>
            <input id="city" className="field" placeholder="e.g. Chandigarh" value={city} disabled={running} onChange={(e) => setCity(e.target.value)} />

            <div className="lbl-row">
              <span className="lbl">Areas to search <small>({areas.length})</small></span>
              {areas.length > 0 && <button type="button" className="link" disabled={running} onClick={() => setAreas([])}>Clear all</button>}
            </div>
            <ChipInput items={areas} onChange={setAreas} disabled={running} scroll doneSet={doneAreas} placeholder="Type an area, press Enter (commas work too)" />
            <button type="button" className="ghost wide" disabled={running || suggesting || !city.trim()} onClick={findAreas}>
              {suggesting ? 'Finding areas...' : city.trim() ? 'Find areas in ' + city.trim() : 'Find areas (enter a city first)'}
            </button>
            <p className="hint">Finds neighbourhoods from Google. Remove the ones you do not need, or paste your own list, for example Sector 7, Sector 8.</p>

            <span className="lbl">Search terms</span>
            <ChipInput items={terms} onChange={setTerms} disabled={running} placeholder="What to find, e.g. gym, salon, restaurant. Press Enter" />

            <details className="adv">
              <summary>Advanced options</summary>
              <label className="row">Pages per search
                <select value={adv.pages} disabled={running} onChange={(e) => setAdv({ ...adv, pages: Number(e.target.value) })}>
                  <option value={1}>1 (20 results)</option><option value={2}>2 (40 results)</option><option value={3}>3 (60 results)</option>
                </select>
              </label>
              <label className="row">Minimum rating
                <select value={adv.minRating} disabled={running} onChange={(e) => setAdv({ ...adv, minRating: Number(e.target.value) })}>
                  <option value={0}>Any</option><option value={3}>3.0+</option><option value={3.5}>3.5+</option><option value={4}>4.0+</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={adv.force} disabled={running} onChange={(e) => setAdv({ ...adv, force: e.target.checked })} /> Search again even if already done</label>
              <label className="check"><input type="checkbox" checked={adv.onlyPhone} disabled={running} onChange={(e) => setAdv({ ...adv, onlyPhone: e.target.checked })} /> Only businesses with a phone number</label>
              <label className="col">Keep addresses containing
                <input className="field" placeholder={cityWords(city).join(', ') || 'defaults to the city name'} value={adv.match} disabled={running} onChange={(e) => setAdv({ ...adv, match: e.target.value })} />
                <small>Comma separated. Add nearby towns to include them, for example Mohali, Panchkula.</small>
              </label>
              <label className="col">Country code
                <input className="field short" maxLength={2} value={adv.region} disabled={running} onChange={(e) => setAdv({ ...adv, region: e.target.value.toUpperCase() })} />
              </label>
            </details>

            <div className="estimate">
              {taskCount > 0
                ? <><b>{newTasks}</b> new searches{skipCount > 0 && <> ({skipCount} already done, skipped)</>}, up to <b>{maxRequests}</b> requests, roughly <b>${(maxRequests * PRICE_PER_REQUEST).toFixed(0)}</b></>
                : 'Add a city, areas and search terms'}
            </div>
            {hist.results > 0 && <p className="hint saved">{hist.results.toLocaleString()} businesses already saved for {debCity}. They are listed on the right.</p>}
            <button type="button" className="primary wide" disabled={running || starting} onClick={start}>{running ? 'Searching...' : starting ? 'Starting...' : 'Start search'}</button>
            <button type="button" className="ghost wide" disabled={running} onClick={reset}>Reset</button>
          </aside>

          {/* ---------------- right side ---------------- */}
          <section className="main">
            <div className="stats">
              <div className="stat s-blue"><span className="ico"><ClinicIcon /></span><div><b>{scoped.length.toLocaleString()}</b><span>Businesses found</span></div></div>
              <div className="stat s-green"><span className="ico"><PinIcon /></span><div><b>{covered}{info ? <small> / {areas.length || covered}</small> : null}</b><span>Areas covered</span></div></div>
              <div className="stat s-purple"><span className="ico"><StarIcon /></span><div><b>{avg}{avg !== '\u2013' ? '\u2605' : ''}</b><span>Avg rating</span></div></div>
              <div className="stat s-teal"><span className="ico"><ClockIcon /></span><div><b>{timeValue}</b><span>{timeLabel}</span></div></div>
            </div>

            {error && <div className="alert" role="alert">{error}</div>}

            {info && info.tasks_total > 0 && (
              <div className="progress">
                <div className="p-top">
                  <div>
                    <h3>{running ? (info.status === 'Queued' ? 'Waiting to start...' : 'Search in progress...') : info.status === 'Done' ? 'Search complete' : info.status === 'Stopped' ? 'Search stopped' : 'Search failed'}</h3>
                    <p>{running ? (info.current_area ? 'Fetching businesses from ' + info.current_area + ', ' + info.city : 'The server picks this up within a minute') : info.results_count.toLocaleString() + ' new businesses (' + all.length.toLocaleString() + ' saved for ' + info.city + ', ' + withPhone.toLocaleString() + ' with a phone number)'}</p>
                  </div>
                  {running && <button type="button" className="ghost" onClick={stop}>Stop</button>}
                </div>
                <div className="bar"><i style={{ width: pct + '%' }} /><span>{pct}%</span></div>
                <p className="meta">{info.requests_used} Google requests used{info.failed_tasks ? ', ' + info.failed_tasks + ' searches failed (skipped)' : ''}{running ? '. Safe to close this page, it keeps running.' : ''}</p>
              </div>
            )}

            <div className="results">
              <div className="r-top">
                <h2>Results <small>{view.length.toLocaleString()}</small></h2>
                {info && (
                  <div className="seg" role="group" aria-label="Which results to show">
                    <button type="button" className={scope === 'run' ? 'on' : ''} onClick={() => { setScope('run'); setPage(1) }}>This search ({rows.length.toLocaleString()})</button>
                    <button type="button" className={scope === 'city' ? 'on' : ''} onClick={() => { setScope('city'); setPage(1) }}>All saved for {city.trim() || info.city} ({all.length.toLocaleString()})</button>
                  </div>
                )}
                {runs.length > 0 && (
                  <select className="prev" aria-label="Open a previous search" value={runName} onChange={(e) => openRun(e.target.value)}>
                    {!runs.some((r) => r.name === runName) && <option value="">Previous searches</option>}
                    {runs.map((r) => <option key={r.name} value={r.name}>{r.city + ' \u00b7 ' + r.results_count + ' businesses \u00b7 ' + r.created + (ACTIVE.includes(r.status) ? ' (running)' : '')}</option>)}
                  </select>
                )}
                {termList.length > 1 && (
                  <select className="prev" aria-label="Show one search term" value={activeTerm} onChange={(e) => { setTermFilter(e.target.value); setPage(1) }}>
                    <option value="">All terms</option>
                    {termList.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                <input className="field search" placeholder="Filter by name, area, phone" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1) }} />
                <button type="button" className="outline" disabled={!scoped.length} onClick={() => downloadCsv(view, city)}>Download CSV</button>
              </div>
              {scoped.length === 0 ? (
                <p className="empty">{runName && running ? 'Results appear here as businesses are found.' : 'No results yet. Enter a city, press Find areas, then Start search.'}</p>
              ) : (
                <>
                  <div className="tbl">
                    <table>
                      <thead><tr>
                        <th><button type="button" onClick={() => sortBy('name')}>Name{arrow('name')}</button></th>
                        <th><button type="button" onClick={() => sortBy('term')}>Found by{arrow('term')}</button></th>
                        <th>Phone</th>
                        <th><button type="button" onClick={() => sortBy('rating')}>Rating{arrow('rating')}</button></th>
                        <th><button type="button" onClick={() => sortBy('reviews')}>Reviews{arrow('reviews')}</button></th>
                        <th>Address</th><th className="c">Maps</th>
                      </tr></thead>
                      <tbody>{slice.map((r) => {
                        const pt = phoneType(r.intl)
                        return (
                          <tr key={r.place_id}>
                            <td><span className="av"><ToothIcon size={18} /></span><span className="nm">{r.name}</span></td>
                            <td>{r.term ? <span className="trm">{r.term}</span> : <span className="none">{'\u2013'}</span>}</td>
                            <td>{r.phone ? <><a className="tel" href={'tel:' + r.intl.replace(/[^\d+]/g, '')}>{r.intl || r.phone}</a>{pt && <em className={'tag ' + pt.toLowerCase()}>{pt}</em>}</> : <span className="none">{'\u2013'}</span>}</td>
                            <td>{r.rating ? <>{r.rating} <span className="star">{'\u2605'}</span></> : <span className="none">{'\u2013'}</span>}</td>
                            <td>{r.reviews == null ? <span className="none">{'\u2013'}</span> : r.reviews.toLocaleString()}</td>
                            <td className="addr" title={r.address}>{r.address}</td>
                            <td className="c">{r.maps_url && <a className="ext" href={r.maps_url} target="_blank" rel="noreferrer" aria-label={'Open ' + r.name + ' on Google Maps'}><LinkIcon /></a>}</td>
                          </tr>
                        )
                      })}</tbody>
                    </table>
                  </div>
                  <div className="pager">
                    <button type="button" disabled={cur === 1} onClick={() => setPage(cur - 1)} aria-label="Previous page">{'\u2039'}</button>
                    {pageList(cur, pageCount).map((p) => (typeof p === 'string'
                      ? <span key={p} className="gap">{'\u2026'}</span>
                      : <button type="button" key={p} className={p === cur ? 'on' : ''} onClick={() => setPage(p)}>{p}</button>))}
                    <button type="button" disabled={cur === pageCount} onClick={() => setPage(cur + 1)} aria-label="Next page">{'\u203a'}</button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <footer className="about">
          <b>About this tool</b> Finds businesses with Google Places API (New) and lets you download them as a CSV for calling. Searches run on your Frappe server, so the Google key stays private. Check numbers against the DND registry before promotional calls. Google limits how long Places data may be stored, so treat the results as a working list.
        </footer>
      </div>
    </div>
  )
}
