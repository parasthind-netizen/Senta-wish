'use strict';
const { get, run, nowIso } = require('./db');
const { generateOtp, mac, safeEqual } = require('./security');
const { httpError } = require('./util');

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 45 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const hashCode = (employeeId, purpose, code) => mac(`otp:${employeeId}:${purpose}:${code}`);

/** Create a fresh OTP (invalidating older ones). Returns the plain code for emailing. */
function issueOtp(employeeId, purpose) {
  const last = get('SELECT created_at FROM otps WHERE employee_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1', employeeId, purpose);
  if (last && Date.now() - Date.parse(last.created_at) < OTP_RESEND_MS) {
    throw httpError(429, 'A code was just sent. Please wait a moment before requesting another.');
  }
  const now = nowIso();
  run('UPDATE otps SET used_at = ? WHERE employee_id = ? AND purpose = ? AND used_at IS NULL', now, employeeId, purpose);
  const code = generateOtp();
  run(
    'INSERT INTO otps (employee_id, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    employeeId, purpose, hashCode(employeeId, purpose, code), new Date(Date.now() + OTP_TTL_MS).toISOString(), now,
  );
  return code;
}

/** Verify and consume an OTP. Throws a friendly error when invalid. */
function consumeOtp(employeeId, purpose, code) {
  const clean = String(code || '').replace(/\D/g, '');
  const row = get(
    'SELECT * FROM otps WHERE employee_id = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1',
    employeeId, purpose,
  );
  if (!row || row.expires_at < nowIso()) throw httpError(400, 'This code has expired. Please request a new one.');
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw httpError(429, 'Too many wrong attempts. Please request a new code.');
  if (clean.length !== 6 || !safeEqual(hashCode(employeeId, purpose, clean), row.code_hash)) {
    run('UPDATE otps SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw httpError(400, 'That code is not correct. Please check your email and try again.');
  }
  run('UPDATE otps SET used_at = ? WHERE id = ?', nowIso(), row.id);
  return true;
}

/** Drop unused codes (e.g. the email could not be sent), so the user can ask again straight away. */
function cancelOtp(employeeId, purpose) {
  run('DELETE FROM otps WHERE employee_id = ? AND purpose = ? AND used_at IS NULL', employeeId, purpose);
}

module.exports = { issueOtp, consumeOtp, cancelOtp };
