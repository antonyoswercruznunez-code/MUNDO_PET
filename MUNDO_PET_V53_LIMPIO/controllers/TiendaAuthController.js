const { wrap } = require('../helpers/response');
const ClienteWebModel = require('../models/ClienteWebModel');
const bcrypt = require('bcrypt');
const Audit = require('../services/AuditService');
const crypto = require('crypto');
const MailService = require('../services/MailService');
const { getDB } = require('../config/database');

const CODE_MINUTES = 10, CODE_TRIES = 5;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const passwordValida = p => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const codeHash = (email, code) => crypto.createHash('sha256').update(`${email}:${code}`).digest('hex');

// Código de 6 dígitos al correo: confirma que la dirección existe y es de quien la escribe.
async function enviarCodigo(email, nombre, motivo) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const db = getDB();
  const [[cfg]] = await db.query("SELECT valor FROM configuracion WHERE clave IN ('tienda_nombre','empresa_nombre') AND valor<>'' ORDER BY FIELD(clave,'tienda_nombre','empresa_nombre') LIMIT 1");
  const tienda = cfg?.valor || 'Mundo Pet';
  const titulo = motivo === 'registro' ? 'Confirma tu correo' : 'Recupera tu contraseña';
  const texto = motivo === 'registro' ? 'Usa este código para terminar de crear tu cuenta.' : 'Usa este código para crear una nueva contraseña.';
  await MailService.send({
    to: email,
    subject: `${code} es tu código de ${tienda}`,
    text: `${titulo}. Tu código es ${code}. Vence en ${CODE_MINUTES} minutos. Si no lo pediste, ignora este correo.`,
    html: `<div style="background:#f3f5f7;padding:28px 12px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:460px;margin:0 auto;background:#fff;border-radius:14px;padding:30px 28px;text-align:center">
      <div style="font-size:13px;color:#15803d;font-weight:700;letter-spacing:.06em;text-transform:uppercase">${tienda.replace(/[<>&]/g, '')}</div>
      <h1 style="margin:10px 0 6px;font-size:21px;color:#101828">${titulo}</h1>
      <p style="margin:0 0 20px;color:#475467;font-size:14px">Hola ${String(nombre || '').replace(/[<>&]/g, '')}. ${texto}</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#101828;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 0">${code}</div>
      <p style="margin:18px 0 0;color:#98a2b3;font-size:12px">Vence en ${CODE_MINUTES} minutos. Si no lo pediste, ignora este correo.</p></div></div>`
  });
  return { hash: codeHash(email, code), expires: Date.now() + CODE_MINUTES * 60000, tries: 0 };
}

function revisarCodigo(pending, email, code) {
  if (!pending || pending.email !== email) return 'Pide un código nuevo';
  if (Date.now() > pending.expires) return 'El código venció. Pide uno nuevo';
  if (pending.tries >= CODE_TRIES) return 'Demasiados intentos. Pide un código nuevo';
  pending.tries += 1;
  const ok = crypto.timingSafeEqual(Buffer.from(pending.hash), Buffer.from(codeHash(email, String(code || '').replace(/\D/g, ''))));
  return ok ? null : `Código incorrecto. Te quedan ${CODE_TRIES - pending.tries} intento(s)`;
}

async function verifyGoogleToken(idToken) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const token = String(idToken || '').trim();
  if (!clientId) throw new Error('Google Login no está configurado');
  if (!token || token.length > 10000) throw new Error('Token de Google inválido');

  const r = await fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { signal: AbortSignal.timeout(12000) }
  );

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data.error_description || data.error || 'Token de Google inválido');
  }

  const allowedIssuers = new Set(['accounts.google.com', 'https://accounts.google.com']);
  if (!allowedIssuers.has(data.iss)) throw new Error('Emisor de Google inválido');
  if (String(data.aud || '') !== clientId) throw new Error('El token no corresponde a esta aplicación');
  if (!(data.email_verified === 'true' || data.email_verified === true)) throw new Error('Google no confirmó el correo');
  if (Number(data.exp || 0) * 1000 <= Date.now()) throw new Error('Token de Google vencido');
  if (!data.sub || !data.email) throw new Error('Google no devolvió los datos de la cuenta');

  return {
    google_id: String(data.sub),
    email: String(data.email).trim().toLowerCase(),
    nombre: String(data.name || data.email.split('@')[0]).trim().slice(0, 150),
    avatar: data.picture ? String(data.picture).slice(0, 1000) : null,
    verificado: true
  };
}

async function regenerate(req) {
  const employee = {
    usuario: req.session?.usuario || null,
    opciones: req.session?.opciones || null,
    permisos: req.session?.permisos || null,
    login_at: req.session?.login_at || null,
    last_user_activity_at: req.session?.last_user_activity_at || null,
    locked: req.session?.locked || false,
    locked_at: req.session?.locked_at || null,
    user_checked_at: req.session?.user_checked_at || null,
    csrfToken: req.session?.csrfToken || null
  };
  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  if (employee.usuario) {
    Object.assign(req.session, employee);
  }
}

function setSession(req, cw) {
  req.session.clienteWeb = { id: cw.id, nombre: cw.nombre, email: cw.email, avatar: cw.avatar || null, cliente_id: cw.cliente_id || null };
  req.session.web_login_at = Date.now();
}

const TiendaAuthController = {
  // Paso 1 del registro: valida los datos y envía el código al correo.
  registroCodigo: wrap(async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim().replace(/\s+/g, ' ').slice(0,150);
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0,150);
    const password = String(req.body?.password || '');
    const telefono = String(req.body?.telefono || '').replace(/\D/g,'').slice(-9);
    if (nombre.length < 3 || !/\s/.test(nombre)) return res.status(400).json({ ok:false, msg:'Escribe tu nombre y apellido' });
    if (!RE_EMAIL.test(email)) return res.status(400).json({ ok:false, msg:'Escribe un correo válido' });
    if (telefono && !/^9\d{8}$/.test(telefono)) return res.status(400).json({ ok:false, msg:'El celular debe tener 9 dígitos y empezar con 9' });
    if (!passwordValida(password)) return res.status(400).json({ ok:false, msg:'La contraseña debe tener 8 caracteres, una letra y un número' });
    if (await ClienteWebModel.buscarPorEmail(email)) return res.status(409).json({ok:false,msg:'Ya existe una cuenta con ese correo'});
    let code;
    try { code = await enviarCodigo(email, nombre, 'registro'); }
    catch (error) { return res.status(502).json({ ok:false, msg:'No pudimos enviar el código a ese correo. Revisa que esté bien escrito.' }); }
    req.session.registroWeb = { ...code, email, nombre, telefono, password: await bcrypt.hash(password,12) };
    res.json({ ok:true, msg:`Te enviamos un código a ${email}` });
  }),

  // Paso 2: con el código correcto se crea la cuenta con el correo confirmado.
  registro: wrap(async (req, res) => {
    const pending = req.session.registroWeb;
    const email = String(req.body?.email || pending?.email || '').trim().toLowerCase();
    const error = revisarCodigo(pending, email, req.body?.codigo);
    if (error) return res.status(400).json({ ok:false, msg:error });
    delete req.session.registroWeb;
    if (await ClienteWebModel.buscarPorEmail(email)) return res.status(409).json({ok:false,msg:'Ya existe una cuenta con ese correo'});
    const { nombre, telefono } = pending; const hash = pending.password;
    const id = await ClienteWebModel.crear({nombre,email,password:hash,telefono,proveedor:'local',email_verificado:1});
    const cw = await ClienteWebModel.buscarPorId(id);
    await regenerate(req); setSession(req,cw);
    await Audit.log(req,{accion:'cliente_web_registro',modulo:'ecommerce',entidad:'clientes_web',entidad_id:id});
    res.status(201).json({ok:true,msg:'Cuenta creada',cliente:req.session.clienteWeb});
  }),

  login: wrap(async (req,res) => {
    const email=String(req.body?.email||'').trim().toLowerCase().slice(0,150);
    const password=String(req.body?.password||'');
    const cw=await ClienteWebModel.buscarPorEmail(email);
    if(!cw||!cw.activo||!cw.password||!(await bcrypt.compare(password,cw.password))) return res.status(401).json({ok:false,msg:'Correo o contraseña incorrectos'});
    await regenerate(req); setSession(req,cw);
    await Audit.log(req,{accion:'cliente_web_login',modulo:'ecommerce',entidad:'clientes_web',entidad_id:cw.id});
    res.json({ok:true,msg:'Bienvenido',cliente:req.session.clienteWeb});
  }),

  google: wrap(async (req,res) => {
    if(!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ok:false,msg:'Google Login no está configurado'});
    const credential=String(req.body?.credential||'');
    if(!credential) return res.status(400).json({ok:false,msg:'Falta el token de Google'});
    let info; try{info=await verifyGoogleToken(credential);}catch(e){return res.status(401).json({ok:false,msg:e.message});}
    let cw=await ClienteWebModel.buscarPorGoogleId(info.google_id);
    if(!cw){const byEmail=await ClienteWebModel.buscarPorEmail(info.email);if(byEmail){await ClienteWebModel.vincularGoogle(byEmail.id,info.google_id,info.avatar);cw=await ClienteWebModel.buscarPorId(byEmail.id);}}
    if(!cw){const id=await ClienteWebModel.crear({nombre:info.nombre,email:info.email,password:null,google_id:info.google_id,avatar:info.avatar,proveedor:'google',email_verificado:1});cw=await ClienteWebModel.buscarPorId(id);}
    if(!cw.activo) return res.status(403).json({ok:false,msg:'La cuenta está inactiva'});
    await regenerate(req); setSession(req,cw);
    await Audit.log(req,{accion:'cliente_web_google_login',modulo:'ecommerce',entidad:'clientes_web',entidad_id:cw.id});
    res.json({ok:true,msg:`Bienvenido ${cw.nombre}`,cliente:req.session.clienteWeb});
  }),

  // Recuperar contraseña: código al correo de la cuenta y nueva clave.
  recuperarCodigo: wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0,150);
    if (!RE_EMAIL.test(email)) return res.status(400).json({ ok:false, msg:'Escribe un correo válido' });
    const cw = await ClienteWebModel.buscarPorEmail(email);
    // La respuesta es la misma exista o no la cuenta: no revela qué correos están registrados.
    if (cw && cw.activo) {
      try { req.session.recuperarWeb = { ...(await enviarCodigo(email, cw.nombre, 'recuperar')), email }; }
      catch (_) { return res.status(502).json({ ok:false, msg:'No pudimos enviar el código. Intenta en unos minutos.' }); }
    }
    res.json({ ok:true, msg:`Si ${email} tiene una cuenta, te llegará un código` });
  }),

  recuperar: wrap(async (req, res) => {
    const pending = req.session.recuperarWeb;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!passwordValida(password)) return res.status(400).json({ ok:false, msg:'La contraseña debe tener 8 caracteres, una letra y un número' });
    const error = revisarCodigo(pending, email, req.body?.codigo);
    if (error) return res.status(400).json({ ok:false, msg:error });
    delete req.session.recuperarWeb;
    const cw = await ClienteWebModel.buscarPorEmail(email);
    if (!cw || !cw.activo) return res.status(400).json({ ok:false, msg:'La cuenta no está disponible' });
    await getDB().query('UPDATE clientes_web SET password=?, email_verificado=1 WHERE id=?', [await bcrypt.hash(password, 12), cw.id]);
    await regenerate(req); setSession(req, await ClienteWebModel.buscarPorId(cw.id));
    await Audit.log(req,{accion:'cliente_web_recupera_clave',modulo:'ecommerce',entidad:'clientes_web',entidad_id:cw.id});
    res.json({ ok:true, msg:'Contraseña actualizada', cliente:req.session.clienteWeb });
  }),

  session: wrap(async (req,res)=>res.json(req.session.clienteWeb?{ok:true,cliente:req.session.clienteWeb}:{ok:false})),
  logout: wrap(async (req,res)=>{delete req.session.clienteWeb;delete req.session.documentoWeb;res.json({ok:true});})
};

module.exports = TiendaAuthController;
