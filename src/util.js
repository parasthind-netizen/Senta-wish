'use strict';
// Small shared helpers: rate limiting, image upload validation, async route wrapper.
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { randomToken } = require('./security');

/* ---------- Rate limiting (in-memory, per key) ---------- */
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

function limiter(name, max, windowMs, keyFn = (req) => req.ip) {
  return (req, res, next) => {
    if (!rateLimit(`${name}:${keyFn(req)}`, max, windowMs)) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    next();
  };
}

/* ---------- Uploads ---------- */
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
});
// Branding: the image plus (for the logo) a small email-sized copy made in the admin's browser
const brandingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 10 },
}).fields([{ name: 'image', maxCount: 1 }, { name: 'email_image', maxCount: 1 }]);
const MAX_AUDIO_MB = 20;
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_MB * 1024 * 1024, files: 1, fields: 10 },
});
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
});

/** Detect image type from magic bytes (never trust the browser-sent mimetype). SVG is rejected on purpose. */
function imageExtension(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return null;
}

/** Save an uploaded image buffer to dir with a random name. Returns the file name. */
function saveImage(file, dir, prefix) {
  if (!file) { const e = new Error('Please choose an image to upload.'); e.status = 400; throw e; }
  const ext = imageExtension(file.buffer);
  if (!ext) { const e = new Error('Only PNG, JPG, WEBP or GIF images are allowed.'); e.status = 400; throw e; }
  const name = `${prefix}-${randomToken(12)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return name;
}

/** Detect audio type from magic bytes: MP3, M4A/AAC (MP4 container), OGG or WAV. */
function audioExtension(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) return 'mp3'; // MPEG audio frame sync
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  return null;
}

/** Save an uploaded audio buffer to dir with a random name. Returns the file name. */
function saveAudio(file, dir, prefix) {
  if (!file) { const e = new Error('Please choose a music file to upload.'); e.status = 400; throw e; }
  const ext = audioExtension(file.buffer);
  if (!ext) { const e = new Error('Only MP3, M4A, OGG or WAV music files are allowed.'); e.status = 400; throw e; }
  const name = `${prefix}-${randomToken(12)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return name;
}

function removeFile(dir, name) {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return;
  fs.rm(path.join(dir, name), { force: true }, () => {});
}

/* ---------- Misc ---------- */
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
const clean = (v, max = 200) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));

module.exports = { rateLimit, limiter, imageUpload, brandingUpload, audioUpload, MAX_AUDIO_MB, sheetUpload, imageExtension, saveImage,
  audioExtension, saveAudio, removeFile, asyncRoute, httpError, isEmail, clean };
