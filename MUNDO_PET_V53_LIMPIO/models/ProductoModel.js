const { getDB } = require('../config/database');
const { getTableColumns } = require('../helpers/dbSchema');
const path = require('path');
const fs = require('fs');

function optionalProductSql(columns) {
  const hasOrigenProducto = columns.has('producto_origen_id');
  const hasOrigenSucursal = columns.has('sucursal_origen_id');

  return {
    select: [
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
    ].join(',\n             '),
    joins: [
      hasOrigenSucursal ? 'LEFT JOIN sucursales so ON so.id = p.sucursal_origen_id' : '',
      hasOrigenProducto ? 'LEFT JOIN productos po ON po.id = p.producto_origen_id' : ''
    ].filter(Boolean).join('\n      ')
  };
}

function pushField(columns, names, values, field, value) {
  if (!columns.has(field)) return;
  names.push(`\`${field}\``);
  values.push(value);
}

const ProductoModel = {
  getAll: async (sid) => {
    const db = getDB();
    const columns = await getTableColumns(db, 'productos');
    const optional = optionalProductSql(columns);
    let sql = `
      SELECT p.*,
             s.nombre AS sucursal_nombre,
             ${optional.select},
             (SELECT pi.ruta FROM producto_imagenes pi
              WHERE pi.producto_id = p.id AND pi.es_portada = 1
              ORDER BY pi.id ASC LIMIT 1) AS imagen_portada
      FROM productos p
      LEFT JOIN sucursales s ON s.id = p.sucursal_id
      ${optional.joins}
      WHERE p.estado != 2`;
    const params = [];
    if (sid) {
      sql += ' AND (p.sucursal_id = ? OR p.sucursal_id IS NULL)';
      params.push(sid);
    }
    sql += ' ORDER BY p.nombre ASC, p.id ASC';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  getById: async (id) => {
    const db = getDB();
    const columns = await getTableColumns(db, 'productos');
    const optional = optionalProductSql(columns);
    const [[row]] = await db.query(`
      SELECT p.*,
             s.nombre AS sucursal_nombre,
             ${optional.select}
      FROM productos p
      LEFT JOIN sucursales s ON s.id = p.sucursal_id
      ${optional.joins}
      WHERE p.id = ? AND p.estado != 2
    `, [id]);
    return row || null;
  },

  getImagenes: async (productoId) => {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM producto_imagenes WHERE producto_id = ? ORDER BY es_portada DESC, orden ASC, id ASC',
      [productoId]
    );
    return rows;
  },

  getPresentaciones: async (productoId) => {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM presentaciones WHERE producto_id = ? AND estado != 2 ORDER BY es_principal DESC, id ASC',
      [productoId]
    );
    return rows;
  },

  crear: async (data, userId) => {
    const db = getDB();
    const columns = await getTableColumns(db, 'productos');
    const names = [];
    const values = [];

    pushField(columns, names, values, 'nombre', data.nombre);
    pushField(columns, names, values, 'descripcion', data.descripcion);
    pushField(columns, names, values, 'marca', data.marca);
    pushField(columns, names, values, 'precio_costo', data.precio_costo);
    pushField(columns, names, values, 'precio_venta', data.precio_venta);
    pushField(columns, names, values, 'porcentaje_oferta', data.porcentaje_oferta);
    pushField(columns, names, values, 'stock_actual', data.stock_actual);
    pushField(columns, names, values, 'stock_minimo', data.stock_minimo);
    pushField(columns, names, values, 'garantia_meses', data.garantia_meses);
    pushField(columns, names, values, 'atributo_extra', data.atributo_extra);
    pushField(columns, names, values, 'sucursal_id', data.sucursal_id);
    pushField(columns, names, values, 'estado', 0);
    pushField(columns, names, values, 'es_transferido', 0);
    pushField(columns, names, values, 'transferencia_venta_habilitada', 1);
    pushField(columns, names, values, 'transferencia_venta_panel', 1);
    pushField(columns, names, values, 'transferencia_venta_web', 1);

    const [r] = await db.query(
      `INSERT INTO productos (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
      values
    );

    if (Number(data.stock_actual) > 0) {
      await db.query(`
        INSERT INTO inventario_movimientos
          (producto_id, tipo, cantidad, stock_antes, stock_despues,
           referencia, usuario_id, sucursal_id)
        VALUES (?,?,?,?,?,?,?,?)
      `, [r.insertId, 'INGRESO_INICIAL', Number(data.stock_actual),
          0, Number(data.stock_actual), 'Stock inicial', userId, data.sucursal_id]);
    }
    return r.insertId;
  },

  actualizar: async (id, data) => {
    const db = getDB();
    await db.query(`
      UPDATE productos SET
        nombre=?, descripcion=?, marca=?, precio_costo=?, precio_venta=?,
        porcentaje_oferta=?, stock_minimo=?, garantia_meses=?,
        atributo_extra=?, estado=?
      WHERE id=?
    `, [
      data.nombre, data.descripcion, data.marca,
      data.precio_costo, data.precio_venta, data.porcentaje_oferta,
      data.stock_minimo, data.garantia_meses, data.atributo_extra,
      data.estado, id
    ]);
  },

  cambiarEstado: async (id, estado) => {
    const db = getDB();
    await db.query('UPDATE productos SET estado = ? WHERE id = ?', [estado, id]);
  },

  cambiarVentaTransferida: async (id, canales = {}) => {
    const db = getDB();
    const columns = await getTableColumns(db, 'productos');
    if (!columns.has('es_transferido')) return false;
    const panel = canales.panel ? 1 : 0;
    const web = canales.web ? 1 : 0;
    const sets = [];
    const values = [];
    if (columns.has('transferencia_venta_panel')) { sets.push('transferencia_venta_panel=?'); values.push(panel); }
    if (columns.has('transferencia_venta_web')) { sets.push('transferencia_venta_web=?'); values.push(web); }
    if (columns.has('transferencia_venta_habilitada')) { sets.push('transferencia_venta_habilitada=?'); values.push(panel || web ? 1 : 0); }
    if (!sets.length) return false;
    values.push(id);
    await db.query(`UPDATE productos SET ${sets.join(',')} WHERE id=? AND es_transferido=1`, values);
    return true;
  },

  eliminar: async (id) => {
    const db = getDB();
    await db.query('UPDATE productos SET estado = 2 WHERE id = ?', [id]);
  },

  addImagen: async (productoId, rutaBD, esPortada) => {
    const db = getDB();
    const [r] = await db.query(
      'INSERT INTO producto_imagenes (producto_id, ruta, es_portada, orden) VALUES (?,?,?,0)',
      [productoId, rutaBD, esPortada ? 1 : 0]
    );
    return r.insertId;
  },

  getImagenById: async (imgId) => {
    const db = getDB();
    const [[row]] = await db.query('SELECT * FROM producto_imagenes WHERE id = ?', [imgId]);
    return row || null;
  },

  deleteImagen: async (imgId) => {
    const db = getDB();
    await db.query('DELETE FROM producto_imagenes WHERE id = ?', [imgId]);
  },

  asignarPortadaSiguiente: async (productoId) => {
    const db = getDB();
    const [[siguiente]] = await db.query(
      'SELECT id FROM producto_imagenes WHERE producto_id = ? ORDER BY id ASC LIMIT 1',
      [productoId]
    );
    if (siguiente) {
      await db.query('UPDATE producto_imagenes SET es_portada = 1 WHERE id = ?', [siguiente.id]);
    }
  },

  setPortada: async (productoId, imgId) => {
    const db = getDB();
    await db.query('UPDATE producto_imagenes SET es_portada = 0 WHERE producto_id = ?', [productoId]);
    await db.query('UPDATE producto_imagenes SET es_portada = 1 WHERE id = ? AND producto_id = ?', [imgId, productoId]);
  },

  getVolumenes: async (productoId) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT pv.*,
             p.precio_venta AS precio_normal,
             p.precio_costo,
             (p.precio_venta - pv.precio_unit) AS ahorro_unitario,
             (pv.precio_unit - p.precio_costo) AS margen_unitario,
             CASE
               WHEN pv.precio_unit < p.precio_costo THEN 'perdida'
               WHEN pv.precio_unit = p.precio_costo THEN 'sin_margen'
               ELSE 'ganancia'
             END AS resultado
      FROM precios_volumen pv
      JOIN productos p ON p.id = pv.producto_id
      WHERE pv.producto_id = ?
      ORDER BY pv.cantidad_desde ASC
    `, [productoId]);
    return rows;
  },

  getVolumenById: async (id) => {
    const db = getDB();
    const [[row]] = await db.query('SELECT * FROM precios_volumen WHERE id = ?', [id]);
    return row || null;
  },

  addVolumen: async (productoId, cantidadDesde, precioUnit) => {
    const db = getDB();
    const [r] = await db.query(
      'INSERT INTO precios_volumen (producto_id, cantidad_desde, precio_unit) VALUES (?,?,?)',
      [productoId, cantidadDesde, precioUnit]
    );
    return r.insertId;
  },

  deleteVolumen: async (id) => {
    const db = getDB();
    await db.query('DELETE FROM precios_volumen WHERE id = ?', [id]);
  },

  precioPorCantidad: async (productoId, cantidad, precioBase) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT precio_unit FROM precios_volumen
      WHERE producto_id = ? AND cantidad_desde <= ?
      ORDER BY cantidad_desde DESC LIMIT 1
    `, [productoId, cantidad]);
    return row ? Number(row.precio_unit) : Number(precioBase);
  },

  eliminarArchivo: (ruta) => {
    const raw = String(ruta || '').replace(/\\/g, '/');
    const allowed = raw.startsWith('/media/productos/') || raw.startsWith('/uploads/productos/');
    if (!allowed || raw.includes('..')) return false;
    const publicRoot = path.resolve(__dirname, '../public');
    const rutaFisica = path.resolve(publicRoot, raw.replace(/^\/+/, ''));
    if (!rutaFisica.startsWith(publicRoot + path.sep)) return false;
    if (fs.existsSync(rutaFisica)) fs.unlinkSync(rutaFisica);
    return true;
  }
};

module.exports = ProductoModel;
