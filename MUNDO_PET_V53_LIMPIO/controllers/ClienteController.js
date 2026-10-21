const { wrap }     = require('../helpers/response');
const ClienteModel = require('../models/ClienteModel');
const { userScope, hasPermission } = require('../middleware/permisos');

const MIAPI_TOKEN = process.env.MIAPI_TOKEN || '';
const MIAPI_URL = String(process.env.MIAPI_URL || 'https://miapi.cloud/v1').replace(/\/$/, '');
function clienteEnAlcance(req,c){
  const scope=userScope(req);
  if(scope.isGlobal)return true;
  return !!scope.sucursalId && (Number(c.sucursal_registro_id)===Number(scope.sucursalId) || Number(c.es_general)===1);
}


async function consultarAPI(tipo, numero) {
  const url = tipo === 'ruc'
    ? `${MIAPI_URL}/ruc/${numero}`
    : `${MIAPI_URL}/dni/${numero}`;

  const r = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${MIAPI_TOKEN}`,
      'Accept': 'application/json'
    }
  });

  if (!r.ok) throw new Error(`API ${r.status}`);
  const json = await r.json();
  const d = json.datos || json.data || json.result || json;
  if (!d || json.success === false || json.ok === false) throw new Error('No encontrado');
  const domicilio = d.domiciliado || d.domicilio || d.ubigeo || {};

  if (tipo === 'ruc') {
    return {
      tipo_doc:         'ruc',
      numero_doc:       d.ruc,
      nombre:           d.razon_social || d.nombre_o_razon_social || '',
      razon_social:     d.razon_social || d.nombre_o_razon_social || '',
      apellido_paterno: '',
      apellido_materno: '',
      direccion:        domicilio.direccion || d.direccion    || '',
      distrito:         domicilio.distrito || d.distrito     || '',
      provincia:        domicilio.provincia || d.provincia    || '',
      departamento:     domicilio.departamento || d.departamento || '',
      email: '', telefono: ''
    };
  } else {
    return {
      tipo_doc:         'dni',
      numero_doc:       d.dni,
      nombre:           d.nombres || '',
      razon_social:     '',
      apellido_paterno: d.ape_paterno || d.apellido_paterno || '',
      apellido_materno: d.ape_materno || d.apellido_materno || '',
      direccion:        domicilio.direccion || d.direccion    || '',
      distrito:         domicilio.distrito || d.distrito     || '',
      provincia:        domicilio.provincia || d.provincia    || '',
      departamento:     domicilio.departamento || d.departamento || '',
      email: '', telefono: ''
    };
  }
}

const ClienteController = {

  list: wrap(async (req, res) => {
    const u = req.session.usuario;
    const sid = u?.es_global ? null : u?.sucursal_id;
    const clientes = await ClienteModel.getAll(sid);
    res.json({ ok: true, clientes, puede_gestionar: await hasPermission(req, 'clientes.gestionar') });
  }),

  consultar: wrap(async (req, res) => {
    const { doc, tipo = 'dni' } = req.query;
    if (!doc) return res.json({ ok: false, msg: 'Documento requerido' });

    // ── Validación de dígitos ──
    const digitosEsperados = tipo === 'ruc' ? 11 : 8;
    if (String(doc).length !== digitosEsperados)
      return res.json({
        ok: false,
        msg: `El ${tipo.toUpperCase()} debe tener exactamente ${digitosEsperados} dígitos`
      });

    // ── Solo números ──
    if (!/^[0-9]+$/.test(doc))
      return res.json({ ok: false, msg: 'El documento solo puede contener números' });

    const existe = await ClienteModel.getByDoc(doc);

    if (existe && existe.activo !== 2)
      return res.json({ ok: true, cliente: existe, fuente: 'bd' });

    if (existe && existe.activo === 2)
      return res.json({ ok: true, cliente: existe, fuente: 'bd_eliminado' });

    try {
      const cliente = await consultarAPI(tipo, doc);
      res.json({ ok: true, cliente, fuente: 'api' });
    } catch(e) {
      res.json({ ok: false, msg: 'No se encontró información para ese documento' });
    }
  }),

  crear: wrap(async (req, res) => {
    const u = req.session.usuario;

    const {
      tipo_doc = 'dni', numero_doc, nombre,
      razon_social = '', apellido_paterno = '', apellido_materno = '',
      telefono = '', email = '', direccion = '',
      distrito = '', provincia = '', departamento = '',
      origen_api = 0, reactivar = false
    } = req.body;

    if (!numero_doc || !nombre)
      return res.json({ ok: false, msg: 'Documento y nombre son requeridos' });

    // ── Validación de dígitos ──
    const digitosEsperados = tipo_doc === 'ruc' ? 11 : 8;
    if (String(numero_doc).length !== digitosEsperados)
      return res.json({
        ok: false,
        msg: `El ${tipo_doc.toUpperCase()} debe tener exactamente ${digitosEsperados} dígitos`
      });

    // ── Validación de documento solo números ──
    if (!/^[0-9]+$/.test(String(numero_doc)))
      return res.json({ ok: false, msg: 'El documento solo puede contener números' });

    // ── Validación de teléfono (solo números) ──
    if (telefono && !/^[0-9]+$/.test(telefono))
      return res.json({ ok: false, msg: 'El teléfono solo puede contener números' });

    if (reactivar) {
      await ClienteModel.reactivar(numero_doc, telefono, email);
      return res.json({ ok: true, msg: 'Cliente reactivado' });
    }

    const existe = await ClienteModel.existeActivo(numero_doc);
    if (existe)
      return res.json({ ok: false, msg: 'Ya existe un cliente con ese documento' });

    const sucursal_id = u?.es_global
      ? (req.body.sucursal_id || 1)
      : (u?.sucursal_id || 1);

    const id = await ClienteModel.crear({
      tipo_doc, numero_doc, nombre, razon_social,
      apellido_paterno, apellido_materno,
      telefono, email, direccion,
      distrito, provincia, departamento,
      sucursal_id, usuario_id: u.id, origen_api
    });

    res.json({ ok: true, msg: 'Cliente creado', id });
  }),

  editar: wrap(async (req, res) => {
    const u = req.session.usuario;

    const id = +req.params.id;
    const { telefono = '', email = '', activo = 1 } = req.body;

    // ── Validación de teléfono (solo números) ──
    if (telefono && !/^[0-9]+$/.test(telefono))
      return res.json({ ok: false, msg: 'El teléfono solo puede contener números' });

    const c = await ClienteModel.getById(id);
    if (!c)           return res.json({ ok: false, msg: 'Cliente no encontrado' });
    if (!clienteEnAlcance(req,c)) return res.status(403).json({ok:false,msg:'Cliente fuera de tu alcance'});
    if (c.es_general) return res.json({ ok: false, msg: 'El cliente general no puede modificarse' });

    await ClienteModel.editar(id, telefono, email, activo);
    res.json({ ok: true, msg: 'Cliente actualizado' });
  }),

  eliminar: wrap(async (req, res) => {
    const u = req.session.usuario;

    const id = +req.params.id;

    const c = await ClienteModel.getById(id);
    if (!c)           return res.json({ ok: false, msg: 'Cliente no encontrado' });
    if (!clienteEnAlcance(req,c)) return res.status(403).json({ok:false,msg:'Cliente fuera de tu alcance'});
    if (c.es_general) return res.json({ ok: false, msg: 'El cliente general no puede eliminarse' });

    await ClienteModel.eliminar(id);
    res.json({ ok: true, msg: 'Cliente eliminado' });
  })
};

module.exports = ClienteController;