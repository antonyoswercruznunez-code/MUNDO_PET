'use strict';

/*
 * Mapa en vivo del reparto.
 *
 * Quien reparte activa "Compartir ubicación" en su panel y su navegador
 * envía un punto cada cierto tiempo. El supervisor ve el último punto de cada
 * persona y el recorrido del día. Nada se registra si el usuario no lo activa.
 */
const { wrap } = require('../helpers/response');
const { getDB } = require('../config/database');
const { hasGlobalScope, userScope } = require('../middleware/permisos');

const MIN_SECONDS = 20;        // se descartan envíos más seguidos que esto
const KEEP_DAYS = 30;          // historial que se conserva
let lastCleanup = 0;

const validPoint = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const hoyPeru = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function scopeOf(req) {
  if (await hasGlobalScope(req, 'logistica.ver_global')) return { global: true, sucursalId: Number(req.query.sucursal_id) || null };
  return { global: false, sucursalId: Number(userScope(req).sucursalId) || null };
}

const UbicacionController = {
  // El repartidor reporta dónde está.
  registrar: wrap(async (req, res) => {
    const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
    if (!validPoint(lat, lng)) return res.status(400).json({ ok: false, msg: 'Ubicación inválida' });
    const precision = Math.max(0, Math.min(99999, Math.round(Number(req.body?.precision) || 0)));
    const usuario = req.session.usuario;
    const db = getDB();
    const [[last]] = await db.query('SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) seg FROM usuario_ubicaciones WHERE usuario_id=? ORDER BY id DESC LIMIT 1', [usuario.id]);
    if (last && Number(last.seg) < MIN_SECONDS) return res.json({ ok: true, omitido: true });
    await db.query('INSERT INTO usuario_ubicaciones (usuario_id,sucursal_id,lat,lng,precision_m) VALUES (?,?,?,?,?)',
      [usuario.id, usuario.sucursal_id || null, lat, lng, precision]);
    if (Date.now() - lastCleanup > 6 * 3600 * 1000) {
      lastCleanup = Date.now();
      db.query('DELETE FROM usuario_ubicaciones WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [KEEP_DAYS]).catch(() => {});
    }
    res.json({ ok: true });
  }),

  // Último punto de cada persona que compartió ubicación en las últimas 24 h.
  enVivo: wrap(async (req, res) => {
    const scope = await scopeOf(req);
    if (!scope.global && !scope.sucursalId) return res.status(403).json({ ok: false, msg: 'Tu usuario no tiene una sucursal asignada' });
    const db = getDB();
    const params = [];
    let where = '';
    if (scope.sucursalId) { where = ' AND u.sucursal_id=?'; params.push(scope.sucursalId); }
    const [rows] = await db.query(`
      SELECT u.id usuario_id, u.nombre, s.nombre sucursal_nombre, x.lat, x.lng, x.precision_m,
             DATE_FORMAT(x.created_at,'%Y-%m-%dT%H:%i:%s') visto_at, TIMESTAMPDIFF(SECOND, x.created_at, NOW()) hace_seg,
             rp.telefono, r.codigo ruta_codigo, r.estado ruta_estado,
             (SELECT COUNT(*) FROM ruta_reparto_pedidos d WHERE d.ruta_id=r.id) paradas,
             (SELECT COUNT(*) FROM ruta_reparto_pedidos d WHERE d.ruta_id=r.id AND d.estado='entregado') entregadas
        FROM usuario_ubicaciones x
        JOIN (SELECT usuario_id, MAX(id) id FROM usuario_ubicaciones WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) GROUP BY usuario_id) m ON m.id=x.id
        JOIN usuarios u ON u.id=x.usuario_id
        LEFT JOIN sucursales s ON s.id=u.sucursal_id
        LEFT JOIN repartidores rp ON rp.usuario_id=u.id AND rp.estado<>2
        LEFT JOIN rutas_reparto r ON r.id=(SELECT r2.id FROM rutas_reparto r2 WHERE r2.repartidor_id=rp.id AND r2.fecha=CURDATE()
               AND r2.estado IN ('planificada','cargada','en_ruta') ORDER BY FIELD(r2.estado,'en_ruta','cargada','planificada'), r2.id DESC LIMIT 1)
       WHERE 1=1${where}
       ORDER BY x.created_at DESC`, params);
    const [origins] = await db.query(`SELECT id,nombre,lat,lng FROM sucursales WHERE estado=0 AND lat IS NOT NULL AND lng IS NOT NULL${scope.sucursalId ? ' AND id=?' : ''}`, scope.sucursalId ? [scope.sucursalId] : []);
    const [cfg] = await db.query("SELECT clave,valor FROM configuracion WHERE clave IN ('delivery_origen_lat','delivery_origen_lng','delivery_origen_nombre')");
    const c = Object.fromEntries(cfg.map(r => [r.clave, r.valor]));
    const base = validPoint(Number(c.delivery_origen_lat), Number(c.delivery_origen_lng))
      ? { nombre: c.delivery_origen_nombre || 'Punto de despacho', lat: Number(c.delivery_origen_lat), lng: Number(c.delivery_origen_lng) } : null;
    res.json({
      ok: true, hoy: hoyPeru(), base,
      sucursales: origins.map(o => ({ id: Number(o.id), nombre: o.nombre, lat: Number(o.lat), lng: Number(o.lng) })),
      personas: rows.map(r => ({ ...r, lat: Number(r.lat), lng: Number(r.lng), hace_seg: Number(r.hace_seg), paradas: Number(r.paradas || 0), entregadas: Number(r.entregadas || 0) }))
    });
  }),

  // Recorrido de una persona en un día.
  recorrido: wrap(async (req, res) => {
    const scope = await scopeOf(req);
    const usuarioId = Number(req.params.usuarioId);
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || '')) ? String(req.query.fecha) : hoyPeru();
    const db = getDB();
    const [[persona]] = await db.query('SELECT id,nombre,sucursal_id FROM usuarios WHERE id=?', [usuarioId]);
    if (!persona || (!scope.global && Number(persona.sucursal_id) !== Number(scope.sucursalId))) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
    const [rows] = await db.query(`SELECT lat,lng,precision_m,DATE_FORMAT(created_at,'%H:%i') hora FROM usuario_ubicaciones
      WHERE usuario_id=? AND DATE(created_at)=? ORDER BY id ASC LIMIT 2000`, [usuarioId, fecha]);
    res.json({ ok: true, fecha, nombre: persona.nombre, puntos: rows.map(r => ({ lat: Number(r.lat), lng: Number(r.lng), hora: r.hora })) });
  })
};

module.exports = UbicacionController;
