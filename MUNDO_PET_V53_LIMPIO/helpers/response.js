const ok = (res, data = null, msg = 'OK', code = 200) =>
  res.status(code).json({ ok: true, msg, data });

const err = (res, msg = 'Solicitud inválida', code = 400) =>
  res.status(code).json({ ok: false, msg });

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    next(error);
  }
};

module.exports = { ok, err, wrap };
