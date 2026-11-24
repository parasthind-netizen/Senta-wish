'use strict';
// End-to-end: boots the real server on a throwaway database and walks the whole journey,
// checking the privacy rules from the outside.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'santa-e2e-'));
const ADMIN = { email: 'admin@example.com', password: 'Admin-pass1' };
let server;

class Client {
  constructor() { this.cookies = {}; this.csrf = null; }
  async req(method, url, body, { csrf = true, form } = {}) {
    const headers = { Origin: BASE };
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (csrf && this.csrf && method !== 'GET') headers['X-CSRF-Token'] = this.csrf;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (v) this.cookies[k] = v; else delete this.cookies[k];
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, raw: text };
  }
  get(u, o) { return this.req('GET', u, undefined, o); }
  post(u, b, o) { return this.req('POST', u, b, o); }
  put(u, b, o) { return this.req('PUT', u, b, o); }
  del(u, o) { return this.req('DELETE', u, undefined, o); }
}

const PEOPLE = Array.from({ length: 6 }, (_, i) => ({
  employee_code: `E${100 + i}`, full_name: `Person ${String.fromCharCode(65 + i)}`, email: `person${i}@example.com`, department: i % 2 ? 'Engineering' : 'HR',
  location: i < 3 ? (i === 1 ? ' NOIDA ' : 'Noida') : 'Ahmedabad', // two offices; spelling differences count as one
}));
const wishesFor = (p) => [1, 2, 3].map((n) => ({ name: `${p.employee_code}-gift-${n}`, description: `desc ${n}`, link: n === 1 ? 'example.com/item' : '', budget: '₹500' }));
const PNG = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000002000154A24F5D0000000049454E44AE426082', 'hex');

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATA_DIR, PORT: String(PORT), HOST: '127.0.0.1', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    server.stdout.on('data', (d) => { if (String(d).includes('is running')) { clearTimeout(t); resolve(); } });
    server.stderr.on('data', (d) => process.stderr.write(d));
  });
});

test.after(() => {
  server.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* windows may hold the file briefly */ }
});

test('full Secret Santa journey with privacy checks', async () => {
  const admin = new Client();
  const anon = new Client();

  // --- admin login + setup
  assert.equal((await admin.post('/api/admin/login', { email: ADMIN.email, password: 'wrong-pass1' })).status, 401);
  const login = await admin.post('/api/admin/login', ADMIN);
  assert.equal(login.status, 200);
  admin.csrf = login.data.csrf;
  assert.equal((await admin.put('/api/admin/settings', { require_email_otp_signup: false }, { csrf: false })).status, 403, 'CSRF must be enforced');
  assert.equal((await admin.put('/api/admin/settings', { require_email_otp_signup: false, allowed_email_domains: 'example.com', release_on_draw: false })).status, 200);

  // --- import
  const imp = await admin.post('/api/admin/employees/import', { rows: [...PEOPLE, { employee_code: 'BAD', full_name: 'Outsider', email: 'x@gmail.com' }] });
  assert.equal(imp.status, 200);
  assert.equal(imp.data.created, 6);
  assert.equal(imp.data.skipped, 1, 'foreign domain rejected');
  const emps = (await admin.get('/api/admin/employees')).data.employees;
  assert.equal(emps.length, 6);

  // --- test emails: sample tag values (employee's name when sending to their email) and template choice
  const sample = (await admin.get(`/api/admin/email/sample?to=${PEOPLE[2].email}`)).data.values;
  assert.equal(sample.full_name, 'Person C');
  assert.equal(sample.first_name, 'Person');
  assert.equal(sample.code, '123456');
  assert.ok(sample.budget && sample.event_title && 'message' in sample);
  assert.ok((await admin.get('/api/admin/email/sample')).data.values.full_name, 'falls back to the admin name');
  assert.equal((await anon.get('/api/admin/email/sample')).status, 401);
  const badTpl = await admin.post('/api/admin/email/test', { template: 'nope' });
  assert.equal(badTpl.status, 400);
  assert.match(badTpl.data.error, /Unknown email template/);
  const noSmtp = await admin.post('/api/admin/email/test', { template: 'all' });
  assert.equal(noSmtp.status, 400);
  assert.match(noSmtp.data.error, /not configured/);

  // --- unauthenticated access is refused
  assert.equal((await anon.get('/api/me')).status, 401);
  assert.equal((await anon.get('/api/admin/employees')).status, 401);
  assert.equal((await anon.get('/api/assignment')).status, 401);

  // --- a one-time code request says why no code is coming, instead of a silent "on its way"
  assert.equal((await anon.post('/api/auth/otp/request', { identifier: 'nobody@example.com' })).status, 404);
  const notActivated = await anon.post('/api/auth/otp/request', { identifier: PEOPLE[0].email });
  assert.equal(notActivated.status, 400);
  assert.match(notActivated.data.error, /not activated/);
  assert.equal((await anon.post('/api/auth/password/forgot', { identifier: PEOPLE[0].email })).status, 400);

  // --- employees activate, register and add wishes
  // Optional Employee ID check at sign-up (off by default)
  assert.equal((await admin.put('/api/admin/settings', { signup_require_employee_id: true })).status, 200);
  assert.equal((await anon.post('/api/auth/signup/complete', { email: PEOPLE[0].email, employeeCode: 'WRONG', password: 'Secret-123' })).status, 404);
  assert.equal((await anon.post('/api/auth/signup/complete', { email: PEOPLE[0].email, password: 'Secret-123' })).status, 400);
  assert.equal((await admin.put('/api/admin/settings', { signup_require_employee_id: false })).status, 200);

  const clients = {};
  for (const p of PEOPLE) {
    const c = new Client();
    // One-step sign-up: official email + password only
    assert.equal((await c.post('/api/auth/signup/complete', { email: 'nobody@example.com', password: 'Secret-123' })).status, 404, 'not in directory');
    assert.equal((await c.post('/api/auth/signup/complete', { email: p.email, password: 'short' })).status, 400, 'weak password');
    assert.equal((await c.post('/api/auth/signup/complete', { email: p.email.toUpperCase(), password: 'Secret-123' })).status, 200);
    assert.equal((await c.post('/api/auth/signup/complete', { email: p.email, password: 'Other-456' })).status, 409, 'one account only – cannot be re-claimed');
    c.csrf = (await c.get('/api/session')).data.csrf;
    assert.equal((await c.put('/api/wishes', { wishes: wishesFor(p) })).status, 403, 'must register before wishing');
    assert.equal((await c.post('/api/registration', { agree: true })).status, 200);
    assert.equal((await c.post('/api/registration', { agree: true })).status, 409, 'one registration only');
    assert.equal((await c.put('/api/wishes', { wishes: wishesFor(p) })).status, 200);
    clients[p.employee_code] = c;
  }
  // login with Employee ID works too
  const relog = new Client();
  assert.equal((await relog.post('/api/auth/login', { identifier: 'E100', password: 'Secret-123' })).status, 200);
  // activated account: the code is sent (printed to the console here, since tests have no SMTP)
  const otpReq = await new Client().post('/api/auth/otp/request', { identifier: PEOPLE[1].email });
  assert.equal(otpReq.status, 200, JSON.stringify(otpReq.data));

  // --- admin never receives wish content
  const adminView = await admin.get('/api/admin/employees');
  assert.ok(!adminView.raw.includes('gift-1'), 'admin employee list must not contain wishes');
  assert.ok(adminView.data.employees.every((e) => e.wishCount === 3));

  // --- location-wise draw (on by default): the admin sees the groups, and a 1-person location blocks the draw
  let preview = (await admin.get('/api/admin/draw')).data.preview;
  assert.equal(preview.byLocation, true);
  assert.deepEqual(preview.locations, [{ name: 'Ahmedabad', count: 3 }, { name: 'Noida', count: 3 }]);
  assert.deepEqual(preview.problems, []);
  const e105 = emps.find((e) => e.employeeCode === 'E105');
  assert.equal((await admin.put(`/api/admin/employees/${e105.id}`, { location: 'Jaipur' })).status, 200);
  preview = (await admin.get('/api/admin/draw')).data.preview;
  assert.equal(preview.problems.length, 1);
  const blocked = await admin.post('/api/admin/draw/run', { confirm: 'DRAW' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /"Jaipur" has only 1 participant/);
  assert.equal((await admin.put(`/api/admin/employees/${e105.id}`, { location: 'Ahmedabad' })).status, 200);

  // --- draw
  assert.equal((await admin.post('/api/admin/draw/run', { confirm: 'nope' })).status, 400);
  const draw = await admin.post('/api/admin/draw/run', { confirm: 'DRAW' });
  assert.equal(draw.status, 200, JSON.stringify(draw.data));
  assert.equal(draw.data.participants, 6);
  assert.equal((await admin.post('/api/admin/draw/run', { confirm: 'DRAW' })).status, 409, 'draw is final');

  // wishes are locked, boxes sealed until release
  const c0 = clients.E100;
  assert.equal((await c0.put('/api/wishes', { wishes: wishesFor(PEOPLE[0]) })).status, 409);
  assert.equal((await c0.get('/api/assignment')).data.state, 'locked');
  assert.equal((await c0.post('/api/assignment/reveal')).status, 409);
  assert.equal((await admin.post('/api/admin/draw/release')).status, 200);

  // --- reveal: valid derangement, recipient wishes match
  const pairs = new Map();
  for (const p of PEOPLE) {
    const c = clients[p.employee_code];
    assert.equal((await c.get('/api/assignment')).data.state, 'ready');
    const r = await c.post('/api/assignment/reveal');
    assert.equal(r.status, 200);
    const recipient = PEOPLE.find((x) => x.full_name === r.data.recipient.fullName);
    assert.ok(recipient && recipient !== p, 'nobody draws themselves');
    assert.equal(r.data.recipient.location.trim().toLowerCase(), p.location.trim().toLowerCase(), 'matched within the same location only');
    assert.deepEqual(r.data.recipient.wishes.map((w) => w.name), wishesFor(recipient).map((w) => w.name));
    assert.equal(r.data.recipient.wishes[0].link, 'https://example.com/item');
    assert.ok(!('id' in r.data.recipient) && !('email' in r.data.recipient));
    pairs.set(p.employee_code, recipient.employee_code);
    // no endpoint tells me who my own Santa is
    const me = await c.get('/api/me');
    for (const other of PEOPLE) {
      if (other === p || other.employee_code === pairs.get(p.employee_code)) continue;
      assert.ok(!me.raw.includes(other.full_name), 'dashboard must not leak other people');
    }
  }
  assert.equal(new Set(pairs.values()).size, 6, 'everyone receives exactly once');

  // --- admin cannot see assignments without an override
  assert.equal((await admin.get('/api/admin/override/assignments')).status, 403);
  assert.equal((await admin.post('/api/admin/override', { reason: 'Testing the emergency override path', password: 'bad-pass-1' })).status, 401);
  assert.equal((await admin.post('/api/admin/override', { reason: 'Testing the emergency override path', password: ADMIN.password })).status, 200);
  const ov = await admin.get('/api/admin/override/assignments');
  assert.equal(ov.status, 200);
  for (const row of ov.data.assignments) assert.equal(pairs.get(row.giver.code), row.receiver.code);
  await admin.post('/api/admin/override/end');
  assert.equal((await admin.get('/api/admin/override/assignments')).status, 403);
  const audit = await admin.get('/api/admin/audit');
  assert.ok(audit.data.logs.some((l) => l.action === 'override.viewed_assignments'));
  assert.ok(!audit.raw.includes('gift-1'), 'audit never contains wishes');

  // --- photo privacy: only self, the Santa who unwrapped them, or admins
  const target = PEOPLE[0];
  const fd = new FormData();
  fd.append('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
  const up = await clients[target.employee_code].post('/api/me/photo', undefined, { form: fd });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const santaCode = [...pairs.entries()].find(([, r]) => r === target.employee_code)[0];
  const stranger = PEOPLE.find((p) => p.employee_code !== santaCode && p !== target);
  assert.equal((await clients[santaCode].get(up.data.photo)).status, 200);
  assert.equal((await clients[stranger.employee_code].get(up.data.photo)).status, 404);
  assert.equal((await anon.get(up.data.photo)).status, 404);
  assert.equal((await admin.get(up.data.photo)).status, 200);

  // fake image rejected
  const bad = new FormData();
  bad.append('photo', new Blob(['<svg onload=alert(1)>'], { type: 'image/svg+xml' }), 'x.svg');
  assert.equal((await clients.E101.post('/api/me/photo', undefined, { form: bad })).status, 400);

  // --- logo upload also stores the small email copy; removing the logo removes both
  const logoFd = new FormData();
  logoFd.append('image', new Blob([PNG], { type: 'image/png' }), 'logo.png');
  logoFd.append('email_image', new Blob([PNG], { type: 'image/png' }), 'logo-email.png');
  assert.equal((await admin.post('/api/admin/branding/logo', undefined, { form: logoFd })).status, 200);
  let brand = (await admin.get('/api/admin/settings')).data.settings;
  assert.match(brand.logo, /^\/uploads\/logo-/);
  assert.match(brand.logo_email, /^\/uploads\/logomail-/);
  assert.equal((await anon.get(brand.logo_email)).status, 200);
  assert.equal((await admin.del('/api/admin/branding/logo')).status, 200);
  brand = (await admin.get('/api/admin/settings')).data.settings;
  assert.equal(brand.logo, null);
  assert.equal(brand.logo_email, null);

  // --- background music: admin-only upload, audio validated by content, playlist order, public config
  const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0, 0, 0, 0, 0]), Buffer.alloc(64)]);
  const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64)]);
  const song = (buf, name, title) => {
    const f = new FormData();
    if (title) f.append('title', title);
    f.append('audio', new Blob([buf], { type: 'audio/mpeg' }), name);
    return f;
  };
  assert.equal((await anon.post('/api/admin/music', undefined, { form: song(MP3, 'a.mp3', 'Jingle') })).status, 401);
  assert.equal((await admin.post('/api/admin/music', undefined, { form: song(PNG, 'fake.mp3', 'Fake') })).status, 400, 'non-audio rejected');
  const s1 = await admin.post('/api/admin/music', undefined, { form: song(MP3, 'jingle.mp3', 'Jingle Bells 🎄') });
  assert.equal(s1.status, 200, JSON.stringify(s1.data));
  assert.match(s1.data.url, /^\/uploads\/music-[\w-]+\.mp3$/);
  const s2 = await admin.post('/api/admin/music', undefined, { form: song(OGG, 'carol.ogg') });
  assert.equal(s2.status, 200);
  let cfgMusic = (await anon.get('/api/public/config')).data.music;
  assert.deepEqual(cfgMusic.map((t) => t.title), ['Jingle Bells 🎄', 'Track 2']);
  assert.equal((await anon.get(cfgMusic[0].url)).status, 200);
  assert.equal((await admin.put('/api/admin/music/order', { ids: [s2.data.id] })).status, 400, 'order must list every track');
  assert.equal((await admin.put('/api/admin/music/order', { ids: [s2.data.id, s1.data.id] })).status, 200);
  assert.equal((await admin.put(`/api/admin/music/${s2.data.id}`, { title: 'Silent Night' })).status, 200);
  cfgMusic = (await anon.get('/api/public/config')).data.music;
  assert.deepEqual(cfgMusic.map((t) => t.title), ['Silent Night', 'Jingle Bells 🎄']);
  assert.equal((await admin.put('/api/admin/settings', { music_volume: 0 })).status, 400);
  assert.equal((await admin.put('/api/admin/settings', { music_volume: 40, music_shuffle: true })).status, 200);
  assert.equal((await anon.get('/api/public/config')).data.settings.music_volume, 40);
  assert.equal((await admin.del(`/api/admin/music/${s1.data.id}`)).status, 200);
  let goneStatus = 0; // the file is removed asynchronously right after the response
  for (let i = 0; i < 20 && goneStatus !== 404; i += 1) {
    goneStatus = (await anon.get(cfgMusic[1].url)).status;
    if (goneStatus !== 404) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(goneStatus, 404, 'deleted file is gone');
  assert.equal((await anon.get('/api/public/config')).data.music.length, 1);

  // --- data at rest is encrypted
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(DATA_DIR, 'santa.db'), { readOnly: true });
  const wl = db.prepare('SELECT payload_enc FROM wishlists').all();
  assert.ok(wl.every((r) => !r.payload_enc.includes('gift')));
  const asg = db.prepare('SELECT receiver_enc FROM assignments').all();
  assert.ok(asg.every((r) => !/"r"\s*:/.test(r.receiver_enc)));
  db.close();

  // --- reset needs reason + password + RESET
  assert.equal((await admin.post('/api/admin/draw/reset', { confirm: 'RESET', reason: 'short', password: ADMIN.password })).status, 400);
  assert.equal((await admin.post('/api/admin/draw/reset', { confirm: 'RESET', reason: 'E103 left the company before Christmas', password: ADMIN.password })).status, 200);
  assert.equal((await c0.get('/api/assignment')).data.state, 'pending');
});
