/*
 * Emergencia: reinicia el autenticador de un usuario cuando perdió el celular
 * y no hay otro administrador que lo haga desde el panel.
 *
 *   node scripts/reset-2fa.js <usuario>
 *
 * En su próximo ingreso verá un QR nuevo. Usa la base del archivo .env.
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
const { initDB, getDB } = require('../config/database');
const TwoFactor = require('../services/TwoFactorService');

(async () => {
  const username = String(process.argv[2] || '').trim();
  if (!username) {
    console.log('Uso: node scripts/reset-2fa.js <usuario>');
    process.exit(1);
  }
  await initDB();
  const [[user]] = await getDB().query('SELECT id, nombre, username FROM usuarios WHERE LOWER(username)=LOWER(?) AND estado<>2 LIMIT 1', [username]);
  if (!user) {
    console.log(`No existe el usuario "${username}" en la base ${process.env.DB_NAME}.`);
    process.exit(1);
  }
  await TwoFactor.reset(user.id);
  console.log(`Autenticador reiniciado para ${user.nombre} (@${user.username}). En su próximo ingreso escaneará un QR nuevo.`);
  process.exit(0);
})().catch(error => {
  console.error('No se pudo reiniciar:', error.message);
  process.exit(1);
});
