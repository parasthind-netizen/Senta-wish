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

// Valid PNG header (IHDR) for a w×h image – the mailer only reads the size
function pngOf(w, h, extraBytes = 0) {
  const buf = Buffer.alloc(33 + extraBytes);
  Buffer.from('89504E470D0A1A0A0000000D49484452', 'hex').copy(buf, 0);
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

test('no logo → emoji header and no attachments', () => {
  const mail = mailer.composeEmail('Hello', 'Body text');
  assert.deepEqual(mail.attachments, []);
  assert.ok(!mail.html.includes('cid:'));
  assert.ok(mail.html.includes('🎄🎁🎅'));
});

test('email copy of the logo is embedded inline and scaled to fit', () => {
  fs.writeFileSync(path.join(PUBLIC_UPLOAD_DIR, 'logomail-abc.png'), pngOf(168, 168));
  settings.setInternal('logo', '/uploads/logo-big.png'); // original not needed when the email copy exists
  settings.setInternal('logo_email', '/uploads/logomail-abc.png');
  const mail = mailer.composeEmail('Hello', 'Body text');
  assert.equal(mail.attachments.length, 1);
  const [att] = mail.attachments;
  assert.equal(att.contentType, 'image/png');
  assert.ok(mail.html.includes(`src="cid:${att.cid}"`));
  assert.ok(mail.html.includes('width="84" height="84"'));
});

test('falls back to a small original PNG, but never embeds a huge one', () => {
  settings.setInternal('logo_email', null);
  fs.writeFileSync(path.join(PUBLIC_UPLOAD_DIR, 'logo-small.png'), pngOf(400, 100));
  settings.setInternal('logo', '/uploads/logo-small.png');
  const small = mailer.composeEmail('Hello', 'Body');
  assert.equal(small.attachments.length, 1);
  assert.ok(small.html.includes('width="260" height="65"'));

  fs.writeFileSync(path.join(PUBLIC_UPLOAD_DIR, 'logo-huge.png'), pngOf(1254, 1254, 1024 * 1024));
  settings.setInternal('logo', '/uploads/logo-huge.png');
  assert.deepEqual(mailer.composeEmail('Hello', 'Body').attachments, []);
});

test('ignores paths that are not plain upload file names', () => {
  settings.setInternal('logo_email', '/uploads/../secret.key');
  settings.setInternal('logo', null);
  assert.deepEqual(mailer.composeEmail('Hello', 'Body').attachments, []);
});

test.after(() => {
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* windows may hold the db */ }
});
