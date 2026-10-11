const path = require('path');
const fs = require('fs');
const { wrap } = require('../helpers/response');
const { getDB } = require('../config/database');
const { hasPermission, userScope, hasGlobalScope } = require('../middleware/permisos');
const Crypto = require('../services/CryptoService');
const Audit = require('../services/AuditService');
const Mail = require('../services/MailService');

function httpError(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseJSON(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function fullName(snapshot = {}) {
  return snapshot.razon_social || snapshot.nombre_completo ||
    [snapshot.nombre, snapshot.apellido_paterno, snapshot.apellido_materno].filter(Boolean).join(' ') || 'Cliente web';
}

async function canProcess(req, pedido, branchIds) {
  if (Number(pedido.es_multisucursal) === 1 || branchIds.length > 1) {
    return hasGlobalScope(req, 'pedidos_web.aprobar_multisucursal');
  }
  if (await hasGlobalScope(req, 'pedidos_web.aprobar_multisucursal')) return true;
  const scope = userScope(req);
  return (await hasPermission(req, 'pedidos_web.aprobar_sucursal')) &&
    Number(scope.sucursalId) === Number(branchIds[0]);
}

async function canView(req, pedido, branchIds) {
  if (await hasGlobalScope(req, 'pedidos_web.aprobar_multisucursal')) return true;
  const scope = userScope(req);
  if (!scope.sucursalId || !branchIds.includes(Number(scope.sucursalId))) return false;
  return Number(pedido.es_multisucursal) === 0 || pedido.estado_pago === 'aprobado';
}


function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized) return normalized;
  }
  return '';
}

function normalizeApprovedClient(clientSnapshot = {}, addressSnapshot = {}, billingSnapshot = {}, pedido = {}) {
  const client = parseJSON(clientSnapshot);
  const address = parseJSON(addressSnapshot);
  const billing = parseJSON(billingSnapshot);

  const razonSocial = firstNonEmpty(client.razon_social, billing.razon_social);
  const nombre = firstNonEmpty(client.nombre, client.nombres, razonSocial ? '' : client.nombre_completo);
  const apellidoPaterno = firstNonEmpty(client.apellido_paterno, client.apellidoPaterno);
  const apellidoMaterno = firstNonEmpty(client.apellido_materno, client.apellidoMaterno);
  const nombreCompleto = firstNonEmpty(
    client.nombre_completo,
    razonSocial,
    [nombre, apellidoPaterno, apellidoMaterno].filter(Boolean).join(' '),
    pedido.cuenta_nombre
  );

  return {
    ...client,
    tipo_doc: firstNonEmpty(client.tipo_doc, billing.tipo_doc, 'dni').toLowerCase(),
    numero_doc: firstNonEmpty(client.numero_doc, billing.numero_doc, pedido.cliente_doc),
    nombre: nombre || (razonSocial ? razonSocial : nombreCompleto),
    nombres: firstNonEmpty(client.nombres, nombre),
    apellido_paterno: apellidoPaterno,
    apellido_materno: apellidoMaterno,
    razon_social: razonSocial,
    nombre_completo: nombreCompleto,
    telefono: firstNonEmpty(client.telefono, address.telefono, pedido.telefono),
    email: firstNonEmpty(client.email, billing.email, pedido.cuenta_email),
    direccion_api: firstNonEmpty(
      client.direccion_api,
      client.direccion,
      address.direccion,
      address.direccion_entrega,
      pedido.direccion_entrega
    ),
    direccion_entrega: firstNonEmpty(address.direccion, address.direccion_entrega, pedido.direccion_entrega),
    referencia: firstNonEmpty(address.referencia),
    distrito: firstNonEmpty(address.distrito, client.distrito),
    provincia: firstNonEmpty(address.provincia, client.provincia),
    departamento: firstNonEmpty(address.departamento, client.departamento),
    lat: Number(address.lat) || null,
    lng: Number(address.lng) || null,
    receptor: firstNonEmpty(address.recibe, address.nombre_receptor, nombreCompleto)
  };
}

async function getClientColumns(conn) {
  const [rows] = await conn.query('SHOW COLUMNS FROM clientes');
  return new Set(rows.map(row => String(row.Field || row.field || '')));
}

function pushInsertField(columns, names, values, field, value) {
  if (!columns.has(field)) return;
  names.push(`\`${field}\``);
  values.push(value);
}

async function createOrReuseClient(conn, snapshot, userId, branchId) {
  const columns = await getClientColumns(conn);
  if (!columns.has('numero_doc')) throw httpError('La tabla clientes no contiene el campo numero_doc', 500);

  // Se reutiliza incluso un cliente eliminado lógicamente y se reactiva.
  // Así un pedido web no intenta crear un documento duplicado.
  const [[existing]] = await conn.query(
    'SELECT id FROM clientes WHERE numero_doc=? LIMIT 1 FOR UPDATE',
    [snapshot.numero_doc]
  );

  const encrypted = {
    direccion_enc: columns.has('direccion_enc') && snapshot.direccion_api ? Crypto.encrypt(snapshot.direccion_api) : '',
    distrito_enc: columns.has('distrito_enc') && snapshot.distrito ? Crypto.encrypt(snapshot.distrito) : '',
    provincia_enc: columns.has('provincia_enc') && snapshot.provincia ? Crypto.encrypt(snapshot.provincia) : '',
    departamento_enc: columns.has('departamento_enc') && snapshot.departamento ? Crypto.encrypt(snapshot.departamento) : ''
  };

  if (existing) {
    const assignments = [];
    const params = [];

    const fillIfEmpty = (field, value) => {
      if (!columns.has(field) || !clean(value)) return;
      assignments.push(`\`${field}\`=IF(COALESCE(\`${field}\`,'')='',?,\`${field}\`)`);
      params.push(value);
    };

    if (columns.has('activo')) assignments.push('`activo`=1');
    fillIfEmpty('nombre', snapshot.nombre);
    fillIfEmpty('razon_social', snapshot.razon_social);
    fillIfEmpty('apellido_paterno', snapshot.apellido_paterno);
    fillIfEmpty('apellido_materno', snapshot.apellido_materno);
    fillIfEmpty('telefono', snapshot.telefono);
    fillIfEmpty('email', snapshot.email);
    fillIfEmpty('direccion', snapshot.direccion_api);
    fillIfEmpty('distrito', snapshot.distrito);
    fillIfEmpty('provincia', snapshot.provincia);
    fillIfEmpty('departamento', snapshot.departamento);
    fillIfEmpty('direccion_enc', encrypted.direccion_enc);
    fillIfEmpty('distrito_enc', encrypted.distrito_enc);
    fillIfEmpty('provincia_enc', encrypted.provincia_enc);
    fillIfEmpty('departamento_enc', encrypted.departamento_enc);
    if (columns.has('updated_at')) assignments.push('`updated_at`=NOW()');

    if (assignments.length) {
      params.push(existing.id);
      await conn.query(`UPDATE clientes SET ${assignments.join(', ')} WHERE id=?`, params);
    }
    return existing.id;
  }

  const names = [];
  const values = [];
  pushInsertField(columns, names, values, 'tipo_doc', snapshot.tipo_doc || 'dni');
  pushInsertField(columns, names, values, 'numero_doc', snapshot.numero_doc);
  pushInsertField(columns, names, values, 'nombre', snapshot.nombre || snapshot.razon_social || snapshot.nombre_completo || '');
  pushInsertField(columns, names, values, 'razon_social', snapshot.razon_social || '');
  pushInsertField(columns, names, values, 'apellido_paterno', snapshot.apellido_paterno || '');
  pushInsertField(columns, names, values, 'apellido_materno', snapshot.apellido_materno || '');
  pushInsertField(columns, names, values, 'telefono', snapshot.telefono || '');
  pushInsertField(columns, names, values, 'email', snapshot.email || '');
  pushInsertField(columns, names, values, 'direccion', snapshot.direccion_api || '');
  pushInsertField(columns, names, values, 'distrito', snapshot.distrito || '');
  pushInsertField(columns, names, values, 'provincia', snapshot.provincia || '');
  pushInsertField(columns, names, values, 'departamento', snapshot.departamento || '');
  pushInsertField(columns, names, values, 'direccion_enc', encrypted.direccion_enc);
  pushInsertField(columns, names, values, 'distrito_enc', encrypted.distrito_enc);
  pushInsertField(columns, names, values, 'provincia_enc', encrypted.provincia_enc);
  pushInsertField(columns, names, values, 'departamento_enc', encrypted.departamento_enc);
  pushInsertField(columns, names, values, 'tipo_cliente', 'minorista');
  pushInsertField(columns, names, values, 'sucursal_registro_id', branchId || null);
  pushInsertField(columns, names, values, 'usuario_registro_id', userId);
  pushInsertField(columns, names, values, 'origen_api', 1);
  pushInsertField(columns, names, values, 'activo', 1);

  const placeholders = names.map(() => '?').join(',');
  const [result] = await conn.query(
    `INSERT INTO clientes (${names.join(',')}) VALUES (${placeholders})`,
    values
  );
  return result.insertId;
}

async function nextSaleNumber(conn) {
  let [[serie]] = await conn.query(`
    SELECT id,serie,ultimo_numero
    FROM series_comprobante
    WHERE tipo='nota_venta' AND estado=0
    ORDER BY id LIMIT 1 FOR UPDATE
  `);
  if (!serie) {
    const [r] = await conn.query(
      "INSERT INTO series_comprobante (tipo,serie,ultimo_numero,estado) VALUES ('nota_venta','NV01',0,0)"
    );
    serie = { id: r.insertId, serie: 'NV01', ultimo_numero: 0 };
  }
  const next = Number(serie.ultimo_numero || 0) + 1;
  await conn.query('UPDATE series_comprobante SET ultimo_numero=? WHERE id=?', [next, serie.id]);
  return { serie: serie.serie, numero: `${serie.serie}-${String(next).padStart(6, '0')}` };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}


async function asegurarCodigosEntrega(pedidoId, executor = null) {
  const db = executor || getDB();
  const [rows] = await db.query(`
    SELECT pes.id,pes.pedido_id,pes.sucursal_id,pes.tipo_entrega,pes.estado,
           pes.codigo_recojo_hash,pes.codigo_recojo_enc,pes.codigo_usado_at,
           s.nombre AS sucursal_nombre,s.direccion
    FROM pedido_entregas_sucursal pes
    JOIN sucursales s ON s.id=pes.sucursal_id
    WHERE pes.pedido_id=?
    ORDER BY s.nombre,pes.id
  `,[pedidoId]);

  for (const row of rows) {
    let codigo = null;
    if (row.codigo_recojo_enc) {
      try { codigo = Crypto.decrypt(row.codigo_recojo_enc); } catch (_) {}
    }
    if (!codigo && !row.codigo_usado_at) {
      for (let tries=0; tries<12; tries++) {
        const candidate = Crypto.randomPickupCode();
        const hash = Crypto.hash(candidate);
        const [[exists]] = await db.query(
          'SELECT id FROM pedido_entregas_sucursal WHERE codigo_recojo_hash=? LIMIT 1',
          [hash]
        );
        if (exists) continue;
        const [updated] = await db.query(`
          UPDATE pedido_entregas_sucursal
          SET codigo_recojo_hash=?,codigo_recojo_enc=?,codigo_generado_at=NOW(),updated_at=NOW()
          WHERE id=? AND codigo_recojo_hash IS NULL
        `,[hash,Crypto.encrypt(candidate),row.id]);
        if (updated.affectedRows) { codigo = candidate; break; }
      }
      if (!codigo) throw httpError('No se pudo generar el código de entrega',500);
    }
    row.codigo = codigo;
    delete row.codigo_recojo_hash;
    delete row.codigo_recojo_enc;
  }
  return rows;
}

function pickupEmail({ pedido, ventaNumero, customerName, deliveries }) {
  const sections = deliveries.map(d => `
    <div style="border:1px solid #dbeafe;border-radius:12px;padding:16px;margin:12px 0">
      <div style="font-weight:700;color:#0f172a">${escapeHtml(d.sucursal_nombre)}</div>
      <div style="font-size:13px;color:#475569;margin-top:4px">${escapeHtml(d.direccion || '')}</div>
      ${d.fecha ? `<div style="font-size:13px;color:#334155;margin-top:6px">Horario: <strong>${escapeHtml(String(d.fecha).slice(0,10))} ${escapeHtml(String(d.hora_inicio||'').slice(0,5))}–${escapeHtml(String(d.hora_fin||'').slice(0,5))}</strong></div>` : ''}
      ${d.codigo ? `<div style="font-size:12px;color:#475569;margin-top:10px">${d.tipo_entrega === 'delivery' ? 'Código de entrega y seguimiento' : 'Código de recojo'}</div><div style="font-size:30px;letter-spacing:5px;font-weight:800;text-align:center;background:#f1f5f9;border-radius:10px;padding:16px;margin-top:6px">${escapeHtml(d.codigo)}</div><div style="font-size:12px;color:#64748b;text-align:center;margin-top:7px">${d.tipo_entrega === 'delivery' ? 'Conserva este código como referencia de la entrega.' : 'Muestra este código y tu documento en el local.'}</div>` : ''}
      ${d.tipo_entrega === 'delivery' ? `<div style="margin-top:10px;color:#475569">Esta parte del pedido será enviada por delivery.</div>` : ''}
    </div>`).join('');
  return `<div style="font-family:Arial;max-width:620px;margin:auto;color:#1e293b">
    <h2 style="color:#16a34a">Tu pedido fue aprobado</h2>
    <p>Hola <strong>${escapeHtml(customerName)}</strong>.</p>
    <p>El pago del pedido <strong>${escapeHtml(pedido.numero_orden)}</strong> fue aprobado y se generó la nota de venta <strong>${escapeHtml(ventaNumero)}</strong>.</p>
    ${sections}
    <p style="font-size:12px;color:#64748b">No compartas los códigos de entrega o recojo. Cada código pertenece a una sola sucursal.</p>
  </div>`;
}

async function sendApprovalMail(pedidoId) {
  const db = getDB();
  const [[p]] = await db.query(`
    SELECT pw.*,cw.email AS cuenta_email,cw.nombre AS cuenta_nombre,v.numero AS venta_numero
    FROM pedidos_web pw
    JOIN clientes_web cw ON cw.id=pw.cliente_web_id
    LEFT JOIN ventas v ON v.id=pw.venta_id
    WHERE pw.id=?
  `, [pedidoId]);
  const clientSnapshot = parseJSON(p?.cliente_snapshot);
  const billingSnapshot = parseJSON(p?.facturacion_snapshot);
  const recipientEmail = firstNonEmpty(clientSnapshot.email, billingSnapshot.email, p?.cuenta_email);
  if (!recipientEmail) return false;
  await asegurarCodigosEntrega(pedidoId);
  const [deliveries] = await db.query(`
    SELECT pes.codigo_recojo_enc,pes.tipo_entrega,s.nombre AS sucursal_nombre,s.direccion,
           rf.fecha,rf.hora_inicio,rf.hora_fin
    FROM pedido_entregas_sucursal pes
    JOIN sucursales s ON s.id=pes.sucursal_id
    LEFT JOIN pedido_recojo_reservas prr ON prr.pedido_id=pes.pedido_id AND prr.sucursal_id=pes.sucursal_id AND prr.estado IN ('reservado','confirmado','utilizado')
    LEFT JOIN recojo_fechas rf ON rf.id=prr.horario_id
    WHERE pes.pedido_id=? ORDER BY s.nombre
  `, [pedidoId]);
  const decoded = deliveries.map(d => {
    let codigo = null;
    if (d.codigo_recojo_enc) { try { codigo = Crypto.decrypt(d.codigo_recojo_enc); } catch (_) {} }
    return { ...d, codigo };
  });
  const snapshot = clientSnapshot;
  await Mail.send({
    to: recipientEmail,
    subject: `Pedido ${p.numero_orden} aprobado`,
    html: pickupEmail({ pedido:p, ventaNumero:p.venta_numero, customerName:fullName(snapshot), deliveries:decoded }),
    text: `Tu pedido ${p.numero_orden} fue aprobado. Nota de venta: ${p.venta_numero}.`
  });
  return true;
}

const PedidoWebController = {
  list: wrap(async (req, res) => {
    const db = getDB();
    const scope = userScope(req);
    const global = await hasGlobalScope(req, 'pedidos_web.aprobar_multisucursal');
    let sql = `
      SELECT pw.id,pw.numero_orden,pw.tipo_entrega,pw.total,pw.metodo_pago,pw.codigo_operacion,
             pw.estado_pago,pw.estado_pedido,pw.sucursal_id,pw.es_multisucursal,pw.created_at,
             pw.comprobante_cliente,pw.comprobante_admin,pw.imagen_voucher,pw.cliente_snapshot,pw.rechazo_motivo,
             pw.venta_id,v.numero AS venta_numero,
             cw.email AS cliente_email,cw.nombre AS cuenta_nombre,
             GROUP_CONCAT(DISTINCT s.nombre ORDER BY s.nombre SEPARATOR ', ') AS sucursales,
             SUM(pi.subtotal) AS total_sucursal
      FROM pedidos_web pw
      JOIN clientes_web cw ON cw.id=pw.cliente_web_id
      LEFT JOIN ventas v ON v.id=pw.venta_id
      JOIN pedido_items pi ON pi.pedido_id=pw.id
      LEFT JOIN sucursales s ON s.id=pi.sucursal_id
      WHERE pw.estado<>2
    `;
    const params = [];
    if (!global) {
      if (!scope.sucursalId) return res.json({ ok:true, pedidos:[], puede_multisucursal:false });
      sql += " AND pi.sucursal_id=? AND (pw.es_multisucursal=0 OR pw.estado_pago='aprobado')";
      params.push(scope.sucursalId);
    }
    sql += ' GROUP BY pw.id ORDER BY pw.id DESC LIMIT 200';
    const [rows] = await db.query(sql, params);
    rows.forEach(r => {
      r.cliente = parseJSON(r.cliente_snapshot);
      delete r.cliente_snapshot;
      r.tiene_voucher = !!(r.comprobante_cliente || r.comprobante_admin || r.imagen_voucher);
      delete r.comprobante_cliente; delete r.comprobante_admin; delete r.imagen_voucher;
      if (!global && Number(r.es_multisucursal) === 1) r.total = r.total_sucursal;
    });
    res.json({ ok:true, pedidos:rows, puede_multisucursal:global });
  }),

  detail: wrap(async (req, res) => {
    const db = getDB();
    const [[pedido]] = await db.query(`SELECT pw.*,v.numero AS venta_numero,DATE_FORMAT(v.created_at,'%Y-%m-%dT%H:%i:%s') AS venta_fecha,cw.email AS cuenta_email,cw.nombre AS cuenta_nombre FROM pedidos_web pw LEFT JOIN ventas v ON v.id=pw.venta_id LEFT JOIN clientes_web cw ON cw.id=pw.cliente_web_id WHERE pw.id=?`, [Number(req.params.id)]);
    if (!pedido) return res.status(404).json({ ok:false, msg:'Pedido no encontrado' });
    let [items] = await db.query(`
      SELECT pi.*,s.nombre AS sucursal_nombre,p.stock_actual
      FROM pedido_items pi
      LEFT JOIN sucursales s ON s.id=pi.sucursal_id
      LEFT JOIN productos p ON p.id=pi.producto_id
      WHERE pi.pedido_id=? ORDER BY pi.sucursal_id,pi.id
    `, [pedido.id]);
    const branchIds = [...new Set(items.map(i => Number(i.sucursal_id)))];
    if (!(await canView(req,pedido,branchIds))) return res.status(403).json({ok:false,msg:'Pedido fuera de tu alcance'});
    const global = await hasGlobalScope(req,'pedidos_web.aprobar_multisucursal');
    if (!global && Number(pedido.es_multisucursal) === 1) {
      const sid = userScope(req).sucursalId;
      items = items.filter(i => Number(i.sucursal_id) === Number(sid));
      pedido.total = items.reduce((a,i)=>a+Number(i.subtotal),0);
      pedido.codigo_operacion = '';
      pedido.numero_operacion = '';
      pedido.comprobante_cliente = '';
      pedido.comprobante_admin = '';
    }
    for (const key of ['cliente_snapshot','direccion_snapshot','facturacion_snapshot']) {
      pedido[key.replace('_snapshot','')] = parseJSON(pedido[key]);
      delete pedido[key];
    }
    let entregas = [];
    if (pedido.venta_id) {
      entregas = await asegurarCodigosEntrega(pedido.id);
      if (!global && Number(pedido.es_multisucursal) === 1) {
        const sid = userScope(req).sucursalId;
        entregas = entregas.filter(e => Number(e.sucursal_id) === Number(sid));
      }
    }
    res.json({ok:true,pedido,items,entregas});
  }),

  uploadAdminVoucher: wrap(async (req,res) => {
    if (!req.file?.privatePath) return res.status(400).json({ok:false,msg:'Imagen inválida'});
    const db = getDB();
    const [[p]] = await db.query('SELECT * FROM pedidos_web WHERE id=?',[Number(req.params.id)]);
    if (!p) return res.status(404).json({ok:false,msg:'Pedido no encontrado'});
    const [rows] = await db.query('SELECT DISTINCT sucursal_id FROM pedido_items WHERE pedido_id=?',[p.id]);
    if (!(await canProcess(req,p,rows.map(x=>Number(x.sucursal_id))))) return res.status(403).json({ok:false,msg:'Sin permiso para este pedido'});
    const [r] = await db.query("UPDATE pedidos_web SET comprobante_admin=?,updated_at=NOW() WHERE id=? AND estado_pago IN ('pendiente','observado')",[req.file.privatePath,p.id]);
    if (!r.affectedRows) return res.status(409).json({ok:false,msg:'El pedido ya fue procesado'});
    await Audit.log(req,{accion:'voucher_admin_subido',modulo:'pedidos_web',entidad:'pedidos_web',entidad_id:p.id});
    res.json({ok:true,msg:'Imagen administrativa guardada'});
  }),

  voucher: wrap(async (req,res) => {
    const db = getDB();
    const [[p]] = await db.query('SELECT * FROM pedidos_web WHERE id=?',[Number(req.params.id)]);
    if (!p) return res.status(404).end();
    const [items] = await db.query('SELECT DISTINCT sucursal_id FROM pedido_items WHERE pedido_id=?',[p.id]);
    if (!(await canView(req,p,items.map(x=>Number(x.sucursal_id))))) return res.status(403).end();
    const rel = String(req.query.tipo||'cliente') === 'admin'
      ? p.comprobante_admin
      : (p.comprobante_cliente || p.imagen_voucher);
    if (!rel) return res.status(404).end();
    const root = path.resolve(path.join(__dirname,'..'));
    const privateRoot = path.join(root,'storage','private');
    const candidates = [];
    const normalized = String(rel).replace(/\\/g,'/').replace(/^\/+/, '');
    if (path.isAbsolute(String(rel))) candidates.push(path.resolve(String(rel)));
    candidates.push(path.resolve(root, normalized));
    candidates.push(path.resolve(privateRoot, normalized.replace(/^storage\/private\//,'')));
    candidates.push(path.resolve(privateRoot, path.basename(normalized)));
    const file = candidates.find(candidate => candidate.startsWith(privateRoot + path.sep) && fs.existsSync(candidate));
    if (!file) return res.status(404).end();
    res.setHeader('Cache-Control','private,no-store');
    res.sendFile(file);
  }),

  observe: wrap(async (req,res) => {
    const reason = String(req.body.motivo||'').trim().slice(0,500);
    if (reason.length < 5) return res.status(400).json({ok:false,msg:'Escribe el motivo de la observación'});
    const db = getDB();
    const [[p]] = await db.query('SELECT * FROM pedidos_web WHERE id=?',[Number(req.params.id)]);
    if (!p) return res.status(404).json({ok:false,msg:'Pedido no encontrado'});
    const [items] = await db.query('SELECT DISTINCT sucursal_id FROM pedido_items WHERE pedido_id=?',[p.id]);
    if (!(await canProcess(req,p,items.map(x=>Number(x.sucursal_id))))) return res.status(403).json({ok:false,msg:'Sin permiso para este pedido'});
    const [r] = await db.query("UPDATE pedidos_web SET estado_pago='observado',notas_admin=?,updated_at=NOW() WHERE id=? AND estado_pago='pendiente'",[reason,p.id]);
    if (!r.affectedRows) return res.status(409).json({ok:false,msg:'El pedido ya fue procesado'});
    await Audit.log(req,{accion:'pedido_observado',modulo:'pedidos_web',entidad:'pedidos_web',entidad_id:p.id,descripcion:reason});
    res.json({ok:true,msg:'Pedido observado'});
  }),

  reject: wrap(async (req,res) => {
    const reason = String(req.body.motivo||'').trim().slice(0,500);
    if (reason.length < 5) return res.status(400).json({ok:false,msg:'Escribe el motivo del rechazo'});
    const db = getDB(); const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[p]] = await conn.query('SELECT * FROM pedidos_web WHERE id=? FOR UPDATE',[Number(req.params.id)]);
      if (!p || !['pendiente','observado'].includes(p.estado_pago)) throw httpError('El pedido ya fue procesado');
      const [items] = await conn.query('SELECT DISTINCT sucursal_id FROM pedido_items WHERE pedido_id=?',[p.id]);
      if (!(await canProcess(req,p,items.map(x=>Number(x.sucursal_id))))) throw httpError('Sin permiso para este pedido',403);
      await conn.query("UPDATE pedidos_web SET estado_pago='rechazado',estado_pedido='cancelado',rechazo_motivo=?,processed_by=?,processed_at=NOW(),updated_at=NOW() WHERE id=?",[reason,req.session.usuario.id,p.id]);
      await conn.query("UPDATE reservas_web SET estado='liberada',updated_at=NOW() WHERE pedido_id=? AND estado='activa'",[p.id]);
      const [pickupRows]=await conn.query("SELECT horario_id FROM pedido_recojo_reservas WHERE pedido_id=? AND estado='reservado' FOR UPDATE",[p.id]);
      for(const x of pickupRows)await conn.query('UPDATE recojo_fechas SET cupos_usados=GREATEST(cupos_usados-1,0) WHERE id=?',[x.horario_id]);
      await conn.query("UPDATE pedido_recojo_reservas SET estado='liberado',updated_at=NOW() WHERE pedido_id=? AND estado='reservado'",[p.id]);
      await conn.commit();
      await Audit.log(req,{accion:'pedido_rechazado',modulo:'pedidos_web',entidad:'pedidos_web',entidad_id:p.id,descripcion:reason});
      res.json({ok:true,msg:'Pedido rechazado y reservas liberadas'});
    } catch(e) {
      await conn.rollback();
      res.status(e.status || 409).json({ok:false,msg:e.message});
    } finally { conn.release(); }
  }),

  approve: wrap(async (req,res) => {
    const db = getDB(); const conn = await db.getConnection();
    let result;
    try {
      await conn.beginTransaction();
      const [[p]] = await conn.query('SELECT * FROM pedidos_web WHERE id=? FOR UPDATE',[Number(req.params.id)]);
      if (p?.cliente_web_id) {
        const [[account]] = await conn.query('SELECT email,nombre FROM clientes_web WHERE id=?',[p.cliente_web_id]);
        p.cuenta_email = account?.email || '';
        p.cuenta_nombre = account?.nombre || '';
      }
      if (!p || !['pendiente','observado'].includes(p.estado_pago) || p.venta_id) throw httpError('El pedido ya fue procesado');
      const [items] = await conn.query('SELECT * FROM pedido_items WHERE pedido_id=? ORDER BY producto_id FOR UPDATE',[p.id]);
      if (!items.length) throw httpError('El pedido no tiene productos',400);
      const branches = [...new Set(items.map(x=>Number(x.sucursal_id)))];
      if (!(await canProcess(req,p,branches))) throw httpError('Sin permiso para aprobar este pedido',403);

      const manualNotes = String(req.body.notas||'').trim().slice(0,350);
      const webTrace = `Venta generada desde pedido web ${p.numero_orden || `#${p.id}`}. Canal: ecommerce.`;
      const notes = [webTrace, manualNotes].filter(Boolean).join(' ').slice(0,500);
      const op = String(req.body.numero_operacion||p.codigo_operacion||p.numero_operacion||'').trim().replace(/\s+/g,' ').toUpperCase().slice(0,100);
      const method = String(p.metodo_pago||'yape').toLowerCase();
      // El código de operación es opcional en la tienda, así que también lo es
      // al aprobar: quien aprueba ya revisó el pago. Si existe, se sigue
      // validando que no esté repetido.
      if (op) {
        const [[dup]] = await conn.query(
          'SELECT id,pedido_web_id,venta_id,pago_id,metodo FROM pagos_operaciones_unicas WHERE referencia=? LIMIT 1 FOR UPDATE',
          [op]
        );
        if (dup && Number(dup.pedido_web_id || 0) !== Number(p.id)) {
          throw httpError('Ese número de operación ya fue utilizado por otro pedido o venta',409);
        }
        if (!dup) {
          try {
            await conn.query(
              'INSERT INTO pagos_operaciones_unicas (metodo,referencia,pedido_web_id) VALUES (?,?,?)',
              [method,op,p.id]
            );
          } catch(error) {
            if(error.code==='ER_DUP_ENTRY')throw httpError('Ese número de operación ya fue utilizado',409);
            throw error;
          }
        }
      }

      const requestedByProduct = new Map();
      for (const item of items) {
        const productId = Number(item.producto_id);
        const current = requestedByProduct.get(productId) || { cantidad:0, sucursal_id:Number(item.sucursal_id), nombre:item.nombre_snapshot };
        if (current.sucursal_id !== Number(item.sucursal_id)) {
          throw httpError(`El producto ${item.nombre_snapshot || `#${productId}`} aparece en sucursales diferentes`,409);
        }
        current.cantidad += Number(item.cantidad);
        requestedByProduct.set(productId,current);
      }

      const productState = new Map();
      for (const [productId, requested] of requestedByProduct) {
        const [[prod]] = await conn.query(
          'SELECT id,nombre,stock_actual,precio_costo,sucursal_id FROM productos WHERE id=? FOR UPDATE',
          [productId]
        );
        if (!prod || Number(prod.sucursal_id)!==Number(requested.sucursal_id)) {
          throw httpError(`El producto ${prod?.nombre || requested.nombre || `#${productId}`} ya no pertenece a la sucursal del pedido`,409);
        }
        if (Number(prod.stock_actual)<Number(requested.cantidad)) {
          throw httpError(`Stock insuficiente para ${prod.nombre}. Disponible: ${Number(prod.stock_actual)}, solicitado: ${Number(requested.cantidad)}`,409);
        }
        productState.set(productId,{...prod,stock_en_proceso:Number(prod.stock_actual)});
      }

      const addressSnapshot = parseJSON(p.direccion_snapshot);
      const billingSnapshot = parseJSON(p.facturacion_snapshot);
      const snapshot = normalizeApprovedClient(p.cliente_snapshot,addressSnapshot,billingSnapshot,p);
      if (!snapshot.numero_doc) throw httpError('El pedido no tiene un documento validado',400);
      const configuredCentral = Number(process.env.ECOMMERCE_CENTRAL_BRANCH_ID || 0);
      const primaryBranch = branches.length===1 ? branches[0] : (configuredCentral || branches[0]);
      const clientId = await createOrReuseClient(conn,snapshot,req.session.usuario.id,primaryBranch);
      const num = await nextSaleNumber(conn);

      const [vr] = await conn.query(`
        INSERT INTO ventas
          (numero,serie,tipo_comprobante,tipo_entrega,tipo_venta,cliente_id,vendedor_id,sucursal_id,
           subtotal,igv,total,costo_delivery,estado,estado_venta,estado_sunat,metodo_pago,observacion,created_by,created_at,
           canal,cliente_web_nombre,cliente_web_doc,pedido_web_id,es_multisucursal,
           cliente_snapshot,direccion_snapshot,facturacion_snapshot)
        VALUES (?,?,'nota_venta',?,'contado',?,?,?,?,?,?,?,'aprobado','registrada','sin_emitir',?,?,?,NOW(),'web',?,?,?,?,?,?,?)
      `,[num.numero,num.serie,p.tipo_entrega,clientId,req.session.usuario.id,primaryBranch,p.subtotal,p.igv||0,p.total,Number(p.costo_delivery||0),method,notes,req.session.usuario.id,
          fullName(snapshot),snapshot.numero_doc,p.id,branches.length>1?1:0,
          JSON.stringify(snapshot),JSON.stringify(addressSnapshot),JSON.stringify(billingSnapshot)]);

      for (const item of items) {
        const prod = productState.get(Number(item.producto_id));
        const before = Number(prod.stock_en_proceso);
        const after = before-Number(item.cantidad);
        prod.stock_en_proceso = after;
        await conn.query(`
          INSERT INTO venta_items
            (venta_id,producto_id,presentacion_id,cantidad,precio_unit,descuento,subtotal,sucursal_id,costo_unitario)
          VALUES (?,?,?,?,?,0,?,?,?)
        `,[vr.insertId,item.producto_id,item.presentacion_id||null,item.cantidad,item.precio_unit,item.subtotal,item.sucursal_id,item.costo_unitario_snapshot||prod.precio_costo||0]);
        await conn.query('UPDATE productos SET stock_actual=? WHERE id=?',[after,item.producto_id]);
        await conn.query(`
          INSERT INTO inventario_movimientos
            (producto_id,presentacion_id,sucursal_id,tipo,cantidad,stock_antes,stock_despues,venta_id,referencia,precio_unit,usuario_id)
          VALUES (?,?,?,'SALIDA_VENTA',?,?,?,?,?,?,?)
        `,[item.producto_id,item.presentacion_id||null,item.sucursal_id,item.cantidad,before,after,vr.insertId,num.numero,item.precio_unit,req.session.usuario.id]);
      }

      let [[mp]] = await conn.query('SELECT id FROM metodos_pago WHERE LOWER(nombre)=? LIMIT 1',[method]);
      if (!mp) {
        const displayName = method === 'izipay' ? 'IziPay' : method.charAt(0).toUpperCase()+method.slice(1);
        const [createdMethod] = await conn.query('INSERT INTO metodos_pago (nombre,estado) VALUES (?,0)',[displayName]);
        mp = { id: createdMethod.insertId };
      }
      const [paymentResult]=await conn.query(`
        INSERT INTO pagos (venta_id,metodo,metodo_pago_id,monto,referencia,estado_conciliacion)
        VALUES (?,?,?,?,?,?)
      `,[vr.insertId,method,Number(mp.id),p.total,op,['yape','plin','transferencia','izipay'].includes(method)?'pendiente':'conciliado']);
      if(op)await conn.query('UPDATE pagos_operaciones_unicas SET pago_id=?,venta_id=? WHERE referencia=?',[paymentResult.insertId,vr.insertId,op]);
      await conn.query("UPDATE reservas_web SET estado='consumida',updated_at=NOW() WHERE pedido_id=? AND estado='activa'",[p.id]);
      await conn.query("UPDATE pedido_recojo_reservas SET estado='confirmado',updated_at=NOW() WHERE pedido_id=? AND estado='reservado'",[p.id]);
      // Si la reserva temporal venció antes de aprobar, el cupo ya fue liberado.
      // Se intenta recuperar el mismo horario; si ya no está vigente o se llenó,
      // la entrega queda sin programación y debe reprogramarse desde Recojo.
      const [released]=await conn.query("SELECT id,horario_id FROM pedido_recojo_reservas WHERE pedido_id=? AND estado='liberado' FOR UPDATE",[p.id]);
      for (const reservation of released) {
        const [retaken]=await conn.query(`
          UPDATE recojo_fechas SET cupos_usados=cupos_usados+1
          WHERE id=? AND estado=0 AND cupos_usados<cupos_total
            AND (fecha>CURDATE() OR (fecha=CURDATE() AND hora_fin>CURTIME()))
        `,[reservation.horario_id]);
        if (retaken.affectedRows) await conn.query("UPDATE pedido_recojo_reservas SET estado='confirmado',updated_at=NOW() WHERE id=?",[reservation.id]);
      }

      const deliveries=[];
      for (const branch of branches) {
        const [[s]] = await conn.query('SELECT nombre,direccion FROM sucursales WHERE id=?',[branch]);
        let code=null,hash=null,enc=null;
        for (let tries=0;tries<12;tries++) {
          const candidate=Crypto.randomPickupCode();
          const candidateHash=Crypto.hash(candidate);
          const [[exists]]=await conn.query('SELECT id FROM pedido_entregas_sucursal WHERE codigo_recojo_hash=?',[candidateHash]);
          if (!exists) { code=candidate; hash=candidateHash; break; }
        }
        if (!code) throw httpError('No se pudo generar un código de entrega único',500);
        enc=Crypto.encrypt(code);
        await conn.query(`
          INSERT INTO pedido_entregas_sucursal
            (pedido_id,venta_id,sucursal_id,tipo_entrega,estado,codigo_recojo_hash,codigo_recojo_enc,codigo_generado_at)
          VALUES (?,?,?,?,'pendiente',?,?,?)
        `,[p.id,vr.insertId,branch,p.tipo_entrega,hash,enc,code?new Date():null]);
        deliveries.push({sucursal_nombre:s?.nombre||`Sucursal ${branch}`,direccion:s?.direccion||'',codigo:code});
      }

      const [processed] = await conn.query(`
        UPDATE pedidos_web
        SET cliente_id=?,venta_id=?,estado_pago='aprobado',estado_pedido='preparando',processed_by=?,processed_at=NOW(),
            verificado_by=?,verificado_at=NOW(),codigo_operacion=?,numero_operacion=?,notas_admin=?,version=version+1,updated_at=NOW()
        WHERE id=? AND venta_id IS NULL AND estado_pago IN ('pendiente','observado')
      `,[clientId,vr.insertId,req.session.usuario.id,req.session.usuario.id,op,op,notes,p.id]);
      if (!processed.affectedRows) throw httpError('El pedido ya fue procesado por otro usuario',409);
      await conn.query('UPDATE clientes_web SET cliente_id=? WHERE id=?',[clientId,p.cliente_web_id]);
      await conn.commit();

      result={ pedidoId:p.id, ventaId:vr.insertId, numeroVenta:num.numero, deliveries };
      await Audit.log(req,{accion:'pedido_aprobado',modulo:'pedidos_web',entidad:'pedidos_web',entidad_id:p.id,datos:{venta_id:vr.insertId,numero:num.numero,sucursales:branches}});
      let mailSent=false;
      try { mailSent=await sendApprovalMail(p.id); } catch(e) { console.error('[MAIL PEDIDO]',e.message); }
      res.json({ok:true,msg:'Pago aprobado, cliente registrado, nota de venta generada y stock descontado',venta_id:vr.insertId,numero_venta:num.numero,correo_enviado:mailSent,entregas:deliveries.map(d=>({sucursal:d.sucursal_nombre,codigo:d.codigo||null}))});
    } catch(e) {
      await conn.rollback();
      res.status(e.status || 409).json({ok:false,msg:e.message||'No se pudo aprobar el pedido'});
    } finally { conn.release(); }
  }),

  resendMail: wrap(async (req,res) => {
    const db=getDB();
    const [[p]]=await db.query('SELECT * FROM pedidos_web WHERE id=?',[Number(req.params.id)]);
    if(!p || p.estado_pago!=='aprobado') return res.status(404).json({ok:false,msg:'Pedido aprobado no encontrado'});
    const [items]=await db.query('SELECT DISTINCT sucursal_id FROM pedido_items WHERE pedido_id=?',[p.id]);
    if(!(await canProcess(req,p,items.map(x=>Number(x.sucursal_id))))) return res.status(403).json({ok:false,msg:'Sin permiso'});
    const sent=await sendApprovalMail(p.id);
    await Audit.log(req,{accion:'correo_pedido_reenviado',modulo:'pedidos_web',entidad:'pedidos_web',entidad_id:p.id});
    res.json({ok:sent,msg:sent?'Correo reenviado':'La cuenta no tiene correo'});
  })
};

module.exports = PedidoWebController;
