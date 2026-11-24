'use strict';
/*
 * Techsara Secret Santa 2026 – server entry point.
 * Run locally:  npm start   (reads .env if present)   →  http://localhost:3000
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const { PUBLIC_UPLOAD_DIR, PHOTO_DIR } = require('./src/db');
const auth = require('./src/auth');
const privacy = require('./src/privacy');
const { ensureAdmin } = require('./src/bootstrap');
const { startScheduler } = require('./src/scheduler');
const { MAX_AUDIO_MB } = require('./src/util');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
// Behind nginx / an AWS load balancer set TRUST_PROXY=1 so req.ip and rate limits see the real client
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

/* ------------------------------------------------------------ security headers */
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.COOKIE_SECURE === 'true') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(auth.loadSessions);
app.use(auth.sameOrigin);

/* ------------------------------------------------------------------------ API */
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api/public', require('./src/routes/public'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api', require('./src/routes/employee'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* --------------------------------------------------------------------- files */
// Branding, gallery images and background music are public (express.static supports Range requests for audio)
app.use('/uploads', express.static(PUBLIC_UPLOAD_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }));

// Employee photos: admins, the employee themself, or the Santa who unwrapped them
app.get('/media/photos/:file', (req, res) => {
  const file = req.params.file;
  if (!/^[A-Za-z0-9_-]+\.(png|jpg|webp|gif)$/.test(file)) return res.status(404).end();
  const allowed = Boolean(req.admin) || (req.employee && privacy.employeeMayViewPhoto(req.employee.id, file));
  if (!allowed) return res.status(404).end();
  const full = path.join(PHOTO_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.sendFile(full);
});

/* --------------------------------------------------------------------- pages */
const page = (name) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, `${name}.html`));
app.get('/', page('index'));
app.get('/rules', page('rules'));
app.get('/login', page('login'));
app.get('/app', page('app'));
app.get('/admin', page('admin'));
// maxAge 0 + ETag: browsers revalidate (cheap 304s) so updates to JS/CSS reach everyone immediately
app.use(express.static(PUBLIC_DIR, { index: false, extensions: false, maxAge: 0 }));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

/* ------------------------------------------------------------------- errors */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.expose !== false && status < 500 ? err.message : 'Something went wrong on the North Pole servers. Please try again.';
  if (err instanceof multer.MulterError) {
    status = 400;
    const maxMb = err.field === 'audio' ? MAX_AUDIO_MB : 5;
    message = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${maxMb} MB).` : `Upload problem: ${err.message}`;
  } else if (err.type === 'entity.too.large') {
    status = 413; message = 'Request is too large.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; message = 'Invalid request body.';
  }
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);
  if (req.originalUrl.startsWith('/api')) return res.status(status).json({ error: message });
  res.status(status).send(message);
});

/* -------------------------------------------------------------------- start */
ensureAdmin().then(() => {
  startScheduler();
  app.listen(PORT, HOST, () => {
    console.log(`🎄 Techsara Secret Santa is running → http://localhost:${PORT}  (admin: http://localhost:${PORT}/admin)`);
  });
}).catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
