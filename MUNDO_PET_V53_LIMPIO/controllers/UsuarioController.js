const TwoFactor = require('../services/TwoFactorService');
const Audit = require('../services/AuditService');
const { wrap } = require('../helpers/response');
const UsuarioModel = require('../models/UsuarioModel');
const bcrypt = require('bcrypt');
const { getDB } = require('../config/database');

const ADMIN_PRINCIPAL_ID = 1;
const PERFIL_ADMINISTRADOR = 'Administrador';
const PERFIL_VENDEDOR = 'Vendedor';

const RE_NOMBRE = /^[A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s]+$/;
const RE_USERNAME = /^[A-Za-z0-9]+$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_PIN_CAJERO = /^\d{4,6}$/;

function sesion(req) { return req.session.usuario; }
function esPrincipal(req) { return !!sesion(req)?.es_global; }
function esVendedorPerfil(nombre) { return String(nombre || '').trim().toLowerCase() === 'vendedor'; }
function esAdministradorPerfil(nombre) { const p=String(nombre||'').trim().toLowerCase(); return p==='administrador'||p.startsWith('administrador '); }

function soloAdmin(req, res) {
  // La ruta ya exige usuarios.gestionar. Aquí solo evitamos una llamada sin sesión.
  if (!sesion(req)) {
    res.status(401).json({ ok: false, msg: 'Sesión requerida.' });
    return false;
  }
  return true;
}


async function verificarPasswordActual(req, password) {
  const id = Number(sesion(req)?.id || 0);
  if (!id || !password) return false;
  const db = getDB();
  const [[row]] = await db.query('SELECT password_hash FROM usuarios WHERE id=? AND estado=0 LIMIT 1',[id]);
  return !!row && bcrypt.compare(String(password), row.password_hash);
}

function validarNombre(nombre) {
  if (!nombre || !nombre.trim()) return 'El nombre es requerido.';
  if (nombre.trim().length < 3) return 'El nombre debe tener al menos 3 caracteres.';
  if (!RE_NOMBRE.test(nombre.trim())) return 'El nombre solo puede contener letras, números y espacios.';
  return null;
}

function validarUsername(username) {
  if (!username || !username.trim()) return 'El username es requerido.';
  if (username.trim().length < 3) return 'El username debe tener al menos 3 caracteres.';
  if (!RE_USERNAME.test(username.trim())) return 'El username solo puede contener letras y números.';
  return null;
}

function validarPassword(password) {
  const p=String(password||'');
  if (p.length < 8 || p.length > 72) return 'La contraseña debe tener entre 8 y 72 caracteres.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'La contraseña debe contener al menos una letra y un número.';
  return null;
}

function validarPinCajero(pin) {
  if (!RE_PIN_CAJERO.test(String(pin || ''))) {
    return 'El PIN de cajero debe tener entre 4 y 6 dígitos.';
  }
  return null;
}

async function perfilSeleccionado(perfilId) {
  return UsuarioModel.getPerfilById(+perfilId);
}


async function usuarioEnAlcance(req,id){
  const target=await UsuarioModel.getById(id);
  if(!target)return null;
  const u=sesion(req);
  if(u?.es_global)return target;
  if(Number(target.es_global)===1 || Number(target.sucursal_id)!==Number(u?.sucursal_id))return false;
  return target;
}
const UsuarioController = {
  list: wrap(async (req, res) => {
    const u = sesion(req);
    const sid = esPrincipal(req) ? null : (u?.sucursal_id || null);
    const [usuarios, perfiles, sucursales] = await Promise.all([
      UsuarioModel.getAll(sid),
      UsuarioModel.getPerfilesActivos(),
      UsuarioModel.getSucursalesActivas()
    ]);
    res.json({ ok: true, usuarios, perfiles, sucursales });
  }),

  create: wrap(async (req, res) => {
    if (!soloAdmin(req, res)) return;

    let { nombre, username, email, password, perfil_id, sucursal_id, pin_cajero } = req.body;
    nombre = String(nombre || '').trim();
    username = String(username || '').trim();
    email = String(email || '').trim();
    pin_cajero = String(pin_cajero || '').trim();

    const errNombre = validarNombre(nombre);
    if (errNombre) return res.json({ ok: false, msg: errNombre });
    const errUser = validarUsername(username);
    if (errUser) return res.json({ ok: false, msg: errUser });
    if (!perfil_id) return res.json({ ok: false, msg: 'El perfil es requerido.' });
    const errPass = validarPassword(password);
    if (errPass) return res.json({ ok: false, msg: errPass });
    if (email && !RE_EMAIL.test(email)) return res.json({ ok: false, msg: 'El email no tiene un formato válido.' });

    const perfil = await perfilSeleccionado(perfil_id);
    if (!perfil || perfil.estado !== 0) return res.json({ ok: false, msg: 'El perfil seleccionado no está activo.' });
    if (!esPrincipal(req) && perfil.nombre === PERFIL_ADMINISTRADOR) {
      return res.json({ ok: false, msg: 'No puedes crear administradores.' });
    }
    if (esVendedorPerfil(perfil.nombre)) {
      const errPin = validarPinCajero(pin_cajero);
      if (errPin) return res.json({ ok: false, msg: errPin });
    } else {
      pin_cajero = '';
    }

    const existeUser = await UsuarioModel.getByUsername(username);
    const u = sesion(req);
    const sucursalFinal = esPrincipal(req) ? (sucursal_id || null) : (u?.sucursal_id || null);

    if (existeUser) {
      if (existeUser.estado === 2) {
        await UsuarioModel.reactivar(existeUser.id, {
          nombre, email, password, perfil_id, sucursal_id: sucursalFinal, pin_cajero
        });
        return res.json({ ok: true, msg: 'Usuario reactivado.', reactivado: true });
      }
      return res.json({ ok: false, msg: 'El username ya está registrado.' });
    }

    if (email) {
      const existeEmail = await UsuarioModel.getByEmail(email);
      if (existeEmail) return res.json({ ok: false, msg: 'El email ya está registrado.' });
    }

    const id = await UsuarioModel.crear({
      nombre, username, email, password, perfil_id, sucursal_id: sucursalFinal, pin_cajero
    });
    res.json({ ok: true, msg: 'Usuario creado.', id });
  }),

  update: wrap(async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const id = +req.params.id;
    if (id === ADMIN_PRINCIPAL_ID && Number(sesion(req)?.id) !== ADMIN_PRINCIPAL_ID) {
      return res.status(403).json({ ok: false, msg: 'Solo el administrador principal puede editar su propia cuenta.' });
    }
    const target=await usuarioEnAlcance(req,id);
    if(target===null)return res.status(404).json({ok:false,msg:'Usuario no encontrado'});
    if(target===false)return res.status(403).json({ok:false,msg:'Usuario fuera de tu alcance'});

    const perfilUsuario = await UsuarioModel.getPerfilDeUsuario(id);
    const objetivoEsAdmin = esAdministradorPerfil(perfilUsuario?.nombre);
    if (objetivoEsAdmin || id === Number(sesion(req)?.id)) {
      if (!(await verificarPasswordActual(req, req.body.current_password)))
        return res.status(401).json({ok:false,msg:'Confirma tu contraseña para editar esta cuenta administrativa.'});
    }

    let {
      nombre, username, email, perfil_id, sucursal_id,
      cambiar_password, nueva_password, estado, pin_cajero
    } = req.body;
    nombre = String(nombre || '').trim();
    username = String(username || '').trim();
    email = String(email || '').trim();
    pin_cajero = String(pin_cajero || '').trim();

    const errNombre = validarNombre(nombre);
    if (errNombre) return res.json({ ok: false, msg: errNombre });
    const errUser = validarUsername(username);
    if (errUser) return res.json({ ok: false, msg: errUser });
    if (!perfil_id) return res.json({ ok: false, msg: 'El perfil es requerido.' });
    if (email && !RE_EMAIL.test(email)) return res.json({ ok: false, msg: 'El email no tiene un formato válido.' });

    const perfil = await perfilSeleccionado(perfil_id);
    if (!perfil || perfil.estado !== 0) return res.json({ ok: false, msg: 'El perfil seleccionado no está activo.' });
    if (id === ADMIN_PRINCIPAL_ID && Number(perfil_id) !== Number(target.perfil_id)) {
      return res.status(400).json({ ok:false, msg:'El administrador principal no puede cambiar su perfil.' });
    }
    if (!esPrincipal(req) && objetivoEsAdmin && Number(perfil_id)!==Number(target.perfil_id)) {
      return res.status(403).json({ ok:false, msg:'Entre administradores no se puede cambiar el perfil o rol.' });
    }
    if (!esPrincipal(req) && !objetivoEsAdmin && perfil.nombre === PERFIL_ADMINISTRADOR) {
      return res.status(403).json({ ok:false, msg:'Solo el administrador global puede asignar el perfil Administrador.' });
    }

    if (email) {
      const existeEmail = await UsuarioModel.getByEmail(email, id);
      if (existeEmail) return res.json({ ok: false, msg: 'El email ya está registrado.' });
    }
    const existeUser = await UsuarioModel.getByUsername(username);
    if (existeUser && existeUser.id !== id && existeUser.estado !== 2) {
      return res.json({ ok: false, msg: 'El username ya está registrado.' });
    }

    const estadoFinal = parseInt(estado ?? 0, 10);
    if (estadoFinal === 0) {
      const estadoPerfil = await UsuarioModel.getEstadoPerfil(+perfil_id);
      if (estadoPerfil && +estadoPerfil.estado !== 0) {
        return res.json({ ok: false, msg: 'No puedes activar un usuario con un perfil desactivado.' });
      }
    }

    if (cambiar_password && nueva_password) {
      const errPass = validarPassword(nueva_password);
      if (errPass) return res.json({ ok: false, msg: errPass });
    }

    // PIN único por vendedor. En una edición es opcional solo si ya tenía uno.
    if (esVendedorPerfil(perfil.nombre)) {
      const yaTienePin = await UsuarioModel.tienePinCajero(id);
      if (!yaTienePin && !pin_cajero) {
        return res.json({ ok: false, msg: 'Este vendedor necesita un PIN de cajero para abrir caja.' });
      }
      if (pin_cajero) {
        const errPin = validarPinCajero(pin_cajero);
        if (errPin) return res.json({ ok: false, msg: errPin });
      }
    } else {
      pin_cajero = '';
    }

    const u = sesion(req);
    const sucursalFinal = id===ADMIN_PRINCIPAL_ID ? null : (esPrincipal(req) ? (sucursal_id || null) : (u?.sucursal_id || null));
    await UsuarioModel.actualizar(id, {
      nombre, username, email,
      perfil_id: id===ADMIN_PRINCIPAL_ID ? target.perfil_id : perfil_id,
      sucursal_id: sucursalFinal,
      estado: id===ADMIN_PRINCIPAL_ID ? 0 : estadoFinal
    });

    if (cambiar_password && nueva_password) await UsuarioModel.actualizarPassword(id, nueva_password);
    if (pin_cajero) await UsuarioModel.actualizarPinCajero(id, pin_cajero);

    res.json({ ok: true, msg: 'Usuario actualizado.' });
  }),

  remove: wrap(async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const id = +req.params.id;
    if (id === ADMIN_PRINCIPAL_ID) return res.json({ ok: false, msg: 'El administrador principal no puede eliminarse.' });
    const target=await usuarioEnAlcance(req,id);
    if(target===null)return res.status(404).json({ok:false,msg:'Usuario no encontrado'});
    if(target===false)return res.status(403).json({ok:false,msg:'Usuario fuera de tu alcance'});

    const perfilUsuario = await UsuarioModel.getPerfilDeUsuario(id);
    if (perfilUsuario?.nombre === PERFIL_ADMINISTRADOR) {
      return res.status(409).json({ ok: false, msg: 'Los usuarios administradores no se pueden eliminar. Puedes ajustar sus permisos desde Perfiles.' });
    }
    await UsuarioModel.eliminar(id);
    res.json({ ok: true, msg: 'Usuario eliminado.' });
  }),

  // Reinicia el autenticador: en su próximo ingreso el usuario escanea un QR nuevo.
  resetDobleFactor: wrap(async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const id = +req.params.id;
    const target = await usuarioEnAlcance(req, id);
    if (target === null) return res.status(404).json({ ok:false, msg:'Usuario no encontrado' });
    if (target === false) return res.status(403).json({ ok:false, msg:'Usuario fuera de tu alcance' });
    if (!(await verificarPasswordActual(req, req.body?.admin_password))) {
      return res.status(401).json({ ok:false, msg:'Confirma tu contraseña para reiniciar el autenticador.' });
    }
    await TwoFactor.reset(id);
    await Audit.log(req, { accion:'mfa_reiniciado', modulo:'usuarios', entidad:'usuario', entidad_id:id }).catch(() => {});
    res.json({ ok:true, msg: id === Number(sesion(req)?.id)
      ? 'Autenticador reiniciado. Al volver a ingresar escanearás un QR nuevo.'
      : 'Autenticador reiniciado. En su próximo ingreso escaneará un QR nuevo.' });
  }),

  toggleEstado: wrap(async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const id = +req.params.id;
    const estado = +req.body.estado;
    if (id === ADMIN_PRINCIPAL_ID) {
      return res.json({ ok: false, msg: 'El administrador principal no puede modificarse.' });
    }
    const target=await usuarioEnAlcance(req,id);
    if(target===null)return res.status(404).json({ok:false,msg:'Usuario no encontrado'});
    if(target===false)return res.status(403).json({ok:false,msg:'Usuario fuera de tu alcance'});
    const perfilObjetivo = await UsuarioModel.getPerfilDeUsuario(id);
    if (esAdministradorPerfil(perfilObjetivo?.nombre)) {
      if (!(await verificarPasswordActual(req, req.body.admin_password))) return res.status(401).json({ok:false,msg:'Confirma tu contraseña para cambiar el estado de otro administrador.'});
    }

    if (estado === 0) {
      const usuario = await UsuarioModel.getById(id);
      const perfil = await UsuarioModel.getEstadoPerfil(usuario?.perfil_id);
      if (perfil && perfil.estado !== 0) {
        return res.json({ ok: false, msg: 'No puedes activar un usuario con un perfil desactivado. Activa el perfil primero.' });
      }
      const perfilUsuario = await UsuarioModel.getPerfilDeUsuario(id);
      if (esVendedorPerfil(perfilUsuario?.nombre) && !(await UsuarioModel.tienePinCajero(id))) {
        return res.json({ ok: false, msg: 'No puedes activar un vendedor sin PIN de cajero. Edita el usuario y crea su PIN.' });
      }
    }
    await UsuarioModel.cambiarEstado(id, estado);
    res.json({ ok: true, msg: estado === 0 ? 'Usuario activado.' : 'Usuario desactivado.' });
  })
};

module.exports = UsuarioController;
