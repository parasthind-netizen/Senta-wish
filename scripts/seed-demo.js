'use strict';
/*
 * LOCAL TESTING ONLY – fills the database with demo employees so you can try the full flow.
 *   npm run seed-demo            → 170 employees, most registered with wishes
 *   npm run seed-demo -- 40      → 40 employees
 * Every demo account uses the password  Santa@2026
 * Refuses to run when NODE_ENV=production.
 */
const { get, run, tx, nowIso } = require('../src/db');
const { hashPassword, encrypt } = require('../src/security');
const settings = require('../src/settings');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const FIRST = ['Aarav', 'Diya', 'Vivaan', 'Ananya', 'Aditya', 'Ishita', 'Kabir', 'Meera', 'Rohan', 'Saanvi', 'Arjun', 'Kavya', 'Reyansh', 'Myra', 'Vihaan',
  'Anika', 'Krish', 'Riya', 'Dhruv', 'Tara', 'Ayaan', 'Nisha', 'Yash', 'Pooja', 'Kunal', 'Sneha', 'Harsh', 'Priya', 'Neel', 'Aditi'];
const LAST = ['Shah', 'Patel', 'Mehta', 'Desai', 'Joshi', 'Sharma', 'Iyer', 'Nair', 'Kapoor', 'Reddy', 'Gupta', 'Trivedi', 'Pandya', 'Bhatt', 'Rao', 'Verma'];
const DEPTS = [['Engineering', 'Software Engineer'], ['Engineering', 'QA Engineer'], ['Design', 'UI/UX Designer'], ['Human Resources', 'HR Executive'],
  ['Sales', 'Account Manager'], ['Marketing', 'Content Strategist'], ['Finance', 'Accountant'], ['Operations', 'Project Manager'], ['Support', 'Support Specialist']];
const GIFTS = [
  ['Wireless headphones', 'Over-ear, any colour except white', 'https://www.amazon.in/', '₹800–1000'],
  ['Perfume', 'Something fresh and citrusy', '', '₹600–900'],
  ['Cute coffee mug', 'Big enough for a proper chai!', '', '₹300–500'],
  ['Desk plant', 'Low-maintenance succulent', '', '₹400'],
  ['Scented candle set', 'Vanilla or sandalwood', '', '₹500–700'],
  ['Notebook & pen set', 'Dotted pages please', '', '₹500'],
  ['Board game', 'Something quick for game nights', '', '₹900'],
  ['Chocolate hamper', 'Dark chocolate lover', '', '₹600'],
  ['Bluetooth speaker', 'Small and portable', '', '₹1000'],
];

(async () => {
  const count = Math.max(3, Math.min(1000, Number(process.argv[2]) || 170));
  const domain = settings.allowedDomains()[0] || 'techsarasolutions.com';
  const hash = await hashPassword('Santa@2026');
  let created = 0;
  tx(() => {
    for (let i = 1; i <= count; i += 1) {
      const code = `TS${String(1000 + i)}`;
      if (get('SELECT 1 FROM employees WHERE employee_code = ?', code)) continue;
      const first = FIRST[i % FIRST.length];
      const last = LAST[(i * 7) % LAST.length];
      const [dept, title] = DEPTS[i % DEPTS.length];
      const now = nowIso();
      const r = run(`INSERT INTO employees (employee_code, full_name, email, department, designation, location, active, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`, code, `${first} ${last}`, `${first}.${last}${i}@${domain}`.toLowerCase(), dept, title, 'Ahmedabad', now, now);
      const id = Number(r.lastInsertRowid);
      created += 1;
      if (i % 12 === 0) continue; // ~8% never activate
      run('INSERT INTO employee_auth (employee_id, password_hash, created_at) VALUES (?, ?, ?)', id, hash, now);
      if (i % 10 === 0) continue; // some activate but don't join
      run('INSERT INTO registrations (employee_id, agreed_rules, registered_at) VALUES (?, 1, ?)', id, now);
      if (i % 9 === 0) continue; // some join but haven't added wishes
      const wishes = [0, 1, 2].map((k) => {
        const g = GIFTS[(i + k * 3) % GIFTS.length];
        return { name: g[0], description: g[1], link: g[2], budget: g[3] };
      });
      const n = i % 15 === 0 ? 2 : 3; // a few incomplete lists
      run('INSERT INTO wishlists (employee_id, payload_enc, wish_count, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        id, encrypt(wishes.map((w, k) => (k < n ? w : { name: '', description: '', link: '', budget: '' }))), n, now, now);
    }
  });
  const sample = get("SELECT email, employee_code FROM employees e JOIN registrations r ON r.employee_id = e.id ORDER BY e.id LIMIT 1");
  console.log(`✔ Seeded ${created} demo employees (domain @${domain}).`);
  if (sample) console.log(`  Try signing in as ${sample.email} (or ${sample.employee_code}) with password  Santa@2026`);
})();
