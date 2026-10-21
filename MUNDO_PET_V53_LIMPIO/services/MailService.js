const nodemailer = require('nodemailer');
const { getDB } = require('../config/database');

function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|si)$/i.test(String(value).trim());
}

function normalizeMailPassword(host, rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  // Las contraseñas de aplicación de Google tienen 16 caracteres. Google las
  // muestra agrupadas; algunos usuarios las copian con espacios o guiones.
  // Solo se compacta cuando el servidor es Gmail y el resultado tiene el
  // formato esperado, para no alterar contraseñas de otros proveedores SMTP.
  if (/^(smtp\.)?gmail\.com$/i.test(String(host || '').trim())) {
    const compact = raw.replace(/[\s-]+/g, '');
    if (/^[a-z0-9]{16}$/i.test(compact)) return compact;
  }

  return raw;
}

function friendlyError(error) {
  const code = String(error?.code || '').toUpperCase();
  const responseCode = Number(error?.responseCode || 0);
  const message = String(error?.message || 'Error SMTP');

  if (code === 'EAUTH' || responseCode === 535 || /535-5\.7\.8|BadCredentials/i.test(message)) {
    return 'Gmail rechazó las credenciales. Genera una contraseña de aplicación nueva, pégala en MAIL_PASS y reinicia Node.';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout|socket/i.test(message)) {
    return 'No se pudo conectar con el servidor SMTP. Revisa internet, firewall, MAIL_HOST y MAIL_PORT.';
  }
  if (/self signed certificate|certificate/i.test(message)) {
    return 'La conexión SMTP fue rechazada por el certificado TLS.';
  }
  return 'No se pudo enviar el correo. Revisa la configuración SMTP.';
}

async function getConfig() {
  const db = getDB();
  const [rows] = await db.query(
    "SELECT clave, valor FROM configuracion WHERE grupo IN ('correo','empresa','sistema') AND clave<>'mail_pass'"
  );
  const dbCfg = Object.fromEntries(rows.map(r => [r.clave, r.valor]));

  const host = String(process.env.MAIL_HOST || dbCfg.mail_host || 'smtp.gmail.com').trim();
  const port = Number(process.env.MAIL_PORT || dbCfg.mail_port || 587);
  const secure = process.env.MAIL_SECURE !== undefined
    ? envBool(process.env.MAIL_SECURE, port === 465)
    : port === 465;
  const user = String(process.env.MAIL_USER || dbCfg.mail_user || '').trim();
  const pass = normalizeMailPassword(host, process.env.MAIL_PASS || '');
  const fromName = String(
    process.env.MAIL_FROM_NAME || dbCfg.mail_from_name || dbCfg.empresa_nombre || 'Sistema de Ventas'
  ).trim();

  return {
    ...dbCfg,
    mail_host: host,
    mail_port: port,
    mail_secure: secure,
    mail_user: user,
    mail_pass: pass,
    mail_from_name: fromName
  };
}

async function transporter() {
  const cfg = await getConfig();
  if (!cfg.mail_user || !cfg.mail_pass) {
    const error = new Error('Configura MAIL_USER y MAIL_PASS en el archivo .env');
    error.code = 'MAIL_NOT_CONFIGURED';
    throw error;
  }

  const host = cfg.mail_host;
  const port = Number(cfg.mail_port || 587);
  const secure = Boolean(cfg.mail_secure);

  const tx = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: {
      user: cfg.mail_user,
      pass: cfg.mail_pass
    },
    tls: {
      minVersion: 'TLSv1.2',
      servername: host
    },
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  });

  return { tx, cfg };
}

async function verify() {
  const { tx, cfg } = await transporter();
  await tx.verify();
  return {
    user: cfg.mail_user,
    host: cfg.mail_host,
    port: cfg.mail_port,
    secure: cfg.mail_secure
  };
}

async function send({ to, subject, html, text, attachments = [] }) {
  const { tx, cfg } = await transporter();
  const safeAttachments = attachments
    .map(a => ({
      filename: String(a.filename || 'archivo').replace(/[\r\n]/g, '').slice(0, 180),
      content: a.content,
      contentType: a.contentType
    }))
    .filter(a => a.content);

  return tx.sendMail({
    from: `"${String(cfg.mail_from_name || 'Sistema').replace(/[\r\n"]/g, '')}" <${cfg.mail_user}>`,
    to,
    subject: String(subject || '').replace(/[\r\n]/g, '').slice(0, 250),
    html,
    text,
    attachments: safeAttachments
  });
}

module.exports = {
  send,
  verify,
  getConfig,
  friendlyError,
  normalizeMailPassword
};
