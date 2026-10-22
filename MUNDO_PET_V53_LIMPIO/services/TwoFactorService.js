'use strict';

/*
 * Verificación en dos pasos (TOTP, RFC 6238): el estándar de Google y
 * Microsoft Authenticator. El servidor y el celular comparten una clave y
 * cada 30 segundos calculan el mismo código de 6 dígitos con la hora.
 *
 * La clave se guarda cifrada (CryptoService) y nunca sale en una respuesta.
 */
const crypto = require('crypto');
// La librería qrcode es opcional: si no se pudo instalar, el QR se dibuja en el navegador.
let QRCode = null;
try { QRCode = require('qrcode'); } catch (_) { QRCode = null; }
const { getDB } = require('../config/database');
const { encrypt, decrypt } = require('./CryptoService');

const ISSUER = 'MUNDO PET';
const PERIOD = 30;
const DIGITS = 6;
const WINDOW = 1;                    // acepta el código anterior y el siguiente (desfase de reloj)
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = ((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

const currentStep = () => Math.floor(Date.now() / 1000 / PERIOD);

// Devuelve el paso de tiempo del código si es válido, o null.
function matchStep(secret, code) {
  const value = String(code || '').replace(/\D/g, '');
  if (value.length !== DIGITS || !secret) return null;
  const now = currentStep();
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const expected = codeAt(secret, now + delta);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(value))) return now + delta;
  }
  return null;
}

async function getState(userId) {
  const [[row]] = await getDB().query(
    'SELECT id, username, nombre, clave_secreta_2fa, doble_factor_activo, doble_factor_paso FROM usuarios WHERE id=? LIMIT 1', [userId]
  );
  return row || null;
}

// Pantalla de verificación: si aún no está configurado, devuelve el QR.
// La clave se reutiliza mientras no se valide, así el QR no cambia.
async function screen(userId) {
  const user = await getState(userId);
  if (!user) throw Object.assign(new Error('Usuario no encontrado'), { status: 401 });
  if (Number(user.doble_factor_activo) === 1 && user.clave_secreta_2fa) return { configurando: false };
  let secret = user.clave_secreta_2fa ? decrypt(user.clave_secreta_2fa) : '';
  if (!secret) {
    secret = base32Encode(crypto.randomBytes(20));
    await getDB().query('UPDATE usuarios SET clave_secreta_2fa=?, doble_factor_activo=0, doble_factor_paso=NULL WHERE id=?', [encrypt(secret), user.id]);
  }
  const label = `${ISSUER}:${user.username}`;
  const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
  const qr = QRCode
    ? await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240, color: { dark: '#0f172a', light: '#ffffff' } }).catch(() => null)
    : null;
  // La clave en texto sirve para escribirla a mano si la cámara no lee el QR.
  return { configurando: true, qr, uri, clave: secret.replace(/(.{4})/g, '$1 ').trim() };
}

// Valida un código. Cada código sirve una sola vez (no se puede reutilizar).
async function verify(userId, code) {
  const user = await getState(userId);
  if (!user?.clave_secreta_2fa) return false;
  const step = matchStep(decrypt(user.clave_secreta_2fa), code);
  if (step === null || (user.doble_factor_paso !== null && step <= Number(user.doble_factor_paso))) return false;
  const [result] = await getDB().query(
    'UPDATE usuarios SET doble_factor_activo=1, doble_factor_paso=? WHERE id=? AND (doble_factor_paso IS NULL OR doble_factor_paso < ?)',
    [step, user.id, step]
  );
  return result.affectedRows === 1;
}

// El administrador reinicia el autenticador: en el próximo ingreso hay QR nuevo.
async function reset(userId) {
  await getDB().query(
    'UPDATE usuarios SET clave_secreta_2fa=NULL, doble_factor_activo=0, doble_factor_paso=NULL, session_version=COALESCE(session_version,1)+1 WHERE id=?',
    [userId]
  );
}

module.exports = { screen, verify, reset, codeAt, currentStep, base32Encode, matchStep };
