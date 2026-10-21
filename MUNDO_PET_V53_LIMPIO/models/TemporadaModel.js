const { getDB } = require('../config/database');

const TemporadaModel = {
  async list() {
    const db = getDB();
    const [rows] = await db.query(`
      SELECT t.*,
        COUNT(td.id) AS reglas,
        CASE WHEN t.estado=0 AND CURDATE() BETWEEN t.fecha_inicio AND t.fecha_fin THEN 1 ELSE 0 END AS vigente
      FROM temporadas t
      LEFT JOIN temporada_descuentos td ON td.temporada_id=t.id
      WHERE t.estado<>2
      GROUP BY t.id
      ORDER BY t.fecha_inicio DESC,t.id DESC
    `);

    for (const t of rows) {
      const [discounts] = await db.query(`
        SELECT td.id,td.temporada_id,td.producto_id,td.tipo_descuento,td.porcentaje,td.monto,p.nombre AS producto_nombre,p.precio_venta
        FROM temporada_descuentos td
        JOIN productos p ON p.id=td.producto_id
        WHERE td.temporada_id=?
        ORDER BY p.nombre,td.id
      `, [t.id]);
      t.descuentos = discounts;
    }
    return rows;
  },

  async getById(id) {
    const db = getDB();
    const [[row]] = await db.query(
      'SELECT id,nombre,DATE_FORMAT(fecha_inicio,\'%Y-%m-%d\') fecha_inicio,DATE_FORMAT(fecha_fin,\'%Y-%m-%d\') fecha_fin,estado FROM temporadas WHERE id=? AND estado<>2 LIMIT 1',
      [id]
    );
    return row || null;
  },

  async create(data) {
    const db = getDB();
    const [r] = await db.query(
      'INSERT INTO temporadas (nombre,fecha_inicio,fecha_fin,estado) VALUES (?,?,?,?)',
      [data.nombre,data.fecha_inicio,data.fecha_fin,data.estado]
    );
    return r.insertId;
  },

  async update(id,data) {
    const db = getDB();
    const [r] = await db.query(
      'UPDATE temporadas SET nombre=?,fecha_inicio=?,fecha_fin=?,estado=? WHERE id=? AND estado<>2',
      [data.nombre,data.fecha_inicio,data.fecha_fin,data.estado,id]
    );
    return r.affectedRows > 0;
  },

  async remove(id) {
    const db = getDB();
    const [r] = await db.query('UPDATE temporadas SET estado=2 WHERE id=? AND estado<>2',[id]);
    return r.affectedRows > 0;
  },

  async targetExists({ producto_id }) {
    const [[row]]=await getDB().query('SELECT id,nombre FROM productos WHERE id=? AND estado=0 LIMIT 1',[producto_id]);
    return row||null;
  },

  async createDiscount(data) {
    const db=getDB();
    const [[existing]]=await db.query('SELECT id FROM temporada_descuentos WHERE temporada_id=? AND producto_id=? LIMIT 1',[data.temporada_id,data.producto_id]);
    if(existing) return { duplicate:true, id:existing.id };
    const [r]=await db.query(`INSERT INTO temporada_descuentos
      (temporada_id,producto_id,tipo_descuento,porcentaje,monto)
      VALUES (?,?,?,?,?)`,[data.temporada_id,data.producto_id,data.tipo_descuento,data.porcentaje,data.monto]);
    return {id:r.insertId,created:true,duplicate:false};
  },

  async removeDiscount(id, temporadaId) {
    const db = getDB();
    const [r] = await db.query(
      'DELETE FROM temporada_descuentos WHERE id=? AND temporada_id=?',
      [id,temporadaId]
    );
    return r.affectedRows > 0;
  }
};

module.exports = TemporadaModel;
