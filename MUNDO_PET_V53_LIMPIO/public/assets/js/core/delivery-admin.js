/*
 * Administración del delivery por zonas (panel → Gestión Tienda).
 *
 * El administrador marca el punto de despacho en el mapa, define hasta qué
 * distancia llega cada zona y cuánto cuesta, y puede tocar cualquier punto
 * para comprobar qué pagaría un cliente que viva ahí.
 */
(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => `S/ ${Number(value || 0).toFixed(2)}`;

  async function mount(host) {
    host.innerHTML = `
      <div class="td-section-title"><div class="td-icon"><i class="ti ti-map-2"></i></div>
        <div><b>Zonas de delivery</b><span>El costo del envío depende de la distancia entre tu punto de despacho y la dirección del cliente.</span></div>
      </div>
      <div id="dza-hint"></div>
      <div class="dza">
        <div class="dza-map-card">
          <div class="dza-toolbar">
            <div class="dza-modes" role="group" aria-label="Qué hacer al tocar el mapa">
              <button type="button" data-mode="probar" class="on"><i class="ti ti-pointer"></i> Probar una dirección</button>
              <button type="button" data-mode="origen"><i class="ti ti-building-store"></i> Mover punto de despacho</button>
            </div>
            <select id="dza-target" class="form-control" aria-label="Punto de despacho a mover"></select>
          </div>
          <div class="dz-search"><i class="ti ti-search"></i><input id="dza-q" placeholder="Buscar una dirección o lugar para centrar el mapa" autocomplete="off"><div id="dza-results" class="dz-results"></div></div>
          <div id="dza-map" class="dz-map"></div>
        </div>
        <div class="dza-side">
          <div class="dza-panel">
            <h4>Zonas y costos</h4>
            
            <div class="dza-zone dza-zone-head"><span></span><span>Nombre</span><span class="num">Hasta (km)</span><span class="num">Costo (S/)</span><span></span></div>
            <div id="dza-zones"></div>
            <div class="dza-actions">
              <button type="button" class="btn btn-outline btn-sm" id="dza-add"><i class="ti ti-plus"></i> Agregar zona</button>
              <button type="button" class="btn btn-primary btn-sm" id="dza-save"><i class="ti ti-device-floppy"></i> Guardar zonas</button>
            </div>
          </div>
          <div class="dza-panel">
            <div class="dza-free">
              <label for="dza-free">Envío gratis desde<small>0 = sin envío gratis</small></label>
              <input id="dza-free" class="form-control" type="number" min="0" step="1" inputmode="decimal">
            </div>
          </div>
          <div class="dza-panel">
            <h4>Simulador</h4>
            
            <div id="dza-sim" class="dza-sim"><i class="ti ti-pointer"></i><div><b>Aún no has probado ningún punto</b><span>El resultado usa el mismo cálculo que la tienda.</span></div></div>
          </div>
        </div>
      </div>`;

    let state = { zonas: [], origen: null, sucursales: [], gratis_desde: 0 };
    let L, map, zoneLayer, simMarker, mode = 'probar';
    const zonesHost = host.querySelector('#dza-zones');
    const target = host.querySelector('#dza-target');
    const sim = host.querySelector('#dza-sim');

    const origins = () => {
      const branches = state.sucursales.filter(MPMap.validPoint);
      return branches.length ? branches : (state.origen ? [state.origen] : []);
    };
    // Zonas tal como están en pantalla (aunque todavía no se hayan guardado).
    const draftZones = () => [...zonesHost.querySelectorAll('.dza-zone')].map(row => ({
      id: Number(row.dataset.id) || 0,
      nombre: row.querySelector('[data-f="nombre"]').value.trim(),
      km_hasta: Number(row.querySelector('[data-f="km"]').value),
      costo: Number(row.querySelector('[data-f="costo"]').value)
    }));

    function drawMap(fit = false) {
      if (!map) return;
      if (zoneLayer) zoneLayer.remove();
      const zones = draftZones().filter(z => z.km_hasta > 0);
      zoneLayer = MPMap.drawZones(L, map, { origins: origins(), zones, fit });
      [...zonesHost.querySelectorAll('.dza-zone')]
        .sort((a, b) => Number(a.querySelector('[data-f="km"]').value) - Number(b.querySelector('[data-f="km"]').value))
        .forEach((row, index) => row.querySelector('i').style.setProperty('--c', MPMap.zoneColor(index)));
    }

    function renderZones() {
      zonesHost.innerHTML = state.zonas.map(zone => `
        <div class="dza-zone" data-id="${zone.id}">
          <i></i>
          <input data-f="nombre" value="${esc(zone.nombre)}" maxlength="80" aria-label="Nombre de la zona">
          <input data-f="km" class="num" type="number" min="0.1" max="500" step="0.5" value="${Number(zone.km_hasta)}" aria-label="Hasta cuántos kilómetros">
          <input data-f="costo" class="num" type="number" min="0" step="0.5" value="${Number(zone.costo)}" aria-label="Costo en soles">
          <button type="button" title="Eliminar zona" data-del><i class="ti ti-trash"></i></button>
        </div>`).join('') || '<p style="font-size:13px;color:var(--texto-muted);margin:8px 0">Aún no hay zonas. Agrega la primera.</p>';
      drawMap();
    }

    function renderTargets() {
      target.innerHTML = '<option value="">Punto general (todas las sucursales)</option>'
        + state.sucursales.map(s => `<option value="${s.id}">${esc(s.nombre)}${MPMap.validPoint(s) ? ' ✓' : ''}</option>`).join('');
      target.style.display = mode === 'origen' ? '' : 'none';
      const missing = !origins().length;
      host.querySelector('#dza-hint').innerHTML = missing
        ? `<div class="dza-hint"><i class="ti ti-alert-triangle"></i><div><b>Falta marcar el punto de despacho.</b> Elige "Mover punto de despacho" y toca en el mapa el lugar desde donde salen los pedidos. Mientras falte, la tienda no ofrece delivery.</div></div>` : '';
    }

    async function reload(fit = false) {
      const data = await Http.get('/config/delivery-zonas');
      if (!data?.ok) return;
      state = data;
      host.querySelector('#dza-free').value = Number(data.gratis_desde || 0);
      renderTargets();
      renderZones();
      drawMap(fit);
    }

    function showSim(quote) {
      const ok = quote.covered !== false;
      sim.className = `dza-sim ${ok ? 'ok' : 'bad'}`;
      sim.innerHTML = ok
        ? `<i class="ti ti-truck-delivery"></i><div><b>${esc(quote.zone_name)}</b><span>A ${Number(quote.distance_km || 0).toFixed(1)} km de ${esc(quote.origin_name)}</span></div><strong>${quote.total ? money(quote.total) : 'Gratis'}</strong>`
        : `<i class="ti ti-map-pin-off"></i><div><b>${quote.unavailable ? 'Delivery sin configurar' : 'Fuera de la zona de reparto'}</b><span>${esc(quote.description || '')}</span></div>`;
    }

    await reload();
    try { L = await MPMap.load(); } catch (error) {
      host.querySelector('#dza-map').innerHTML = `<div style="padding:30px;text-align:center;color:var(--texto-muted)">${esc(error.message)}</div>`;
      return;
    }
    map = MPMap.create(L, host.querySelector('#dza-map'), { center: origins()[0], zoom: 13, scrollWheel: true });
    drawMap(true);

    map.on('click', async event => {
      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      if (mode === 'origen') {
        const branch = state.sucursales.find(s => String(s.id) === target.value);
        const name = branch ? branch.nombre : 'el punto general';
        const ok = await Swal.fire({ icon: 'question', title: 'Mover punto de despacho', text: `Las distancias de ${name} se medirán desde el lugar que tocaste.`, showCancelButton: true, confirmButtonText: 'Usar este punto', cancelButtonText: 'Cancelar' });
        if (!ok.isConfirmed) return;
        const saved = await Http.post('/config/delivery-ajustes', { ...point, sucursal_id: branch ? branch.id : null, nombre: branch ? undefined : 'Punto de despacho' });
        if (!saved?.ok) return Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: saved?.msg || '' });
        await reload(true);
        return Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Punto de despacho actualizado', timer: 1800, showConfirmButton: false });
      }
      if (!simMarker) simMarker = L.marker([point.lat, point.lng], { icon: MPMap.pin(L, { color: '#dc2626', icon: 'ti-home' }) }).addTo(map);
      else simMarker.setLatLng([point.lat, point.lng]);
      // Con zonas sin guardar se calcula aquí mismo para ver el efecto al instante.
      const zones = draftZones().filter(z => z.km_hasta > 0).sort((a, b) => a.km_hasta - b.km_hasta);
      const from = origins();
      if (!from.length || !zones.length) {
        const response = await Http.post('/config/delivery-cotizar', point);
        return response?.ok && showSim(response.quote);
      }
      const far = from.map(o => ({ o, km: MPMap.distanceKm({ lat: Number(o.lat), lng: Number(o.lng) }, point) })).sort((a, b) => b.km - a.km)[0];
      const zone = zones.find(z => far.km <= z.km_hasta);
      showSim(zone
        ? { covered: true, zone_name: zone.nombre || 'Zona', distance_km: far.km, origin_name: far.o.nombre || 'Punto de despacho', total: zone.costo }
        : { covered: false, description: `Está a ${far.km.toFixed(1)} km y la última zona llega hasta ${zones[zones.length - 1].km_hasta} km.` });
    });

    host.querySelectorAll('[data-mode]').forEach(button => {
      button.onclick = () => {
        mode = button.dataset.mode;
        host.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b === button));
        target.style.display = mode === 'origen' ? '' : 'none';
        map.getContainer().style.cursor = mode === 'origen' ? 'crosshair' : '';
      };
    });

    zonesHost.addEventListener('input', () => drawMap());
    zonesHost.addEventListener('click', async event => {
      const button = event.target.closest('[data-del]');
      if (!button) return;
      const row = button.closest('.dza-zone');
      const id = Number(row.dataset.id) || 0;
      if (id) {
        const ok = await Swal.fire({ icon: 'warning', title: '¿Eliminar esta zona?', text: 'Los clientes dentro de ella pasarán a la zona siguiente o quedarán sin cobertura.', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' });
        if (!ok.isConfirmed) return;
        const removed = await Http.delete(`/config/delivery-zonas/${id}`);
        if (!removed?.ok) return Swal.fire({ icon: 'error', title: 'No se pudo eliminar', text: removed?.msg || '' });
        state.zonas = state.zonas.filter(z => z.id !== id);
      }
      row.remove();
      drawMap();
    });
    host.querySelector('#dza-add').onclick = () => {
      const last = draftZones().reduce((max, z) => Math.max(max, z.km_hasta || 0), 0);
      const lastCost = draftZones().reduce((max, z) => Math.max(max, z.costo || 0), 0);
      state.zonas = [...draftZones().map(z => ({ ...z })), { id: 0, nombre: `Zona ${draftZones().length + 1}`, km_hasta: last + 3, costo: lastCost + 3 }];
      renderZones();
      zonesHost.lastElementChild?.querySelector('[data-f="nombre"]')?.select();
    };
    host.querySelector('#dza-save').onclick = async () => {
      const zones = draftZones();
      const bad = zones.find(z => !z.nombre || !(z.km_hasta > 0) || !(z.costo >= 0));
      if (bad) return Swal.fire({ icon: 'warning', title: 'Revisa las zonas', text: 'Cada zona necesita nombre, una distancia mayor a 0 y un costo válido.' });
      if (new Set(zones.map(z => z.km_hasta)).size !== zones.length) return Swal.fire({ icon: 'warning', title: 'Distancias repetidas', text: 'Dos zonas no pueden llegar hasta la misma distancia.' });
      const sorted = [...zones].sort((a, b) => a.km_hasta - b.km_hasta);
      if (sorted.some((z, i) => i > 0 && z.costo < sorted[i - 1].costo)) {
        const go = await Swal.fire({ icon: 'question', title: 'Una zona lejana cuesta menos que una cercana', text: '¿Quieres guardarlo así de todos modos?', showCancelButton: true, confirmButtonText: 'Sí, guardar', cancelButtonText: 'Revisar' });
        if (!go.isConfirmed) return;
      }
      // Se guardan de la más lejana a la más cercana para que una zona nunca
      // choque, a mitad del guardado, con la distancia que otra está por dejar.
      for (const zone of [...zones].sort((a, b) => b.km_hasta - a.km_hasta)) {
        const body = { nombre: zone.nombre, km_hasta: zone.km_hasta, costo: zone.costo, activo: 1 };
        const saved = await (zone.id ? Http.put(`/config/delivery-zonas/${zone.id}`, body) : Http.post('/config/delivery-zonas', body));
        if (!saved?.ok) { await reload(); return Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: saved?.msg || '' }); }
      }
      const free = await Http.post('/config/delivery-ajustes', { gratis_desde: Math.max(0, Number(host.querySelector('#dza-free').value || 0)) });
      await reload();
      Swal.fire({ toast: true, position: 'top-end', icon: free?.ok ? 'success' : 'warning', title: free?.ok ? 'Zonas de delivery guardadas' : (free?.msg || 'Zonas guardadas, revisa el envío gratis'), timer: 2000, showConfirmButton: false });
    };

    // Buscador para centrar el mapa
    const q = host.querySelector('#dza-q');
    const results = host.querySelector('#dza-results');
    let timer = null;
    const search = async () => {
      const text = q.value.trim();
      if (text.length < 4) return results.classList.remove('show');
      results.classList.add('show');
      results.innerHTML = '<div class="dz-empty">Buscando…</div>';
      try {
        const rows = await MPMap.search(text, origins()[0]);
        results.textContent = '';
        if (!rows.length) { results.innerHTML = '<div class="dz-empty">Sin resultados. Prueba con otra referencia.</div>'; return; }
        rows.forEach(row => {
          const button = document.createElement('button');
          button.type = 'button';
          const icon = document.createElement('i'); icon.className = 'ti ti-map-pin';
          const label = document.createElement('span'); label.textContent = row.label;
          button.append(icon, label);
          button.onclick = () => { results.classList.remove('show'); map.setView([row.lat, row.lng], 16); };
          results.append(button);
        });
      } catch (_) { results.innerHTML = '<div class="dz-empty">El buscador no respondió. Mueve el mapa manualmente.</div>'; }
    };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 650); });
    q.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); clearTimeout(timer); search(); } });
    document.addEventListener('click', event => { if (!event.target.closest?.('.dz-search')) results.classList.remove('show'); });
  }

  window.MPDeliveryAdmin = { mount };
})();
