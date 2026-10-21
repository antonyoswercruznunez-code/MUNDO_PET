const { getDB } = require('../config/database');

const SucursalModel = {

  // Sucursales activas (estado 0 = activo, igual que en productos)
  getActivas: async () => {
    const db = getDB();
    const [rows] = await db.query(
      'SELECT id, nombre, direccion, telefono FROM sucursales WHERE estado = 0 ORDER BY id ASC'
    );
    return rows;
  },

  updateDatos: async (id, data) => {
    const db = getDB();
    await db.query('UPDATE sucursales SET direccion=?, telefono=? WHERE id=? AND estado=0', [data.direccion, data.telefono, id]);
  },

  getById: async (id) => {
    const db = getDB();
    const [[row]] = await db.query(
      'SELECT id, nombre, direccion, telefono, estado FROM sucursales WHERE id = ?',
      [id]
    );
    return row || null;
  }

};

module.exports = SucursalModel;