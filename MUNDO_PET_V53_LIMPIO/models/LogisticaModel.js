const { getDB } = require('../config/database');

function cleanText(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function scopeClause(sucursalId, alias = 'r') {
  return sucursalId ? { sql: ` AND ${alias}.sucursal_id = ?`, params: [Number(sucursalId)] } : { sql: '', params: [] };
}

const LogisticaModel = {
  async resumen(sucursalId = null, desde = null, hasta = null) {
    const db = getDB();
    const scope = scopeClause(sucursalId, 'r');
    const dateSql = `${desde ? ' AND r.fecha >= ?' : ''}${hasta ? ' AND r.fecha <= ?' : ''}`;
    const params = [...scope.params];
    if (desde) params.push(desde);
    if (hasta) params.push(hasta);

    const [[kpi]] = await db.query(`
      SELECT
        COUNT(*) rutas,
        SUM(r.estado='planificada') planificadas,
        SUM(r.estado='cargada') cargadas,
        SUM(r.estado='en_ruta') en_ruta,
        SUM(r.estado='completada') completadas,
        COALESCE(SUM(GREATEST(r.km_final-r.km_inicial,0)),0) km_recorridos
      FROM rutas_reparto r WHERE 1=1${scope.sql}${dateSql}
    `, params);

    const [porEstado] = await db.query(`
      SELECT r.estado, COUNT(*) cantidad
      FROM rutas_reparto r WHERE 1=1${scope.sql}${dateSql}
      GROUP BY r.estado ORDER BY FIELD(r.estado,'en_ruta','cargada','planificada','completada','cancelada')
    `, params);

    const [rendimiento] = await db.query(`
      SELECT rp.id, rp.nombres repartidor,
             COUNT(DISTINCT r.id) rutas,
             SUM(CASE WHEN d.estado='entregado' THEN 1 ELSE 0 END) entregados,
             SUM(CASE WHEN d.estado='no_entregado' THEN 1 ELSE 0 END) no_entregados,
             COUNT(d.id) paradas,
             ROUND(100 * SUM(CASE WHEN d.estado='entregado' THEN 1 ELSE 0 END) / NULLIF(COUNT(d.id),0),1) efectividad
      FROM repartidores rp
      LEFT JOIN rutas_reparto r ON r.repartidor_id=rp.id${sucursalId ? ' AND r.sucursal_id=?' : ''}${desde ? ' AND r.fecha>=?' : ''}${hasta ? ' AND r.fecha<=?' : ''}
      LEFT JOIN ruta_reparto_pedidos d ON d.ruta_id=r.id
      WHERE rp.estado=1
      GROUP BY rp.id,rp.nombres ORDER BY entregados DESC,rutas DESC LIMIT 10
    `, [...(sucursalId ? [Number(sucursalId)] : []), ...(desde ? [desde] : []), ...(hasta ? [hasta] : [])]);

    const [[pending]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM pedido_entregas_sucursal pes
          JOIN pedidos_web pw ON pw.id=pes.pedido_id
          WHERE pes.tipo_entrega='delivery' AND pw.estado_pago='aprobado' AND pes.estado IN ('pendiente','preparando','listo')
            ${sucursalId ? 'AND pes.sucursal_id=?' : ''}
            AND NOT EXISTS(
            SELECT 1 FROM ruta_reparto_pedidos x
            JOIN rutas_reparto ar ON ar.id=x.ruta_id
            WHERE x.pedido_entrega_sucursal_id=pes.id
              AND ar.estado NOT IN ('cancelada','completada')
              AND x.estado IN ('pendiente','en_camino','entregado')
          ))
        +
        (SELECT COUNT(*) FROM ventas v
          WHERE v.tipo_entrega='delivery' AND v.estado_venta='registrada' AND v.pedido_web_id IS NULL
            ${sucursalId ? 'AND v.sucursal_id=?' : ''}
            AND NOT EXISTS(SELECT 1 FROM ruta_reparto_pedidos x WHERE x.venta_id=v.id AND x.estado<>'no_entregado')) pendientes
    `, sucursalId ? [Number(sucursalId), Number(sucursalId)] : []);

    return { kpi: { ...kpi, pendientes: Number(pending?.pendientes || 0) }, porEstado, rendimiento };
  },

  async listarRepartidores(sucursalId = null) {
    const db = getDB();
    const params = [];
    let sql = `SELECT rp.*,u.username,u.nombre usuario_nombre,s.nombre sucursal_nombre
      FROM repartidores rp
      LEFT JOIN usuarios u ON u.id=rp.usuario_id
      LEFT JOIN sucursales s ON s.id=rp.sucursal_id
      WHERE rp.estado<>2`;
    if (sucursalId) { sql += ' AND (rp.sucursal_id=? OR rp.sucursal_id IS NULL)'; params.push(Number(sucursalId)); }
    sql += ' ORDER BY rp.estado DESC,rp.nombres';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  async guardarRepartidor(data, id = null) {
    const db = getDB();
    const values = {
      usuario_id: Number(data.usuario_id) || null,
      sucursal_id: Number(data.sucursal_id) || null,
      nombres: cleanText(data.nombres, 160),
      documento: cleanText(data.documento, 20),
      telefono: cleanText(data.telefono, 30),
      licencia: cleanText(data.licencia, 40),
      categoria_licencia: cleanText(data.categoria_licencia, 20),
      licencia_vencimiento: data.licencia_vencimiento || null,
      contacto_emergencia: cleanText(data.contacto_emergencia, 160),
      telefono_emergencia: cleanText(data.telefono_emergencia, 30),
      estado: Number(data.estado ?? 1) === 0 ? 0 : 1
    };
    if (!values.nombres) throw Object.assign(new Error('El nombre del repartidor es obligatorio'), { status: 400 });
    if (id) {
      await db.query(`UPDATE repartidores SET usuario_id=?,sucursal_id=?,nombres=?,documento=?,telefono=?,licencia=?,categoria_licencia=?,licencia_vencimiento=?,contacto_emergencia=?,telefono_emergencia=?,estado=?,updated_at=NOW() WHERE id=?`,
        [...Object.values(values), Number(id)]);
      return Number(id);
    }
    const [r] = await db.query(`INSERT INTO repartidores(usuario_id,sucursal_id,nombres,documento,telefono,licencia,categoria_licencia,licencia_vencimiento,contacto_emergencia,telefono_emergencia,estado) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, Object.values(values));
    return r.insertId;
  },

  async listarVehiculos(sucursalId = null) {
    const db = getDB();
    const params = [];
    let sql = `SELECT v.*,s.nombre sucursal_nombre,
      CASE WHEN v.soat_vencimiento IS NOT NULL AND v.soat_vencimiento<CURDATE() THEN 1 ELSE 0 END soat_vencido,
      CASE WHEN v.revision_vencimiento IS NOT NULL AND v.revision_vencimiento<CURDATE() THEN 1 ELSE 0 END revision_vencida
      FROM vehiculos v LEFT JOIN sucursales s ON s.id=v.sucursal_id WHERE v.estado<>2`;
    if (sucursalId) { sql += ' AND (v.sucursal_id=? OR v.sucursal_id IS NULL)'; params.push(Number(sucursalId)); }
    sql += ' ORDER BY v.estado_operativo,v.placa';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  async guardarVehiculo(data, id = null) {
    const db = getDB();
    const values = {
      sucursal_id: Number(data.sucursal_id) || null,
      placa: cleanText(data.placa, 15).toUpperCase(),
      tipo: cleanText(data.tipo, 30) || 'camion',
      marca: cleanText(data.marca, 60),
      modelo: cleanText(data.modelo, 60),
      anio: Number(data.anio) || null,
      capacidad_kg: Number(data.capacidad_kg) || 0,
      capacidad_m3: Number(data.capacidad_m3) || 0,
      soat_vencimiento: data.soat_vencimiento || null,
      revision_vencimiento: data.revision_vencimiento || null,
      estado_operativo: ['disponible','en_ruta','mantenimiento','inactivo'].includes(data.estado_operativo) ? data.estado_operativo : 'disponible',
      observaciones: cleanText(data.observaciones, 500),
      estado: Number(data.estado ?? 1) === 0 ? 0 : 1
    };
    if (!values.placa) throw Object.assign(new Error('La placa es obligatoria'), { status: 400 });
    if (id) {
      await db.query(`UPDATE vehiculos SET sucursal_id=?,placa=?,tipo=?,marca=?,modelo=?,anio=?,capacidad_kg=?,capacidad_m3=?,soat_vencimiento=?,revision_vencimiento=?,estado_operativo=?,observaciones=?,estado=?,updated_at=NOW() WHERE id=?`, [...Object.values(values), Number(id)]);
      return Number(id);
    }
    const [r] = await db.query(`INSERT INTO vehiculos(sucursal_id,placa,tipo,marca,modelo,anio,capacidad_kg,capacidad_m3,soat_vencimiento,revision_vencimiento,estado_operativo,observaciones,estado) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, Object.values(values));
    return r.insertId;
  },

  async listarRutas({ sucursalId = null, desde = null, hasta = null, estado = null } = {}) {
    const db = getDB();
    const params = [];
    let sql = `SELECT r.*,s.nombre sucursal_nombre,rp.nombres repartidor,v.placa,
      COUNT(d.id) paradas,
      SUM(d.estado='entregado') entregados,
      SUM(d.estado='no_entregado') no_entregados,
      COALESCE(SUM(d.monto_cobrar),0) monto_cobrar,COALESCE(SUM(d.peso_estimado_kg),0) peso_estimado_kg
      FROM rutas_reparto r
      LEFT JOIN sucursales s ON s.id=r.sucursal_id
      LEFT JOIN repartidores rp ON rp.id=r.repartidor_id
      LEFT JOIN vehiculos v ON v.id=r.vehiculo_id
      LEFT JOIN ruta_reparto_pedidos d ON d.ruta_id=r.id
      WHERE 1=1`;
    if (sucursalId) { sql += ' AND r.sucursal_id=?'; params.push(Number(sucursalId)); }
    if (desde) { sql += ' AND r.fecha>=?'; params.push(desde); }
    if (hasta) { sql += ' AND r.fecha<=?'; params.push(hasta); }
    if (estado) { sql += ' AND r.estado=?'; params.push(estado); }
    sql += ' GROUP BY r.id ORDER BY r.fecha DESC,r.id DESC LIMIT 300';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  async obtenerRuta(id) {
    const db = getDB();
    const [[ruta]] = await db.query(`SELECT r.*,s.nombre sucursal_nombre,rp.nombres repartidor,rp.telefono repartidor_telefono,v.placa,v.marca,v.modelo
      FROM rutas_reparto r LEFT JOIN sucursales s ON s.id=r.sucursal_id LEFT JOIN repartidores rp ON rp.id=r.repartidor_id LEFT JOIN vehiculos v ON v.id=r.vehiculo_id WHERE r.id=?`, [Number(id)]);
    if (!ruta) return null;
    const [pedidos] = await db.query(`SELECT d.*,
      pw.numero_orden,pw.estado_pedido,pw.estado_pago,
      vt.numero venta_numero,vt.tipo_comprobante
      FROM ruta_reparto_pedidos d
      LEFT JOIN pedidos_web pw ON pw.id=d.pedido_web_id
      LEFT JOIN ventas vt ON vt.id=d.venta_id
      WHERE d.ruta_id=? ORDER BY d.orden,d.id`, [Number(id)]);
    const [evidencias] = await db.query(`SELECT id,ruta_detalle_id,tipo,sha256,created_by,created_at
      FROM reparto_evidencias WHERE ruta_id=? AND eliminado_at IS NULL ORDER BY id`, [Number(id)]);
    const [historial] = await db.query(`SELECT h.*,u.nombre usuario_nombre FROM reparto_historial h
      LEFT JOIN usuarios u ON u.id=h.usuario_id WHERE h.ruta_id=? ORDER BY h.id DESC LIMIT 200`, [Number(id)]);
    const byDetail = new Map();
    for (const ev of evidencias) {
      const key=Number(ev.ruta_detalle_id); if(!byDetail.has(key))byDetail.set(key,[]); byDetail.get(key).push(ev);
    }
    for (const pedido of pedidos) pedido.evidencias = byDetail.get(Number(pedido.id)) || [];
    return { ...ruta, pedidos, historial };
  },

  async crearRuta(data, userId) {
    const db = getDB();
    const fecha = data.fecha || new Date().toISOString().slice(0, 10);
    const sucursalId = Number(data.sucursal_id) || null;
    const repartidorId = Number(data.repartidor_id) || null;
    const vehiculoId = Number(data.vehiculo_id) || null;
    if (!sucursalId || !repartidorId || !vehiculoId) throw Object.assign(new Error('Selecciona sucursal, repartidor y camión'), { status: 400 });
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[busyDriver]] = await conn.query(`SELECT id FROM rutas_reparto WHERE fecha=? AND repartidor_id=? AND estado IN ('planificada','cargada','en_ruta') LIMIT 1`, [fecha, repartidorId]);
      if (busyDriver) throw Object.assign(new Error('El repartidor ya tiene una ruta activa para esa fecha'), { status: 409 });
      const [[busyVehicle]] = await conn.query(`SELECT id FROM rutas_reparto WHERE fecha=? AND vehiculo_id=? AND estado IN ('planificada','cargada','en_ruta') LIMIT 1`, [fecha, vehiculoId]);
      if (busyVehicle) throw Object.assign(new Error('El camión ya está asignado a una ruta activa para esa fecha'), { status: 409 });
      const [[clock]] = await conn.query(`SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') hoy`);
      if (fecha < clock.hoy) throw Object.assign(new Error('No se puede planificar una ruta en una fecha pasada'), { status: 400 });

      const [[driver]] = await conn.query(`SELECT sucursal_id,licencia_vencimiento FROM repartidores WHERE id=? AND estado=1 FOR UPDATE`, [repartidorId]);
      if (!driver) throw Object.assign(new Error('El repartidor no está activo'), { status: 409 });
      if (driver.sucursal_id && Number(driver.sucursal_id) !== sucursalId) throw Object.assign(new Error('El repartidor pertenece a otra sucursal'), { status: 409 });
      if (driver.licencia_vencimiento && String(driver.licencia_vencimiento).slice(0,10) < fecha) throw Object.assign(new Error('La licencia del repartidor está vencida'), { status: 409 });

      const [[v]] = await conn.query(`SELECT sucursal_id,estado_operativo,soat_vencimiento,revision_vencimiento FROM vehiculos WHERE id=? AND estado=1 FOR UPDATE`, [vehiculoId]);
      if (!v || v.estado_operativo!=='disponible') throw Object.assign(new Error('El camión no está disponible'), { status: 409 });
      if (v.sucursal_id && Number(v.sucursal_id) !== sucursalId) throw Object.assign(new Error('El camión pertenece a otra sucursal'), { status: 409 });
      if (v.soat_vencimiento && String(v.soat_vencimiento).slice(0,10) < fecha) throw Object.assign(new Error('El SOAT del camión está vencido'), { status: 409 });
      if (v.revision_vencimiento && String(v.revision_vencimiento).slice(0,10) < fecha) throw Object.assign(new Error('La revisión técnica del camión está vencida'), { status: 409 });
      const [[seq]] = await conn.query(`SELECT COALESCE(MAX(id),0)+1 n FROM rutas_reparto`);
      const codigo = `R-${fecha.replaceAll('-','')}-${String(seq.n).padStart(4,'0')}`;
      const [r] = await conn.query(`INSERT INTO rutas_reparto(codigo,fecha,sucursal_id,repartidor_id,vehiculo_id,estado,hora_salida_programada,observaciones,created_by) VALUES(?,?,?,?,?,'planificada',?,?,?)`, [codigo,fecha,sucursalId,repartidorId,vehiculoId,data.hora_salida_programada || null,cleanText(data.observaciones,500),Number(userId)||null]);
      await conn.commit();
      return r.insertId;
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  },

  async sincronizarEntregasDelivery(sucursalId = null) {
    const db = getDB();
    const scope = sucursalId ? ' AND items.sucursal_id=?' : '';
    const params = sucursalId ? [Number(sucursalId)] : [];
    await db.query(`
      INSERT INTO pedido_entregas_sucursal
        (pedido_id,venta_id,sucursal_id,tipo_entrega,estado,created_at,updated_at)
      SELECT pw.id,pw.venta_id,items.sucursal_id,'delivery','pendiente',COALESCE(pw.created_at,NOW()),NOW()
      FROM pedidos_web pw
      JOIN (SELECT pedido_id,sucursal_id FROM pedido_items WHERE sucursal_id IS NOT NULL GROUP BY pedido_id,sucursal_id) items
        ON items.pedido_id=pw.id
      WHERE pw.estado_pago='aprobado' AND pw.tipo_entrega='delivery'${scope}
        AND NOT EXISTS(
          SELECT 1 FROM pedido_entregas_sucursal pes
          WHERE pes.pedido_id=pw.id AND pes.sucursal_id=items.sucursal_id
        )
    `, params);
    await db.query(`
      UPDATE pedido_entregas_sucursal pes
      JOIN pedidos_web pw ON pw.id=pes.pedido_id
      SET pes.tipo_entrega='delivery',pes.venta_id=COALESCE(pes.venta_id,pw.venta_id),pes.updated_at=NOW()
      WHERE pw.estado_pago='aprobado' AND pw.tipo_entrega='delivery'
        ${sucursalId ? 'AND pes.sucursal_id=?' : ''}
    `, params);
  },

  async candidatos(sucursalId = null, onlyReady = false) {
    const db = getDB();
    await this.sincronizarEntregasDelivery(sucursalId);

    const deliveryParams = sucursalId ? [Number(sucursalId)] : [];
    const saleParams = sucursalId ? [Number(sucursalId)] : [];
    const deliveryScope = sucursalId ? ' AND pes.sucursal_id=?' : '';
    const saleScope = sucursalId ? ' AND v.sucursal_id=?' : '';
    const preparationFilter = onlyReady ? "pes.estado='listo'" : "pes.estado IN ('pendiente','preparando','listo')";

    // Se consultan pedidos web y ventas presenciales por separado para mantener compatibilidad
    // con instalaciones antiguas que tienen tablas configuradas con collations distintas.
    const [webRows] = await db.query(`
      SELECT 'pedido_web' origen,pw.id origen_id,pes.id entrega_sucursal_id,pw.numero_orden numero,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pw.cliente_snapshot,'$.nombre_completo')),
                 JSON_UNQUOTE(JSON_EXTRACT(pw.cliente_snapshot,'$.razon_social')),cw.nombre,'Cliente web') cliente,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pw.cliente_snapshot,'$.telefono')),cw.telefono,'') telefono,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pw.direccion_snapshot,'$.direccion')),pw.direccion_entrega,'') direccion,
        0 monto_cobrar,pw.metodo_pago,pes.sucursal_id,pw.created_at,pes.estado estado_preparacion,
        COALESCE((SELECT SUM(pi.cantidad) FROM pedido_items pi WHERE pi.pedido_id=pw.id AND pi.sucursal_id=pes.sucursal_id),0) peso_estimado_kg,
        s.nombre sucursal_nombre
      FROM pedido_entregas_sucursal pes
      JOIN pedidos_web pw ON pw.id=pes.pedido_id
      LEFT JOIN clientes_web cw ON cw.id=pw.cliente_web_id
      LEFT JOIN sucursales s ON s.id=pes.sucursal_id
      WHERE pes.tipo_entrega='delivery'
        AND pw.estado_pago='aprobado'
        AND ${preparationFilter}${deliveryScope}
        AND NOT EXISTS(
          SELECT 1
          FROM ruta_reparto_pedidos x
          JOIN rutas_reparto ar ON ar.id=x.ruta_id
          WHERE x.pedido_entrega_sucursal_id=pes.id
            AND ar.estado IN ('planificada','cargada','en_ruta')
            AND x.estado<>'no_entregado'
        )
      ORDER BY pw.created_at ASC
      LIMIT 500
    `, deliveryParams);

    const [saleRows] = await db.query(`
      SELECT 'venta' origen,v.id origen_id,NULL entrega_sucursal_id,v.numero,
        COALESCE(NULLIF(c.razon_social,''),NULLIF(TRIM(CONCAT_WS(' ',c.nombre,c.apellido_paterno,c.apellido_materno)),''),NULLIF(v.cliente_web_nombre,''),'Cliente general') cliente,
        COALESCE(c.telefono,'') telefono,
        COALESCE(c.direccion,JSON_UNQUOTE(JSON_EXTRACT(v.direccion_snapshot,'$.direccion')),'') direccion,
        CASE WHEN v.estado IN ('pagado','pagada') THEN 0 ELSE v.total END monto_cobrar,
        v.metodo_pago,v.sucursal_id,v.created_at,'listo' estado_preparacion,
        COALESCE((SELECT SUM(vii.cantidad) FROM venta_items vii WHERE vii.venta_id=v.id),0) peso_estimado_kg,
        s.nombre sucursal_nombre
      FROM ventas v
      LEFT JOIN clientes c ON c.id=v.cliente_id
      LEFT JOIN sucursales s ON s.id=v.sucursal_id
      WHERE v.tipo_entrega='delivery'
        AND v.estado_venta='registrada'
        AND v.pedido_web_id IS NULL${saleScope}
        AND NOT EXISTS(
          SELECT 1
          FROM ruta_reparto_pedidos x
          JOIN rutas_reparto ar ON ar.id=x.ruta_id
          WHERE x.venta_id=v.id
            AND ar.estado IN ('planificada','cargada','en_ruta')
            AND x.estado<>'no_entregado'
        )
      ORDER BY v.created_at ASC
      LIMIT 500
    `, saleParams);

    return [...webRows, ...saleRows]
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
      .slice(0, 500);
  },

  async asignarPedidos(rutaId, items = []) {
    const db = getDB();
    if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('Selecciona al menos un pedido'), { status: 400 });
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[ruta]] = await conn.query(`SELECT r.*,v.capacidad_kg FROM rutas_reparto r JOIN vehiculos v ON v.id=r.vehiculo_id WHERE r.id=? FOR UPDATE`, [Number(rutaId)]);
      if (!ruta) throw Object.assign(new Error('Ruta no encontrada'), { status: 404 });
      if (!['planificada','cargada'].includes(ruta.estado)) throw Object.assign(new Error('La ruta ya no admite nuevos pedidos'), { status: 409 });

      const [[currentLoad]] = await conn.query(`SELECT COALESCE(SUM(peso_estimado_kg),0) peso FROM ruta_reparto_pedidos WHERE ruta_id=? AND estado<>'no_entregado'`, [Number(rutaId)]);
      const [[last]] = await conn.query(`SELECT COALESCE(MAX(orden),0) n FROM ruta_reparto_pedidos WHERE ruta_id=?`, [Number(rutaId)]);
      let carga = Number(currentLoad.peso || 0);
      let orden = Number(last.n) || 0;
      let inserted = 0;

      for (const raw of items) {
        const origen = raw.origen === 'venta' ? 'venta' : 'pedido_web';
        const origenId = Number(raw.origen_id);
        const entregaSucursalId = Number(raw.entrega_sucursal_id || 0) || null;
        if (!origenId) continue;

        const [[duplicate]] = await conn.query(
          `SELECT id FROM ruta_reparto_pedidos WHERE estado<>'no_entregado' AND ${origen === 'pedido_web' ? 'pedido_entrega_sucursal_id' : 'venta_id'}=? LIMIT 1`,
          [origen === 'pedido_web' ? entregaSucursalId : origenId]
        );
        if (duplicate) continue;

        let candidate = null;
        if (origen === 'pedido_web') {
          [[candidate]] = await conn.query(`
            SELECT pw.id origen_id,pes.id entrega_sucursal_id,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pw.cliente_snapshot,'$.nombre_completo')),JSON_UNQUOTE(JSON_EXTRACT(pw.cliente_snapshot,'$.razon_social')),cw.nombre,'Cliente web') cliente,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pw.cliente_snapshot,'$.telefono')),cw.telefono,'') telefono,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pw.direccion_snapshot,'$.direccion')),pw.direccion_entrega,'') direccion,
              0 monto_cobrar,pw.metodo_pago,pes.estado estado_preparacion,
              COALESCE((SELECT SUM(pi.cantidad) FROM pedido_items pi WHERE pi.pedido_id=pw.id AND pi.sucursal_id=pes.sucursal_id),0) peso_estimado_kg
            FROM pedido_entregas_sucursal pes
            JOIN pedidos_web pw ON pw.id=pes.pedido_id LEFT JOIN clientes_web cw ON cw.id=pw.cliente_web_id
            WHERE pw.id=? AND pes.id=? AND pes.sucursal_id=? AND pes.tipo_entrega='delivery'
              AND pes.estado='listo' AND pw.estado_pago='aprobado'
            LIMIT 1`, [origenId, entregaSucursalId, Number(ruta.sucursal_id)]);
        } else {
          [[candidate]] = await conn.query(`
            SELECT v.id origen_id,
              COALESCE(NULLIF(c.razon_social,''),NULLIF(TRIM(CONCAT_WS(' ',c.nombre,c.apellido_paterno,c.apellido_materno)),''),NULLIF(v.cliente_web_nombre,''),'Cliente general') cliente,
              COALESCE(c.telefono,'') telefono,
              COALESCE(c.direccion,JSON_UNQUOTE(JSON_EXTRACT(v.direccion_snapshot,'$.direccion')),'') direccion,
              CASE WHEN v.estado IN ('pagado','pagada') THEN 0 ELSE v.total END monto_cobrar,v.metodo_pago,
              COALESCE((SELECT SUM(vi.cantidad) FROM venta_items vi WHERE vi.venta_id=v.id),0) peso_estimado_kg
            FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id
            WHERE v.id=? AND v.tipo_entrega='delivery' AND v.estado_venta='registrada'
              AND v.pedido_web_id IS NULL AND v.sucursal_id=?
            LIMIT 1`, [origenId, Number(ruta.sucursal_id)]);
        }
        if (!candidate) continue;

        const peso = Number(candidate.peso_estimado_kg) || 0;

        await conn.query(`INSERT INTO ruta_reparto_pedidos(ruta_id,pedido_web_id,pedido_entrega_sucursal_id,venta_id,orden,cliente_nombre,telefono,direccion,monto_cobrar,peso_estimado_kg,metodo_cobro,estado)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'pendiente')`, [
          Number(rutaId), origen === 'pedido_web' ? origenId : null, origen === 'pedido_web' ? entregaSucursalId : null, origen === 'venta' ? origenId : null,
          ++orden, cleanText(candidate.cliente,200), cleanText(candidate.telefono,30), cleanText(candidate.direccion,500),
          Number(candidate.monto_cobrar) || 0, peso, cleanText(candidate.metodo_pago,30)
        ]);
        if (origen === 'pedido_web' && entregaSucursalId) {
          await conn.query("UPDATE pedido_entregas_sucursal SET estado='asignado',updated_at=NOW() WHERE id=? AND estado='listo'", [entregaSucursalId]);
        }
        carga += peso;
        inserted++;
      }

      if (!inserted) throw Object.assign(new Error('Los pedidos seleccionados ya fueron asignados o no cumplen las condiciones de reparto'), { status: 409 });
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  },

  async cambiarEstadoRuta(id, estado, payload = {}) {
    const db = getDB();
    const allowed = ['planificada','cargada','en_ruta','completada','cancelada'];
    if (!allowed.includes(estado)) throw Object.assign(new Error('Estado de ruta inválido'), { status: 400 });
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[ruta]] = await conn.query(`SELECT * FROM rutas_reparto WHERE id=? FOR UPDATE`, [Number(id)]);
      if (!ruta) throw Object.assign(new Error('Ruta no encontrada'), { status: 404 });
      const transitions = {
        planificada:['cargada','cancelada'], cargada:['en_ruta','planificada','cancelada'], en_ruta:['completada'], completada:[], cancelada:[]
      };
      if (ruta.estado!==estado && !transitions[ruta.estado]?.includes(estado)) throw Object.assign(new Error(`No se puede pasar de ${ruta.estado} a ${estado}`), { status: 409 });
      let extra = '', params = [estado];
      if (estado==='en_ruta') { const [[stops]]=await conn.query(`SELECT COUNT(*) n FROM ruta_reparto_pedidos WHERE ruta_id=?`,[Number(id)]); if(!Number(stops.n)) throw Object.assign(new Error('Asigna al menos un pedido antes de iniciar la ruta'),{status:409}); extra=',hora_salida_real=COALESCE(hora_salida_real,NOW()),km_inicial=?'; params.push(Number(payload.km_inicial)||0); }
      if (estado==='completada') {
        const [[pending]] = await conn.query(`SELECT COUNT(*) n FROM ruta_reparto_pedidos WHERE ruta_id=? AND estado IN ('pendiente','en_camino')`, [Number(id)]);
        if (Number(pending.n)>0) throw Object.assign(new Error('Primero marca todas las entregas como entregadas o no entregadas'), { status: 409 });
        const kmFinal=Number(payload.km_final)||0; if(kmFinal<Number(ruta.km_inicial||0)) throw Object.assign(new Error('El kilometraje final no puede ser menor al inicial'),{status:400}); extra=',hora_retorno=NOW(),km_final=?'; params.push(kmFinal);
      }
      params.push(Number(id));
      await conn.query(`UPDATE rutas_reparto SET estado=?${extra},updated_at=NOW() WHERE id=?`, params);
      await conn.query(`INSERT INTO reparto_historial(ruta_id,estado_anterior,estado_nuevo,comentario,usuario_id)
        VALUES(?,?,?,?,?)`,[Number(id),ruta.estado,estado,cleanText(payload.observacion,500),Number(payload.usuario_id)||null]);
      if (estado==='en_ruta') await conn.query(`UPDATE vehiculos SET estado_operativo='en_ruta',updated_at=NOW() WHERE id=?`, [ruta.vehiculo_id]);
      if (['completada','cancelada'].includes(estado)) await conn.query(`UPDATE vehiculos SET estado_operativo='disponible',updated_at=NOW() WHERE id=?`, [ruta.vehiculo_id]);
      if (estado==='en_ruta') {
        await conn.query(`UPDATE ruta_reparto_pedidos SET estado='en_camino',updated_at=NOW() WHERE ruta_id=? AND estado='pendiente'`, [Number(id)]);
        await conn.query(`UPDATE pedido_entregas_sucursal pes JOIN ruta_reparto_pedidos d ON d.pedido_entrega_sucursal_id=pes.id SET pes.estado='en_ruta',pes.updated_at=NOW() WHERE d.ruta_id=?`,[Number(id)]);
        await conn.query(`UPDATE pedidos_web pw JOIN ruta_reparto_pedidos d ON d.pedido_web_id=pw.id SET pw.estado_pedido='despachado',pw.updated_at=NOW() WHERE d.ruta_id=? AND pw.estado_pedido IN ('preparando','despachado')`, [Number(id)]);
      }
      if (estado==='cancelada') {
        await conn.query(`UPDATE pedido_entregas_sucursal pes
          JOIN ruta_reparto_pedidos d ON d.pedido_entrega_sucursal_id=pes.id
          SET pes.estado='listo',pes.updated_at=NOW()
          WHERE d.ruta_id=? AND pes.estado IN ('asignado','en_ruta')`, [Number(id)]);
        await conn.query(`UPDATE ruta_reparto_pedidos SET estado='no_entregado',observacion_entrega=CASE WHEN observacion_entrega='' THEN 'Ruta cancelada' ELSE observacion_entrega END,updated_at=NOW() WHERE ruta_id=? AND estado IN ('pendiente','en_camino')`, [Number(id)]);
      }
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  },

  async cambiarEstadoEntrega(rutaId, detalleId, estado, payload = {}, userId = null) {
    const db = getDB();
    if (!['pendiente','en_camino','entregado','no_entregado'].includes(estado)) throw Object.assign(new Error('Estado de entrega inválido'), { status: 400 });
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[d]] = await conn.query(`SELECT d.*,r.estado ruta_estado FROM ruta_reparto_pedidos d JOIN rutas_reparto r ON r.id=d.ruta_id WHERE d.id=? AND d.ruta_id=? FOR UPDATE`, [Number(detalleId),Number(rutaId)]);
      if (!d) throw Object.assign(new Error('Entrega no encontrada'), { status: 404 });
      if (['completada','cancelada'].includes(d.ruta_estado)) throw Object.assign(new Error('La ruta ya está cerrada'), { status: 409 });
      if (estado==='entregado') {
        if (cleanText(payload.receptor_nombre,160).length<3) throw Object.assign(new Error('Registra el nombre de quien recibió'),{status:400});
        const [[photos]]=await conn.query('SELECT COUNT(*) n FROM reparto_evidencias WHERE ruta_detalle_id=? AND eliminado_at IS NULL',[Number(detalleId)]);
        if(Number(photos.n)<1) throw Object.assign(new Error('Agrega al menos una fotografía antes de confirmar la entrega'),{status:409});
      }
      if (estado==='no_entregado' && cleanText(payload.observacion,500).length<5) throw Object.assign(new Error('Explica por qué no se entregó'),{status:400});
      await conn.query(`UPDATE ruta_reparto_pedidos SET estado=?,observacion_entrega=?,receptor_nombre=?,receptor_documento=?,monto_cobrado=?,metodo_cobro=COALESCE(NULLIF(?,''),metodo_cobro),entregado_at=${estado==='entregado'?'NOW()':'NULL'},updated_by=?,updated_at=NOW() WHERE id=?`,
        [estado,cleanText(payload.observacion,500),cleanText(payload.receptor_nombre,160),cleanText(payload.receptor_documento,20),Number(payload.monto_cobrado)||0,cleanText(payload.metodo_cobro,30),Number(userId)||null,Number(detalleId)]);
      if (d.pedido_entrega_sucursal_id) {
        const pesEstado = estado==='entregado' ? 'entregado' : estado==='no_entregado' ? 'incidencia' : estado==='en_camino' ? 'en_ruta' : null;
        if(pesEstado) await conn.query('UPDATE pedido_entregas_sucursal SET estado=?,updated_at=NOW() WHERE id=?',[pesEstado,d.pedido_entrega_sucursal_id]);
      }
      if (d.pedido_web_id && estado==='en_camino') await conn.query(`UPDATE pedidos_web SET estado_pedido='despachado',updated_at=NOW() WHERE id=?`, [d.pedido_web_id]);
      if (d.pedido_web_id && estado==='entregado') {
        const [[remain]]=await conn.query("SELECT COUNT(*) n FROM pedido_entregas_sucursal WHERE pedido_id=? AND estado<>'entregado'",[d.pedido_web_id]);
        if(!Number(remain.n)) await conn.query(`UPDATE pedidos_web SET estado_pedido='entregado',updated_at=NOW() WHERE id=?`, [d.pedido_web_id]);
      }
      await conn.query(`INSERT INTO reparto_historial(ruta_id,ruta_detalle_id,estado_anterior,estado_nuevo,comentario,lat,lng,precision_m,usuario_id)
        VALUES(?,?,?,?,?,?,?,?,?)`,[Number(rutaId),Number(detalleId),d.estado,estado,cleanText(payload.observacion,500),
        Number.isFinite(Number(payload.lat))?Number(payload.lat):null,Number.isFinite(Number(payload.lng))?Number(payload.lng):null,
        Number.isFinite(Number(payload.precision_m))?Number(payload.precision_m):null,Number(userId)||null]);
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  },

  async guardarEvidencia({ rutaId, detalleId, tipo='entrega', privatePath, sha256, userId }) {
    const db=getDB();
    const [[detail]]=await db.query('SELECT id FROM ruta_reparto_pedidos WHERE id=? AND ruta_id=?',[Number(detalleId),Number(rutaId)]);
    if(!detail) throw Object.assign(new Error('Entrega no encontrada'),{status:404});
    const [[count]]=await db.query('SELECT COUNT(*) n FROM reparto_evidencias WHERE ruta_detalle_id=? AND eliminado_at IS NULL',[Number(detalleId)]);
    if(Number(count.n)>=5) throw Object.assign(new Error('Cada entrega admite como máximo cinco fotografías'),{status:409});
    const [[duplicate]]=await db.query('SELECT id FROM reparto_evidencias WHERE ruta_detalle_id=? AND sha256=? AND eliminado_at IS NULL LIMIT 1',[Number(detalleId),sha256]);
    if(duplicate) throw Object.assign(new Error('Esta fotografía ya fue registrada'),{status:409});
    const [result]=await db.query(`INSERT INTO reparto_evidencias(ruta_id,ruta_detalle_id,tipo,archivo_privado,sha256,created_by)
      VALUES(?,?,?,?,?,?)`,[Number(rutaId),Number(detalleId),['fachada','entrega','incidencia'].includes(tipo)?tipo:'entrega',privatePath,sha256,Number(userId)||null]);
    await db.query(`INSERT INTO reparto_historial(ruta_id,ruta_detalle_id,estado_anterior,estado_nuevo,comentario,usuario_id)
      SELECT ruta_id,id,estado,estado,?,? FROM ruta_reparto_pedidos WHERE id=?`,['Evidencia fotográfica agregada',Number(userId)||null,Number(detalleId)]);
    return result.insertId;
  },

  async obtenerEvidencia(id) {
    const [[row]]=await getDB().query(`SELECT e.*,r.sucursal_id FROM reparto_evidencias e
      JOIN rutas_reparto r ON r.id=e.ruta_id WHERE e.id=? AND e.eliminado_at IS NULL LIMIT 1`,[Number(id)]);
    return row||null;
  },

  async retirarEvidencia(id, motivo, userId) {
    const reason=cleanText(motivo,300);
    if(reason.length<5) throw Object.assign(new Error('Indica el motivo para retirar la evidencia'),{status:400});
    await getDB().query(`UPDATE reparto_evidencias SET eliminado_at=NOW(),eliminado_por=?,motivo_eliminacion=?
      WHERE id=? AND eliminado_at IS NULL`,[Number(userId)||null,reason,Number(id)]);
  },

  async reporte(sucursalId, desde, hasta) {
    const db = getDB();
    const params=[]; let scope='';
    if (sucursalId) { scope+=' AND r.sucursal_id=?'; params.push(Number(sucursalId)); }
    if (desde) { scope+=' AND r.fecha>=?'; params.push(desde); }
    if (hasta) { scope+=' AND r.fecha<=?'; params.push(hasta); }
    const [rows] = await db.query(`SELECT r.codigo,r.fecha,s.nombre sucursal,rp.nombres repartidor,v.placa,r.estado,
      COUNT(d.id) paradas,SUM(d.estado='entregado') entregados,SUM(d.estado='no_entregado') no_entregados,
      COALESCE(SUM(d.monto_cobrado),0) cobrado,COALESCE(GREATEST(r.km_final-r.km_inicial,0),0) kilometros
      FROM rutas_reparto r LEFT JOIN sucursales s ON s.id=r.sucursal_id LEFT JOIN repartidores rp ON rp.id=r.repartidor_id LEFT JOIN vehiculos v ON v.id=r.vehiculo_id LEFT JOIN ruta_reparto_pedidos d ON d.ruta_id=r.id
      WHERE 1=1${scope} GROUP BY r.id ORDER BY r.fecha DESC,r.id DESC`,params);
    return rows;
  }
};

module.exports = LogisticaModel;
