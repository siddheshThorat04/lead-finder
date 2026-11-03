# Lead Finder worker.
# Server Script, type Scheduler Event, Event Frequency: Cron, Cron Format: * * * * *
# Every minute it takes the oldest Queued/Running run and works through its searches for about
# 40 seconds, saving the clinics it finds. The next minute it carries on where it stopped.
# Closing the browser does not stop a run.
# Searches already completed for the same city (area + term, at least as many pages) are skipped,
# and a clinic already saved for the city is never saved twice. options.force = search again anyway.

BOX_SECONDS = 40
PLACES_URL = 'https://places.googleapis.com/v1/places:searchText'
FIELD_MASK = 'nextPageToken,places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.googleMapsUri'

def norm(text):
    return ' '.join(str(text or '').lower().split())

def http_status(e):
    try:
        return int(e.response.status_code)
    except Exception:
        return 0

def error_text(e):
    text = str(e)
    try:
        text = text + ' ' + str(e.response.text)[:300]
    except Exception:
        pass
    return text[:500]

def set_run(name, values):
    frappe.db.set_value('Lead Finder Run', name, values)
    frappe.db.commit()

def fetch_places(query, pages, region, headers):
    # One search: up to `pages` pages of 20. A failure on page 1 is raised; a failure on a later
    # page stops the search and marks it incomplete (so it is not recorded as done).
    places = []
    used = 0
    complete = True
    body = {'textQuery': query, 'pageSize': 20}
    if region:
        body['regionCode'] = region
    page = 0
    while page < pages:
        page = page + 1
        try:
            res = frappe.make_post_request(PLACES_URL, headers=headers, data=json.dumps(body))
        except Exception as e:
            if page == 1:
                raise
            complete = False
            break
        used = used + 1
        for p in (res.get('places') or []):
            places.append(p)
        token = res.get('nextPageToken')
        if not token:
            break
        body['pageToken'] = token
    return {'places': places, 'used': used, 'complete': complete}

def record_search(ck, city, area, term, pages, run_name, count):
    # Remember that this city + area + term has been searched, so no later run pays for it again.
    akey = norm(area)
    tkey = norm(term)
    uid = ck[:40] + '|' + akey[:50] + '|' + tkey[:40]
    values = {'pages': pages, 'run': run_name, 'results_found': count, 'done_at': frappe.utils.now_datetime()}
    if frappe.db.exists('Lead Finder Search', uid):
        frappe.db.set_value('Lead Finder Search', uid, values)
    else:
        doc = {'doctype': 'Lead Finder Search', 'uid': uid, 'city_key': ck, 'area_key': akey,
               'term_key': tkey, 'city': city, 'area': area, 'term': term}
        for k in values:
            doc[k] = values[k]
        frappe.get_doc(doc).insert(ignore_permissions=True)
    frappe.db.commit()

queue = frappe.get_all(
    'Lead Finder Run',
    filters={'status': ['in', ['Queued', 'Running']]},
    fields=['name'], order_by='creation asc', limit_page_length=1
)

if queue:
    run_name = queue[0].name
    run = frappe.db.get_value(
        'Lead Finder Run', run_name,
        ['city', 'areas', 'terms', 'options', 'status', 'tasks_done', 'results_count', 'requests_used', 'failed_tasks'],
        as_dict=True
    )
    tick_start = frappe.utils.now_datetime()

    settings = frappe.get_doc('Audit Settings')
    places_key = settings.get_password('google_places_api_key', raise_exception=False)
    areas = []
    terms = []
    opts = {}
    try:
        areas = json.loads(run.areas)
        terms = json.loads(run.terms)
        opts = json.loads(run.options)
    except Exception:
        pass

    if (not places_key) or (not areas) or (not terms):
        why = 'The Google Places API key is not set in Audit Settings.'
        if places_key:
            why = 'This search has no areas or search terms.'
        set_run(run_name, {'status': 'Error', 'last_error': why, 'ended_at': tick_start})
    else:
        if run.status == 'Queued':
            set_run(run_name, {'status': 'Running', 'started_at': tick_start})

        headers = {'Content-Type': 'application/json', 'X-Goog-Api-Key': places_key, 'X-Goog-FieldMask': FIELD_MASK}
        pages = int(opts.get('pages') or 3)
        region = str(opts.get('region') or '')
        only_phone = bool(opts.get('only_phone'))
        min_rating = float(opts.get('min_rating') or 0)
        force = bool(opts.get('force'))
        words = []
        for w in (opts.get('match') or []):
            words.append(str(w).lower())

        ck = norm(run.city)

        # searches already finished for this city in earlier runs: 'area|term' -> pages searched
        done_map = {}
        for s in frappe.get_all('Lead Finder Search', filters={'city_key': ck},
                                fields=['area_key', 'term_key', 'pages'], limit_page_length=100000):
            done_map[s.area_key + '|' + s.term_key] = int(s.pages or 0)

        # clinics already saved for this city by any run (so a clinic is never saved twice)
        run_names = []
        for r in frappe.get_all('Lead Finder Run', fields=['name', 'city'], limit_page_length=1000):
            if norm(r.city) == ck:
                run_names.append(r.name)
        if run_name not in run_names:
            run_names.append(run_name)
        existing = {}
        for r in frappe.get_all('Lead Finder Result', filters={'run': ['in', run_names]}, fields=['place_id'], limit_page_length=100000):
            existing[r.place_id] = 1

        n_terms = len(terms)
        total = len(areas) * n_terms
        done = int(run.tasks_done or 0)
        requests = int(run.requests_used or 0)
        failed = int(run.failed_tasks or 0)
        found = int(run.results_count or 0)
        state = ''
        last_error = ''

        while done < total and not state:
            if (frappe.utils.now_datetime() - tick_start).total_seconds() > BOX_SECONDS:
                break
            if frappe.db.get_value('Lead Finder Run', run_name, 'stop_requested'):
                state = 'Stopped'
                break

            area = areas[done // n_terms]
            term = terms[done % n_terms]
            dkey = norm(area) + '|' + norm(term)

            if (not force) and done_map.get(dkey, 0) >= pages:
                # already searched for this city: no Google request, just move on
                done = done + 1
                set_run(run_name, {'tasks_done': done, 'current_area': area})
                continue

            query = term + ' in ' + area + ', ' + run.city
            try:
                result = fetch_places(query, pages, region, headers)
                requests = requests + result['used']
                for p in result['places']:
                    pid = p.get('id') or ''
                    status = p.get('businessStatus') or ''
                    if (not pid) or existing.get(pid):
                        continue
                    if status and status != 'OPERATIONAL':
                        continue
                    phone = p.get('nationalPhoneNumber') or ''
                    if only_phone and not phone:
                        continue
                    rating = p.get('rating') or 0
                    if min_rating and rating < min_rating:
                        continue
                    address = p.get('formattedAddress') or ''
                    if words:
                        hit = False
                        for w in words:
                            if w in address.lower():
                                hit = True
                        if not hit:
                            continue
                    found = found + 1
                    existing[pid] = 1
                    frappe.get_doc({
                        'doctype': 'Lead Finder Result',
                        'uid': run_name + '-' + pid,
                        'run': run_name,
                        'seq': found,
                        'place_id': pid,
                        'clinic_name': (p.get('displayName') or {}).get('text') or '',
                        'phone': phone,
                        'intl_phone': p.get('internationalPhoneNumber') or '',
                        'website': p.get('websiteUri') or '',
                        'address': address,
                        'area': area,
                        'rating': rating,
                        'reviews': p.get('userRatingCount') or 0,
                        'business_status': status,
                        'maps_url': p.get('googleMapsUri') or ''
                    }).insert(ignore_permissions=True)
                if result['complete']:
                    keep = pages
                    if done_map.get(dkey, 0) > keep:
                        keep = done_map.get(dkey, 0)
                    record_search(ck, run.city, area, term, keep, run_name, len(result['places']))
                    done_map[dkey] = keep
            except Exception as e:
                failed = failed + 1
                last_error = error_text(e)
                frappe.log_error(title='lead_finder_worker: search failed', message=query + chr(10) + last_error)
                if http_status(e) in [401, 403]:
                    state = 'Error'
                elif failed >= 5 and found == 0:
                    state = 'Error'

            done = done + 1
            set_run(run_name, {
                'tasks_done': done, 'requests_used': requests, 'failed_tasks': failed,
                'results_count': found, 'current_area': area, 'last_error': last_error
            })

        if done >= total and not state:
            state = 'Done'
        if state:
            set_run(run_name, {'status': state, 'ended_at': frappe.utils.now_datetime(), 'stop_requested': 0})
