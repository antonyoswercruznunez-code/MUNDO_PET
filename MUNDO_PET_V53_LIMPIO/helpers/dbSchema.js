const cache = new WeakMap();

async function getTableColumns(db, table) {
  if (!db || !/^[a-zA-Z0-9_]+$/.test(String(table || ''))) {
    throw new Error('Tabla inválida para inspección de esquema');
  }

  let poolCache = cache.get(db);
  if (!poolCache) {
    poolCache = new Map();
    cache.set(db, poolCache);
  }

  if (!poolCache.has(table)) {
    poolCache.set(table, (async () => {
      const [rows] = await db.query(`SHOW COLUMNS FROM \`${table}\``);
      return new Set(rows.map(row => String(row.Field || row.field || '')));
    })().catch(error => {
      poolCache.delete(table);
      throw error;
    }));
  }

  return poolCache.get(table);
}

function hasAll(columns, ...names) {
  return names.every(name => columns.has(name));
}

module.exports = { getTableColumns, hasAll };
