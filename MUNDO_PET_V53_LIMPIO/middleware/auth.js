const bcrypt = require('bcrypt');
const { getDB } = require('../config/database');

const LOCK_MINUTES = Math.max(5, Number(process.env.SESSION_LOCK_MINUTES || 20));
const MAX_HOURS = Math.max(1, Number(process.env.SESSION_MAX_HOURS || 8));

function now() { return Date.now(); }

async function validateLiveUser(req) {
  const user = req.session?.usuario;
  if (!user) return false;

  const lastCheck = Number(req.session.user_checked_at || 0);
  if (now() - lastCheck < 5 * 60 * 1000) return true;

  const db = getDB();
  const [[row]] = await db.query(`
    SELECT u.id, u.estado, u.session_version, u.perfil_id, u.sucursal_id, u.es_global,
           p.nombre AS perfil_nombre
    FROM usuarios u
    JOIN perfiles p ON p.id = u.perfil_id
    WHERE u.id = ? LIMIT 1
  `, [user.id]);

  if (!row || Number(row.estado) !== 0) return false;
  if (Number(row.session_version || 1) !== Number(user.session_version || 1)) return false;

  Object.assign(req.session.usuario, {
    perfil_id: row.perfil_id,
    perfil_nombre: row.perfil_nombre,
    sucursal_id: row.sucursal_id,
    es_global: row.es_global
  });
  req.session.user_checked_at = now();
  return true;
}

function setLockIfIdle(req) {
  const createdAt = Number(req.session.login_at || 0);
  const lastActivity = Number(req.session.last_user_activity_at || createdAt || now());
  const maxAge = MAX_HOURS * 60 * 60 * 1000;
  const idleAge = LOCK_MINUTES * 60 * 1000;

  if (createdAt && now() - createdAt > maxAge) return 'expired';
  if (!req.session.locked && now() - lastActivity > idleAge) {
    req.session.locked = true;
    req.session.locked_at = now();
  }
  return req.session.locked ? 'locked' : 'ok';
}

async function authBase(req, res, next, allowLocked = false) {
  try {
    if (!req.session?.usuario) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', msg: 'No autorizado' });
    }
    if (!(await validateLiveUser(req))) {
      return req.session.destroy(() => res.status(401).json({ ok: false, code: 'SESSION_INVALID', msg: 'La sesión ya no es válida' }));
    }
    const state = setLockIfIdle(req);
    if (state === 'expired') {
      return req.session.destroy(() => res.status(401).json({ ok: false, code: 'SESSION_EXPIRED', msg: 'La sesión expiró' }));
    }
    if (!allowLocked && state === 'locked') {
      return res.status(423).json({ ok: false, code: 'SESSION_LOCKED', msg: 'Sesión bloqueada por inactividad' });
    }
    next();
  } catch (error) {
    next(error);
  }
}

const auth = (req, res, next) => authBase(req, res, next, false);
const authAllowLocked = (req, res, next) => authBase(req, res, next, true);

const soloAdmin = (req, res, next) => {
  const u = req.session?.usuario;
  const perfil = String(u?.perfil_nombre || '').trim().toLowerCase();
  if (!u || (!u.es_global && perfil !== 'administrador')) {
    return res.status(403).json({ ok: false, msg: 'Solo administradores pueden realizar esta acción' });
  }
  next();
};

async function unlock(req, res, next) {
  try {
    const password = String(req.body?.password || '');
    if (!password) return res.status(400).json({ ok: false, msg: 'Ingresa tu contraseña' });
    const db = getDB();
    const [[row]] = await db.query('SELECT password_hash, estado FROM usuarios WHERE id = ? LIMIT 1', [req.session.usuario.id]);
    if (!row || Number(row.estado) !== 0 || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ ok: false, msg: 'Contraseña incorrecta' });
    }
    req.session.locked = false;
    req.session.locked_at = null;
    req.session.last_user_activity_at = now();
    res.json({ ok: true, msg: 'Sesión desbloqueada' });
  } catch (error) {
    next(error);
  }
}

function activity(req, res) {
  req.session.last_user_activity_at = now();
  res.status(204).end();
}

module.exports = { auth, authAllowLocked, soloAdmin, unlock, activity, LOCK_MINUTES, MAX_HOURS };
