const crypto = require('crypto');
const developmentKey = crypto.randomBytes(32);

function getKey() {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.SESSION_SECRET || '';
  if (!raw && process.env.NODE_ENV === 'production') {
    throw new Error('APP_ENCRYPTION_KEY es obligatorio en producción');
  }
  if (!raw) return developmentKey;
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(value) {
  if (value === null || value === undefined || value === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decrypt(payload) {
  if (!payload) return '';
  const [version, iv64, tag64, data64] = String(payload).split('.');
  if (version !== 'v1' || !iv64 || !tag64 || !data64) throw new Error('Dato cifrado inválido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data64, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomPickupCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return `${out.slice(0,4)}-${out.slice(4)}`;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = { encrypt, decrypt, randomToken, randomPickupCode, hash, safeEqual };
