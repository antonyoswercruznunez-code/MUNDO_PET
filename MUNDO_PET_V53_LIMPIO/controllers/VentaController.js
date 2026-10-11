const { wrap }          = require('../helpers/response');
const VentaModel        = require('../models/VentaModel');
const CajaModel         = require('../models/CajaModel');
const ComprobanteModel  = require('../models/ComprobanteModel');
const SunatService      = require('../services/SunatService');
const { getDB }         = require('../config/database');
const MailService       = require('../services/MailService');
const { userScope, hasGlobalScope } = require('../middleware/permisos');
const AuditService       = require('../services/AuditService');
const InternalDocumentService = require('../services/InternalDocumentService');
const DocumentService = require('../services/DocumentService');
const { buildInvoice, buildCreditNote } = require('../helpers/comprobanteSunat');

// ════════════════════════════════════════════════════════════
//  HORA REAL DE PERÚ (UTC-5) — independiente de la zona del servidor
//  Usa Intl con timeZone America/Lima, así SIEMPRE da la hora correcta
//  aunque el servidor/MySQL estén en UTC.
// ════════════════════════════════════════════════════════════
function peruParts() {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date())) p[x.type] = x.value;
  const hh = (p.hour === '24') ? '00' : p.hour;
  return {
    date: `${p.year}-${p.month}-${p.day}`,   // 2026-06-06
    time: `${hh}:${p.minute}:${p.second}`    // 19:30:05
  };
}
function peruNowSQL() {
  const p = peruParts();
  return `${p.date} ${p.time}`;              // 2026-06-06 19:30:05
}
// Fecha legible a partir de '2026-06-06T19:30:00' (sin tocar zona horaria)
function fechaLegible(isoLocal) {
  if (!isoLocal) return '';
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio',
                 'agosto','septiembre','octubre','noviembre','diciembre'];
  const [d, t] = String(isoLocal).split('T');
  const [Y, M, D] = d.split('-');
  const hm = (t || '').slice(0, 5);
  return `${D} de ${meses[+M - 1]} de ${Y}${hm ? ` · ${hm}` : ''}`;
}

// ── Helper: descarga un archivo (PDF/XML) para adjuntarlo al correo ──
async function descargarAdjunto(url, filename) {
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const arrayBuffer = await resp.arrayBuffer();
    return { filename, content: Buffer.from(arrayBuffer) };
  } catch (e) {
    return null;
  }
}

// ════════════════════════════════════════════════════════════
//  INTÉRPRETE DE RESPUESTAS DE MiAPI / SUNAT
//  MiAPI puede mandar los campos con distintos nombres. Estos helpers
//  los detectan sin importar cómo se llamen, y traducen el código de
//  SUNAT a un estado claro: aceptado / observado / rechazado / pendiente.
// ════════════════════════════════════════════════════════════

// Busca el primer valor no vacío entre varios nombres de campo posibles
function pick(obj, ...keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

// Paso 1 (invoice/create): solo genera y firma. Saca las URLs de XML/PDF.
function interpretarCreate(raw) {
  const r = raw?.respuesta || raw || {};
  const ok = r.success === true || r.status === 200 ||
             !!pick(r, 'xml-firmado', 'xmlFirmado', 'xml_firmado');
  return {
    ok,
    xml_firmado:    pick(r, 'xml-firmado', 'xmlFirmado', 'xml_firmado'),
    xml_sin_firmar: pick(r, 'xml-sin-firmar', 'xmlSinFirmar', 'xml_sin_firmar'),
    pdf_a4:         pick(r, 'pdf-a4', 'pdfA4', 'pdf_a4'),
    pdf_ticket:     pick(r, 'pdf-ticket', 'pdfTicket', 'pdf_ticket'),
    hash:           pick(r, 'hash', 'hash_cpe', 'hashCpe'),
    mensaje:        pick(r, 'mensaje', 'message', 'description') || 'Comprobante generado',
    raw
  };
}

// Paso 2 (invoice/send): aquí SÍ responde SUNAT. Saca el CDR y el código.
// Códigos SUNAT:  0 = aceptado · 2000-3999 = RECHAZADO · >=4000 = observaciones (igual se acepta)
function interpretarSunat(raw) {
  const r = raw?.respuesta || raw || {};

  // CDR: puede venir con muchos nombres distintos
  const cdr = pick(r, 'cdr', 'cdr-zip', 'cdrZip', 'cdr_zip', 'cdr-xml',
                       'cdrXml', 'xml-cdr', 'cdr_path', 'cdrUrl', 'cdr_url');

  // Código de respuesta de SUNAT
  let codigoRaw = pick(r, 'code', 'codigo', 'cdr_codigo', 'responseCode',
                          'codeResponse', 'sunatCode');
  // a veces el código viene anidado dentro de un objeto cdr
  if (codigoRaw === null && r.cdr && typeof r.cdr === 'object')
    codigoRaw = pick(r.cdr, 'code', 'codigo', 'responseCode');

  const mensaje = pick(r, 'description', 'mensaje', 'message', 'cdr_mensaje',
                          'notes', 'observaciones') || '';

  // Observaciones (advertencias) → SUNAT acepta pero con notas
  let obs = pick(r, 'notes', 'notas', 'observaciones', 'observations');
  if (Array.isArray(obs)) obs = obs.join(' | ');

  const hash = pick(r, 'hash', 'hash_cpe', 'hashCpe');

  // Determinar el estado real
  let estado;
  const codNum = codigoRaw === null ? null : parseInt(String(codigoRaw), 10);

  if (codNum === 0) {
    estado = obs ? 'observado' : 'aceptado';
  } else if (codNum !== null && !isNaN(codNum) && codNum >= 2000 && codNum <= 3999) {
    estado = 'rechazado';                 // dato malo → corregir y reemitir
  } else if (codNum !== null && !isNaN(codNum) && codNum >= 4000) {
    estado = 'observado';                 // aceptado con advertencias
  } else if (cdr && (codNum === null || isNaN(codNum))) {
    estado = 'aceptado';                  // hay CDR pero sin código numérico → aceptado
  } else if (r.success === true && !cdr && (codNum === null || isNaN(codNum))) {
    estado = 'pendiente';                 // respondió OK pero sin CDR → aún no confirmado
  } else if (codNum !== null && !isNaN(codNum) && codNum >= 100 && codNum <= 1999) {
    estado = 'pendiente';                 // excepción de SUNAT → reintentar
  } else {
    estado = 'rechazado';
  }

  return {
    estado,
    cdr_path: cdr || null,
    codigo:   codigoRaw !== null ? String(codigoRaw) : null,
    mensaje:  obs ? `${mensaje}${mensaje && obs ? ' — ' : ''}${obs}`.trim() : mensaje,
    observaciones: obs || null,
    hash:     hash || null,
    raw
  };
}

// ════════════════════════════════════════════════════════════
//  PLANTILLA DE CORREO (tablas + estilos inline → se ve bien en Gmail)
// ════════════════════════════════════════════════════════════
function construirCorreoHTML({ venta, items, empresa, esNota, tipoLabel, comp, documentUrl = '' }) {
  const fecha       = fechaLegible(venta.created_at);
  const empNombre   = empresa.empresa_nombre || 'Distribuciones MAOZ';
  const empRuc      = empresa.empresa_ruc    || '';
  const empDir      = empresa.empresa_direccion || '';
  const empTel      = empresa.empresa_telefono  || '';
  const total       = parseFloat(venta.total).toFixed(2);
  // Si hay comprobante, usamos su base/IGV EXACTO (idéntico a lo que aceptó SUNAT);
  // si no (nota interna), se calcula. base + IGV = total, sin descuadre.
  const baseGravada = (comp && comp.subtotal != null ? +comp.subtotal : (+venta.total / 1.18)).toFixed(2);
  const igvCalc     = (comp && comp.igv != null ? +comp.igv : (+venta.total - +baseGravada)).toFixed(2);

  const VERDE = '#159447';

  const filaDato = (lbl, val) => val ? `
    <tr>
      <td style="padding:7px 0;color:#8a8a8a;font-size:13px;border-bottom:1px solid #f2f2f2">${lbl}</td>
      <td style="padding:7px 0;color:#333;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #f2f2f2">${val}</td>
    </tr>` : '';

  const filaItem = (i) => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333">
        ${i.producto_nombre}${i.presentacion_nombre ? `<br><span style="font-size:11px;color:#999">${i.presentacion_nombre}</span>` : ''}
      </td>
      <td align="center" style="padding:10px 8px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${i.cantidad}</td>
      <td align="right"  style="padding:10px 8px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">S/ ${parseFloat(i.precio_unit).toFixed(2)}</td>
      <td align="right"  style="padding:10px 8px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#222;font-weight:700">S/ ${parseFloat(i.subtotal).toFixed(2)}</td>
    </tr>`;

  const filaTot = (lbl, val, fuerte, color) => `
    <tr>
      <td style="padding:5px 0;color:${fuerte ? '#222' : '#8a8a8a'};font-size:${fuerte ? '15px' : '13px'};${fuerte ? 'font-weight:700' : ''}">${lbl}</td>
      <td align="right" style="padding:5px 0;color:${color || (fuerte ? VERDE : '#333')};font-size:${fuerte ? '17px' : '13px'};font-weight:${fuerte ? '800' : '600'}">${val}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f3;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f3;padding:26px 12px">
<tr><td align="center">

  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 22px rgba(0,0,0,.09)">

    <!-- ENCABEZADO -->
    <tr><td style="background:${VERDE};padding:30px 28px;text-align:center">
      ${!esNota ? `<div style="font-size:30px;line-height:1;color:#fff">&#10003;</div>` : ''}
      <div style="font-size:12px;letter-spacing:2px;color:#d9fbe5;margin-top:${esNota ? '0' : '8px'}">${tipoLabel}</div>
      <div style="font-size:26px;font-weight:800;color:#fff;margin-top:5px;letter-spacing:.5px">${venta.numero}</div>
      <div style="font-size:12px;color:#d9fbe5;margin-top:9px">${fecha} &nbsp;&middot;&nbsp; Pago al contado</div>
    </td></tr>

    <!-- TOTAL DESTACADO -->
    <tr><td style="padding:22px 28px;text-align:center;border-bottom:1px solid #eee">
      <div style="font-size:11px;letter-spacing:1.5px;color:#9a9a9a">IMPORTE TOTAL</div>
      <div style="font-size:36px;font-weight:800;color:${VERDE};margin-top:3px">S/ ${total}</div>
    </td></tr>

    <!-- DATOS -->
    <tr><td style="padding:18px 28px 4px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${filaDato('Empresa', empNombre)}
        ${filaDato('RUC emisor', empRuc)}
        ${filaDato('Cliente', venta.cliente_nombre)}
        ${venta.numero_doc ? filaDato((venta.tipo_doc || '').toUpperCase(), venta.numero_doc) : ''}
        ${filaDato('Vendedor', venta.vendedor_nombre)}
      </table>
    </td></tr>

    <!-- DETALLE DEL PEDIDO -->
    <tr><td style="padding:18px 28px 0">
      <div style="font-size:11px;letter-spacing:1.5px;color:#9a9a9a;margin-bottom:8px">DETALLE DEL PEDIDO</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr style="background:#f0fbf4">
          <td style="padding:9px 8px;font-size:11px;font-weight:700;color:${VERDE};letter-spacing:.5px">PRODUCTO</td>
          <td align="center" style="padding:9px 8px;font-size:11px;font-weight:700;color:${VERDE}">CANT.</td>
          <td align="right"  style="padding:9px 8px;font-size:11px;font-weight:700;color:${VERDE}">P. UNIT.</td>
          <td align="right"  style="padding:9px 8px;font-size:11px;font-weight:700;color:${VERDE}">IMPORTE</td>
        </tr>
        ${items.map(filaItem).join('')}
      </table>
    </td></tr>

    <!-- TOTALES -->
    <tr><td style="padding:14px 28px">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border-radius:10px;padding:6px 14px">
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:6px 0">
            ${filaTot('Subtotal', `S/ ${parseFloat(venta.subtotal).toFixed(2)}`)}
            ${+venta.descuento > 0 ? filaTot('Descuento', `- S/ ${parseFloat(venta.descuento).toFixed(2)}`, false, VERDE) : ''}
            ${!esNota ? filaTot('Op. gravada', `S/ ${baseGravada}`) : ''}
            ${!esNota ? filaTot('IGV (18%)', `S/ ${igvCalc}`) : ''}
            ${filaTot('TOTAL', `S/ ${total}`, true)}
          </table>
        </td></tr>
      </table>
    </td></tr>

    ${!esNota && comp ? `
    <!-- AVISO ADJUNTOS -->
    <tr><td style="padding:0 28px 14px">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef7ee;border:1px solid #cfe8cf;border-radius:10px">
        <tr><td style="padding:12px 16px;font-size:12px;color:#2e7d32">
          <strong>&#128206; Comprobante electrónico adjunto</strong><br>
          Se adjuntan el <strong>PDF</strong>, el <strong>XML firmado</strong> y el <strong>CDR de SUNAT</strong>.
        </td></tr>
      </table>
    </td></tr>` : ''}

    ${documentUrl ? `
    <tr><td style="padding:0 28px 16px;text-align:center">
      <a href="${documentUrl}" style="display:inline-block;background:${VERDE};color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">Ver documento</a>
    </td></tr>` : ''}

    ${venta.observacion ? `
    <tr><td style="padding:0 28px 14px">
      <div style="font-size:12px;color:#777;background:#fafafa;border-radius:8px;padding:10px 14px">
        <strong style="color:#555">Observación:</strong> ${venta.observacion}
      </div>
    </td></tr>` : ''}

    <!-- PIE -->
    <tr><td style="background:#1a1a2e;padding:20px 28px;text-align:center">
      <div style="font-size:14px;font-weight:700;color:#fff">${empNombre}</div>
      ${empRuc ? `<div style="font-size:11px;color:#9a9aae;margin-top:2px">RUC ${empRuc}</div>` : ''}
      ${empDir ? `<div style="font-size:11px;color:#9a9aae;margin-top:2px">${empDir}</div>` : ''}
      ${empTel ? `<div style="font-size:11px;color:#9a9aae;margin-top:2px">Tel: ${empTel}</div>` : ''}
      <div style="font-size:12px;color:#d9fbe5;margin-top:12px">¡Gracias por su preferencia! &#128153;</div>
    </td></tr>

  </table>

  <div style="font-size:11px;color:#aaa;margin-top:14px">
    Este es un correo automático generado por el sistema de ventas.
  </div>

</td></tr>
</table>
</body></html>`;
}


// Evita que la misma venta se emita o anule dos veces a la vez (doble clic,
// dos pestañas). Devuelve { ocupado:true } si otro proceso ya la está tratando.
async function conBloqueoVenta(ventaId, fn) {
  const conn = await getDB().getConnection();
  const name = `mp_comprobante_venta_${ventaId}`;
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 0) AS ok', [name]);
    if (Number(lock.ok) !== 1) return { ocupado: true };
    try {
      return await fn();
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

// Guarda en el comprobante lo que respondió SUNAT al enviarlo.
async function registrarRespuestaSunat(comprobanteId, sr, rawSend) {
  const ahora = peruNowSQL();
  const aceptado = sr.estado === 'aceptado' || sr.estado === 'observado';
  await ComprobanteModel.actualizarEnvio(comprobanteId, {
    estado_sunat: aceptado ? 'aceptado' : (sr.estado === 'rechazado' ? 'rechazado' : 'emitido'),
    cdr_estado: sr.estado,
    cdr_codigo: aceptado ? (sr.codigo || '0') : sr.codigo,
    cdr_mensaje: sr.mensaje || (aceptado ? 'Aceptado por SUNAT'
      : sr.estado === 'rechazado' ? 'Rechazado por SUNAT' : 'Pendiente de respuesta de SUNAT'),
    cdr_path: sr.cdr_path, hash_cpe: sr.hash,
    sunat_response: JSON.stringify(rawSend), enviado_at: ahora, aceptado_at: aceptado ? ahora : null
  });
  return aceptado;
}

/*
 * Revierte los efectos de una venta dentro de una transacción abierta:
 * stock, efectivo de caja, entrega del pedido web y cupo de recojo.
 * `permitirEntregado` se usa con la nota de crédito: SUNAT ya anuló el
 * comprobante, así que un pedido entregado se trata como devolución.
 */
async function revertirVentaTx(conn, id, v, u, { permitirEntregado = false } = {}) {
  // Bloquea la venta para que dos anulaciones simultáneas no repongan el
  // stock dos veces.
  const [[locked]] = await conn.query('SELECT estado_venta,pedido_web_id FROM ventas WHERE id=? FOR UPDATE', [id]);
  if (!locked || locked.estado_venta === 'anulada') throw new Error('La venta ya está anulada');
  // Una venta nacida de un pedido web arrastra su entrega: se cancela la
  // preparación y se devuelve el cupo de recojo.
  if (locked.pedido_web_id) {
    const [deliveries] = await conn.query('SELECT id,estado FROM pedido_entregas_sucursal WHERE pedido_id=? FOR UPDATE', [locked.pedido_web_id]);
    const entregado = deliveries.some(d => d.estado === 'entregado');
    if (entregado && !permitirEntregado)
      throw new Error('El pedido web de esta venta ya fue entregado. No se puede anular.');
    const [slots] = await conn.query("SELECT id,horario_id FROM pedido_recojo_reservas WHERE pedido_id=? AND estado IN ('reservado','confirmado') FOR UPDATE", [locked.pedido_web_id]);
    for (const slot of slots) {
      await conn.query('UPDATE recojo_fechas SET cupos_usados=GREATEST(cupos_usados-1,0) WHERE id=?', [slot.horario_id]);
      await conn.query("UPDATE pedido_recojo_reservas SET estado='liberado',updated_at=NOW() WHERE id=?", [slot.id]);
    }
    await conn.query("UPDATE pedido_entregas_sucursal SET estado='cancelado',observacion=?,updated_at=NOW() WHERE pedido_id=? AND estado<>'entregado'", [`Venta ${v.numero} anulada`, locked.pedido_web_id]);
    if (!entregado) await conn.query("UPDATE pedidos_web SET estado_pedido='cancelado',updated_at=NOW() WHERE id=?", [locked.pedido_web_id]);
  }
  await VentaModel.anular(conn, id, u.id);
  // El efectivo cobrado sale de la caja si la sesión sigue abierta; de lo
  // contrario el cierre mostraría un faltante que no existe.
  const [cashIn] = await conn.query(`
    SELECT m.sesion_id,m.sucursal_id,m.monto
    FROM caja_movimientos m JOIN caja_sesiones s ON s.id=m.sesion_id
    WHERE m.venta_id=? AND m.tipo='ingreso' AND s.estado='abierta'
  `, [id]);
  for (const movement of cashIn) {
    await CajaModel.insertMovimiento(conn, {
      sesion_id: movement.sesion_id, sucursal_id: movement.sucursal_id, tipo: 'egreso',
      concepto: `Anulación venta ${v.numero}`, monto: movement.monto,
      venta_id: null, usuario_id: u.id, created_at: peruNowSQL()
    });
  }
  const items = await VentaModel.getVentaItems(conn, id);
  for (const item of items) {
    await VentaModel.reponerStock(conn, item.producto_id, item.cantidad);
    const [[p]] = await conn.query('SELECT stock_actual FROM productos WHERE id = ?', [item.producto_id]);
    await VentaModel.insertMovimiento(conn, {
      producto_id:   item.producto_id, tipo: 'ANULACION',
      cantidad:      item.cantidad, stock_antes: p.stock_actual - item.cantidad,
      stock_despues: p.stock_actual, referencia: `Anulación ${v.numero}`,
      usuario_id:    u.id, sucursal_id: item.sucursal_id || v.sucursal_id
    });
  }
}

async function ventaEnAlcance(req, venta) {
  if (!venta) return false;
  if (await hasGlobalScope(req, 'dashboard.ver_global')) return true;
  const scope = userScope(req);
  if (!scope.sucursalId) return false;
  if (Number(venta.es_multisucursal) === 1) return false;
  return Number(venta.sucursal_id) === Number(scope.sucursalId);
}

async function exigirVentaEnAlcance(req, res, id) {
  const venta = await VentaModel.getById(id);
  if (!venta) { res.status(404).json({ ok:false, msg:'Venta no encontrada' }); return null; }
  if (!(await ventaEnAlcance(req, venta))) { res.status(403).json({ ok:false, msg:'Venta fuera de tu alcance' }); return null; }
  return venta;
}
const VentaController = {

  list: wrap(async (req, res) => {
    const u   = req.session.usuario;
    const sid = (u?.es_global) ? null : u?.sucursal_id;
    const ventas = await VentaModel.getAll(sid, req.query);
    res.json({ ok: true, ventas });
  }),

  getOne: wrap(async (req, res) => {
    const id    = +req.params.id;
    const venta = await exigirVentaEnAlcance(req, res, id);
    if (!venta) return;

    const [items, pagos] = await Promise.all([
      VentaModel.getItems(id),
      VentaModel.getPagos(id)
    ]);
    res.json({ ok: true, venta, items, pagos });
  }),

  create: wrap(async (req, res) => {
    const db = getDB();
    const u  = req.session.usuario;
    const {
      cliente_id,
      tipo_entrega  = 'presencial',
      items         = [],
      pagos         = [],
      descuento     = 0,
      observacion   = '',
      cotizacion_id = null
    } = req.body;

    if (!items.length)
      return res.json({ ok: false, msg: 'Agrega al menos un producto' });
    for (const item of items) {
      if (+item.precio_unit <= 0 || +item.cantidad <= 0)
        return res.json({ ok: false, msg: 'Los precios y cantidades deben ser mayores a 0' });
    }
    if (!pagos.length)
      return res.json({ ok: false, msg: 'Agrega al menos un método de pago' });

    let sucursal_id = (u?.es_global)
      ? Number(req.body.sucursal_id || 0)
      : Number(u?.sucursal_id || 0);
    // Para el admin global, la sucursal real se obtiene de los productos elegidos.
    // Esto evita falsos errores cuando la pestaña visual quedó desfasada.
    if (u?.es_global && items.length) {
      const ids = [...new Set(items.map(x => Number(x.producto_id)).filter(Boolean))];
      const [sucursalesProductos] = await db.query(
        `SELECT DISTINCT sucursal_id FROM productos WHERE id IN (${ids.map(()=>'?').join(',')}) AND estado=0`, ids
      );
      const sucursalesValidas = sucursalesProductos.map(x => Number(x.sucursal_id)).filter(Boolean);
      if (sucursalesValidas.length !== 1)
        return res.json({ ok:false, msg:'Todos los productos de una venta deben pertenecer a la misma sucursal.' });
      sucursal_id = sucursalesValidas[0];
    }
    if (!sucursal_id) return res.json({ ok:false, msg:'Selecciona una sucursal válida.' });

    // Solo el efectivo entra a la caja física
    const efectivoMonto = pagos
      .filter(p => (p.metodo || 'efectivo') === 'efectivo')
      .reduce((a, p) => a + (+p.monto || 0), 0);

    // La caja física (efectivo) SOLO se exige si hay pago en efectivo.
    // Pagos digitales (Yape/Plin/transferencia) NO requieren caja abierta:
    // se registran igual y quedan pendientes de conciliación en Caja Digital.
    let cajaSesion = null;
    if (efectivoMonto > 0) {
      cajaSesion = await CajaModel.sesionAbiertaDe(u.id);
      if (!cajaSesion)
        return res.json({ ok: false, msg: 'Necesitas aperturar caja para registrar el pago en efectivo' });
      if (Number(cajaSesion.sucursal_id) !== Number(sucursal_id)) {
        return res.status(409).json({
          ok:false,
          msg:`La caja abierta pertenece a ${cajaSesion.sucursal_nombre || 'otra sucursal'}. Para cobrar en efectivo, todos los productos deben pertenecer a esa misma sucursal.`
        });
      }
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // El precio unitario lo fija el servidor: precio de lista, escalón de
      // volumen o precio de la cotización vigente. Lo que envía el navegador
      // no se usa, así nadie puede registrar una venta con un precio alterado.
      const quotePrices = new Map();
      if (cotizacion_id) {
        const [[quote]] = await conn.query(
          "SELECT id FROM cotizaciones WHERE id=? AND estado='vigente' AND (vence_at IS NULL OR vence_at>=CURDATE())",
          [Number(cotizacion_id)]
        );
        if (!quote) throw new Error('La cotización ya no está vigente. Vuelve a cargar los productos.');
        const [quoteItems] = await conn.query(
          'SELECT producto_id,presentacion_id,precio_unit FROM cotizacion_items WHERE cotizacion_id=?',
          [quote.id]
        );
        for (const row of quoteItems)
          quotePrices.set(`${row.producto_id}_${row.presentacion_id || 'base'}`, Number(row.precio_unit));
      }
      for (const item of items) {
        item.producto_id = Number(item.producto_id);
        item.cantidad = Number(item.cantidad);
        item.descuento = 0;
        if (!Number.isInteger(item.cantidad) || item.cantidad <= 0 || item.cantidad > 100000)
          throw new Error('La cantidad de cada producto debe ser un número entero mayor a 0');
        const key = `${item.producto_id}_${item.presentacion_id || 'base'}`;
        if (quotePrices.has(key)) { item.precio_unit = quotePrices.get(key); continue; }
        const [[listed]] = await conn.query('SELECT nombre,precio_venta FROM productos WHERE id=? AND estado=0', [item.producto_id]);
        if (!listed) throw new Error(`Producto ID ${item.producto_id} no encontrado`);
        let price = Number(listed.precio_venta || 0);
        if (!item.presentacion_id) {
          const [[tier]] = await conn.query(
            'SELECT precio_unit FROM precios_volumen WHERE producto_id=? AND cantidad_desde<=? ORDER BY cantidad_desde DESC LIMIT 1',
            [item.producto_id, item.cantidad]
          );
          if (tier) price = Number(tier.precio_unit);
        }
        if (!(price > 0)) throw new Error(`El producto "${listed.nombre}" no tiene un precio de venta válido`);
        item.precio_unit = price;
      }

      let subtotal = 0;
      for (const item of items)
        subtotal += item.precio_unit * item.cantidad;
      subtotal = Number(subtotal.toFixed(2));

      let desc = +descuento || 0;
      if (desc < 0) desc = 0;
      if (desc > subtotal + 0.009)
        throw new Error(`El descuento (S/ ${desc.toFixed(2)}) no puede ser mayor al total de los productos (S/ ${subtotal.toFixed(2)})`);
      const base  = Math.max(0, subtotal - desc);
      const igv   = 0;
      const total = parseFloat(base.toFixed(2));

      const pagado = pagos.reduce((a, p) => a + (+p.monto || 0), 0);
      if (pagado + 0.001 < total)
        throw new Error(`El pago (S/ ${pagado.toFixed(2)}) no cubre el total (S/ ${total.toFixed(2)})`);

      const serie = 'NV01';
      const serieRow = await VentaModel.getSerie(conn, serie);
      if (!serieRow) throw new Error(`Serie ${serie} no encontrada`);

      const nuevoNum = serieRow.ultimo_numero + 1;
      await VentaModel.incrementarSerie(conn, serieRow.id, nuevoNum);
      const numero = `${serie}-${String(nuevoNum).padStart(6, '0')}`;

      const venta_id = await VentaModel.insertVenta(conn, {
        cliente_id: cliente_id || null, sucursal_id, vendedor_id: u.id,
        tipo_venta: 'contado', tipo_entrega, tipo_comprobante: 'nota',
        serie, numero, subtotal, igv, descuento: desc, total,
        observacion, cotizacion_id, created_by: u.id,
        created_at: peruNowSQL()           // ← HORA REAL DE PERÚ
      });

      for (const item of items) {
        const prod = await VentaModel.getProductoStock(conn, item.producto_id);
        if (!prod) throw new Error(`Producto ID ${item.producto_id} no encontrado`);
        if (prod.sucursal_id != null && Number(prod.sucursal_id) !== Number(sucursal_id))
          throw new Error(`El producto "${prod.nombre}" pertenece a otra sucursal. Actualiza el filtro antes de venderlo.`);
        if (Number(prod.es_transferido) === 1 && Number(prod.transferencia_venta_panel) !== 1)
          throw new Error(`El producto transferido "${prod.nombre}" todavía no está habilitado para venta en la sucursal destino.`);
        if (prod.stock_actual < item.cantidad)
          throw new Error(`Stock insuficiente para "${prod.nombre}". Disponible: ${prod.stock_actual}`);

        const itemSub = item.precio_unit * item.cantidad - (item.descuento || 0);
        await VentaModel.insertItem(conn, {
          venta_id, producto_id: item.producto_id,
          presentacion_id: item.presentacion_id || null,
          cantidad: item.cantidad, precio_unit: item.precio_unit,
          descuento: item.descuento || 0, subtotal: itemSub,
          sucursal_id, costo_unitario: Number(prod.precio_costo || 0)
        });

        await VentaModel.descontarStock(conn, item.producto_id, item.cantidad);
        await VentaModel.insertMovimiento(conn, {
          producto_id:   item.producto_id, tipo: 'SALIDA_VENTA',
          cantidad:      item.cantidad, stock_antes: prod.stock_actual,
          stock_despues: prod.stock_actual - item.cantidad,
          referencia:    numero, usuario_id: u.id, sucursal_id
        });
      }

      for (const pago of pagos) {
        const metodo = pago.metodo || 'efectivo';
        const ref    = (pago.referencia || '').trim();

        // Yape / Plin / Transferencia: código obligatorio, con formato y ÚNICO (nunca repetido)
        if (metodo !== 'efectivo') {
          if (!ref)
            throw new Error(`El pago con ${metodo} necesita su código de operación`);
          if (!/^[A-Za-z0-9._\- ]{3,40}$/.test(ref))
            throw new Error('El número o código de operación debe tener entre 3 y 40 caracteres válidos');
          const yaExiste = await VentaModel.existeCodigoPago(conn, metodo, ref);
          if (yaExiste)
            throw new Error(`El código "${ref}" de ${metodo} ya fue registrado antes. No se puede repetir.`);
        }

        await VentaModel.insertPago(conn, {
          venta_id, metodo, monto: pago.monto, referencia: ref
        });
      }

      // ventas.metodo_pago alimenta el dashboard y los reportes. Sin esto toda
      // venta del panel quedaba como "efectivo". Se guarda el método principal
      // (el de mayor monto); el detalle exacto sigue en la tabla pagos.
      const porMetodo = new Map();
      for (const pago of pagos) {
        const metodo = pago.metodo || 'efectivo';
        porMetodo.set(metodo, (porMetodo.get(metodo) || 0) + (+pago.monto || 0));
      }
      const [metodoPrincipal] = [...porMetodo.entries()].sort((a, b) => b[1] - a[1])[0] || ['efectivo'];
      if (['efectivo','yape','plin','transferencia','izipay','credito'].includes(metodoPrincipal))
        await conn.query('UPDATE ventas SET metodo_pago=? WHERE id=?', [metodoPrincipal, venta_id]);

      // Enganche venta EFECTIVO → Caja: el efectivo entra a la caja abierta del cajero
      if (efectivoMonto > 0 && cajaSesion) {
        await CajaModel.insertMovimiento(conn, {
          sesion_id:   cajaSesion.id,
          sucursal_id: cajaSesion.sucursal_id,
          tipo:        'ingreso',
          concepto:    `Venta ${numero}`,
          monto:       efectivoMonto,
          venta_id,
          usuario_id:  u.id,
          created_at:  peruNowSQL()
        });
      }

      // NOTA: la cotización NO se marca como convertida → se puede reutilizar
      // en varias ventas mientras siga vigente (solo deja de servir si vence).

      await conn.commit();
      await AuditService.log(req,{accion:'venta_creada',modulo:'ventas',entidad:'ventas',entidad_id:venta_id,datos:{numero,total,sucursal_id}});
      res.json({ ok: true, msg: 'Venta registrada', venta_id, numero });
    } catch(e) {
      await conn.rollback();
      res.json({ ok: false, msg: e.message });
    } finally {
      conn.release();
    }
  }),

  anular: wrap(async (req, res) => {
    const db = getDB();
    const id = +req.params.id;
    const u  = req.session.usuario;

    const v = await exigirVentaEnAlcance(req, res, id);
    if (!v) return;
    if (v.estado_venta === 'anulada')
      return res.json({ ok: false, msg: 'La venta ya está anulada' });
    // Un comprobante aceptado solo se anula con nota de crédito. Si fue
    // rechazado nunca tuvo validez, así que la venta se puede anular directo.
    const comp = await ComprobanteModel.getByVenta(id);
    if (comp && ['aceptado','observado'].includes(comp.cdr_estado))
      return res.json({ ok: false, msg: 'Esta venta tiene un comprobante aceptado por SUNAT. Anúlala con una Nota de Crédito.' });
    if (comp && comp.cdr_estado === 'pendiente')
      return res.json({ ok: false, msg: 'El comprobante está pendiente de respuesta de SUNAT. Usa "Reintentar envío" antes de anular.' });
    if (v.estado_sunat === 'aceptado')
      return res.json({ ok: false, msg: 'No se puede anular una venta con comprobante aceptado por SUNAT' });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await revertirVentaTx(conn, id, v, u);
      await conn.commit();
      res.json({ ok: true, msg: 'Nota de venta eliminada' });
    } catch(e) {
      await conn.rollback();
      res.json({ ok: false, msg: e.message });
    } finally {
      conn.release();
    }
  }),

  // ── EMITIR: genera y firma el comprobante (invoice/create) y lo envía a SUNAT ──
  emitir: wrap(async (req, res) => {
    const db = getDB();
    const id = +req.params.id;
    const { tipo } = req.body;
    const u  = req.session.usuario;
    // Instante exacto en que el usuario presionó Emitir.
    const emitidoAtPeru = peruNowSQL();

    if (!['boleta','factura'].includes(tipo))
      return res.json({ ok: false, msg: 'Tipo inválido' });
    if (!(await exigirVentaEnAlcance(req, res, id))) return;

    const result = await conBloqueoVenta(id, async () => {
      // Se vuelve a leer con el bloqueo tomado: el estado pudo cambiar.
      const v = await VentaModel.getById(id);
      if (v.estado_venta === 'anulada')
        return { ok: false, msg: 'La venta está anulada' };
      // Permitido emitir cuando: nunca se emitió (sin_emitir) o fue RECHAZADO (reemitir corregido)
      if (!['sin_emitir', 'rechazado'].includes(v.estado_sunat))
        return { ok: false, msg: 'Esta venta ya tiene un comprobante emitido' };
      if (tipo === 'factura' && (v.tipo_doc !== 'ruc' || !/^\d{11}$/.test(String(v.numero_doc || ''))))
        return { ok: false, msg: 'La factura requiere un cliente con RUC de 11 dígitos' };
      if (tipo === 'boleta' && !v.numero_doc)
        return { ok: false, msg: 'La boleta requiere un cliente con DNI' };

      const compPrevio = await ComprobanteModel.getByVenta(id);
      if (compPrevio) {
        const ce = compPrevio.cdr_estado;
        if (ce === 'aceptado' || ce === 'observado')
          return { ok: false, msg: 'Ya tiene un comprobante aceptado por SUNAT. Use Nota de Crédito para anularlo.' };
        if (ce === 'pendiente')
          return { ok: false, msg: 'El comprobante ya fue generado y está pendiente de envío. Use "Reintentar envío".' };
      }

      const datos    = await VentaModel.getVentaParaEmitir(id);
      const serieStr = tipo === 'boleta' ? 'B001' : 'F001';
      const tipoDoc  = tipo === 'factura' ? '01' : '03';

      // ── PASO 1: generar y firmar ──
      // La fila de la serie queda bloqueada hasta guardar el comprobante. El
      // correlativo solo se consume si MiAPI lo generó y quedó registrado, así
      // no hay números saltados ni repetidos aunque dos cajeros emitan a la vez.
      const conn = await db.getConnection();
      let nuevoNum, numCompleto, comprobanteId;
      try {
        await conn.beginTransaction();
        const serieRow = await VentaModel.getSerie(conn, serieStr);
        if (!serieRow) throw new Error(`Serie ${serieStr} no encontrada`);
        nuevoNum    = serieRow.ultimo_numero + 1;
        numCompleto = `${serieStr}-${String(nuevoNum).padStart(6, '0')}`;

        const pe = peruParts();
        const built = buildInvoice({
          venta: datos.venta, items: datos.items, tipo,
          serie: serieStr, correlativo: nuevoNum, fecha: pe.date, hora: pe.time
        });
        const rawCreate = await SunatService.generarComprobante(built.payload);
        const cr = interpretarCreate(rawCreate);
        if (!cr.ok) throw new Error(cr.mensaje || 'MiAPI no pudo generar el comprobante');

        // Un comprobante rechazado antes se reemplaza por el nuevo.
        await ComprobanteModel.eliminarPorVenta(conn, id);
        comprobanteId = await ComprobanteModel.crear(conn, {
          venta_id: id, tipo, serie: serieStr, numero: nuevoNum,
          numero_full: numCompleto, hash_cpe: cr.hash,
          // Base e IGV exactos: la suma de las líneas enviadas a SUNAT.
          subtotal: built.totales.base, igv: built.totales.igv, total: built.totales.total,
          xml_path:            cr.xml_firmado,
          xml_sin_firmar_path: cr.xml_sin_firmar,
          pdf_a4_path:         cr.pdf_a4,
          pdf_ticket_path:     cr.pdf_ticket,
          cdr_path:            null,
          estado_sunat:        'emitido',
          cdr_estado:          'pendiente',
          cdr_codigo:          null,
          cdr_mensaje:         'Comprobante generado, pendiente de envío a SUNAT',
          sunat_response:      JSON.stringify(rawCreate),
          created_by:          u.id,
          fecha_peru:          emitidoAtPeru
        });
        await VentaModel.incrementarSerie(conn, serieRow.id, nuevoNum);
        await conn.query(
          'UPDATE ventas SET estado_sunat = ?, tipo_comprobante = ?, numero = ? WHERE id = ?',
          ['emitido', tipo, numCompleto, id]
        );
        await conn.commit();
      } catch(e) {
        await conn.rollback();
        return { ok: false, msg: `No se pudo generar el comprobante: ${e.message}` };
      } finally {
        conn.release();
      }

      // ── PASO 2: enviar a SUNAT (invoice/send) ── ESTE es el que trae el CDR
      let rawSend, sr;
      try {
        rawSend = await SunatService.enviarSunat(tipoDoc, serieStr, nuevoNum);
        sr = interpretarSunat(rawSend);
      } catch(e) {
        // SUNAT/MiAPI no respondió → queda pendiente y reintentable (NO se pierde el número)
        return {
          ok: true, estado: 'pendiente', numero: numCompleto, comprobante_id: comprobanteId,
          msg: `Comprobante generado pero SUNAT no respondió (${e.message}). Quedó pendiente: usa "Reintentar envío".`
        };
      }

      const aceptado = await registrarRespuestaSunat(comprobanteId, sr, rawSend);
      if (sr.estado === 'rechazado') {
        // Se conserva el motivo y la venta queda lista para corregir y reemitir.
        await db.query('UPDATE ventas SET estado_sunat = ? WHERE id = ?', ['rechazado', id]);
        return { ok: true, estado: 'rechazado', numero: numCompleto, codigo: sr.codigo, msg: sr.mensaje || 'SUNAT rechazó el comprobante' };
      }
      if (!aceptado) {
        return { ok: true, estado: 'pendiente', numero: numCompleto,
          msg: sr.mensaje || 'Enviado a SUNAT, pendiente de confirmación. Usa "Reintentar envío".' };
      }
      await db.query('UPDATE ventas SET estado_sunat = ? WHERE id = ?', ['aceptado', id]);
      await AuditService.log(req,{accion:'comprobante_emitido',modulo:'ventas',entidad:'ventas',entidad_id:id,datos:{numero:numCompleto,tipo,estado:sr.estado}});
      return {
        ok: true, estado: sr.estado, numero: numCompleto, comprobante_id: comprobanteId,
        observaciones: sr.observaciones,
        msg: sr.estado === 'observado' ? 'Aceptado por SUNAT con observaciones' : 'Comprobante aceptado por SUNAT'
      };
    });

    if (result.ocupado) return res.status(409).json({ ok: false, msg: 'Esta venta ya se está procesando. Espera unos segundos.' });
    res.json(result);
  }),

  // ── NOTA DE CRÉDITO: anula por completo una boleta o factura aceptada ──
  // Es la única forma legal de dejar sin efecto un comprobante ya aceptado.
  // La venta, el stock y la caja solo se revierten cuando SUNAT acepta la nota.
  notaCredito: wrap(async (req, res) => {
    const db = getDB();
    const id = +req.params.id;
    const u  = req.session.usuario;
    const motivo = String(req.body.motivo || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (motivo.length < 5)
      return res.json({ ok: false, msg: 'Escribe el motivo de la anulación (mínimo 5 caracteres)' });
    if (!(await exigirVentaEnAlcance(req, res, id))) return;

    const aplicarAnulacion = async (v) => {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await revertirVentaTx(conn, id, v, u, { permitirEntregado: true });
        await conn.commit();
      } catch(e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    };

    const result = await conBloqueoVenta(id, async () => {
      const v = await VentaModel.getById(id);
      const original = await ComprobanteModel.getByVenta(id);
      if (!original || !['aceptado','observado'].includes(original.cdr_estado))
        return { ok: false, msg: 'Solo se anula con nota de crédito un comprobante aceptado por SUNAT' };

      let nota = await ComprobanteModel.getNotaCreditoByVenta(id);
      const notaAceptada = !!nota && ['aceptado','observado'].includes(nota.cdr_estado);
      if (notaAceptada && v.estado_venta === 'anulada')
        return { ok: false, msg: `La venta ya fue anulada con la nota de crédito ${nota.numero_full}` };
      if (!notaAceptada && v.estado_venta === 'anulada')
        return { ok: false, msg: 'La venta ya está anulada' };

      // ── PASO 1: generar y firmar la nota (si no hay una pendiente de envío) ──
      if (!nota || nota.cdr_estado === 'rechazado') {
        const datos    = await VentaModel.getVentaParaEmitir(id);
        const serieStr = original.tipo === 'factura' ? 'FC01' : 'BC01';
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          const serieRow = await VentaModel.getSerie(conn, serieStr);
          if (!serieRow) throw new Error(`Serie ${serieStr} no encontrada`);
          const nuevoNum    = serieRow.ultimo_numero + 1;
          const numCompleto = `${serieStr}-${String(nuevoNum).padStart(6, '0')}`;
          const pe = peruParts();
          const built = buildCreditNote({
            venta: datos.venta, items: datos.items, original,
            serie: serieStr, correlativo: nuevoNum, fecha: pe.date, hora: pe.time, motivo
          });
          const rawCreate = await SunatService.generarNota(built.payload);
          const cr = interpretarCreate(rawCreate);
          if (!cr.ok) throw new Error(cr.mensaje || 'MiAPI no pudo generar la nota de crédito');
          const notaId = await ComprobanteModel.crear(conn, {
            venta_id: id, tipo: 'nota_credito', serie: serieStr, numero: nuevoNum,
            numero_full: numCompleto, hash_cpe: cr.hash,
            subtotal: built.totales.base, igv: built.totales.igv, total: built.totales.total,
            xml_path: cr.xml_firmado, xml_sin_firmar_path: cr.xml_sin_firmar,
            pdf_a4_path: cr.pdf_a4, pdf_ticket_path: cr.pdf_ticket, cdr_path: null,
            estado_sunat: 'emitido', cdr_estado: 'pendiente', cdr_codigo: null,
            cdr_mensaje: 'Nota de crédito generada, pendiente de envío a SUNAT',
            sunat_response: JSON.stringify(rawCreate), created_by: u.id, fecha_peru: peruNowSQL(),
            motivo_anula: motivo, comprobante_ref: original.numero_full
          });
          await VentaModel.incrementarSerie(conn, serieRow.id, nuevoNum);
          await conn.commit();
          nota = await ComprobanteModel.getById(notaId);
        } catch(e) {
          await conn.rollback();
          return { ok: false, msg: `No se pudo generar la nota de crédito: ${e.message}` };
        } finally {
          conn.release();
        }
      }

      // ── PASO 2: enviar a SUNAT (salvo que ya estuviera aceptada) ──
      let estado = nota.cdr_estado;
      let observaciones = null;
      if (!['aceptado','observado'].includes(estado)) {
        let rawSend, sr;
        try {
          rawSend = await SunatService.enviarSunat('07', nota.serie, nota.numero);
          sr = interpretarSunat(rawSend);
        } catch(e) {
          return { ok: true, estado: 'pendiente', numero: nota.numero_full,
            msg: `Nota de crédito ${nota.numero_full} generada, pero SUNAT no respondió (${e.message}). La venta sigue vigente: vuelve a presionar "Anular con nota de crédito" para reintentar.` };
        }
        const aceptado = await registrarRespuestaSunat(nota.id, sr, rawSend);
        if (sr.estado === 'rechazado')
          return { ok: true, estado: 'rechazado', numero: nota.numero_full, codigo: sr.codigo,
            msg: `SUNAT rechazó la nota de crédito: ${sr.mensaje || 'sin detalle'}. La venta sigue vigente.` };
        if (!aceptado)
          return { ok: true, estado: 'pendiente', numero: nota.numero_full,
            msg: sr.mensaje || 'Nota de crédito enviada, pendiente de confirmación de SUNAT. La venta sigue vigente.' };
        estado = sr.estado;
        observaciones = sr.observaciones;
      }

      // ── PASO 3: SUNAT aceptó → recién ahora se revierte la venta ──
      await aplicarAnulacion(v);
      await AuditService.log(req,{accion:'nota_credito_emitida',modulo:'ventas',entidad:'ventas',entidad_id:id,descripcion:motivo,datos:{nota:nota.numero_full,comprobante:original.numero_full}});
      return {
        ok: true, estado, numero: nota.numero_full, observaciones,
        msg: `Nota de crédito ${nota.numero_full} aceptada por SUNAT. ${original.numero_full} quedó anulado y el stock fue devuelto.`
      };
    });

    if (result.ocupado) return res.status(409).json({ ok: false, msg: 'Esta venta ya se está procesando. Espera unos segundos.' });
    res.json(result);
  }),

  // ── REINTENTAR ENVÍO a SUNAT (para comprobantes que quedaron pendientes) ──
  reintentarEnvio: wrap(async (req, res) => {
    const id   = +req.params.id;
    const scopedVenta = await exigirVentaEnAlcance(req, res, id);
    if (!scopedVenta) return;
    const comp = await ComprobanteModel.getByVenta(id);
    if (!comp) return res.json({ ok: false, msg: 'Esta venta no tiene comprobante' });
    if (comp.cdr_estado === 'aceptado' || comp.cdr_estado === 'observado')
      return res.json({ ok: false, msg: 'El comprobante ya fue aceptado por SUNAT' });

    const tipoDoc = comp.tipo === 'factura' ? '01' : '03';

    let rawSend, sr;
    try {
      rawSend = await SunatService.enviarSunat(tipoDoc, comp.serie, comp.numero);
      sr = interpretarSunat(rawSend);
    } catch(e) {
      return res.json({ ok: true, estado: 'pendiente', msg: `SUNAT no respondió (${e.message}). Sigue pendiente.` });
    }

    const ahora = peruNowSQL();

    if (sr.estado === 'rechazado') {
      await ComprobanteModel.actualizarEnvio(comp.id, {
        estado_sunat: 'rechazado', cdr_estado: 'rechazado',
        cdr_codigo: sr.codigo, cdr_mensaje: sr.mensaje || 'Rechazado por SUNAT',
        cdr_path: sr.cdr_path, hash_cpe: sr.hash,
        sunat_response: JSON.stringify(rawSend), enviado_at: ahora, aceptado_at: null
      });
      await getDB().query('UPDATE ventas SET estado_sunat = ? WHERE id = ?', ['rechazado', id]);
      return res.json({ ok: true, estado: 'rechazado', codigo: sr.codigo, msg: sr.mensaje || 'SUNAT rechazó el comprobante' });
    }

    if (sr.estado === 'pendiente') {
      await ComprobanteModel.actualizarEnvio(comp.id, {
        estado_sunat: 'emitido', cdr_estado: 'pendiente',
        cdr_codigo: sr.codigo, cdr_mensaje: sr.mensaje || 'Pendiente de respuesta de SUNAT',
        cdr_path: sr.cdr_path, hash_cpe: sr.hash,
        sunat_response: JSON.stringify(rawSend), enviado_at: ahora, aceptado_at: null
      });
      return res.json({ ok: true, estado: 'pendiente', msg: sr.mensaje || 'Sigue pendiente en SUNAT.' });
    }

    await ComprobanteModel.actualizarEnvio(comp.id, {
      estado_sunat: 'aceptado', cdr_estado: sr.estado,
      cdr_codigo: sr.codigo || '0', cdr_mensaje: sr.mensaje || 'Aceptado por SUNAT',
      cdr_path: sr.cdr_path, hash_cpe: sr.hash,
      sunat_response: JSON.stringify(rawSend), enviado_at: ahora, aceptado_at: ahora
    });
    await getDB().query('UPDATE ventas SET estado_sunat = ? WHERE id = ?', ['aceptado', id]);
    res.json({
      ok: true, estado: sr.estado, observaciones: sr.observaciones,
      msg: sr.estado === 'observado' ? 'Aceptado por SUNAT con observaciones' : 'Comprobante aceptado por SUNAT'
    });
  }),

  actualizarCliente: wrap(async (req, res) => {
    const id             = +req.params.id;
    const { cliente_id } = req.body;
    if (!cliente_id) return res.json({ ok: false, msg: 'cliente_id requerido' });

    const v = await exigirVentaEnAlcance(req, res, id);
    if (!v) return;
    if (v.estado_sunat === 'aceptado')
      return res.json({ ok: false, msg: 'No se puede cambiar el cliente de un comprobante emitido' });

    await VentaModel.actualizarCliente(id, cliente_id);
    res.json({ ok: true, msg: 'Cliente actualizado' });
  }),

  enviarCorreo: wrap(async (req, res) => {
    const id        = +req.params.id;
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.json({ ok: false, msg: 'Correo inválido' });

    const venta = await exigirVentaEnAlcance(req, res, id);
    if (!venta) return;

    const [items, empresa, comp] = await Promise.all([
      VentaModel.getItems(id),
      VentaModel.getEmpresaConfig(),
      ComprobanteModel.getByVenta(id)
    ]);

    const esNota    = ['nota','nota_venta'].includes(String(venta.tipo_comprobante || '').toLowerCase());
    const tipoLabel = esNota                              ? 'NOTA DE VENTA'
                    : venta.tipo_comprobante === 'boleta' ? 'BOLETA DE VENTA'
                    : 'FACTURA ELECTRÓNICA';

    try {
      const adjuntos = [];
      let documentUrl = '';
      if (esNota) {
        const generated = await InternalDocumentService.generarVenta(id);
        documentUrl = await DocumentService.createPublicLink(req, {
          tipo: 'venta', entidadId: id, filename: generated.archivo
        });
        adjuntos.push({ filename: generated.archivo, content: generated.content, contentType: 'application/pdf' });
      } else if (comp) {
        const base = comp.numero_full;
        const [pdf, xmlFirm, cdr] = await Promise.all([
          descargarAdjunto(comp.pdf_a4_path, `${base}.pdf`),
          descargarAdjunto(comp.xml_path,    `${base}.xml`),
          descargarAdjunto(comp.cdr_path,    `R-${base}.xml`)
        ]);
        if (pdf)     adjuntos.push(pdf);
        if (xmlFirm) adjuntos.push(xmlFirm);
        if (cdr)     adjuntos.push(cdr);
        documentUrl = comp.pdf_a4_path || comp.pdf_ticket_path || '';
      }

      const html = construirCorreoHTML({ venta, items, empresa, esNota, tipoLabel, comp, documentUrl });
      const empresaNombre = empresa.empresa_nombre || 'Mundo Pet';
      await MailService.send({
        to: email,
        subject: `${tipoLabel} ${venta.numero} - ${empresaNombre}`,
        html,
        text: `${tipoLabel} ${venta.numero} - Total S/ ${Number(venta.total || 0).toFixed(2)}${documentUrl ? ` - Ver: ${documentUrl}` : ''}`,
        attachments: adjuntos
      });

      const adjMsg = adjuntos.length ? ` con ${adjuntos.length} archivo(s) adjunto(s)` : '';
      res.json({ ok: true, msg: `Correo enviado${adjMsg}` });
    } catch(e) {
      console.error('[MAIL VENTA]', e.message);
      res.status(502).json({ ok: false, msg: MailService.friendlyError(e), code: e.code || 'SMTP_ERROR' });
    }
  }),

  // ── URLs de los archivos del comprobante ──
  archivos: wrap(async (req, res) => {
    const ventaId = +req.params.id;
    const scopedVenta = await exigirVentaEnAlcance(req, res, ventaId);
    if (!scopedVenta) return;
    const comp = await ComprobanteModel.getByVenta(ventaId);
    if (!comp) return res.json({ ok: false, msg: 'Esta venta no tiene comprobante emitido' });
    const nota = await ComprobanteModel.getNotaCreditoByVenta(ventaId);

    res.json({
      ok: true,
      archivos: {
        pdf_a4:         comp.pdf_a4_path          || null,
        pdf_ticket:     comp.pdf_ticket_path      || null,
        xml:            comp.xml_path             || null,
        xml_sin_firmar: comp.xml_sin_firmar_path  || null,
        cdr:            comp.cdr_path             || null
      },
      estado:     comp.estado_sunat,
      cdr_estado: comp.cdr_estado,        // aceptado / observado / rechazado / pendiente
      codigo:     comp.cdr_codigo,
      mensaje:    comp.cdr_mensaje,
      numero:     comp.numero_full,
      tipo:       comp.tipo,
      nota_credito: nota ? {
        numero: nota.numero_full, cdr_estado: nota.cdr_estado, codigo: nota.cdr_codigo,
        mensaje: nota.cdr_mensaje, motivo: nota.motivo_anula,
        pdf_a4: nota.pdf_a4_path || null, pdf_ticket: nota.pdf_ticket_path || null,
        xml: nota.xml_path || null, cdr: nota.cdr_path || null
      } : null
    });
  }),

  // ── HISTORIAL: línea de tiempo de la venta ──
  historial: wrap(async (req, res) => {
    const id    = +req.params.id;
    const venta = await exigirVentaEnAlcance(req, res, id);
    if (!venta) return;

    const [pagos, comp, items, nota] = await Promise.all([
      VentaModel.getPagos(id),
      ComprobanteModel.getByVenta(id),
      VentaModel.getItems(id),
      ComprobanteModel.getNotaCreditoByVenta(id)
    ]);

    const eventos = [];
    eventos.push({
      icon: 'ti-shopping-cart-plus', color: '#00b0ff',
      titulo: 'Venta registrada',
      detalle: `Registrada por ${venta.vendedor_nombre || '—'} · ${items.length} producto(s) · Total S/ ${parseFloat(venta.total).toFixed(2)}`,
      fecha: venta.created_at
    });

    if (pagos.length) {
      eventos.push({
        icon: 'ti-wallet', color: '#4caf50',
        titulo: 'Pago registrado',
        detalle: pagos.map(p => `${p.metodo} S/ ${parseFloat(p.monto).toFixed(2)}`).join(' · '),
        fecha: venta.created_at
      });
    }

    if (comp) {
      if (comp.emitido_at) eventos.push({
        icon: 'ti-file-invoice', color: '#ffa000',
        titulo: `${(comp.tipo || '').charAt(0).toUpperCase() + (comp.tipo || '').slice(1)} generada`,
        detalle: `Comprobante ${comp.numero_full} generado y firmado`,
        fecha: comp.emitido_at
      });
      if (comp.enviado_at) eventos.push({
        icon: 'ti-cloud-upload', color: '#00b0ff',
        titulo: 'Enviado a SUNAT',
        detalle: `Comprobante ${comp.numero_full} transmitido a SUNAT`,
        fecha: comp.enviado_at
      });
      if (comp.cdr_estado === 'aceptado' && comp.aceptado_at) eventos.push({
        icon: 'ti-circle-check', color: '#00c853',
        titulo: 'Aceptado por SUNAT',
        detalle: comp.cdr_mensaje || `Código de respuesta ${comp.cdr_codigo || '0'}`,
        fecha: comp.aceptado_at
      });
      if (comp.cdr_estado === 'observado' && comp.aceptado_at) eventos.push({
        icon: 'ti-alert-triangle', color: '#ffb300',
        titulo: 'Aceptado con observaciones',
        detalle: comp.cdr_mensaje || `Código ${comp.cdr_codigo}`,
        fecha: comp.aceptado_at
      });
      if (comp.cdr_estado === 'rechazado') eventos.push({
        icon: 'ti-circle-x', color: '#e53935',
        titulo: 'Rechazado por SUNAT',
        detalle: `${comp.cdr_codigo ? '[' + comp.cdr_codigo + '] ' : ''}${comp.cdr_mensaje || 'El comprobante fue rechazado'}`,
        fecha: comp.enviado_at || comp.emitido_at
      });
      if (comp.cdr_estado === 'pendiente') eventos.push({
        icon: 'ti-clock', color: '#90a4ae',
        titulo: 'Pendiente de SUNAT',
        detalle: comp.cdr_mensaje || 'Aún no se ha confirmado el envío a SUNAT',
        fecha: comp.enviado_at || comp.emitido_at
      });
    }

    if (nota) {
      const aceptada = ['aceptado','observado'].includes(nota.cdr_estado);
      eventos.push({
        icon: 'ti-receipt-refund', color: aceptada ? '#e53935' : nota.cdr_estado === 'rechazado' ? '#ff7043' : '#90a4ae',
        titulo: aceptada ? 'Nota de crédito aceptada por SUNAT'
          : nota.cdr_estado === 'rechazado' ? 'Nota de crédito rechazada' : 'Nota de crédito pendiente de SUNAT',
        detalle: `${nota.numero_full} sobre ${nota.comprobante_ref || comp?.numero_full || ''}${nota.motivo_anula ? ` · Motivo: ${nota.motivo_anula}` : ''}`,
        fecha: nota.aceptado_at || nota.enviado_at || nota.emitido_at
      });
    }

    if (venta.estado_venta === 'anulada') eventos.push({
      icon: 'ti-ban', color: '#e53935',
      titulo: 'Venta anulada', detalle: 'El stock fue devuelto al inventario',
      fecha: nota?.aceptado_at || venta.created_at
    });

    res.json({
      ok: true,
      venta: { numero: venta.numero, total: venta.total, cliente: venta.cliente_nombre },
      eventos
    });
  }),

  listPagos: wrap(async (req, res) => {
    const db  = getDB();
    const u   = req.session.usuario;
    const sid = (u?.es_global) ? null : u?.sucursal_id;
    let sql = `
      SELECT pv.*, v.numero AS venta_numero, v.total AS venta_total,
             COALESCE(c.nombre,'Cliente General') AS cliente_nombre, c.numero_doc
      FROM pagos_verificacion pv
      LEFT JOIN ventas v   ON v.id = pv.venta_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE 1=1
    `;
    const params = [];
    if (sid) { sql += ' AND v.sucursal_id = ?'; params.push(sid); }
    sql += ' ORDER BY pv.id DESC';
    const [pagos] = await db.query(sql, params);
    res.json({ ok: true, pagos });
  }),

  aprobarPago: wrap(async (req, res) => {
    const db = getDB();
    const id = +req.params.id;
    const u  = req.session.usuario;
    const { estado, notas = '' } = req.body;
    if (!['aprobado','rechazado'].includes(estado))
      return res.json({ ok: false, msg: 'Estado inválido' });
    await db.query(`
      UPDATE pagos_verificacion
      SET estado = ?, notas_admin = ?, verificado_by = ?, verificado_at = NOW()
      WHERE id = ?
    `, [estado, notas, u.id, id]);
    if (estado === 'aprobado') {
      const [[pv]] = await db.query('SELECT venta_id FROM pagos_verificacion WHERE id = ?', [id]);
      if (pv?.venta_id)
        await db.query("UPDATE ventas SET estado_venta = 'registrada' WHERE id = ?", [pv.venta_id]);
    }
    res.json({ ok: true, msg: `Pago ${estado}` });
  }),

  uploadVoucher: wrap(async (req, res) => {
    if (!req.file) return res.json({ ok: false, msg: 'Sin archivo' });
    const { venta_id, metodo = 'yape', monto = 0, numero_operacion = '' } = req.body;
    const ruta = `/uploads/vouchers/${req.file.filename}`;
    const db   = getDB();
    const [r]  = await db.query(`
      INSERT INTO pagos_verificacion (venta_id, metodo, monto, numero_operacion, imagen_voucher)
      VALUES (?,?,?,?,?)
    `, [+venta_id || null, metodo, +monto, numero_operacion, ruta]);
    res.json({ ok: true, msg: 'Voucher subido', id: r.insertId, ruta });
  })
};

module.exports = VentaController;