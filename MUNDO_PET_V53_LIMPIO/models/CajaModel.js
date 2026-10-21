const { getDB } = require('../config/database');

// Fechas como texto, sin que el driver las mueva por zona horaria.
const F_ABRE   = "DATE_FORMAT(cs.abierta_at, '%Y-%m-%dT%H:%i:%s')";
const F_CIERRA = "DATE_FORMAT(cs.cerrada_at, '%Y-%m-%dT%H:%i:%s')";
const F_CONC   = "DATE_FORMAT(cs.conciliada_at, '%Y-%m-%dT%H:%i:%s')";

function baseSesionSelect() {
  return `
    SELECT cs.*,
           ${F_ABRE}   AS abierta_at,
           ${F_CIERRA} AS cerrada_at,
           ${F_CONC}   AS conciliada_at,
           u.nombre AS cajero_nombre,
           s.nombre AS sucursal_nombre,
           cf.codigo AS caja_fisica_codigo,
           cf.hora_apertura AS caja_hora_apertura,
           cf.hora_cierre AS caja_hora_cierre
      FROM caja_sesiones cs
      LEFT JOIN usuarios u ON u.id = cs.usuario_id
      LEFT JOIN sucursales s ON s.id = cs.sucursal_id
      LEFT JOIN cajas_fisicas cf ON cf.id = cs.caja_fisica_id
  `;
}

const CajaModel = {
  // Una sola sesión abierta por vendedor. Incluye nombres para mostrarla en UI.
  sesionAbiertaDe: async (usuarioId) => {
    const db = getDB();
    const [[row]] = await db.query(`
      ${baseSesionSelect()}
      WHERE cs.usuario_id = ? AND cs.estado = 'abierta'
      ORDER BY cs.id DESC
      LIMIT 1
    `, [usuarioId]);
    return row || null;
  },

  getUsuarioOperador: async (usuarioId) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT u.id, u.nombre, u.sucursal_id, u.estado, u.pin_cajero_hash,
             u.password_hash,u.es_global,u.puede_operar_caja,
             p.nombre AS perfil_nombre
        FROM usuarios u
        JOIN perfiles p ON p.id = u.perfil_id
       WHERE u.id = ?
    `, [usuarioId]);
    return row || null;
  },

  getById: async (id) => {
    const db = getDB();
    const [[row]] = await db.query(`
      ${baseSesionSelect()}
      WHERE cs.id = ?
    `, [id]);
    return row || null;
  },

  // Totales calculados desde movimientos: la fuente de verdad del arqueo.
  totales: async (sesionId) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'ingreso' AND venta_id IS NOT NULL THEN monto END), 0) AS total_ventas,
        COALESCE(SUM(CASE WHEN tipo = 'ingreso' AND venta_id IS NULL THEN monto END), 0) AS total_ingresos,
        COALESCE(SUM(CASE WHEN tipo = 'egreso' THEN monto END), 0) AS total_egresos
      FROM caja_movimientos
      WHERE sesion_id = ?
    `, [sesionId]);
    return {
      total_ventas: Number(row.total_ventas),
      total_ingresos: Number(row.total_ingresos),
      total_egresos: Number(row.total_egresos)
    };
  },

  getMovimientos: async (sesionId) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT m.id, m.tipo, m.concepto, m.monto, m.venta_id, m.usuario_id,
             DATE_FORMAT(m.created_at, '%Y-%m-%dT%H:%i:%s') AS created_at,
             u.nombre AS usuario_nombre,
             v.numero AS venta_numero
      FROM caja_movimientos m
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      LEFT JOIN ventas v ON v.id = m.venta_id
      WHERE m.sesion_id = ?
      ORDER BY m.id DESC
    `, [sesionId]);
    return rows;
  },

  // Cajas físicas para Apertura de caja. Incluye quién la opera si está abierta.
  getCajasFisicas: async (scope = {}) => {
    const db = getDB();
    let sql = `
      SELECT cf.id, cf.sucursal_id, cf.codigo, cf.orden, cf.activo,
             cf.monto_inicial_predeterminado,
             TIME_FORMAT(cf.hora_apertura, '%H:%i') AS hora_apertura,
             TIME_FORMAT(cf.hora_cierre, '%H:%i') AS hora_cierre,
             s.nombre AS sucursal_nombre,
             cs.id AS sesion_id,
             ${F_ABRE} AS abierta_at,
             u.id AS cajero_id,
             u.nombre AS cajero_nombre
      FROM cajas_fisicas cf
      JOIN sucursales s ON s.id = cf.sucursal_id
      LEFT JOIN caja_sesiones cs
        ON cs.caja_fisica_id = cf.id AND cs.estado = 'abierta'
      LEFT JOIN usuarios u ON u.id = cs.usuario_id
      WHERE 1 = 1
    `;
    const params = [];
    if (scope.sucursal_id) {
      sql += ' AND cf.sucursal_id = ?';
      params.push(scope.sucursal_id);
    }
    if (scope.solo_activas) sql += ' AND cf.activo = 1';
    sql += ' ORDER BY s.nombre, cf.orden, cf.id';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  getCajasDisponiblesDeSucursal: async (sucursalId) => {
    const cajas = await CajaModel.getCajasFisicas({ sucursal_id: sucursalId, solo_activas: true });
    return cajas.filter(c => !c.sesion_id);
  },

  actualizarCajaFisica: async (id, data) => {
    const db = getDB();
    await db.query(`
      UPDATE cajas_fisicas
         SET activo = ?, monto_inicial_predeterminado = ?,
             hora_apertura = ?, hora_cierre = ?, updated_at = NOW()
       WHERE id = ?
    `, [
      data.activo ? 1 : 0,
      data.monto_inicial_predeterminado,
      data.hora_apertura || null,
      data.hora_cierre || null,
      id
    ]);
  },

  getCajaFisicaById: async (id) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT cf.*, s.nombre AS sucursal_nombre
      FROM cajas_fisicas cf
      JOIN sucursales s ON s.id = cf.sucursal_id
      WHERE cf.id = ?
    `, [id]);
    return row || null;
  },

  // Apertura transaccional. Bloquea usuario y caja física, para que no haya dos
  // cajeros en una misma caja ni un cajero en dos cajas a la vez.
  abrir: async (data) => {
    const db = getDB();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [data.usuario_id]);
      const [[yaAbierta]] = await conn.query(`
        SELECT id FROM caja_sesiones
        WHERE usuario_id = ? AND estado = 'abierta'
        LIMIT 1
        FOR UPDATE
      `, [data.usuario_id]);
      if (yaAbierta) {
        const error = new Error('Ya tienes una caja abierta. Ciérrala antes de abrir otra.');
        error.code = 'CAJERO_CON_CAJA';
        throw error;
      }

      const [[cajaFisica]] = await conn.query(`
        SELECT id, sucursal_id, codigo, activo
        FROM cajas_fisicas
        WHERE id = ?
        FOR UPDATE
      `, [data.caja_fisica_id]);
      if (!cajaFisica) {
        const error = new Error('La caja seleccionada no existe.');
        error.code = 'CAJA_INEXISTENTE';
        throw error;
      }
      if (!cajaFisica.activo) {
        const error = new Error('Esta caja está deshabilitada.');
        error.code = 'CAJA_INACTIVA';
        throw error;
      }
      if (+cajaFisica.sucursal_id !== +data.sucursal_id) {
        const error = new Error('No puedes abrir una caja de otra sucursal.');
        error.code = 'SUCURSAL_INVALIDA';
        throw error;
      }

      const [[ocupada]] = await conn.query(`
        SELECT id FROM caja_sesiones
        WHERE caja_fisica_id = ? AND estado = 'abierta'
        LIMIT 1
        FOR UPDATE
      `, [data.caja_fisica_id]);
      if (ocupada) {
        const error = new Error('Esta caja ya está en uso por otro vendedor.');
        error.code = 'CAJA_OCUPADA';
        throw error;
      }

      const [[siguiente]] = await conn.query(`
        SELECT COALESCE(MAX(numero_caja), 0) + 1 AS proximo
        FROM caja_sesiones
        WHERE sucursal_id = ?
        FOR UPDATE
      `, [data.sucursal_id]);

      const [r] = await conn.query(`
        INSERT INTO caja_sesiones
          (sucursal_id, usuario_id, caja_fisica_id, numero_caja,
           monto_inicial, estado, observacion, abierta_at)
        VALUES (?, ?, ?, ?, ?, 'abierta', ?, ?)
      `, [
        data.sucursal_id, data.usuario_id, data.caja_fisica_id,
        siguiente.proximo, data.monto_inicial, data.observacion || '', data.abierta_at
      ]);

      await conn.commit();
      return r.insertId;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  },

  sesionesAbiertasVencidas: async ({ fecha, hora }) => {
    const db = getDB();
    const [rows] = await db.query(`
      ${baseSesionSelect()}
      WHERE cs.estado='abierta'
        AND (
          DATE(cs.abierta_at) < ?
          OR (
            DATE(cs.abierta_at) = ?
            AND cf.hora_cierre IS NOT NULL
            AND TIME(?) >= cf.hora_cierre
          )
        )
      ORDER BY cs.id
    `,[fecha,fecha,`${hora}:00`]);
    return rows;
  },

  insertMovimiento: async (connOrNull, data) => {
    const db = connOrNull || getDB();
    await db.query(`
      INSERT INTO caja_movimientos
        (sesion_id, sucursal_id, tipo, concepto, monto, venta_id, usuario_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.sesion_id, data.sucursal_id, data.tipo, data.concepto,
      data.monto, data.venta_id || null, data.usuario_id, data.created_at
    ]);
  },

  cerrar: async (id, data) => {
    const db = getDB();
    await db.query(`
      UPDATE caja_sesiones
         SET monto_final = ?,
             total_ventas = ?,
             total_ingresos = ?,
             total_egresos = ?,
             estado = 'cerrada',
             observacion = ?,
             cerrada_at = ?
       WHERE id = ? AND estado = 'abierta'
    `, [
      data.monto_final, data.total_ventas, data.total_ingresos,
      data.total_egresos, data.observacion || '', data.cerrada_at, id
    ]);
  },

  conciliar: async (id, usuarioId, ahora) => {
    const db = getDB();
    await db.query(`
      UPDATE caja_sesiones
         SET estado = 'conciliada',
             conciliada_por = ?,
             conciliada_at = ?
       WHERE id = ? AND estado = 'cerrada'
    `, [usuarioId, ahora, id]);
  },

  getAll: async (scope = {}, filtros = {}) => {
    const db = getDB();
    const { desde, hasta, estado } = filtros;
    let sql = `
      SELECT cs.id, cs.numero_caja, cs.caja_fisica_id, cs.sucursal_id, cs.usuario_id,
             cs.monto_inicial, cs.monto_final,
             cs.total_ventas, cs.total_ingresos, cs.total_egresos, cs.estado,
             ${F_ABRE} AS abierta_at,
             ${F_CIERRA} AS cerrada_at,
             ${F_CONC} AS conciliada_at,
             u.nombre AS cajero_nombre,
             s.nombre AS sucursal_nombre,
             cf.codigo AS caja_fisica_codigo
      FROM caja_sesiones cs
      LEFT JOIN usuarios u ON u.id = cs.usuario_id
      LEFT JOIN sucursales s ON s.id = cs.sucursal_id
      LEFT JOIN cajas_fisicas cf ON cf.id = cs.caja_fisica_id
      WHERE 1 = 1
    `;
    const params = [];
    if (scope.sucursal_id) { sql += ' AND cs.sucursal_id = ?'; params.push(scope.sucursal_id); }
    if (scope.usuario_id)  { sql += ' AND cs.usuario_id = ?'; params.push(scope.usuario_id); }
    if (desde) { sql += ' AND DATE(cs.abierta_at) >= ?'; params.push(desde); }
    if (hasta) { sql += ' AND DATE(cs.abierta_at) <= ?'; params.push(hasta); }
    if (estado) { sql += ' AND cs.estado = ?'; params.push(estado); }
    sql += ' ORDER BY cs.id DESC LIMIT 200';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  // ── CAJA DIGITAL: pagos no-efectivo (Yape/Plin/Transferencia/IziPay) ──
  listDigital: async (sid, filtros = {}) => {
    const db = getDB();
    const { desde, hasta, metodo, estado } = filtros;
    let sql = `
      SELECT p.id, p.metodo, p.monto, p.referencia,
             p.estado_conciliacion, p.conciliado_at,
             DATE_FORMAT(p.created_at, '%Y-%m-%dT%H:%i:%s') AS created_at,
             p.venta_id, v.numero AS venta_numero, v.sucursal_id,
             uc.nombre AS conciliado_por_nombre
      FROM pagos p
      LEFT JOIN ventas v ON v.id = p.venta_id
      LEFT JOIN usuarios uc ON uc.id = p.conciliado_por
      WHERE p.metodo <> 'efectivo'
    `;
    const params = [];
    if (sid) { sql += ' AND v.sucursal_id = ?'; params.push(sid); }
    if (desde) { sql += ' AND DATE(p.created_at) >= ?'; params.push(desde); }
    if (hasta) { sql += ' AND DATE(p.created_at) <= ?'; params.push(hasta); }
    if (metodo) { sql += ' AND p.metodo = ?'; params.push(metodo); }
    if (estado === 'pendiente') {
      sql += " AND (p.estado_conciliacion IS NULL OR p.estado_conciliacion = 'pendiente')";
    } else if (estado) {
      sql += ' AND p.estado_conciliacion = ?';
      params.push(estado);
    }
    sql += ' ORDER BY p.id DESC LIMIT 300';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  totalesDigital: async (sid, filtros = {}) => {
    const db = getDB();
    const { desde, hasta } = filtros;
    let sql = `
      SELECT p.metodo,
             COUNT(*) AS cantidad,
             COALESCE(SUM(p.monto), 0) AS total,
             COALESCE(SUM(CASE WHEN p.estado_conciliacion = 'conciliado' THEN p.monto END), 0) AS conciliado,
             COALESCE(SUM(CASE WHEN p.estado_conciliacion IS NULL OR p.estado_conciliacion IN ('pendiente', 'observado') THEN p.monto END), 0) AS pendiente
      FROM pagos p
      LEFT JOIN ventas v ON v.id = p.venta_id
      WHERE p.metodo <> 'efectivo'
    `;
    const params = [];
    if (sid) { sql += ' AND v.sucursal_id = ?'; params.push(sid); }
    if (desde) { sql += ' AND DATE(p.created_at) >= ?'; params.push(desde); }
    if (hasta) { sql += ' AND DATE(p.created_at) <= ?'; params.push(hasta); }
    sql += ' GROUP BY p.metodo';
    const [rows] = await db.query(sql, params);
    return rows;
  },


  paymentBreakdown: async (sesionId) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT COALESCE(NULLIF(LOWER(p.metodo),''),'sin_metodo') metodo,
             COUNT(*) operaciones, COALESCE(SUM(p.monto),0) total,
             SUM(CASE WHEN p.estado_conciliacion='conciliado' THEN 1 ELSE 0 END) conciliadas,
             SUM(CASE WHEN p.estado_conciliacion='observado' THEN 1 ELSE 0 END) observadas
      FROM caja_movimientos cm
      JOIN pagos p ON p.venta_id=cm.venta_id
      WHERE cm.sesion_id=? AND cm.venta_id IS NOT NULL
      GROUP BY COALESCE(NULLIF(LOWER(p.metodo),''),'sin_metodo')
      ORDER BY total DESC`, [sesionId]);
    return rows;
  },

  webSummary: async (sid, filtros = {}) => {
    const db = getDB();
    const { desde, hasta } = filtros;
    let scope = ` WHERE v.canal='web' AND v.estado_venta<>'anulada'`;
    const params=[];
    if (sid) { scope += ' AND v.sucursal_id=?'; params.push(Number(sid)); }
    if (desde) { scope += ' AND DATE(v.created_at)>=?'; params.push(desde); }
    if (hasta) { scope += ' AND DATE(v.created_at)<=?'; params.push(hasta); }
    const [[kpi]] = await db.query(`SELECT COUNT(*) ventas,COALESCE(SUM(v.total),0) total,
      COALESCE(AVG(v.total),0) ticket_promedio,COUNT(DISTINCT v.cliente_id) clientes,
      SUM(v.tipo_entrega='delivery') delivery,SUM(v.tipo_entrega='recojo') recojo
      FROM ventas v${scope}`, params);
    const [metodos] = await db.query(`SELECT COALESCE(NULLIF(LOWER(p.metodo),''),'sin_metodo') metodo,
      COUNT(*) operaciones,COALESCE(SUM(p.monto),0) total,
      SUM(CASE WHEN p.estado_conciliacion='conciliado' THEN p.monto ELSE 0 END) conciliado,
      SUM(CASE WHEN p.estado_conciliacion IS NULL OR p.estado_conciliacion<>'conciliado' THEN p.monto ELSE 0 END) pendiente
      FROM pagos p JOIN ventas v ON v.id=p.venta_id${scope.replace(' WHERE',' WHERE')}
      GROUP BY COALESCE(NULLIF(LOWER(p.metodo),''),'sin_metodo') ORDER BY total DESC`, params);
    const [ventas] = await db.query(`SELECT v.id,v.numero,v.total,v.metodo_pago,v.tipo_entrega,v.created_at,
      v.cliente_web_nombre cliente,v.cliente_web_doc documento,s.nombre sucursal,pw.numero_orden,
      COALESCE(p.estado_conciliacion,'pendiente') conciliacion,p.referencia codigo_operacion
      FROM ventas v LEFT JOIN sucursales s ON s.id=v.sucursal_id
      LEFT JOIN pedidos_web pw ON pw.id=v.pedido_web_id
      LEFT JOIN pagos p ON p.venta_id=v.id${scope}
      ORDER BY v.id DESC LIMIT 500`, params);
    const [porDia] = await db.query(`SELECT DATE_FORMAT(v.created_at,'%Y-%m-%d') fecha,COUNT(*) ventas,COALESCE(SUM(v.total),0) total
      FROM ventas v${scope} GROUP BY DATE(v.created_at) ORDER BY DATE(v.created_at)`, params);
    return { kpi, metodos, ventas, porDia };
  },

  conciliarPago: async (id, data) => {
    const db = getDB();
    await db.query(
      'UPDATE pagos SET estado_conciliacion = ?, conciliado_por = ?, conciliado_at = ? WHERE id = ?',
      [data.estado, data.usuario_id, data.conciliado_at, id]
    );
  }
};

module.exports = CajaModel;
