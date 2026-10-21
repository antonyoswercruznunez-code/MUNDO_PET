const { getDB } = require('../config/database');
const { getTableColumns } = require('../helpers/dbSchema');

// Nombre completo del cliente (razón social, o nombre + apellidos, o 'Cliente General')
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

// Fechas como texto, sin que el driver las mueva por zona horaria
const F_CREATED = "DATE_FORMAT(q.created_at, '%Y-%m-%dT%H:%i:%s')";
const F_VENCE   = "DATE_FORMAT(q.vence_at, '%Y-%m-%d')";

const CotizacionModel = {

  getAll: async (sid, filtros = {}) => {
    const db = getDB();
    const { desde, hasta, estado, buscar } = filtros;
    let sql = `
      SELECT q.id, q.cliente_id, q.sucursal_id, q.subtotal, q.descuento, q.igv, q.total,
             q.observacion, q.estado,
             ${F_CREATED} AS created_at,
             ${F_VENCE}   AS vence_at,
             ${NOMBRE_CLIENTE_SQL} AS cliente_nombre,
             c.numero_doc AS cliente_doc, c.tipo_doc,
             u.nombre AS vendedor_nombre,
             (SELECT COUNT(*) FROM cotizacion_items ci WHERE ci.cotizacion_id = q.id) AS items_count
      FROM cotizaciones q
      LEFT JOIN clientes c ON c.id = q.cliente_id
      LEFT JOIN usuarios u ON u.id = q.vendedor_id
      WHERE q.estado != 'eliminada'
    `;
    const params = [];
    if (sid)    { sql += ' AND q.sucursal_id = ?'; params.push(sid); }
    if (desde)  { sql += ' AND DATE(q.created_at) >= ?'; params.push(desde); }
    if (hasta)  { sql += ' AND DATE(q.created_at) <= ?'; params.push(hasta); }
    if (estado) { sql += ' AND q.estado = ?'; params.push(estado); }
    if (buscar) {
      sql += ' AND (c.nombre LIKE ? OR c.razon_social LIKE ? OR c.numero_doc LIKE ?)';
      const x = `%${buscar}%`; params.push(x, x, x);
    }
    sql += ' ORDER BY q.id DESC LIMIT 200';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  getById: async (id) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT q.*,
             ${F_CREATED} AS created_at,
             ${F_VENCE}   AS vence_at,
             ${NOMBRE_CLIENTE_SQL} AS cliente_nombre,
             c.numero_doc, c.tipo_doc, c.direccion, c.email AS cliente_email,
             u.nombre AS vendedor_nombre
      FROM cotizaciones q
      LEFT JOIN clientes c ON c.id = q.cliente_id
      LEFT JOIN usuarios u ON u.id = q.vendedor_id
      WHERE q.id = ?
    `, [id]);
    return row || null;
  },

  getItems: async (cotizacionId) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT ci.*, p.nombre AS producto_nombre, p.stock_actual, p.sucursal_id,
             pr.nombre AS presentacion_nombre
      FROM cotizacion_items ci
      JOIN productos p ON p.id = ci.producto_id
      LEFT JOIN presentaciones pr ON pr.id = ci.presentacion_id
      WHERE ci.cotizacion_id = ?
    `, [cotizacionId]);
    return rows;
  },

  // Cotizaciones vigentes (no vencidas) para cargar al hacer una venta
  getVigentes: async (sid, clienteId, hoy) => {
    const db = getDB();
    let sql = `
      SELECT q.id, q.total, q.subtotal, q.descuento,
             ${F_CREATED} AS created_at,
             ${F_VENCE}   AS vence_at,
             ${NOMBRE_CLIENTE_SQL} AS cliente_nombre,
             c.numero_doc AS cliente_doc, c.tipo_doc,
             (SELECT COUNT(*) FROM cotizacion_items ci WHERE ci.cotizacion_id = q.id) AS items_count
      FROM cotizaciones q
      LEFT JOIN clientes c ON c.id = q.cliente_id
      WHERE q.estado = 'vigente' AND DATE(q.vence_at) >= ?
    `;
    const params = [hoy];
    if (sid)       { sql += ' AND q.sucursal_id = ?'; params.push(sid); }
    if (clienteId) { sql += ' AND q.cliente_id = ?'; params.push(clienteId); }
    sql += ' ORDER BY q.id DESC LIMIT 100';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  // created_at se inserta EXPLÍCITO con hora de Perú (no el DEFAULT del servidor)
  crear: async (conn, data) => {
    const [r] = await conn.query(`
      INSERT INTO cotizaciones
        (cliente_id, sucursal_id, vendedor_id,
         subtotal, descuento, igv, total,
         observacion, estado, vence_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,'vigente',?,?)
    `, [data.cliente_id, data.sucursal_id, data.vendedor_id,
        data.subtotal, data.descuento, data.igv, data.total,
        data.observacion, data.vence_at, data.created_at]);
    return r.insertId;
  },

  insertItem: async (conn, data) => {
    await conn.query(`
      INSERT INTO cotizacion_items
        (cotizacion_id, producto_id, presentacion_id, cantidad, precio_unit, subtotal)
      VALUES (?,?,?,?,?,?)
    `, [data.cotizacion_id, data.producto_id, data.presentacion_id,
        data.cantidad, data.precio_unit, data.subtotal]);
  },

  getProductoStock: async (conn, productoId) => {
    const columns = await getTableColumns(conn, 'productos');
    const transferFields = [
      columns.has('es_transferido') ? 'es_transferido' : '0 AS es_transferido',
      columns.has('transferencia_venta_habilitada') ? 'transferencia_venta_habilitada' : '1 AS transferencia_venta_habilitada',
      columns.has('transferencia_venta_panel') ? 'transferencia_venta_panel' : (columns.has('transferencia_venta_habilitada') ? 'transferencia_venta_habilitada AS transferencia_venta_panel' : '1 AS transferencia_venta_panel')
    ];
    const [[row]] = await conn.query(
      `SELECT stock_actual,nombre,sucursal_id,${transferFields.join(',')} FROM productos WHERE id=? AND estado=0`, [productoId]
    );
    return row || null;
  },

  cambiarEstado: async (id, estado) => {
    const db = getDB();
    await db.query('UPDATE cotizaciones SET estado = ? WHERE id = ?', [estado, id]);
  },

  // Marca la cotización como convertida (se llama desde la transacción de la venta)
  marcarConvertida: async (conn, id) => {
    await conn.query("UPDATE cotizaciones SET estado = 'convertida' WHERE id = ?", [id]);
  },

  // Config para el correo (proforma por Gmail)
  getMailConfig: async () => {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT clave, valor FROM configuracion WHERE grupo = 'correo'"
    );
    return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  },
  getEmpresaConfig: async () => {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT clave, valor FROM configuracion WHERE grupo = 'empresa'"
    );
    return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  }

};

module.exports = CotizacionModel;