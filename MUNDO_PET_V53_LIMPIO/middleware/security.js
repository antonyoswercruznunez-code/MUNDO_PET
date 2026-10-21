const crypto = require('crypto');

function ensureCsrf(req) {
  if (!req.session) return null;
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

function csrfEmployee(req, res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);

  // Estas rutas son públicas o pertenecen al ecommerce. El panel de empleados
  // usa CSRF propio, pero la tienda se protege con SameSite + originGuard.
  // Sin esta excepción, una sesión antigua de empleado bloqueaba el login,
  // Google Login y casi todos los botones POST de la tienda.
  const publicPath =
    req.path === '/auth/login' ||
    req.path === '/auth/forgot' ||
    req.path === '/auth/reset-password' ||
    req.path.startsWith('/tienda/');

  if (safe || publicPath || !req.session?.usuario) return next();

  const expected = ensureCsrf(req);
  const token = req.get('x-csrf-token');

  if (!token || token !== expected) {
    return res.status(403).json({
      ok: false,
      code: 'CSRF_INVALID',
      msg: 'La sesión de seguridad cambió. Intenta nuevamente.'
    });
  }

  next();
}

function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const fetchSite=String(req.get('sec-fetch-site')||'').toLowerCase();
  if(fetchSite==='cross-site')return res.status(403).json({ok:false,msg:'Origen no permitido'});
  const origin = req.get('origin') || (()=>{try{return req.get('referer')?new URL(req.get('referer')).origin:'';}catch(_){return '';}})();
  if (!origin) {
    if(process.env.NODE_ENV==='production')return res.status(403).json({ok:false,msg:'Origen no permitido'});
    return next();
  }
  try {
    const parsed = new URL(origin);
    const allowed = new Set([
      `${req.protocol}://${req.get('host')}`,
      process.env.APP_URL,
      process.env.PUBLIC_URL
    ].filter(Boolean).map(v => String(v).replace(/\/$/, '')));
    if (!allowed.has(`${parsed.protocol}//${parsed.host}`)) {
      return res.status(403).json({ ok: false, msg: 'Origen no permitido' });
    }
    next();
  } catch (_) {
    return res.status(403).json({ ok: false, msg: 'Origen no permitido' });
  }
}

function noStore(req, res, next) {
  if (req.path.startsWith('/auth') || req.path.startsWith('/usuarios') || req.path.startsWith('/config') || req.path.startsWith('/crm')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

function requestId(req, res, next) {
  req.requestId = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = { ensureCsrf, csrfEmployee, originGuard, noStore, requestId };
