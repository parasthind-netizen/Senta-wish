'use strict';
// Encryption at rest, tokens, OTP codes and password hashing.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { DATA_DIR } = require('./db');

function loadMasterKey() {
  const fromEnv = process.env.DATA_KEY;
  if (fromEnv) {
    const buf = /^[0-9a-f]{64}$/i.test(fromEnv) ? Buffer.from(fromEnv, 'hex') : Buffer.from(fromEnv, 'base64');
    if (buf.length !== 32) throw new Error('DATA_KEY must be 32 bytes (64 hex chars or base64).');
    return buf;
  }
  const keyFile = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(keyFile)) {
    return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
  console.warn('[security] Generated a new data encryption key at', keyFile,
    '\n           For production set DATA_KEY in .env and keep a safe backup – losing it makes wishes and assignments unreadable.');
  return key;
}

const MASTER = loadMasterKey();
const derive = (label) => Buffer.from(crypto.hkdfSync('sha256', MASTER, Buffer.alloc(0), Buffer.from(label), 32));
const ENC_KEY = derive('secret-santa/encryption/v1');
const MAC_KEY = derive('secret-santa/mac/v1');

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function decrypt(blob) {
  const raw = Buffer.from(blob, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const pt = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

function mac(text) {
  return crypto.createHmac('sha256', MAC_KEY).update(String(text)).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

const BCRYPT_ROUNDS = 11;
const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_ROUNDS);
const verifyPassword = (pw, hash) => (hash ? bcrypt.compare(pw, hash) : Promise.resolve(false));

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain at least one letter and one number.';
  return null;
}

module.exports = {
  encrypt, decrypt, mac, randomToken, sha256, safeEqual, generateOtp,
  hashPassword, verifyPassword, passwordProblem,
};
