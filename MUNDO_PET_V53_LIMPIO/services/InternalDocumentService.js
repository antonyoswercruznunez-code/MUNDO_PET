const fs = require('fs/promises');
const path = require('path');
const { getDB } = require('../config/database');
const VentaModel = require('../models/VentaModel');
const CotizacionModel = require('../models/CotizacionModel');
const { generarComprobantePDF, generarTicketPDF, rutaLogoFisica, DIR_OUT } = require('../helpers/pdfDoc');

async function obtenerLogoWeb() {
  try {
    const db = getDB();
    const [[row]] = await db.query("SELECT ruta FROM tienda_imagenes WHERE tipo='logo' AND estado=1 LIMIT 1");
    return row?.ruta || null;
  } catch (_) {
    return null;
  }
}

function mapEmpresa(cfg = {}) {
  return {
    nombre: cfg.empresa_nombre || cfg.nombre || 'MUNDO PET',
    ruc: cfg.empresa_ruc || cfg.ruc || '',
    direccion: cfg.empresa_direccion || cfg.direccion || '',
    telefono: cfg.empresa_telefono || cfg.telefono || ''
  };
}

function fechaDocumento(value) {
  return String(value || '').replace('T', ' ').slice(0, 16);
}

async function generarVenta(id, formato = 'a4') {
  const venta = await VentaModel.getById(id);
  if (!venta) throw Object.assign(new Error('Venta no encontrada'), { status: 404 });
  const [items, pagos, cfg, logoWeb] = await Promise.all([
    VentaModel.getItems(id),
    VentaModel.getPagos(id),
    VentaModel.getEmpresaConfig().catch(() => ({})),
    obtenerLogoWeb()
  ]);
  const numero = venta.numero || `NV-${id}`;
  const formatoSeguro = String(formato || 'a4').toLowerCase() === 'ticket' ? 'ticket' : 'a4';
  const archivo = `${numero.replace(/[^A-Za-z0-9_-]/g, '_')}${formatoSeguro === 'ticket' ? '_ticket' : ''}.pdf`;
  const generar = formatoSeguro === 'ticket' ? generarTicketPDF : generarComprobantePDF;
  await generar({
    titulo: venta.tipo_comprobante === 'nota' || venta.tipo_comprobante === 'nota_venta' ? 'NOTA DE VENTA' : String(venta.tipo_comprobante || 'COMPROBANTE').toUpperCase(),
    numero,
    subtitulo: venta.tipo_comprobante === 'nota' || venta.tipo_comprobante === 'nota_venta' ? 'Documento interno' : 'Representación impresa',
    fecha: fechaDocumento(venta.created_at),
    cliente: {
      nombre: venta.cliente_nombre,
      doc: venta.numero_doc ? `${String(venta.tipo_doc || '').toUpperCase()} ${venta.numero_doc}` : ''
    },
    vendedor: venta.vendedor_nombre || '',
    items: (items || []).map(it => ({
      nombre: `${it.producto_nombre}${it.presentacion_nombre ? ` (${it.presentacion_nombre})` : ''}`,
      cantidad: it.cantidad,
      precio_unit: it.precio_unit,
      subtotal: it.subtotal
    })),
    pagos: (pagos || []).map(p => ({ metodo: p.metodo || 'efectivo', monto: +p.monto })),
    subtotal: venta.subtotal,
    descuento: venta.descuento,
    delivery: venta.costo_delivery,
    total: venta.total,
    observacion: venta.observacion || '',
    empresa: mapEmpresa(cfg),
    logoFisico: rutaLogoFisica(logoWeb),
    nombreArchivo: archivo
  });
  const filePath = path.join(DIR_OUT, archivo);
  return { venta, items, pagos, archivo, filePath, content: await fs.readFile(filePath) };
}

async function generarCotizacion(id, formato = 'a4') {
  const cotizacion = await CotizacionModel.getById(id);
  if (!cotizacion) throw Object.assign(new Error('Cotización no encontrada'), { status: 404 });
  const [items, cfg, logoWeb] = await Promise.all([
    CotizacionModel.getItems(id),
    CotizacionModel.getEmpresaConfig().catch(() => ({})),
    obtenerLogoWeb()
  ]);
  const codigo = cotizacion.codigo || `COT-${String(id).padStart(5, '0')}`;
  const formatoSeguro = String(formato || 'a4').toLowerCase() === 'ticket' ? 'ticket' : 'a4';
  const archivo = `${codigo.replace(/[^A-Za-z0-9_-]/g, '_')}${formatoSeguro === 'ticket' ? '_ticket' : ''}.pdf`;
  const vence = cotizacion.vence_at ? String(cotizacion.vence_at).slice(0, 10).split('-').reverse().join('/') : '';
  const generar = formatoSeguro === 'ticket' ? generarTicketPDF : generarComprobantePDF;
  await generar({
    titulo: 'COTIZACIÓN',
    numero: codigo,
    subtitulo: 'Proforma',
    fecha: fechaDocumento(cotizacion.created_at),
    extraFecha: vence ? { label: 'Válida hasta', valor: vence } : null,
    cliente: {
      nombre: cotizacion.cliente_nombre,
      doc: cotizacion.numero_doc ? `${String(cotizacion.tipo_doc || '').toUpperCase()} ${cotizacion.numero_doc}` : ''
    },
    vendedor: cotizacion.vendedor_nombre || '',
    items: (items || []).map(it => ({
      nombre: `${it.producto_nombre}${it.presentacion_nombre ? ` (${it.presentacion_nombre})` : ''}`,
      cantidad: it.cantidad,
      precio_unit: it.precio_unit,
      subtotal: it.subtotal
    })),
    subtotal: cotizacion.subtotal,
    descuento: cotizacion.descuento,
    total: cotizacion.total,
    observacion: cotizacion.observacion || '',
    empresa: mapEmpresa(cfg),
    logoFisico: rutaLogoFisica(logoWeb),
    nombreArchivo: archivo,
    piePersonalizado: 'Cotización (proforma) · Sujeta a disponibilidad de stock'
  });
  const filePath = path.join(DIR_OUT, archivo);
  return { cotizacion, items, archivo, filePath, content: await fs.readFile(filePath) };
}

module.exports = { generarVenta, generarCotizacion, mapEmpresa };
