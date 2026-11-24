'use strict';
// Cookie sessions (random token, only its SHA-256 is stored), CSRF tokens and role guards.
const { get, run, nowIso } = require('./db');
const { randomToken, sha256, safeEqual } = require('./security');

const COOKIE = { employee: 'ss_emp', admin: 'ss_adm' };
const TTL_MS = { employee: 7 * 24 * 3600 * 1000, admin: 8 * 3600 * 1000 };
const SECURE_COOKIES = process.env.COOKIE_SECURE === 'true';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function setCookie(res, name, value, maxAgeMs) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (SECURE_COOKIES) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]);
}

function createSession(req, res, kind, subjectId) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + TTL_MS[kind]).toISOString();
  run(
    'INSERT INTO sessions (token_hash, kind, subject_id, csrf, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    sha256(token), kind, subjectId, csrf, nowIso(), expires, req.ip, String(req.get('user-agent') || '').slice(0, 300),
  );
  setCookie(res, COOKIE[kind], token, TTL_MS[kind]);
  return { csrf };
}

function destroySession(req, res, kind) {
  const token = parseCookies(req.headers.cookie)[COOKIE[kind]];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  setCookie(res, COOKIE[kind], '', 0);
}

function destroyAllSessions(kind, subjectId) {
  run('DELETE FROM sessions WHERE kind = ? AND subject_id = ?', kind, subjectId);
}

/** Loads req.employee / req.admin (+ their session) from cookies on every request. */
function loadSessions(req, _res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const now = nowIso();
  for (const kind of ['employee', 'admin']) {
    const token = cookies[COOKIE[kind]];
    if (!token) continue;
    const session = get('SELECT * FROM sessions WHERE token_hash = ? AND kind = ?', sha256(token), kind);
    if (!session) continue;
    if (session.expires_at < now) {
      run('DELETE FROM sessions WHERE token_hash = ?', session.token_hash);
      continue;
    }
    if (kind === 'employee') {
      const emp = get('SELECT * FROM employees WHERE id = ? AND active = 1', session.subject_id);
      if (emp) { req.employee = emp; req.employeeSession = session; }
    } else {
      const admin = get('SELECT * FROM admins WHERE id = ? AND active = 1', session.subject_id);
      if (admin) { req.admin = admin; req.adminSession = session; }
    }
  }
  next();
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function checkCsrf(req, session) {
  if (!MUTATING.has(req.method)) return true;
  const header = req.get('x-csrf-token') || '';
  return Boolean(session && header && safeEqual(header, session.csrf));
}

function requireEmployee(req, res, next) {
  if (!req.employee) return res.status(401).json({ error: 'Please sign in to continue.' });
  if (!checkCsrf(req, req.employeeSession)) return res.status(403).json({ error: 'Security token expired. Please refresh the page.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.admin) return res.status(401).json({ error: 'Admin sign-in required.' });
  if (!checkCsrf(req, req.adminSession)) return res.status(403).json({ error: 'Security token expired. Please refresh the page.' });
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.admin || req.admin.role !== 'super_admin') return res.status(403).json({ error: 'Only a super admin can do this.' });
  next();
}

/** Blocks cross-site form posts even before a session exists. */
function sameOrigin(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request blocked.' });
    } catch {
      return res.status(403).json({ error: 'Bad origin.' });
    }
  }
  next();
}

module.exports = {
  createSession, destroySession, destroyAllSessions, loadSessions, requireEmployee, requireAdmin,
  requireSuperAdmin, sameOrigin, parseCookies,
};
