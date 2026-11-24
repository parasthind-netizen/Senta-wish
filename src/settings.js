'use strict';
// Every piece of site text, branding, date, budget, rule and email template lives here
// and is editable from the admin dashboard.
const { get, all, run, nowIso } = require('./db');

const DEFAULT_TEMPLATES = {
  registration_confirmation: {
    subject: "You're in! Welcome to {{event_title}} 🎄",
    body:
      "Ho ho ho, {{first_name}}! 🎅\n\nYou're officially registered for {{event_title}}. " +
      "Your next mission: add your 3 Christmas wishes so your Secret Santa knows exactly what makes you smile.\n\n" +
      "Registration closes on {{registration_deadline}}.\n\nAdd your wishes: {{site_url}}/app",
  },
  wishlist_submitted: {
    subject: 'Your wishes are tucked into Santa’s gift box 🎁',
    body:
      "Hi {{first_name}},\n\nYour wishes have been safely tucked into Santa’s gift box! 🎅 " +
      "Your Secret Santa will discover them at the right time.\n\nYou can still edit them until the draw on {{draw_date}}.",
  },
  deadline_reminder: {
    subject: '⏰ The sleigh leaves soon – {{event_title}}',
    body:
      "Hi {{first_name}},\n\nThe elves noticed your stocking isn't ready yet! " +
      "Registration for {{event_title}} closes on {{registration_deadline}}.\n\n" +
      "Log in, join the fun and add your 3 wishes: {{site_url}}/app",
  },
  draw_completed: {
    subject: 'The elves have drawn the names! 🎄',
    body:
      "Hi {{first_name}},\n\nThe Secret Santa draw is complete and every name has been sealed inside a gift box. " +
      "Your box will be ready to unwrap very soon – keep an eye on your inbox!\n\n{{site_url}}/app",
  },
  assignment_available: {
    subject: '🎁 Your Secret Santa assignment is ready!',
    body:
      "Hi {{first_name}},\n\nThe elves have completed their mission! 🎄 Your Secret Santa assignment is ready. " +
      "Log in, unwrap your assignment, and start planning the perfect surprise!\n\n" +
      "Gift budget: {{budget}}\nGift exchange: {{exchange_date}}\n\n{{site_url}}/app",
  },
  custom_reminder: {
    subject: 'A note from the North Pole – {{event_title}}',
    body: "Hi {{first_name}},\n\n{{message}}\n\n{{site_url}}/app",
  },
  otp: {
    subject: 'Your {{event_title}} verification code: {{code}}',
    body:
      "Hi {{first_name}},\n\nYour one-time code is: {{code}}\n\nIt expires in 10 minutes. " +
      "If you didn't request this, you can safely ignore this email.",
  },
};

const DEFAULTS = {
  // Branding
  company_name: 'Techsara Solutions',
  company_short: 'Techsara',
  event_title: 'TECHSARA SECRET SANTA 2026',
  title_emoji_left: '🎄',
  title_emoji_right: '🎁',
  tagline: 'The magic of Christmas is in the giving. Let the mystery begin!',
  welcome_heading: 'Welcome, Techsara Elves!',
  welcome_message:
    "This December, every one of us becomes someone's Secret Santa. Join in, share three wishes, " +
    "and on draw day the elves will secretly pair you with a colleague. Keep the secret, pick a thoughtful gift, " +
    "and help make Christmas at Techsara truly magical.",
  slogan: 'Spread joy. Keep the secret. Make someone’s Christmas magical.',
  footer_text: '© 2026 Techsara Solutions · Made with ❤️ by the HR Elves',
  logo: null,
  logo_email: null, // small PNG copy of the logo made by the admin page at upload time, embedded in emails
  hero_image: null,

  // Dates
  countdown_label: 'Countdown to Christmas',
  christmas_date: '2026-12-25T00:00',
  registration_open: true,
  registration_deadline: '2026-12-12T18:00',
  draw_date: '2026-12-15T11:00',
  exchange_date: '2026-12-24T16:00',
  exchange_venue: 'Techsara Office – Cafeteria',
  auto_close_registration: true,
  timezone_label: 'IST',

  // Budget
  budget_min: 500,
  budget_max: 1000,
  currency_symbol: '₹',
  budget_note: 'Thoughtful beats expensive – please stay within the budget so everyone feels equally special.',

  // Content blocks
  how_it_works: [
    { icon: '🔐', title: 'Create your account', text: 'Sign up with your official Techsara email and a password.' },
    { icon: '📝', title: 'Join the fun', text: 'Register for Secret Santa and agree to Santa’s Rules.' },
    { icon: '🎁', title: 'Make 3 wishes', text: 'Tell your Secret Santa three things that would make you smile.' },
    { icon: '🎲', title: 'The magic draw', text: 'The elves randomly and secretly pair every participant.' },
    { icon: '✨', title: 'Unwrap your person', text: 'Open your gift box to discover who you are gifting.' },
    { icon: '🤫', title: 'Keep the secret', text: 'Plan a thoughtful surprise and reveal yourself on exchange day.' },
  ],
  rules_title: 'Santa’s Rules 🎅',
  rules_intro: 'A few simple rules keep the magic alive for everyone.',
  rules: [
    { icon: '🏢', text: 'Participation is limited to registered Techsara employees.' },
    { icon: '🎁', text: 'Every participant must submit 3 gift wishes.' },
    { icon: '🎅', text: 'Each participant is responsible for gifting the person assigned to them.' },
    { icon: '🤫', text: 'Keep your assigned recipient a secret.' },
    { icon: '🙊', text: 'Do not reveal your assignment to colleagues.' },
    { icon: '💰', text: 'Gifts must stay within the approved budget.' },
    { icon: '💝', text: 'Be thoughtful, respectful, and inclusive.' },
    { icon: '🌟', text: 'Everyone should receive a gift.' },
    { icon: '🎄', text: 'Have fun and spread Christmas cheer!' },
  ],

  // Employee experience messages
  join_message: 'Ready to spread some Christmas magic? Join this year’s Secret Santa!',
  wishes_intro: 'Tell your Secret Santa what would make your Christmas merry. Add a link or a budget hint to help them out.',
  wish_saved_message: 'Your wishes have been safely tucked into Santa’s gift box! 🎅 Your Secret Santa will discover them at the right time.',
  waiting_message: 'The elves are busy preparing the draw. Your gift box will appear here once the names are drawn!',
  locked_message: 'The names have been drawn! Your gift box is sealed and will open very soon.',
  reveal_button_text: 'Unwrap Your Secret Assignment',
  reveal_heading: '🎅 You are the Secret Santa for...',
  reveal_mission: 'It’s your mission to make their Christmas magical!',
  wish_examples: 'Wireless headphones, Perfume, Cute coffee mug',

  // Theme
  theme_midnight: '#0a1630',
  theme_red: '#c8102e',
  theme_green: '#1d7a4f',
  theme_gold: '#e9b949',
  snow_enabled: true,
  snow_density: 'medium',
  lights_enabled: true,

  // Background music (tracks are uploaded in Admin → Background Music)
  music_enabled: true,
  music_volume: 35, // percent
  music_shuffle: false,

  // Access & security
  allowed_email_domains: 'techsarasolutions.com',
  login_method: 'both', // password | otp | both
  require_email_otp_signup: false, // email a 6-digit code at sign-up (needs SMTP)
  signup_require_employee_id: false, // also ask for Employee ID at sign-up
  allow_employee_photo_upload: true,

  // Draw
  require_complete_wishes: true,
  draw_mode: 'random', // random (any valid derangement) | chain (one big gift loop)
  avoid_mutual_pairs: true,
  draw_by_location: true, // match people only with colleagues from the same office location
  release_on_draw: true,

  // Notifications
  site_url: 'http://localhost:3000',
  auto_reminder_enabled: true,
  reminder_hours_before: 48,
  email_per_minute: 20, // bulk emails are sent at this pace (Gmail / Microsoft 365 refuse big bursts)
  email_enabled: false,
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_pass: '',
  smtp_from: 'Techsara Secret Santa <santa@techsarasolutions.com>',
  // Email look – colours default to the Techsara logo (royal blue + gold)
  email_bg_color: '#151a4b',
  email_card_color: '#262f7e',
  email_accent_color: '#e9b949',
  email_decorations: true, // pine branches in the top corners
  email_font: 'segoe', // segoe | georgia | palatino | trebuchet | verdana (installed fonts, so every inbox shows them)
  email_match_fancy: true, // message written in "fancy text" (𝓛𝓮𝓽…) → the rest of the email in the same style
  templates: DEFAULT_TEMPLATES,

  // Internal bookkeeping (not editable from the UI)
  deadline_reminder_sent_for: null,
  auto_closed_for: null,
};

const str = (max) => ({ type: 'string', max });
const SCHEMA = {
  company_name: str(120), company_short: str(60), event_title: str(120),
  title_emoji_left: str(16), title_emoji_right: str(16), tagline: str(300),
  welcome_heading: str(160), welcome_message: str(3000), slogan: str(300), footer_text: str(300),
  countdown_label: str(80), christmas_date: { type: 'datetime' }, registration_open: { type: 'bool' },
  registration_deadline: { type: 'datetime', nullable: true }, draw_date: { type: 'datetime', nullable: true },
  exchange_date: { type: 'datetime', nullable: true }, exchange_venue: str(200),
  auto_close_registration: { type: 'bool' }, timezone_label: str(20),
  budget_min: { type: 'int', min: 0, max: 10_000_000 }, budget_max: { type: 'int', min: 0, max: 10_000_000 },
  currency_symbol: str(8), budget_note: str(600),
  how_it_works: { type: 'list', fields: { icon: 16, title: 100, text: 400 }, maxItems: 12 },
  rules_title: str(120), rules_intro: str(600),
  rules: { type: 'list', fields: { icon: 16, text: 500 }, maxItems: 30 },
  join_message: str(400), wishes_intro: str(600), wish_saved_message: str(400), waiting_message: str(400),
  locked_message: str(400), reveal_button_text: str(80), reveal_heading: str(160), reveal_mission: str(300),
  wish_examples: str(300),
  theme_midnight: { type: 'color' }, theme_red: { type: 'color' }, theme_green: { type: 'color' }, theme_gold: { type: 'color' },
  snow_enabled: { type: 'bool' }, snow_density: { type: 'enum', values: ['light', 'medium', 'heavy'] },
  lights_enabled: { type: 'bool' },
  music_enabled: { type: 'bool' }, music_volume: { type: 'int', min: 1, max: 100 }, music_shuffle: { type: 'bool' },
  allowed_email_domains: str(500), login_method: { type: 'enum', values: ['password', 'otp', 'both'] },
  require_email_otp_signup: { type: 'bool' }, signup_require_employee_id: { type: 'bool' }, allow_employee_photo_upload: { type: 'bool' },
  require_complete_wishes: { type: 'bool' }, draw_mode: { type: 'enum', values: ['random', 'chain'] },
  avoid_mutual_pairs: { type: 'bool' }, release_on_draw: { type: 'bool' }, draw_by_location: { type: 'bool' },
  site_url: str(300), auto_reminder_enabled: { type: 'bool' },
  reminder_hours_before: { type: 'int', min: 1, max: 720 }, email_per_minute: { type: 'int', min: 1, max: 120 },
  email_enabled: { type: 'bool' }, smtp_host: str(200), smtp_port: { type: 'int', min: 1, max: 65535 },
  smtp_secure: { type: 'bool' }, smtp_user: str(200), smtp_pass: { type: 'secret', max: 300 }, smtp_from: str(200),
  email_bg_color: { type: 'color' }, email_card_color: { type: 'color' }, email_accent_color: { type: 'color' },
  email_decorations: { type: 'bool' }, email_font: { type: 'enum', values: ['segoe', 'georgia', 'palatino', 'trebuchet', 'verdana'] }, email_match_fancy: { type: 'bool' },
  templates: { type: 'templates' },
};

// Keys safe to send to anyone (landing page, login page, employee app)
const PUBLIC_KEYS = [
  'company_name', 'company_short', 'event_title', 'title_emoji_left', 'title_emoji_right', 'tagline',
  'welcome_heading', 'welcome_message', 'slogan', 'footer_text', 'logo', 'hero_image',
  'countdown_label', 'christmas_date', 'registration_open', 'registration_deadline', 'draw_date',
  'exchange_date', 'exchange_venue', 'timezone_label', 'budget_min', 'budget_max', 'currency_symbol', 'budget_note',
  'how_it_works', 'rules_title', 'rules_intro', 'rules', 'join_message', 'wishes_intro', 'wish_saved_message',
  'waiting_message', 'locked_message', 'reveal_button_text', 'reveal_heading', 'reveal_mission', 'wish_examples',
  'theme_midnight', 'theme_red', 'theme_green', 'theme_gold', 'snow_enabled', 'snow_density', 'lights_enabled',
  'music_enabled', 'music_volume', 'music_shuffle',
  'login_method', 'require_email_otp_signup', 'signup_require_employee_id', 'allow_employee_photo_upload', 'allowed_email_domains',
];

let cache = null;

function loadAll() {
  if (cache) return cache;
  const out = structuredClone(DEFAULTS);
  for (const row of all('SELECT key, value FROM settings')) {
    try { out[row.key] = JSON.parse(row.value); } catch { /* ignore corrupt value */ }
  }
  // Merge any newly added default templates
  out.templates = { ...structuredClone(DEFAULT_TEMPLATES), ...(out.templates || {}) };
  cache = out;
  return out;
}

function getSetting(key) {
  return loadAll()[key];
}

function setInternal(key, value) {
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key, JSON.stringify(value), nowIso(),
  );
  cache = null;
}

function cleanText(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\r\n/g, '\n').slice(0, max);
}

/** Validate a partial settings object from the admin UI. Returns { values, errors }. */
function validate(input) {
  const values = {};
  const errors = [];
  for (const [key, raw] of Object.entries(input || {})) {
    const rule = SCHEMA[key];
    if (!rule) continue; // silently ignore unknown / internal keys
    switch (rule.type) {
      case 'string':
        values[key] = cleanText(raw, rule.max).trim();
        break;
      case 'secret':
        // Empty or masked value means "keep the current secret"
        if (raw === undefined || raw === null || raw === '' || raw === '••••••••') break;
        values[key] = cleanText(raw, rule.max);
        break;
      case 'bool':
        values[key] = raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on';
        break;
      case 'int': {
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < rule.min || n > rule.max) errors.push(`${key} must be a number between ${rule.min} and ${rule.max}.`);
        else values[key] = n;
        break;
      }
      case 'color':
        if (typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw)) values[key] = raw.toLowerCase();
        else errors.push(`${key} must be a hex colour like #c8102e.`);
        break;
      case 'enum':
        if (rule.values.includes(raw)) values[key] = raw;
        else errors.push(`${key} must be one of: ${rule.values.join(', ')}.`);
        break;
      case 'datetime':
        if ((raw === '' || raw === null) && rule.nullable) values[key] = null;
        else if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw))) values[key] = raw;
        else errors.push(`${key} must be a valid date and time.`);
        break;
      case 'list': {
        if (!Array.isArray(raw)) { errors.push(`${key} must be a list.`); break; }
        values[key] = raw.slice(0, rule.maxItems).map((item) => {
          const o = {};
          for (const [f, max] of Object.entries(rule.fields)) o[f] = cleanText(item && item[f], max).trim();
          return o;
        }).filter((o) => Object.values(o).some(Boolean));
        break;
      }
      case 'templates': {
        if (!raw || typeof raw !== 'object') { errors.push('templates must be an object.'); break; }
        const current = getSetting('templates');
        const next = { ...current };
        for (const name of Object.keys(DEFAULT_TEMPLATES)) {
          if (raw[name]) {
            next[name] = {
              subject: cleanText(raw[name].subject, 200).trim() || DEFAULT_TEMPLATES[name].subject,
              body: cleanText(raw[name].body, 5000).trim() || DEFAULT_TEMPLATES[name].body,
            };
          }
        }
        values[key] = next;
        break;
      }
      default:
        break;
    }
  }
  const merged = { ...loadAll(), ...values };
  if (merged.budget_max < merged.budget_min) errors.push('Maximum budget must be greater than or equal to the minimum budget.');
  return { values, errors };
}

function saveMany(values) {
  for (const [k, v] of Object.entries(values)) setInternal(k, v);
}

function publicSettings() {
  const s = loadAll();
  const out = {};
  for (const k of PUBLIC_KEYS) out[k] = s[k];
  return out;
}

function adminSettings() {
  const s = structuredClone(loadAll());
  s.smtp_pass = s.smtp_pass ? '••••••••' : '';
  delete s.deadline_reminder_sent_for;
  delete s.auto_closed_for;
  return s;
}

function allowedDomains() {
  return String(getSetting('allowed_email_domains') || '')
    .split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

function emailDomainAllowed(email) {
  const domains = allowedDomains();
  if (domains.length === 0) return true;
  const domain = String(email).toLowerCase().split('@')[1] || '';
  return domains.includes(domain);
}

function formatBudget(s = loadAll()) {
  const fmt = (n) => Number(n).toLocaleString('en-IN');
  return `${s.currency_symbol}${fmt(s.budget_min)} – ${s.currency_symbol}${fmt(s.budget_max)}`;
}

function formatDate(value) {
  if (!value) return 'TBA';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) +
    (getSetting('timezone_label') ? ` ${getSetting('timezone_label')}` : '');
}

module.exports = {
  DEFAULTS, DEFAULT_TEMPLATES, getSetting, setInternal, validate, saveMany, publicSettings,
  adminSettings, loadAll, emailDomainAllowed, allowedDomains, formatBudget, formatDate,
};
