const { wrap } = require('../helpers/response');
const InventarioModel = require('../models/InventarioModel');
const { getDB } = require('../config/database');
const { userScope, hasPermission } = require('../middleware/permisos');
const Audit = require('../services/AuditService');

function esGlobal(req) {
  return Boolean(req.session?.usuario?.es_global);
}

function exigirGlobal(req, res) {
  if (!esGlobal(req)) {
    res.status(403).json({ ok: false, msg: 'Solo el administrador global puede transferir productos entre sucursales' });
    return false;
  }
  return true;
}

function getSucursal(req) {
  return esGlobal(req) ? null : (req.session?.usuario?.sucursal_id || null);
}

function error(msg, status = 400) {
  return Object.assign(new Error(msg), { status });
}

const InventarioController = {
  stock: wrap(async (req, res) => {
    const stock = await InventarioModel.getStock(getSucursal(req));
    const puedeVerCosto = await hasPermission(req, 'productos.ver_costo') || await hasPermission(req, 'reportes.ver_costos');
    const resumen = {
      total_productos: stock.length,
      stock_critico: stock.filter(p => p.estado_stock === 'critico').length,
      stock_optimo: stock.filter(p => p.estado_stock === 'optimo').length,
      valor_total: puedeVerCosto ? stock.reduce((a, p) => a + (Number(p.valor_total) || 0), 0) : null
    };
    if (!puedeVerCosto) stock.forEach(p => { delete p.precio_costo; delete p.valor_total; });
    res.json({ ok: true, stock, resumen, puede_ver_costo: puedeVerCosto, puede_transferir: esGlobal(req) });
  }),

  movimientos: wrap(async (req, res) => {
    const db = getDB();
    const [[p]] = await db.query('SELECT sucursal_id FROM productos WHERE id=? AND estado<>2', [Number(req.params.productoId)]);
    const scope = userScope(req);
    if (!p || (!scope.isGlobal && p.sucursal_id && Number(p.sucursal_id) !== Number(scope.sucursalId))) {
      return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    }
    res.json({ ok: true, movimientos: await InventarioModel.getMovimientos(Number(req.params.productoId)) });
  }),

  reponer: wrap(async (req, res) => {
    const db = getDB();
    const u = req.session.usuario;
    const productoId = Number(req.body.producto_id);
    const cantidad = Number(req.body.cantidad);
    const tipo = String(req.body.tipo || 'entrada').toLowerCase();
    if (!productoId || !Number.isFinite(cantidad) || cantidad < 1) return res.status(400).json({ ok: false, msg: 'Producto y cantidad requeridos' });
    if (!['entrada', 'salida'].includes(tipo)) return res.status(400).json({ ok: false, msg: 'Tipo de movimiento inválido' });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const p = await InventarioModel.getProductoParaUpdate(conn, productoId);
      if (!p) throw error('Producto no encontrado', 404);
      const scope = userScope(req);
      if (!scope.isGlobal && p.sucursal_id && Number(p.sucursal_id) !== Number(scope.sucursalId)) throw error('Producto fuera de tu sucursal', 403);
      if (tipo === 'salida' && Number(p.stock_actual) < cantidad) throw error(`Stock insuficiente. Stock actual: ${p.stock_actual}`, 409);
      const nuevo = tipo === 'entrada' ? Number(p.stock_actual) + cantidad : Number(p.stock_actual) - cantidad;
      await InventarioModel.updateStock(conn, productoId, nuevo);
      const referencia = [req.body.motivo, req.body.referencia && `Ref: ${req.body.referencia}`, req.body.observacion]
        .filter(Boolean).map(v => String(v).trim().slice(0, 250)).join(' | ');
      await InventarioModel.insertMovimiento(conn, {
        producto_id: productoId,
        tipo: tipo === 'entrada' ? 'ENTRADA' : 'SALIDA',
        cantidad, stock_antes: p.stock_actual, stock_despues: nuevo,
        referencia, usuario_id: u.id, sucursal_id: p.sucursal_id || null
      });
      await conn.commit();
      res.json({ ok: true, msg: 'Movimiento registrado', stock_nuevo: nuevo });
    } catch (e) {
      await conn.rollback();
      res.status(e.status || 400).json({ ok: false, msg: e.message });
    } finally { conn.release(); }
  }),

  ajuste: wrap(async (req, res) => {
    const db = getDB();
    const u = req.session.usuario;
    const productoId = Number(req.body.producto_id);
    const cantidad = Number(req.body.cantidad);
    const tipo = String(req.body.tipo || '');
    if (!productoId || !Number.isFinite(cantidad) || cantidad < 0) return res.status(400).json({ ok: false, msg: 'Datos incompletos o cantidad inválida' });
    if (!['absoluto', 'entrada', 'salida'].includes(tipo)) return res.status(400).json({ ok: false, msg: 'Tipo de ajuste inválido' });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const p = await InventarioModel.getProductoParaUpdate(conn, productoId);
      if (!p) throw error('Producto no encontrado', 404);
      const scope = userScope(req);
      if (!scope.isGlobal && p.sucursal_id && Number(p.sucursal_id) !== Number(scope.sucursalId)) throw error('Producto fuera de tu sucursal', 403);
      let nuevo;
      let tipoMov;
      if (tipo === 'absoluto') { nuevo = cantidad; tipoMov = 'AJUSTE_MANUAL'; }
      if (tipo === 'entrada') { nuevo = Number(p.stock_actual) + cantidad; tipoMov = 'AJUSTE_ENTRADA'; }
      if (tipo === 'salida') {
        if (Number(p.stock_actual) < cantidad) throw error('Stock insuficiente para el ajuste', 409);
        nuevo = Number(p.stock_actual) - cantidad;
        tipoMov = 'AJUSTE_SALIDA';
      }
      await InventarioModel.updateStock(conn, productoId, nuevo);
      const referencia = [req.body.observacion, req.body.referencia && `Ref: ${req.body.referencia}`]
        .filter(Boolean).map(v => String(v).trim().slice(0, 250)).join(' | ');
      await InventarioModel.insertMovimiento(conn, {
        producto_id: productoId, tipo: tipoMov,
        cantidad: Math.abs(nuevo - Number(p.stock_actual)),
        stock_antes: p.stock_actual, stock_despues: nuevo,
        referencia, usuario_id: u.id, sucursal_id: p.sucursal_id || null
      });
      await conn.commit();
      res.json({ ok: true, msg: 'Ajuste registrado', stock_nuevo: nuevo });
    } catch (e) {
      await conn.rollback();
      res.status(e.status || 400).json({ ok: false, msg: e.message });
    } finally { conn.release(); }
  }),

  candidatosTransferencia: wrap(async (req, res) => {
    if (!exigirGlobal(req, res)) return;
    const db = getDB();
    const originId = Number(req.query.origen_id);
    if (!originId) return res.status(400).json({ ok: false, msg: 'Selecciona el producto de origen' });
    const [[origen]] = await db.query(
      'SELECT id,nombre,sucursal_id,stock_actual FROM productos WHERE id=? AND estado=0',
      [originId]
    );
    if (!origen) return res.status(404).json({ ok: false, msg: 'Producto de origen no encontrado' });
    if (!origen.sucursal_id) return res.status(409).json({ ok: false, msg: 'El producto de origen debe pertenecer a una sucursal' });
    const [sucursales] = await db.query(`
      SELECT s.id AS sucursal_id, s.nombre AS sucursal_nombre,
             p.id AS producto_destino_id, p.stock_actual AS stock_destino,
             CASE WHEN p.id IS NULL THEN 1 ELSE 0 END AS se_creara_producto
      FROM sucursales s
      LEFT JOIN productos p
        ON p.sucursal_id = s.id AND p.estado <> 2
       AND LOWER(TRIM(p.nombre)) = LOWER(TRIM(?))
      WHERE s.estado = 0 AND s.id <> ?
      ORDER BY s.nombre ASC, p.id ASC
    `, [origen.nombre, origen.sucursal_id]);
    res.json({ ok: true, origen, candidatos: sucursales });
  }),

  transferencias: wrap(async (req, res) => {
    if (!exigirGlobal(req, res)) return;
    const db = getDB();
    const [rows] = await db.query(`
      SELECT t.*, so.nombre AS sucursal_origen, sd.nombre AS sucursal_destino,
             u.nombre AS creado_por_nombre,
             GROUP_CONCAT(CONCAT(po.nombre, ' → ', pd.nombre, ' (', ti.cantidad, ')',
               IF(pd.es_transferido=1, ' · transferido', '')) SEPARATOR ' | ') AS detalle
      FROM inventario_transferencias t
      JOIN sucursales so ON so.id=t.sucursal_origen_id
      JOIN sucursales sd ON sd.id=t.sucursal_destino_id
      JOIN usuarios u ON u.id=t.creado_por
      JOIN inventario_transferencia_items ti ON ti.transferencia_id=t.id
      JOIN productos po ON po.id=ti.producto_id
      JOIN productos pd ON pd.id=ti.producto_destino_id
      GROUP BY t.id
      ORDER BY t.id DESC LIMIT 300
    `);
    res.json({ ok: true, transferencias: rows });
  }),

  crearTransferencia: wrap(async (req, res) => {
    if (!exigirGlobal(req, res)) return;
    const origenProducto = Number(req.body.producto_origen_id);
    const sucursalDestino = Number(req.body.sucursal_destino_id);
    const productoDestinoSolicitado = Number(req.body.producto_destino_id || 0);
    const cantidad = Number(req.body.cantidad);
    const motivo = String(req.body.motivo || '').trim().slice(0, 300);
    if (!origenProducto || !sucursalDestino || !Number.isInteger(cantidad) || cantidad <= 0 || motivo.length < 3) {
      return res.status(400).json({ ok: false, msg: 'Completa producto, sucursal destino, cantidad y motivo' });
    }

    const db = getDB();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const po = await InventarioModel.getProductoParaUpdate(conn, origenProducto);
      if (!po) throw error('Producto de origen no encontrado', 404);
      if (!po.sucursal_id || Number(po.sucursal_id) === sucursalDestino) throw error('Selecciona una sucursal destino distinta', 400);
      if (Number(po.stock_actual) < cantidad) throw error(`Stock insuficiente. Disponible: ${po.stock_actual}`, 409);
      const [[sucursal]] = await conn.query('SELECT id,nombre FROM sucursales WHERE id=? AND estado=0 FOR UPDATE', [sucursalDestino]);
      if (!sucursal) throw error('Sucursal destino no disponible', 404);

      let pd = null;
      if (productoDestinoSolicitado) {
        [[pd]] = await conn.query('SELECT * FROM productos WHERE id=? AND sucursal_id=? AND estado<>2 FOR UPDATE', [productoDestinoSolicitado, sucursalDestino]);
        if (!pd || String(pd.nombre).trim().toLowerCase() !== String(po.nombre).trim().toLowerCase()) throw error('El producto destino no corresponde al producto transferido', 409);
      }
      if (!pd) {
        [[pd]] = await conn.query(`
          SELECT * FROM productos
          WHERE sucursal_id=? AND estado<>2 AND LOWER(TRIM(nombre))=LOWER(TRIM(?))
          ORDER BY id ASC LIMIT 1 FOR UPDATE
        `, [sucursalDestino, po.nombre]);
      }

      let productoCreado = false;
      if (!pd) {
        const [nuevo] = await conn.query(`
          INSERT INTO productos
            (nombre,descripcion,marca,precio_costo,precio_venta,porcentaje_oferta,
             stock_actual,stock_minimo,garantia_meses,atributo_extra,sucursal_id,estado,
             es_transferido,producto_origen_id,sucursal_origen_id,transferencia_venta_habilitada,
             transferencia_venta_panel,transferencia_venta_web)
          VALUES (?,?,?,?,?,?,0,?,?,?,?,0,1,?,?,0,0,0)
        `, [
          po.nombre, po.descripcion || '', po.marca || '', po.precio_costo || 0,
          po.precio_venta || 0, po.porcentaje_oferta || 0, po.stock_minimo || 0,
          po.garantia_meses || 0, po.atributo_extra || null, sucursalDestino,
          po.id, po.sucursal_id
        ]);
        [[pd]] = await conn.query('SELECT * FROM productos WHERE id=? FOR UPDATE', [nuevo.insertId]);
        productoCreado = true;
      }

      const [[mx]] = await conn.query('SELECT COALESCE(MAX(id),0)+1 n FROM inventario_transferencias FOR UPDATE');
      const codigo = `TR-${String(mx.n).padStart(7, '0')}`;
      const [tr] = await conn.query(`
        INSERT INTO inventario_transferencias
          (codigo,sucursal_origen_id,sucursal_destino_id,estado,motivo,creado_por,enviado_por,enviado_at)
        VALUES (?,?,?,'enviada',?,?,?,NOW())
      `, [codigo, po.sucursal_id, sucursalDestino, motivo, req.session.usuario.id, req.session.usuario.id]);
      await conn.query(
        'INSERT INTO inventario_transferencia_items (transferencia_id,producto_id,producto_destino_id,cantidad) VALUES (?,?,?,?)',
        [tr.insertId, po.id, pd.id, cantidad]
      );
      const stockNuevo = Number(po.stock_actual) - cantidad;
      await InventarioModel.updateStock(conn, po.id, stockNuevo);
      await InventarioModel.insertMovimiento(conn, {
        producto_id: po.id, tipo: 'TRANSFERENCIA_SALIDA', cantidad,
        stock_antes: po.stock_actual, stock_despues: stockNuevo,
        referencia: `${codigo} → ${sucursal.nombre}${productoCreado ? ' · producto destino creado' : ''}`,
        usuario_id: req.session.usuario.id, sucursal_id: po.sucursal_id
      });
      await conn.commit();
      await Audit.log(req, { accion: 'transferencia_enviada', modulo: 'inventario', entidad: 'inventario_transferencias', entidad_id: tr.insertId, datos: { codigo, cantidad, producto_creado: productoCreado, producto_destino_id: pd.id } });
      res.status(201).json({
        ok: true, id: tr.insertId, codigo, producto_destino_id: pd.id, producto_creado: productoCreado,
        msg: productoCreado
          ? 'Transferencia enviada. Se creó el producto transferido en destino y quedó bloqueado para venta hasta que un administrador lo habilite.'
          : 'Transferencia enviada. La sucursal destino debe confirmar la recepción.'
      });
    } catch (e) {
      await conn.rollback();
      res.status(e.status || 400).json({ ok: false, msg: e.message });
    } finally { conn.release(); }
  }),

  recibirTransferencia: wrap(async (req, res) => {
    if (!exigirGlobal(req, res)) return;
    const db = getDB();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[t]] = await conn.query('SELECT * FROM inventario_transferencias WHERE id=? FOR UPDATE', [Number(req.params.id)]);
      if (!t) throw error('Transferencia no encontrada', 404);
      if (t.estado !== 'enviada') throw error('La transferencia ya fue procesada', 409);
      const [items] = await conn.query('SELECT * FROM inventario_transferencia_items WHERE transferencia_id=? ORDER BY producto_destino_id FOR UPDATE', [t.id]);
      for (const it of items) {
        const [[p]] = await conn.query('SELECT id,nombre,stock_actual,sucursal_id FROM productos WHERE id=? AND estado<>2 FOR UPDATE', [it.producto_destino_id]);
        if (!p || Number(p.sucursal_id) !== Number(t.sucursal_destino_id)) throw error('Producto destino inválido', 409);
        const nuevo = Number(p.stock_actual) + Number(it.cantidad);
        await InventarioModel.updateStock(conn, p.id, nuevo);
        await InventarioModel.insertMovimiento(conn, {
          producto_id: p.id, tipo: 'TRANSFERENCIA_ENTRADA', cantidad: Number(it.cantidad),
          stock_antes: p.stock_actual, stock_despues: nuevo, referencia: t.codigo,
          usuario_id: req.session.usuario.id, sucursal_id: t.sucursal_destino_id
        });
      }
      await conn.query("UPDATE inventario_transferencias SET estado='recibida',recibido_por=?,recibido_at=NOW() WHERE id=?", [req.session.usuario.id, t.id]);
      await conn.commit();
      await Audit.log(req, { accion: 'transferencia_recibida', modulo: 'inventario', entidad: 'inventario_transferencias', entidad_id: t.id });
      res.json({ ok: true, msg: 'Transferencia recibida y stock actualizado' });
    } catch (e) {
      await conn.rollback();
      res.status(e.status || 400).json({ ok: false, msg: e.message });
    } finally { conn.release(); }
  }),

  cancelarTransferencia: wrap(async (req, res) => {
    if (!exigirGlobal(req, res)) return;
    const motivo = String(req.body.motivo || '').trim().slice(0, 300);
    if (motivo.length < 5) return res.status(400).json({ ok: false, msg: 'Indica el motivo de cancelación' });
    const db = getDB();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[t]] = await conn.query('SELECT * FROM inventario_transferencias WHERE id=? FOR UPDATE', [Number(req.params.id)]);
      if (!t || t.estado !== 'enviada') throw error('Transferencia no disponible para cancelar', 409);
      const [items] = await conn.query('SELECT * FROM inventario_transferencia_items WHERE transferencia_id=? ORDER BY producto_id FOR UPDATE', [t.id]);
      for (const it of items) {
        const [[p]] = await conn.query('SELECT id,stock_actual FROM productos WHERE id=? FOR UPDATE', [it.producto_id]);
        if (!p) throw error('Producto de origen no encontrado', 409);
        const nuevo = Number(p.stock_actual) + Number(it.cantidad);
        await InventarioModel.updateStock(conn, p.id, nuevo);
        await InventarioModel.insertMovimiento(conn, {
          producto_id: p.id, tipo: 'TRANSFERENCIA_ENTRADA', cantidad: Number(it.cantidad),
          stock_antes: p.stock_actual, stock_despues: nuevo,
          referencia: `${t.codigo} cancelada: ${motivo}`,
          usuario_id: req.session.usuario.id, sucursal_id: t.sucursal_origen_id
        });
      }
      await conn.query("UPDATE inventario_transferencias SET estado='cancelada',motivo=CONCAT(motivo,' | Cancelación: ',?) WHERE id=?", [motivo, t.id]);
      await conn.commit();
      await Audit.log(req, { accion: 'transferencia_cancelada', modulo: 'inventario', entidad: 'inventario_transferencias', entidad_id: t.id, descripcion: motivo });
      res.json({ ok: true, msg: 'Transferencia cancelada y stock devuelto al origen' });
    } catch (e) {
      await conn.rollback();
      res.status(e.status || 400).json({ ok: false, msg: e.message });
    } finally { conn.release(); }
  })
};

module.exports = InventarioController;
