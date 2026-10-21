const { getDB } = require('../config/database');
const { getTableColumns } = require('../helpers/dbSchema');

// Nombre completo del cliente - modificado por Junior
const NOMBRE_CLIENTE_SQL = `
  COALESCE(
    NULLIF(TRIM(c.razon_social), ''),
    NULLIF(TRIM(CONCAT_WS(' ',
      NULLIF(TRIM(c.nombre), ''),
      NULLIF(TRIM(c.apellido_paterno), ''),
      NULLIF(TRIM(c.apellido_materno), '')
    )), ''),
    'Cliente General'
  )
`;

// Devuelve created_at como texto 'YYYY-MM-DDTHH:mm:ss' (hora local guardada, SIN
// que el driver la mueva por zona horaria). El navegador la lee como hora local.
const FECHA_FMT = "DATE_FORMAT(v.created_at, '%Y-%m-%dT%H:%i:%s')";

const VentaModel = {

  getAll: async (sid, filtros = {}) => {
    const db = getDB();
    const { desde, hasta, tipo, buscar } = filtros;
    let sql = `
      SELECT v.id, v.numero, v.serie, v.tipo_comprobante,
             v.tipo_venta, v.subtotal, v.igv, v.descuento, v.total,
             v.estado_venta, v.estado_sunat,
             ${FECHA_FMT} AS created_at,
             v.cotizacion_id,
             ${NOMBRE_CLIENTE_SQL} AS cliente_nombre,
             c.numero_doc AS cliente_doc, c.tipo_doc,
             c.email AS cliente_email, c.telefono AS cliente_telefono,
             u.nombre AS vendedor_nombre,
             v.sucursal_id, s.nombre AS sucursal_nombre
      FROM ventas v
      LEFT JOIN clientes c   ON c.id = v.cliente_id
      LEFT JOIN usuarios u   ON u.id = v.vendedor_id
      LEFT JOIN sucursales s ON s.id = v.sucursal_id
      WHERE v.estado_venta != 'eliminada'
    `;
    const params = [];
    if (sid)       { sql += ' AND v.sucursal_id = ?'; params.push(sid); }
    if (desde)     { sql += ' AND DATE(v.created_at) >= ?'; params.push(desde); }
    if (hasta)     { sql += ' AND DATE(v.created_at) <= ?'; params.push(hasta); }
    if (tipo)      { sql += ' AND v.tipo_comprobante = ?'; params.push(tipo); }
    if (buscar) {
      sql += ' AND (v.numero LIKE ? OR c.nombre LIKE ? OR c.razon_social LIKE ? OR c.numero_doc LIKE ?)';
      const q = `%${buscar}%`;
      params.push(q, q, q, q);
    }
    sql += ' ORDER BY v.id DESC LIMIT 200';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  getById: async (id) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT v.*,
             ${FECHA_FMT} AS created_at,
             ${NOMBRE_CLIENTE_SQL} AS cliente_nombre,
             c.numero_doc, c.tipo_doc, c.direccion, c.email AS cliente_email,
             u.nombre AS vendedor_nombre,
             s.nombre AS sucursal_nombre
      FROM ventas v
      LEFT JOIN clientes c   ON c.id = v.cliente_id
      LEFT JOIN usuarios u   ON u.id = v.vendedor_id
      LEFT JOIN sucursales s ON s.id = v.sucursal_id
      WHERE v.id = ?
    `, [id]);
    if (!row) return null;
    if (row.cliente_snapshot) {
      try {
        const c = typeof row.cliente_snapshot === 'string' ? JSON.parse(row.cliente_snapshot) : row.cliente_snapshot;
        row.cliente_nombre = c.razon_social || c.nombre_completo || [c.nombre,c.apellido_paterno,c.apellido_materno].filter(Boolean).join(' ') || row.cliente_nombre;
        row.numero_doc = c.numero_doc || row.numero_doc;
        row.tipo_doc = c.tipo_doc || row.tipo_doc;
        row.cliente_email = c.email || row.cliente_email;
        const d = row.direccion_snapshot ? (typeof row.direccion_snapshot === 'string' ? JSON.parse(row.direccion_snapshot) : row.direccion_snapshot) : {};
        row.direccion = d.direccion || c.direccion_api || row.direccion;
        row.cli_direccion = row.direccion;
      } catch (_) {}
    }
    return row;
  },

  getItems: async (ventaId) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT vi.*, p.nombre AS producto_nombre,
             pr.nombre AS presentacion_nombre
      FROM venta_items vi
      JOIN productos p ON p.id = vi.producto_id
      LEFT JOIN presentaciones pr ON pr.id = vi.presentacion_id
      WHERE vi.venta_id = ?
    `, [ventaId]);
    return rows;
  },

  getPagos: async (ventaId) => {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM pagos WHERE venta_id = ? ORDER BY id ASC',
      [ventaId]
    );
    return rows;
  },

  getIgvConfig: async (conn) => {
    const [[row]] = await conn.query(
      "SELECT valor FROM configuracion WHERE clave = 'igv_porcentaje'"
    );
    return parseFloat(row?.valor || 18) / 100;
  },

  getSerie: async (conn, serie) => {
    const [[row]] = await conn.query(
      'SELECT id, ultimo_numero FROM series_comprobante WHERE serie = ? FOR UPDATE',
      [serie]
    );
    return row || null;
  },

  incrementarSerie: async (conn, serieId, nuevoNum) => {
    await conn.query(
      'UPDATE series_comprobante SET ultimo_numero = ? WHERE id = ?',
      [nuevoNum, serieId]
    );
  },

  // created_at se inserta EXPLÍCITO con hora de Perú (no se usa el DEFAULT del servidor)
  insertVenta: async (conn, data) => {
    const [r] = await conn.query(`
      INSERT INTO ventas
        (cliente_id, sucursal_id, vendedor_id,
         tipo_venta, tipo_entrega, tipo_comprobante,
         serie, numero, subtotal, igv, descuento, total,
         observacion, cotizacion_id,
         estado_venta, estado_sunat, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'registrada','sin_emitir',?,?)
    `, [data.cliente_id, data.sucursal_id, data.vendedor_id,
        data.tipo_venta, data.tipo_entrega, data.tipo_comprobante,
        data.serie, data.numero, data.subtotal, data.igv,
        data.descuento, data.total, data.observacion,
        data.cotizacion_id, data.created_by, data.created_at]);
    return r.insertId;
  },

  insertItem: async (conn, data) => {
    await conn.query(`
      INSERT INTO venta_items
        (venta_id, producto_id, presentacion_id,
         cantidad, precio_unit, descuento, subtotal, sucursal_id, costo_unitario)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, [data.venta_id, data.producto_id, data.presentacion_id,
        data.cantidad, data.precio_unit, data.descuento, data.subtotal,
        data.sucursal_id || null, data.costo_unitario || 0]);
  },

  getProductoStock: async (conn, productoId) => {
    const columns = await getTableColumns(conn, 'productos');
    const transferFields = [
      columns.has('es_transferido') ? 'es_transferido' : '0 AS es_transferido',
      columns.has('transferencia_venta_habilitada') ? 'transferencia_venta_habilitada' : '1 AS transferencia_venta_habilitada',
      columns.has('transferencia_venta_panel') ? 'transferencia_venta_panel' : (columns.has('transferencia_venta_habilitada') ? 'transferencia_venta_habilitada AS transferencia_venta_panel' : '1 AS transferencia_venta_panel')
    ];
    const [[row]] = await conn.query(
      `SELECT stock_actual,nombre,sucursal_id,precio_costo,${transferFields.join(',')} FROM productos WHERE id=? AND estado=0 FOR UPDATE`,
      [productoId]
    );
    return row || null;
  },

  descontarStock: async (conn, productoId, cantidad) => {
    await conn.query(
      'UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?',
      [cantidad, productoId]
    );
  },

  reponerStock: async (conn, productoId, cantidad) => {
    await conn.query(
      'UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?',
      [cantidad, productoId]
    );
  },

  insertMovimiento: async (conn, data) => {
    await conn.query(`
      INSERT INTO inventario_movimientos
        (producto_id, tipo, cantidad, stock_antes, stock_despues,
         referencia, usuario_id, sucursal_id)
      VALUES (?,?,?,?,?,?,?,?)
    `, [data.producto_id, data.tipo, data.cantidad,
        data.stock_antes, data.stock_despues,
        data.referencia, data.usuario_id, data.sucursal_id]);
  },

  insertPago: async (conn, data) => {
    const method=String(data.metodo||'efectivo').toLowerCase();
    const reference=String(data.referencia||'').trim().replace(/\s+/g,' ').toUpperCase().slice(0,100);
    if(reference && ['yape','plin','transferencia','izipay'].includes(method)){
      try {
        await conn.query('INSERT INTO pagos_operaciones_unicas (metodo,referencia,venta_id) VALUES (?,?,?)',[method,reference,data.venta_id]);
      } catch(error) {
        if(error.code==='ER_DUP_ENTRY')throw new Error(`El código "${reference}" de ${method} ya fue registrado antes. No se puede repetir.`);
        throw error;
      }
    }
    let [[mp]] = await conn.query('SELECT id FROM metodos_pago WHERE LOWER(nombre)=LOWER(?) LIMIT 1', [method]);
    if (!mp) {
      const [r] = await conn.query('INSERT INTO metodos_pago (nombre,estado) VALUES (?,0)', [method]);
      mp = { id:r.insertId };
    }
    const [payment]=await conn.query(`
      INSERT INTO pagos (venta_id, metodo, metodo_pago_id, monto, referencia, estado_conciliacion)
      VALUES (?,?,?,?,?,?)
    `, [data.venta_id, method, mp.id, data.monto, reference,
        ['yape','plin','transferencia','izipay'].includes(method) ? 'pendiente' : 'conciliado']);
    if(reference && ['yape','plin','transferencia','izipay'].includes(method)){
      await conn.query('UPDATE pagos_operaciones_unicas SET pago_id=? WHERE referencia=?',[payment.insertId,reference]);
    }
    return payment.insertId;
  },

  // ¿Ya existe ese código (referencia) para ese método de pago? (no se puede repetir nunca)
  existeCodigoPago: async (conn, metodo, referencia) => {
    const [[row]] = await conn.query(
      'SELECT 1 AS x FROM pagos WHERE metodo = ? AND referencia = ? LIMIT 1',
      [metodo, referencia]
    );
    return !!row;
  },

  marcarCotizacionConvertida: async (conn, cotizacionId) => {
    // Revalida DENTRO de la transacción que la cotización siga disponible.
    // Bloquea la fila (FOR UPDATE) para evitar que dos ventas la usen a la vez.
    const [[q]] = await conn.query(
      'SELECT estado FROM cotizaciones WHERE id = ? FOR UPDATE',
      [cotizacionId]
    );
    if (!q)
      throw new Error('La cotización ya no existe');
    if (q.estado !== 'vigente')
      throw new Error('Esa cotización ya no está disponible (fue convertida, anulada o eliminada)');
    await conn.query(
      "UPDATE cotizaciones SET estado = 'convertida' WHERE id = ?",
      [cotizacionId]
    );
  },

  anular: async (conn, ventaId, userId) => {
    await conn.query(
      "UPDATE ventas SET estado_venta = 'anulada', updated_by = ? WHERE id = ?",
      [userId, ventaId]
    );
  },

  getVentaItems: async (conn, ventaId) => {
    const [rows] = await conn.query(
      'SELECT * FROM venta_items WHERE venta_id = ?', [ventaId]
    );
    return rows;
  },

  getFacturacionConfig: async () => {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT clave, valor FROM configuracion WHERE grupo = 'facturacion'"
    );
    return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  },

  // Datos completos de la venta para armar el comprobante (cli_nombre = nombre completo)
  getVentaParaEmitir: async (id) => {
    const db = getDB();
    const [[venta]] = await db.query(`
      SELECT v.*,
             ${FECHA_FMT} AS created_at,
             ${NOMBRE_CLIENTE_SQL} AS cli_nombre,
             c.numero_doc, c.tipo_doc, c.direccion AS cli_direccion
      FROM ventas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = ?
    `, [id]);
    if (!venta) return null;

    const [items] = await db.query(`
      SELECT vi.*, p.nombre AS producto_nombre
      FROM venta_items vi
      JOIN productos p ON p.id = vi.producto_id
      WHERE vi.venta_id = ?
    `, [id]);

    return { venta, items };
  },

  getMailConfig: async () => {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT clave, valor FROM configuracion WHERE grupo = 'correo'"
    );
    return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  },

  actualizarCliente: async (ventaId, clienteId) => {
    const db = getDB();
    await db.query(
      'UPDATE ventas SET cliente_id = ? WHERE id = ?',
      [clienteId, ventaId]
    );
  },

  getEmpresaConfig: async () => {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT clave, valor FROM configuracion WHERE grupo = 'empresa'"
    );
    return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  }

};

module.exports = VentaModel;