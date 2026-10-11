const path = require('path');
const fs = require('fs/promises');
const { wrap } = require('../helpers/response');
const Logistica = require('../models/LogisticaModel');
const { hasGlobalScope, userScope } = require('../middleware/permisos');

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function accessScope(req, requestedSucursal = null) {
  const global = await hasGlobalScope(req, 'logistica.ver_global');
  if (global) {
    return {
      global: true,
      sucursalId: Number(requestedSucursal ?? req.query.sucursal_id) || null
    };
  }

  const sucursalId = Number(userScope(req).sucursalId) || null;
  if (!sucursalId) throw httpError('Tu usuario no tiene una sucursal asignada', 403);
  return { global: false, sucursalId };
}

function ensureRouteScope(route, scope) {
  if (!route) throw httpError('Ruta no encontrada', 404);
  if (!scope.global && Number(route.sucursal_id) !== Number(scope.sucursalId)) {
    throw httpError('No tienes acceso a esta ruta', 403);
  }
}

function hoyPeru(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function validarFiltros(desde,hasta){const hoy=hoyPeru();if((desde&&desde>hoy)||(hasta&&hasta>hoy))throw httpError('Los filtros no permiten fechas futuras',400);if(desde&&hasta&&desde>hasta)throw httpError('La fecha Desde no puede ser posterior a Hasta',400);}

function status(error) {
  const value = Number(error?.status);
  return value >= 400 && value <= 599 ? value : 400;
}

// Los errores de negocio traen su propio texto; los de base de datos se
// traducen para no mostrar SQL al usuario.
function mensaje(error) {
  if (error?.code === 'ER_DUP_ENTRY') return 'Ya existe un registro con esos datos (placa, documento o código repetido).';
  if (error?.code || error?.sqlMessage) {
    console.error('[LOGISTICA]', error.message);
    return 'No se pudo completar la operación. Intenta nuevamente.';
  }
  return error.message;
}

const Controller = {
  resumen: wrap(async (req, res) => {
    validarFiltros(req.query.desde,req.query.hasta);
    const scope = await accessScope(req);
    res.json({ ok: true, ...await Logistica.resumen(scope.sucursalId, req.query.desde || null, req.query.hasta || null) });
  }),

  repartidores: wrap(async (req, res) => {
    const scope = await accessScope(req);
    res.json({ ok: true, data: await Logistica.listarRepartidores(scope.sucursalId) });
  }),

  guardarRepartidor: wrap(async (req, res) => {
    try {
      const scope = await accessScope(req, req.body.sucursal_id);
      const body = { ...req.body, sucursal_id: scope.sucursalId || req.body.sucursal_id || null };
      if(body.licencia_vencimiento && body.licencia_vencimiento<hoyPeru()) throw httpError('La licencia no puede registrarse vencida',400);
      const id = await Logistica.guardarRepartidor(body, req.params.id);
      res.json({ ok: true, id, msg: 'Repartidor guardado' });
    } catch (error) {
      res.status(status(error)).json({ ok: false, msg: mensaje(error) });
    }
  }),

  vehiculos: wrap(async (req, res) => {
    const scope = await accessScope(req);
    res.json({ ok: true, data: await Logistica.listarVehiculos(scope.sucursalId) });
  }),

  guardarVehiculo: wrap(async (req, res) => {
    try {
      const scope = await accessScope(req, req.body.sucursal_id);
      const body = { ...req.body, sucursal_id: scope.sucursalId || req.body.sucursal_id || null };
      if(body.soat_vencimiento && body.soat_vencimiento<hoyPeru()) throw httpError('El SOAT no puede registrarse vencido',400);
      if(body.revision_vencimiento && body.revision_vencimiento<hoyPeru()) throw httpError('La revisión técnica no puede registrarse vencida',400);
      const id = await Logistica.guardarVehiculo(body, req.params.id);
      res.json({ ok: true, id, msg: 'Camión guardado' });
    } catch (error) {
      res.status(status(error)).json({ ok: false, msg: mensaje(error) });
    }
  }),

  rutas: wrap(async (req, res) => {
    validarFiltros(req.query.desde,req.query.hasta);
    const scope = await accessScope(req);
    const data = await Logistica.listarRutas({
      sucursalId: scope.sucursalId,
      desde: req.query.desde || null,
      hasta: req.query.hasta || null,
      estado: req.query.estado || null
    });
    res.json({ ok: true, data });
  }),

  ruta: wrap(async (req, res) => {
    try {
      const scope = await accessScope(req);
      const data = await Logistica.obtenerRuta(req.params.id);
      ensureRouteScope(data, scope);
      res.json({ ok: true, data });
    } catch (error) {
      res.status(status(error)).json({ ok: false, msg: mensaje(error) });
    }
  }),

  crearRuta: wrap(async (req, res) => {
    try {
      const scope = await accessScope(req, req.body.sucursal_id);
      const body = { ...req.body, sucursal_id: scope.sucursalId || req.body.sucursal_id };
      const id = await Logistica.crearRuta(body, req.session.usuario.id);
      res.status(201).json({ ok: true, id, msg: 'Ruta creada' });
    } catch (error) {
      res.status(status(error)).json({ ok: false, msg: mensaje(error) });
    }
  }),

  candidatos: wrap(async (req, res) => {
    const scope = await accessScope(req);
    res.json({ ok: true, data: await Logistica.candidatos(scope.sucursalId, String(req.query.solo_listos || '') === '1') });
  }),

  asignar: wrap(async (req, res) => {
    try {
      const scope = await accessScope(req);
      const route = await Logistica.obtenerRuta(req.params.id);
      ensureRouteScope(route, scope);
      await Logistica.asignarPedidos(req.params.id, req.body.items);
      res.json({ ok: true, msg: 'Pedidos asignados' });
    } catch (error) {
      res.status(status(error)).json({ ok: false, msg: mensaje(error) });
    }
  }),

  estadoRuta: wrap(async (req, res) => {
    try {
      const scope = await accessScope(req);
      const route = await Logistica.obtenerRuta(req.params.id);
      ensureRouteScope(route, scope);
      await Logistica.cambiarEstadoRuta(req.params.id, req.body.estado, { ...req.body, usuario_id:req.session.usuario.id });
      res.json({ ok: true, msg: 'Ruta actualizada' });
    } catch (error) {
      res.status(status(error)).json({ ok: false, msg: mensaje(error) });
    }
  }),

  estadoEntrega: wrap(async (req, res) => {
    try {
      const scope = await accessScope(req);
      const route = await Logistica.obtenerRuta(req.params.id);
      ensureRouteScope(route, scope);
      await Logistica.cambiarEstadoEntrega(req.params.id, req.params.detalleId, req.body.estado, req.body, req.session.usuario.id);
      res.json({ ok: true, msg: 'Entrega actualizada' });
    } catch (error) {
      res.status(status(error)).json({ ok: false, msg: mensaje(error) });
    }
  }),

  subirEvidencia: wrap(async (req,res) => {
    try {
      const scope=await accessScope(req);
      const route=await Logistica.obtenerRuta(req.params.id);
      ensureRouteScope(route,scope);
      if(!req.file?.privatePath) throw httpError('Selecciona una fotografía válida',400);
      const id=await Logistica.guardarEvidencia({
        rutaId:req.params.id,detalleId:req.params.detalleId,tipo:req.body.tipo,
        privatePath:req.file.privatePath,sha256:req.file.sha256,userId:req.session.usuario.id
      });
      res.status(201).json({ok:true,id,msg:'Evidencia fotográfica registrada'});
    } catch(error) {
      if(req.file?.path) await fs.unlink(req.file.path).catch(()=>{});
      res.status(status(error)).json({ok:false,msg:error.message});
    }
  }),

  verEvidencia: wrap(async (req,res) => {
    try {
      const scope=await accessScope(req);
      const evidence=await Logistica.obtenerEvidencia(req.params.evidenciaId);
      if(!evidence) throw httpError('Evidencia no encontrada',404);
      if(!scope.global && Number(evidence.sucursal_id)!==Number(scope.sucursalId)) throw httpError('Sin acceso a esta evidencia',403);
      const projectRoot=path.resolve(__dirname,'..');
      const absolute=path.resolve(projectRoot,evidence.archivo_privado);
      const privateRoot=path.resolve(projectRoot,'storage/private/reparto');
      if(!absolute.startsWith(privateRoot+path.sep)) throw httpError('Ruta de evidencia inválida',400);
      res.setHeader('Cache-Control','private, no-store, max-age=0');
      res.setHeader('X-Content-Type-Options','nosniff');
      res.type('image/webp').sendFile(absolute);
    } catch(error) { res.status(status(error)).json({ok:false,msg:error.message}); }
  }),

  retirarEvidencia: wrap(async (req,res) => {
    try {
      const scope=await accessScope(req);
      const evidence=await Logistica.obtenerEvidencia(req.params.evidenciaId);
      if(!evidence) throw httpError('Evidencia no encontrada',404);
      if(!scope.global && Number(evidence.sucursal_id)!==Number(scope.sucursalId)) throw httpError('Sin acceso',403);
      await Logistica.retirarEvidencia(req.params.evidenciaId,req.body.motivo,req.session.usuario.id);
      res.json({ok:true,msg:'Evidencia retirada del expediente; se conserva la auditoría'});
    } catch(error) { res.status(status(error)).json({ok:false,msg:error.message}); }
  }),

  reporte: wrap(async (req, res) => {
    validarFiltros(req.query.desde,req.query.hasta);
    const scope = await accessScope(req);
    res.json({ ok: true, data: await Logistica.reporte(scope.sucursalId, req.query.desde || null, req.query.hasta || null) });
  })
};

module.exports = Controller;
