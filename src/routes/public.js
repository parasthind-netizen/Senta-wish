'use strict';
const express = require('express');
const { get, all } = require('../db');
const settings = require('../settings');
const privacy = require('../privacy');

const router = express.Router();

/** Everything the public pages need: branding, dates, budget, rules, gallery, high-level status. */
router.get('/config', (req, res) => {
  const draw = privacy.drawSummary();
  res.set('Cache-Control', 'no-store');
  res.json({
    settings: settings.publicSettings(),
    budgetLabel: settings.formatBudget(),
    drawStatus: draw.status,
    participantCount: get('SELECT COUNT(*) AS c FROM registrations r JOIN employees e ON e.id = r.employee_id AND e.active = 1').c,
    gallery: all('SELECT file, caption FROM gallery ORDER BY sort_order, id').map((g) => ({ url: `/uploads/${g.file}`, caption: g.caption })),
    music: all('SELECT file, title FROM music_tracks ORDER BY sort_order, id').map((t) => ({ url: `/uploads/${t.file}`, title: t.title })),
    serverTime: new Date().toISOString(),
  });
});

module.exports = router;
