const { getDB } = require('../config/database');
const { getTableColumns } = require('../helpers/dbSchema');

const InventarioModel = {
  getStock: async (sid) => {
    const db = getDB();
    const columns = await getTableColumns(db, 'productos');
    const hasOrigenProducto = columns.has('producto_origen_id');
    const hasOrigenSucursal = columns.has('sucursal_origen_id');
    const optionalSelect = [
      columns.has('es_transferido') ? 'p.es_transferido' : '0 AS es_transferido',
      hasOrigenProducto ? 'p.producto_origen_id' : 'NULL AS producto_origen_id',
      hasOrigenSucursal ? 'p.sucursal_origen_id' : 'NULL AS sucursal_origen_id',
      columns.has('transferencia_venta_habilitada')
        ? 'p.transferencia_venta_habilitada'
        : '1 AS transferencia_venta_habilitada',
      columns.has('transferencia_venta_panel')
        ? 'p.transferencia_venta_panel'
        : (columns.has('transferencia_venta_habilitada') ? 'p.transferencia_venta_habilitada AS transferencia_venta_panel' : '1 AS transferencia_venta_panel'),
      columns.has('transferencia_venta_web')
        ? 'p.transferencia_venta_web'
        : (columns.has('transferencia_venta_habilitada') ? 'p.transferencia_venta_habilitada AS transferencia_venta_web' : '1 AS transferencia_venta_web'),
      hasOrigenSucursal ? 'so.nombre AS sucursal_origen_nombre' : 'NULL AS sucursal_origen_nombre',
      hasOrigenProducto ? 'po.nombre AS producto_origen_nombre' : 'NULL AS producto_origen_nombre'
    ].join(',\n             ');
    const optionalJoins = [
      hasOrigenSucursal ? 'LEFT JOIN sucursales so ON so.id = p.sucursal_origen_id' : '',
      hasOrigenProducto ? 'LEFT JOIN productos po ON po.id = p.producto_origen_id' : ''
    ].filter(Boolean).join('\n      ');

    let sql = `
      SELECT p.id, p.nombre, p.stock_actual, p.stock_minimo,
             p.precio_costo, p.precio_venta, p.sucursal_id,
             ${optionalSelect},
             s.nombre AS sucursal_nombre,
             (p.stock_actual * p.precio_costo) AS valor_total,
             CASE WHEN p.stock_actual <= p.stock_minimo THEN 'critico' ELSE 'optimo' END AS estado_stock,
             (SELECT pi.ruta FROM producto_imagenes pi
              WHERE pi.producto_id = p.id AND pi.es_portada = 1
              ORDER BY pi.id ASC LIMIT 1) AS imagen_portada
      FROM productos p
      LEFT JOIN sucursales s ON s.id = p.sucursal_id
      ${optionalJoins}
      WHERE p.estado = 0`;
    const params = [];
    if (sid) {
      sql += ' AND (p.sucursal_id = ? OR p.sucursal_id IS NULL)';
      params.push(sid);
    }
    sql += ' ORDER BY p.nombre ASC, p.id ASC';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  getMovimientos: async (productoId) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT m.*, u.nombre AS usuario_nombre, s.nombre AS sucursal_nombre
      FROM inventario_movimientos m
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      LEFT JOIN sucursales s ON s.id = m.sucursal_id
      WHERE m.producto_id = ?
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 200
    `, [productoId]);
    return rows;
  },

  getProductoParaUpdate: async (conn, productoId) => {
    const [[row]] = await conn.query(
      `SELECT id,nombre,descripcion,marca,precio_costo,precio_venta,
              porcentaje_oferta,stock_actual,stock_minimo,garantia_meses,
              atributo_extra,sucursal_id,estado
       FROM productos WHERE id = ? AND estado <> 2 FOR UPDATE`,
      [productoId]
    );
    return row || null;
  },

  updateStock: async (conn, productoId, nuevoStock) => {
    await conn.query('UPDATE productos SET stock_actual = ? WHERE id = ?', [nuevoStock, productoId]);
  },

  insertMovimiento: async (conn, data) => {
    await conn.query(`
      INSERT INTO inventario_movimientos
        (producto_id, tipo, cantidad, stock_antes, stock_despues,
         referencia, usuario_id, sucursal_id)
      VALUES (?,?,?,?,?,?,?,?)
    `, [data.producto_id, data.tipo, data.cantidad, data.stock_antes,
        data.stock_despues, data.referencia, data.usuario_id, data.sucursal_id]);
  }
};

module.exports = InventarioModel;
