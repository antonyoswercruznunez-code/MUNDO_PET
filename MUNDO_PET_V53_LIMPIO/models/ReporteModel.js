const { getDB } = require('../config/database');

// Ventas válidas = registradas (no anuladas)
const VENTAS_OK = "v.estado_venta = 'registrada'";

// Helper: arma cláusula de sucursal y fechas
function scopeSQL(sid, alias = 'v') {
  if (!sid) return '';
  const branchId = Number(sid);
  // Una venta web multisucursal pertenece a todas las sucursales presentes
  // en sus ítems, aunque ventas.sucursal_id conserve una sede principal.
  return ` AND (
    ${alias}.sucursal_id = ${branchId}
    OR EXISTS (
      SELECT 1 FROM venta_items scope_vi
      WHERE scope_vi.venta_id=${alias}.id AND scope_vi.sucursal_id=${branchId}
    )
  )`;
}
function fechaSQL(desde, hasta, campo = 'v.created_at') {
  let s = '';
  if (desde) s += ` AND DATE(${campo}) >= ${getDB().escape(desde)}`;
  if (hasta) s += ` AND DATE(${campo}) <= ${getDB().escape(hasta)}`;
  return s;
}

function canalSQL(alias = 'v') {
  return `CASE
    WHEN LOWER(COALESCE(${alias}.canal,'')) IN ('web','ecommerce','online')
      OR ${alias}.pedido_web_id IS NOT NULL THEN 'web'
    ELSE 'presencial'
  END`;
}

function pedidoWebScopeSQL(sid, alias = 'pw') {
  if (!sid) return '';
  return ` AND EXISTS (
    SELECT 1 FROM pedido_items pwi
    WHERE pwi.pedido_id=${alias}.id AND pwi.sucursal_id=${Number(sid)}
  )`;
}

const ReporteModel = {

  // ══════════════ VENTAS ══════════════

  // KPIs generales de ventas
  ventasKPI: async (sid, desde, hasta) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT
        COUNT(*) AS num_ventas,
        COALESCE(SUM(v.total),0) AS total_vendido,
        COALESCE(AVG(v.total),0) AS ticket_promedio,
        COALESCE(SUM(v.subtotal),0) AS subtotal,
        COALESCE(SUM(v.igv),0) AS igv,
        COALESCE(SUM(v.descuento),0) AS descuentos
      FROM ventas v
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
    `);
    return row;
  },

  // Ventas por periodo (para gráfico de línea) - agrupado por día
  ventasPorDia: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT DATE(v.created_at) AS fecha,
             COUNT(*) AS cantidad,
             COALESCE(SUM(v.total),0) AS total
      FROM ventas v
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
      GROUP BY DATE(v.created_at)
      ORDER BY fecha ASC
    `);
    return rows;
  },

  // Ventas por sucursal
  ventasPorSucursal: async (desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT s.id, s.nombre AS sucursal,
             COUNT(v.id) AS cantidad,
             COALESCE(SUM(v.total),0) AS total
      FROM sucursales s
      LEFT JOIN ventas v ON v.sucursal_id = s.id AND ${VENTAS_OK} ${fechaSQL(desde,hasta)}
      GROUP BY s.id, s.nombre
      ORDER BY total DESC
    `);
    return rows;
  },

  // Ventas por vendedor (ranking)
  ventasPorVendedor: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT u.id, u.nombre AS vendedor,
             COUNT(v.id) AS cantidad,
             COALESCE(SUM(v.total),0) AS total,
             COALESCE(AVG(v.total),0) AS ticket_promedio
      FROM ventas v
      JOIN usuarios u ON u.id = v.vendedor_id
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
      GROUP BY u.id, u.nombre
      ORDER BY total DESC
    `);
    return rows;
  },

  // Ventas por método de pago
  ventasPorMetodoPago: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT COALESCE(v.metodo_pago,'efectivo') AS metodo,
             COUNT(*) AS cantidad,
             COALESCE(SUM(v.total),0) AS total
      FROM ventas v
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
      GROUP BY v.metodo_pago
      ORDER BY total DESC
    `);
    return rows;
  },

  // Ventas por canal real: página web o atención presencial
  ventasPorCanal: async (sid, desde, hasta) => {
    const db = getDB();
    const channel = canalSQL('v');
    const [rows] = await db.query(`
      SELECT ${channel} AS canal,
             COUNT(*) AS cantidad,
             COALESCE(SUM(v.subtotal),0) AS subtotal,
             COALESCE(SUM(v.igv),0) AS igv,
             COALESCE(SUM(v.descuento),0) AS descuentos,
             COALESCE(SUM(v.total),0) AS total,
             COALESCE(AVG(v.total),0) AS ticket_promedio,
             COALESCE(SUM(vu.unidades),0) AS unidades
      FROM ventas v
      LEFT JOIN (
        SELECT venta_id,SUM(cantidad) AS unidades
        FROM venta_items GROUP BY venta_id
      ) vu ON vu.venta_id=v.id
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
      GROUP BY ${channel}
      ORDER BY total DESC
    `);
    return rows;
  },

  ventasPorDiaCanal: async (sid, desde, hasta) => {
    const db = getDB();
    const channel = canalSQL('v');
    const [rows] = await db.query(`
      SELECT DATE(v.created_at) AS fecha,
             SUM(CASE WHEN ${channel}='web' THEN 1 ELSE 0 END) AS ventas_web,
             SUM(CASE WHEN ${channel}='presencial' THEN 1 ELSE 0 END) AS ventas_presenciales,
             COALESCE(SUM(CASE WHEN ${channel}='web' THEN v.total ELSE 0 END),0) AS total_web,
             COALESCE(SUM(CASE WHEN ${channel}='presencial' THEN v.total ELSE 0 END),0) AS total_presencial,
             COALESCE(SUM(v.total),0) AS total
      FROM ventas v
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
      GROUP BY DATE(v.created_at)
      ORDER BY fecha ASC
    `);
    return rows;
  },

  ventasMetodoPorCanal: async (sid, desde, hasta) => {
    const db = getDB();
    const channel = canalSQL('v');
    const [rows] = await db.query(`
      SELECT ${channel} AS canal,
             COALESCE(NULLIF(v.metodo_pago,''),'efectivo') AS metodo,
             COUNT(*) AS cantidad,
             COALESCE(SUM(v.total),0) AS total,
             COALESCE(AVG(v.total),0) AS ticket_promedio
      FROM ventas v
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
      GROUP BY ${channel},COALESCE(NULLIF(v.metodo_pago,''),'efectivo')
      ORDER BY canal,total DESC
    `);
    return rows;
  },

  ventasEntregaPorCanal: async (sid, desde, hasta) => {
    const db = getDB();
    const channel = canalSQL('v');
    const [rows] = await db.query(`
      SELECT ${channel} AS canal,
             COALESCE(NULLIF(v.tipo_entrega,''),'mostrador') AS tipo_entrega,
             COUNT(*) AS cantidad,
             COALESCE(SUM(v.total),0) AS total
      FROM ventas v
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
      GROUP BY ${channel},COALESCE(NULLIF(v.tipo_entrega,''),'mostrador')
      ORDER BY canal,total DESC
    `);
    return rows;
  },

  ventasDetalleCanal: async (sid, desde, hasta) => {
    const db = getDB();
    const channel = canalSQL('v');
    const [rows] = await db.query(`
      SELECT v.id,v.numero,
             DATE_FORMAT(v.created_at,'%Y-%m-%d %H:%i:%s') AS fecha,
             ${channel} AS canal,
             v.tipo_entrega,v.tipo_comprobante,v.metodo_pago,
             v.subtotal,v.igv,v.descuento,v.total,v.estado_venta,v.estado_sunat,
             v.pedido_web_id,pw.numero_orden AS pedido_web,pw.estado_pago AS estado_pago_web,
             COALESCE(NULLIF(TRIM(c.razon_social),''),
                      NULLIF(TRIM(CONCAT_WS(' ',c.nombre,c.apellido_paterno,c.apellido_materno)),''),
                      NULLIF(v.cliente_web_nombre,''),'Cliente general') AS cliente,
             COALESCE(NULLIF(c.numero_doc,''),NULLIF(v.cliente_web_doc,''),'') AS documento,
             COALESCE(NULLIF(c.email,''),NULLIF(cw.email,''),'') AS email,
             COALESCE(NULLIF(c.telefono,''),NULLIF(pw.telefono,''),'') AS telefono,
             COALESCE(NULLIF(pw.direccion_entrega,''),NULLIF(c.direccion,''),'') AS direccion_entrega,
             COALESCE(NULLIF(vi.sucursales_items,''),s.nombre,'—') AS sucursal,
             u.nombre AS vendedor,
             uv.nombre AS aprobado_por,
             DATE_FORMAT(pw.processed_at,'%Y-%m-%d %H:%i:%s') AS aprobado_at,
             CASE WHEN pw.processed_at IS NOT NULL
               THEN TIMESTAMPDIFF(MINUTE,pw.created_at,pw.processed_at) ELSE NULL END AS minutos_revision,
             COALESCE(vi.lineas,0) AS lineas,
             COALESCE(vi.unidades,0) AS unidades,
             COALESCE(vi.productos,'') AS productos,
             COALESCE(pay.referencias,'') AS referencias_pago
      FROM ventas v
      LEFT JOIN clientes c ON c.id=v.cliente_id
      LEFT JOIN usuarios u ON u.id=v.vendedor_id
      LEFT JOIN sucursales s ON s.id=v.sucursal_id
      LEFT JOIN pedidos_web pw ON pw.id=v.pedido_web_id
      LEFT JOIN clientes_web cw ON cw.id=pw.cliente_web_id
      LEFT JOIN usuarios uv ON uv.id=pw.processed_by
      LEFT JOIN (
        SELECT vi.venta_id,
               COUNT(*) AS lineas,
               SUM(vi.cantidad) AS unidades,
               GROUP_CONCAT(DISTINCT s_item.nombre ORDER BY s_item.nombre SEPARATOR ', ') AS sucursales_items,
               GROUP_CONCAT(
                 CONCAT(COALESCE(p_item.nombre,CONCAT('Producto #',vi.producto_id)),' x',vi.cantidad)
                 ORDER BY vi.id SEPARATOR ' | '
               ) AS productos
        FROM venta_items vi
        LEFT JOIN sucursales s_item ON s_item.id=vi.sucursal_id
        LEFT JOIN productos p_item ON p_item.id=vi.producto_id
        GROUP BY vi.venta_id
      ) vi ON vi.venta_id=v.id
      LEFT JOIN (
        SELECT venta_id,GROUP_CONCAT(DISTINCT NULLIF(referencia,'') SEPARATOR ', ') AS referencias
        FROM pagos GROUP BY venta_id
      ) pay ON pay.venta_id=v.id
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
      ORDER BY v.created_at DESC,v.id DESC
      LIMIT 1000
    `);
    return rows;
  },

  pedidosWebResumen: async (sid, desde, hasta) => {
    const db = getDB();
    const [[kpi]] = await db.query(`
      SELECT COUNT(*) AS pedidos,
             SUM(pw.estado_pago='pendiente') AS pendientes,
             SUM(pw.estado_pago='observado') AS observados,
             SUM(pw.estado_pago='aprobado') AS aprobados,
             SUM(pw.estado_pago='rechazado') AS rechazados,
             COALESCE(SUM(pw.total),0) AS monto_solicitado,
             COALESCE(SUM(CASE WHEN pw.estado_pago='aprobado' THEN pw.total ELSE 0 END),0) AS monto_aprobado,
             COALESCE(AVG(CASE WHEN pw.processed_at IS NOT NULL
               THEN TIMESTAMPDIFF(MINUTE,pw.created_at,pw.processed_at) END),0) AS minutos_promedio_revision
      FROM pedidos_web pw
      WHERE pw.estado<>2 ${pedidoWebScopeSQL(sid)} ${fechaSQL(desde,hasta,'pw.created_at')}
    `);
    const total = Number(kpi.pedidos || 0);
    kpi.tasa_aprobacion = total ? Number(((Number(kpi.aprobados || 0) / total) * 100).toFixed(1)) : 0;
    return kpi;
  },

  pedidosWebPorEstado: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT pw.estado_pago AS estado,
             COUNT(*) AS cantidad,
             COALESCE(SUM(pw.total),0) AS total
      FROM pedidos_web pw
      WHERE pw.estado<>2 ${pedidoWebScopeSQL(sid)} ${fechaSQL(desde,hasta,'pw.created_at')}
      GROUP BY pw.estado_pago ORDER BY cantidad DESC
    `);
    return rows;
  },

  pedidosWebPorMetodo: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT COALESCE(NULLIF(pw.metodo_pago,''),'sin definir') AS metodo,
             COUNT(*) AS cantidad,
             COALESCE(SUM(pw.total),0) AS total,
             SUM(pw.estado_pago='aprobado') AS aprobados
      FROM pedidos_web pw
      WHERE pw.estado<>2 ${pedidoWebScopeSQL(sid)} ${fechaSQL(desde,hasta,'pw.created_at')}
      GROUP BY COALESCE(NULLIF(pw.metodo_pago,''),'sin definir')
      ORDER BY total DESC
    `);
    return rows;
  },

  pedidosWebPorEntrega: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT COALESCE(NULLIF(pw.tipo_entrega,''),'sin definir') AS tipo_entrega,
             COUNT(*) AS cantidad,
             COALESCE(SUM(pw.total),0) AS total,
             SUM(pw.estado_pago='aprobado') AS aprobados
      FROM pedidos_web pw
      WHERE pw.estado<>2 ${pedidoWebScopeSQL(sid)} ${fechaSQL(desde,hasta,'pw.created_at')}
      GROUP BY COALESCE(NULLIF(pw.tipo_entrega,''),'sin definir')
      ORDER BY total DESC
    `);
    return rows;
  },


  pedidosWebDetalle: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT pw.id,pw.numero_orden,
             DATE_FORMAT(pw.created_at,'%Y-%m-%d %H:%i:%s') AS fecha,
             pw.estado_pago,pw.estado_pedido,pw.tipo_entrega,pw.metodo_pago,
             COALESCE(NULLIF(pw.numero_operacion,''),NULLIF(pw.codigo_operacion,''),'') AS numero_operacion,
             pw.subtotal,pw.igv,pw.total,
             COALESCE(NULLIF(TRIM(c.razon_social),''),
                      NULLIF(TRIM(CONCAT_WS(' ',c.nombre,c.apellido_paterno,c.apellido_materno)),''),
                      NULLIF(pw.cliente_nombre,''),NULLIF(cw.nombre,''),'Cliente web') AS cliente,
             COALESCE(NULLIF(c.numero_doc,''),NULLIF(pw.cliente_doc,''),'') AS documento,
             COALESCE(NULLIF(c.telefono,''),NULLIF(pw.telefono,''),'') AS telefono,
             COALESCE(NULLIF(c.email,''),NULLIF(cw.email,''),'') AS email,
             COALESCE(NULLIF(pw.direccion_entrega,''),NULLIF(pw.direccion,''),NULLIF(c.direccion,''),'') AS direccion_entrega,
             COALESCE(items.lineas,0) AS lineas,
             COALESCE(items.unidades,0) AS unidades,
             COALESCE(items.sucursales,'') AS sucursales,
             COALESCE(items.productos,'') AS productos,
             v.numero AS venta_numero,
             DATE_FORMAT(pw.processed_at,'%Y-%m-%d %H:%i:%s') AS procesado_at,
             u.nombre AS procesado_por,
             CASE WHEN pw.processed_at IS NOT NULL
               THEN TIMESTAMPDIFF(MINUTE,pw.created_at,pw.processed_at) ELSE NULL END AS minutos_revision,
             COALESCE(NULLIF(pw.rechazo_motivo,''),NULLIF(pw.notas_admin,''),'') AS observacion_resultado
      FROM pedidos_web pw
      LEFT JOIN clientes_web cw ON cw.id=pw.cliente_web_id
      LEFT JOIN clientes c ON c.id=pw.cliente_id
      LEFT JOIN ventas v ON v.id=pw.venta_id
      LEFT JOIN usuarios u ON u.id=pw.processed_by
      LEFT JOIN (
        SELECT pi.pedido_id,COUNT(*) AS lineas,SUM(pi.cantidad) AS unidades,
               GROUP_CONCAT(DISTINCT s.nombre ORDER BY s.nombre SEPARATOR ', ') AS sucursales,
               GROUP_CONCAT(
                 CONCAT(COALESCE(NULLIF(pi.nombre_snapshot,''),p.nombre,CONCAT('Producto #',pi.producto_id)),' x',pi.cantidad)
                 ORDER BY pi.id SEPARATOR ' | '
               ) AS productos
        FROM pedido_items pi
        LEFT JOIN sucursales s ON s.id=pi.sucursal_id
        LEFT JOIN productos p ON p.id=pi.producto_id
        GROUP BY pi.pedido_id
      ) items ON items.pedido_id=pw.id
      WHERE pw.estado<>2 ${pedidoWebScopeSQL(sid)} ${fechaSQL(desde,hasta,'pw.created_at')}
      ORDER BY pw.created_at DESC,pw.id DESC
      LIMIT 1000
    `);
    return rows;
  },

  // Ventas por tipo de comprobante
  ventasPorComprobante: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT v.tipo_comprobante AS comprobante,
             COUNT(*) AS cantidad,
             COALESCE(SUM(v.total),0) AS total
      FROM ventas v
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
      GROUP BY v.tipo_comprobante
      ORDER BY total DESC
    `);
    return rows;
  },

  // ══════════════ PRODUCTOS ══════════════

  // Productos más vendidos (top)
  productosMasVendidos: async (sid, desde, hasta, limit = 20) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT p.id, p.nombre, p.marca,
             SUM(vi.cantidad) AS unidades,
             COALESCE(SUM(vi.subtotal),0) AS total_vendido,
             COUNT(DISTINCT vi.venta_id) AS num_ventas
      FROM venta_items vi
      JOIN ventas v ON v.id = vi.venta_id
      JOIN productos p ON p.id = vi.producto_id
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
      GROUP BY p.id, p.nombre, p.marca
      ORDER BY unidades DESC
      LIMIT ${Number(limit)}
    `);
    return rows;
  },

  // Productos con bajo stock o sin stock
  productosBajoStock: async (sid) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT p.id, p.nombre, p.marca,
             p.stock_actual, p.stock_minimo,
             s.nombre AS sucursal
      FROM productos p
      LEFT JOIN sucursales s ON s.id = p.sucursal_id
      WHERE p.estado = 0
        AND p.stock_actual <= p.stock_minimo
        ${sid ? `AND (p.sucursal_id = ${Number(sid)} OR p.sucursal_id IS NULL)` : ''}
      ORDER BY (p.stock_actual - p.stock_minimo) ASC
      LIMIT 100
    `);
    return rows;
  },

  // Margen de ganancia por producto (vendidos en el periodo)
  margenPorProducto: async (sid, desde, hasta, limit = 30) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT p.id, p.nombre,
             COALESCE(SUM(vi.cantidad),0) AS unidades_vendidas,
             COALESCE(SUM(vi.subtotal),0) AS ingreso_total,
             COALESCE(SUM(vi.cantidad * COALESCE(NULLIF(vi.costo_unitario,0),p.precio_costo,0)),0) AS costo_total,
             COALESCE(SUM(vi.subtotal - vi.cantidad * COALESCE(NULLIF(vi.costo_unitario,0),p.precio_costo,0)),0) AS ganancia_total,
             CASE WHEN COALESCE(SUM(vi.subtotal),0)>0
               THEN ROUND((SUM(vi.subtotal - vi.cantidad * COALESCE(NULLIF(vi.costo_unitario,0),p.precio_costo,0)) / SUM(vi.subtotal))*100,1)
               ELSE 0 END AS margen_pct
      FROM productos p
      JOIN venta_items vi ON vi.producto_id = p.id
      JOIN ventas v ON v.id = vi.venta_id
      WHERE p.estado = 0 AND ${VENTAS_OK} ${fechaSQL(desde,hasta)}
        ${sid ? `AND COALESCE(vi.sucursal_id,p.sucursal_id,v.sucursal_id)=${Number(sid)}` : ''}
      GROUP BY p.id, p.nombre
      HAVING unidades_vendidas > 0
      ORDER BY ganancia_total DESC
      LIMIT ${Number(limit)}
    `);
    return rows;
  },

  // Productos sin movimiento (no vendidos en el periodo)
  productosSinMovimiento: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT p.id, p.nombre, p.stock_actual,
             s.nombre AS sucursal
      FROM productos p
      LEFT JOIN sucursales s ON s.id = p.sucursal_id
      WHERE p.estado = 0
        ${sid ? `AND (p.sucursal_id = ${Number(sid)} OR p.sucursal_id IS NULL)` : ''}
        AND p.id NOT IN (
          SELECT DISTINCT vi.producto_id
          FROM venta_items vi
          JOIN ventas v ON v.id = vi.venta_id
          WHERE ${VENTAS_OK} ${fechaSQL(desde,hasta)}
        )
      ORDER BY p.stock_actual DESC
      LIMIT 100
    `);
    return rows;
  },

  // ══════════════ CLIENTES (CRM) ══════════════

  // Clientes más frecuentes (top compradores)
  clientesTop: async (sid, desde, hasta, limit = 20) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT c.id, c.nombre, c.numero_doc, c.tipo_cliente,
             COUNT(v.id) AS num_compras,
             COALESCE(SUM(v.total),0) AS total_gastado,
             COALESCE(AVG(v.total),0) AS ticket_promedio,
             MAX(DATE(v.created_at)) AS ultima_compra
      FROM clientes c
      JOIN ventas v ON v.cliente_id = c.id
      WHERE ${VENTAS_OK} ${scopeSQL(sid)} ${fechaSQL(desde,hasta)}
        AND c.es_general = 0
      GROUP BY c.id, c.nombre, c.numero_doc, c.tipo_cliente
      ORDER BY total_gastado DESC
      LIMIT ${Number(limit)}
    `);
    return rows;
  },

  // Clientes nuevos por periodo
  clientesNuevos: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT DATE(c.created_at) AS fecha,
             COUNT(*) AS cantidad
      FROM clientes c
      WHERE c.es_general = 0
        ${sid ? `AND c.sucursal_registro_id = ${Number(sid)}` : ''}
        ${fechaSQL(desde, hasta, 'c.created_at')}
      GROUP BY DATE(c.created_at)
      ORDER BY fecha ASC
    `);
    return rows;
  },

  // Clientes inactivos (no compran hace 60+ días)
  clientesInactivos: async (sid, dias = 60) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT c.id, c.nombre, c.numero_doc, c.telefono,
             MAX(DATE(v.created_at)) AS ultima_compra,
             DATEDIFF(CURDATE(), MAX(DATE(v.created_at))) AS dias_sin_comprar,
             COUNT(v.id) AS compras_historicas,
             COALESCE(SUM(v.total),0) AS total_historico
      FROM clientes c
      JOIN ventas v ON v.cliente_id = c.id AND ${VENTAS_OK}
      WHERE c.es_general = 0 ${scopeSQL(sid)}
      GROUP BY c.id, c.nombre, c.numero_doc, c.telefono
      HAVING dias_sin_comprar >= ${Number(dias)}
      ORDER BY total_historico DESC
      LIMIT 100
    `);
    return rows;
  },

  // Distribución por tipo de cliente
  clientesPorTipo: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT c.tipo_cliente,
             COUNT(DISTINCT c.id) AS num_clientes,
             COUNT(v.id) AS num_compras,
             COALESCE(SUM(v.total),0) AS total
      FROM clientes c
      LEFT JOIN ventas v ON v.cliente_id = c.id AND ${VENTAS_OK} ${fechaSQL(desde,hasta)}
      WHERE c.es_general = 0 ${sid ? `AND c.sucursal_registro_id = ${Number(sid)}` : ''}
      GROUP BY c.tipo_cliente
      ORDER BY total DESC
    `);
    return rows;
  },

  // ══════════════ FINANZAS / CAJA ══════════════

  // Resumen de caja (arqueos)
  cajaArqueos: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT cs.id, cs.numero_caja,
             DATE_FORMAT(cs.abierta_at, '%Y-%m-%d %H:%i') AS abierta_at,
             DATE_FORMAT(cs.cerrada_at, '%Y-%m-%d %H:%i') AS cerrada_at,
             cs.monto_inicial, cs.monto_final,
             cs.total_ventas, cs.total_ingresos, cs.total_egresos,
             cs.estado,
             u.nombre AS cajero, s.nombre AS sucursal,
             (cs.monto_inicial + cs.total_ventas + cs.total_ingresos - cs.total_egresos) AS esperado
      FROM caja_sesiones cs
      LEFT JOIN usuarios u ON u.id = cs.usuario_id
      LEFT JOIN sucursales s ON s.id = cs.sucursal_id
      WHERE 1=1
        ${sid ? `AND cs.sucursal_id = ${Number(sid)}` : ''}
        ${fechaSQL(desde, hasta, 'cs.abierta_at')}
      ORDER BY cs.id DESC
      LIMIT 200
    `);
    return rows.map(r => ({
      ...r,
      diferencia: r.monto_final == null ? null : +(Number(r.monto_final) - Number(r.esperado)).toFixed(2)
    }));
  },

  // Ingresos vs egresos (flujo de caja)
  flujoCaja: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT DATE(m.created_at) AS fecha,
             COALESCE(SUM(CASE WHEN m.tipo='ingreso' THEN m.monto END),0) AS ingresos,
             COALESCE(SUM(CASE WHEN m.tipo='egreso' THEN m.monto END),0) AS egresos
      FROM caja_movimientos m
      WHERE 1=1
        ${sid ? `AND m.sucursal_id = ${Number(sid)}` : ''}
        ${fechaSQL(desde, hasta, 'm.created_at')}
      GROUP BY DATE(m.created_at)
      ORDER BY fecha ASC
    `);
    return rows;
  },

  // Pagos digitales por estado de conciliación
  conciliacionDigital: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT p.metodo,
             COUNT(*) AS cantidad,
             COALESCE(SUM(p.monto),0) AS total,
             COALESCE(SUM(CASE WHEN p.estado_conciliacion='conciliado' THEN p.monto END),0) AS conciliado,
             COALESCE(SUM(CASE WHEN p.estado_conciliacion IS NULL OR p.estado_conciliacion IN ('pendiente','observado') THEN p.monto END),0) AS pendiente
      FROM pagos p
      JOIN ventas v ON v.id = p.venta_id
      WHERE p.metodo <> 'efectivo' AND ${VENTAS_OK}
        ${scopeSQL(sid)}
        ${fechaSQL(desde, hasta, 'p.created_at')}
      GROUP BY p.metodo
      ORDER BY total DESC
    `);
    return rows;
  },

  // Cuentas por cobrar (créditos pendientes)
  cuentasPorCobrar: async (sid) => {
    const db = getDB();
    // Verificar si existe la tabla cuentas_por_cobrar
    try {
      const [rows] = await db.query(`
        SELECT cpc.id, c.nombre AS cliente, c.numero_doc,
               cpc.monto_total, cpc.monto_pagado,
               (cpc.monto_total - cpc.monto_pagado) AS saldo,
               cpc.estado, cpc.fecha_vencimiento,
               DATEDIFF(CURDATE(), cpc.fecha_vencimiento) AS dias_vencido
        FROM cuentas_por_cobrar cpc
        LEFT JOIN clientes c ON c.id = cpc.cliente_id
        WHERE (cpc.monto_total - cpc.monto_pagado) > 0
        ORDER BY dias_vencido DESC
        LIMIT 100
      `);
      return rows;
    } catch (e) {
      if (e && (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146)) return [];
      throw e;
    }
  },

  // ══════════════ COTIZACIONES ══════════════

  // Tasa de conversión (cotización -> venta)
  conversionCotizaciones: async (sid, desde, hasta) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT
        COUNT(*) AS total_cotizaciones,
        COALESCE(SUM(CASE WHEN co.estado='convertida' THEN 1 ELSE 0 END),0) AS convertidas,
        COALESCE(SUM(CASE WHEN co.estado='vigente' THEN 1 ELSE 0 END),0) AS vigentes,
        COALESCE(SUM(CASE WHEN co.estado='vencida' THEN 1 ELSE 0 END),0) AS vencidas,
        COALESCE(SUM(co.total),0) AS monto_total,
        COALESCE(SUM(CASE WHEN co.estado='convertida' THEN co.total END),0) AS monto_convertido
      FROM cotizaciones co
      WHERE 1=1
        ${sid ? `AND co.sucursal_id = ${Number(sid)}` : ''}
        ${fechaSQL(desde, hasta, 'co.created_at')}
    `);
    return row;
  },

  // Cotizaciones por estado
  cotizacionesPorEstado: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT co.estado,
             COUNT(*) AS cantidad,
             COALESCE(SUM(co.total),0) AS total
      FROM cotizaciones co
      WHERE 1=1
        ${sid ? `AND co.sucursal_id = ${Number(sid)}` : ''}
        ${fechaSQL(desde, hasta, 'co.created_at')}
      GROUP BY co.estado
      ORDER BY cantidad DESC
    `);
    return rows;
  },

  // Cotizaciones por vendedor
  cotizacionesPorVendedor: async (sid, desde, hasta) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT u.nombre AS vendedor,
             COUNT(*) AS total_cotizaciones,
             COALESCE(SUM(CASE WHEN co.estado='convertida' THEN 1 ELSE 0 END),0) AS convertidas,
             COALESCE(SUM(co.total),0) AS monto_total
      FROM cotizaciones co
      JOIN usuarios u ON u.id = co.vendedor_id
      WHERE 1=1
        ${sid ? `AND co.sucursal_id = ${Number(sid)}` : ''}
        ${fechaSQL(desde, hasta, 'co.created_at')}
      GROUP BY u.id, u.nombre
      ORDER BY monto_total DESC
    `);
    return rows;
  },

  inventarioResumen: async (sid, desde, hasta) => {
    const db=getDB();
    const [[kpi]]=await db.query(`SELECT COUNT(*) productos_activos,
      COALESCE(SUM(p.stock_actual),0) unidades_disponibles,
      SUM(p.stock_actual<=p.stock_minimo) stock_bajo,
      SUM(p.stock_actual<=0) sin_stock,
      COALESCE(SUM(p.stock_actual*p.precio_costo),0) valor_costo,
      COALESCE(SUM(p.stock_actual*p.precio_venta),0) valor_venta
      FROM productos p WHERE p.estado=0 ${sid?`AND (p.sucursal_id=${Number(sid)} OR p.sucursal_id IS NULL)`:''}`);
    const [movimientos]=await db.query(`SELECT im.created_at,im.tipo,im.cantidad,im.stock_antes,im.stock_despues,im.referencia,
      p.nombre producto,s.nombre sucursal,u.nombre usuario
      FROM inventario_movimientos im JOIN productos p ON p.id=im.producto_id
      LEFT JOIN sucursales s ON s.id=im.sucursal_id LEFT JOIN usuarios u ON u.id=im.usuario_id
      WHERE 1=1 ${sid?`AND im.sucursal_id=${Number(sid)}`:''} ${fechaSQL(desde,hasta,'im.created_at')}
      ORDER BY im.created_at DESC,im.id DESC LIMIT 300`);
    const [porTipo]=await db.query(`SELECT im.tipo,COUNT(*) movimientos,COALESCE(SUM(ABS(im.cantidad)),0) unidades
      FROM inventario_movimientos im WHERE 1=1 ${sid?`AND im.sucursal_id=${Number(sid)}`:''} ${fechaSQL(desde,hasta,'im.created_at')}
      GROUP BY im.tipo ORDER BY movimientos DESC`);
    return {kpi,movimientos,porTipo};
  },

  comprobantesResumen: async (sid, desde, hasta) => {
    const db=getDB();
    const base=` FROM comprobantes c JOIN ventas v ON v.id=c.venta_id WHERE 1=1 ${sid?`AND v.sucursal_id=${Number(sid)}`:''} ${fechaSQL(desde,hasta,'c.emitido_at')}`;
    const [[kpi]]=await db.query(`SELECT COUNT(*) emitidos,COALESCE(SUM(c.total),0) monto_emitido,
      SUM(c.estado_sunat='aceptado') aceptados,SUM(c.estado_sunat='observado') observados,
      SUM(c.estado_sunat='pendiente') pendientes,SUM(c.estado_sunat='rechazado') rechazados ${base}`);
    const [porEstado]=await db.query(`SELECT c.estado_sunat estado,COUNT(*) cantidad,COALESCE(SUM(c.total),0) total ${base} GROUP BY c.estado_sunat ORDER BY cantidad DESC`);
    const [porTipo]=await db.query(`SELECT c.tipo,COUNT(*) cantidad,COALESCE(SUM(c.total),0) total ${base} GROUP BY c.tipo ORDER BY cantidad DESC`);
    const [detalle]=await db.query(`SELECT c.numero_full,c.tipo,c.estado_sunat,c.total,c.emitido_at,c.cdr_codigo,c.cdr_mensaje,
      v.numero venta_numero,s.nombre sucursal,COALESCE(NULLIF(cl.razon_social,''),TRIM(CONCAT_WS(' ',cl.nombre,cl.apellido_paterno,cl.apellido_materno)),'Cliente general') cliente
      FROM comprobantes c JOIN ventas v ON v.id=c.venta_id LEFT JOIN sucursales s ON s.id=v.sucursal_id LEFT JOIN clientes cl ON cl.id=v.cliente_id
      WHERE 1=1 ${sid?`AND v.sucursal_id=${Number(sid)}`:''} ${fechaSQL(desde,hasta,'c.emitido_at')}
      ORDER BY c.emitido_at DESC,c.id DESC LIMIT 300`);
    return {kpi,porEstado,porTipo,detalle};
  }

};

module.exports = ReporteModel;