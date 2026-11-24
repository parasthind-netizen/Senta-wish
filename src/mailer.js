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

/**
 * Slack / Teams style emoji codes (":santa:") become real emoji, so text pasted from chat looks right in
 * inboxes and in-app. Unknown codes are left as they are (the admin preview shows them).
 */
const EMOJI = {
  santa: '🎅', mrs_claus: '🤶', mx_claus: '🧑‍🎄', christmas_tree: '🎄', gift: '🎁', sparkles: '✨', sparkle: '❇️', star: '⭐',
  star2: '🌟', glowing_star: '🌟', dizzy: '💫', snowflake: '❄️', snowman: '⛄', snowman_with_snow: '☃️', bell: '🔔', bells: '🔔',
  ribbon: '🎀', tada: '🎉', party_popper: '🎉', confetti_ball: '🎊', balloon: '🎈', fireworks: '🎆', sparkler: '🎇', candle: '🕯️',
  deer: '🦌', elf: '🧝', cookie: '🍪', candy: '🍬', lollipop: '🍭', cake: '🍰', birthday: '🎂', coffee: '☕', champagne: '🍾',
  clinking_glasses: '🥂', trophy: '🏆', medal: '🏅', crown: '👑', shushing_face: '🤫', shush: '🤫', zipper_mouth_face: '🤐',
  smile: '😄', smiley: '😃', grinning: '😀', grin: '😁', blush: '😊', wink: '😉', joy: '😂', laughing: '😆', heart_eyes: '😍',
  star_struck: '🤩', partying_face: '🥳', hugging_face: '🤗', hugs: '🤗', thinking_face: '🤔', thinking: '🤔', sunglasses: '😎',
  innocent: '😇', relaxed: '☺️', slightly_smiling_face: '🙂', upside_down_face: '🙃', eyes: '👀', wave: '👋', clap: '👏',
  raised_hands: '🙌', pray: '🙏', muscle: '💪', ok_hand: '👌', thumbsup: '👍', '+1': '👍', point_right: '👉', point_down: '👇',
  heart: '❤️', red_heart: '❤️', hearts: '♥️', yellow_heart: '💛', green_heart: '💚', blue_heart: '💙', purple_heart: '💜',
  orange_heart: '🧡', white_heart: '🤍', two_hearts: '💕', sparkling_heart: '💖', heartpulse: '💗', gift_heart: '💝',
  fire: '🔥', '100': '💯', rocket: '🚀', zap: '⚡', boom: '💥', white_check_mark: '✅', heavy_check_mark: '✔️', x: '❌',
  warning: '⚠️', calendar: '📆', date: '📅', spiral_calendar_pad: '🗓️', alarm_clock: '⏰', hourglass: '⌛',
  hourglass_flowing_sand: '⏳', mega: '📣', loudspeaker: '📢', email: '📧', envelope: '✉️', incoming_envelope: '📨',
  memo: '📝', pencil: '📝', lock: '🔒', key: '🔑', shopping_bags: '🛍️', moneybag: '💰', speech_balloon: '💬', pushpin: '📌',
  round_pushpin: '📍', point_left: '👈', handshake: '🤝', rainbow: '🌈', sun_with_face: '🌞', crescent_moon: '🌙',
};
function emojify(text) {
  return String(text).replace(/:([a-z0-9_+-]+):/gi, (m, name) => EMOJI[name.toLowerCase()] || m);
}

/* ---------- "Fancy text" (𝓛𝓮𝓽, 𝐁𝐨𝐥𝐝, 𝘐𝘵𝘢𝘭𝘪𝘤 …) ----------
 * Font-generator websites don't change the font – they swap letters for Unicode maths symbols.
 * When HR writes a message like that, the rest of the email is written in the same style so every
 * line matches (or, with email_match_fancy off, those letters are turned back into normal ones). */
// First code point of A–Z a–z (52 letters) for each style, in Unicode order
const FANCY_STYLES = {
  bold: 0x1D400, italic: 0x1D434, boldItalic: 0x1D468, script: 0x1D49C, boldScript: 0x1D4D0, fraktur: 0x1D504,
  doubleStruck: 0x1D538, boldFraktur: 0x1D56C, sans: 0x1D5A0, sansBold: 0x1D5D4, sansItalic: 0x1D608,
  sansBoldItalic: 0x1D63C, monospace: 0x1D670,
};
const FANCY_ORDER = Object.keys(FANCY_STYLES);
const FANCY_DIGITS = { bold: 0x1D7CE, doubleStruck: 0x1D7D8, sans: 0x1D7E2, sansBold: 0x1D7EC, monospace: 0x1D7F6 };
// Letters some styles borrow from the "letterlike symbols" block
const FANCY_HOLES = {
  italic: { h: 'ℎ' },
  script: { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' },
  fraktur: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' },
  doubleStruck: { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' },
};
const HOLE_STYLE = new Map(Object.entries(FANCY_HOLES).flatMap(([st, m]) => Object.values(m).map((c) => [c, st])));

/** Fancy letters (maths letters, letterlike, full-width, circled) back to normal letters and digits. */
function plainLetters(text) {
  return String(text).replace(/[\u{1D400}-\u{1D7FF}ℂℊℋℌℍℎℐℑℒℓℕℙℚℛℜℝℤℨℬℭℯℰℱℳℴ\u{FF01}-\u{FF5E}\u{24B6}-\u{24E9}]/gu, (c) => c.normalize('NFKC'));
}

/** The fancy style most used in the text (e.g. 'boldScript'), or null if it is normal text. */
function fancyStyleOf(text) {
  const counts = {};
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    let st = null;
    if (cp >= 0x1D400 && cp < 0x1D400 + 52 * FANCY_ORDER.length) st = FANCY_ORDER[Math.floor((cp - 0x1D400) / 52)];
    else if (HOLE_STYLE.has(ch)) st = HOLE_STYLE.get(ch);
    if (st) counts[st] = (counts[st] || 0) + 1;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
  return n >= 6 ? best : null; // a couple of stray symbols are not a style
}

/** Write text in a fancy style. Links and email addresses stay normal so they still work. */
function toFancy(text, style) {
  const base = FANCY_STYLES[style];
  if (!base) return String(text);
  const holes = FANCY_HOLES[style] || {};
  const digits = FANCY_DIGITS[style];
  const convert = (part) => plainLetters(part).replace(/[A-Za-z0-9]/g, (c) => {
    if (holes[c]) return holes[c];
    const code = c.charCodeAt(0);
    if (code <= 57) return digits ? String.fromCodePoint(digits + code - 48) : c;
    return String.fromCodePoint(base + (code <= 90 ? code - 65 : 26 + code - 97));
  });
  return String(text).split(/(https?:\/\/\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/).map((p, i) => (i % 2 ? p : convert(p))).join('');
}

/**
 * Subject + body for a template. A custom message ({{message}}) may use the tags too
 * (e.g. "Hi {{first_name}}"), and emoji codes are converted.
 */
function renderTemplate(tpl, vars) {
  const v = { ...vars };
  if (typeof v.message === 'string') v.message = render(emojify(v.message), { ...v, message: '' });
  return { subject: emojify(render(tpl.subject, v)), body: emojify(render(tpl.body, v)) };
}

/** Tag values for test emails: the real settings (dates, budget, site link) plus a sample code and message. */
function sampleVars(person) {
  return baseVars(person, {
    code: '123456',
    message: 'This is a sample message from HR – the text you type when sending a custom reminder appears here.',
  });
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

/* ---------- Email look: logo colours, pine-branch corners ---------- */
const DECOR = { w: 120, h: 102 }; // display size of each corner branch (the PNGs are drawn at 2x)
const DECOR_DIR = path.join(__dirname, '..', 'public', 'img');
let decorCache = null;

/** The two corner branches as inline attachments: [{ side, cid, content }] (empty if the files are missing). */
function emailDecorations() {
  if (!decorCache) {
    try {
      decorCache = ['left', 'right'].map((side) => ({
        side, cid: `branch-${side}@techsara-secret-santa`, content: fs.readFileSync(path.join(DECOR_DIR, `email-branch-${side}.png`)),
      }));
    } catch { decorCache = []; }
  }
  return decorCache;
}

const SANS = "'Segoe UI',Arial,sans-serif";
// Email font choices: fonts already installed on almost every computer and phone, so Gmail / Outlook show them too
const EMAIL_FONTS = {
  segoe: SANS,
  georgia: "Georgia,'Times New Roman',serif",
  palatino: "'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif",
  trebuchet: "'Trebuchet MS','Segoe UI',Arial,sans-serif",
  verdana: 'Verdana,Geneva,sans-serif',
};

/** Darken (amount < 0) or lighten a #rrggbb colour. */
function shade(hex, amount) {
  const n = Number.parseInt(String(hex).slice(1), 16);
  const ch = (v) => Math.round(Math.min(255, Math.max(0, amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)));
  return `#${[n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`;
}

function htmlEmail(subject, body, logo = null, ref = crypto.randomBytes(6).toString('hex'), decor = []) {
  const s = settings.loadAll();
  // Fancy text in the message → heading, greeting, message and footer all in that style; otherwise plain letters.
  // The event title line ("TECHSARA SECRET SANTA 2026" between gold lines) always stays exactly as it is.
  let slogan = s.slogan;
  const style = s.email_match_fancy === false ? null : fancyStyleOf(body);
  if (style) [subject, body, slogan] = [subject, body, slogan].map((t) => toFancy(t, style));
  else [subject, body, slogan] = [subject, body, slogan].map(plainLetters);
  const card = s.email_card_color || '#262f7e';
  const bg = s.email_bg_color || '#151a4b';
  const gold = s.email_accent_color || '#e9b949';
  const font = EMAIL_FONTS[s.email_font] || SANS; // subject, message and footer (the event title keeps Segoe UI)
  const marker = uniqueMarker(ref, card);
  // Logo blue across the top half, fading a little lighter towards the bottom
  const cardBg = `background-color:${card};background-image:linear-gradient(180deg,${card} 0%,${card} 50%,${shade(card, 0.2)} 100%)`;

  const paragraphs = escapeHtml(body)
    .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${gold}">$1</a>`)
    .split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.6">${p.replace(/\n/g, '<br>')}</p>`).join('');

  const left = decor.find((d) => d.side === 'left');
  const right = decor.find((d) => d.side === 'right');
  const corner = (d, align) => `<td width="${d ? DECOR.w : 28}" valign="top" align="${align}" style="width:${d ? DECOR.w : 28}px;font-size:0;line-height:0">${d
    ? `<img src="cid:${d.cid}" width="${DECOR.w}" height="${DECOR.h}" alt="" style="display:block;border:0;width:${DECOR.w}px;height:${DECOR.h}px">` : ''}</td>`;
  // Just the logo; the emoji row is only a stand-in when no logo has been uploaded
  const center = logo
    ? `<img src="cid:${LOGO_CID}" width="${logo.width}" height="${logo.height}" alt="${escapeHtml(s.company_name)}" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;width:${logo.width}px;height:${logo.height}px">`
    : '<div style="font-size:34px">🎄🎁🎅</div>';
  const rule = `<td width="36" style="width:36px"><div style="height:1px;line-height:1px;font-size:0;background:${gold}">&nbsp;</div></td>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:${bg};font-family:${SANS};color:#f4f1ea">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};padding:32px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;${cardBg};border:2px solid ${gold};border-radius:18px;overflow:hidden">
      <tr><td style="background:linear-gradient(90deg,${s.theme_red},${s.theme_green});height:6px;font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${corner(left, 'left')}
        <td valign="top" align="center" style="padding:26px 0 0">${marker}${center}</td>
        ${corner(right, 'right')}
      </tr></table></td></tr>
      <tr><td align="center" style="padding:8px 24px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>${rule}
          <td align="center" style="padding:0 12px;font-family:${SANS};font-size:13px;letter-spacing:3px;color:${gold};text-transform:uppercase">${escapeHtml(s.event_title)}</td>${rule}
        </tr></table></td></tr>
      <tr><td align="center" style="padding:12px 32px 0">
        <h1 style="font-size:22px;margin:0;color:#fff;font-family:${font}">${escapeHtml(subject)}</h1></td></tr>
      <tr><td style="padding:20px 32px 8px;font-size:15px;color:#eef0fa;font-family:${font}">${paragraphs}</td></tr>
      <tr><td style="padding:8px 32px 28px;text-align:center;font-size:12px;color:#dde1f5;font-style:italic;font-family:${font}">${escapeHtml(slogan)}${marker}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

const decorFor = (s = settings.loadAll()) => (s.email_decorations === false ? [] : emailDecorations());

/** The HTML part + inline attachments for an email (exported for tests). */
function composeEmail(subject, text) {
  const logo = emailLogo();
  const decor = decorFor();
  const ref = crypto.randomBytes(6).toString('hex');
  return {
    html: htmlEmail(subject, text, logo, ref, decor),
    // A unique entity id also stops Gmail from bundling separate notifications into one thread
    headers: { 'X-Entity-Ref-ID': ref },
    attachments: [
      ...(logo ? [{ filename: 'logo.png', content: logo.content, contentType: 'image/png', cid: LOGO_CID, contentDisposition: 'inline' }] : []),
      ...decor.map((d) => ({ filename: `branch-${d.side}.png`, content: d.content, contentType: 'image/png', cid: d.cid, contentDisposition: 'inline' })),
    ],
  };
}

/** The email as the admin preview shows it: same HTML, with the inline images as data: URIs. */
function previewHtml(subject, text) {
  const logo = emailLogo();
  const decor = decorFor();
  let html = htmlEmail(subject, text, logo, undefined, decor);
  const images = [...(logo ? [{ cid: LOGO_CID, content: logo.content }] : []), ...decor];
  for (const img of images) html = html.split(`cid:${img.cid}`).join(`data:image/png;base64,${img.content.toString('base64')}`);
  return html;
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
  const { subject: title, body } = renderTemplate(tpl, baseVars(employee, extraVars));
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
  const { subject, body } = renderTemplate(tpl, baseVars(employee, { code }));
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
  notify, notifyMany, sendOtp, sendMail, composeEmail, sampleVars, renderTemplate, previewHtml, emojify, smtpConfigured, listForEmployee, unreadCount, render, baseVars,
};
