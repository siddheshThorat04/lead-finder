# Lead Finder: clinics already saved for a city (from every earlier search), a page at a time.
# Server Script, type API, method name: lead_finder_stored, Allow Guest: OFF
# Params: city, start (offset, default 0)
# Returns: {rows: [...], next, has_more, total}

ALLOWED_ROLES = ['Lead Finder', 'System Manager']
PAGE_SIZE = 500

def norm(text):
    return ' '.join(str(text or '').lower().split())

def can_use(user):
    if user == 'Administrator':
        return True
    for role in ALLOWED_ROLES:
        if frappe.db.exists('Has Role', {'parent': user, 'role': role}):
            return True
    return False

if not can_use(frappe.session.user):
    frappe.throw('You do not have access to the Lead Finder.')

ck = norm(frappe.form_dict.get('city'))
start = 0
try:
    start = int(frappe.form_dict.get('start') or 0)
except Exception:
    start = 0
if start < 0:
    start = 0

rows = []
has_more = False
total = 0

run_names = []
if len(ck) >= 2:
    for r in frappe.get_all('Lead Finder Run', fields=['name', 'city'], limit_page_length=1000):
        if norm(r.city) == ck:
            run_names.append(r.name)

if run_names:
    total = frappe.db.count('Lead Finder Result', {'run': ['in', run_names]})
    found = frappe.get_all(
        'Lead Finder Result',
        filters={'run': ['in', run_names]},
        fields=['seq', 'place_id', 'clinic_name', 'phone', 'intl_phone', 'website', 'address', 'area',
                'rating', 'reviews', 'business_status', 'maps_url'],
        order_by='creation asc, name asc',
        limit_start=start,
        limit_page_length=PAGE_SIZE + 1
    )
    has_more = len(found) > PAGE_SIZE
    for r in found:
        if len(rows) >= PAGE_SIZE:
            break
        rows.append({
            'seq': r.seq, 'place_id': r.place_id, 'name': r.clinic_name, 'phone': r.phone or '',
            'intl': r.intl_phone or '', 'website': r.website or '', 'address': r.address or '',
            'area': r.area or '', 'rating': r.rating or None, 'reviews': r.reviews or None,
            'status': r.business_status or '', 'maps_url': r.maps_url or ''
        })

frappe.response['message'] = {'rows': rows, 'next': start + len(rows), 'has_more': has_more, 'total': total}
