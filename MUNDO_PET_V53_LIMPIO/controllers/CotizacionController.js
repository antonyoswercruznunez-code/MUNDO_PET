const { wrap }        = require('../helpers/response');
const { getDB }       = require('../config/database');
const CotizacionModel = require('../models/CotizacionModel');
const MailService     = require('../services/MailService');
const { userScope, hasGlobalScope } = require('../middleware/permisos');
const AuditService = require('../services/AuditService');
const InternalDocumentService = require('../services/InternalDocumentService');
const DocumentService = require('../services/DocumentService');

// ── Hora real de Perú sin depender de la zona horaria del servidor ──
function peruParts() {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date());
  const o = {};
  for (const p of f) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}:${o.second}` };
}
function peruNowSQL() { const p = peruParts(); return `${p.date} ${p.time}`; }

function fechaValidaISO(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}
function cotizacionVencida(q, hoy = peruParts().date) {
  return !!(q && q.estado === 'vigente' && q.vence_at && String(q.vence_at).slice(0, 10) < hoy);
}
function esAdministradorCotizaciones(req) {
  const u = req.session?.usuario || {};
  const perfil = String(u.perfil_nombre || '').trim().toLowerCase();
  return !!u.es_global || perfil === 'administrador' || perfil.startsWith('administrador ');
}

// 'YYYY-MM-DD' → 'DD/MM/YYYY'
function fechaDMY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
}

// ── Plantilla de la proforma (tablas + estilos inline → se ve bien en Gmail) ──
function construirProformaHTML({ cotizacion, items, empresa }) {
  const emp    = empresa || {};
  const nombre = emp.empresa_nombre || 'Distribuciones MAOZ';
  const ruc    = emp.empresa_ruc ? `RUC: ${emp.empresa_ruc}` : '';
  const dir    = emp.empresa_direccion || '';

  const filas = items.map(it => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${it.producto_nombre}${it.presentacion_nombre ? ` <span style="color:#999">(${it.presentacion_nombre})</span>` : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${it.cantidad}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">S/ ${(+it.precio_unit).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">S/ ${(+it.subtotal).toFixed(2)}</td>
    </tr>`).join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333">
    <div style="background:#159447;color:#fff;padding:20px;text-align:center;border-radius:8px 8px 0 0">
      <h2 style="margin:0">${nombre}</h2>
      <div style="font-size:13px;opacity:.9">${ruc}</div>
      <div style="font-size:12px;opacity:.85">${dir}</div>
    </div>
    <div style="border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 8px 8px">
      <h3 style="margin:0 0 4px;color:#159447">PROFORMA / COTIZACIÓN ${cotizacion.codigo}</h3>
      <p style="margin:0 0 16px;color:#888;font-size:13px">Válida hasta: <strong>${fechaDMY(cotizacion.vence_at)}</strong></p>
      <p style="font-size:14px;margin:0 0 12px"><strong>Cliente:</strong> ${cotizacion.cliente_nombre || 'Cliente General'}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:8px;text-align:left">Producto</th>
            <th style="padding:8px;text-align:center">Cant.</th>
            <th style="padding:8px;text-align:right">P. Unit</th>
            <th style="padding:8px;text-align:right">Subtotal</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
      <div style="text-align:right;margin-top:16px;font-size:18px;font-weight:bold;color:#159447">
        TOTAL: S/ ${(+cotizacion.total).toFixed(2)}
      </div>
      ${cotizacion.observacion ? `<p style="margin-top:14px;font-size:12px;color:#888"><strong>Observación:</strong> ${cotizacion.observacion}</p>` : ''}
      <p style="margin-top:22px;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:12px">
        Esta proforma no es un comprobante de pago. Los precios son válidos hasta la fecha indicada.
      </p>
    </div>
  </div>`;
}

// Suma de días a una fecha 'YYYY-MM-DD' (sin tocar zona horaria)
function sumarDias(fechaISO, dias) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + (+dias || 0));
  return base.toISOString().slice(0, 10);
}


async function cotizacionEnAlcance(req, q) {
  if (!q) return false;
  if (await hasGlobalScope(req, 'dashboard.ver_global')) return true;
  const scope = userScope(req);
  return !!scope.sucursalId && Number(q.sucursal_id) === Number(scope.sucursalId);
}

async function exigirCotizacion(req,res,id) {
  const q=await CotizacionModel.getById(id);
  if(!q){res.status(404).json({ok:false,msg:'Cotización no encontrada'});return null;}
  if(!(await cotizacionEnAlcance(req,q))){res.status(403).json({ok:false,msg:'Cotización fuera de tu alcance'});return null;}
  return q;
}
const CotizacionController = {

  list: wrap(async (req, res) => {
    const u   = req.session.usuario;
    const sid = (u?.es_global) ? null : u?.sucursal_id;
    const { desde, hasta, estado, buscar } = req.query;
    const hoy = peruParts().date;
    if ((desde && !fechaValidaISO(desde)) || (hasta && !fechaValidaISO(hasta)))
      return res.status(400).json({ ok:false, msg:'Rango de fechas inválido' });
    if ((desde && desde > hoy) || (hasta && hasta > hoy))
      return res.status(400).json({ ok:false, msg:'No se permiten fechas futuras' });
    if (desde && hasta && desde > hasta)
      return res.status(400).json({ ok:false, msg:'La fecha desde no puede ser mayor que hasta' });

    // 'vencida' no es un estado real (es vigente + fecha pasada): se filtra aparte
    const estadoDB = (estado === 'vencida') ? 'vigente' : estado;
    let cotizaciones = await CotizacionModel.getAll(sid, { desde, hasta, estado: estadoDB, buscar });

    cotizaciones.forEach(q => {
      q.vencida     = cotizacionVencida(q, hoy);
      q.estado_real = q.vencida ? 'vencida' : q.estado;
      q.codigo      = 'COT-' + String(q.id).padStart(5, '0');
    });
    // Afinar el filtro: "Vigentes" = no vencidas; "Vencidas" = solo vencidas
    if (estado === 'vencida') cotizaciones = cotizaciones.filter(q => q.vencida);
    if (estado === 'vigente') cotizaciones = cotizaciones.filter(q => !q.vencida);

    res.json({ ok: true, cotizaciones, hoy });
  }),

  getOne: wrap(async (req, res) => {
    const id = +req.params.id;
    const cotizacion = await exigirCotizacion(req,res,id);
    if (!cotizacion) return;
    const items = await CotizacionModel.getItems(id);
    const hoy = peruParts().date;
    cotizacion.vencida     = cotizacionVencida(cotizacion, hoy);
    cotizacion.estado_real = cotizacion.vencida ? 'vencida' : cotizacion.estado;
    cotizacion.codigo      = 'COT-' + String(cotizacion.id).padStart(5, '0');
    res.json({ ok: true, cotizacion, items });
  }),

  // Cotizaciones vigentes (para el selector al crear una venta)
  vigentes: wrap(async (req, res) => {
    const u   = req.session.usuario;
    const sid = (u?.es_global) ? null : u?.sucursal_id;
    const clienteId = req.query.cliente_id ? +req.query.cliente_id : null;
    const hoy = peruParts().date;
    const cotizaciones = await CotizacionModel.getVigentes(sid, clienteId, hoy);
    res.json({ ok: true, cotizaciones });
  }),

  create: wrap(async (req, res) => {
    const db = getDB();
    const u  = req.session.usuario;
    const {
      cliente_id, items = [],
      observacion = '', dias_validez, vence_at
    } = req.body;

    if (!items.length)
      return res.json({ ok: false, msg: 'Agrega al menos un producto' });
    for (const it of items) {
      if (+it.precio_unit <= 0 || +it.cantidad <= 0)
        return res.json({ ok: false, msg: 'Los precios y cantidades deben ser mayores a 0' });
    }

    // ── Fecha de vencimiento (por fecha exacta o por días de validez) ──
    const hoy = peruParts().date;
    let venceFinal = vence_at || (dias_validez ? sumarDias(hoy, dias_validez) : null);
    if (!venceFinal)
      return res.json({ ok: false, msg: 'Indica la fecha de vencimiento de la cotización' });
    if (venceFinal < hoy)
      return res.json({ ok: false, msg: 'La fecha de vencimiento no puede ser anterior a hoy' });

    let sucursal_id = (u?.es_global)
      ? Number(req.body.sucursal_id || 0)
      : Number(u?.sucursal_id || 0);
    if (u?.es_global && items.length) {
      const ids = [...new Set(items.map(x => Number(x.producto_id)).filter(Boolean))];
      const [sucursalesProductos] = await db.query(
        `SELECT DISTINCT sucursal_id FROM productos WHERE id IN (${ids.map(()=>'?').join(',')}) AND estado=0`, ids
      );
      const sucursalesValidas = sucursalesProductos.map(x => Number(x.sucursal_id)).filter(Boolean);
      if (sucursalesValidas.length !== 1)
        return res.json({ ok:false, msg:'Todos los productos de una cotización deben pertenecer a la misma sucursal.' });
      sucursal_id = sucursalesValidas[0];
    }
    if (!sucursal_id) return res.json({ ok:false, msg:'Selecciona una sucursal válida.' });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      let subtotal = 0;
      for (const it of items) subtotal += (+it.precio_unit) * (+it.cantidad);
      subtotal = parseFloat(subtotal.toFixed(2));

      // Sin descuento global: el total es la suma de líneas (los precios se editan por línea)
      const total = subtotal;

      const cotizacion_id = await CotizacionModel.crear(conn, {
        cliente_id: cliente_id || null, sucursal_id, vendedor_id: u.id,
        subtotal, igv: 0, descuento: 0, total,
        observacion, vence_at: venceFinal, created_at: peruNowSQL()
      });

      for (const it of items) {
        const prod = await CotizacionModel.getProductoStock(conn, Number(it.producto_id));
        if (!prod) throw new Error('Producto no encontrado');
        if (prod.sucursal_id != null && Number(prod.sucursal_id) !== Number(sucursal_id))
          throw new Error(`El producto "${prod.nombre}" pertenece a otra sucursal`);
        if (Number(prod.es_transferido) === 1 && Number(prod.transferencia_venta_panel) !== 1)
          throw new Error(`El producto transferido "${prod.nombre}" no está habilitado para cotizarse`);
        const sub = parseFloat(((+it.precio_unit) * (+it.cantidad)).toFixed(2));
        await CotizacionModel.insertItem(conn, {
          cotizacion_id, producto_id: it.producto_id,
          presentacion_id: it.presentacion_id || null,
          cantidad: it.cantidad, precio_unit: it.precio_unit, subtotal: sub
        });
      }

      await conn.commit();
      await AuditService.log(req,{accion:'cotizacion_creada',modulo:'cotizaciones',entidad:'cotizaciones',entidad_id:cotizacion_id,datos:{sucursal_id,total}});
      res.json({ ok: true, msg: 'Cotización registrada', id: cotizacion_id });
    } catch (e) {
      await conn.rollback();
      res.json({ ok: false, msg: e.message });
    } finally {
      conn.release();
    }
  }),

  update: wrap(async (req, res) => {
    if (!esAdministradorCotizaciones(req))
      return res.status(403).json({ ok:false, msg:'Solo un administrador puede editar cotizaciones' });
    const id = Number(req.params.id);
    const actual = await exigirCotizacion(req, res, id);
    if (!actual) return;
    if (actual.estado !== 'vigente' || cotizacionVencida(actual))
      return res.status(409).json({ ok:false, msg:'Solo se pueden editar cotizaciones activas y vigentes' });

    const { cliente_id, items = [], observacion = '', vence_at } = req.body;
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ ok:false, msg:'Agrega al menos un producto' });
    const hoy = peruParts().date;
    if (!fechaValidaISO(vence_at) || vence_at < hoy)
      return res.status(400).json({ ok:false, msg:'La fecha de vencimiento debe ser hoy o posterior' });

    const db = getDB();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      let subtotal = 0;
      for (const item of items) {
        const cantidad = Number(item.cantidad);
        const precio = Number(item.precio_unit);
        if (!Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precio) || precio <= 0)
          throw new Error('Las cantidades y precios deben ser mayores a cero');
        const prod = await CotizacionModel.getProductoStock(conn, Number(item.producto_id));
        if (!prod) throw new Error('Producto no encontrado');
        if (prod.sucursal_id != null && Number(prod.sucursal_id) !== Number(actual.sucursal_id))
          throw new Error(`El producto "${prod.nombre}" pertenece a otra sucursal`);
        if (Number(prod.es_transferido) === 1 && Number(prod.transferencia_venta_panel) !== 1)
          throw new Error(`El producto transferido "${prod.nombre}" no está habilitado para cotizarse`);
        subtotal += precio * cantidad;
      }
      subtotal = Number(subtotal.toFixed(2));
      await conn.query(`UPDATE cotizaciones SET cliente_id=?,subtotal=?,igv=0,descuento=0,total=?,observacion=?,vence_at=?,updated_at=NOW() WHERE id=? AND estado='vigente'`,
        [cliente_id || null, subtotal, subtotal, String(observacion || '').trim().slice(0, 1000), vence_at, id]);
      await conn.query('DELETE FROM cotizacion_items WHERE cotizacion_id=?', [id]);
      for (const item of items) {
        const sub = Number((Number(item.precio_unit) * Number(item.cantidad)).toFixed(2));
        await CotizacionModel.insertItem(conn, {
          cotizacion_id:id, producto_id:Number(item.producto_id), presentacion_id:item.presentacion_id || null,
          cantidad:Number(item.cantidad), precio_unit:Number(item.precio_unit), subtotal:sub
        });
      }
      await conn.commit();
      await AuditService.log(req,{accion:'cotizacion_editada',modulo:'cotizaciones',entidad:'cotizaciones',entidad_id:id,datos:{total:subtotal}});
      res.json({ ok:true, msg:'Cotización actualizada', id });
    } catch (error) {
      await conn.rollback();
      res.status(400).json({ ok:false, msg:error.message });
    } finally { conn.release(); }
  }),

  // Enviar la proforma por correo (Gmail / SMTP configurado)
  enviarCorreo: wrap(async (req, res) => {
    const id        = +req.params.id;
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.json({ ok: false, msg: 'Correo inválido' });

    const cotizacion = await exigirCotizacion(req,res,id);
    if (!cotizacion) return;
    if (cotizacion.estado === 'eliminada')
      return res.json({ ok: false, msg: 'La cotización fue eliminada' });
    if (cotizacionVencida(cotizacion))
      return res.status(409).json({ ok:false, msg:'La cotización vencida solo puede eliminarse' });
    cotizacion.codigo = 'COT-' + String(cotizacion.id).padStart(5, '0');

    const [items, empresa] = await Promise.all([
      CotizacionModel.getItems(id),
      CotizacionModel.getEmpresaConfig()
    ]);

    try {
      const generated = await InternalDocumentService.generarCotizacion(id);
      const documentUrl = await DocumentService.createPublicLink(req, {
        tipo: 'cotizacion', entidadId: id, filename: generated.archivo
      });
      const htmlBase = construirProformaHTML({ cotizacion, items, empresa });
      const html = htmlBase.replace('</div></div>', `<div style="text-align:center;margin:20px 0 8px"><a href="${documentUrl}" style="display:inline-block;background:#159447;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">Ver cotización</a></div></div></div>`);
      const empresaNombre = empresa.empresa_nombre || 'Mundo Pet';
      await MailService.send({
        to: email,
        subject: `Cotización ${cotizacion.codigo} - ${empresaNombre}`,
        html,
        text: `Cotización ${cotizacion.codigo} de ${empresaNombre}. Ver: ${documentUrl}`,
        attachments: [{ filename: generated.archivo, content: generated.content, contentType: 'application/pdf' }]
      });
      res.json({ ok: true, msg: `Cotización enviada a ${email}`, url: documentUrl });
    } catch (e) {
      console.error('[MAIL COTIZACION]', e.message);
      res.status(502).json({ ok: false, msg: MailService.friendlyError(e), code: e.code || 'SMTP_ERROR' });
    }
  }),

  // Eliminar = borrado lógico (estado 'eliminada'). Solo Administrador.
  eliminar: wrap(async (req, res) => {
    const id = +req.params.id;
    const q  = await exigirCotizacion(req,res,id);
    if (!q) return;
    if (q.estado === 'eliminada')
      return res.json({ ok: false, msg: 'La cotización ya fue eliminada' });
    await CotizacionModel.cambiarEstado(id, 'eliminada');
    res.json({ ok: true, msg: 'Cotización eliminada' });
  })

};

module.exports = CotizacionController;