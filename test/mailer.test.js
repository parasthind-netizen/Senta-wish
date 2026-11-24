'use strict';
// Email layout: the company logo is embedded inline (cid:) so it shows even when the site is LAN-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'santa-mail-'));
const { PUBLIC_UPLOAD_DIR } = require('../src/db');
const settings = require('../src/settings');
const mailer = require('../src/mailer');

const logoOf = (mail) => mail.attachments.filter((a) => a.filename === 'logo.png');

// Valid PNG header (IHDR) for a w×h image – the mailer only reads the size
function pngOf(w, h, extraBytes = 0) {
  const buf = Buffer.alloc(33 + extraBytes);
  Buffer.from('89504E470D0A1A0A0000000D49484452', 'hex').copy(buf, 0);
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

test('no logo → emoji header and no logo attachment', () => {
  const mail = mailer.composeEmail('Hello', 'Body text');
  assert.deepEqual(logoOf(mail), []);
  assert.ok(!mail.html.includes('cid:logo@'));
  assert.ok(mail.html.includes('🎄🎁🎅'));
});

test('every email is unique, so Gmail never hides repeated parts behind "•••"', () => {
  const a = mailer.composeEmail('Reminder', 'Same text');
  const b = mailer.composeEmail('Reminder', 'Same text');
  assert.notEqual(a.html, b.html);
  assert.match(a.headers['X-Entity-Ref-ID'], /^[0-9a-f]{12}$/);
  assert.notEqual(a.headers['X-Entity-Ref-ID'], b.headers['X-Entity-Ref-ID']);
  // the marker sits in the header and the footer, and is invisible
  assert.equal(a.html.split(a.headers['X-Entity-Ref-ID']).length - 1, 2);
  assert.match(a.html, /opacity:0;font-size:1px[^>]*>[0-9a-f]{12}<\/span>/);
});

test('email copy of the logo is embedded inline and scaled to fit', () => {
  fs.writeFileSync(path.join(PUBLIC_UPLOAD_DIR, 'logomail-abc.png'), pngOf(168, 168));
  settings.setInternal('logo', '/uploads/logo-big.png'); // original not needed when the email copy exists
  settings.setInternal('logo_email', '/uploads/logomail-abc.png');
  const mail = mailer.composeEmail('Hello', 'Body text');
  assert.equal(logoOf(mail).length, 1);
  const [att] = logoOf(mail);
  assert.equal(att.contentType, 'image/png');
  assert.ok(mail.html.includes(`src="cid:${att.cid}"`));
  assert.ok(mail.html.includes('width="84" height="84"'));
  assert.ok(!mail.html.includes('🎄🎁🎅'), 'no emoji row under the logo');
});

test('falls back to a small original PNG, but never embeds a huge one', () => {
  settings.setInternal('logo_email', null);
  fs.writeFileSync(path.join(PUBLIC_UPLOAD_DIR, 'logo-small.png'), pngOf(400, 100));
  settings.setInternal('logo', '/uploads/logo-small.png');
  const small = mailer.composeEmail('Hello', 'Body');
  assert.equal(logoOf(small).length, 1);
  assert.ok(small.html.includes('width="260" height="65"'));

  fs.writeFileSync(path.join(PUBLIC_UPLOAD_DIR, 'logo-huge.png'), pngOf(1254, 1254, 1024 * 1024));
  settings.setInternal('logo', '/uploads/logo-huge.png');
  assert.deepEqual(logoOf(mailer.composeEmail('Hello', 'Body')), []);
});

test('ignores paths that are not plain upload file names', () => {
  settings.setInternal('logo_email', '/uploads/../secret.key');
  settings.setInternal('logo', null);
  assert.deepEqual(logoOf(mailer.composeEmail('Hello', 'Body')), []);
});

test('Slack-style emoji codes become real emoji; unknown codes and times are left alone', () => {
  assert.equal(mailer.emojify(':santa::christmas_tree: HO HO HO :gift::sparkles: :heart: :shushing_face:'), '🎅🎄 HO HO HO 🎁✨ ❤️ 🤫');
  assert.equal(mailer.emojify('Meet at 4:00 pm :not_a_real_emoji:'), 'Meet at 4:00 pm :not_a_real_emoji:');
});

test('a custom message can use tags and emoji codes', () => {
  const tpl = { subject: 'A note – {{event_title}} :gift:', body: 'Hi {{first_name}},\n\n{{message}}\n\n{{site_url}}/app' };
  const vars = mailer.baseVars({ full_name: 'Riya Sharma' }, { message: 'Dear {{full_name}} :santa: – budget {{budget}} {{message}}' });
  const { subject, body } = mailer.renderTemplate(tpl, vars);
  assert.match(subject, /🎁$/);
  assert.match(body, /^Hi Riya,\n\nDear Riya Sharma 🎅 – budget ₹500 – ₹1,000 \n\n/);
  assert.ok(!body.includes('{{'));
});

// The event title between the gold lines must always look exactly like this
const EVENT_TITLE_CELL = 'letter-spacing:3px;color:#e9b949;text-transform:uppercase">TECHSARA SECRET SANTA 2026</td>';

test('fancy text in the message → the whole email follows that style (links and the event title stay normal)', () => {
  const body = 'Hi Riya,\n\n𝓛𝓮𝓽 𝓽𝓱𝓮 𝓢𝓮𝓬𝓻𝓮𝓽 𝓢𝓪𝓷𝓽𝓪 𝓶𝓪𝓰𝓲𝓬 𝓫𝓮𝓰𝓲𝓷!\nSpread joy.\n\nhttps://santa.example.com/app';
  const { html } = mailer.composeEmail('A note', body);
  assert.ok(html.includes('𝓗𝓲 𝓡𝓲𝔂𝓪,'), 'greeting in the same bold script');
  assert.ok(html.includes('𝓢𝓹𝓻𝓮𝓪𝓭 𝓳𝓸𝔂.'), 'other lines too');
  assert.ok(html.includes('>𝓐 𝓷𝓸𝓽𝓮</h1>'), 'heading too');
  assert.ok(html.includes('href="https://santa.example.com/app"') && html.includes('>https://santa.example.com/app</a>'), 'link still works');
  assert.ok(html.includes(EVENT_TITLE_CELL), 'event title unchanged');

  // switched off: fancy letters go back to normal ones, so every line still matches
  settings.saveMany({ email_match_fancy: false });
  const off = mailer.composeEmail('A note', body).html;
  assert.ok(off.includes('Let the Secret Santa magic begin!') && off.includes('Hi Riya,'));
  assert.ok(off.includes(EVENT_TITLE_CELL));
  settings.saveMany({ email_match_fancy: true });

  // normal text is left alone, including ₹, emoji, curly quotes and Hindi
  const normal = 'Normal text, ₹500 – ₹1,000 … 🎅 “quotes” café हिंदी';
  const plain = mailer.composeEmail('Hello', normal).html;
  assert.ok(plain.includes('Normal text, ₹500 – ₹1,000 … 🎅 “quotes” café हिंदी') && plain.includes(EVENT_TITLE_CELL));
});

test('other fancy styles are matched too (bold, with bold digits)', () => {
  const { html } = mailer.composeEmail('Hi', 'Dear team,\n\n𝐒𝐞𝐜𝐫𝐞𝐭 𝐒𝐚𝐧𝐭𝐚 𝟐𝟎𝟐𝟔 𝐢𝐬 𝐡𝐞𝐫𝐞');
  assert.ok(html.includes('𝐃𝐞𝐚𝐫 𝐭𝐞𝐚𝐦,'));
  assert.ok(html.includes(EVENT_TITLE_CELL));
});

test('the admin preview shows the logo as a data: image (no cid:)', () => {
  fs.writeFileSync(path.join(PUBLIC_UPLOAD_DIR, 'logomail-prev.png'), pngOf(168, 168));
  settings.setInternal('logo_email', '/uploads/logomail-prev.png');
  const html = mailer.previewHtml('Hello', 'Body');
  assert.ok(!html.includes('cid:'));
  assert.ok(html.includes('src="data:image/png;base64,'));
});

test('email look: logo colours, bottom fade, plain heading font, corner branches (can be turned off)', () => {
  const mail = mailer.composeEmail('Your wishes are tucked in 🎁', 'Hi Riya,\n\nYour wishes are safe.');
  const branches = mail.attachments.filter((a) => a.filename.startsWith('branch-'));
  assert.equal(branches.length, 2);
  for (const b of branches) {
    assert.equal(b.contentDisposition, 'inline');
    assert.ok(mail.html.includes(`src="cid:${b.cid}"`));
  }
  assert.ok(mail.html.includes('#262f7e') && mail.html.includes('#e9b949'), 'logo blue + gold by default');
  assert.ok(mail.html.includes('linear-gradient(180deg,#262f7e 0%,#262f7e 50%,'), 'blue top half, fading towards the bottom');
  assert.match(mail.html, /<h1 style="font-size:22px[^"]*'Segoe UI'[^"]*">Your wishes are tucked in 🎁<\/h1>/);
  assert.ok(!mail.html.includes('Great Vibes') && !mail.html.includes('fonts.googleapis'), 'original fonts, no web fonts');

  assert.ok(mail.html.includes("<h1 style=\"font-size:22px;margin:0;color:#fff;font-family:'Segoe UI'"), 'Segoe UI by default');
  settings.saveMany({ email_decorations: false, email_card_color: '#112233', email_font: 'georgia' });
  const plain = mailer.composeEmail('Hello', 'Body');
  assert.equal(plain.attachments.filter((a) => a.filename.startsWith('branch-')).length, 0);
  assert.ok(plain.html.includes('#112233'));
  assert.ok(plain.html.includes("font-family:Georgia,'Times New Roman',serif"), 'chosen font used');
  settings.saveMany({ email_decorations: true, email_card_color: '#262f7e', email_font: 'segoe' });
});

test.after(() => {
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* windows may hold the db */ }
});
