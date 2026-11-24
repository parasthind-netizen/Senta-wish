'use strict';
// Bulk email delivery against a fake SMTP server: steady pace, retries on "try again later",
// and "Resend failed" sending the same email again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'santa-delivery-'));
const { run, all, nowIso } = require('../src/db');
const settings = require('../src/settings');
const mailer = require('../src/mailer');

/* ---------- a tiny SMTP server that can refuse like Gmail does ---------- */
const smtp = { delivered: [], tempRefusals: 0, blocked: new Set() };
const server = net.createServer((sock) => {
  let data = false; let buf = ''; let rcpt = '';
  sock.write('220 fake ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') { data = false; smtp.delivered.push(rcpt); sock.write('250 OK\r\n'); }
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-fake\r\n250 8BITMIME\r\n');
      else if (cmd === 'MAIL') {
        if (smtp.tempRefusals > 0) { smtp.tempRefusals -= 1; sock.write('421 4.7.0 Try again later, closing connection.\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      } else if (cmd === 'RCPT') {
        rcpt = (line.match(/<([^>]+)>/) || [])[1] || '';
        sock.write(smtp.blocked.has(rcpt) ? '550 5.1.1 The email account that you tried to reach does not exist.\r\n' : '250 OK\r\n');
      } else if (cmd === 'DATA') { data = true; sock.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});

const employees = [];
const statusOf = (ids) => all(`SELECT email_status, email_error FROM notifications WHERE id IN (${ids.join(',')}) ORDER BY id`);
async function waitForQueue(ms = 15000) {
  const end = Date.now() + ms;
  while (mailer.queuedEmails() > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  assert.equal(mailer.queuedEmails(), 0, 'queue finished');
}
const lastIds = (n) => all('SELECT id FROM notifications ORDER BY id DESC LIMIT ?', n).map((r) => r.id).reverse();

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  settings.saveMany({ email_enabled: true, smtp_host: '127.0.0.1', smtp_port: server.address().port, smtp_user: '', smtp_from: 'Santa <santa@example.com>', email_per_minute: 120 });
  mailer.timing.retryWaitsMs = [50, 100];
  for (let i = 1; i <= 4; i += 1) {
    const r = run('INSERT INTO employees (employee_code, full_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', `D${i}`, `Person ${i}`, `p${i}@example.com`, nowIso(), nowIso());
    employees.push({ id: Number(r.lastInsertRowid), full_name: `Person ${i}`, email: `p${i}@example.com` });
  }
});

test.after(() => {
  mailer.closeTransport();
  server.close();
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* windows may hold the db */ }
});

test('Gmail-style "try again later" refusals are retried, so everyone still gets the email', async () => {
  smtp.delivered = [];
  smtp.tempRefusals = 2; // the first two attempts are refused
  assert.equal(mailer.notifyMany(employees, 'custom_reminder', { message: 'Hello elves' }), 4);
  const ids = lastIds(4);
  // in-app notifications exist straight away; emails follow at a steady pace
  assert.ok(statusOf(ids).every((r) => ['pending', 'sent'].includes(r.email_status)));
  await waitForQueue();
  assert.deepEqual(statusOf(ids).map((r) => r.email_status), ['sent', 'sent', 'sent', 'sent']);
  assert.equal(smtp.delivered.length, 4);
});

test('a permanent failure shows its reason, and "Resend failed" sends the same email again', async () => {
  smtp.delivered = [];
  smtp.blocked = new Set(['p2@example.com']);
  mailer.notifyMany(employees, 'custom_reminder', { message: 'Second note' });
  const ids = lastIds(4);
  await waitForQueue();
  const after = statusOf(ids);
  assert.equal(after[1].email_status, 'failed');
  assert.match(after[1].email_error, /does not exist/);
  assert.equal(after.filter((r) => r.email_status === 'sent').length, 3);

  smtp.blocked = new Set(); // e.g. the address was fixed / the server recovered
  smtp.delivered = [];
  const r = mailer.resendFailed();
  assert.equal(r.count, 1);
  await waitForQueue();
  assert.equal(statusOf([ids[1]])[0].email_status, 'sent');
  assert.equal(statusOf([ids[1]])[0].email_error, null);
  assert.deepEqual(smtp.delivered, ['p2@example.com'], 'only the failed person is emailed again');
  assert.equal(mailer.resendFailed().count, 0, 'nothing left to resend');
});

test('temporary vs permanent SMTP errors', () => {
  assert.equal(mailer.isTemporary({ responseCode: 421, message: 'Try again later' }), true);
  assert.equal(mailer.isTemporary({ responseCode: 454, message: '4.7.0 Too many login attempts' }), true);
  assert.equal(mailer.isTemporary({ code: 'ECONNECTION', message: 'Connection closed' }), true);
  assert.equal(mailer.isTemporary({ responseCode: 550, message: 'User unknown' }), false);
  assert.equal(mailer.isTemporary({ responseCode: 535, message: 'Username and Password not accepted' }), false);
  assert.equal(mailer.isTemporary({ responseCode: 550, message: '5.4.5 Daily user sending limit exceeded' }), false, 'retrying the daily limit would not help');
});
