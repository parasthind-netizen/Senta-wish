'use strict';
/*
 * PRIVACY LAYER – the ONLY module that reads or writes the `wishlists` and `assignments` tables.
 *
 * Rules enforced here (not in the UI):
 *  - An employee can read/write their own wishes (writes only before the draw).
 *  - An employee can read exactly one other wish list: their assigned recipient's, and only
 *    after the draw is finalized AND released.
 *  - Nobody can find out who their own Secret Santa is – there is no function that answers it.
 *  - Admins get assignments/wishes only through an active, logged emergency override.
 *  - Wish content and receiver ids are AES-256-GCM encrypted at rest.
 */
const { get, all, run, tx, nowIso } = require('./db');
const { encrypt, decrypt, mac } = require('./security');
const { generatePairs, validatePairs } = require('./draw');
const settings = require('./settings');
const { httpError, clean } = require('./util');

const WISH_SLOTS = 3;

/* ------------------------------------------------------------------ draws */

function activeDraw() {
  return get("SELECT * FROM draws WHERE status = 'active'") || null;
}

function drawSummary() {
  const d = activeDraw();
  if (!d) return { status: 'not_started' };
  return {
    status: d.released ? 'released' : 'completed',
    drawId: d.id,
    participantCount: d.participant_count,
    mode: d.mode,
    createdAt: d.created_at,
    releasedAt: d.released_at,
    revealedCount: get('SELECT COUNT(*) AS c FROM assignments WHERE draw_id = ? AND revealed_at IS NOT NULL', d.id).c,
  };
}

/* ----------------------------------------------------------------- wishes */

function normaliseLink(raw) {
  const v = clean(raw, 500);
  if (!v) return '';
  let url;
  try { url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { throw httpError(400, `"${v.slice(0, 60)}" is not a valid link.`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw httpError(400, 'Links must start with http:// or https://');
  return url.toString();
}

function sanitiseWishes(input) {
  if (!Array.isArray(input)) throw httpError(400, 'Wishes must be a list.');
  const wishes = [];
  for (let i = 0; i < WISH_SLOTS; i += 1) {
    const w = input[i] || {};
    wishes.push({
      name: clean(w.name, 120),
      description: clean(w.description, 500),
      link: normaliseLink(w.link),
      budget: clean(w.budget, 60),
    });
  }
  return wishes;
}

function readWishes(employeeId) {
  const row = get('SELECT payload_enc, wish_count, submitted_at, updated_at FROM wishlists WHERE employee_id = ?', employeeId);
  if (!row) return null;
  let wishes;
  try { wishes = decrypt(row.payload_enc); } catch { wishes = []; }
  return { wishes, count: row.wish_count, submittedAt: row.submitted_at, updatedAt: row.updated_at };
}

/** Employee reads their own wish list. */
function getOwnWishes(employeeId) {
  return readWishes(employeeId);
}

/** Employee saves their own wish list – only while registered and before the draw. */
function saveOwnWishes(employeeId, input) {
  const wishes = sanitiseWishes(input);
  const count = wishes.filter((w) => w.name).length;
  if (count === 0) throw httpError(400, 'Please add at least one wish.');
  return tx(() => {
    if (!get('SELECT 1 FROM registrations WHERE employee_id = ?', employeeId)) {
      throw httpError(403, 'Join Secret Santa first, then add your wishes.');
    }
    if (activeDraw()) throw httpError(409, 'The draw has been finalized – wish lists are now locked.');
    const existing = get('SELECT employee_id FROM wishlists WHERE employee_id = ?', employeeId);
    const now = nowIso();
    if (existing) {
      run('UPDATE wishlists SET payload_enc = ?, wish_count = ?, updated_at = ? WHERE employee_id = ?', encrypt(wishes), count, now, employeeId);
    } else {
      run('INSERT INTO wishlists (employee_id, payload_enc, wish_count, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?)', employeeId, encrypt(wishes), count, now, now);
    }
    return { wishes, count, isNew: !existing, complete: count === WISH_SLOTS };
  });
}

/** Wish-list *status* (never content) for admin dashboards. */
function wishCount(employeeId) {
  const row = get('SELECT wish_count FROM wishlists WHERE employee_id = ?', employeeId);
  return row ? row.wish_count : 0;
}

/* ------------------------------------------------------------ assignments */

function decodeReceiver(assignment) {
  const payload = decrypt(assignment.receiver_enc);
  if (payload.d !== assignment.draw_id) throw new Error('Assignment integrity check failed.');
  return payload.r;
}

function recipientView(receiverId) {
  const r = get('SELECT full_name, department, designation, location, photo FROM employees WHERE id = ?', receiverId);
  if (!r) return null;
  const wl = readWishes(receiverId);
  return {
    fullName: r.full_name,
    department: r.department,
    designation: r.designation,
    location: r.location,
    photo: r.photo ? `/media/photos/${r.photo}` : null,
    wishes: wl ? wl.wishes.filter((w) => w.name) : [],
  };
}

/** What the employee's gift box looks like right now. Recipient details only once unwrapped. */
function assignmentStatusFor(employeeId) {
  const registered = Boolean(get('SELECT 1 FROM registrations WHERE employee_id = ?', employeeId));
  const draw = activeDraw();
  if (!draw) return { state: registered ? 'pending' : 'not_registered' };
  const a = get('SELECT * FROM assignments WHERE draw_id = ? AND giver_id = ?', draw.id, employeeId);
  if (!a) return { state: 'not_included' };
  if (!draw.released) return { state: 'locked' };
  if (!a.revealed_at) return { state: 'ready' };
  return { state: 'revealed', revealedAt: a.revealed_at, recipient: recipientView(decodeReceiver(a)) };
}

/** Employee unwraps their gift box. */
function revealFor(employeeId) {
  const draw = activeDraw();
  if (!draw) throw httpError(409, 'The draw has not happened yet.');
  if (!draw.released) throw httpError(409, 'Gift boxes are still sealed – check back soon!');
  const a = get('SELECT * FROM assignments WHERE draw_id = ? AND giver_id = ?', draw.id, employeeId);
  if (!a) throw httpError(404, 'You were not part of this draw.');
  if (!a.revealed_at) run('UPDATE assignments SET revealed_at = ? WHERE id = ?', nowIso(), a.id);
  return { state: 'revealed', revealedAt: a.revealed_at || nowIso(), recipient: recipientView(decodeReceiver(a)) };
}

/** Photo access: own photo, or the photo of the recipient this employee has unwrapped. */
function employeeMayViewPhoto(employeeId, file) {
  const self = get('SELECT photo FROM employees WHERE id = ?', employeeId);
  if (self && self.photo === file) return true;
  const status = assignmentStatusFor(employeeId);
  return status.state === 'revealed' && status.recipient && status.recipient.photo === `/media/photos/${file}`;
}

/* -------------------------------------------------------------- draw ops */

function eligibleParticipants() {
  const requireComplete = settings.getSetting('require_complete_wishes');
  return all(`
    SELECT e.id, e.full_name, e.email, e.employee_code, COALESCE(w.wish_count, 0) AS wish_count
    FROM registrations r
    JOIN employees e ON e.id = r.employee_id AND e.active = 1
    JOIN employee_auth a ON a.employee_id = e.id
    LEFT JOIN wishlists w ON w.employee_id = e.id
    ${requireComplete ? `WHERE COALESCE(w.wish_count, 0) >= ${WISH_SLOTS}` : ''}
    ORDER BY e.id`);
}

function drawPreview() {
  const eligible = eligibleParticipants();
  const registered = get('SELECT COUNT(*) AS c FROM registrations r JOIN employees e ON e.id = r.employee_id AND e.active = 1').c;
  return { eligibleCount: eligible.length, registeredCount: registered, excludedCount: registered - eligible.length };
}

function runDraw(adminId) {
  const s = settings.loadAll();
  return tx(() => {
    if (activeDraw()) throw httpError(409, 'A draw has already been finalized. Reset it first if you really need to redraw.');
    const people = eligibleParticipants();
    if (people.length < 3) throw httpError(400, `At least 3 eligible participants are needed (currently ${people.length}).`);
    const ids = people.map((p) => p.id);
    const pairs = generatePairs(ids, { mode: s.draw_mode, avoidMutual: s.avoid_mutual_pairs });
    validatePairs(ids, pairs);

    const now = nowIso();
    const released = s.release_on_draw ? 1 : 0;
    const res = run(
      "INSERT INTO draws (status, mode, participant_count, released, released_at, created_by, created_at) VALUES ('active', ?, ?, ?, ?, ?, ?)",
      s.draw_mode, ids.length, released, released ? now : null, adminId, now,
    );
    const drawId = Number(res.lastInsertRowid);
    const ins = 'INSERT INTO assignments (draw_id, giver_id, receiver_enc, receiver_tag) VALUES (?, ?, ?, ?)';
    for (const [giver, receiver] of pairs) {
      run(ins, drawId, giver, encrypt({ d: drawId, r: receiver }), mac(`${drawId}:${receiver}`));
    }
    // Close registrations once names are drawn
    settings.setInternal('registration_open', false);
    return { drawId, participants: people, released: Boolean(released) };
  });
}

function releaseDraw() {
  return tx(() => {
    const d = activeDraw();
    if (!d) throw httpError(409, 'There is no finalized draw to release.');
    if (d.released) throw httpError(409, 'Gift boxes are already open.');
    run('UPDATE draws SET released = 1, released_at = ? WHERE id = ?', nowIso(), d.id);
    return all('SELECT e.* FROM assignments a JOIN employees e ON e.id = a.giver_id WHERE a.draw_id = ?', d.id);
  });
}

function resetDraw(adminId, reason) {
  return tx(() => {
    const d = activeDraw();
    if (!d) throw httpError(409, 'There is no finalized draw to reset.');
    run("UPDATE draws SET status = 'reset', reset_by = ?, reset_reason = ?, reset_at = ? WHERE id = ?", adminId, reason, nowIso(), d.id);
    // Voided assignments are destroyed, not archived
    run('DELETE FROM assignments WHERE draw_id = ?', d.id);
    return { drawId: d.id, participantCount: d.participant_count };
  });
}

function drawParticipants() {
  const d = activeDraw();
  if (!d) return [];
  return all('SELECT e.* FROM assignments a JOIN employees e ON e.id = a.giver_id WHERE a.draw_id = ?', d.id);
}

/* ----------------------------------------------------- emergency override */

function activeOverride(adminId) {
  return get('SELECT * FROM overrides WHERE admin_id = ? AND ended_at IS NULL AND expires_at > ? ORDER BY id DESC', adminId, nowIso()) || null;
}

function anyActiveOverride() {
  return get(`SELECT o.*, a.name AS admin_name, a.email AS admin_email FROM overrides o JOIN admins a ON a.id = o.admin_id
              WHERE o.ended_at IS NULL AND o.expires_at > ? ORDER BY o.id DESC`, nowIso()) || null;
}

function requireOverride(adminId) {
  const o = activeOverride(adminId);
  if (!o) throw httpError(403, 'Emergency override is not active. Enable it (with a reason) first – every access is logged.');
  return o;
}

function overrideAssignments(adminId) {
  requireOverride(adminId);
  const d = activeDraw();
  if (!d) return [];
  const rows = all(`SELECT a.*, e.full_name, e.employee_code, e.department FROM assignments a
                    JOIN employees e ON e.id = a.giver_id WHERE a.draw_id = ? ORDER BY e.full_name`, d.id);
  return rows.map((a) => {
    const r = get('SELECT id, full_name, employee_code, department FROM employees WHERE id = ?', decodeReceiver(a));
    return {
      giver: { id: a.giver_id, name: a.full_name, code: a.employee_code, department: a.department },
      receiver: r ? { id: r.id, name: r.full_name, code: r.employee_code, department: r.department } : null,
      revealedAt: a.revealed_at,
    };
  });
}

function overrideWishes(adminId, employeeId) {
  requireOverride(adminId);
  return readWishes(employeeId);
}

module.exports = {
  WISH_SLOTS, activeDraw, drawSummary, getOwnWishes, saveOwnWishes, wishCount, assignmentStatusFor, revealFor,
  employeeMayViewPhoto, eligibleParticipants, drawPreview, runDraw, releaseDraw, resetDraw, drawParticipants,
  activeOverride, anyActiveOverride, overrideAssignments, overrideWishes,
};
