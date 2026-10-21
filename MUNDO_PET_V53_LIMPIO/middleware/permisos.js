
function isAdminSession(req) {
  const u = req.session?.usuario;
  const perfil = String(u?.perfil_nombre || '').trim().toLowerCase();
  return !!u && !!u.es_global;
}

async function hasPermission(req, slug) {
  if (!req.session?.usuario || req.session.mfa_ok !== true) return false;
  if (isAdminSession(req)) return true;
  const permisos = Array.isArray(req.session.permisos) ? req.session.permisos : [];
  return permisos.includes(String(slug));
}

function requirePermission(slug) {
  return async (req, res, next) => {
    try {
      if (!(await hasPermission(req, slug))) {
        return res.status(403).json({ ok: false, msg: 'No tienes permiso para realizar esta acción' });
      }
      req.permission = slug;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireAny(...slugs) {
  return async (req, res, next) => {
    try {
      for (const slug of slugs) {
        if (await hasPermission(req, slug)) {
          req.permission = slug;
          return next();
        }
      }
      return res.status(403).json({ ok: false, msg: 'No tienes permiso para realizar esta acción' });
    } catch (error) {
      next(error);
    }
  };
}

function userScope(req) {
  const u = req.session?.usuario || {};
  return {
    isGlobal: !!u.es_global,
    sucursalId: u.es_global ? null : (Number(u.sucursal_id) || null),
    userId: Number(u.id) || null
  };
}

async function hasGlobalScope(req, slug) {
  const scope = userScope(req);
  return !!scope.isGlobal && (!slug || await hasPermission(req, slug));
}

module.exports = { hasPermission, requirePermission, requireAny, userScope, isAdminSession, hasGlobalScope };
