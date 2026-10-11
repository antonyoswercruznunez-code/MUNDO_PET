'use strict';

/*
 * Costo de delivery por zonas de distancia.
 *
 * El administrador marca en el mapa el punto de despacho y define anillos
 * ("hasta 3 km → S/ 5", "hasta 6 km → S/ 8"…). El cliente marca su ubicación
 * y el costo sale de la distancia en línea recta entre ambos puntos. No hay
 * cargo por unidad: el precio depende de dónde se entrega, no de cuánto se
 * compra. Más allá del último anillo no hay cobertura.
 */

const EARTH_KM = 6371.0088;

function clampMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(100000, n)) : 0;
}

function validPoint(lat, lng) {
  const a = Number(lat), b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
}

// Distancia en línea recta (haversine) entre dos coordenadas, en kilómetros.
function distanceKm(a, b) {
  const rad = deg => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function getSettings(db) {
  const [rows] = await db.query(`SELECT clave,valor FROM configuracion
    WHERE clave IN ('delivery_origen_lat','delivery_origen_lng','delivery_origen_nombre','delivery_gratis_desde','delivery_costo')`);
  const cfg = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  const origin = validPoint(cfg.delivery_origen_lat, cfg.delivery_origen_lng)
    ? { lat: Number(cfg.delivery_origen_lat), lng: Number(cfg.delivery_origen_lng), nombre: cfg.delivery_origen_nombre || 'Punto de despacho' }
    : null;
  return { origin, freeFrom: clampMoney(cfg.delivery_gratis_desde), flatFee: clampMoney(cfg.delivery_costo) };
}

async function listZones(db, { activeOnly = false } = {}) {
  const [rows] = await db.query(`SELECT id,nombre,km_hasta,costo,activo FROM delivery_zonas
    ${activeOnly ? 'WHERE activo=1' : ''} ORDER BY km_hasta ASC,id ASC`);
  return rows.map(row => ({
    id: Number(row.id), nombre: row.nombre, km_hasta: Number(row.km_hasta),
    costo: Number(row.costo), activo: Number(row.activo) === 1
  }));
}

// Puntos de despacho de las sucursales que tienen coordenadas propias.
async function branchOrigins(db, branchIds) {
  const ids = [...new Set((branchIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT id,nombre,lat,lng FROM sucursales WHERE id IN (${ids.map(() => '?').join(',')})`, ids
  );
  return rows.filter(r => validPoint(r.lat, r.lng)).map(r => ({ id: Number(r.id), nombre: r.nombre, lat: Number(r.lat), lng: Number(r.lng) }));
}

// Lo que la tienda y el panel necesitan para dibujar el mapa.
async function publicConfig(db) {
  const [settings, zones, branches] = await Promise.all([
    getSettings(db),
    listZones(db, { activeOnly: true }),
    db.query('SELECT id,nombre,lat,lng FROM sucursales WHERE estado=0').then(([rows]) => rows)
  ]);
  return {
    origen: settings.origin,
    gratis_desde: settings.freeFrom,
    zonas: zones.map(z => ({ id: z.id, nombre: z.nombre, km_hasta: z.km_hasta, costo: z.costo })),
    sucursales: branches.filter(b => validPoint(b.lat, b.lng)).map(b => ({ id: Number(b.id), nombre: b.nombre, lat: Number(b.lat), lng: Number(b.lng) }))
  };
}

function result(fields) {
  return {
    covered: true, free: false, total: 0, zone_id: null, zone_name: '', distance_km: null,
    origin_name: '', free_from: 0, calculation: '', description: '',
    // Nombre que ya usan correos y reportes para describir el delivery.
    tariff_name: fields.zone_name || 'Delivery',
    ...fields
  };
}

/*
 * Cotiza el delivery para una ubicación.
 * - location: { lat, lng } marcada por el cliente.
 * - branchIds: sucursales que despachan el pedido. Si varias tienen punto de
 *   despacho propio se cobra la zona más lejana (un solo envío).
 */
async function quote(db, { subtotal = 0, location = {}, branchIds = [] } = {}) {
  const [settings, zones, origins] = await Promise.all([
    getSettings(db), listZones(db, { activeOnly: true }), branchOrigins(db, branchIds)
  ]);
  const safeSubtotal = clampMoney(subtotal);
  const free = settings.freeFrom > 0 && safeSubtotal >= settings.freeFrom;

  // Instalación sin zonas configuradas: se mantiene la tarifa única de siempre.
  const points = origins.length ? origins : (settings.origin ? [settings.origin] : []);
  if (!zones.length || !points.length) {
    const total = free ? 0 : settings.flatFee;
    return result({
      total, free, free_from: settings.freeFrom, zone_name: 'Tarifa única',
      calculation: free ? `Envío gratis desde S/ ${settings.freeFrom.toFixed(2)}` : `Tarifa única S/ ${total.toFixed(2)}`,
      description: 'Delivery con tarifa única.'
    });
  }

  if (!validPoint(location.lat, location.lng)) {
    return result({ covered: false, needs_location: true, description: 'Marca en el mapa dónde quieres recibir tu pedido.' });
  }
  const target = { lat: Number(location.lat), lng: Number(location.lng) };
  const farthest = points
    .map(point => ({ point, km: distanceKm(point, target) }))
    .sort((a, b) => b.km - a.km)[0];
  const km = Number(farthest.km.toFixed(2));
  const zone = zones.find(z => km <= z.km_hasta);
  const originName = farthest.point.nombre || 'Punto de despacho';

  if (!zone) {
    const limit = zones[zones.length - 1].km_hasta;
    return result({
      covered: false, distance_km: km, origin_name: originName,
      description: `Tu ubicación está a ${km.toFixed(1)} km y por ahora repartimos hasta ${limit} km. Puedes elegir recojo en tienda.`
    });
  }
  const total = free ? 0 : clampMoney(zone.costo);
  return result({
    total, free, free_from: settings.freeFrom, zone_id: zone.id, zone_name: zone.nombre,
    distance_km: km, origin_name: originName,
    calculation: free
      ? `${zone.nombre} · ${km.toFixed(1)} km · envío gratis desde S/ ${settings.freeFrom.toFixed(2)}`
      : `${zone.nombre} · ${km.toFixed(1)} km · S/ ${total.toFixed(2)}`,
    description: free
      ? 'El pedido alcanzó el importe para envío gratuito.'
      : `Entrega a ${km.toFixed(1)} km de ${originName}.`
  });
}

module.exports = { distanceKm, validPoint, getSettings, listZones, publicConfig, quote, clampMoney };
