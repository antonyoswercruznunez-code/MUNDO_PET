const fs = require('fs/promises');
const path = require('path');

async function tableExists(db, table) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema=DATABASE() AND table_name=?`,
    [table]
  );
  return Number(row?.n || 0) > 0;
}

async function columnExists(db, table, column) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`,
    [table, column]
  );
  return Number(row?.n || 0) > 0;
}

async function addColumn(db, table, column, definition) {
  if (!(await tableExists(db, table)) || (await columnExists(db, table, column))) return false;
  await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  return true;
}

async function indexExists(db, table, index) {
  const [[row]] = await db.query(`SELECT COUNT(*) n FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?`,[table,index]);
  return Number(row?.n||0)>0;
}
async function addIndex(db, table, index, columns) {
  if (!(await tableExists(db,table)) || await indexExists(db,table,index)) return false;
  await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (${columns})`);
  return true;
}

async function ensureFilesAndPaths(db, projectRoot) {
  const mediaRoot = path.join(projectRoot, 'public', 'media');
  const uploadsRoot = path.join(projectRoot, 'public', 'uploads');
  await fs.mkdir(uploadsRoot, { recursive: true });

  async function copyTree(src, dst) {
    let entries;
    try { entries = await fs.readdir(src, { withFileTypes: true }); } catch (_) { return; }
    await fs.mkdir(dst, { recursive: true });
    for (const entry of entries) {
      const from = path.join(src, entry.name);
      const to = path.join(dst, entry.name);
      if (entry.isDirectory()) await copyTree(from, to);
      else {
        try { await fs.access(to); } catch (_) { await fs.copyFile(from, to); }
      }
    }
  }

  await copyTree(mediaRoot, uploadsRoot);

  // La aplicación usa una sola raíz pública. Primero migramos los archivos y
  // las rutas; al final retiramos la carpeta antigua para evitar duplicados.

  if (await tableExists(db, 'tienda_imagenes')) {
    await db.query("UPDATE tienda_imagenes SET ruta=REPLACE(ruta,'/media/','/uploads/') WHERE ruta LIKE '/media/%'");
  }
  if (await tableExists(db, 'usuarios') && await tableExists(db, 'perfiles')) {
    await db.query(`UPDATE usuarios u JOIN perfiles p ON p.id=u.perfil_id
      SET u.es_global=1,u.sucursal_id=NULL,u.session_version=u.session_version+1
      WHERE LOWER(u.username)='antony' AND LOWER(p.nombre) LIKE 'administrador%' AND u.es_global<>1`);
  }

  if (await tableExists(db, 'configuracion')) {
    await db.query("UPDATE configuracion SET valor=REPLACE(valor,'/media/','/uploads/') WHERE valor LIKE '/media/%'");
  }
  if (await tableExists(db, 'producto_imagenes')) {
    await db.query("UPDATE producto_imagenes SET ruta=REPLACE(ruta,'/media/','/uploads/') WHERE ruta LIKE '/media/%'");
  }
  if (await tableExists(db, 'productos') && await columnExists(db, 'productos', 'imagen')) {
    await db.query("UPDATE productos SET imagen=REPLACE(imagen,'/media/','/uploads/') WHERE imagen LIKE '/media/%'");
  }

  await fs.rm(mediaRoot, { recursive: true, force: true }).catch(() => {});
}

// Compatibilidad histórica y actualizaciones aditivas hasta V53.
async function ensureSchema(db, projectRoot) {
  const changes = [];

  for (const [column, definition] of [
    ['direccion_enc', 'TEXT NULL AFTER `departamento`'],
    ['distrito_enc', 'TEXT NULL AFTER `direccion_enc`'],
    ['provincia_enc', 'TEXT NULL AFTER `distrito_enc`'],
    ['departamento_enc', 'TEXT NULL AFTER `provincia_enc`']
  ]) {
    if (await addColumn(db, 'clientes', column, definition)) changes.push(`clientes.${column}`);
  }

  if (await addColumn(db, 'cotizaciones', 'updated_at', 'DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP')) {
    changes.push('cotizaciones.updated_at');
  }

  for (const [table,column,definition] of [
    ['pedidos_web','costo_delivery','DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `total`'],
    ['ventas','costo_delivery','DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `total`'],
    ['ruta_reparto_pedidos','pedido_entrega_sucursal_id','BIGINT NULL AFTER `pedido_web_id`'],
    ['pagos_operaciones_unicas','pedido_web_id','INT NULL AFTER `venta_id`']
  ]) {
    if (await addColumn(db,table,column,definition)) changes.push(`${table}.${column}`);
  }

  for (const [column, definition] of [
    ['es_transferido', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['producto_origen_id', 'INT NULL'],
    ['sucursal_origen_id', 'INT NULL'],
    ['transferencia_venta_habilitada', 'TINYINT(1) NOT NULL DEFAULT 1']
  ]) {
    if (await addColumn(db, 'productos', column, definition)) changes.push(`productos.${column}`);
  }
  const addedPanelSale = await addColumn(db, 'productos', 'transferencia_venta_panel', 'TINYINT(1) NOT NULL DEFAULT 1');
  const addedWebSale = await addColumn(db, 'productos', 'transferencia_venta_web', 'TINYINT(1) NOT NULL DEFAULT 1');
  if (addedPanelSale) changes.push('productos.transferencia_venta_panel');
  if (addedWebSale) changes.push('productos.transferencia_venta_web');
  if (addedPanelSale || addedWebSale) {
    await db.query(`UPDATE productos
      SET transferencia_venta_panel=COALESCE(transferencia_venta_habilitada,1),
          transferencia_venta_web=COALESCE(transferencia_venta_habilitada,1)
      WHERE es_transferido=1`).catch(() => {});
  }

  for (const [column, definition] of [
    ['tipo_descuento', "ENUM('porcentaje','monto') NOT NULL DEFAULT 'porcentaje' AFTER `producto_id`"],
    ['monto', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `porcentaje`']
  ]) {
    if (await addColumn(db, 'temporada_descuentos', column, definition)) changes.push(`temporada_descuentos.${column}`);
  }
  if (await tableExists(db, 'temporada_descuentos')) {
    await db.query(`ALTER TABLE temporada_descuentos ADD UNIQUE KEY uq_temporada_producto (temporada_id,producto_id)`).catch(() => {});
  }

  await db.query(`CREATE TABLE IF NOT EXISTS reparto_evidencias (
    id BIGINT NOT NULL AUTO_INCREMENT,
    ruta_id INT NOT NULL,
    ruta_detalle_id INT NOT NULL,
    tipo ENUM('fachada','entrega','incidencia') NOT NULL DEFAULT 'entrega',
    archivo_privado VARCHAR(500) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    eliminado_at DATETIME NULL,
    eliminado_por INT NULL,
    motivo_eliminacion VARCHAR(300) NOT NULL DEFAULT '',
    PRIMARY KEY (id),
    KEY idx_evidencia_ruta (ruta_id,ruta_detalle_id,eliminado_at),
    UNIQUE KEY uq_evidencia_detalle_hash (ruta_detalle_id,sha256)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await db.query(`CREATE TABLE IF NOT EXISTS reparto_historial (
    id BIGINT NOT NULL AUTO_INCREMENT,
    ruta_id INT NOT NULL,
    ruta_detalle_id INT NULL,
    estado_anterior VARCHAR(40) NOT NULL DEFAULT '',
    estado_nuevo VARCHAR(40) NOT NULL DEFAULT '',
    comentario VARCHAR(500) NOT NULL DEFAULT '',
    lat DECIMAL(10,7) NULL,
    lng DECIMAL(10,7) NULL,
    precision_m DECIMAL(10,2) NULL,
    usuario_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_historial_ruta (ruta_id,ruta_detalle_id,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);


  await db.query(`CREATE TABLE IF NOT EXISTS delivery_tarifas (
    id INT NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(120) NOT NULL,
    sucursal_id INT NULL,
    departamento VARCHAR(100) NOT NULL DEFAULT '',
    provincia VARCHAR(100) NOT NULL DEFAULT '',
    distrito VARCHAR(100) NOT NULL DEFAULT '',
    tarifa_base DECIMAL(12,2) NOT NULL DEFAULT 0,
    cargo_por_unidad DECIMAL(12,2) NOT NULL DEFAULT 0,
    gratis_desde DECIMAL(12,2) NOT NULL DEFAULT 0,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_delivery_tarifa_busqueda (activo,sucursal_id,departamento,provincia,distrito)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await db.query(`INSERT INTO delivery_tarifas
    (nombre,sucursal_id,departamento,provincia,distrito,tarifa_base,cargo_por_unidad,gratis_desde,activo)
    SELECT 'Tarifa general',NULL,'','','',
      COALESCE((SELECT valor FROM configuracion WHERE clave='delivery_costo' LIMIT 1),8.00),
      COALESCE((SELECT valor FROM configuracion WHERE clave='delivery_cargo_unidad' LIMIT 1),0.50),
      COALESCE((SELECT valor FROM configuracion WHERE clave='delivery_gratis_desde' LIMIT 1),150.00),1
    WHERE NOT EXISTS(SELECT 1 FROM delivery_tarifas)`);

  // Catálogo canónico V50: mantiene separados Apertura de caja y Cajas.
  if (await tableExists(db, 'pedido_entregas_sucursal')) {
    await db.query(`ALTER TABLE pedido_entregas_sucursal
      MODIFY estado ENUM('pendiente','preparando','listo','asignado','en_ruta','entregado','incidencia','cancelado')
      NOT NULL DEFAULT 'pendiente'`).catch(() => false);
  }
  if (await tableExists(db, 'opciones')) {
    const [[canonicalApertura]] = await db.query("SELECT id FROM opciones WHERE slug='apertura-caja' LIMIT 1");
    if (canonicalApertura) {
      await db.query("UPDATE opciones SET estado=1 WHERE slug='apertura_caja'");
    } else {
      await db.query("UPDATE opciones SET slug='apertura-caja',nombre='Apertura de caja',icono='ti-lock-open',ruta='/apertura-caja',estado=0 WHERE slug='apertura_caja'");
    }
    await db.query("UPDATE opciones SET nombre='Apertura de caja',icono='ti-lock-open',ruta='/apertura-caja',estado=0 WHERE slug='apertura-caja'");
    const modules = require('../helpers/ModuleCatalog').MODULES;
    for (const module of modules) {
      await db.query(`INSERT INTO opciones (nombre,slug,icono,ruta,orden,estado,activo)
        VALUES (?,?,?,?,?,0,0)
        ON DUPLICATE KEY UPDATE nombre=VALUES(nombre),icono=VALUES(icono),ruta=VALUES(ruta),orden=VALUES(orden),estado=0`,
        [module.nombre,module.slug,module.icono,module.ruta,module.orden]);
    }
    await db.query("UPDATE opciones SET estado=1 WHERE slug='recojo_tienda'");

    // V51 retira el módulo independiente Presentaciones. Se conservan las tablas
    // y referencias históricas para no afectar ventas antiguas.
    if (await tableExists(db, 'perfil_opciones')) {
      await db.query(`DELETE po FROM perfil_opciones po
        JOIN opciones o ON o.id=po.opcion_id WHERE o.slug='presentaciones'`).catch(() => {});
    }
    if (await tableExists(db, 'perfil_permisos')) {
      await db.query(`DELETE pp FROM perfil_permisos pp
        JOIN opciones o ON o.id=pp.opcion_id WHERE o.slug='presentaciones'`).catch(() => {});
    }
    await db.query("DELETE FROM opciones WHERE slug='presentaciones'").catch(() => {});

    if (await tableExists(db, 'perfil_opciones')) {
      await db.query(`INSERT IGNORE INTO perfil_opciones (perfil_id,opcion_id)
        SELECT po.perfil_id,c.id FROM perfil_opciones po
        JOIN opciones a ON a.id=po.opcion_id AND a.slug='apertura-caja'
        JOIN opciones c ON c.slug='cajas'`);
    }
  }

  if (await tableExists(db, 'perfiles') && await tableExists(db, 'perfil_opciones') && await tableExists(db, 'opciones')) {
    const { ensurePredefinedProfiles } = require('../helpers/ProfileDefaults');
    await ensurePredefinedProfiles(db);
  }

  // Nuevo módulo de rentabilidad. No se asigna por nombre de perfil:
  // el admin global recibe todas las opciones en la sesión y los otros perfiles
  // pueden configurarse desde Perfiles.
  if (await tableExists(db, 'opciones')) {
    await db.query(`INSERT INTO opciones (slug,nombre,icono,ruta,orden,estado,activo)
      VALUES ('rentabilidad','Rentabilidad','ti-chart-pie-2','/rentabilidad',85,0,0)
      ON DUPLICATE KEY UPDATE nombre=VALUES(nombre),icono=VALUES(icono),estado=0,activo=0`);
  }
  if (await tableExists(db, 'permisos_accion')) {
    for (const row of [
      ['rentabilidad.ver','rentabilidad','Ver rentabilidad','Consultar ganancias, costos y pérdidas'],
      ['rentabilidad.ver_costos','rentabilidad','Ver costos de rentabilidad','Consultar costos, márgenes y alertas']
    ]) {
      await db.query(`INSERT INTO permisos_accion (slug,modulo,nombre,descripcion)
        VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE modulo=VALUES(modulo),nombre=VALUES(nombre),descripcion=VALUES(descripcion)`, row);
    }
  }
  if (await tableExists(db, 'permisos_accion')) {
    if (await tableExists(db, 'perfil_permisos_accion')) {
      await db.query(`DELETE ppa FROM perfil_permisos_accion ppa
        JOIN permisos_accion pa ON pa.id=ppa.permiso_id
        WHERE pa.slug='presentaciones.gestionar' OR pa.modulo='presentaciones'`).catch(() => {});
    }
    await db.query("DELETE FROM permisos_accion WHERE slug='presentaciones.gestionar' OR modulo='presentaciones'").catch(() => {});
  }

  if (await tableExists(db, 'configuracion')) {
    for (const row of [
      ['delivery_costo','8.00','ecommerce'],
      ['delivery_gratis_desde','150.00','ecommerce'],
      ['delivery_cargo_unidad','0.50','ecommerce'],
      ['schema_version','53','sistema']
    ]) {
      await db.query(`INSERT INTO configuracion (clave,valor,grupo) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE grupo=VALUES(grupo)`,row);
    }
    await db.query("UPDATE configuracion SET valor='53',updated_at=CURRENT_TIMESTAMP WHERE clave='schema_version'");
  }

  for (const [table,index,columns] of [
    ['productos','idx_producto_venta_sucursal','`sucursal_id`,`estado`,`es_transferido`,`transferencia_venta_habilitada`,`stock_actual`'],
    ['productos','idx_producto_canal_sucursal','`sucursal_id`,`estado`,`es_transferido`,`transferencia_venta_panel`,`transferencia_venta_web`,`stock_actual`'],
    ['ventas','idx_ventas_reporte_canal','`sucursal_id`,`estado_venta`,`created_at`,`canal`'],
    ['pedidos_web','idx_pedidos_web_operacion','`estado_pago`,`estado_pedido`,`tipo_entrega`,`created_at`'],
    ['pedido_items','idx_pedido_items_sucursal','`pedido_id`,`sucursal_id`,`producto_id`'],
    ['pedido_entregas_sucursal','idx_entregas_delivery','`tipo_entrega`,`estado`,`sucursal_id`,`pedido_id`'],
    ['ruta_reparto_pedidos','idx_ruta_entrega_sucursal','`pedido_entrega_sucursal_id`,`estado`'],
    ['caja_sesiones','idx_caja_usuario_estado','`usuario_id`,`estado`,`sucursal_id`'],
    ['reservas_web','idx_reservas_stock','`producto_id`,`sucursal_id`,`estado`,`expires_at`']
  ]) await addIndex(db,table,index,columns).catch(()=>false);


  if (await tableExists(db, 'pagos_operaciones_unicas')) {
    await addIndex(db,'pagos_operaciones_unicas','idx_pago_operacion_pedido_web','`pedido_web_id`').catch(()=>false);
    if (!(await indexExists(db,'pagos_operaciones_unicas','uq_pago_operacion_referencia'))) {
      await db.query('ALTER TABLE `pagos_operaciones_unicas` ADD UNIQUE KEY `uq_pago_operacion_referencia` (`referencia`)').catch(() => {});
    }
  }

  await ensureFilesAndPaths(db, projectRoot);

  // Limpieza segura: horarios pasados sin reservas activas. No elimina historial
  // que haya sido utilizado por pedidos.
  if (await tableExists(db, 'recojo_fechas')) {
    await db.query(`DELETE rf FROM recojo_fechas rf
      LEFT JOIN pedido_recojo_reservas prr ON prr.horario_id=rf.id
      WHERE rf.fecha < CURDATE() AND prr.id IS NULL`).catch(() => {});
  }

  return changes;
}

module.exports = { ensureSchema, tableExists, columnExists };
