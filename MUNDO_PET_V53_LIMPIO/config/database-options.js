function databaseOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const user = process.env.DB_USER || (isProd ? '' : 'root');
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'sistema_ventas';
  if (isProd) {
    if (!user || !database) throw new Error('DB_USER y DB_NAME son obligatorios en producción');
    if (String(user).toLowerCase() === 'root') throw new Error('No uses el usuario root de MySQL en producción');
    if (!password) throw new Error('DB_PASSWORD es obligatorio en producción');
  }
  const sslEnabled = String(process.env.DB_SSL || '').toLowerCase() === 'true';
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: Math.max(2, Math.min(50, Number(process.env.DB_POOL_SIZE || 10))),
    queueLimit: 100,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: process.env.DB_TIMEZONE || '-05:00',
    charset: 'utf8mb4',
    multipleStatements: false,
    ssl: sslEnabled ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true') !== 'false' } : undefined
  };
}
module.exports = { databaseOptions };
