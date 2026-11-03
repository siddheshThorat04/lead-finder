# Lead Finder: the most recent searches, so a finished search can be opened again.
# Server Script, type API, method name: lead_finder_runs, Allow Guest: OFF
# Returns: [{name, city, status, results_count, tasks_total, tasks_done, created}]

ALLOWED_ROLES = ['Lead Finder', 'System Manager']

def can_use(user):
    if user == 'Administrator':
        return True
    for role in ALLOWED_ROLES:
        if frappe.db.exists('Has Role', {'parent': user, 'role': role}):
            return True
    return False

if not can_use(frappe.session.user):
    frappe.throw('You do not have access to the Lead Finder.')

found = frappe.get_all(
    'Lead Finder Run',
    fields=['name', 'city', 'status', 'results_count', 'tasks_total', 'tasks_done', 'creation'],
    order_by='creation desc',
    limit_page_length=15
)
out = []
for r in found:
    out.append({
        'name': r.name, 'city': r.city, 'status': r.status, 'results_count': r.results_count or 0,
        'tasks_total': r.tasks_total or 0, 'tasks_done': r.tasks_done or 0, 'created': str(r.creation)[:16]
    })
frappe.response['message'] = out
