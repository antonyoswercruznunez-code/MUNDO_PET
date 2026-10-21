const { wrap }    = require('../helpers/response');
const PerfilModel = require('../models/PerfilModel');

const ADMIN_PERFIL_ID = 1;

// Solo letras + espacios + tildes/ñ
const RE_NOMBRE = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/;

function soloAdmin(req, res) {
  const user = req.session.usuario;
  if (!user?.es_global) {
    res.status(403).json({ ok: false, msg: 'Esta configuración requiere alcance global' });
    return false;
  }
  return true;
}

// Valida el nombre del perfil: solo letras
function validarNombre(nombre) {
  if (!nombre || !nombre.trim())
    return 'El nombre es requerido';
  if (nombre.trim().length < 2)
    return 'El nombre debe tener al menos 2 caracteres';
  if (!RE_NOMBRE.test(nombre.trim()))
    return 'El nombre solo puede contener letras y espacios (sin números ni caracteres especiales)';
  return null;
}

const PerfilController = {

  list: wrap(async (req, res) => {
    const [perfiles, opciones, asignadas] = await Promise.all([
      PerfilModel.getAll(), PerfilModel.getOpciones(), PerfilModel.getAsignadas()
    ]);
    res.json({ ok: true, perfiles, opciones, asignadas });
  }),

  create: wrap(async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const { nombre, descripcion = '' } = req.body;

    const errNombre = validarNombre(nombre);
    if (errNombre) return res.json({ ok: false, msg: errNombre });

    const eliminado = await PerfilModel.getEliminadoByNombre(nombre.trim());
    if (eliminado) {
      await PerfilModel.reactivar(eliminado.id, descripcion);
      await PerfilModel.aplicarModulosPredeterminados(eliminado.id, nombre.trim(), false);
      return res.json({ ok: true, msg: 'Perfil reactivado', id: eliminado.id });
    }

    const existe = await PerfilModel.getByNombre(nombre.trim());
    if (existe)
      return res.json({ ok: false, msg: 'Ya existe un perfil con ese nombre' });

    const id = await PerfilModel.crear(nombre.trim(), descripcion);
    const predefinido = await PerfilModel.aplicarModulosPredeterminados(id, nombre.trim(), true);
    res.json({ ok: true, msg: predefinido ? 'Perfil creado con módulos predeterminados' : 'Perfil creado', id, predefinido });
  }),

  update: wrap(async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const id = +req.params.id;

    if (id === ADMIN_PERFIL_ID)
      return res.json({ ok: false, msg: 'El perfil Administrador no puede modificarse' });

    const { nombre, descripcion = '', estado } = req.body;

    const errNombre = validarNombre(nombre);
    if (errNombre) return res.json({ ok: false, msg: errNombre });

    const existe = await PerfilModel.getByNombre(nombre.trim(), id);
    if (existe)
      return res.json({ ok: false, msg: 'Ya existe un perfil con ese nombre' });

    const estadoFinal = parseInt(estado ?? 0);

    if (estadoFinal === 1)
      await PerfilModel.desactivarUsuarios(id);

    await PerfilModel.actualizar(id, nombre.trim(), descripcion, estadoFinal);

    res.json({
      ok: true,
      msg: estadoFinal === 1
        ? 'Perfil desactivado. Los usuarios con este perfil fueron desactivados.'
        : 'Perfil actualizado'
    });
  }),

  remove: wrap(async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const id = +req.params.id;

    if (id === ADMIN_PERFIL_ID)
      return res.json({ ok: false, msg: 'El perfil Administrador no puede eliminarse' });

    const tieneUsuarios = await PerfilModel.tieneUsuarios(id);
    if (tieneUsuarios)
      return res.json({
        ok: false,
        msg: 'No puedes eliminar un perfil con usuarios asignados. Desactívalo primero.'
      });

    await PerfilModel.eliminar(id);
    res.json({ ok: true, msg: 'Perfil eliminado' });
  }),

  toggleEstado: wrap(async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const id     = +req.params.id;
    const estado = +req.body.estado;

    if (id === ADMIN_PERFIL_ID)
      return res.json({ ok: false, msg: 'El perfil Administrador no puede modificarse' });

    if (estado === 1)
      await PerfilModel.desactivarUsuarios(id);

    await PerfilModel.cambiarEstado(id, estado);
    res.json({
      ok: true,
      msg: estado === 0 ? 'Perfil activado' : 'Perfil desactivado'
    });
  }),

  assignActionPermissions: wrap(async (req, res) => {
    return res.status(410).json({ ok:false, msg:'Los permisos sensibles son políticas internas del backend y no se editan desde la interfaz.' });
  }),

  assignOpciones: wrap(async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const id = +req.params.id;
    const { opciones = [] } = req.body;

    if (!Array.isArray(opciones))
      return res.status(400).json({ ok: false, msg: 'Lista de módulos inválida' });

    await PerfilModel.asignarOpciones(id, opciones);
    res.json({ ok: true, msg: 'Módulos asignados' });
  })
};

module.exports = PerfilController;