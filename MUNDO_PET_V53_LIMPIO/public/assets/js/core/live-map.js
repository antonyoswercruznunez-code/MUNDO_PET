/*
 * MPLiveMap — mapa en vivo del reparto para el supervisor.
 * Muestra el último punto de cada persona que comparte ubicación, qué tan
 * reciente es y, al elegirla, el recorrido que hizo en el día.
 */
(function () {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const REFRESH_MS = 30000;

  // Reciente (< 5 min), demorado (< 30 min) o sin señal.
  const freshness = seconds => seconds < 300 ? { key: 'live', color: '#16a34a', text: 'En línea' }
    : seconds < 1800 ? { key: 'late', color: '#d97706', text: 'Demorado' }
    : { key: 'off', color: '#64748b', text: 'Sin señal' };
  const ago = seconds => seconds < 60 ? 'hace instantes' : seconds < 3600 ? `hace ${Math.round(seconds / 60)} min`
    : `hace ${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
  const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

  async function mount(host) {
    host.innerHTML = `
      <div class="lv">
        <div class="lv-map-card">
          <div id="lv-map" class="lv-map"></div>
          <div class="lv-legend"><span><i style="--c:#16a34a"></i>En línea</span><span><i style="--c:#d97706"></i>Demorado</span><span><i style="--c:#64748b"></i>Sin señal</span><span class="lv-updated" id="lv-updated"></span></div>
        </div>
        <aside class="lv-side">
          <div class="lv-side-head"><div><h3>Equipo en ruta</h3><small id="lv-count"></small></div><button class="btn btn-outline btn-xs" id="lv-refresh" title="Actualizar"><i class="ti ti-refresh"></i></button></div>
          <div id="lv-list" class="lv-list"></div>
        </aside>
      </div>`;
    let L;
    try { L = await MPMap.load(); } catch (error) { host.querySelector('#lv-map').innerHTML = `<div class="lv-empty">${esc(error.message)}</div>`; return () => {}; }
    const map = MPMap.create(L, host.querySelector('#lv-map'), { scrollWheel: true });
    const people = L.layerGroup().addTo(map), places = L.layerGroup().addTo(map), trail = L.layerGroup().addTo(map);
    let rows = [], selected = null, fitted = false, timer = null, alive = true;
    let known = { sucursales: [], base: null };   // locales que se dibujan como referencia

    const icon = (person, state) => L.divIcon({
      className: 'lv-pin-wrap',
      html: `<span class="lv-pin ${state.key}${selected === person.usuario_id ? ' sel' : ''}" style="--pin:${state.color}">${esc(initials(person.nombre))}</span><span class="lv-pin-name">${esc(String(person.nombre).split(' ')[0])}</span>`,
      iconSize: [44, 58], iconAnchor: [22, 22]
    });

    function draw() {
      people.clearLayers(); places.clearLayers();
      const origins = [...known.sucursales, ...(known.base && !known.sucursales.length ? [known.base] : [])];
      origins.forEach(o => L.marker([o.lat, o.lng], { icon: MPMap.pin(L, { color: '#0f172a', icon: 'ti-building-store', label: o.nombre || '' }), interactive: false, keyboard: false }).addTo(places));
      rows.forEach(p => {
        const state = freshness(p.hace_seg);
        const marker = L.marker([p.lat, p.lng], { icon: icon(p, state), zIndexOffset: state.key === 'live' ? 500 : 0 }).addTo(people);
        marker.on('click', () => select(p.usuario_id));
        if (p.precision_m > 0 && p.precision_m < 400 && state.key === 'live') L.circle([p.lat, p.lng], { radius: p.precision_m, color: state.color, weight: 1, fillOpacity: .08, interactive: false }).addTo(people);
      });
      if (!fitted) {
        const points = [...rows, ...origins].map(p => [p.lat, p.lng]);
        if (points.length === 1) map.setView(points[0], 15);
        else if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 16 });
        fitted = points.length > 0;
      }
      const live = rows.filter(p => p.hace_seg < 300).length;
      host.querySelector('#lv-count').textContent = rows.length ? `${live} en línea · ${rows.length} en las últimas 24 h` : '';
      host.querySelector('#lv-updated').textContent = `Actualizado ${new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())}`;
      host.querySelector('#lv-list').innerHTML = rows.length ? rows.map(p => {
        const state = freshness(p.hace_seg);
        const tel = String(p.telefono || '').replace(/\D/g, '').slice(-9);
        return `<div class="lv-person${selected === p.usuario_id ? ' active' : ''}" data-id="${p.usuario_id}" role="button" tabindex="0">
          <span class="lv-avatar" style="--pin:${state.color}">${esc(initials(p.nombre))}</span>
          <div class="lv-person-main"><b>${esc(p.nombre)}</b>
            <span><i class="lv-dot" style="--c:${state.color}"></i>${state.text} · ${ago(p.hace_seg)}</span>
            ${p.ruta_codigo ? `<span class="lv-route"><i class="ti ti-route"></i>${esc(p.ruta_codigo)} · ${p.entregadas}/${p.paradas} entregas</span>` : `<span class="lv-route muted">${esc(p.sucursal_nombre || 'Sin ruta hoy')}</span>`}
          </div>
          <div class="lv-person-actions">
            ${tel.length === 9 ? `<a href="https://wa.me/51${tel}" target="_blank" rel="noopener" title="Escribir por WhatsApp"><i class="ti ti-brand-whatsapp"></i></a>` : ''}
            <a href="https://www.google.com/maps?q=${p.lat},${p.lng}" target="_blank" rel="noopener" title="Abrir en Google Maps"><i class="ti ti-external-link"></i></a>
          </div></div>`;
      }).join('') : `<div class="lv-empty"><i class="ti ti-map-pin-off"></i><b>Nadie comparte ubicación todavía</b><span>Cada repartidor la activa desde su celular con el botón "Compartir ubicación" de la barra superior.</span></div>`;
    }

    async function select(id) {
      selected = selected === id ? null : id;
      trail.clearLayers();
      draw();
      const person = rows.find(p => p.usuario_id === selected);
      if (!person) return;
      map.setView([person.lat, person.lng], Math.max(map.getZoom(), 16));
      const res = await Http.get(`/logistica/ubicaciones/${person.usuario_id}/recorrido`);
      if (!alive || selected !== person.usuario_id || !res?.ok || res.puntos.length < 2) return;
      const line = res.puntos.map(p => [p.lat, p.lng]);
      L.polyline(line, { color: '#2563eb', weight: 4, opacity: .75, lineJoin: 'round' }).addTo(trail);
      const first = res.puntos[0];
      L.circleMarker([first.lat, first.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip(`Inicio ${first.hora}`).addTo(trail);
      map.fitBounds(L.latLngBounds(line), { padding: [60, 60], maxZoom: 17 });
    }

    async function load() {
      const res = await Http.get('/logistica/ubicaciones');
      if (!alive || !res?.ok) return;
      known = { sucursales: res.sucursales || [], base: res.base || null };
      rows = res.personas || [];
      draw();
    }

    host.querySelector('#lv-refresh').onclick = load;
    host.querySelector('#lv-list').addEventListener('click', e => { if (e.target.closest('a')) return; const row = e.target.closest('.lv-person'); if (row) select(Number(row.dataset.id)); });
    await load();
    timer = setInterval(() => { if (!document.body.contains(host)) return stop(); if (!host.closest('[hidden]') && !document.hidden) load(); }, REFRESH_MS);
    function stop() { alive = false; clearInterval(timer); }
    return { stop, refresh: () => { map.invalidateSize(); load(); } };
  }

  window.MPLiveMap = { mount };
})();
