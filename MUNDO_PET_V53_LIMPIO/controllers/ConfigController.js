const { getDB } = require('../config/database');
const { wrap } = require('../helpers/response');
const path = require('path');
const fs = require('fs');
const Audit = require('../services/AuditService');
const MailService = require('../services/MailService');
const DeliveryPricing = require('../services/DeliveryPricingService');

const SECRET_KEYS = new Set(['mail_pass', 'miapi_token', 'sunat_clave_secreta']);
const bcrypt = require('bcrypt');
const SECRET_ENV = { mail_pass: 'MAIL_PASS', miapi_token: 'MIAPI_TOKEN' };
const SAFE_KEY = /^[a-z0-9_]{2,100}$/;

function publicConfigRows(rows) {
  return rows.filter(r => !SECRET_KEYS.has(r.clave)).map(r => ({ ...r, valor: String(r.valor ?? '') }));
}

const ConfigController = {
  // Muestra una clave del servidor. Solo administrador global y con su contraseña.
  verSecreto: wrap(async (req, res) => {
    const usuario = req.session.usuario;
    if (!usuario?.es_global) return res.status(403).json({ ok: false, msg: 'Solo un administrador global puede ver esta clave.' });
    const env = SECRET_ENV[String(req.body?.clave || '')];
    if (!env) return res.status(400).json({ ok: false, msg: 'Clave no válida' });
    const db = getDB();
    const [[row]] = await db.query('SELECT password_hash FROM usuarios WHERE id=? AND estado=0 LIMIT 1', [usuario.id]);
    if (!row || !(await bcrypt.compare(String(req.body?.password || ''), row.password_hash))) {
      return res.status(401).json({ ok: false, msg: 'Contraseña incorrecta.' });
    }
    await Audit.log(req, { accion: 'secreto_visto', modulo: 'config', entidad: 'configuracion', descripcion: env }).catch(() => {});
    res.json({ ok: true, valor: String(process.env[env] || '') });
  }),

  get: wrap(async (req, res) => {
    const db = getDB();
    const [allRows] = await db.query('SELECT clave, valor, grupo FROM configuracion ORDER BY grupo, clave');
    const rows = publicConfigRows(allRows);
    const cfg = {};
    const grupos = {};
    rows.forEach(r => {
      cfg[r.clave] = r.valor;
      if (!grupos[r.grupo]) grupos[r.grupo] = {};
      grupos[r.grupo][r.clave] = r.valor;
    });
    const [logos] = await db.query('SELECT id,tipo,nombre,ruta,orden,estado,created_at FROM tienda_imagenes WHERE tipo=? ORDER BY estado DESC,id DESC', ['logo']);
    const [sliders] = await db.query('SELECT id,tipo,nombre,ruta,orden,estado,created_at FROM tienda_imagenes WHERE tipo=? ORDER BY orden ASC', ['slider']);
    res.json({
      ok: true,
      cfg,
      grupos,
      logos,
      sliders,
      secretos: {
        mail_pass_env: !!process.env.MAIL_PASS,
        miapi_token_env: !!process.env.MIAPI_TOKEN,
        sunat_clave_env: !!process.env.SUNAT_CLAVE_SECRETA
      }
    });
  }),

  save: wrap(async (req, res) => {
    const db = getDB();
    const datos = req.body && typeof req.body === 'object' ? req.body : {};
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const [clave, valor] of Object.entries(datos)) {
        if (!SAFE_KEY.test(clave) || SECRET_KEYS.has(clave)) continue;
        const stringValue = String(valor ?? '').slice(0, 5000);
        await conn.query(
          `INSERT INTO configuracion (clave,valor,grupo)
           VALUES (?,?,?)
           ON DUPLICATE KEY UPDATE valor=VALUES(valor), updated_at=CURRENT_TIMESTAMP`,
          [clave, stringValue, clave.startsWith('yape_') || clave.startsWith('plin_') || clave.startsWith('transferencia_') || clave.startsWith('izipay_') ? 'pagos' : 'general']
        );
      }
      await conn.commit();
      await Audit.log(req, { accion: 'configuracion_actualizada', modulo: 'config' });
      res.json({ ok: true, msg: 'Configuración guardada. Las claves secretas se administran en el archivo .env del servidor.' });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }),

  savePaymentMethods: wrap(async (req,res) => {
    const allowed=new Set([
      'yape_activo','yape_numero','yape_titular','plin_activo','plin_numero','plin_titular',
      'transferencia_activo','transferencia_banco','transferencia_titular','transferencia_cuenta','transferencia_cci',
      'izipay_activo','izipay_instrucciones','delivery_gratis_desde'
    ]);
    const data=req.body&&typeof req.body==='object'?req.body:{};
    for(const key of ['delivery_gratis_desde']){
      if(key in data && (!Number.isFinite(Number(data[key])) || Number(data[key]) < 0 || Number(data[key]) > 100000)){
        return res.status(400).json({ok:false,msg:'El costo de delivery debe ser un monto válido y no negativo'});
      }
    }
    const db=getDB();const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      let saved=0;
      for(const [key,value] of Object.entries(data)){
        if(!allowed.has(key))continue;
        await conn.query(`INSERT INTO configuracion (clave,valor,grupo) VALUES (?,?,'pagos')
          ON DUPLICATE KEY UPDATE valor=VALUES(valor),updated_at=CURRENT_TIMESTAMP`,[key,String(value??'').slice(0,500)]);
        saved++;
      }
      if(!saved)throw Object.assign(new Error('No se recibieron medios de pago válidos'),{status:400});
      await conn.commit();
      await Audit.log(req,{accion:'medios_pago_actualizados',modulo:'tienda'});
      res.json({ok:true,msg:'Medios de pago guardados correctamente'});
    }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  }),

  // ── Delivery por zonas de distancia ──
  deliveryZonas: wrap(async (req, res) => {
    const db = getDB();
    const [settings, zonas, [sucursales]] = await Promise.all([
      DeliveryPricing.getSettings(db),
      DeliveryPricing.listZones(db),
      db.query('SELECT id,nombre,direccion,lat,lng FROM sucursales WHERE estado=0 ORDER BY id')
    ]);
    res.json({
      ok: true, zonas, origen: settings.origin, gratis_desde: settings.freeFrom,
      sucursales: sucursales.map(s => ({
        id: Number(s.id), nombre: s.nombre, direccion: s.direccion || '',
        lat: s.lat === null ? null : Number(s.lat), lng: s.lng === null ? null : Number(s.lng)
      }))
    });
  }),

  saveDeliveryZona: wrap(async (req, res) => {
    const db = getDB();
    const id = Number(req.params.id || 0);
    const nombre = String(req.body?.nombre || '').trim().slice(0, 80);
    const km = Number(req.body?.km_hasta);
    const costo = Number(req.body?.costo);
    const activo = Number(req.body?.activo) === 0 ? 0 : 1;
    if (!nombre) return res.status(400).json({ ok:false, msg:'Ponle un nombre a la zona' });
    if (!Number.isFinite(km) || km <= 0 || km > 500) return res.status(400).json({ ok:false, msg:'La distancia debe estar entre 0.1 y 500 km' });
    if (!Number.isFinite(costo) || costo < 0 || costo > 100000) return res.status(400).json({ ok:false, msg:'El costo debe ser un monto válido' });
    const [[repetida]] = await db.query('SELECT id FROM delivery_zonas WHERE km_hasta=? AND id<>? LIMIT 1', [km, id]);
    if (repetida) return res.status(409).json({ ok:false, msg:`Ya existe una zona que llega hasta ${km} km` });
    if (id) {
      const [r] = await db.query('UPDATE delivery_zonas SET nombre=?,km_hasta=?,costo=?,activo=? WHERE id=?', [nombre, km, costo, activo, id]);
      if (!r.affectedRows) return res.status(404).json({ ok:false, msg:'Zona no encontrada' });
      await Audit.log(req,{accion:'delivery_zona_editada',modulo:'tienda',entidad:'delivery_zonas',entidad_id:id});
      return res.json({ ok:true, id, msg:'Zona actualizada' });
    }
    const [r] = await db.query('INSERT INTO delivery_zonas (nombre,km_hasta,costo,activo) VALUES (?,?,?,?)', [nombre, km, costo, activo]);
    await Audit.log(req,{accion:'delivery_zona_creada',modulo:'tienda',entidad:'delivery_zonas',entidad_id:r.insertId});
    res.status(201).json({ ok:true, id:r.insertId, msg:'Zona creada' });
  }),

  deleteDeliveryZona: wrap(async (req, res) => {
    const db = getDB();
    const id = Number(req.params.id);
    const [r] = await db.query('DELETE FROM delivery_zonas WHERE id=?', [id]);
    if (!r.affectedRows) return res.status(404).json({ ok:false, msg:'Zona no encontrada' });
    await Audit.log(req,{accion:'delivery_zona_eliminada',modulo:'tienda',entidad:'delivery_zonas',entidad_id:id});
    res.json({ ok:true, msg:'Zona eliminada' });
  }),

  // Punto de despacho general (sucursal_id vacío) o de una sucursal, y el
  // importe desde el que el envío es gratis.
  saveDeliveryAjustes: wrap(async (req, res) => {
    const db = getDB();
    const body = req.body || {};
    const upsert = (clave, valor) => db.query(
      "INSERT INTO configuracion (clave,valor,grupo) VALUES (?,?,'ecommerce') ON DUPLICATE KEY UPDATE valor=VALUES(valor)", [clave, String(valor)]
    );
    if (body.gratis_desde !== undefined) {
      const gratis = Number(body.gratis_desde);
      if (!Number.isFinite(gratis) || gratis < 0 || gratis > 100000) return res.status(400).json({ ok:false, msg:'El importe de envío gratis no es válido' });
      await upsert('delivery_gratis_desde', gratis.toFixed(2));
    }
    if (body.lat !== undefined || body.lng !== undefined) {
      const quitar = body.lat === null && body.lng === null;
      if (!quitar && !DeliveryPricing.validPoint(body.lat, body.lng)) return res.status(400).json({ ok:false, msg:'La ubicación marcada no es válida' });
      const sucursalId = Number(body.sucursal_id || 0);
      if (sucursalId) {
        const [r] = await db.query('UPDATE sucursales SET lat=?,lng=? WHERE id=?', quitar ? [null, null, sucursalId] : [Number(body.lat), Number(body.lng), sucursalId]);
        if (!r.affectedRows) return res.status(404).json({ ok:false, msg:'Sucursal no encontrada' });
      } else {
        if (quitar) return res.status(400).json({ ok:false, msg:'El punto de despacho general no se puede quitar' });
        await upsert('delivery_origen_lat', Number(body.lat).toFixed(7));
        await upsert('delivery_origen_lng', Number(body.lng).toFixed(7));
        if (body.nombre !== undefined) await upsert('delivery_origen_nombre', String(body.nombre || '').trim().slice(0, 120));
      }
    }
    await Audit.log(req,{accion:'delivery_ajustes',modulo:'tienda',entidad:'configuracion'});
    res.json({ ok:true, msg:'Delivery actualizado' });
  }),

  // Simulador del panel: mismo cálculo que usa la tienda.
  cotizarDeliveryZona: wrap(async (req, res) => {
    const db = getDB();
    const quote = await DeliveryPricing.quote(db, {
      subtotal: Number(req.body?.subtotal) || 0,
      location: { lat: req.body?.lat, lng: req.body?.lng },
      branchIds: Array.isArray(req.body?.sucursal_ids) ? req.body.sucursal_ids : []
    });
    res.json({ ok:true, quote });
  }),

  getLogoActivo: wrap(async (req, res) => {
    const db = getDB();
    const [[logo]] = await db.query("SELECT ruta FROM tienda_imagenes WHERE tipo='logo' AND estado=1 LIMIT 1");
    const [[cfg]] = await db.query("SELECT valor FROM configuracion WHERE clave='empresa_nombre'");
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json({ ok: true, ruta: logo?.ruta || null, empresa: cfg?.valor || 'Sistema de Gestión' });
  }),

  uploadLogo: wrap(async (req, res) => {
    if (!req.file?.webPath) return res.status(400).json({ ok: false, msg: 'Sin archivo válido' });
    const db = getDB();
    const [r] = await db.query('INSERT INTO tienda_imagenes (tipo,nombre,ruta,estado) VALUES (?,?,?,0)', ['logo', req.file.originalname, req.file.webPath]);
    await Audit.log(req, { accion: 'logo_subido', modulo: 'tienda', entidad: 'tienda_imagenes', entidad_id: r.insertId });
    res.json({ ok: true, msg: 'Logo subido', id: r.insertId, ruta: req.file.webPath });
  }),

  activarLogo: wrap(async (req, res) => {
    const db = getDB();
    const id = Number(req.params.id);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("UPDATE tienda_imagenes SET estado=0 WHERE tipo='logo'");
      const [r] = await conn.query("UPDATE tienda_imagenes SET estado=1 WHERE id=? AND tipo='logo'", [id]);
      if (!r.affectedRows) throw new Error('Logo no encontrado');
      await conn.commit();
      await Audit.log(req, { accion: 'logo_activado', modulo: 'tienda', entidad: 'tienda_imagenes', entidad_id: id });
      res.json({ ok: true, msg: 'Logo activado' });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally { conn.release(); }
  }),

  deleteLogo: wrap(async (req, res) => {
    const db = getDB();
    const id = Number(req.params.id);
    const [[img]] = await db.query("SELECT * FROM tienda_imagenes WHERE id=? AND tipo='logo'", [id]);
    if (!img) return res.status(404).json({ ok: false, msg: 'Logo no encontrado' });
    if (Number(img.estado) === 1) return res.status(400).json({ ok: false, msg: 'Activa otro logo antes de eliminar este' });
    if (/^\/(?:media|uploads)\//.test(String(img.ruta))) {
      const full = path.join(__dirname, '../public', img.ruta);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
    await db.query('DELETE FROM tienda_imagenes WHERE id=?', [id]);
    await Audit.log(req, { accion: 'logo_eliminado', modulo: 'tienda', entidad: 'tienda_imagenes', entidad_id: id });
    res.json({ ok: true, msg: 'Logo eliminado' });
  }),

  uploadSlider: wrap(async (req, res) => {
    if (!req.file?.webPath) return res.status(400).json({ ok: false, msg: 'Sin archivo válido' });
    const db = getDB();
    const [[maxOrden]] = await db.query("SELECT COALESCE(MAX(orden),0)+1 AS next FROM tienda_imagenes WHERE tipo='slider'");
    const [r] = await db.query('INSERT INTO tienda_imagenes (tipo,nombre,ruta,orden,estado) VALUES (?,?,?,?,1)', ['slider', req.file.originalname, req.file.webPath, maxOrden.next]);
    await Audit.log(req, { accion: 'slider_subido', modulo: 'tienda', entidad: 'tienda_imagenes', entidad_id: r.insertId });
    res.json({ ok: true, msg: 'Slider subido', id: r.insertId, ruta: req.file.webPath });
  }),


  toggleSlider: wrap(async (req, res) => {
    const db=getDB(); const id=Number(req.params.id); const estado=Number(req.body.estado)===1?1:0;
    const [r]=await db.query("UPDATE tienda_imagenes SET estado=? WHERE id=? AND tipo='slider'",[estado,id]);
    if(!r.affectedRows)return res.status(404).json({ok:false,msg:'Slider no encontrado'});
    await Audit.log(req,{accion:'slider_estado',modulo:'tienda',entidad:'tienda_imagenes',entidad_id:id,datos:{estado}});
    res.json({ok:true,msg:estado?'Slider publicado':'Slider ocultado'});
  }),

  reorderSlider: wrap(async (req,res)=>{
    const db=getDB(); const id=Number(req.params.id); const orden=Math.max(0,Math.min(999,Number(req.body.orden)||0));
    const [r]=await db.query("UPDATE tienda_imagenes SET orden=? WHERE id=? AND tipo='slider'",[orden,id]);
    if(!r.affectedRows)return res.status(404).json({ok:false,msg:'Slider no encontrado'});
    res.json({ok:true,msg:'Orden actualizado'});
  }),

  deleteSlider: wrap(async(req,res)=>{
    const db=getDB(); const id=Number(req.params.id);
    const [[img]]=await db.query("SELECT * FROM tienda_imagenes WHERE id=? AND tipo='slider'",[id]);
    if(!img)return res.status(404).json({ok:false,msg:'Slider no encontrado'});
    if(/^\/(?:media|uploads)\//.test(String(img.ruta))&&!String(img.ruta).includes('..')){const full=path.resolve(__dirname,'../public',String(img.ruta).replace(/^\/+/,''));const safeRoot=path.resolve(__dirname,'../public/uploads');if(full.startsWith(safeRoot+path.sep)&&fs.existsSync(full))fs.unlinkSync(full);}
    await db.query('DELETE FROM tienda_imagenes WHERE id=?',[id]);
    await Audit.log(req,{accion:'slider_eliminado',modulo:'tienda',entidad:'tienda_imagenes',entidad_id:id});
    res.json({ok:true,msg:'Slider eliminado'});
  }),

  uploadPaymentImage: wrap(async (req, res) => {
    if (!req.file?.webPath) return res.status(400).json({ ok: false, msg: 'Sin archivo válido' });
    const tipo = String(req.body.tipo || '').toLowerCase();
    const keyMap = {
      yape: 'yape_qr_ruta',
      plin: 'plin_qr_ruta',
      transferencia: 'transferencia_imagen_ruta',
      izipay: 'izipay_imagen_ruta'
    };
    const clave = keyMap[tipo];
    if (!clave) return res.status(400).json({ ok: false, msg: 'Método de pago inválido' });
    const db = getDB();
    await db.query(
      `INSERT INTO configuracion (clave,valor,grupo)
       VALUES (?,?, 'pagos')
       ON DUPLICATE KEY UPDATE valor=VALUES(valor), updated_at=CURRENT_TIMESTAMP`,
      [clave, req.file.webPath]
    );
    await Audit.log(req, { accion: 'imagen_pago_actualizada', modulo: 'tienda', entidad: 'configuracion', entidad_id: clave, datos: { tipo } });
    res.json({ ok: true, msg: `Imagen de ${tipo} guardada`, ruta: req.file.webPath, clave });
  }),

  deletePaymentImage: wrap(async (req, res) => {
    const tipo = String(req.params.tipo || '').toLowerCase();
    const keyMap = {
      yape: 'yape_qr_ruta',
      plin: 'plin_qr_ruta',
      transferencia: 'transferencia_imagen_ruta',
      izipay: 'izipay_imagen_ruta'
    };
    const clave = keyMap[tipo];
    if (!clave) return res.status(400).json({ ok: false, msg: 'Método de pago inválido' });
    const db = getDB();
    const [[row]] = await db.query('SELECT valor FROM configuracion WHERE clave=?', [clave]);
    const ruta = String(row?.valor || '');
    if (/^\/(?:media|uploads)\/pagos\//.test(ruta) && !ruta.includes('..')) {
      const full = path.resolve(__dirname, '../public', ruta.replace(/^\/+/, ''));
      const safeRoot = path.resolve(__dirname, '../public/uploads/pagos');
      if (full.startsWith(safeRoot + path.sep) && fs.existsSync(full)) fs.unlinkSync(full);
    }
    await db.query(
      `INSERT INTO configuracion (clave,valor,grupo)
       VALUES (?,'','pagos')
       ON DUPLICATE KEY UPDATE valor='', updated_at=CURRENT_TIMESTAMP`,
      [clave]
    );
    await Audit.log(req, { accion: 'imagen_pago_eliminada', modulo: 'tienda', entidad: 'configuracion', entidad_id: clave, datos: { tipo } });
    res.json({ ok: true, msg: 'Imagen eliminada' });
  }),

  uploadQR: wrap(async (req, res) => {
    if (!req.file?.webPath) return res.status(400).json({ ok: false, msg: 'Sin archivo válido' });
    const tipo = String(req.body.tipo || '').toLowerCase();
    const keyMap = { yape:'yape_qr_ruta', plin:'plin_qr_ruta', transferencia:'transferencia_imagen_ruta', izipay:'izipay_imagen_ruta' };
    if (!keyMap[tipo]) return res.status(400).json({ ok: false, msg: 'Tipo de imagen inválido' });
    const clave = keyMap[tipo];
    const db = getDB();
    await db.query(`INSERT INTO configuracion (clave,valor,grupo) VALUES (?,?,'pagos') ON DUPLICATE KEY UPDATE valor=VALUES(valor),updated_at=CURRENT_TIMESTAMP`, [clave, req.file.webPath]);
    await Audit.log(req, { accion: 'qr_actualizado', modulo: 'config', entidad: 'configuracion', entidad_id: clave });
    res.json({ ok: true, msg: `QR ${tipo} guardado`, ruta: req.file.webPath });
  }),

  probarCorreo: wrap(async (req, res) => {
    try {
      const info = await MailService.verify();
      res.json({
        ok: true,
        msg: `Conexión SMTP correcta (${info.user} · ${info.host}:${info.port})`
      });
    } catch (error) {
      console.error('[MAIL TEST]', error.message);
      res.status(502).json({
        ok: false,
        msg: MailService.friendlyError(error),
        code: error.code || 'SMTP_ERROR'
      });
    }
  }),

  probarMiapi: wrap(async (req, res) => {
    const token = process.env.MIAPI_TOKEN || '';
    if (!token) return res.status(400).json({ ok: false, msg: 'Configura MIAPI_TOKEN en .env' });
    const base = process.env.MIAPI_URL || 'https://miapi.cloud/v1';
    const r = await fetch(`${base.replace(/\/$/, '')}/dni/12345678`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.status === 401 || r.status === 403) return res.status(400).json({ ok: false, msg: 'Token MiAPI inválido o vencido' });
    res.json({ ok: true, msg: 'Conexión con MiAPI correcta' });
  })
};

module.exports = ConfigController;
