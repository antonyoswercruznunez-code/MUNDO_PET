/*
 * MPMap — mapa de delivery compartido por la tienda y el panel.
 *
 * Usa Leaflet con mapas de OpenStreetMap y su buscador de direcciones
 * (Nominatim): son gratuitos y no necesitan clave. Leaflet se descarga solo
 * cuando hace falta, así no pesa en las páginas que no muestran mapa.
 */
(function () {
  const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet';
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const PERU = { lat: -9.19, lng: -75.0152, zoom: 5 };
  // Un solo tono, de claro a oscuro: la zona más lejana es la más intensa.
  const ZONE_COLORS = ['#22c55e', '#16a34a', '#15803d', '#166534', '#14532d', '#0f3d21'];
  let loading = null;

  function load() {
    if (window.L?.map) return Promise.resolve(window.L);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${LEAFLET}.css`;
      document.head.appendChild(css);
      const script = document.createElement('script');
      script.src = `${LEAFLET}.js`;
      script.onload = () => resolve(window.L);
      script.onerror = () => { loading = null; reject(new Error('No se pudo cargar el mapa. Revisa tu conexión a internet.')); };
      document.head.appendChild(script);
    });
    return loading;
  }

  const zoneColor = index => ZONE_COLORS[Math.min(index, ZONE_COLORS.length - 1)];
  const validPoint = point => !!point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)) && !(Number(point.lat) === 0 && Number(point.lng) === 0);

  // Distancia en línea recta, igual que la que calcula el servidor.
  function distanceKm(a, b) {
    const rad = deg => (deg * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function pin(L, { color = '#16a34a', icon = 'ti-map-pin-filled', label = '' } = {}) {
    return L.divIcon({
      className: 'mpm-pin-wrap',
      html: `<span class="mpm-pin" style="--pin:${color}"><i class="ti ${icon}"></i></span>${label ? `<span class="mpm-pin-label">${label.replace(/[<>&]/g, '')}</span>` : ''}`,
      iconSize: [36, 44], iconAnchor: [18, 42]
    });
  }

  function create(L, host, { center, zoom = 13, scrollWheel = false } = {}) {
    const start = validPoint(center) ? center : PERU;
    const map = L.map(host, { zoomControl: true, scrollWheelZoom: scrollWheel, attributionControl: true })
      .setView([Number(start.lat), Number(start.lng)], validPoint(center) ? zoom : PERU.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    // El contenedor suele aparecer después de crearse (modales, pestañas).
    setTimeout(() => map.invalidateSize(), 60);
    setTimeout(() => map.invalidateSize(), 400);
    return map;
  }

  // Dibuja los anillos de cada zona alrededor de sus puntos de despacho.
  // Devuelve el grupo para poder quitarlo y redibujar.
  function drawZones(L, map, { origins = [], zones = [], fit = true, interactive = false } = {}) {
    const group = L.layerGroup().addTo(map);
    const points = origins.filter(validPoint);
    const ordered = [...zones].sort((a, b) => Number(b.km_hasta) - Number(a.km_hasta));   // del mayor al menor
    const total = ordered.length;
    points.forEach(origin => {
      ordered.forEach((zone, position) => {
        const index = total - 1 - position;          // 0 = la más cercana
        L.circle([Number(origin.lat), Number(origin.lng)], {
          radius: Number(zone.km_hasta) * 1000, color: zoneColor(index), weight: 1.5, opacity: .9,
          fillColor: zoneColor(index), fillOpacity: .09, interactive
        }).addTo(group);
      });
      L.marker([Number(origin.lat), Number(origin.lng)], { icon: pin(L, { color: '#0f172a', icon: 'ti-building-store', label: origin.nombre || '' }), interactive: false, keyboard: false }).addTo(group);
    });
    if (fit && points.length) {
      const reach = ordered.length ? Number(ordered[0].km_hasta) : 2;
      const bounds = L.latLngBounds([]);
      points.forEach(origin => bounds.extend(L.latLng(Number(origin.lat), Number(origin.lng)).toBounds(reach * 2000)));
      map.fitBounds(bounds, { padding: [18, 18] });
    }
    return group;
  }

  // Buscador de direcciones (máx. 1 consulta por segundo, norma de Nominatim).
  let lastSearch = 0;
  async function throttled(url) {
    const wait = Math.max(0, 1050 - (Date.now() - lastSearch));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastSearch = Date.now();
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('El buscador de direcciones no respondió');
    return response.json();
  }

  async function search(text, near) {
    const query = String(text || '').trim();
    if (query.length < 4) return [];
    const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', limit: '5', countrycodes: 'pe', 'accept-language': 'es' });
    if (validPoint(near)) {
      const d = 0.6;   // prioriza resultados cerca del punto de despacho
      params.set('viewbox', [near.lng - d, near.lat + d, near.lng + d, near.lat - d].join(','));
    }
    const rows = await throttled(`${NOMINATIM}/search?${params}`);
    return rows.map(row => ({ lat: Number(row.lat), lng: Number(row.lon), label: row.display_name, address: row.address || {} }));
  }

  async function reverse(point) {
    const params = new URLSearchParams({ lat: String(point.lat), lon: String(point.lng), format: 'jsonv2', addressdetails: '1', zoom: '18', 'accept-language': 'es' });
    const row = await throttled(`${NOMINATIM}/reverse?${params}`);
    return { label: row?.display_name || '', address: row?.address || {} };
  }

  // Dirección corta y legible a partir de la respuesta del buscador.
  function shortAddress(address = {}, fallback = '') {
    const street = [address.road || address.pedestrian || address.footway || address.neighbourhood, address.house_number].filter(Boolean).join(' ');
    const area = address.suburb || address.neighbourhood || address.city_district || '';
    const city = address.city || address.town || address.village || address.county || '';
    const text = [street, area, city].filter((part, index, list) => part && list.indexOf(part) === index).join(', ');
    return text || String(fallback).split(',').slice(0, 3).join(',').trim();
  }

  window.MPMap = { load, create, drawZones, pin, search, reverse, shortAddress, distanceKm, zoneColor, validPoint, PERU };
})();
