'use strict';
// Email delivery (SMTP via nodemailer) + festive templates + in-app notifications.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { run, get, all, nowIso, PUBLIC_UPLOAD_DIR } = require('./db');
const settings = require('./settings');

const LOGO_CID = 'logo@techsara-secret-santa';
const LOGO_BOX = { w: 260, h: 84 }; // max display size of the logo in emails (px)
const LOGO_MAX_BYTES = { email: 1024 * 1024, original: 300 * 1024 };

let transport = null;
let transportKey = '';

function smtpConfigured(s = settings.loadAll()) {
  return Boolean(s.email_enabled && s.smtp_host && s.smtp_from);
}

function getTransport() {
  const s = settings.loadAll();
  const key = JSON.stringify([s.smtp_host, s.smtp_port, s.smtp_secure, s.smtp_user, s.smtp_pass]);
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport({
      host: s.smtp_host,
      port: Number(s.smtp_port) || 587,
      secure: Boolean(s.smtp_secure),
      auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    transportKey = key;
  }
  return transport;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Replace {{placeholders}} with values. */
function render(text, vars) {
  return String(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

function baseVars(employee, extra = {}) {
  const s = settings.loadAll();
  return {
    first_name: (employee.full_name || '').split(/\s+/)[0] || 'Elf',
    full_name: employee.full_name || '',
    event_title: s.event_title,
    company_name: s.company_name,
    site_url: String(s.site_url || '').replace(/\/+$/, ''),
    registration_deadline: settings.formatDate(s.registration_deadline),
    draw_date: settings.formatDate(s.draw_date),
    exchange_date: settings.formatDate(s.exchange_date),
    budget: settings.formatBudget(s),
    slogan: s.slogan,
    ...extra,
  };
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

let logoCache = { key: undefined, value: null };

/**
 * The company logo for emails: { content, width, height } or null.
 * Embedded as an inline (cid:) attachment rather than linked, because mail services such as Gmail
 * fetch linked images from the internet and can't reach a site running on the office LAN.
 * Uses the small copy made at upload time, or the original logo if it is a small PNG.
 */
function emailLogo(s = settings.loadAll()) {
  const key = JSON.stringify([s.logo_email, s.logo]);
  if (logoCache.key === key) return logoCache.value;
  let value = null;
  for (const [url, maxBytes] of [[s.logo_email, LOGO_MAX_BYTES.email], [s.logo, LOGO_MAX_BYTES.original]]) {
    const name = typeof url === 'string' ? url.replace(/^\/uploads\//, '') : '';
    if (!/^[A-Za-z0-9_-]+\.png$/.test(name)) continue;
    let content;
    try { content = fs.readFileSync(path.join(PUBLIC_UPLOAD_DIR, name)); } catch { continue; }
    const size = pngSize(content);
    if (!size || !size.w || !size.h || content.length > maxBytes) continue;
    const scale = Math.min(LOGO_BOX.w / size.w, LOGO_BOX.h / size.h, 1);
    value = { content, width: Math.max(1, Math.round(size.w * scale)), height: Math.max(1, Math.round(size.h * scale)) };
    break;
  }
  logoCache = { key, value };
  return value;
}

/**
 * Invisible per-email marker. Gmail hides content that repeats from earlier messages in the same
 * conversation behind a "•••" button (e.g. two reminders with the same subject). A unique token in
 * the header and footer makes every email different, so the whole card is always shown.
 */
const uniqueMarker = (ref, bg) =>
  `<span style="color:${bg};opacity:0;font-size:1px;line-height:1px;mso-hide:all" aria-hidden="true">${ref}</span>`;

function htmlEmail(subject, body, logo = null, ref = crypto.randomBytes(6).toString('hex')) {
  const s = settings.loadAll();
  const marker = uniqueMarker(ref, s.theme_midnight);
  const paragraphs = escapeHtml(body)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#e9b949">$1</a>')
    .split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.6">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const header = logo
    ? `<img src="cid:${LOGO_CID}" width="${logo.width}" height="${logo.height}" alt="${escapeHtml(s.company_name)}" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;width:${logo.width}px;height:${logo.height}px">
        <div style="font-size:20px;margin-top:12px">🎄🎁🎅</div>`
    : '<div style="font-size:34px">🎄🎁🎅</div>';
  return `<!doctype html><html><body style="margin:0;background:#06102a;font-family:Segoe UI,Arial,sans-serif;color:#f4f1ea">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06102a;padding:32px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${s.theme_midnight};border:1px solid rgba(233,185,73,.35);border-radius:18px;overflow:hidden">
      <tr><td style="background:linear-gradient(90deg,${s.theme_red},${s.theme_green});height:6px"></td></tr>
      <tr><td style="padding:28px 32px 8px;text-align:center">
        ${marker}${header}
        <div style="font-size:13px;letter-spacing:3px;color:${s.theme_gold};margin-top:8px;text-transform:uppercase">${escapeHtml(s.event_title)}</div>
        <h1 style="font-size:22px;margin:12px 0 0;color:#fff">${escapeHtml(subject)}</h1>
      </td></tr>
      <tr><td style="padding:20px 32px 8px;font-size:15px;color:#e8e4da">${paragraphs}</td></tr>
      <tr><td style="padding:8px 32px 28px;text-align:center;font-size:12px;color:#a9b3cc;font-style:italic">${escapeHtml(s.slogan)}${marker}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/** The HTML part + inline attachments for an email (exported for tests). */
function composeEmail(subject, text) {
  const logo = emailLogo();
  const ref = crypto.randomBytes(6).toString('hex');
  return {
    html: htmlEmail(subject, text, logo, ref),
    // A unique entity id also stops Gmail from bundling separate notifications into one thread
    headers: { 'X-Entity-Ref-ID': ref },
    attachments: logo
      ? [{ filename: 'logo.png', content: logo.content, contentType: 'image/png', cid: LOGO_CID, contentDisposition: 'inline' }]
      : [],
  };
}

async function sendMail(to, subject, text) {
  const s = settings.loadAll();
  if (!smtpConfigured(s)) return { status: 'not_configured' };
  try {
    await getTransport().sendMail({ from: s.smtp_from, to, subject, text, ...composeEmail(subject, text) });
    return { status: 'sent' };
  } catch (err) {
    console.error('[mail] send failed:', err.message);
    return { status: 'failed', error: String(err.message).slice(0, 300) };
  }
}

/**
 * Create an in-app notification from a template and (if SMTP is configured) email it.
 * Templates must never contain assignment or wish details – they go to inboxes.
 */
async function notify(employee, type, extraVars = {}) {
  const tpl = settings.getSetting('templates')[type];
  if (!tpl) throw new Error(`Unknown template ${type}`);
  const vars = baseVars(employee, extraVars);
  const title = render(tpl.subject, vars);
  const body = render(tpl.body, vars);
  const res = run(
    'INSERT INTO notifications (employee_id, type, title, body, email_status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    employee.id, type, title, body, 'pending', nowIso(),
  );
  const id = Number(res.lastInsertRowid);
  const result = await sendMail(employee.email, title, body);
  run('UPDATE notifications SET email_status = ?, email_error = ? WHERE id = ?', result.status, result.error || null, id);
  return { id, ...result };
}

/** Notify many employees sequentially in the background (gentle on SMTP rate limits). */
function notifyMany(employees, type, extraVars = {}) {
  const list = [...employees];
  (async () => {
    for (const emp of list) {
      try { await notify(emp, type, extraVars); } catch (err) { console.error('[notify]', err.message); }
    }
  })();
  return list.length;
}

/** OTP email – not stored as an in-app notification. Logged to console when SMTP is off (local dev). */
async function sendOtp(employee, code) {
  const tpl = settings.getSetting('templates').otp;
  const vars = baseVars(employee, { code });
  const subject = render(tpl.subject, vars);
  const body = render(tpl.body, vars);
  const result = await sendMail(employee.email, subject, body);
  if (result.status !== 'sent') {
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[otp] Could not email OTP to ${employee.email} (${result.status}).`);
    } else {
      console.log(`\n  ✉️  [DEV] OTP for ${employee.email}: ${code}  (email ${result.status})\n`);
    }
  }
  return result;
}

function listForEmployee(employeeId) {
  return all(
    'SELECT id, type, title, body, read_at, created_at FROM notifications WHERE employee_id = ? ORDER BY created_at DESC LIMIT 50',
    employeeId,
  );
}

function unreadCount(employeeId) {
  return get('SELECT COUNT(*) AS c FROM notifications WHERE employee_id = ? AND read_at IS NULL', employeeId).c;
}

module.exports = {
  notify, notifyMany, sendOtp, sendMail, composeEmail, smtpConfigured, listForEmployee, unreadCount, render, baseVars,
};
