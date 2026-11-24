'use strict';
/*
 * Create (or reset the password of) an admin account.
 *   npm run create-admin -- --email hr@techsarasolutions.com --name "Priya (HR)" --password "S3cret-pass" [--role super_admin|hr_admin]
 */
const { get, run, nowIso } = require('../src/db');
const { hashPassword, passwordProblem } = require('../src/security');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

(async () => {
  const email = String(arg('email') || '').toLowerCase().trim();
  const name = arg('name') || 'HR Admin';
  const password = arg('password');
  const role = arg('role') === 'hr_admin' ? 'hr_admin' : 'super_admin';
  if (!email || !password) {
    console.log('Usage: npm run create-admin -- --email you@company.com --name "Your Name" --password "Strong-pass1" [--role super_admin|hr_admin]');
    process.exit(1);
  }
  const problem = passwordProblem(password);
  if (problem) { console.error(problem); process.exit(1); }
  const hash = await hashPassword(password);
  const existing = get('SELECT id FROM admins WHERE email = ?', email);
  if (existing) {
    run('UPDATE admins SET password_hash = ?, role = ?, active = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?', hash, role, existing.id);
    console.log(`✔ Updated admin ${email} (${role}).`);
  } else {
    run('INSERT INTO admins (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', email, name, hash, role, nowIso());
    console.log(`✔ Created admin ${email} (${role}).`);
  }
})();
