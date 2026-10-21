// Middleware: exige que haya un cliente web logueado (para checkout, mis pedidos, etc.)
function authWeb(req, res, next) {
  if (req.session && req.session.clienteWeb) return next();
  return res.status(401).json({ ok: false, msg: 'Debes iniciar sesión', requiere_login: true });
}

module.exports = { authWeb };