const { getDB } = require('../config/database');
const { dedupeOptions } = require('../helpers/ModuleCatalog');

const PerfilModel = {

  getAll: async () => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT p.*,COUNT(CASE WHEN u.estado<>2 THEN 1 END) AS usuarios_count,
             GROUP_CONCAT(CASE WHEN u.estado<>2 THEN CONCAT(u.nombre,' (@',u.username,')') END ORDER BY u.nombre SEPARATOR '||') AS usuarios_nombres
      FROM perfiles p LEFT JOIN usuarios u ON u.perfil_id=p.id
      WHERE p.estado<>2 GROUP BY p.id ORDER BY p.id ASC
    `);
    return rows;
  },

  aplicarModulosPredeterminados: async (id, nombre, replace = false) => {
    const db = getDB();
    const { assignDefaultModules } = require('../helpers/ProfileDefaults');
    return assignDefaultModules(db, id, nombre, { replace });
  },

  getOpciones: async () => {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT * FROM opciones WHERE estado = 0 AND slug <> 'presentaciones' ORDER BY orden ASC"
    );
    return dedupeOptions(rows);
  },

  getAsignadas: async () => {
    const db = getDB();
    const [rows] = await db.query('SELECT * FROM perfil_opciones');
    return rows;
  },

  getPermisosAccion: async () => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT id, slug, modulo, nombre, descripcion
      FROM permisos_accion ORDER BY modulo, nombre
    `);
    return rows;
  },

  getPermisosAccionAsignados: async () => {
    const db = getDB();
    const [rows] = await db.query('SELECT perfil_id, permiso_id FROM perfil_permisos_accion');
    return rows;
  },

  getByNombre: async (nombre, excluirId = null) => {
    const db = getDB();
    let sql = 'SELECT id FROM perfiles WHERE nombre = ? AND estado != 2';
    const params = [nombre];
    if (excluirId) { sql += ' AND id != ?'; params.push(excluirId); }
    const [[row]] = await db.query(sql, params);
    return row || null;
  },

  getEliminadoByNombre: async (nombre) => {
    const db = getDB();
    const [[row]] = await db.query(
      'SELECT id FROM perfiles WHERE nombre = ? AND estado = 2', [nombre]
    );
    return row || null;
  },

  tieneUsuarios: async (id) => {
    const db = getDB();
    const [[row]] = await db.query(
      'SELECT id FROM usuarios WHERE perfil_id = ? AND estado != 2 LIMIT 1', [id]
    );
    return !!row;
  },

  crear: async (nombre, descripcion) => {
    const db = getDB();
    const [r] = await db.query(
      'INSERT INTO perfiles (nombre, descripcion, estado) VALUES (?,?,0)',
      [nombre, descripcion]
    );
    return r.insertId;
  },

  reactivar: async (id, descripcion) => {
    const db = getDB();
    await db.query(
      'UPDATE perfiles SET descripcion=?, estado=0 WHERE id=?',
      [descripcion, id]
    );
  },

  actualizar: async (id, nombre, descripcion, estado) => {
    const db = getDB();
    await db.query(
      'UPDATE perfiles SET nombre=?, descripcion=?, estado=? WHERE id=?',
      [nombre, descripcion, estado, id]
    );
  },

  desactivarUsuarios: async (perfilId) => {
    const db = getDB();
    await db.query(
      'UPDATE usuarios SET estado = 1 WHERE perfil_id = ? AND estado = 0 AND id != 1',
      [perfilId]
    );
  },

  cambiarEstado: async (id, estado) => {
    const db = getDB();
    await db.query(
      'UPDATE perfiles SET estado = ? WHERE id = ?', [estado, id]
    );
  },

  eliminar: async (id) => {
    const db = getDB();
    await db.query('UPDATE perfiles SET estado = 2 WHERE id = ?', [id]);
  },

  asignarOpciones: async (perfilId, opciones) => {
    const db   = getDB();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        'DELETE FROM perfil_opciones WHERE perfil_id = ?', [perfilId]
      );
      const valores = [...new Set(opciones.map(Number).filter(Number.isInteger))].map(oid => [perfilId, oid]);
      if (valores.length) {
        await conn.query('INSERT INTO perfil_opciones (perfil_id, opcion_id) VALUES ?', [valores]);
      }
      await conn.query('UPDATE usuarios SET session_version=session_version+1 WHERE perfil_id=?', [perfilId]);
      await conn.commit();
    } catch(e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  asignarPermisosAccion: async (perfilId, permisos) => {
    const db = getDB();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM perfil_permisos_accion WHERE perfil_id=?', [perfilId]);
      if (permisos.length) {
        const ids = [...new Set(permisos.map(Number).filter(Number.isInteger))];
        if (ids.length) {
          const [validos] = await conn.query(`SELECT id FROM permisos_accion WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
          if (validos.length !== ids.length) throw Object.assign(new Error('Uno o más permisos no son válidos'), { status: 400 });
          await conn.query('INSERT INTO perfil_permisos_accion (perfil_id, permiso_id) VALUES ?', [ids.map(id => [perfilId, id])]);
        }
      }
      await conn.query('UPDATE usuarios SET session_version=session_version+1 WHERE perfil_id=?', [perfilId]);
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
};

module.exports = PerfilModel;