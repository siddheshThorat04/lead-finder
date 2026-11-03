# Lead Finder: which searches were already done for a city, and how many clinics are saved for it.
# Server Script, type API, method name: lead_finder_history, Allow Guest: OFF
# Params: city
# Returns: {searches: [[area_key, term_key, pages], ...], results: <clinics saved>}

ALLOWED_ROLES = ['Lead Finder', 'System Manager']

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
searches = []
results = 0

if len(ck) >= 2:
    for s in frappe.get_all('Lead Finder Search', filters={'city_key': ck},
                            fields=['area_key', 'term_key', 'pages'], limit_page_length=100000):
        searches.append([s.area_key, s.term_key, int(s.pages or 0)])
    run_names = []
    for r in frappe.get_all('Lead Finder Run', fields=['name', 'city'], limit_page_length=1000):
        if norm(r.city) == ck:
            run_names.append(r.name)
    if run_names:
        results = frappe.db.count('Lead Finder Result', {'run': ['in', run_names]})

frappe.response['message'] = {'searches': searches, 'results': results}
