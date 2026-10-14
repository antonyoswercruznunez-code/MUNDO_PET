const { wrap } = require('../helpers/response');
const { getDB } = require('../config/database');
const ClienteWebModel = require('../models/ClienteWebModel');
const ClienteModel = require('../models/ClienteModel');
const Crypto = require('../services/CryptoService');
const Audit = require('../services/AuditService');
const DeliveryPricing = require('../services/DeliveryPricingService');

const WEB_PAYMENT_METHODS = new Set(['yape','plin','transferencia','izipay']);

function normalizeOperationReference(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 100);
}


function seasonDiscountAmountSql(alias = 'p') {
  return `COALESCE((SELECT MAX(CASE
      WHEN tdp.tipo_descuento='monto' THEN LEAST(${alias}.precio_venta,tdp.monto)
      ELSE ${alias}.precio_venta*LEAST(100,tdp.porcentaje)/100 END)
    FROM temporada_descuentos tdp
    JOIN temporadas tp ON tp.id=tdp.temporada_id
    WHERE tp.estado=0 AND CURDATE() BETWEEN tp.fecha_inicio AND tp.fecha_fin
      AND tdp.producto_id=${alias}.id),0)`;
}

function peruNowSQL() {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }).formatToParts(new Date());
  const o = {}; for (const p of f) o[p.type] = p.value;
  return `${o.year}-${o.month}-${o.day} ${o.hour === '24' ? '00' : o.hour}:${o.minute}:${o.second}`;
}

function normalizeSnapshot(raw = {}) {
  const tipo = String(raw.tipo_doc || 'dni').toLowerCase();
  const numero = String(raw.numero_doc || '').replace(/\D/g, '');
  return {
    tipo_doc: tipo,
    numero_doc: numero,
    nombre: String(raw.nombre || '').trim().slice(0, 200),
    razon_social: String(raw.razon_social || '').trim().slice(0, 200),
    apellido_paterno: String(raw.apellido_paterno || '').trim().slice(0, 100),
    apellido_materno: String(raw.apellido_materno || '').trim().slice(0, 100),
    nombre_completo: String(raw.nombre_completo || '').trim().slice(0, 300),
    direccion_api: String(raw.direccion_api || raw.direccion || '').trim().slice(0, 500),
    distrito: String(raw.distrito || '').trim().slice(0, 100),
    provincia: String(raw.provincia || '').trim().slice(0, 100),
    departamento: String(raw.departamento || '').trim().slice(0, 100),
    telefono: String(raw.telefono || '').replace(/[^0-9+]/g, '').slice(0, 20),
    email: String(raw.email || '').trim().toLowerCase().slice(0, 150),
    origen: String(raw.origen || 'api').slice(0, 30),
    consultado_en: raw.consultado_en || peruNowSQL()
  };
}

async function consultarDocumentoApi(tipo, numero) {
  const token = String(process.env.MIAPI_TOKEN || '').replace(/\s+/g, '');
  if (!token) throw new Error('El servicio de consulta de documentos no está configurado');
  const base = String(process.env.MIAPI_URL || 'https://miapi.cloud/v1').replace(/\/$/, '');
  const r = await fetch(`${base}/${tipo}/${numero}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error('No se encontró información para ese documento');
  const json = await r.json();
  const d = json.datos || json.data || json;
  if (tipo === 'ruc') {
    return normalizeSnapshot({
      tipo_doc: 'ruc', numero_doc: d.ruc || numero,
      nombre: d.razon_social || '', razon_social: d.razon_social || '',
      nombre_completo: d.razon_social || '',
      direccion_api: d.domiciliado?.direccion || d.direccion || '',
      distrito: d.domiciliado?.distrito || d.distrito || '',
      provincia: d.domiciliado?.provincia || d.provincia || '',
      departamento: d.domiciliado?.departamento || d.departamento || '',
      origen: 'api_ruc'
    });
  }
  return normalizeSnapshot({
    tipo_doc: 'dni', numero_doc: d.dni || numero,
    nombre: d.nombres || '', apellido_paterno: d.ape_paterno || d.apellido_paterno || '',
    apellido_materno: d.ape_materno || d.apellido_materno || '',
    nombre_completo: [d.nombres, d.ape_paterno || d.apellido_paterno, d.ape_materno || d.apellido_materno].filter(Boolean).join(' '),
    direccion_api: d.domiciliado?.direccion || d.direccion || '',
    distrito: d.domiciliado?.distrito || d.distrito || '',
    provincia: d.domiciliado?.provincia || d.provincia || '',
    departamento: d.domiciliado?.departamento || d.departamento || '',
    origen: 'api_dni'
  });
}

async function effectivePrice(conn, product, quantity) {
  let price = Number(product.precio_venta || 0);
  const [[volume]] = await conn.query(`
    SELECT precio_unit FROM precios_volumen
    WHERE producto_id=? AND cantidad_desde<=?
    ORDER BY cantidad_desde DESC LIMIT 1
  `, [product.id, quantity]);
  if (volume) price = Math.min(price, Number(volume.precio_unit));

  const [[rules]] = await conn.query(`SELECT MAX(CASE
      WHEN td.tipo_descuento='monto' THEN LEAST(?,td.monto)
      ELSE ?*LEAST(100,td.porcentaje)/100 END) descuento_monto
    FROM temporada_descuentos td JOIN temporadas t ON t.id=td.temporada_id
    WHERE t.estado=0 AND CURDATE() BETWEEN t.fecha_inicio AND t.fecha_fin AND td.producto_id=?`,[price,price,product.id]);
  const directProductDiscount=Number(product.porcentaje_oferta||0);
  if (directProductDiscount > 0) price *= (1 - Math.min(100,directProductDiscount) / 100);
  else price=Math.max(0,price-Number(rules?.descuento_monto||0));
  return Number(price.toFixed(2));
}

const TiendaController = {
  config: wrap(async (req, res) => {
    const db = getDB();
    const [rows] = await db.query("SELECT clave,valor FROM configuracion WHERE grupo IN ('ecommerce','empresa','pagos') AND clave NOT IN ('mail_pass','miapi_token')");
    const cfg = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
    const [[logo]] = await db.query("SELECT ruta FROM tienda_imagenes WHERE tipo='logo' AND estado=1 LIMIT 1");
    const [sliders] = await db.query("SELECT id,ruta,nombre FROM tienda_imagenes WHERE tipo='slider' AND estado=1 ORDER BY orden ASC,id ASC");
    const [sucursales] = await db.query('SELECT id,nombre,direccion,telefono FROM sucursales WHERE estado=0 ORDER BY nombre');
    const delivery = await DeliveryPricing.publicConfig(db);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const metodos_pago = [];
    if (cfg.yape_activo !== 'false') metodos_pago.push({
      id: 'yape', nombre: 'Yape', numero: cfg.yape_numero || '',
      titular: cfg.yape_titular || '', imagen: cfg.yape_qr_ruta || cfg.yape_imagen_ruta || ''
    });
    if (cfg.plin_activo !== 'false') metodos_pago.push({
      id: 'plin', nombre: 'Plin', numero: cfg.plin_numero || '',
      titular: cfg.plin_titular || '', imagen: cfg.plin_qr_ruta || cfg.plin_imagen_ruta || ''
    });
    if (cfg.transferencia_activo !== 'false') metodos_pago.push({
      id: 'transferencia', nombre: 'Transferencia',
      banco: cfg.transferencia_banco || '', titular: cfg.transferencia_titular || '',
      cuenta: cfg.transferencia_cuenta || '', cci: cfg.transferencia_cci || '',
      imagen: cfg.transferencia_imagen_ruta || ''
    });
    if (cfg.izipay_activo === 'true') metodos_pago.push({
      id: 'izipay', nombre: 'POS Izipay',
      instrucciones: cfg.izipay_instrucciones || '',
      imagen: cfg.izipay_imagen_ruta || ''
    });

    res.json({
      ok: true,
      tienda_activa: cfg.ecommerce_activo === 'true',
      nombre: cfg.tienda_nombre || cfg.empresa_nombre || 'Tienda',
      descripcion: cfg.tienda_descripcion || '',
      logo: logo?.ruta || null,
      whatsapp: cfg.ecommerce_whatsapp || '', facebook: cfg.tienda_facebook || '', instagram: cfg.tienda_instagram || '',
      direccion: cfg.tienda_direccion || cfg.empresa_direccion || '', horario: cfg.tienda_horario || '',
      delivery_activo: cfg.delivery_activo === 'true' && delivery.disponible, recojo_activo: cfg.recojo_activo === 'true',
      delivery_gratis_desde: Number(cfg.delivery_gratis_desde || 0),
      metodos_pago,
      yape_numero: cfg.yape_numero || '', yape_qr_ruta: cfg.yape_qr_ruta || '',
      plin_numero: cfg.plin_numero || '', plin_qr_ruta: cfg.plin_qr_ruta || '',
      transferencia_banco: cfg.transferencia_banco || '', transferencia_cuenta: cfg.transferencia_cuenta || '',
      transferencia_cci: cfg.transferencia_cci || '', transferencia_titular: cfg.transferencia_titular || '',
      sliders, sucursales, delivery, google_client_id: process.env.GOOGLE_CLIENT_ID || ''
    });
  }),

  cotizarDelivery: wrap(async (req,res) => {
    const db=getDB();
    const body=req.body||{};
    const branchIds=Array.isArray(body.sucursal_ids)?body.sucursal_ids:[];
    const quote=await DeliveryPricing.quote(db,{
      subtotal:Number(body.subtotal)||0,
      branchIds,
      location:{lat:body.lat,lng:body.lng}
    });
    res.json({ok:true,quote});
  }),

  productos: wrap(async (req, res) => {
    const db = getDB();
    const { buscar, orden, sucursal } = req.query;
    const seasonAmountExpr = seasonDiscountAmountSql('p');
    let sql = `
      SELECT p.id,p.nombre,p.descripcion,p.marca,p.precio_venta,p.porcentaje_oferta,
             COALESCE((SELECT pi.ruta FROM producto_imagenes pi WHERE pi.producto_id=p.id ORDER BY pi.es_portada DESC,pi.id LIMIT 1),p.imagen) AS imagen,
             p.stock_actual,p.unidad,p.sucursal_id,p.es_transferido,p.producto_origen_id,p.transferencia_venta_habilitada,p.transferencia_venta_web,s.nombre AS sucursal_nombre,
             GREATEST(0,p.stock_actual-COALESCE((SELECT SUM(rw.cantidad) FROM reservas_web rw WHERE rw.producto_id=p.id AND rw.sucursal_id=p.sucursal_id AND rw.estado='activa' AND rw.expires_at>NOW()),0)) AS stock_disponible,
             CASE WHEN p.porcentaje_oferta>0 THEN p.porcentaje_oferta
               WHEN p.precio_venta>0 THEN ROUND((${seasonAmountExpr}/p.precio_venta)*100,2) ELSE 0 END AS descuento_aplicado,
             ROUND(CASE WHEN p.porcentaje_oferta>0
               THEN p.precio_venta*(1-LEAST(100,p.porcentaje_oferta)/100)
               ELSE GREATEST(0,p.precio_venta-${seasonAmountExpr}) END,2) AS precio_final
      FROM productos p LEFT JOIN sucursales s ON s.id=p.sucursal_id
      WHERE p.estado=0 AND p.stock_actual>0
        AND (COALESCE(p.es_transferido,0)=0 OR COALESCE(p.transferencia_venta_web,COALESCE(p.transferencia_venta_habilitada,1))=1)
    `;
    const params = [];
    if (sucursal) { sql += ' AND p.sucursal_id=?'; params.push(Number(sucursal)); }
    if (buscar) { const q=`%${String(buscar).slice(0,80)}%`; sql += ' AND (p.nombre LIKE ? OR p.marca LIKE ? OR p.descripcion LIKE ?)'; params.push(q,q,q); }
    const orders = { precio_asc:'precio_final ASC', precio_desc:'precio_final DESC', nombre:'p.nombre ASC' };
    sql += ` ORDER BY ${orders[orden] || 'p.id DESC'} LIMIT 200`;
    const [rows] = await db.query(sql, params);
    const disponibles = rows.filter(r => Number(r.stock_disponible) > 0);
    // En el catálogo general no se repite el mismo artículo por cada traslado.
    // Se prioriza su registro nativo; si solo existe transferido, se conserva el de mayor stock.
    let productos = disponibles;
    if (!sucursal) {
      const unicos = new Map();
      for (const row of disponibles) {
        const key = `${String(row.nombre||'').trim().toLowerCase()}|${String(row.marca||'').trim().toLowerCase()}`;
        const actual = unicos.get(key);
        if (!actual || (Number(actual.es_transferido) === 1 && Number(row.es_transferido) === 0) ||
            (Number(actual.es_transferido) === Number(row.es_transferido) && Number(row.stock_disponible) > Number(actual.stock_disponible))) {
          unicos.set(key, row);
        }
      }
      productos = [...unicos.values()];
    }
    res.json({ ok: true, productos });
  }),

  precioProducto: wrap(async (req, res) => {
    const db = getDB();
    const id = Number(req.params.id);
    const cantidad = Number(req.query.cantidad || 1);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000) {
      return res.status(400).json({ ok:false, msg:'Cantidad inválida' });
    }
    const [[p]] = await db.query(`SELECT id,nombre,precio_costo,precio_venta,porcentaje_oferta,stock_actual,sucursal_id,
      es_transferido,transferencia_venta_habilitada,transferencia_venta_web
      FROM productos WHERE id=? AND estado=0`, [id]);
    if (!p || !p.sucursal_id) return res.status(404).json({ ok:false, msg:'Producto no disponible' });
    if (Number(p.es_transferido)===1 && Number(p.transferencia_venta_web)!==1) {
      return res.status(409).json({ ok:false, msg:'Este producto no está habilitado para la tienda web' });
    }
    const [[reserved]] = await db.query("SELECT COALESCE(SUM(cantidad),0) qty FROM reservas_web WHERE producto_id=? AND sucursal_id=? AND estado='activa' AND expires_at>NOW()", [id,p.sucursal_id]);
    const stock = Math.max(0, Number(p.stock_actual||0)-Number(reserved?.qty||0));
    if (cantidad > stock) return res.status(409).json({ ok:false, msg:`Stock disponible: ${stock}`, stock_disponible:stock });
    const precio = await effectivePrice(db,p,cantidad);
    const [tiers] = await db.query('SELECT cantidad_desde,precio_unit FROM precios_volumen WHERE producto_id=? ORDER BY cantidad_desde ASC', [id]);
    const aplicada = [...tiers].reverse().find(t => cantidad >= Number(t.cantidad_desde)) || null;
    res.json({ ok:true, producto_id:id, cantidad, precio_unit:Number(precio), subtotal:Number((precio*cantidad).toFixed(2)), stock_disponible:stock,
      precio_normal:Number(p.precio_venta||0), volumen_aplicado:aplicada ? { cantidad_minima:Number(aplicada.cantidad_desde), precio_unit:Number(aplicada.precio_unit) } : null,
      volumenes:tiers.map(t=>({cantidad_minima:Number(t.cantidad_desde),precio_unit:Number(t.precio_unit)})) });
  }),

  producto: wrap(async (req, res) => {
    const db = getDB();
    const [[p]] = await db.query(`SELECT p.id,p.nombre,p.descripcion,p.marca,p.precio_venta,p.precio_costo,p.porcentaje_oferta,p.stock_actual,p.unidad,p.sucursal_id,p.es_transferido,p.transferencia_venta_web,s.nombre AS sucursal_nombre FROM productos p LEFT JOIN sucursales s ON s.id=p.sucursal_id WHERE p.id=? AND p.estado=0 AND (COALESCE(p.es_transferido,0)=0 OR COALESCE(p.transferencia_venta_web,COALESCE(p.transferencia_venta_habilitada,1))=1)`, [Number(req.params.id)]);
    if (!p || !p.sucursal_id) return res.status(404).json({ ok: false, msg: 'Producto no disponible' });
    const [[reserved]] = await db.query("SELECT COALESCE(SUM(cantidad),0) qty FROM reservas_web WHERE producto_id=? AND sucursal_id=? AND estado='activa' AND expires_at>NOW()", [p.id,p.sucursal_id]);
    p.stock_disponible = Math.max(0, Number(p.stock_actual)-Number(reserved.qty||0));
    if (p.stock_disponible <= 0) return res.status(404).json({ok:false,msg:'Producto sin stock disponible'});
    p.precio_final = await effectivePrice(db,p,1);
    p.descuento_aplicado = Number(p.precio_venta || 0) > 0
      ? Number((((Number(p.precio_venta) - Number(p.precio_final)) / Number(p.precio_venta)) * 100).toFixed(2))
      : 0;
    p.ahorro = Number(Math.max(0, Number(p.precio_venta || 0) - Number(p.precio_final || 0)).toFixed(2));
    delete p.precio_costo;
    const [imagenes] = await db.query('SELECT ruta FROM producto_imagenes WHERE producto_id=? ORDER BY es_portada DESC,id ASC', [p.id]);
    const [volumenes] = await db.query('SELECT cantidad_desde,precio_unit FROM precios_volumen WHERE producto_id=? ORDER BY cantidad_desde', [p.id]);
    p.imagen = imagenes[0]?.ruta || null;
    res.json({ ok: true, producto: p, imagenes, volumenes });
  }),

  recojoHorarios: wrap(async (req,res) => {
    const ids=String(req.query.sucursales||'').split(',').map(Number).filter(Number.isInteger).filter(x=>x>0).slice(0,20);
    if(!ids.length)return res.json({ok:true,horarios:[]});
    const db=getDB();
    const placeholders=ids.map(()=>'?').join(',');
    const [rows]=await db.query(`
      SELECT rf.id,rf.sucursal_id,DATE_FORMAT(rf.fecha,'%Y-%m-%d') fecha,
             TIME_FORMAT(rf.hora_inicio,'%H:%i') hora_inicio,TIME_FORMAT(rf.hora_fin,'%H:%i') hora_fin,
             rf.cupos_total,rf.cupos_usados,(rf.cupos_total-rf.cupos_usados) disponibles,s.nombre sucursal_nombre
      FROM recojo_fechas rf JOIN sucursales s ON s.id=rf.sucursal_id
      WHERE rf.estado=0 AND (rf.fecha>CURDATE() OR (rf.fecha=CURDATE() AND rf.hora_fin>CURTIME())) AND rf.sucursal_id IN (${placeholders})
        AND rf.cupos_usados<rf.cupos_total
      ORDER BY rf.sucursal_id,rf.fecha,rf.hora_inicio LIMIT 250`,ids);
    res.json({ok:true,horarios:rows});
  }),

  consultarDocumento: wrap(async (req, res) => {
    const tipo = String(req.query.tipo || 'dni').toLowerCase();
    const numero = String(req.query.doc || '').replace(/\D/g, '');
    if (!['dni','ruc'].includes(tipo) || numero.length !== (tipo === 'dni' ? 8 : 11)) {
      return res.status(400).json({ ok: false, msg: 'Documento inválido' });
    }
    const db = getDB();
    const existing = await ClienteModel.getByDoc(numero);
    let snapshot = null;
    let apiError = null;

    // Primero el registro de clientes: si el documento ya está registrado y
    // activo se usan sus datos (incluidos teléfono y correo) sin gastar una
    // consulta a MiAPI. Solo si no existe se consulta la API.
    const nombreBd = existing ? (existing.razon_social || [existing.nombre,existing.apellido_paterno,existing.apellido_materno].filter(Boolean).join(' ')).trim() : '';
    if (existing && Number(existing.activo) !== 2 && nombreBd) {
      snapshot = normalizeSnapshot({ ...existing, nombre_completo: nombreBd, origen: 'cliente_erp' });
    } else {
      try {
        snapshot = await consultarDocumentoApi(tipo, numero);
      } catch (error) {
        apiError = error;
      }
    }
    if (!snapshot) throw apiError || new Error('No se pudo validar el documento');

    req.session.documentoWeb = { snapshot, verifiedAt: Date.now() };
    res.json({ ok: true, cliente: snapshot });
  }),

  crearPedido: wrap(async (req, res) => {
    const cw = req.session.clienteWeb;
    const body = req.body || {};
    const db = getDB();
    if (!Array.isArray(body.items) || !body.items.length) return res.status(400).json({ ok:false,msg:'El carrito está vacío' });
    if (!['delivery','recojo'].includes(body.tipo_entrega)) return res.status(400).json({ ok:false,msg:'Selecciona el tipo de entrega' });
    const paymentMethod = String(body.metodo_pago || '').toLowerCase();
    if (!WEB_PAYMENT_METHODS.has(paymentMethod)) return res.status(400).json({ ok:false,msg:'Método de pago web inválido' });
    const [paymentRows] = await db.query(
      `SELECT clave,valor FROM configuracion
       WHERE clave IN ('yape_activo','plin_activo','transferencia_activo','izipay_activo')`
    );
    const paymentCfg = Object.fromEntries(paymentRows.map(r => [r.clave, String(r.valor)]));
    const enabled = {
      yape: paymentCfg.yape_activo !== 'false',
      plin: paymentCfg.plin_activo !== 'false',
      transferencia: paymentCfg.transferencia_activo !== 'false',
      izipay: paymentCfg.izipay_activo === 'true'
    };
    if (!enabled[paymentMethod]) return res.status(400).json({ ok:false,msg:'El método de pago seleccionado ya no está disponible' });
    const operationCode = normalizeOperationReference(body.codigo_operacion);
    if (operationCode && (!/^[A-Za-z0-9._\- ]{3,100}$/.test(operationCode)))
      return res.status(400).json({ ok:false,msg:'El número o código de operación tiene un formato inválido' });
    const verified = req.session.documentoWeb;
    if (!verified || Date.now() - Number(verified.verifiedAt || 0) > 30*60*1000) return res.status(400).json({ ok:false,msg:'Consulta y confirma nuevamente el DNI o RUC' });

    const purchaserEmail = String(body.email || '').trim().toLowerCase().slice(0, 150);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(purchaserEmail)) {
      return res.status(400).json({ ok:false,msg:'Ingresa el correo obligatorio del comprador' });
    }
    const snap = normalizeSnapshot({
      ...verified.snapshot,
      telefono: body.telefono || verified.snapshot.telefono,
      email: purchaserEmail
    });
    if (String(body.numero_doc || snap.numero_doc) !== snap.numero_doc) return res.status(400).json({ ok:false,msg:'El documento confirmado no coincide' });
    const dir = {
      departamento: String(body.departamento || snap.departamento || '').slice(0,100), provincia: String(body.provincia || snap.provincia || '').slice(0,100),
      distrito: String(body.distrito || snap.distrito || '').slice(0,100), direccion: String(body.direccion_entrega || '').trim().slice(0,500),
      referencia: String(body.referencia || '').trim().slice(0,300), lat: Number(body.lat) || null, lng: Number(body.lng) || null,
      recibe: String(body.persona_recibe || snap.nombre_completo || snap.nombre).slice(0,200)
    };
    if (body.tipo_entrega === 'delivery' && !dir.direccion) return res.status(400).json({ ok:false,msg:'Ingresa la dirección de entrega' });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const ids = [...new Set(body.items.map(x => Number(x.producto_id)).filter(Number.isInteger))].sort((a,b)=>a-b);
      if (!ids.length || ids.length > 100) throw new Error('Carrito inválido');

      let subtotal = 0;
      const valid = [];
      for (const id of ids) {
        const original = body.items.find(x => Number(x.producto_id) === id);
        const quantity = Number(original.cantidad);
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10000) throw new Error('Cantidad inválida');
        const [[p]] = await conn.query('SELECT id,nombre,precio_costo,precio_venta,porcentaje_oferta,stock_actual,sucursal_id,es_transferido,transferencia_venta_habilitada,transferencia_venta_web FROM productos WHERE id=? AND estado=0 FOR UPDATE', [id]);
        if (!p || !p.sucursal_id) throw new Error('Uno de los productos no está disponible');
        if (Number(p.es_transferido)===1 && Number(p.transferencia_venta_web)!==1) throw new Error(`El producto transferido "${p.nombre}" está bloqueado para venta`);
        const [[reserved]] = await conn.query("SELECT COALESCE(SUM(cantidad),0) AS qty FROM reservas_web WHERE producto_id=? AND sucursal_id=? AND estado='activa' AND expires_at>NOW()", [id,p.sucursal_id]);
        const available = Number(p.stock_actual) - Number(reserved.qty || 0);
        if (quantity > available) throw new Error(`Stock disponible insuficiente para ${p.nombre}. Disponible: ${available}`);
        const price = await effectivePrice(conn,p,quantity);
        const itemSubtotal = Number((price*quantity).toFixed(2));
        subtotal += itemSubtotal;
        valid.push({ producto_id:id,cantidad:quantity,precio_unit:price,subtotal:itemSubtotal,sucursal_id:p.sucursal_id,costo:Number(p.precio_costo||0),nombre:p.nombre });
      }
      subtotal = Number(subtotal.toFixed(2));
      const branches = [...new Set(valid.map(x=>Number(x.sucursal_id)))];
      const totalUnits = valid.reduce((sum,item)=>sum+Number(item.cantidad||0),0);
      const deliveryQuote = body.tipo_entrega === 'delivery'
        ? await DeliveryPricing.quote(conn,{subtotal,branchIds:branches,location:dir})
        : { total:0, tariff_id:null, tariff_name:'Recojo en tienda', base:0, per_unit:0, units:totalUnits, extra_units:0, free_from:0, free:true };
      // Sin ubicación marcada o fuera de las zonas no se puede cobrar el envío.
      if (body.tipo_entrega === 'delivery' && deliveryQuote.covered === false) {
        throw new Error(deliveryQuote.description || 'No hay cobertura de delivery para esa ubicación');
      }
      const costoDelivery = Number(deliveryQuote.total || 0);
      const totalPedido = Number((subtotal + costoDelivery).toFixed(2));
      const pickupSlots=[];
      if(body.tipo_entrega==='recojo'){
        const requested=body.recojo_horarios&&typeof body.recojo_horarios==='object'?body.recojo_horarios:{};
        for(const branch of branches){
          const horarioId=Number(requested[String(branch)]||requested[branch]);
          if(!Number.isInteger(horarioId)||horarioId<=0)throw new Error('Selecciona un horario de recojo para cada sucursal');
          const [[slot]]=await conn.query(`SELECT * FROM recojo_fechas WHERE id=? AND sucursal_id=? AND estado=0 AND (fecha>CURDATE() OR (fecha=CURDATE() AND hora_fin>CURTIME())) FOR UPDATE`,[horarioId,branch]);
          if(!slot)throw new Error('Uno de los horarios de recojo ya no está disponible. Elige otro horario.');
          if(Number(slot.cupos_usados)>=Number(slot.cupos_total))throw new Error('Uno de los horarios de recojo ya no tiene cupos');
          pickupSlots.push({branch,horarioId});
        }
      }
      const minutes = Math.max(5,Number(process.env.RESERVA_WEB_MINUTES||30));
      const [[mx]] = await conn.query('SELECT COALESCE(MAX(id),0)+1 AS n FROM pedidos_web FOR UPDATE');
      const numero = `WEB-${String(mx.n).padStart(6,'0')}`;
      const [r] = await conn.query(`
        INSERT INTO pedidos_web
          (numero_orden,cliente_web_id,tipo_entrega,direccion_entrega,subtotal,igv,total,costo_delivery,metodo_pago,codigo_operacion,
           estado_pago,estado_pedido,sucursal_id,estado,created_at,cliente_snapshot,direccion_snapshot,facturacion_snapshot,
           es_multisucursal,reserva_expires_at)
        VALUES (?,?,?,?,?,0,?,?,?,?,'pendiente','pendiente',?,0,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? MINUTE))
      `, [numero,cw.id,body.tipo_entrega,dir.direccion,subtotal,totalPedido,costoDelivery,paymentMethod,operationCode.slice(0,100),
          branches.length===1?branches[0]:null,peruNowSQL(),JSON.stringify(snap),JSON.stringify(dir),JSON.stringify({
            solicitar_factura: !!body.solicitar_factura,
            comentario_facturacion: String(body.comentario_facturacion || '').trim().slice(0, 500),
            delivery: deliveryQuote,
            email: purchaserEmail,
            cuenta_google_email: cw.email || ''
          }),branches.length>1?1:0,minutes]);
      if (operationCode) {
        try {
          await conn.query(
            'INSERT INTO pagos_operaciones_unicas (metodo,referencia,pedido_web_id) VALUES (?,?,?)',
            [paymentMethod, operationCode, r.insertId]
          );
        } catch (error) {
          if (error.code === 'ER_DUP_ENTRY') {
            throw new Error(`El código de operación ${operationCode} ya fue registrado para ${paymentMethod.toUpperCase()}`);
          }
          throw error;
        }
      }
      for (const item of valid) {
        await conn.query(`INSERT INTO pedido_items (pedido_id,producto_id,presentacion_id,cantidad,precio_unit,subtotal,sucursal_id,costo_unitario_snapshot,nombre_snapshot) VALUES (?,?,NULL,?,?,?,?,?,?)`,
          [r.insertId,item.producto_id,item.cantidad,item.precio_unit,item.subtotal,item.sucursal_id,item.costo,item.nombre]);
        await conn.query(`INSERT INTO reservas_web (pedido_id,producto_id,sucursal_id,cantidad,expires_at) VALUES (?,?,?,?,DATE_ADD(NOW(),INTERVAL ? MINUTE))`,
          [r.insertId,item.producto_id,item.sucursal_id,item.cantidad,minutes]);
      }
      for(const slot of pickupSlots){
        const [up]=await conn.query('UPDATE recojo_fechas SET cupos_usados=cupos_usados+1 WHERE id=? AND cupos_usados<cupos_total',[slot.horarioId]);
        if(!up.affectedRows)throw new Error('Uno de los horarios de recojo acaba de llenarse');
        await conn.query(`INSERT INTO pedido_recojo_reservas (pedido_id,sucursal_id,horario_id,estado) VALUES (?,?,?,'reservado')`,[r.insertId,slot.branch,slot.horarioId]);
      }
      if(pickupSlots.length===1)await conn.query('UPDATE pedidos_web SET recojo_fecha_id=? WHERE id=?',[pickupSlots[0].horarioId,r.insertId]);
      await conn.commit();
      delete req.session.documentoWeb;
      await Audit.log(req,{accion:'pedido_web_creado',modulo:'ecommerce',entidad:'pedidos_web',entidad_id:r.insertId,datos:{numero,multisucursal:branches.length>1}});
      res.status(201).json({ok:true,msg:'Pedido registrado. Tu stock quedó reservado temporalmente.',numero_orden:numero,pedido_id:r.insertId,total:totalPedido,costo_delivery:costoDelivery,reserva_minutos:minutes,multisucursal:branches.length>1});
    } catch(error) {
      await conn.rollback();
      res.status(400).json({ok:false,msg:error.message||'No se pudo registrar el pedido'});
    } finally { conn.release(); }
  }),

  subirVoucher: wrap(async (req,res) => {
    if (!req.file?.privatePath) return res.status(400).json({ok:false,msg:'No se recibió una imagen válida'});
    const db=getDB();
    const [r]=await db.query("UPDATE pedidos_web SET comprobante_cliente=?,imagen_voucher=?,updated_at=NOW() WHERE id=? AND cliente_web_id=? AND estado_pago IN ('pendiente','observado')", [req.file.privatePath,req.file.privatePath,Number(req.params.id),req.session.clienteWeb.id]);
    if(!r.affectedRows) return res.status(404).json({ok:false,msg:'Pedido no encontrado o ya procesado'});
    await Audit.log(req,{accion:'voucher_cliente_subido',modulo:'ecommerce',entidad:'pedidos_web',entidad_id:req.params.id});
    res.json({ok:true,msg:'Imagen de pago guardada'});
  }),

  misPedidos: wrap(async (req,res) => {
    const db=getDB();
    const [rows]=await db.query(`SELECT id,numero_orden,tipo_entrega,total,metodo_pago,estado_pago,estado_pedido,venta_id,es_multisucursal,reserva_expires_at,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') created_at FROM pedidos_web WHERE cliente_web_id=? ORDER BY id DESC LIMIT 50`,[req.session.clienteWeb.id]);
    res.json({ok:true,pedidos:rows});
  }),

  miPedido: wrap(async (req,res) => {
    const db=getDB();
    const [[pedido]]=await db.query('SELECT id,numero_orden,tipo_entrega,total,metodo_pago,estado_pago,estado_pedido,venta_id,es_multisucursal,cliente_snapshot,direccion_snapshot,rechazo_motivo,reserva_expires_at,created_at FROM pedidos_web WHERE id=? AND cliente_web_id=?',[Number(req.params.id),req.session.clienteWeb.id]);
    if(!pedido) return res.status(404).json({ok:false,msg:'Pedido no encontrado'});
    const [items]=await db.query(`SELECT pi.producto_id,pi.cantidad,pi.precio_unit,pi.subtotal,pi.sucursal_id,pi.nombre_snapshot,p.imagen,s.nombre sucursal_nombre FROM pedido_items pi LEFT JOIN productos p ON p.id=pi.producto_id LEFT JOIN sucursales s ON s.id=pi.sucursal_id WHERE pi.pedido_id=?`,[pedido.id]);
    const [entregas]=await db.query(`SELECT pes.id,pes.sucursal_id,s.nombre sucursal_nombre,pes.tipo_entrega,pes.estado,pes.codigo_recojo_enc,pes.codigo_usado_at FROM pedido_entregas_sucursal pes JOIN sucursales s ON s.id=pes.sucursal_id WHERE pes.pedido_id=?`,[pedido.id]);
    for(const e of entregas){ if(e.codigo_recojo_enc && !e.codigo_usado_at){ try{e.codigo_recojo=Crypto.decrypt(e.codigo_recojo_enc);}catch(_){e.codigo_recojo=null;} } delete e.codigo_recojo_enc; }
    res.json({ok:true,pedido,items,entregas});
  }),

  listarDirecciones: wrap(async(req,res)=>res.json({ok:true,direcciones:await ClienteWebModel.listarDirecciones(req.session.clienteWeb.id)})),
  crearDireccion: wrap(async(req,res)=>res.json({ok:true,id:await ClienteWebModel.crearDireccion(req.session.clienteWeb.id,req.body)})),
  eliminarDireccion: wrap(async(req,res)=>{await ClienteWebModel.eliminarDireccion(req.session.clienteWeb.id,Number(req.params.id));res.json({ok:true});})
};

module.exports = TiendaController;
