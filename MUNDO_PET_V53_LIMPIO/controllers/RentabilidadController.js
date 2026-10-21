const { wrap } = require('../helpers/response');
const { getDB } = require('../config/database');
const { hasGlobalScope, hasPermission, userScope } = require('../middleware/permisos');

function hoyPeru() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function validarRango(req) {
  const hoy = hoyPeru();
  let desde = String(req.query.desde || `${hoy.slice(0, 7)}-01`);
  let hasta = String(req.query.hasta || hoy);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    throw Object.assign(new Error('Rango de fechas inválido'), { status: 400 });
  }
  if (desde > hoy || hasta > hoy) throw Object.assign(new Error('No se permiten fechas futuras'), { status: 400 });
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const days = Math.floor((new Date(`${hasta}T00:00:00Z`) - new Date(`${desde}T00:00:00Z`)) / 86400000) + 1;
  if (days > 366) throw Object.assign(new Error('El periodo máximo es de 366 días'), { status: 400 });
  return { desde, hasta };
}

async function alcance(req) {
  const global = await hasGlobalScope(req, 'dashboard.ver_global');
  return {
    global,
    sucursalId: global ? (Number(req.query.sucursal_id) || null) : Number(userScope(req).sucursalId || 0) || null
  };
}

async function querySafe(db, sql, params = [], fallback = []) {
  try {
    const [rows] = await db.query(sql, params);
    return rows;
  } catch (error) {
    console.error('[RENTABILIDAD PARCIAL]', error.message);
    return fallback;
  }
}

module.exports = {
  resumen: wrap(async (req, res) => {
    if (!(await hasPermission(req, 'rentabilidad.ver'))) {
      return res.status(403).json({ ok: false, msg: 'No tienes permiso para ver rentabilidad' });
    }
    const puedeCostos = await hasPermission(req, 'rentabilidad.ver_costos') || await hasPermission(req, 'reportes.ver_costos');
    if (!puedeCostos) return res.status(403).json({ ok: false, msg: 'No tienes permiso para ver costos y márgenes' });

    const db = getDB();
    const { desde, hasta } = validarRango(req);
    const { global, sucursalId } = await alcance(req);
    const branchVenta = sucursalId ? ' AND COALESCE(vi.sucursal_id,p.sucursal_id,v.sucursal_id)=?' : '';
    const branchVentaParams = sucursalId ? [sucursalId] : [];
    const branchCaja = sucursalId ? ' AND cm.sucursal_id=?' : '';
    const branchCajaParams = sucursalId ? [sucursalId] : [];

    const costExpression = `LEAST(
      GREATEST(0,COALESCE(vi.subtotal,vi.cantidad*vi.precio_unit,0)),
      GREATEST(0,vi.cantidad*COALESCE(NULLIF(vi.costo_unitario,0),p.precio_costo,0))
    )`;

    const [summaryRows, daily, products, branches, channels, expenses, alerts] = await Promise.all([
      querySafe(db, `
        SELECT COUNT(DISTINCT v.id) ventas,
               COALESCE(SUM(vi.cantidad),0) unidades,
               COALESCE(SUM(GREATEST(0,vi.subtotal)),0) ingresos,
               COALESCE(SUM(${costExpression}),0) costo_utilizado,
               COALESCE(SUM(GREATEST(0,vi.cantidad*COALESCE(NULLIF(vi.costo_unitario,0),p.precio_costo,0))),0) costo_declarado,
               SUM(CASE WHEN vi.cantidad*COALESCE(NULLIF(vi.costo_unitario,0),p.precio_costo,0) > GREATEST(0,vi.subtotal) THEN 1 ELSE 0 END) items_costo_inconsistente
        FROM venta_items vi
        JOIN ventas v ON v.id=vi.venta_id
        LEFT JOIN productos p ON p.id=vi.producto_id
        WHERE DATE(v.created_at) BETWEEN ? AND ?
          AND v.estado_venta='registrada'${branchVenta}
      `, [desde, hasta, ...branchVentaParams], [{ ventas:0, unidades:0, ingresos:0, costo_utilizado:0, costo_declarado:0, items_costo_inconsistente:0 }]),
      querySafe(db, `
        SELECT DATE_FORMAT(v.created_at,'%Y-%m-%d') fecha,
               COALESCE(SUM(GREATEST(0,vi.subtotal)),0) ingresos,
               COALESCE(SUM(${costExpression}),0) costo,
               COALESCE(SUM(GREATEST(0,vi.subtotal)-${costExpression}),0) margen
        FROM venta_items vi
        JOIN ventas v ON v.id=vi.venta_id
        LEFT JOIN productos p ON p.id=vi.producto_id
        WHERE DATE(v.created_at) BETWEEN ? AND ? AND v.estado_venta='registrada'${branchVenta}
        GROUP BY DATE(v.created_at) ORDER BY DATE(v.created_at)
      `, [desde, hasta, ...branchVentaParams]),
      querySafe(db, `
        SELECT p.id,p.nombre,s.nombre sucursal_nombre,
               COALESCE(SUM(vi.cantidad),0) unidades,
               COALESCE(SUM(GREATEST(0,vi.subtotal)),0) ingresos,
               COALESCE(SUM(${costExpression}),0) costo,
               COALESCE(SUM(GREATEST(0,vi.subtotal)-${costExpression}),0) margen,
               CASE WHEN SUM(GREATEST(0,vi.subtotal))>0
                    THEN 100*SUM(GREATEST(0,vi.subtotal)-${costExpression})/SUM(GREATEST(0,vi.subtotal)) ELSE 0 END margen_pct
        FROM venta_items vi JOIN ventas v ON v.id=vi.venta_id
        JOIN productos p ON p.id=vi.producto_id LEFT JOIN sucursales s ON s.id=COALESCE(vi.sucursal_id,p.sucursal_id,v.sucursal_id)
        WHERE DATE(v.created_at) BETWEEN ? AND ? AND v.estado_venta='registrada'${branchVenta}
        GROUP BY p.id,p.nombre,s.nombre ORDER BY margen DESC LIMIT 30
      `, [desde, hasta, ...branchVentaParams]),
      global && !sucursalId ? querySafe(db, `
        SELECT s.id,s.nombre,
               COALESCE(SUM(GREATEST(0,vi.subtotal)),0) ingresos,
               COALESCE(SUM(${costExpression}),0) costo,
               COALESCE(SUM(GREATEST(0,vi.subtotal)-${costExpression}),0) margen
        FROM sucursales s
        LEFT JOIN venta_items vi ON COALESCE(vi.sucursal_id,(SELECT p2.sucursal_id FROM productos p2 WHERE p2.id=vi.producto_id),NULL)=s.id
        LEFT JOIN ventas v ON v.id=vi.venta_id AND v.estado_venta='registrada' AND DATE(v.created_at) BETWEEN ? AND ?
        LEFT JOIN productos p ON p.id=vi.producto_id
        WHERE s.estado=0 GROUP BY s.id,s.nombre ORDER BY margen DESC
      `, [desde, hasta]) : Promise.resolve([]),
      querySafe(db, `
        SELECT CASE WHEN LOWER(COALESCE(v.canal,'')) IN ('web','ecommerce') OR v.pedido_web_id IS NOT NULL THEN 'web' ELSE 'presencial' END canal,
               COUNT(DISTINCT v.id) ventas,
               COALESCE(SUM(GREATEST(0,vi.subtotal)),0) ingresos,
               COALESCE(SUM(${costExpression}),0) costo,
               COALESCE(SUM(GREATEST(0,vi.subtotal)-${costExpression}),0) margen
        FROM venta_items vi JOIN ventas v ON v.id=vi.venta_id LEFT JOIN productos p ON p.id=vi.producto_id
        WHERE DATE(v.created_at) BETWEEN ? AND ? AND v.estado_venta='registrada'${branchVenta}
        GROUP BY canal ORDER BY ingresos DESC
      `, [desde, hasta, ...branchVentaParams]),
      querySafe(db, `SELECT COALESCE(SUM(cm.monto),0) egresos,COUNT(*) movimientos
        FROM caja_movimientos cm WHERE cm.tipo='egreso' AND DATE(cm.created_at) BETWEEN ? AND ?${branchCaja}`,
        [desde, hasta, ...branchCajaParams], [{ egresos:0, movimientos:0 }]),
      querySafe(db, `
        SELECT p.id,p.nombre,p.precio_costo,p.precio_venta,p.stock_actual,s.nombre sucursal_nombre,
               CASE WHEN p.precio_costo>p.precio_venta THEN 'costo_mayor_venta'
                    WHEN p.precio_costo=p.precio_venta AND p.precio_venta>0 THEN 'sin_margen'
                    WHEN p.precio_costo<=0 THEN 'sin_costo' ELSE 'margen_bajo' END tipo
        FROM productos p LEFT JOIN sucursales s ON s.id=p.sucursal_id
        WHERE p.estado=0${sucursalId ? ' AND p.sucursal_id=?' : ''}
          AND (p.precio_costo<=0 OR p.precio_costo>=p.precio_venta OR (p.precio_venta>0 AND (p.precio_venta-p.precio_costo)/p.precio_venta<0.10))
        ORDER BY FIELD(tipo,'costo_mayor_venta','sin_margen','sin_costo','margen_bajo'),p.nombre LIMIT 50
      `, sucursalId ? [sucursalId] : [])
    ]);

    const inventoryRows = await querySafe(db, `
      SELECT COALESCE(SUM(GREATEST(0,p.stock_actual)*GREATEST(0,p.precio_costo)),0) inversion_inventario,
             COALESCE(SUM(GREATEST(0,p.stock_actual)*GREATEST(0,p.precio_venta)),0) valor_venta_inventario,
             COUNT(*) productos_activos,
             SUM(CASE WHEN p.stock_actual<=p.stock_minimo THEN 1 ELSE 0 END) productos_criticos
      FROM productos p WHERE p.estado=0${sucursalId ? ' AND p.sucursal_id=?' : ''}
    `, sucursalId ? [sucursalId] : [], [{inversion_inventario:0,valor_venta_inventario:0,productos_activos:0,productos_criticos:0}]);
    const paymentRows = await querySafe(db, `
      SELECT LOWER(COALESCE(pg.metodo,'sin método')) metodo,COUNT(*) operaciones,COALESCE(SUM(pg.monto),0) monto
      FROM pagos pg JOIN ventas v ON v.id=pg.venta_id
      WHERE DATE(v.created_at) BETWEEN ? AND ? AND v.estado_venta='registrada'${sucursalId ? ' AND v.sucursal_id=?' : ''}
      GROUP BY LOWER(COALESCE(pg.metodo,'sin método')) ORDER BY monto DESC
    `,[desde,hasta,...(sucursalId?[sucursalId]:[])]);

    const summary = summaryRows[0] || {};
    const ingresos = Number(summary.ingresos || 0);
    const costo = Number(summary.costo_utilizado || 0);
    const margen = Math.max(0, ingresos - costo);
    const egresos = Number(expenses[0]?.egresos || 0);
    const resultado = margen - egresos;
    const inventario = inventoryRows[0] || {};
    const inversionInventario = Number(inventario.inversion_inventario || 0);
    const valorVentaInventario = Number(inventario.valor_venta_inventario || 0);
    const gananciaPotencialInventario = Math.max(0, valorVentaInventario - inversionInventario);
    const roiPeriodo = costo + egresos > 0 ? (resultado / (costo + egresos)) * 100 : 0;
    const puntoEquilibrio = ingresos > 0 && margen > 0 ? egresos / (margen / ingresos) : 0;

    res.json({
      ok: true,
      periodo: { desde, hasta },
      esGlobal: global,
      sucursalId,
      kpis: {
        ventas: Number(summary.ventas || 0),
        unidades: Number(summary.unidades || 0),
        ingresos,
        costo,
        margen_bruto: margen,
        margen_pct: ingresos > 0 ? margen / ingresos * 100 : 0,
        egresos,
        resultado_estimado: resultado,
        ticket_promedio: Number(summary.ventas || 0) ? ingresos / Number(summary.ventas) : 0,
        items_costo_inconsistente: Number(summary.items_costo_inconsistente || 0),
        costo_declarado: Number(summary.costo_declarado || 0),
        inversion_inventario: inversionInventario,
        valor_venta_inventario: valorVentaInventario,
        ganancia_potencial_inventario: gananciaPotencialInventario,
        roi_periodo: roiPeriodo,
        punto_equilibrio: puntoEquilibrio,
        productos_activos: Number(inventario.productos_activos || 0),
        productos_criticos: Number(inventario.productos_criticos || 0)
      },
      diario: daily,
      productos: products,
      sucursales: branches,
      canales: channels,
      medios_pago: paymentRows,
      alertas: alerts,
      nota_costos: Number(summary.items_costo_inconsistente || 0)
        ? 'Se detectaron costos históricos superiores al importe vendido. Para evitar un margen bruto absurdo, esos costos se limitaron al importe de cada línea y se muestran como alerta para corregirlos.'
        : 'El margen utiliza el costo histórico guardado en cada venta; cuando no existe, usa el costo actual del producto.'
    });
  })
};
