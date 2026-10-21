const { wrap }    = require('../helpers/response');
const ReporteModel = require('../models/ReporteModel');
const LogisticaModel = require('../models/LogisticaModel');
const { hasPermission, hasGlobalScope, userScope } = require('../middleware/permisos');

// Fuerza el alcance real de sucursal. Tener perfil Administrador no vuelve global al usuario.
async function sucursalScope(req) {
  const global = await hasGlobalScope(req, 'dashboard.ver_global');
  if (global) return req.query.sucursal_id ? Number(req.query.sucursal_id) : null;
  return userScope(req).sucursalId;
}

function hoyPeru(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function rango(req){
  const desde=String(req.query.desde||'').trim(),hasta=String(req.query.hasta||'').trim(),hoy=hoyPeru();
  for(const [label,value] of [['desde',desde],['hasta',hasta]]) if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value>hoy)) throw Object.assign(new Error(`La fecha ${label} no es válida o es futura`),{status:400});
  if(desde&&hasta&&desde>hasta) throw Object.assign(new Error('La fecha desde no puede ser posterior a la fecha hasta'),{status:400});
  return {desde:desde||hoy,hasta:hasta||hoy};
}

const ReporteController = {

  // ══════════ VENTAS ══════════
  ventas: wrap(async (req, res) => {
    const sid = await sucursalScope(req);
    const { desde, hasta } = rango(req);

    const [
      kpi, porDia, porVendedor, porMetodo, porCanal, porComprobante,
      porDiaCanal, metodoPorCanal, entregaPorCanal, detalleVentas,
      webKpi, webPorEstado, webPorMetodo, webPorEntrega, webDetalle
    ] = await Promise.all([
      ReporteModel.ventasKPI(sid, desde, hasta),
      ReporteModel.ventasPorDia(sid, desde, hasta),
      ReporteModel.ventasPorVendedor(sid, desde, hasta),
      ReporteModel.ventasPorMetodoPago(sid, desde, hasta),
      ReporteModel.ventasPorCanal(sid, desde, hasta),
      ReporteModel.ventasPorComprobante(sid, desde, hasta),
      ReporteModel.ventasPorDiaCanal(sid, desde, hasta),
      ReporteModel.ventasMetodoPorCanal(sid, desde, hasta),
      ReporteModel.ventasEntregaPorCanal(sid, desde, hasta),
      ReporteModel.ventasDetalleCanal(sid, desde, hasta),
      ReporteModel.pedidosWebResumen(sid, desde, hasta),
      ReporteModel.pedidosWebPorEstado(sid, desde, hasta),
      ReporteModel.pedidosWebPorMetodo(sid, desde, hasta),
      ReporteModel.pedidosWebPorEntrega(sid, desde, hasta),
      ReporteModel.pedidosWebDetalle(sid, desde, hasta)
    ]);

    // Ventas por sucursal solo para admin global
    const esGlobal = await hasGlobalScope(req, 'dashboard.ver_global');
    const porSucursal = esGlobal ? await ReporteModel.ventasPorSucursal(desde, hasta) : [];

    res.json({
      ok: true, kpi, porDia, porSucursal, porVendedor, porMetodo, porCanal, porComprobante,
      porDiaCanal, metodoPorCanal, entregaPorCanal, detalleVentas,
      web: {
        kpi:webKpi,
        porEstado:webPorEstado,
        porMetodo:webPorMetodo,
        porEntrega:webPorEntrega,
        detalle:webDetalle
      }
    });
  }),

  // ══════════ PRODUCTOS ══════════
  productos: wrap(async (req, res) => {
    const sid = await sucursalScope(req);
    const { desde, hasta } = rango(req);

    const puedeCostos = await hasPermission(req, 'reportes.ver_costos');
    const [masVendidos, bajoStock, margen, sinMovimiento] = await Promise.all([
      ReporteModel.productosMasVendidos(sid, desde, hasta, 20),
      ReporteModel.productosBajoStock(sid),
      puedeCostos ? ReporteModel.margenPorProducto(sid, desde, hasta, 30) : Promise.resolve([]),
      ReporteModel.productosSinMovimiento(sid, desde, hasta)
    ]);

    res.json({ ok: true, masVendidos, bajoStock, margen, sinMovimiento, puedeCostos });
  }),

  // ══════════ CLIENTES (CRM) ══════════
  clientes: wrap(async (req, res) => {
    const sid = await sucursalScope(req);
    const { desde, hasta } = rango(req);

    const [top, nuevos, inactivos, porTipo] = await Promise.all([
      ReporteModel.clientesTop(sid, desde, hasta, 20),
      ReporteModel.clientesNuevos(sid, desde, hasta),
      ReporteModel.clientesInactivos(sid, 60),
      ReporteModel.clientesPorTipo(sid, desde, hasta)
    ]);

    res.json({ ok: true, top, nuevos, inactivos, porTipo });
  }),

  // ══════════ FINANZAS ══════════
  finanzas: wrap(async (req, res) => {
    const sid = await sucursalScope(req);
    const { desde, hasta } = rango(req);

    const [arqueos, flujo, conciliacion, cxc] = await Promise.all([
      ReporteModel.cajaArqueos(sid, desde, hasta),
      ReporteModel.flujoCaja(sid, desde, hasta),
      ReporteModel.conciliacionDigital(sid, desde, hasta),
      ReporteModel.cuentasPorCobrar(sid)
    ]);

    res.json({ ok: true, arqueos, flujo, conciliacion, cxc });
  }),

  // ══════════ COTIZACIONES ══════════
  cotizaciones: wrap(async (req, res) => {
    const sid = await sucursalScope(req);
    const { desde, hasta } = rango(req);

    const [conversion, porEstado, porVendedor] = await Promise.all([
      ReporteModel.conversionCotizaciones(sid, desde, hasta),
      ReporteModel.cotizacionesPorEstado(sid, desde, hasta),
      ReporteModel.cotizacionesPorVendedor(sid, desde, hasta)
    ]);

    res.json({ ok: true, conversion, porEstado, porVendedor });
  }),

  // ══════════ LOGÍSTICA ══════════
  logistica: wrap(async (req, res) => {
    const sid = await sucursalScope(req);
    const { desde, hasta } = rango(req);
    const [resumen, rutas] = await Promise.all([
      LogisticaModel.resumen(sid, desde, hasta),
      LogisticaModel.reporte(sid, desde, hasta)
    ]);
    res.json({ ok: true, ...resumen, rutas });
  }),

  inventario: wrap(async (req,res)=>{
    const sid=await sucursalScope(req); const {desde,hasta}=rango(req);
    res.json({ok:true,...await ReporteModel.inventarioResumen(sid,desde,hasta)});
  }),

  comprobantes: wrap(async (req,res)=>{
    const sid=await sucursalScope(req); const {desde,hasta}=rango(req);
    res.json({ok:true,...await ReporteModel.comprobantesResumen(sid,desde,hasta)});
  })

};

module.exports = ReporteController;