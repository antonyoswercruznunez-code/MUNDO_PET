'use strict';

const { normalizeRole } = require('./RolePolicy');

const PROFILE_DEFAULTS = Object.freeze({
  administrador: {
    nombre: 'Administrador',
    descripcion: 'Administra la operación de su sucursal con límites internos del backend.',
    modulos: ['dashboard','usuarios','productos','inventario','ventas','clientes','verificacion-pagos','apertura-caja','cajas','reportes','cotizaciones','recojo','temporadas','comprobantes','logistica']
  },
  vendedor: {
    nombre: 'Vendedor',
    descripcion: 'Registra ventas, cotizaciones y clientes de su sucursal.',
    modulos: ['ventas','cotizaciones','clientes','productos','apertura-caja','cajas']
  },
  cajero: {
    nombre: 'Cajero',
    descripcion: 'Opera caja y registra ventas sin acceso administrativo.',
    modulos: ['ventas','clientes','productos','apertura-caja','cajas']
  },
  almacenero: {
    nombre: 'Almacenero',
    descripcion: 'Controla inventario, movimientos y preparación logística.',
    modulos: ['productos','inventario','logistica','recojo']
  },
  supervisor: {
    nombre: 'Supervisor',
    descripcion: 'Supervisa ventas, inventario, cajas, pedidos y reportes de su sucursal.',
    modulos: ['dashboard','ventas','cotizaciones','clientes','productos','inventario','cajas','verificacion-pagos','logistica','recojo','reportes','comprobantes']
  },
  repartidor: {
    nombre: 'Repartidor',
    descripcion: 'Consulta sus rutas y registra entregas o incidencias.',
    modulos: ['logistica','recojo']
  }
});

function keyForProfile(name) {
  const normalized = normalizeRole(name);
  return Object.keys(PROFILE_DEFAULTS).find(key => normalized === key || normalized.startsWith(`${key} `)) || null;
}

function definitionForProfile(name) {
  const key = keyForProfile(name);
  return key ? PROFILE_DEFAULTS[key] : null;
}

async function assignDefaultModules(db, perfilId, profileName, { replace = false } = {}) {
  const definition = definitionForProfile(profileName);
  if (!definition) return false;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (replace) await conn.query('DELETE FROM perfil_opciones WHERE perfil_id=?', [perfilId]);
    const [options] = await conn.query(`SELECT id,slug FROM opciones WHERE estado=0 AND slug IN (${definition.modulos.map(() => '?').join(',')})`, definition.modulos);
    if (options.length) {
      await conn.query('INSERT IGNORE INTO perfil_opciones (perfil_id,opcion_id) VALUES ?', [options.map(option => [perfilId, option.id])]);
    }
    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function ensurePredefinedProfiles(db) {
  for (const definition of Object.values(PROFILE_DEFAULTS)) {
    await db.query(`INSERT INTO perfiles (nombre,descripcion,estado)
      SELECT ?,?,0 WHERE NOT EXISTS (SELECT 1 FROM perfiles WHERE LOWER(TRIM(nombre))=LOWER(TRIM(?)) AND estado<>2)`,
      [definition.nombre, definition.descripcion, definition.nombre]);
    const [[profile]] = await db.query('SELECT id,nombre FROM perfiles WHERE LOWER(TRIM(nombre))=LOWER(TRIM(?)) AND estado<>2 ORDER BY id LIMIT 1', [definition.nombre]);
    if (profile) await assignDefaultModules(db, profile.id, profile.nombre, { replace:false });
  }
}

module.exports = { PROFILE_DEFAULTS, keyForProfile, definitionForProfile, assignDefaultModules, ensurePredefinedProfiles };
