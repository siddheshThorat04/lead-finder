# Lead Finder: neighbourhood names for a city, to pre-fill the areas box.
# Server Script, type API, method name: lead_finder_suggest_areas, Allow Guest: OFF
# Params: city          Returns: ["Koramangala", "Indiranagar", ...]

ALLOWED_ROLES = ['Lead Finder', 'System Manager']
PLACES_URL = 'https://places.googleapis.com/v1/places:searchText'
GOOD_TYPES = ['sublocality', 'sublocality_level_1', 'sublocality_level_2', 'neighborhood']

def can_use(user):
    if user == 'Administrator':
        return True
    for role in ALLOWED_ROLES:
        if frappe.db.exists('Has Role', {'parent': user, 'role': role}):
            return True
    return False

if not can_use(frappe.session.user):
    frappe.throw('You do not have access to the Lead Finder.')

city = str(frappe.form_dict.get('city') or '').strip()
if len(city) < 2 or len(city) > 80:
    frappe.throw('Enter a city first.')

settings = frappe.get_doc('Audit Settings')
places_key = settings.get_password('google_places_api_key', raise_exception=False)
if not places_key:
    frappe.throw('The Google Places API key is not set in Audit Settings.')

headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': places_key,
    'X-Goog-FieldMask': 'nextPageToken,places.displayName,places.types'
}

names = []
queries = ['neighbourhoods in ' + city, 'localities in ' + city]
for q in queries:
    body = {'textQuery': q, 'pageSize': 20}
    page = 0
    while page < 3:
        page = page + 1
        try:
            res = frappe.make_post_request(PLACES_URL, headers=headers, data=json.dumps(body))
        except Exception as e:
            frappe.log_error(title='lead_finder_suggest_areas failed', message=str(e))
            break
        for p in (res.get('places') or []):
            wanted = False
            for t in (p.get('types') or []):
                if t in GOOD_TYPES:
                    wanted = True
            text = (p.get('displayName') or {}).get('text') or ''
            if wanted and text and text not in names:
                names.append(text)
        token = res.get('nextPageToken')
        if not token:
            break
        body['pageToken'] = token

frappe.response['message'] = names
