'use strict';
const { run, nowIso } = require('./db');

/**
 * Record an audit event. Never put wish content or assignment pairs in `details`.
 * @param {object} actor { type: 'admin'|'employee'|'system', id?, label? }
 */
function audit(actor, action, details = null, ip = null) {
  try {
    run(
      'INSERT INTO audit_logs (actor_type, actor_id, actor_label, action, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      actor.type, actor.id ?? null, actor.label ?? null, action,
      details ? JSON.stringify(details) : null, ip, nowIso(),
    );
  } catch (err) {
    console.error('[audit] failed to write log', err);
  }
}

const adminActor = (admin) => ({ type: 'admin', id: admin.id, label: `${admin.name} <${admin.email}>` });
const employeeActor = (emp) => ({ type: 'employee', id: emp.id, label: `${emp.full_name} (${emp.employee_code})` });
const SYSTEM = { type: 'system', label: 'System' };

module.exports = { audit, adminActor, employeeActor, SYSTEM };
