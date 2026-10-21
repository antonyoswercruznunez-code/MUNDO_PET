'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const errors = [];
const warnings = [];
const isProd = process.env.NODE_ENV === 'production';

function required(name, min = 1) {
  const value = String(process.env[name] || '');
  if (value.length < min) errors.push(`${name} es obligatorio${min > 1 ? ` y debe tener al menos ${min} caracteres` : ''}.`);
  return value;
}

function validHttps(name) {
  const value = required(name);
  if (!value) return;
  try {
    const url = new URL(value);
    if (isProd && url.protocol !== 'https:') errors.push(`${name} debe usar https:// en producción.`);
  } catch (_) {
    errors.push(`${name} no es una URL válida.`);
  }
}

if (!isProd) warnings.push('NODE_ENV no está configurado como production.');
validHttps('APP_URL');
validHttps('PUBLIC_URL');
const sessionSecret = required('SESSION_SECRET', 32);
const encryptionKey = required('APP_ENCRYPTION_KEY', 32);
if (sessionSecret && sessionSecret === encryptionKey) errors.push('SESSION_SECRET y APP_ENCRYPTION_KEY deben ser diferentes.');
required('DB_HOST');
required('DB_NAME');
const dbUser = required('DB_USER');
const dbPassword = String(process.env.DB_PASSWORD || '');
if (isProd) {
  if (!dbPassword) errors.push('DB_PASSWORD es obligatorio en producción.');
  if (dbUser.toLowerCase() === 'root') errors.push('DB_USER no debe ser root en producción.');
} else {
  if (!dbPassword) warnings.push('DB_PASSWORD está vacío; solo es aceptable en un MySQL local de desarrollo.');
  if (dbUser.toLowerCase() === 'root') warnings.push('DB_USER=root; úsalo solo en desarrollo local.');
}
if (String(process.env.AUTO_CREATE_SCHEMA || 'false').toLowerCase() !== 'false') {
  errors.push('AUTO_CREATE_SCHEMA debe ser false en producción.');
}

for (const name of ['GOOGLE_CLIENT_ID', 'MAIL_USER', 'MAIL_PASS', 'MIAPI_TOKEN']) {
  if (!process.env[name]) warnings.push(`${name} está vacío; la integración correspondiente no funcionará.`);
}

const writableDirs = [
  'storage/private',
  'storage/documents',
  'public/uploads/productos',
  'public/uploads/logos',
  'public/uploads/sliders',
  'public/uploads/qr',
  'public/uploads/pagos'
];
for (const relative of writableDirs) {
  const absolute = path.join(__dirname, '..', relative);
  try {
    fs.mkdirSync(absolute, { recursive: true });
    fs.accessSync(absolute, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    errors.push(`Sin acceso de lectura/escritura en ${relative}: ${error.message}`);
  }
}

if (errors.length) {
  console.error('\nPRECHECK FALLIDO');
  for (const error of errors) console.error(`- ${error}`);
  if (warnings.length) {
    console.error('\nAdvertencias:');
    for (const warning of warnings) console.error(`- ${warning}`);
  }
  process.exit(1);
}

console.log('PRECHECK CORRECTO');
console.log('- Variables críticas y directorios: correctos.');
if (warnings.length) {
  console.log('\nAdvertencias:');
  for (const warning of warnings) console.log(`- ${warning}`);
}
