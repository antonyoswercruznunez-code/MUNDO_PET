const path = require('path');
const fs = require('fs');
const { getDB } = require('../config/database');
const Crypto = require('./CryptoService');

const ROOT = path.resolve(path.join(__dirname, '../storage/documents'));

async function createPublicLink(req, { tipo, entidadId, filename, hours }) {
  const db = getDB();
  const token = Crypto.randomToken(32);
  const tokenHash = Crypto.hash(token);
  const ttl = Math.max(1, Number(hours || process.env.DOCUMENT_LINK_HOURS || 168));
  const relative = path.basename(filename);
  await db.query(`
    INSERT INTO documentos_publicos
      (tipo, entidad_id, token_hash, archivo_relativo, expires_at, created_by)
    VALUES (?,?,?,?,DATE_ADD(NOW(), INTERVAL ? HOUR),?)
  `, [tipo, entidadId, tokenHash, relative, ttl, req.session?.usuario?.id || null]);
  const base = String(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${base}/documentos/${token}`;
}

async function resolveToken(token) {
  const db = getDB();
  const tokenHash = Crypto.hash(token);
  const [[row]] = await db.query(`
    SELECT * FROM documentos_publicos
    WHERE token_hash=? AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1
  `, [tokenHash]);
  if (!row) return null;
  const file = path.resolve(ROOT, path.basename(row.archivo_relativo));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) return null;
  await db.query('UPDATE documentos_publicos SET access_count=access_count+1,last_access_at=NOW() WHERE id=?', [row.id]);
  return { ...row, file };
}

async function revoke(tipo, entidadId) {
  const db = getDB();
  await db.query('UPDATE documentos_publicos SET revoked_at=NOW() WHERE tipo=? AND entidad_id=? AND revoked_at IS NULL', [tipo, entidadId]);
}

module.exports = { createPublicLink, resolveToken, revoke, ROOT };
