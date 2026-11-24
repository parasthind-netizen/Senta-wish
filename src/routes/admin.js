'use strict';
// HR admin API. Admins manage people, settings and the draw – but never see wishes or
// assignments unless a super admin opens a time-limited, logged emergency override.
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { get, all, run, tx, nowIso, PHOTO_DIR, PUBLIC_UPLOAD_DIR } = require('../db');
const { hashPassword, verifyPassword, passwordProblem } = require('../security');
const auth = require('../auth');
const settings = require('../settings');
const privacy = require('../privacy');
const mailer = require('../mailer');
const { audit, adminActor } = require('../audit');
const {
  limiter, httpError, clean, isEmail, imageUpload, brandingUpload, audioUpload, sheetUpload, saveImage, saveAudio, removeFile,
} = require('../util');

const router = express.Router();
const OVERRIDE_MINUTES = 15;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

const adminView = (a) => ({
  id: a.id, name: a.name, email: a.email, role: a.role, active: Boolean(a.active),
  mustChangePassword: Boolean(a.must_change_password), lastLoginAt: a.last_login_at, createdAt: a.created_at,
});
const log = (req, action, details) => audit(adminActor(req.admin), action, details, req.ip);
const photoUrl = (file) => (file ? `/media/photos/${file}` : null);
const publicUrl = (file) => (file ? `/uploads/${file}` : null);

/* ------------------------------------------------------------------ auth */

router.post('/login', limiter('admin-login', 20, 15 * 60 * 1000), async (req, res) => {
  const email = clean(req.body.email, 254);
  const admin = get('SELECT * FROM admins WHERE email = ?', email);
  if (admin && admin.locked_until && admin.locked_until > nowIso()) throw httpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const ok = admin && admin.active && (await verifyPassword(String(req.body.password || ''), admin.password_hash));
  if (!ok) {
    if (admin) {
      const failed = admin.failed_attempts + 1;
      run('UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?',
        failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS).toISOString() : null, admin.id);
    }
    audit({ type: 'admin', label: email }, 'admin.login_failed', null, req.ip);
    throw httpError(401, 'Incorrect email or password.');
  }
  run('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), admin.id);
  const { csrf } = auth.createSession(req, res, 'admin', admin.id);
  audit(adminActor(admin), 'admin.login', null, req.ip);
  res.json({ admin: adminView(admin), csrf });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req, res, 'admin');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.admin) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ admin: adminView(req.admin), csrf: req.adminSession.csrf });
});

// Everything below requires an admin session + CSRF token
router.use(auth.requireAdmin);

router.post('/password', async (req, res) => {
  if (!(await verifyPassword(String(req.body.current || ''), req.admin.password_hash))) throw httpError(400, 'Current password is incorrect.');
  const problem = passwordProblem(req.body.next);
  if (problem) throw httpError(400, problem);
  run('UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?', await hashPassword(req.body.next), req.admin.id);
  log(req, 'admin.password_changed');
  res.json({ ok: true });
});

/* -------------------------------------------------------------- overview */

function employeeRows() {
  const draw = privacy.activeDraw();
  return all(`
    SELECT e.*, (a.employee_id IS NOT NULL) AS has_account, a.last_login_at,
           r.registered_at, COALESCE(w.wish_count, 0) AS wish_count, w.updated_at AS wishes_updated_at,
           (s.id IS NOT NULL) AS in_draw, s.revealed_at
    FROM employees e
    LEFT JOIN employee_auth a ON a.employee_id = e.id
    LEFT JOIN registrations r ON r.employee_id = e.id
    LEFT JOIN wishlists w ON w.employee_id = e.id
    LEFT JOIN assignments s ON s.giver_id = e.id AND s.draw_id = ?
    ORDER BY e.full_name COLLATE NOCASE`, draw ? draw.id : -1);
}

function toEmployeeJson(e) {
  return {
    id: e.id, employeeCode: e.employee_code, fullName: e.full_name, email: e.email, department: e.department,
    designation: e.designation, location: e.location, photo: photoUrl(e.photo), active: Boolean(e.active),
    hasAccount: Boolean(e.has_account), lastLoginAt: e.last_login_at || null, registered: Boolean(e.registered_at),
    registeredAt: e.registered_at || null, wishCount: e.wish_count, wishesUpdatedAt: e.wishes_updated_at || null,
    inDraw: Boolean(e.in_draw), unwrapped: Boolean(e.revealed_at), createdAt: e.created_at,
  };
}

router.get('/overview', (req, res) => {
  const rows = employeeRows().filter((e) => e.active);
  const slots = privacy.WISH_SLOTS;
  const depts = {};
  for (const e of rows) {
    const d = e.department || 'Unassigned';
    depts[d] = depts[d] || { department: d, total: 0, registered: 0 };
    depts[d].total += 1;
    if (e.registered_at) depts[d].registered += 1;
  }
  const s = settings.loadAll();
  const override = privacy.anyActiveOverride();
  res.json({
    counts: {
      employees: rows.length,
      accounts: rows.filter((e) => e.has_account).length,
      registered: rows.filter((e) => e.registered_at).length,
      notRegistered: rows.filter((e) => !e.registered_at).length,
      wishesComplete: rows.filter((e) => e.registered_at && e.wish_count >= slots).length,
      wishesMissing: rows.filter((e) => e.registered_at && e.wish_count < slots).length,
      inactive: get('SELECT COUNT(*) AS c FROM employees WHERE active = 0').c,
    },
    departments: Object.values(depts).sort((a, b) => b.total - a.total),
    draw: privacy.drawSummary(),
    preview: privacy.drawPreview(),
    registrationOpen: Boolean(s.registration_open),
    dates: { registrationDeadline: s.registration_deadline, drawDate: s.draw_date, exchangeDate: s.exchange_date, christmasDate: s.christmas_date },
    budget: settings.formatBudget(s),
    emailConfigured: mailer.smtpConfigured(s),
    override: override ? { adminName: override.admin_name, expiresAt: override.expires_at, reason: override.reason } : null,
    recentActivity: all('SELECT actor_label, action, created_at FROM audit_logs ORDER BY id DESC LIMIT 8'),
  });
});

/* ------------------------------------------------------------- employees */

function employeeInput(body, { partial = false } = {}) {
  const out = {};
  const fields = {
    employeeCode: ['employee_code', 60], fullName: ['full_name', 120], email: ['email', 254],
    department: ['department', 120], designation: ['designation', 120], location: ['location', 120],
  };
  for (const [k, [col, max]] of Object.entries(fields)) {
    if (body[k] !== undefined) out[col] = clean(body[k], max);
  }
  if (body.active !== undefined) out.active = body.active === true || body.active === 'true' || body.active === 1 ? 1 : 0;
  if (!partial || out.employee_code !== undefined) if (!out.employee_code) throw httpError(400, 'Employee ID is required.');
  if (!partial || out.full_name !== undefined) if (!out.full_name) throw httpError(400, 'Full name is required.');
  if (!partial || out.email !== undefined) if (!isEmail(out.email)) throw httpError(400, 'A valid email is required.');
  if (out.email) out.email = out.email.toLowerCase();
  return out;
}

function uniqueError(err) {
  const m = String(err.message);
  if (m.includes('employees.email')) return httpError(409, 'Another employee already uses this email.');
  if (m.includes('employees.employee_code')) return httpError(409, 'Another employee already uses this Employee ID.');
  return err;
}

router.get('/employees', (req, res) => {
  res.json({ employees: employeeRows().map(toEmployeeJson), wishSlots: privacy.WISH_SLOTS });
});

router.post('/employees', (req, res) => {
  const v = employeeInput(req.body);
  try {
    const now = nowIso();
    const r = run(
      `INSERT INTO employees (employee_code, full_name, email, department, designation, location, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      v.employee_code, v.full_name, v.email, v.department || '', v.designation || '', v.location || '', v.active ?? 1, now, now,
    );
    log(req, 'employee.created', { id: Number(r.lastInsertRowid), code: v.employee_code });
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (err) { throw uniqueError(err); }
});

router.put('/employees/:id', (req, res) => {
  const id = Number(req.params.id);
  const emp = get('SELECT * FROM employees WHERE id = ?', id);
  if (!emp) throw httpError(404, 'Employee not found.');
  const v = employeeInput(req.body, { partial: true });
  const cols = Object.keys(v);
  if (!cols.length) return res.json({ ok: true });
  try {
    run(`UPDATE employees SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...cols.map((c) => v[c]), nowIso(), id);
  } catch (err) { throw uniqueError(err); }
  if (v.active === 0) auth.destroyAllSessions('employee', id);
  log(req, 'employee.updated', { id, fields: cols });
  res.json({ ok: true });
});

function deleteEmployee(id) {
  const draw = privacy.activeDraw();
  if (draw && get('SELECT 1 FROM assignments WHERE draw_id = ? AND giver_id = ?', draw.id, id)) {
    throw httpError(409, 'This employee is part of the finalized draw. Deactivate them instead, or reset the draw first.');
  }
  const emp = get('SELECT * FROM employees WHERE id = ?', id);
  if (!emp) throw httpError(404, 'Employee not found.');
  auth.destroyAllSessions('employee', id);
  run('DELETE FROM employees WHERE id = ?', id);
  removeFile(PHOTO_DIR, emp.photo);
  return emp;
}

router.delete('/employees/:id', (req, res) => {
  const emp = deleteEmployee(Number(req.params.id));
  log(req, 'employee.deleted', { id: emp.id, code: emp.employee_code });
  res.json({ ok: true });
});

router.post('/employees/bulk', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger).slice(0, 2000) : [];
  const action = req.body.action;
  if (!ids.length) throw httpError(400, 'Select at least one employee.');
  let done = 0;
  const skipped = [];
  for (const id of ids) {
    try {
      if (action === 'activate' || action === 'deactivate') {
        run('UPDATE employees SET active = ?, updated_at = ? WHERE id = ?', action === 'activate' ? 1 : 0, nowIso(), id);
        if (action === 'deactivate') auth.destroyAllSessions('employee', id);
      } else if (action === 'delete') {
        deleteEmployee(id);
      } else throw httpError(400, 'Unknown bulk action.');
      done += 1;
    } catch (err) {
      if (err.status === 400) throw err;
      skipped.push({ id, reason: err.message });
    }
  }
  log(req, `employee.bulk_${action}`, { count: done });
  res.json({ ok: true, done, skipped });
});

router.post('/employees/:id/photo', imageUpload.single('photo'), (req, res) => {
  const emp = get('SELECT * FROM employees WHERE id = ?', Number(req.params.id));
  if (!emp) throw httpError(404, 'Employee not found.');
  const name = saveImage(req.file, PHOTO_DIR, `emp${emp.id}`);
  removeFile(PHOTO_DIR, emp.photo);
  run('UPDATE employees SET photo = ?, updated_at = ? WHERE id = ?', name, nowIso(), emp.id);
  log(req, 'employee.photo_uploaded', { id: emp.id });
  res.json({ ok: true, photo: photoUrl(name) });
});

router.delete('/employees/:id/photo', (req, res) => {
  const emp = get('SELECT * FROM employees WHERE id = ?', Number(req.params.id));
  if (!emp) throw httpError(404, 'Employee not found.');
  removeFile(PHOTO_DIR, emp.photo);
  run('UPDATE employees SET photo = NULL, updated_at = ? WHERE id = ?', nowIso(), emp.id);
  log(req, 'employee.photo_removed', { id: emp.id });
  res.json({ ok: true });
});

// Bulk photos: file names must be the Employee ID or email, e.g. TS1024.jpg
const bulkPhotos = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 25 } });
router.post('/employees/photos/bulk', bulkPhotos.array('photos', 25), (req, res) => {
  const results = [];
  for (const file of req.files || []) {
    const stem = String(file.originalname || '').replace(/\.[^.]+$/, '').trim();
    const emp = get('SELECT * FROM employees WHERE employee_code = ? OR email = ?', stem, stem);
    if (!emp) { results.push({ file: file.originalname, ok: false, reason: 'No employee with this ID/email' }); continue; }
    try {
      const name = saveImage(file, PHOTO_DIR, `emp${emp.id}`);
      removeFile(PHOTO_DIR, emp.photo);
      run('UPDATE employees SET photo = ?, updated_at = ? WHERE id = ?', name, nowIso(), emp.id);
      results.push({ file: file.originalname, ok: true, employee: emp.full_name });
    } catch (err) {
      results.push({ file: file.originalname, ok: false, reason: err.message });
    }
  }
  log(req, 'employee.photos_bulk', { uploaded: results.filter((r) => r.ok).length });
  res.json({ results });
});

router.post('/employees/:id/reset-login', (req, res) => {
  const id = Number(req.params.id);
  const emp = get('SELECT * FROM employees WHERE id = ?', id);
  if (!emp) throw httpError(404, 'Employee not found.');
  run('DELETE FROM employee_auth WHERE employee_id = ?', id);
  auth.destroyAllSessions('employee', id);
  log(req, 'employee.login_reset', { id, code: emp.employee_code });
  res.json({ ok: true });
});

router.post('/employees/:id/registration', (req, res) => {
  const id = Number(req.params.id);
  const emp = get('SELECT * FROM employees WHERE id = ? AND active = 1', id);
  if (!emp) throw httpError(404, 'Active employee not found.');
  if (privacy.activeDraw()) throw httpError(409, 'The draw is finalized – reset it before changing participants.');
  const r = run('INSERT OR IGNORE INTO registrations (employee_id, agreed_rules, registered_at) VALUES (?, 0, ?)', id, nowIso());
  if (!r.changes) throw httpError(409, 'Already registered.');
  log(req, 'registration.added_by_admin', { id, code: emp.employee_code });
  res.json({ ok: true });
});

router.delete('/employees/:id/registration', (req, res) => {
  const id = Number(req.params.id);
  if (privacy.activeDraw()) throw httpError(409, 'The draw is finalized – reset it before changing participants.');
  run('DELETE FROM registrations WHERE employee_id = ?', id);
  log(req, 'registration.removed_by_admin', { id });
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- import */

const HEADER_ALIASES = {
  employee_code: ['employee id', 'employee code', 'emp id', 'emp code', 'empid', 'employeeid', 'id', 'code', 'staff id'],
  full_name: ['full name', 'name', 'employee name', 'fullname', 'emp name'],
  email: ['email', 'email id', 'official email', 'company email', 'work email', 'e-mail', 'mail'],
  department: ['department', 'dept', 'team', 'division'],
  designation: ['designation', 'title', 'job title', 'role', 'position'],
  location: ['location', 'office', 'city', 'branch'],
  active: ['active', 'status', 'is active'],
};

function mapHeader(h) {
  const key = String(h || '').trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
  for (const [col, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(key)) return col;
  return null;
}

function parseActive(v) {
  if (v === undefined || v === null || v === '') return 1;
  return /^(0|no|false|inactive|n|disabled|left)$/i.test(String(v).trim()) ? 0 : 1;
}

function analyseRows(rawRows) {
  const seenCodes = new Set();
  const seenEmails = new Set();
  return rawRows.slice(0, 5000).map((r, i) => {
    const row = {
      line: r.line || i + 2,
      employee_code: clean(r.employee_code, 60),
      full_name: clean(r.full_name, 120),
      email: clean(r.email, 254).toLowerCase(),
      department: clean(r.department, 120),
      designation: clean(r.designation, 120),
      location: clean(r.location, 120),
      active: parseActive(r.active),
      errors: [],
    };
    if (!row.employee_code) row.errors.push('Missing Employee ID');
    if (!row.full_name) row.errors.push('Missing name');
    if (!isEmail(row.email)) row.errors.push('Invalid email');
    else if (!settings.emailDomainAllowed(row.email)) row.errors.push('Email domain not allowed');
    if (row.employee_code && seenCodes.has(row.employee_code.toLowerCase())) row.errors.push('Duplicate Employee ID in file');
    if (row.email && seenEmails.has(row.email)) row.errors.push('Duplicate email in file');
    seenCodes.add(row.employee_code.toLowerCase());
    seenEmails.add(row.email);
    if (!row.errors.length) {
      const byCode = get('SELECT id, email FROM employees WHERE employee_code = ?', row.employee_code);
      const byEmail = get('SELECT id, employee_code FROM employees WHERE email = ?', row.email);
      if (byCode && byEmail && byCode.id !== byEmail.id) row.errors.push('Email belongs to a different existing employee');
      else if (!byCode && byEmail) row.errors.push(`Email already used by Employee ID ${byEmail.employee_code}`);
      row.action = byCode ? 'update' : 'create';
      row.existingId = byCode ? byCode.id : null;
    }
    return row;
  });
}

router.post('/employees/import/preview', sheetUpload.single('file'), (req, res) => {
  if (!req.file) throw httpError(400, 'Please choose a CSV or Excel file.');
  let sheetRows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false, dense: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  } catch {
    throw httpError(400, 'Could not read this file. Please upload a .csv, .xlsx or .xls file.');
  }
  if (!sheetRows.length) throw httpError(400, 'The file is empty.');
  const headers = sheetRows[0].map(mapHeader);
  const missing = ['employee_code', 'full_name', 'email'].filter((c) => !headers.includes(c));
  if (missing.length) {
    throw httpError(400, `Missing required column(s): ${missing.join(', ')}. Expected headers like "Employee ID, Full Name, Email, Department".`);
  }
  const raw = sheetRows.slice(1).map((cells, i) => {
    const o = { line: i + 2 };
    headers.forEach((col, idx) => { if (col) o[col] = cells[idx]; });
    return o;
  }).filter((o) => o.employee_code || o.full_name || o.email);
  const rows = analyseRows(raw);
  res.json({
    rows,
    summary: {
      total: rows.length,
      create: rows.filter((r) => !r.errors.length && r.action === 'create').length,
      update: rows.filter((r) => !r.errors.length && r.action === 'update').length,
      invalid: rows.filter((r) => r.errors.length).length,
    },
    columns: headers.filter(Boolean),
  });
});

router.post('/employees/import', (req, res) => {
  if (!Array.isArray(req.body.rows)) throw httpError(400, 'Nothing to import.');
  const updateExisting = req.body.updateExisting !== false;
  const rows = analyseRows(req.body.rows);
  const result = { created: 0, updated: 0, skipped: 0, errors: [] };
  tx(() => {
    const now = nowIso();
    for (const r of rows) {
      if (r.errors.length) { result.skipped += 1; result.errors.push({ line: r.line, errors: r.errors }); continue; }
      if (r.action === 'update') {
        if (!updateExisting) { result.skipped += 1; continue; }
        run(`UPDATE employees SET full_name = ?, email = ?, department = ?, designation = ?, location = ?, active = ?, updated_at = ? WHERE id = ?`,
          r.full_name, r.email, r.department, r.designation, r.location, r.active, now, r.existingId);
        result.updated += 1;
      } else {
        run(`INSERT INTO employees (employee_code, full_name, email, department, designation, location, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.employee_code, r.full_name, r.email, r.department, r.designation, r.location, r.active, now, now);
        result.created += 1;
      }
    }
  });
  log(req, 'employee.imported', { created: result.created, updated: result.updated, skipped: result.skipped });
  res.json(result);
});

function sendCsv(res, filename, header, rows) {
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + body);
}

router.get('/employees/template.csv', (req, res) => {
  const domain = settings.allowedDomains()[0] || 'company.com';
  sendCsv(res, 'employee-import-template.csv',
    ['Employee ID', 'Full Name', 'Email', 'Department', 'Designation', 'Location', 'Active'],
    [['TS1001', 'Asha Sharma', `asha.sharma@${domain}`, 'Engineering', 'Software Engineer', 'Ahmedabad', 'Yes'],
      ['TS1002', 'Rohan Mehta', `rohan.mehta@${domain}`, 'Human Resources', 'HR Executive', 'Ahmedabad', 'Yes']]);
});

router.get('/export/participants.csv', (req, res) => {
  const slots = privacy.WISH_SLOTS;
  const rows = employeeRows().map((e) => [
    e.employee_code, e.full_name, e.email, e.department, e.designation, e.location, e.active ? 'Active' : 'Inactive',
    e.has_account ? 'Yes' : 'No', e.registered_at ? 'Yes' : 'No', e.registered_at || '',
    `${e.wish_count}/${slots}`, e.wish_count >= slots ? 'Complete' : e.wish_count ? 'Partial' : 'Not started',
    e.in_draw ? 'Yes' : 'No', e.revealed_at ? 'Yes' : 'No',
  ]);
  log(req, 'export.participants', { rows: rows.length });
  sendCsv(res, `secret-santa-status-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Employee ID', 'Full Name', 'Email', 'Department', 'Designation', 'Location', 'Status', 'Account Activated',
      'Registered', 'Registered At', 'Wishes', 'Wish List', 'In Draw', 'Unwrapped Assignment'], rows);
});

/* -------------------------------------------------------------- settings */

router.get('/settings', (req, res) => {
  res.json({ settings: settings.adminSettings(), placeholders: Object.keys(mailer.baseVars({ full_name: '' }, { code: '', message: '' })) });
});

router.put('/settings', (req, res) => {
  const { values, errors } = settings.validate(req.body || {});
  if (errors.length) throw httpError(400, errors.join(' '));
  if (values.registration_open === true && privacy.activeDraw()) {
    throw httpError(409, 'The draw is already finalized. Reset the draw before reopening registrations.');
  }
  settings.saveMany(values);
  log(req, 'settings.updated', { keys: Object.keys(values) });
  res.json({ ok: true, settings: settings.adminSettings() });
});

const BRANDING_SLOTS = ['logo', 'hero_image'];
const removeUpload = (url) => { if (url) removeFile(PUBLIC_UPLOAD_DIR, String(url).replace('/uploads/', '')); };

router.post('/branding/:slot', brandingUpload, (req, res) => {
  const slot = req.params.slot;
  if (!BRANDING_SLOTS.includes(slot)) throw httpError(404, 'Unknown image slot.');
  const file = req.files?.image?.[0];
  const emailFile = slot === 'logo' ? req.files?.email_image?.[0] : null;
  const name = saveImage(file, PUBLIC_UPLOAD_DIR, slot.replace('_', ''));
  // Small copy for emails (optional – the mailer falls back to the original if it is small enough)
  let emailName = null;
  if (emailFile) {
    try { emailName = saveImage(emailFile, PUBLIC_UPLOAD_DIR, 'logomail'); } catch { emailName = null; }
  }
  removeUpload(settings.getSetting(slot));
  settings.setInternal(slot, publicUrl(name));
  if (slot === 'logo') {
    removeUpload(settings.getSetting('logo_email'));
    settings.setInternal('logo_email', emailName ? publicUrl(emailName) : null);
  }
  log(req, 'branding.uploaded', { slot });
  res.json({ ok: true, url: publicUrl(name) });
});

router.delete('/branding/:slot', (req, res) => {
  const slot = req.params.slot;
  if (!BRANDING_SLOTS.includes(slot)) throw httpError(404, 'Unknown image slot.');
  removeUpload(settings.getSetting(slot));
  settings.setInternal(slot, null);
  if (slot === 'logo') {
    removeUpload(settings.getSetting('logo_email'));
    settings.setInternal('logo_email', null);
  }
  log(req, 'branding.removed', { slot });
  res.json({ ok: true });
});

router.post('/settings/reset-templates', (req, res) => {
  settings.setInternal('templates', settings.DEFAULT_TEMPLATES);
  log(req, 'settings.templates_reset');
  res.json({ ok: true, settings: settings.adminSettings() });
});

/* --------------------------------------------------------------- gallery */

router.get('/gallery', (req, res) => {
  res.json({ items: all('SELECT id, file, caption, sort_order FROM gallery ORDER BY sort_order, id').map((g) => ({ ...g, url: publicUrl(g.file) })) });
});

router.post('/gallery', imageUpload.single('image'), (req, res) => {
  const name = saveImage(req.file, PUBLIC_UPLOAD_DIR, 'gallery');
  const max = get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM gallery').m;
  const r = run('INSERT INTO gallery (file, caption, sort_order, created_at) VALUES (?, ?, ?, ?)', name, clean(req.body.caption, 200), max + 1, nowIso());
  log(req, 'gallery.added', { id: Number(r.lastInsertRowid) });
  res.json({ ok: true, id: Number(r.lastInsertRowid), url: publicUrl(name) });
});

router.put('/gallery/:id', (req, res) => {
  const g = get('SELECT * FROM gallery WHERE id = ?', Number(req.params.id));
  if (!g) throw httpError(404, 'Photo not found.');
  const sort = Number.isInteger(req.body.sort_order) ? req.body.sort_order : g.sort_order;
  run('UPDATE gallery SET caption = ?, sort_order = ? WHERE id = ?', req.body.caption !== undefined ? clean(req.body.caption, 200) : g.caption, sort, g.id);
  res.json({ ok: true });
});

router.delete('/gallery/:id', (req, res) => {
  const g = get('SELECT * FROM gallery WHERE id = ?', Number(req.params.id));
  if (!g) throw httpError(404, 'Photo not found.');
  run('DELETE FROM gallery WHERE id = ?', g.id);
  removeFile(PUBLIC_UPLOAD_DIR, g.file);
  log(req, 'gallery.removed', { id: g.id });
  res.json({ ok: true });
});

/* --------------------------------------------------------- background music */

const listTracks = () => all('SELECT id, file, title, sort_order FROM music_tracks ORDER BY sort_order, id')
  .map((t) => ({ ...t, url: publicUrl(t.file) }));

router.get('/music', (req, res) => {
  res.json({ items: listTracks() });
});

router.post('/music', audioUpload.single('audio'), (req, res) => {
  const name = saveAudio(req.file, PUBLIC_UPLOAD_DIR, 'music');
  const max = get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM music_tracks').m;
  const title = clean(req.body.title, 120) || `Track ${max + 1}`;
  const r = run('INSERT INTO music_tracks (file, title, sort_order, created_at) VALUES (?, ?, ?, ?)', name, title, max + 1, nowIso());
  log(req, 'music.added', { id: Number(r.lastInsertRowid), title });
  res.json({ ok: true, id: Number(r.lastInsertRowid), url: publicUrl(name) });
});

// New playlist order: { ids: [3, 1, 2] }
router.put('/music/order', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  const existing = all('SELECT id FROM music_tracks').map((t) => t.id);
  if (ids.length !== existing.length || !existing.every((id) => ids.includes(id))) throw httpError(400, 'Track list is out of date – please reload.');
  tx(() => ids.forEach((id, i) => run('UPDATE music_tracks SET sort_order = ? WHERE id = ?', i + 1, id)));
  log(req, 'music.reordered');
  res.json({ ok: true, items: listTracks() });
});

router.put('/music/:id', (req, res) => {
  const t = get('SELECT * FROM music_tracks WHERE id = ?', Number(req.params.id));
  if (!t) throw httpError(404, 'Track not found.');
  const title = clean(req.body.title, 120);
  if (!title) throw httpError(400, 'Please enter a title.');
  run('UPDATE music_tracks SET title = ? WHERE id = ?', title, t.id);
  res.json({ ok: true });
});

router.delete('/music/:id', (req, res) => {
  const t = get('SELECT * FROM music_tracks WHERE id = ?', Number(req.params.id));
  if (!t) throw httpError(404, 'Track not found.');
  run('DELETE FROM music_tracks WHERE id = ?', t.id);
  removeFile(PUBLIC_UPLOAD_DIR, t.file);
  log(req, 'music.removed', { id: t.id, title: t.title });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ draw */

router.get('/draw', (req, res) => {
  const s = settings.loadAll();
  res.json({
    draw: privacy.drawSummary(),
    preview: privacy.drawPreview(),
    config: { mode: s.draw_mode, avoidMutual: s.avoid_mutual_pairs, byLocation: s.draw_by_location, releaseOnDraw: s.release_on_draw, requireComplete: s.require_complete_wishes, drawDate: s.draw_date },
    registrationOpen: Boolean(s.registration_open),
    history: all(`SELECT d.id, d.status, d.mode, d.participant_count, d.released, d.created_at, d.reset_at, d.reset_reason,
                         c.name AS created_by_name, r.name AS reset_by_name
                  FROM draws d LEFT JOIN admins c ON c.id = d.created_by LEFT JOIN admins r ON r.id = d.reset_by
                  ORDER BY d.id DESC LIMIT 20`),
  });
});

router.post('/draw/run', (req, res) => {
  if (String(req.body.confirm || '').trim().toUpperCase() !== 'DRAW') throw httpError(400, 'Type DRAW to confirm.');
  const result = privacy.runDraw(req.admin.id);
  log(req, 'draw.completed', { drawId: result.drawId, participants: result.participants.length, released: result.released, locations: result.locations || undefined });
  mailer.notifyMany(result.participants, result.released ? 'assignment_available' : 'draw_completed');
  res.json({ ok: true, drawId: result.drawId, participants: result.participants.length, released: result.released });
});

router.post('/draw/release', (req, res) => {
  const participants = privacy.releaseDraw();
  log(req, 'draw.released', { participants: participants.length });
  mailer.notifyMany(participants, 'assignment_available');
  res.json({ ok: true, participants: participants.length });
});

router.post('/draw/reset', auth.requireSuperAdmin, async (req, res) => {
  if (String(req.body.confirm || '').trim().toUpperCase() !== 'RESET') throw httpError(400, 'Type RESET to confirm.');
  const reason = clean(req.body.reason, 500);
  if (reason.length < 10) throw httpError(400, 'Please give a clear reason (at least 10 characters) – it is recorded in the audit log.');
  if (!(await verifyPassword(String(req.body.password || ''), req.admin.password_hash))) throw httpError(401, 'Password is incorrect.');
  const result = privacy.resetDraw(req.admin.id, reason);
  log(req, 'draw.reset', { drawId: result.drawId, reason });
  res.json({ ok: true });
});

/* --------------------------------------------------------- notifications */

function audienceList(audience) {
  const slots = privacy.WISH_SLOTS;
  const base = `SELECT e.* FROM employees e LEFT JOIN registrations r ON r.employee_id = e.id
                LEFT JOIN wishlists w ON w.employee_id = e.id WHERE e.active = 1`;
  switch (audience) {
    case 'not_registered': return all(`${base} AND r.employee_id IS NULL`);
    case 'no_account': return all(`${base} AND e.id NOT IN (SELECT employee_id FROM employee_auth)`);
    case 'incomplete_wishes': return all(`${base} AND r.employee_id IS NOT NULL AND COALESCE(w.wish_count, 0) < ${slots}`);
    case 'pending_any': return all(`${base} AND (r.employee_id IS NULL OR COALESCE(w.wish_count, 0) < ${slots})`);
    case 'registered': return all(`${base} AND r.employee_id IS NOT NULL`);
    case 'not_unwrapped': return privacy.drawParticipants().filter((e) => {
      const st = privacy.assignmentStatusFor(e.id);
      return st.state === 'ready';
    });
    case 'everyone': return all(base);
    default: throw httpError(400, 'Unknown audience.');
  }
}

router.get('/reminders/audiences', (req, res) => {
  const names = ['not_registered', 'no_account', 'incomplete_wishes', 'pending_any', 'registered', 'not_unwrapped', 'everyone'];
  const counts = {};
  for (const n of names) counts[n] = audienceList(n).length;
  res.json({ counts, emailConfigured: mailer.smtpConfigured() });
});

router.post('/reminders', limiter('reminders', 20, 60 * 60 * 1000, (r) => r.admin.id), (req, res) => {
  const list = audienceList(req.body.audience);
  const message = clean(req.body.message, 3000);
  if (!list.length) throw httpError(400, 'Nobody matches this audience right now.');
  const count = message ? mailer.notifyMany(list, 'custom_reminder', { message }) : mailer.notifyMany(list, 'deadline_reminder');
  log(req, 'reminders.sent', { audience: req.body.audience, count, custom: Boolean(message) });
  res.json({ ok: true, count });
});

router.get('/notifications', (req, res) => {
  res.json({
    notifications: all(`SELECT n.id, n.type, n.title, n.email_status, n.email_error, n.read_at, n.created_at, e.full_name, e.email
                        FROM notifications n JOIN employees e ON e.id = n.employee_id ORDER BY n.id DESC LIMIT 300`),
  });
});

/** Whose name fills {{first_name}} / {{full_name}} in a test: the employee with that email, otherwise the admin. */
function testPerson(req, to) {
  const emp = to ? get('SELECT full_name FROM employees WHERE email = ?', to) : null;
  return { full_name: (emp && emp.full_name) || req.admin.name || 'Santa Elf' };
}

router.get('/email/sample', (req, res) => {
  const to = clean(req.query.to, 254);
  res.json({ values: mailer.sampleVars(testPerson(req, isEmail(to) ? to : '')) });
});

// template: 'connection' (plain check), a template key, or 'all' (one email per template)
router.post('/email/test', async (req, res) => {
  const to = clean(req.body.to, 254) || req.admin.email;
  if (!isEmail(to)) throw httpError(400, 'Enter a valid email address.');
  const templates = settings.getSetting('templates');
  const choice = clean(req.body.template, 60) || 'connection';
  let emails;
  if (choice === 'connection') {
    emails = [{ subject: `Test email from ${settings.getSetting('event_title')} 🎄`, body: 'Ho ho ho! If you can read this, email notifications are configured correctly.' }];
  } else {
    const keys = choice === 'all' ? Object.keys(templates) : [choice];
    if (!keys.every((k) => templates[k])) throw httpError(400, 'Unknown email template.');
    const vars = mailer.sampleVars(testPerson(req, to));
    emails = keys.map((k) => ({ subject: `[Test] ${mailer.render(templates[k].subject, vars)}`, body: mailer.render(templates[k].body, vars) }));
  }
  let sent = 0;
  for (const m of emails) {
    const result = await mailer.sendMail(to, m.subject, m.body);
    if (result.status === 'not_configured') throw httpError(400, 'Email is not configured. Turn on email and fill in the SMTP host and From address.');
    if (result.status === 'failed') {
      log(req, 'email.test', { to, template: choice, sent, status: 'failed' });
      throw httpError(502, `Sending failed${sent ? ` after ${sent} of ${emails.length} emails` : ''}: ${result.error}`);
    }
    sent += 1;
  }
  log(req, 'email.test', { to, template: choice, sent, status: 'sent' });
  res.json({ ok: true, sent, to });
});

/* ----------------------------------------------------------------- audit */

router.get('/audit', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 300, 2000);
  res.json({ logs: all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', limit) });
});

/* ---------------------------------------------------------------- admins */

router.get('/admins', auth.requireSuperAdmin, (req, res) => {
  res.json({ admins: all('SELECT * FROM admins ORDER BY id').map(adminView) });
});

router.post('/admins', auth.requireSuperAdmin, async (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase();
  const name = clean(req.body.name, 120);
  const role = req.body.role === 'super_admin' ? 'super_admin' : 'hr_admin';
  if (!isEmail(email)) throw httpError(400, 'A valid email is required.');
  if (!name) throw httpError(400, 'Name is required.');
  const problem = passwordProblem(req.body.password);
  if (problem) throw httpError(400, problem);
  try {
    run('INSERT INTO admins (email, name, password_hash, role, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      email, name, await hashPassword(req.body.password), role, nowIso());
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw httpError(409, 'An admin with this email already exists.');
    throw err;
  }
  log(req, 'admin.created', { email, role });
  res.json({ ok: true });
});

function superAdminCount() {
  return get("SELECT COUNT(*) AS c FROM admins WHERE role = 'super_admin' AND active = 1").c;
}

router.put('/admins/:id', auth.requireSuperAdmin, async (req, res) => {
  const target = get('SELECT * FROM admins WHERE id = ?', Number(req.params.id));
  if (!target) throw httpError(404, 'Admin not found.');
  const name = req.body.name !== undefined ? clean(req.body.name, 120) || target.name : target.name;
  const role = req.body.role ? (req.body.role === 'super_admin' ? 'super_admin' : 'hr_admin') : target.role;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : target.active;
  const losingSuper = target.role === 'super_admin' && target.active && (role !== 'super_admin' || !active);
  if (losingSuper && superAdminCount() <= 1) throw httpError(409, 'There must always be at least one active super admin.');
  run('UPDATE admins SET name = ?, role = ?, active = ? WHERE id = ?', name, role, active, target.id);
  if (req.body.password) {
    const problem = passwordProblem(req.body.password);
    if (problem) throw httpError(400, problem);
    run('UPDATE admins SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?',
      await hashPassword(req.body.password), target.id);
  }
  if (!active || req.body.password) auth.destroyAllSessions('admin', target.id);
  log(req, 'admin.updated', { id: target.id, role, active: Boolean(active), passwordReset: Boolean(req.body.password) });
  res.json({ ok: true });
});

router.delete('/admins/:id', auth.requireSuperAdmin, (req, res) => {
  const target = get('SELECT * FROM admins WHERE id = ?', Number(req.params.id));
  if (!target) throw httpError(404, 'Admin not found.');
  if (target.id === req.admin.id) throw httpError(409, 'You cannot delete your own account.');
  if (target.role === 'super_admin' && superAdminCount() <= 1) throw httpError(409, 'There must always be at least one active super admin.');
  // Keep the row for audit history (draws reference admins); just disable it
  run('UPDATE admins SET active = 0 WHERE id = ?', target.id);
  auth.destroyAllSessions('admin', target.id);
  log(req, 'admin.disabled', { id: target.id, email: target.email });
  res.json({ ok: true });
});

/* ------------------------------------------------------ emergency override */

router.get('/override', (req, res) => {
  const mine = privacy.activeOverride(req.admin.id);
  const any = privacy.anyActiveOverride();
  res.json({
    mine: mine ? { reason: mine.reason, expiresAt: mine.expires_at, createdAt: mine.created_at } : null,
    any: any ? { adminName: any.admin_name, expiresAt: any.expires_at, reason: any.reason } : null,
    isSuperAdmin: req.admin.role === 'super_admin',
  });
});

router.post('/override', auth.requireSuperAdmin, limiter('override', 5, 60 * 60 * 1000, (r) => r.admin.id), async (req, res) => {
  const reason = clean(req.body.reason, 500);
  if (reason.length < 15) throw httpError(400, 'Describe the emergency (at least 15 characters). This is permanently logged.');
  if (!(await verifyPassword(String(req.body.password || ''), req.admin.password_hash))) throw httpError(401, 'Password is incorrect.');
  const expires = new Date(Date.now() + OVERRIDE_MINUTES * 60 * 1000).toISOString();
  run('UPDATE overrides SET ended_at = ? WHERE admin_id = ? AND ended_at IS NULL', nowIso(), req.admin.id);
  run('INSERT INTO overrides (admin_id, reason, created_at, expires_at) VALUES (?, ?, ?, ?)', req.admin.id, reason, nowIso(), expires);
  log(req, 'override.enabled', { reason, minutes: OVERRIDE_MINUTES });
  res.json({ ok: true, expiresAt: expires });
});

router.post('/override/end', (req, res) => {
  run('UPDATE overrides SET ended_at = ? WHERE admin_id = ? AND ended_at IS NULL', nowIso(), req.admin.id);
  log(req, 'override.ended');
  res.json({ ok: true });
});

router.get('/override/assignments', auth.requireSuperAdmin, (req, res) => {
  const list = privacy.overrideAssignments(req.admin.id);
  log(req, 'override.viewed_assignments', { rows: list.length });
  res.json({ assignments: list });
});

router.get('/override/wishes/:employeeId', auth.requireSuperAdmin, (req, res) => {
  const id = Number(req.params.employeeId);
  const emp = get('SELECT full_name, employee_code FROM employees WHERE id = ?', id);
  if (!emp) throw httpError(404, 'Employee not found.');
  const wishes = privacy.overrideWishes(req.admin.id, id);
  log(req, 'override.viewed_wishes', { employeeId: id, code: emp.employee_code });
  res.json({ employee: { fullName: emp.full_name, code: emp.employee_code }, wishes: wishes ? wishes.wishes : [] });
});

module.exports = router;
