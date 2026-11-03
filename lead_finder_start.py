# Lead Finder: create a search run. The worker (lead_finder_worker) does the actual searching.
# Server Script, type API, method name: lead_finder_start, Allow Guest: OFF
# Params: city, areas (list), terms (list),
#         options {pages 1-3, only_phone, min_rating, match (list of words), region (2 letters)}
# Returns: {run, tasks, skipped, max_requests}. run is '' when everything was already searched.
# options.force = search again even if already done for this city.

ALLOWED_ROLES = ['Lead Finder', 'System Manager']
MAX_AREAS = 300
MAX_TERMS = 10

def can_use(user):
    if user == 'Administrator':
        return True
    for role in ALLOWED_ROLES:
        if frappe.db.exists('Has Role', {'parent': user, 'role': role}):
            return True
    return False

def norm(text):
    return ' '.join(str(text or '').lower().split())

def clean_list(raw, max_items, max_len):
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = [raw]
    out = []
    for item in (raw or []):
        text = str(item or '').strip().replace(chr(10), ' ')
        if len(text) >= 2 and len(text) <= max_len:
            seen = False
            for o in out:
                if o.lower() == text.lower():
                    seen = True
            if not seen:
                out.append(text)
        if len(out) >= max_items:
            break
    return out

if not can_use(frappe.session.user):
    frappe.throw('You do not have access to the Lead Finder.')

data = frappe.form_dict
city = str(data.get('city') or '').strip()
if len(city) < 2 or len(city) > 80:
    frappe.throw('Enter a city first.')

areas = clean_list(data.get('areas'), MAX_AREAS, 80)
terms = clean_list(data.get('terms'), MAX_TERMS, 60)
if not areas:
    frappe.throw('Add at least one area.')
if not terms:
    frappe.throw('Add at least one search term.')

opts_in = data.get('options')
if isinstance(opts_in, str):
    try:
        opts_in = json.loads(opts_in)
    except Exception:
        opts_in = {}
pages = 3
min_rating = 0.0
only_phone = False
force = False
region = ''
match = []
try:
    pages = int(opts_in.get('pages') or 3)
except Exception:
    pages = 3
if pages < 1:
    pages = 1
if pages > 3:
    pages = 3
try:
    min_rating = float(opts_in.get('min_rating') or 0)
except Exception:
    min_rating = 0.0
try:
    only_phone = str(opts_in.get('only_phone')).lower() in ['1', 'true']
    force = str(opts_in.get('force')).lower() in ['1', 'true']
    region = str(opts_in.get('region') or '').strip().upper()[:2]
    match = clean_list(opts_in.get('match'), 10, 60)
except Exception:
    pass

# how many of these searches were already done for this city (same area + term, at least as many pages)
total = len(areas) * len(terms)
skipped = 0
if not force:
    done_map = {}
    for row in frappe.get_all('Lead Finder Search', filters={'city_key': norm(city)},
                              fields=['area_key', 'term_key', 'pages'], limit_page_length=100000):
        done_map[row.area_key + '|' + row.term_key] = int(row.pages or 0)
    for a in areas:
        for t in terms:
            if done_map.get(norm(a) + '|' + norm(t), 0) >= pages:
                skipped = skipped + 1

if skipped >= total:
    # everything was searched before: no run, no Google requests
    frappe.response['message'] = {'run': '', 'tasks': 0, 'skipped': skipped, 'max_requests': 0}
else:
    busy = frappe.db.exists('Lead Finder Run', {'status': ['in', ['Queued', 'Running']]})
    if busy:
        frappe.throw('Another search is still running. Wait for it to finish or stop it first.')

    options = {'pages': pages, 'only_phone': only_phone, 'min_rating': min_rating, 'region': region,
               'match': match, 'force': force}

    run = frappe.get_doc({
        'doctype': 'Lead Finder Run',
        'city': city,
        'status': 'Queued',
        'areas': json.dumps(areas),
        'terms': json.dumps(terms),
        'options': json.dumps(options),
        'tasks_total': total,
        'tasks_done': 0,
        'results_count': 0,
        'requests_used': 0,
        'failed_tasks': 0
    })
    run.insert(ignore_permissions=True)
    frappe.db.commit()

    frappe.response['message'] = {'run': run.name, 'tasks': total, 'skipped': skipped,
                                  'max_requests': (total - skipped) * pages}
