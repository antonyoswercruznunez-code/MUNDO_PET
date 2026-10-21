const { getDB } = require('../config/database');

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim().slice(0, 45);
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 45);
}

async function log(req, event = {}) {
  try {
    const db = getDB();
    const usuario = req?.session?.usuario;
    const clienteWeb = req?.session?.clienteWeb;
    await db.query(`
      INSERT INTO auditoria_eventos
        (usuario_id, cliente_web_id, accion, modulo, entidad, entidad_id,
         descripcion, datos_json, ip, user_agent)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [
      usuario?.id || null,
      clienteWeb?.id || null,
      String(event.accion || 'evento').slice(0, 80),
      String(event.modulo || 'sistema').slice(0, 60),
      String(event.entidad || '').slice(0, 80),
      String(event.entidad_id || '').slice(0, 80),
      String(event.descripcion || '').slice(0, 500),
      event.datos ? JSON.stringify(event.datos) : null,
      clientIp(req),
      String(req?.headers?.['user-agent'] || '').slice(0, 500)
    ]);
  } catch (error) {
    console.error('[AUDITORIA]', error.message);
  }
}

module.exports = { log, clientIp };
