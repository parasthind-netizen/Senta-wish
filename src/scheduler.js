'use strict';
// Background jobs: auto-close registrations at the deadline and send the deadline reminder.
const { all } = require('./db');
const settings = require('./settings');
const mailer = require('./mailer');
const privacy = require('./privacy');
const { audit, SYSTEM } = require('./audit');

function tick() {
  try {
    const s = settings.loadAll();
    const deadline = s.registration_deadline ? Date.parse(s.registration_deadline) : NaN;
    if (Number.isNaN(deadline)) return;
    const now = Date.now();

    // 1. Deadline reminder (once per deadline value)
    const windowStart = deadline - s.reminder_hours_before * 3600 * 1000;
    if (s.auto_reminder_enabled && s.registration_open && now >= windowStart && now < deadline
        && s.deadline_reminder_sent_for !== s.registration_deadline && !privacy.activeDraw()) {
      const slots = privacy.WISH_SLOTS;
      const list = all(`SELECT e.* FROM employees e LEFT JOIN registrations r ON r.employee_id = e.id
                        LEFT JOIN wishlists w ON w.employee_id = e.id
                        WHERE e.active = 1 AND (r.employee_id IS NULL OR COALESCE(w.wish_count, 0) < ${slots})`);
      settings.setInternal('deadline_reminder_sent_for', s.registration_deadline);
      if (list.length) mailer.notifyMany(list, 'deadline_reminder');
      audit(SYSTEM, 'reminders.auto_deadline', { count: list.length });
    }

    // 2. Auto-close registrations once the deadline passes (once per deadline value)
    if (s.auto_close_registration && s.registration_open && now >= deadline && s.auto_closed_for !== s.registration_deadline) {
      settings.setInternal('registration_open', false);
      settings.setInternal('auto_closed_for', s.registration_deadline);
      audit(SYSTEM, 'registration.auto_closed', { deadline: s.registration_deadline });
      console.log('[scheduler] Registrations closed automatically at the deadline.');
    }
  } catch (err) {
    console.error('[scheduler]', err);
  }
}

function startScheduler() {
  tick();
  setInterval(tick, 5 * 60 * 1000).unref();
}

module.exports = { startScheduler, tick };
