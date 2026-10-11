'use strict';

/*
 * Notas de crédito: listado propio y envío al cliente.
 * La emisión sigue en VentaController (se anula desde la venta).
 */
const { wrap } = require('../helpers/response');
const { getDB } = require('../config/database');
const { userScope } = require('../middleware/permisos');
const MailService = require('../services/MailService');
const AuditService = require('../services/AuditService');

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoyPeru = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const fechaValida = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && String(value) <= hoyPeru();

const SELECT = `
  SELECT c.id, c.venta_id, c.numero_full, c.subtotal, c.igv, c.total, c.estado_sunat, c.cdr_estado, c.cdr_codigo, c.cdr_mensaje,
         c.motivo_anula, c.comprobante_ref, c.pdf_a4_path, c.pdf_ticket_path, c.xml_path, c.cdr_path,
         DATE_FORMAT(c.emitido_at,'%Y-%m-%dT%H:%i:%s') AS emitido_at,
         v.numero AS venta_numero, v.sucursal_id, s.nombre AS sucursal_nombre, u.nombre AS emitida_por,
         COALESCE(NULLIF(cl.razon_social,''), NULLIF(TRIM(CONCAT_WS(' ',cl.nombre,cl.apellido_paterno,cl.apellido_materno)),''), NULLIF(v.cliente_web_nombre,''), 'Cliente general') AS cliente_nombre,
         COALESCE(NULLIF(cl.numero_doc,''), v.cliente_web_doc, '') AS cliente_doc,
         COALESCE(cl.email,'') AS cliente_email, COALESCE(cl.telefono,'') AS cliente_telefono
    FROM comprobantes c
    JOIN ventas v ON v.id = c.venta_id
    LEFT JOIN clientes cl ON cl.id = v.cliente_id
    LEFT JOIN sucursales s ON s.id = v.sucursal_id
    LEFT JOIN usuarios u ON u.id = c.created_by
   WHERE c.tipo = 'nota_credito'`;

async function descargar(url, filename) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    return { filename, content: Buffer.from(await response.arrayBuffer()) };
  } catch (_) { return null; }
}

function correoHTML({ nota, empresa }) {
  const fila = (label, value) => value ? `<tr><td style="padding:8px 0;color:#8a8a8a;font-size:13px;border-bottom:1px solid #f2f2f2">${label}</td><td style="padding:8px 0;color:#222;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #f2f2f2">${esc(value)}</td></tr>` : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f3;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f3;padding:26px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 6px 22px rgba(0,0,0,.09)">
  <tr><td style="background:#159447;padding:28px;text-align:center">
    <div style="color:#d9f5e3;font-size:12px;letter-spacing:1.5px;text-transform:uppercase">${esc(empresa.nombre)}</div>
    <div style="color:#fff;font-size:22px;font-weight:800;margin-top:8px">Nota de crédito electrónica</div>
    <div style="color:#fff;font-size:15px;margin-top:6px">${esc(nota.numero_full)}</div>
  </td></tr>
  <tr><td style="padding:26px 28px">
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.55">Estimado/a <b>${esc(nota.cliente_nombre)}</b>:<br>Le enviamos la nota de crédito que deja sin efecto el comprobante <b>${esc(nota.comprobante_ref || nota.venta_numero)}</b>.</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${fila('Nota de crédito', nota.numero_full)}
      ${fila('Comprobante anulado', nota.comprobante_ref)}
      ${fila('Motivo', nota.motivo_anula)}
      ${fila('Importe', `S/ ${Number(nota.total || 0).toFixed(2)}`)}
    </table>
    ${nota.pdf_a4_path ? `<div style="text-align:center;margin:24px 0 4px"><a href="${esc(nota.pdf_a4_path)}" style="background:#159447;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-size:14px;font-weight:700;display:inline-block">Ver nota de crédito</a></div>` : ''}
  </td></tr>
  <tr><td style="background:#f7f8fa;padding:16px 28px;text-align:center;font-size:11px;color:#9a9a9a">${esc(empresa.nombre)}${empresa.ruc ? ` · RUC ${esc(empresa.ruc)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

const NotaCreditoController = {
  list: wrap(async (req, res) => {
    const db = getDB();
    const scope = userScope(req);
    const { desde, hasta } = req.query;
    if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) return res.status(400).json({ ok: false, msg: 'Las fechas no son válidas o son futuras' });
    if (desde && hasta && desde > hasta) return res.status(400).json({ ok: false, msg: 'La fecha desde no puede ser posterior a la fecha hasta' });
    let sql = SELECT; const params = [];
    if (!scope.isGlobal && scope.sucursalId) { sql += ' AND v.sucursal_id=?'; params.push(scope.sucursalId); }
    if (desde) { sql += ' AND DATE(c.emitido_at)>=?'; params.push(desde); }
    if (hasta) { sql += ' AND DATE(c.emitido_at)<=?'; params.push(hasta); }
    const estado = String(req.query.estado || '');
    if (estado === 'aceptado') sql += " AND c.cdr_estado IN ('aceptado','observado')";
    else if (estado === 'rechazado') sql += " AND c.cdr_estado='rechazado'";
    else if (estado === 'pendiente') sql += " AND (c.cdr_estado IS NULL OR c.cdr_estado NOT IN ('aceptado','observado','rechazado'))";
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q) {
      sql += ' AND (c.numero_full LIKE ? OR c.comprobante_ref LIKE ? OR v.numero LIKE ? OR cl.numero_doc LIKE ? OR cl.nombre LIKE ? OR cl.razon_social LIKE ?)';
      params.push(...Array(6).fill(`%${q}%`));
    }
    sql += ' ORDER BY c.emitido_at DESC, c.id DESC LIMIT 500';
    const [rows] = await db.query(sql, params);
    const aceptadas = rows.filter(r => ['aceptado', 'observado'].includes(r.cdr_estado));
    res.json({
      ok: true, notas: rows, hoy: hoyPeru(),
      resumen: {
        total: rows.length, aceptadas: aceptadas.length,
        monto: Number(aceptadas.reduce((sum, r) => sum + Number(r.total || 0), 0).toFixed(2)),
        pendientes: rows.filter(r => !['aceptado', 'observado', 'rechazado'].includes(r.cdr_estado)).length,
        rechazadas: rows.filter(r => r.cdr_estado === 'rechazado').length
      }
    });
  }),

  enviarCorreo: wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, msg: 'Correo inválido' });
    const db = getDB();
    const scope = userScope(req);
    const [[nota]] = await db.query(`${SELECT} AND c.id=?`, [+req.params.id]);
    if (!nota || (!scope.isGlobal && scope.sucursalId && Number(nota.sucursal_id) !== Number(scope.sucursalId))) {
      return res.status(404).json({ ok: false, msg: 'Nota de crédito no encontrada' });
    }
    if (!['aceptado', 'observado'].includes(nota.cdr_estado)) return res.status(400).json({ ok: false, msg: 'Solo se envían notas de crédito aceptadas por SUNAT' });
    const [cfgRows] = await db.query("SELECT clave,valor FROM configuracion WHERE clave IN ('empresa_nombre','empresa_ruc')");
    const cfg = Object.fromEntries(cfgRows.map(r => [r.clave, r.valor]));
    const empresa = { nombre: cfg.empresa_nombre || 'Mundo Pet', ruc: cfg.empresa_ruc || '' };
    try {
      const adjuntos = (await Promise.all([
        descargar(nota.pdf_a4_path, `${nota.numero_full}.pdf`),
        descargar(nota.xml_path, `${nota.numero_full}.xml`),
        descargar(nota.cdr_path, `R-${nota.numero_full}.xml`)
      ])).filter(Boolean);
      await MailService.send({
        to: email,
        subject: `NOTA DE CRÉDITO ${nota.numero_full} - ${empresa.nombre}`,
        html: correoHTML({ nota, empresa }),
        text: `Nota de crédito ${nota.numero_full} que anula ${nota.comprobante_ref || nota.venta_numero}. Importe S/ ${Number(nota.total || 0).toFixed(2)}${nota.pdf_a4_path ? ` - Ver: ${nota.pdf_a4_path}` : ''}`,
        attachments: adjuntos
      });
      await AuditService.log(req, { accion: 'nota_credito_enviada', modulo: 'ventas', entidad: 'comprobantes', entidad_id: nota.id, datos: { nota: nota.numero_full, email } }).catch(() => {});
      res.json({ ok: true, msg: `Correo enviado${adjuntos.length ? ` con ${adjuntos.length} archivo(s) adjunto(s)` : ''}` });
    } catch (error) {
      console.error('[MAIL NOTA CREDITO]', error.message);
      res.status(502).json({ ok: false, msg: MailService.friendlyError(error), code: error.code || 'SMTP_ERROR' });
    }
  })
};

module.exports = NotaCreditoController;
