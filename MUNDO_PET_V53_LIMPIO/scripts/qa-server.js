/*
 * Instancia local de pruebas (QA).
 *
 * Usa una base clonada (gas_sistema_qa) y apunta el correo y las APIs externas
 * a direcciones muertas para que las pruebas no envíen correos reales ni
 * consuman SUNAT / miapi. No usar en producción.
 *
 *   node scripts/qa-server.js             (sin correo ni APIs externas)
 *   node scripts/qa-server.js --externo   (correo y SUNAT beta reales)
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

// Con --externo se conservan el correo y MiAPI/SUNAT reales del .env (cuenta en
// SUNAT beta) para probar facturación y envíos de punta a punta.
const externo = process.argv.includes('--externo');

// dotenv no sobrescribe variables ya definidas, por eso se fijan antes de app.js.
Object.assign(process.env, {
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: process.env.QA_PORT || '3001',
  APP_URL: `http://localhost:${process.env.QA_PORT || '3001'}`,
  PUBLIC_URL: `http://localhost:${process.env.QA_PORT || '3001'}`,
  DB_NAME: process.env.QA_DB_NAME || 'gas_sistema_qa',
  SESSION_COOKIE_NAME: 'mundo_pet_qa_sid',
  API_RATE_LIMIT: '5000'
}, externo ? {} : {
  MAIL_HOST: '127.0.0.1',
  MAIL_PORT: '9',
  MAIL_USER: 'qa@localhost.test',
  MAIL_PASS: 'sin-correo-en-qa',
  MIAPI_URL: 'http://127.0.0.1:9',
  MIAPI_TOKEN: 'qa-sin-token',
  SUNAT_CLAVE_SECRETA: 'qa-sin-clave'
});

require('../app').start().catch(error => {
  console.error('No se pudo iniciar la instancia QA:', error.message);
  process.exit(1);
});
