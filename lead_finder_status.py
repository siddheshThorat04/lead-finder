# Lead Finder: progress of a run plus any result rows newer than `after`.
# Server Script, type API, method name: lead_finder_status, Allow Guest: OFF
# Params: run, after (last row number the app already has, default 0)
# Returns: {run:{...}, rows:[...], after, has_more}

ALLOWED_ROLES = ['Lead Finder', 'System Manager']
PAGE_SIZE = 500

def can_use(user):
    if user == 'Administrator':
        return True
    for role in ALLOWED_ROLES:
        if frappe.db.exists('Has Role', {'parent': user, 'role': role}):
            return True
    return False

if not can_use(frappe.session.user):
    frappe.throw('You do not have access to the Lead Finder.')

run_name = str(frappe.form_dict.get('run') or '').strip()
after = 0
try:
    after = int(frappe.form_dict.get('after') or 0)
except Exception:
    after = 0

run = frappe.db.get_value(
    'Lead Finder Run', run_name,
    ['name', 'city', 'status', 'terms', 'tasks_total', 'tasks_done', 'results_count', 'requests_used',
     'failed_tasks', 'current_area', 'last_error', 'started_at', 'ended_at', 'creation'],
    as_dict=True
)
if not run:
    frappe.throw('Search not found.')

n_terms = 1
try:
    n_terms = len(json.loads(run.terms))
except Exception:
    n_terms = 1
if n_terms < 1:
    n_terms = 1

elapsed = 0
try:
    begin = run.started_at or run.creation
    finish = run.ended_at or frappe.utils.now_datetime()
    elapsed = int((finish - begin).total_seconds())
except Exception:
    elapsed = 0

found = frappe.get_all(
    'Lead Finder Result',
    filters={'run': run_name, 'seq': ['>', after]},
    fields=['seq', 'place_id', 'clinic_name', 'phone', 'intl_phone', 'website', 'address', 'area',
            'rating', 'reviews', 'business_status', 'maps_url'],
    order_by='seq asc',
    limit_page_length=PAGE_SIZE + 1
)
has_more = len(found) > PAGE_SIZE
rows = []
last_seq = after
for r in found:
    if len(rows) >= PAGE_SIZE:
        break
    rows.append({
        'seq': r.seq, 'place_id': r.place_id, 'name': r.clinic_name, 'phone': r.phone or '',
        'intl': r.intl_phone or '', 'website': r.website or '', 'address': r.address or '',
        'area': r.area or '', 'rating': r.rating or None, 'reviews': r.reviews or None,
        'status': r.business_status or '', 'maps_url': r.maps_url or ''
    })
    last_seq = r.seq

frappe.response['message'] = {
    'run': {
        'name': run.name, 'city': run.city, 'status': run.status,
        'tasks_total': run.tasks_total or 0, 'tasks_done': run.tasks_done or 0,
        'areas_covered': int((run.tasks_done or 0) // n_terms),
        'results_count': run.results_count or 0, 'requests_used': run.requests_used or 0,
        'failed_tasks': run.failed_tasks or 0, 'current_area': run.current_area or '',
        'last_error': run.last_error or '', 'elapsed': elapsed
    },
    'rows': rows,
    'after': last_seq,
    'has_more': has_more
}
