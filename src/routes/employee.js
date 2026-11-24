'use strict';
// Employee API: account activation, login (password / OTP), Secret Santa registration,
// wishes, gift-box reveal, notifications and profile photo.
const express = require('express');
const { get, run, nowIso, PHOTO_DIR } = require('../db');
const { hashPassword, verifyPassword, passwordProblem } = require('../security');
const auth = require('../auth');
const settings = require('../settings');
const privacy = require('../privacy');
const mailer = require('../mailer');
const { issueOtp, consumeOtp } = require('../otp');
const { audit, employeeActor } = require('../audit');
const { limiter, asyncRoute, httpError, clean, imageUpload, saveImage, removeFile } = require('../util');

const router = express.Router();

// The whole office may share one public IP (NAT), so the per-IP ceiling is generous and the
// tight limits are per account. Per-account password lockout is handled separately below.
const accountKey = (req) => String((req.body && (req.body.email || req.body.identifier)) || '').trim().toLowerCase() || req.ip;
const authLimiter = limiter('auth-ip', 600, 15 * 60 * 1000);
const otpLimiter = limiter('otp-account', 6, 15 * 60 * 1000, accountKey);
// bcrypt hash of a random string – keeps login timing similar for unknown users
const DUMMY_HASH = require('bcryptjs').hashSync(require('../security').randomToken(), 11);
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

function findEmployee(identifier) {
  const id = clean(identifier, 254);
  if (!id) return null;
  return get('SELECT * FROM employees WHERE (email = ? OR employee_code = ?) AND active = 1', id, id) || null;
}

/** Find the directory entry for a sign-up. Employee ID is only checked when HR turns that option on. */
function matchDirectory(email, code) {
  const needCode = Boolean(settings.getSetting('signup_require_employee_id'));
  const e = clean(email, 254);
  const c = clean(code, 60);
  if (!e) throw httpError(400, 'Please enter your official email.');
  if (needCode && !c) throw httpError(400, 'Please enter your official email and Employee ID.');
  if (!settings.emailDomainAllowed(e)) {
    throw httpError(403, `Please use your official company email (${settings.allowedDomains().map((d) => '@' + d).join(', ')}).`);
  }
  const emp = needCode
    ? get('SELECT * FROM employees WHERE email = ? AND employee_code = ?', e, c)
    : get('SELECT * FROM employees WHERE email = ?', e);
  if (!emp) {
    throw httpError(404, needCode
      ? "We couldn't match that email and Employee ID in the Techsara directory. Please check them or contact HR."
      : "We couldn't find this email in the Techsara employee directory. Please check it or contact HR.");
  }
  if (!emp.active) throw httpError(403, 'Your profile is not active for Secret Santa. Please contact HR.');
  return emp;
}

const loginAllows = (method) => {
  const m = settings.getSetting('login_method');
  return m === 'both' || m === method;
};

function profile(emp) {
  return {
    id: emp.id,
    fullName: emp.full_name,
    firstName: emp.full_name.split(/\s+/)[0],
    email: emp.email,
    employeeCode: emp.employee_code,
    department: emp.department,
    designation: emp.designation,
    location: emp.location,
    photo: emp.photo ? `/media/photos/${emp.photo}` : null,
  };
}

function startSession(req, res, emp) {
  auth.createSession(req, res, 'employee', emp.id);
  run('UPDATE employee_auth SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE employee_id = ?', nowIso(), emp.id);
  return { ok: true };
}

/* ---------------------------------------------------------------- session */

router.get('/session', (req, res) => {
  res.json({
    employee: req.employee ? profile(req.employee) : null,
    csrf: req.employeeSession ? req.employeeSession.csrf : null,
  });
});

/* ------------------------------------------------------ account activation */

router.post('/auth/signup/start', authLimiter, otpLimiter, asyncRoute(async (req, res) => {
  const emp = matchDirectory(req.body.email, req.body.employeeCode);
  const existing = get('SELECT employee_id FROM employee_auth WHERE employee_id = ?', emp.id);
  if (existing) throw httpError(409, 'An account already exists for this employee. Please sign in instead (or use "Forgot password").');
  const otpRequired = settings.getSetting('require_email_otp_signup');
  if (otpRequired) {
    const code = issueOtp(emp.id, 'signup');
    await mailer.sendOtp(emp, code);
  }
  res.json({
    ok: true,
    otpRequired,
    passwordRequired: settings.getSetting('login_method') !== 'otp',
    name: emp.full_name.split(/\s+/)[0],
    maskedEmail: emp.email.replace(/^(.)(.*)(@.*)$/, (m, a, b, c) => a + '*'.repeat(Math.min(b.length, 6)) + c),
  });
}));

router.post('/auth/signup/complete', authLimiter, asyncRoute(async (req, res) => {
  const emp = matchDirectory(req.body.email, req.body.employeeCode);
  if (get('SELECT employee_id FROM employee_auth WHERE employee_id = ?', emp.id)) {
    throw httpError(409, 'An account already exists for this employee. Please sign in instead.');
  }
  const passwordRequired = settings.getSetting('login_method') !== 'otp';
  let hash = null;
  if (passwordRequired || req.body.password) {
    const problem = passwordProblem(req.body.password);
    if (problem) throw httpError(400, problem);
    hash = await hashPassword(req.body.password);
  }
  if (settings.getSetting('require_email_otp_signup')) consumeOtp(emp.id, 'signup', req.body.otp);
  try {
    run('INSERT INTO employee_auth (employee_id, password_hash, created_at) VALUES (?, ?, ?)', emp.id, hash, nowIso());
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw httpError(409, 'An account already exists for this employee.');
    throw err;
  }
  audit(employeeActor(emp), 'employee.account_created', null, req.ip);
  res.json(startSession(req, res, emp));
}));

/* ------------------------------------------------------------------- login */

router.post('/auth/login', authLimiter, asyncRoute(async (req, res) => {
  if (!loginAllows('password')) throw httpError(400, 'Password sign-in is turned off. Please use a one-time code.');
  const emp = findEmployee(req.body.identifier);
  const creds = emp ? get('SELECT * FROM employee_auth WHERE employee_id = ?', emp.id) : null;
  if (creds && creds.locked_until && creds.locked_until > nowIso()) {
    throw httpError(429, 'Too many failed attempts. Your account is locked for 15 minutes.');
  }
  const ok = await verifyPassword(String(req.body.password || ''), creds && creds.password_hash ? creds.password_hash : DUMMY_HASH);
  if (!emp || !creds || !creds.password_hash || !ok) {
    if (creds) {
      const failed = creds.failed_attempts + 1;
      run('UPDATE employee_auth SET failed_attempts = ?, locked_until = ? WHERE employee_id = ?',
        failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS).toISOString() : null, emp.id);
    }
    if (emp && !creds) throw httpError(401, 'You have not activated your account yet. Choose "First time here?" to get started.');
    throw httpError(401, 'Incorrect email / Employee ID or password.');
  }
  res.json(startSession(req, res, emp));
}));

router.post('/auth/otp/request', otpLimiter, asyncRoute(async (req, res) => {
  if (!loginAllows('otp')) throw httpError(400, 'One-time code sign-in is turned off. Please use your password.');
  const emp = findEmployee(req.body.identifier);
  const creds = emp ? get('SELECT employee_id FROM employee_auth WHERE employee_id = ?', emp.id) : null;
  if (emp && creds) {
    const code = issueOtp(emp.id, 'login');
    await mailer.sendOtp(emp, code);
  }
  // Same answer either way so the endpoint can't be used to discover accounts
  res.json({ ok: true, message: 'If an activated account matches, a 6-digit code is on its way to the official email.' });
}));

router.post('/auth/otp/verify', authLimiter, asyncRoute(async (req, res) => {
  if (!loginAllows('otp')) throw httpError(400, 'One-time code sign-in is turned off.');
  const emp = findEmployee(req.body.identifier);
  if (!emp || !get('SELECT 1 FROM employee_auth WHERE employee_id = ?', emp.id)) throw httpError(400, 'That code is not correct or has expired.');
  consumeOtp(emp.id, 'login', req.body.otp);
  res.json(startSession(req, res, emp));
}));

router.post('/auth/password/forgot', otpLimiter, asyncRoute(async (req, res) => {
  const emp = findEmployee(req.body.identifier);
  if (emp && get('SELECT 1 FROM employee_auth WHERE employee_id = ?', emp.id)) {
    const code = issueOtp(emp.id, 'reset');
    await mailer.sendOtp(emp, code);
  }
  res.json({ ok: true, message: 'If an activated account matches, a reset code is on its way to the official email.' });
}));

router.post('/auth/password/reset', authLimiter, asyncRoute(async (req, res) => {
  const emp = findEmployee(req.body.identifier);
  if (!emp || !get('SELECT 1 FROM employee_auth WHERE employee_id = ?', emp.id)) throw httpError(400, 'That code is not correct or has expired.');
  const problem = passwordProblem(req.body.password);
  if (problem) throw httpError(400, problem);
  consumeOtp(emp.id, 'reset', req.body.otp);
  run('UPDATE employee_auth SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE employee_id = ?', await hashPassword(req.body.password), emp.id);
  auth.destroyAllSessions('employee', emp.id);
  audit(employeeActor(emp), 'employee.password_reset', null, req.ip);
  res.json(startSession(req, res, emp));
}));

router.post('/auth/logout', (req, res) => {
  auth.destroySession(req, res, 'employee');
  res.json({ ok: true });
});

/* ---------------------------------------------------------- authenticated */

router.use(['/me', '/registration', '/wishes', '/assignment', '/notifications'], auth.requireEmployee);

router.get('/me', (req, res) => {
  const emp = req.employee;
  const registration = get('SELECT registered_at FROM registrations WHERE employee_id = ?', emp.id);
  const wishes = privacy.getOwnWishes(emp.id);
  const draw = privacy.drawSummary();
  res.json({
    profile: profile(emp),
    registration: registration ? { registeredAt: registration.registered_at } : null,
    wishes,
    wishSlots: privacy.WISH_SLOTS,
    draw: { status: draw.status, releasedAt: draw.releasedAt || null },
    assignment: privacy.assignmentStatusFor(emp.id),
    unread: mailer.unreadCount(emp.id),
    registrationOpen: Boolean(settings.getSetting('registration_open')),
    hasPassword: Boolean((get('SELECT password_hash FROM employee_auth WHERE employee_id = ?', emp.id) || {}).password_hash),
  });
});

router.post('/registration', asyncRoute(async (req, res) => {
  const emp = req.employee;
  if (req.body.agree !== true) throw httpError(400, 'Please agree to Santa’s Rules to join.');
  if (!settings.getSetting('registration_open')) throw httpError(403, 'Registrations are closed at the moment.');
  if (privacy.activeDraw()) throw httpError(409, 'The draw has already happened.');
  const result = run('INSERT OR IGNORE INTO registrations (employee_id, agreed_rules, registered_at) VALUES (?, 1, ?)', emp.id, nowIso());
  if (result.changes === 0) throw httpError(409, 'You are already registered – one registration per elf!');
  audit(employeeActor(emp), 'employee.registered', null, req.ip);
  mailer.notify(emp, 'registration_confirmation').catch((e) => console.error(e));
  res.json({ ok: true });
}));

router.delete('/registration', (req, res) => {
  const emp = req.employee;
  if (privacy.activeDraw()) throw httpError(409, 'The draw has already happened – please contact HR.');
  if (!settings.getSetting('registration_open')) throw httpError(403, 'Registrations are closed – please contact HR to withdraw.');
  run('DELETE FROM registrations WHERE employee_id = ?', emp.id);
  audit(employeeActor(emp), 'employee.withdrew', null, req.ip);
  res.json({ ok: true });
});

router.get('/wishes', (req, res) => {
  res.json({ wishes: privacy.getOwnWishes(req.employee.id), slots: privacy.WISH_SLOTS });
});

router.put('/wishes', (req, res) => {
  const emp = req.employee;
  const result = privacy.saveOwnWishes(emp.id, req.body.wishes);
  audit(employeeActor(emp), result.isNew ? 'employee.wishes_submitted' : 'employee.wishes_updated', { count: result.count }, req.ip);
  if (result.isNew) mailer.notify(emp, 'wishlist_submitted').catch((e) => console.error(e));
  res.json({ ok: true, count: result.count, complete: result.complete, message: settings.getSetting('wish_saved_message') });
});

router.get('/assignment', (req, res) => {
  res.json(privacy.assignmentStatusFor(req.employee.id));
});

router.post('/assignment/reveal', (req, res) => {
  const before = privacy.assignmentStatusFor(req.employee.id);
  const result = privacy.revealFor(req.employee.id);
  if (before.state !== 'revealed') audit(employeeActor(req.employee), 'employee.assignment_unwrapped', null, req.ip);
  res.json(result);
});

router.get('/notifications', (req, res) => {
  res.json({ notifications: mailer.listForEmployee(req.employee.id), unread: mailer.unreadCount(req.employee.id) });
});

router.post('/notifications/read', (req, res) => {
  run('UPDATE notifications SET read_at = ? WHERE employee_id = ? AND read_at IS NULL', nowIso(), req.employee.id);
  res.json({ ok: true });
});

router.post('/me/photo', imageUpload.single('photo'), (req, res) => {
  if (!settings.getSetting('allow_employee_photo_upload')) throw httpError(403, 'Photo uploads are managed by HR.');
  const name = saveImage(req.file, PHOTO_DIR, `emp${req.employee.id}`);
  removeFile(PHOTO_DIR, req.employee.photo);
  run('UPDATE employees SET photo = ?, updated_at = ? WHERE id = ?', name, nowIso(), req.employee.id);
  res.json({ ok: true, photo: `/media/photos/${name}` });
});

router.delete('/me/photo', (req, res) => {
  if (!settings.getSetting('allow_employee_photo_upload')) throw httpError(403, 'Photo uploads are managed by HR.');
  removeFile(PHOTO_DIR, req.employee.photo);
  run('UPDATE employees SET photo = NULL, updated_at = ? WHERE id = ?', nowIso(), req.employee.id);
  res.json({ ok: true });
});

router.post('/me/password', asyncRoute(async (req, res) => {
  const creds = get('SELECT * FROM employee_auth WHERE employee_id = ?', req.employee.id);
  if (creds.password_hash && !(await verifyPassword(String(req.body.current || ''), creds.password_hash))) {
    throw httpError(400, 'Your current password is incorrect.');
  }
  const problem = passwordProblem(req.body.next);
  if (problem) throw httpError(400, problem);
  run('UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?', await hashPassword(req.body.next), req.employee.id);
  audit(employeeActor(req.employee), 'employee.password_changed', null, req.ip);
  res.json({ ok: true });
}));

module.exports = router;
