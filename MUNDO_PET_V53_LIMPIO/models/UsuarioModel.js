const { getDB } = require('../config/database');
const bcrypt = require('bcrypt');

const UsuarioModel = {
  getAll: async (sid) => {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT u.id, u.nombre, u.username, u.email,
             u.perfil_id, u.sucursal_id, u.es_global,
             u.estado, u.created_at,
             CASE
               WHEN u.pin_cajero_hash IS NULL OR u.pin_cajero_hash = '' THEN 0
               ELSE 1
             END AS tiene_pin_cajero,
             p.nombre AS perfil_nombre,
             p.estado AS perfil_estado,
             s.nombre AS sucursal_nombre
      FROM usuarios u
      JOIN perfiles p ON p.id = u.perfil_id
      LEFT JOIN sucursales s ON s.id = u.sucursal_id
      WHERE u.estado != 2 ${sid ? 'AND u.sucursal_id = ?' : ''}
      ORDER BY u.created_at DESC
    `, sid ? [sid] : []);
    return rows;
  },

  getPerfilesActivos: async () => {
    const db = getDB();
    const [rows] = await db.query('SELECT id, nombre, estado FROM perfiles WHERE estado != 2');
    return rows;
  },

  getPerfilById: async (id) => {
    const db = getDB();
    const [[row]] = await db.query('SELECT id, nombre, estado FROM perfiles WHERE id = ?', [id]);
    return row || null;
  },

  getSucursalesActivas: async () => {
    const db = getDB();
    const [rows] = await db.query('SELECT id, nombre FROM sucursales WHERE estado = 0');
    return rows;
  },

  getByUsername: async (username) => {
    const db = getDB();
    const [[row]] = await db.query('SELECT id, estado FROM usuarios WHERE username = ?', [username]);
    return row || null;
  },

  getById: async (id) => {
    const db = getDB();
    const [[row]] = await db.query('SELECT id, perfil_id, sucursal_id, es_global, estado FROM usuarios WHERE id = ?', [id]);
    return row || null;
  },

  tienePinCajero: async (id) => {
    const db = getDB();
    const [[row]] = await db.query(`
      SELECT CASE WHEN pin_cajero_hash IS NULL OR pin_cajero_hash = '' THEN 0 ELSE 1 END AS tiene
      FROM usuarios
      WHERE id = ?
    `, [id]);
    return !!row?.tiene;
  },

  getByEmail: async (email, excluirId = null) => {
    const db = getDB();
    let sql = 'SELECT id FROM usuarios WHERE email = ? AND estado != 2';
    const params = [email];
    if (excluirId) {
      sql += ' AND id != ?';
      params.push(excluirId);
    }
    const [[row]] = await db.query(sql, params);
    return row || null;
  },

  getPerfilDeUsuario: async (id) => {
    const db = getDB();
    const [[row]] = await db.query(
      'SELECT p.nombre FROM usuarios u JOIN perfiles p ON p.id = u.perfil_id WHERE u.id = ?',
      [id]
    );
    return row || null;
  },

  getEstadoPerfil: async (perfilId) => {
    const db = getDB();
    const [[row]] = await db.query('SELECT estado FROM perfiles WHERE id = ?', [perfilId]);
    return row || null;
  },

  crear: async (data) => {
    const db = getDB();
    const passwordHash = await bcrypt.hash(data.password, 10);
    const pinHash = data.pin_cajero ? await bcrypt.hash(data.pin_cajero, 10) : null;
    const [r] = await db.query(`
      INSERT INTO usuarios
        (nombre, username, email, password_hash, pin_cajero_hash, perfil_id, sucursal_id, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `, [
      data.nombre, data.username, data.email || '', passwordHash, pinHash,
      data.perfil_id, data.sucursal_id
    ]);
    return r.insertId;
  },

  reactivar: async (id, data) => {
    const db = getDB();
    const passwordHash = await bcrypt.hash(data.password, 10);
    const pinHash = data.pin_cajero ? await bcrypt.hash(data.pin_cajero, 10) : null;
    await db.query(`
      UPDATE usuarios
         SET nombre = ?, email = ?, password_hash = ?, pin_cajero_hash = ?,
             perfil_id = ?, sucursal_id = ?, estado = 0
       WHERE id = ?
    `, [
      data.nombre, data.email || '', passwordHash, pinHash,
      data.perfil_id, data.sucursal_id, id
    ]);
  },

  actualizar: async (id, data) => {
    const db = getDB();
    await db.query(`
      UPDATE usuarios
         SET nombre = ?, username = ?, email = ?, perfil_id = ?, sucursal_id = ?, estado = ?,
             session_version = session_version + 1
       WHERE id = ?
    `, [
      data.nombre, data.username, data.email || '', data.perfil_id,
      data.sucursal_id, data.estado, id
    ]);
  },

  actualizarPassword: async (id, password) => {
    const db = getDB();
    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE usuarios SET password_hash = ?, password_changed_at=NOW(), session_version=session_version+1 WHERE id = ?', [hash, id]);
  },

  actualizarPinCajero: async (id, pin) => {
    const db = getDB();
    const hash = await bcrypt.hash(pin, 10);
    await db.query('UPDATE usuarios SET pin_cajero_hash = ?, session_version=session_version+1 WHERE id = ?', [hash, id]);
  },

  cambiarEstado: async (id, estado) => {
    const db = getDB();
    await db.query('UPDATE usuarios SET estado = ?, session_version=session_version+1 WHERE id = ?', [estado, id]);
  },

  eliminar: async (id) => {
    const db = getDB();
    await db.query('UPDATE usuarios SET estado = 2, session_version=session_version+1 WHERE id = ?', [id]);
  }
};

module.exports = UsuarioModel;
