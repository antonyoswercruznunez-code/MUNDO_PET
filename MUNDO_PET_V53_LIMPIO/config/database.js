require('dotenv').config();

const mysql = require('mysql2/promise');

const {
  databaseOptions
} = require('./database-options');
const { ensureSchema } = require('../services/SchemaCompatibilityService');

let pool = null;

/*
|--------------------------------------------------------------------------
| Obtener conexión pool
|--------------------------------------------------------------------------
*/

function getDB() {
  if (!pool) {
    throw new Error(
      'Base de datos no inicializada. ' +
      'Ejecuta initDB() antes de usar getDB().'
    );
  }

  return pool;
}

/*
|--------------------------------------------------------------------------
| Inicializar base de datos
|--------------------------------------------------------------------------
|
| Tu base gas_sistema ya fue creada, importada y migrada.
| Por eso este archivo no debe volver a crear ni alterar tablas al iniciar.
|
*/

async function initDB() {
  if (pool) {
    return pool;
  }

  const newPool = mysql.createPool(
    databaseOptions()
  );
  const dbTimezone = /^[-+]\d{2}:\d{2}$/.test(String(process.env.DB_TIMEZONE || '-05:00'))
    ? String(process.env.DB_TIMEZONE || '-05:00') : '-05:00';
  newPool.on('connection', (connection) => {
    connection.query(`SET time_zone = '${dbTimezone}'`, (error) => {
      if (error) console.warn('No se pudo establecer la zona horaria de MySQL:', error.message);
    });
  });

  try {
    const connection =
      await newPool.getConnection();

    try {
      await connection.ping();
      await connection.query('SET time_zone = ?', [dbTimezone]);
    } finally {
      connection.release();
    }

    pool = newPool;

    console.log(
      '✅ Base de datos conectada'
    );

    console.log(
      'ℹ️ Se comprobará de forma aditiva la compatibilidad del esquema.'
    );

    // Solo crea tablas o columnas faltantes; nunca elimina ni reemplaza datos.
    // Esto evita errores cuando la instalación local todavía conserva la BD V37.
    try {
      const changes = await ensureSchema(pool, require('path').join(__dirname, '..'));
      if (changes.length) console.log(`✅ Compatibilidad V53 aplicada: ${changes.join(', ')}`);
    } catch (schemaError) {
      // La app continúa para instalaciones cuyo usuario MySQL no tenga ALTER.
      // Los modelos también incluyen consultas compatibles con esquemas antiguos.
      console.warn('⚠️ No se pudo completar la migración aditiva:', schemaError.message);
    }

    return pool;
  } catch (error) {
    await newPool
      .end()
      .catch(() => {});

    pool = null;

    throw error;
  }
}

/*
|--------------------------------------------------------------------------
| Cerrar conexiones
|--------------------------------------------------------------------------
*/

async function closeDB() {
  if (!pool) {
    return;
  }

  const currentPool = pool;

  pool = null;

  await currentPool.end();
}

module.exports = {
  getDB,
  initDB,
  closeDB
};