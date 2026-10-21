const VentaModel = require('../models/VentaModel');
const CotizacionModel = require('../models/CotizacionModel');
const DocumentService = require('../services/DocumentService');
const InternalDocumentService = require('../services/InternalDocumentService');
const { userScope, hasGlobalScope } = require('../middleware/permisos');

async function canAccessBranchEntity(req, row) {
  if (await hasGlobalScope(req, 'dashboard.ver_global')) return true;
  const scope = userScope(req);
  if (!scope.sucursalId || !row) return false;
  if (Number(row.es_multisucursal) === 1) return false;
  return row.sucursal_id == null || Number(row.sucursal_id) === Number(scope.sucursalId);
}

function hoyPeru() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

const PdfController = {
  ventaPDF: async (req, res) => {
    try {
      const id = Number(req.params.id);
      const venta = await VentaModel.getById(id);
      if (!venta) return res.status(404).json({ ok: false, msg: 'Venta no encontrada' });
      if (!(await canAccessBranchEntity(req, venta))) return res.status(403).json({ ok: false, msg: 'Venta fuera de tu alcance' });
      if (venta.estado_venta === 'anulada') return res.status(409).json({ ok: false, msg: 'La venta anulada no tiene acciones disponibles' });

      const generated = await InternalDocumentService.generarVenta(id, req.query.formato);
      const url = await DocumentService.createPublicLink(req, {
        tipo: 'venta', entidadId: id, filename: generated.archivo
      });
      res.json({ ok: true, url });
    } catch (error) {
      req.requestId && console.error(`[${req.requestId}] PDF venta:`, error.message);
      res.status(error.status || 500).json({ ok: false, msg: error.status ? error.message : 'No se pudo generar el PDF' });
    }
  },

  cotizacionPDF: async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cotizacion = await CotizacionModel.getById(id);
      if (!cotizacion) return res.status(404).json({ ok: false, msg: 'Cotización no encontrada' });
      if (!(await canAccessBranchEntity(req, cotizacion))) return res.status(403).json({ ok: false, msg: 'Cotización fuera de tu alcance' });
      const vencida = cotizacion.estado === 'vigente' && cotizacion.vence_at && String(cotizacion.vence_at).slice(0, 10) < hoyPeru();
      if (vencida) return res.status(409).json({ ok: false, msg: 'La cotización vencida solo puede eliminarse' });
      if (cotizacion.estado === 'eliminada') return res.status(409).json({ ok: false, msg: 'La cotización fue eliminada' });

      const generated = await InternalDocumentService.generarCotizacion(id, req.query.formato);
      const url = await DocumentService.createPublicLink(req, {
        tipo: 'cotizacion', entidadId: id, filename: generated.archivo
      });
      res.json({ ok: true, url });
    } catch (error) {
      req.requestId && console.error(`[${req.requestId}] PDF cotización:`, error.message);
      res.status(error.status || 500).json({ ok: false, msg: error.status ? error.message : 'No se pudo generar el PDF' });
    }
  }
};

module.exports = PdfController;
