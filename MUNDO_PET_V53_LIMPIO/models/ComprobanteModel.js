const { getDB } = require('../config/database');

const ComprobanteModel = {

  getByVenta: async (ventaId) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT *,
             DATE_FORMAT(emitido_at,  '%Y-%m-%dT%H:%i:%s') AS emitido_at,
             DATE_FORMAT(enviado_at,  '%Y-%m-%dT%H:%i:%s') AS enviado_at,
             DATE_FORMAT(aceptado_at, '%Y-%m-%dT%H:%i:%s') AS aceptado_at
      FROM comprobantes WHERE venta_id = ?
    `, [ventaId]);
    return row || null;
  },

  getById: async (id) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT *,
             DATE_FORMAT(emitido_at,  '%Y-%m-%dT%H:%i:%s') AS emitido_at,
             DATE_FORMAT(enviado_at,  '%Y-%m-%dT%H:%i:%s') AS enviado_at,
             DATE_FORMAT(aceptado_at, '%Y-%m-%dT%H:%i:%s') AS aceptado_at
      FROM comprobantes WHERE id = ?
    `, [id]);
    return row || null;
  },

  // ── Crear comprobante en CUALQUIER estado (generado / aceptado / observado / rechazado / pendiente) ──
  // Se usa apenas MiAPI genera y firma el XML (paso invoice/create), antes de saber la respuesta de SUNAT.
  crear: async (conn, data) => {
    const fp = data.fecha_peru;   // 'YYYY-MM-DD HH:mm:ss'
    const [r] = await conn.query(`
      INSERT INTO comprobantes
        (venta_id, tipo, serie, numero, numero_full, hash_cpe,
         op_tributaria, subtotal, igv, total,
         xml_path, xml_sin_firmar_path, pdf_a4_path, pdf_ticket_path, cdr_path,
         estado_sunat, cdr_estado, cdr_codigo, cdr_mensaje,
         sunat_response, emitido_at, enviado_at, aceptado_at, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      data.venta_id, data.tipo, data.serie, data.numero, data.numero_full,
      data.hash_cpe || null, 'Gravada (0101)',
      data.subtotal, data.igv, data.total,
      data.xml_path || null, data.xml_sin_firmar_path || null,
      data.pdf_a4_path || null, data.pdf_ticket_path || null, data.cdr_path || null,
      data.estado_sunat || 'emitido',
      data.cdr_estado   || 'pendiente',
      data.cdr_codigo   || null,
      data.cdr_mensaje  || '',
      data.sunat_response || null,
      fp,                              // emitido_at (siempre)
      data.enviado_at  || null,        // enviado_at  (si ya se envió)
      data.aceptado_at || null,        // aceptado_at (si ya fue aceptado)
      data.created_by
    ]);
    return r.insertId;
  },

  // ── Actualizar el comprobante DESPUÉS de enviarlo a SUNAT (invoice/send) ──
  actualizarEnvio: async (id, data) => {
    const db = getDB();
    await db.query(`
      UPDATE comprobantes SET
        estado_sunat   = ?,
        cdr_estado     = ?,
        cdr_codigo     = ?,
        cdr_mensaje    = ?,
        cdr_path       = COALESCE(?, cdr_path),
        hash_cpe       = COALESCE(?, hash_cpe),
        sunat_response = ?,
        enviado_at     = ?,
        aceptado_at    = ?
      WHERE id = ?
    `, [
      data.estado_sunat,
      data.cdr_estado,
      data.cdr_codigo || null,
      data.cdr_mensaje || '',
      data.cdr_path || null,
      data.hash_cpe || null,
      data.sunat_response || null,
      data.enviado_at  || null,
      data.aceptado_at || null,
      id
    ]);
  },

  // ── Borrar el comprobante de una venta (para REEMITIR uno rechazado) ──
  eliminarPorVenta: async (conn, ventaId) => {
    await conn.query('DELETE FROM comprobantes WHERE venta_id = ?', [ventaId]);
  },

  guardarHash: async (id, hash) => {
    const db = getDB();
    await db.query('UPDATE comprobantes SET hash_cpe = ? WHERE id = ?', [hash, id]);
  }

};

module.exports = ComprobanteModel;