const { wrap } = require('../helpers/response');
const ClienteWebModel = require('../models/ClienteWebModel');
const bcrypt = require('bcrypt');
const Audit = require('../services/AuditService');

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
  registro: wrap(async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim().slice(0,150);
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0,150);
    const password = String(req.body?.password || '');
    const telefono = String(req.body?.telefono || '').replace(/\D/g,'').slice(0,20);
    if (nombre.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ ok:false,msg:'Completa los datos. La contraseña debe tener 8 caracteres, una letra y un número.' });
    }
    if (await ClienteWebModel.buscarPorEmail(email)) return res.status(409).json({ok:false,msg:'Ya existe una cuenta con ese correo'});
    const hash = await bcrypt.hash(password,12);
    const id = await ClienteWebModel.crear({nombre,email,password:hash,telefono,proveedor:'local',email_verificado:0});
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

  session: wrap(async (req,res)=>res.json(req.session.clienteWeb?{ok:true,cliente:req.session.clienteWeb}:{ok:false})),
  logout: wrap(async (req,res)=>{delete req.session.clienteWeb;delete req.session.documentoWeb;res.json({ok:true});})
};

module.exports = TiendaAuthController;
