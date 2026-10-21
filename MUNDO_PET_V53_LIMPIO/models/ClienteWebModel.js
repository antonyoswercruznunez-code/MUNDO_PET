const { getDB } = require('../config/database');

const ClienteWebModel = {

  buscarPorEmail: async (email) => {
    const db = getDB();
    const [[row]] = await db.query('SELECT * FROM clientes_web WHERE email = ? LIMIT 1', [email]);
    return row || null;
  },

  buscarPorGoogleId: async (googleId) => {
    const db = getDB();
    const [[row]] = await db.query('SELECT * FROM clientes_web WHERE google_id = ? LIMIT 1', [googleId]);
    return row || null;
  },

  buscarPorId: async (id) => {
    const db = getDB();
    const [[row]] = await db.query(
      'SELECT id, nombre, email, avatar, telefono, proveedor, email_verificado, cliente_id FROM clientes_web WHERE id = ? LIMIT 1',
      [id]
    );
    return row || null;
  },

  crear: async (data) => {
    const db = getDB();
    const [r] = await db.query(`
      INSERT INTO clientes_web (nombre, email, password, google_id, avatar, telefono, email_verificado, proveedor)
      VALUES (?,?,?,?,?,?,?,?)
    `, [
      data.nombre, data.email, data.password || null, data.google_id || null,
      data.avatar || null, data.telefono || null,
      data.email_verificado ? 1 : 0, data.proveedor || 'local'
    ]);
    return r.insertId;
  },

  // Vincula un google_id a una cuenta existente (por email) o actualiza avatar
  vincularGoogle: async (id, googleId, avatar) => {
    const db = getDB();
    await db.query(
      'UPDATE clientes_web SET google_id = ?, avatar = COALESCE(?, avatar), email_verificado = 1 WHERE id = ?',
      [googleId, avatar, id]
    );
  },

  actualizarPerfil: async (id, data) => {
    const db = getDB();
    await db.query(
      'UPDATE clientes_web SET nombre = ?, telefono = ? WHERE id = ?',
      [data.nombre, data.telefono || null, id]
    );
  },

  // ── Direcciones ──
  listarDirecciones: async (clienteWebId) => {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT * FROM direcciones_web WHERE cliente_web_id = ? ORDER BY es_principal DESC, id DESC',
      [clienteWebId]
    );
    return rows;
  },

  crearDireccion: async (clienteWebId, d) => {
    const db = getDB();
    if (d.es_principal) {
      await db.query('UPDATE direcciones_web SET es_principal = 0 WHERE cliente_web_id = ?', [clienteWebId]);
    }
    const [r] = await db.query(`
      INSERT INTO direcciones_web (cliente_web_id, alias, direccion, referencia, distrito, provincia, departamento, lat, lng, es_principal)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [clienteWebId, d.alias || null, d.direccion, d.referencia || null,
        d.distrito || null, d.provincia || null, d.departamento || null,
        d.lat || null, d.lng || null, d.es_principal ? 1 : 0]);
    return r.insertId;
  },

  eliminarDireccion: async (clienteWebId, id) => {
    const db = getDB();
    await db.query('DELETE FROM direcciones_web WHERE id = ? AND cliente_web_id = ?', [id, clienteWebId]);
  }

};

module.exports = ClienteWebModel;