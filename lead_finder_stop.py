# Lead Finder: stop a run. A running search stops within a few seconds.
# Server Script, type API, method name: lead_finder_stop, Allow Guest: OFF
# Params: run

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

run_name = str(frappe.form_dict.get('run') or '').strip()
status = frappe.db.get_value('Lead Finder Run', run_name, 'status')
if not status:
    frappe.throw('Search not found.')

if status == 'Queued':
    frappe.db.set_value('Lead Finder Run', run_name, {'status': 'Stopped', 'ended_at': frappe.utils.now_datetime()})
elif status == 'Running':
    frappe.db.set_value('Lead Finder Run', run_name, {'stop_requested': 1})
frappe.db.commit()

frappe.response['message'] = {'run': run_name}
