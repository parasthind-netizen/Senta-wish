'use strict';
// Creates the first super admin on first start.
const { get, run, nowIso } = require('./db');
const { hashPassword, randomToken } = require('./security');

async function ensureAdmin() {
  if (get('SELECT id FROM admins LIMIT 1')) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@techsarasolutions.com').toLowerCase();
  const name = process.env.ADMIN_NAME || 'HR Admin';
  const fromEnv = Boolean(process.env.ADMIN_PASSWORD);
  const password = process.env.ADMIN_PASSWORD || `Santa-${randomToken(9)}`;
  run('INSERT INTO admins (email, name, password_hash, role, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    email, name, await hashPassword(password), 'super_admin', fromEnv ? 0 : 1, nowIso());
  const line = '═'.repeat(64);
  console.log(`\n${line}\n  🎅  First super admin created\n      Admin URL : /admin\n      Email     : ${email}\n` +
    (fromEnv ? '      Password  : (from ADMIN_PASSWORD in .env)\n' : `      Password  : ${password}\n      → You'll be asked to change it after signing in.\n`) +
    `${line}\n`);
}

module.exports = { ensureAdmin };
