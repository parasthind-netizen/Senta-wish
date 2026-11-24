'use strict';
// SQLite database (Node's built-in node:sqlite – no native build needed).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_UPLOAD_DIR = path.join(UPLOAD_DIR, 'public'); // branding + gallery (public)
const PHOTO_DIR = path.join(UPLOAD_DIR, 'photos'); // employee photos (login required)

for (const dir of [DATA_DIR, UPLOAD_DIR, PUBLIC_UPLOAD_DIR, PHOTO_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'santa.db');
const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  department    TEXT NOT NULL DEFAULT '',
  designation   TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',
  photo         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT ${NOW},
  updated_at    TEXT NOT NULL DEFAULT ${NOW}
);

-- One login per employee (PRIMARY KEY on employee_id prevents duplicates)
CREATE TABLE IF NOT EXISTS employee_auth (
  employee_id     INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  password_hash   TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT ${NOW}
);

-- One Secret Santa registration per employee
CREATE TABLE IF NOT EXISTS registrations (
  employee_id   INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  agreed_rules  INTEGER NOT NULL DEFAULT 1,
  registered_at TEXT NOT NULL DEFAULT ${NOW}
);

-- One wish list per employee. Wish content is AES-256-GCM encrypted at rest.
CREATE TABLE IF NOT EXISTS wishlists (
  employee_id  INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  payload_enc  TEXT NOT NULL,
  wish_count   INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at   TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS admins (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                 TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'hr_admin' CHECK (role IN ('super_admin','hr_admin')),
  active               INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS draws (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  status            TEXT NOT NULL CHECK (status IN ('active','reset')),
  mode              TEXT NOT NULL,
  participant_count INTEGER NOT NULL,
  released          INTEGER NOT NULL DEFAULT 0,
  released_at       TEXT,
  created_by        INTEGER REFERENCES admins(id),
  created_at        TEXT NOT NULL DEFAULT ${NOW},
  reset_by          INTEGER REFERENCES admins(id),
  reset_reason      TEXT,
  reset_at          TEXT
);
-- Only one finalized draw may exist at a time
CREATE UNIQUE INDEX IF NOT EXISTS ux_one_active_draw ON draws(status) WHERE status = 'active';

-- Giver -> receiver. receiver_enc is encrypted, receiver_tag is an HMAC that lets the
-- database enforce "one Secret Santa per recipient" without revealing who it is.
CREATE TABLE IF NOT EXISTS assignments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_id      INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  giver_id     INTEGER NOT NULL REFERENCES employees(id),
  receiver_enc TEXT NOT NULL,
  receiver_tag TEXT NOT NULL,
  revealed_at  TEXT,
  UNIQUE (draw_id, giver_id),
  UNIQUE (draw_id, receiver_tag)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('employee','admin')),
  subject_id INTEGER NOT NULL,
  csrf       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_subject ON sessions(kind, subject_id);

CREATE TABLE IF NOT EXISTS otps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS ix_otps_emp ON otps(employee_id, purpose);

CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  read_at      TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_error  TEXT,
  created_at   TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS ix_notifications_emp ON notifications(employee_id, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type  TEXT NOT NULL,
  actor_id    INTEGER,
  actor_label TEXT,
  action      TEXT NOT NULL,
  details     TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS gallery (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file       TEXT NOT NULL,
  caption    TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

-- Emergency override windows that let a super admin view confidential data (always logged)
CREATE TABLE IF NOT EXISTS overrides (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER NOT NULL REFERENCES admins(id),
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  expires_at TEXT NOT NULL,
  ended_at   TEXT
);
`);

function nowIso() {
  return new Date().toISOString();
}

/** Run fn inside an IMMEDIATE transaction (write lock taken up front). */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

const get = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

module.exports = { db, tx, get, all, run, nowIso, DATA_DIR, UPLOAD_DIR, PUBLIC_UPLOAD_DIR, PHOTO_DIR };
