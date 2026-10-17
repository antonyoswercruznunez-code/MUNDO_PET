/*
 * Mis pedidos: lista y seguimiento de cada pedido.
 *
 * Un pedido puede salir de varias sucursales; cada una avanza por su cuenta
 * (preparación, recojo o reparto), así que se muestra un paquete por sucursal
 * con su propio avance. En delivery, cuando el repartidor va en camino, se ve
 * su ubicación en el mapa y se actualiza sola.
 */
(function () {
  const money = value => `S/ ${Number(value || 0).toFixed(2)}`;
  const REFRESH_MS = 20000;
  const fecha = value => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
  };
  const dia = value => {
    if (!value) return '';
    const d = new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  };
  const METODO = { yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia', izipay: 'Tarjeta' };

  // Etapas de un paquete. Devuelve el paso actual (0-4) y cómo mostrarlo.
  function avance(pedido, s) {
    const delivery = s.tipo_entrega === 'delivery';
    const steps = ['Recibido', 'Pago verificado', 'Preparando', delivery ? 'En camino' : 'Listo para recoger', 'Entregado'];
    const pago = String(pedido.estado_pago || '');
    if (['rechazado', 'anulado', 'cancelado', 'vencido'].includes(pago) || s.estado === 'cancelado') {
      return { steps, step: 1, tone: 'bad', label: pago === 'vencido' ? 'Reserva vencida' : 'Pedido cancelado', icon: 'ti-circle-x' };
    }
    if (pago !== 'aprobado') return { steps, step: 1, tone: 'wait', label: pago === 'observado' ? 'Pago observado' : 'Verificando tu pago', icon: 'ti-hourglass' };
    switch (s.estado) {
      case 'entregado': return { steps, step: 4, done: true, tone: 'ok', label: 'Entregado', icon: 'ti-circle-check' };
      case 'en_ruta': return { steps, step: 3, tone: 'go', label: 'En camino', icon: 'ti-truck-delivery' };
      case 'asignado': return { steps, step: 3, tone: 'go', label: 'Asignado a un repartidor', icon: 'ti-route' };
      case 'listo': return delivery
        ? { steps, step: 2, tone: 'go', label: 'Listo, esperando repartidor', icon: 'ti-package' }
        : { steps, step: 3, tone: 'ok', label: 'Listo para recoger', icon: 'ti-building-store' };
      case 'incidencia': return { steps, step: 3, tone: 'bad', label: 'Tuvimos un inconveniente', icon: 'ti-alert-triangle' };
      case 'preparando': return { steps, step: 2, tone: 'go', label: 'Preparando tu pedido', icon: 'ti-box' };
      default: return { steps, step: 2, tone: 'wait', label: 'En cola de preparación', icon: 'ti-clock' };
    }
  }
  // El avance del pedido completo es el del paquete más atrasado.
  function avanceGeneral(pedido, sucursales) {
    const list = sucursales.length ? sucursales : [{ tipo_entrega: pedido.tipo_entrega, estado: null }];
    const all = list.map(s => avance(pedido, s));
    const bad = all.find(a => a.tone === 'bad');
    if (bad) return bad;
    const min = all.reduce((acc, a) => (a.step < acc.step || (a.step === acc.step && !a.done && acc.done) ? a : acc), all[0]);
    const done = all.filter(a => a.done).length;
    if (all.length > 1 && done > 0 && done < all.length) return { ...min, label: `${done} de ${all.length} paquetes entregados`, tone: 'go' };
    return min;
  }

  const stepper = (a, compact = false) => `<ol class="pd-steps ${compact ? 'compact' : ''} tone-${a.tone}">${a.steps.map((label, i) => {
    const state = i < a.step || a.done ? 'done' : i === a.step ? 'now' : '';
    return `<li class="${state}"><span>${state === 'done' ? '<i class="ti ti-check"></i>' : i + 1}</span>${compact ? '' : `<b>${label}</b>`}</li>`;
  }).join('')}</ol>`;

  Object.assign(Tienda, {
    async verPedidos() {
      if (!this.cliente) return this.abrirAuth();
      this.cerrarModal();
      this.go('/tienda/mis-pedidos');
    },
    verPedidoDetalle(id) { this.go(`/tienda/pedido/${Number(id)}`); },

    // ── Lista ──
    async renderMisPedidos() {
      const host = document.getElementById('view-orders');
      this.pararSeguimiento();
      if (!this.cliente) {
        host.innerHTML = `<div class="rc-empty"><i class="ti ti-lock"></i><b>Inicia sesión para ver tus pedidos</b><button class="rc-btn" onclick="Tienda.abrirAuth()">Iniciar sesión</button></div>`;
        return;
      }
      host.innerHTML = `<nav class="rc-crumbs"><a href="/tienda">Inicio</a><i class="ti ti-chevron-right"></i><span>Mis pedidos</span></nav>
        <div class="rc-list-head"><h1 class="rc-title">Mis pedidos</h1></div>
        <div class="rc-chips" id="po-filter"></div><div id="po-list" class="po-list"><div class="po-skel"></div><div class="po-skel"></div></div>`;
      let d;
      try { d = await (await fetch(`${API}/mis-pedidos`, { credentials: 'include' })).json(); } catch (_) { d = { ok: false }; }
      const list = document.getElementById('po-list');
      if (!list) return;
      if (!d.ok) { list.innerHTML = this.vacio('cloud-off', 'No pudimos cargar tus pedidos', 'Intenta de nuevo en un momento.'); return; }
      const pedidos = d.pedidos || [];
      if (!pedidos.length) { list.innerHTML = `<div class="rc-empty"><i class="ti ti-package-off"></i><b>Aún no tienes pedidos</b><span>Cuando compres, aquí verás el avance de cada uno.</span><a class="rc-btn" href="/tienda/todos">Ver productos</a></div>`; return; }
      const enriched = pedidos.map(p => {
        const sucursales = (p.sucursales || []).map(s => ({ ...s, tipo_entrega: p.tipo_entrega }));
        return { p, sucursales, a: avanceGeneral(p, sucursales) };
      });
      const filtros = [['todos', 'Todos'], ['curso', 'En curso'], ['entregados', 'Entregados']];
      const paint = filtro => {
        document.getElementById('po-filter').innerHTML = filtros.map(([k, l]) => `<button class="rc-chip ${filtro === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');
        const rows = enriched.filter(({ a }) => filtro === 'todos' || (filtro === 'entregados' ? a.done : !a.done && a.tone !== 'bad'));
        list.innerHTML = rows.length ? rows.map(({ p, sucursales, a }) => `
          <a class="po-card rc-reveal in" href="/tienda/pedido/${Number(p.id)}">
            <div class="po-card-top">
              <div><b>${this.esc(p.numero_orden)}</b><small>${fecha(p.created_at)} · ${p.tipo_entrega === 'delivery' ? 'Delivery' : 'Recojo en tienda'} · ${Number(p.unidades || 0)} ${Number(p.unidades) === 1 ? 'producto' : 'productos'}</small></div>
              <div class="po-card-total">${money(p.total)}</div>
            </div>
            <div class="po-status tone-${a.tone}"><i class="ti ${a.icon}"></i>${this.esc(a.label)}</div>
            ${stepper(a, true)}
            ${sucursales.length > 1 ? `<div class="po-branches">${sucursales.map(s => { const sa = avance(p, s); return `<span class="tone-${sa.tone}"><i class="ti ${sa.icon}"></i>${this.esc(s.nombre)} · ${this.esc(sa.label)}</span>`; }).join('')}</div>` : ''}
            <span class="po-go">Ver seguimiento <i class="ti ti-arrow-right"></i></span>
          </a>`).join('') : '<div class="po-none">No hay pedidos en este filtro.</div>';
        document.querySelectorAll('#po-filter [data-f]').forEach(b => { b.onclick = () => paint(b.dataset.f); });
      };
      paint('todos');
    },

    // ── Seguimiento de un pedido ──
    async renderPedido(id, { silent = false } = {}) {
      const host = document.getElementById('view-orders');
      if (!silent) {
        this.pararSeguimiento();
        host.innerHTML = '<div class="po-skel big"></div><div class="po-skel"></div>';
      }
      if (!this.cliente) { this.renderMisPedidos(); return; }
      let d;
      try { d = await (await fetch(`${API}/mis-pedidos/${Number(id)}`, { credentials: 'include' })).json(); } catch (_) { d = { ok: false }; }
      if (this.currentPath() !== `/tienda/pedido/${Number(id)}`) return;    // el cliente ya cambió de vista
      if (!d.ok) { if (!silent) host.innerHTML = this.vacio('package-off', 'No encontramos ese pedido', ''); return; }
      const p = d.pedido, sucursales = d.sucursales || [];
      const general = avanceGeneral(p, sucursales);
      const multi = sucursales.length > 1;
      const enRuta = sucursales.some(s => s.ruta?.ubicacion);
      const pagoPendiente = ['pendiente', 'observado'].includes(String(p.estado_pago));

      const pagoBox = pagoPendiente ? `<div class="po-alert wait"><i class="ti ti-hourglass"></i><div><b>${p.estado_pago === 'observado' ? 'Revisamos tu pago y necesitamos una aclaración' : 'Estamos verificando tu pago'}</b>
          <span>${p.tiene_voucher ? 'Ya recibimos tu captura de pago.' : 'Si ya pagaste, sube la captura para aprobarlo más rápido.'}${p.reserva_expires_at ? ` Tus productos están reservados hasta las ${new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit' }).format(new Date(p.reserva_expires_at))}.` : ''}</span></div>
          <label class="rc-btn po-upload"><i class="ti ti-photo-up"></i>${p.tiene_voucher ? 'Cambiar captura' : 'Subir captura'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden onchange="Tienda.subirCaptura(${Number(p.id)},this)"></label></div>`
        : general.tone === 'bad' && p.rechazo_motivo ? `<div class="po-alert bad"><i class="ti ti-circle-x"></i><div><b>${this.esc(general.label)}</b><span>${this.esc(p.rechazo_motivo)}</span></div></div>` : '';

      const paquetes = sucursales.map((s, i) => {
        const a = avance(p, s);
        const delivery = s.tipo_entrega === 'delivery';
        const ruta = s.ruta;
        const route = s.lat && s.lng ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}` : '';
        let extra = '';
        if (!delivery && s.codigo_recojo && a.step >= 2 && !a.done) {
          extra += `<div class="po-code"><small>Código de recojo</small><b>${this.esc(s.codigo_recojo)}</b><span>Muéstralo en ${this.esc(s.nombre)} para recibir tu pedido.</span></div>`;
        }
        if (!delivery) {
          extra += `<div class="po-info">
            ${s.horario ? `<div><i class="ti ti-calendar-event"></i><span><b>${dia(s.horario.fecha)}</b> de ${this.esc(s.horario.hora_inicio)} a ${this.esc(s.horario.hora_fin)}</span></div>` : ''}
            <div><i class="ti ti-building-store"></i><span><b>${this.esc(s.nombre)}</b>${s.direccion ? `<br>${this.esc(s.direccion)}` : ''}</span></div>
            ${s.telefono ? `<div><i class="ti ti-phone"></i><span>${this.esc(s.telefono)}</span></div>` : ''}
          </div>${route ? `<a class="po-route" href="${route}" target="_blank" rel="noopener"><i class="ti ti-route"></i>Cómo llegar</a>` : ''}`;
        }
        if (delivery && ruta && !a.done) {
          const antes = Number(ruta.paradas_antes || 0);
          extra += `<div class="po-driver">
            <span class="po-driver-ico"><i class="ti ti-truck"></i></span>
            <div><b>${ruta.repartidor ? `${this.esc(ruta.repartidor)} lleva tu pedido` : 'Tu pedido está en una ruta de reparto'}</b>
              <span>${ruta.estado === 'en_ruta' ? (antes === 0 ? 'Eres su próxima entrega' : `${antes} ${antes === 1 ? 'entrega' : 'entregas'} antes de la tuya`) : 'La ruta saldrá pronto'}${ruta.placa ? ` · Placa ${this.esc(ruta.placa)}` : ''}</span></div>
            ${ruta.ubicacion ? `<span class="po-live"><i></i>En vivo</span>` : ''}
          </div>`;
          if (ruta.ubicacion) extra += `<div class="po-map" id="po-map-${i}"></div><div class="po-eta" id="po-eta-${i}"></div>`;
        }
        if (delivery && a.done && ruta?.entregado_at) extra += `<div class="po-info"><div><i class="ti ti-circle-check"></i><span>Entregado el ${fecha(ruta.entregado_at)}</span></div></div>`;
        return `<section class="po-pack">
          <header><div><small>${multi ? `Paquete ${i + 1} de ${sucursales.length}` : 'Tu paquete'}</small><h3>${this.esc(s.nombre)}</h3></div>
            <span class="po-status tone-${a.tone}"><i class="ti ${a.icon}"></i>${this.esc(a.label)}</span></header>
          ${stepper(a)}
          ${extra}
          <ul class="po-items">${s.items.map(it => `<li><span class="po-thumb">${it.imagen ? `<img src="${this.esc(it.imagen)}" alt="">` : '<i class="ti ti-paw"></i>'}</span><span class="po-item-name">${this.esc(it.nombre)}<small>${it.cantidad} × ${money(it.precio_unit)}</small></span><b>${money(it.subtotal)}</b></li>`).join('')}</ul>
        </section>`;
      }).join('');

      const dest = p.destino || {};
      host.innerHTML = `
        <nav class="rc-crumbs"><a href="/tienda">Inicio</a><i class="ti ti-chevron-right"></i><a href="/tienda/mis-pedidos">Mis pedidos</a><i class="ti ti-chevron-right"></i><span>${this.esc(p.numero_orden)}</span></nav>
        <div class="po-hero tone-${general.tone}">
          <div class="po-hero-top">
            <div><small>Pedido ${this.esc(p.numero_orden)} · ${fecha(p.created_at)}</small><h1><i class="ti ${general.icon}"></i>${this.esc(general.label)}</h1>
              <span>${multi ? `Tu compra sale de ${sucursales.length} sucursales; cada una te avisa su avance.` : p.tipo_entrega === 'delivery' ? 'Entrega a domicilio' : 'Recojo en tienda'}</span></div>
            <div class="po-hero-total"><small>Total</small><b>${money(p.total)}</b></div>
          </div>
          ${stepper(general)}
        </div>
        ${pagoBox}
        <div class="po-layout">
          <div class="po-packs">${paquetes}</div>
          <aside class="po-side">
            ${p.tipo_entrega === 'delivery' ? `<div class="po-box"><h4><i class="ti ti-map-pin"></i>Entrega en</h4><p>${this.esc(dest.direccion || 'Dirección registrada')}</p>${dest.referencia ? `<p class="muted">${this.esc(dest.referencia)}</p>` : ''}${dest.recibe ? `<p class="muted">Recibe: ${this.esc(dest.recibe)}</p>` : ''}</div>` : ''}
            <div class="po-box"><h4><i class="ti ti-receipt"></i>Resumen</h4>
              <div class="po-sum"><span>Productos</span><span>${money(p.subtotal || (Number(p.total) - Number(p.costo_delivery || 0)))}</span></div>
              ${p.tipo_entrega === 'delivery' ? `<div class="po-sum"><span>Delivery</span><span>${Number(p.costo_delivery) > 0 ? money(p.costo_delivery) : 'Gratis'}</span></div>` : ''}
              <div class="po-sum total"><span>Total</span><span>${money(p.total)}</span></div>
              <div class="po-sum"><span>Pago</span><span>${this.esc(METODO[p.metodo_pago] || p.metodo_pago)} · ${p.estado_pago === 'aprobado' ? '<b class="ok">Aprobado</b>' : this.esc(p.estado_pago)}</span></div>
              ${p.venta_numero ? `<div class="po-sum"><span>Comprobante</span><span>${this.esc(p.venta_numero)}</span></div>` : ''}
            </div>
            ${this.cfg?.whatsapp ? `<a class="po-help" href="https://wa.me/${this.cfg.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, consulto por mi pedido ${p.numero_orden}`)}" target="_blank" rel="noopener"><i class="ti ti-brand-whatsapp"></i>¿Dudas? Escríbenos</a>` : ''}
          </aside>
        </div>`;

      sucursales.forEach((s, i) => { if (s.ruta?.ubicacion) this.mapaRepartidor(i, s, dest); });
      // Mientras algo esté en camino o en preparación, la vista se actualiza sola.
      this.pararSeguimiento();
      if (!general.done && general.tone !== 'bad') {
        this._seguimiento = setTimeout(() => { if (!document.hidden) this.renderPedido(id, { silent: true }); else this.renderPedido(id, { silent: true }); }, enRuta ? REFRESH_MS : REFRESH_MS * 3);
      }
    },
    pararSeguimiento() { clearTimeout(this._seguimiento); this._seguimiento = null; },

    async mapaRepartidor(i, s, dest) {
      const host = document.getElementById(`po-map-${i}`);
      if (!host) return;
      let L;
      try { L = await MPMap.load(); } catch (_) { host.remove(); return; }
      const driver = s.ruta.ubicacion;
      const map = MPMap.create(L, host, { center: driver, zoom: 15 });
      const pts = [[driver.lat, driver.lng]];
      L.marker([driver.lat, driver.lng], { icon: L.divIcon({ className: 'po-pin-wrap', html: '<span class="po-pin-driver"><i class="ti ti-truck"></i></span>', iconSize: [46, 46], iconAnchor: [23, 23] }), zIndexOffset: 500 }).addTo(map);
      if (dest.lat && dest.lng) {
        L.marker([dest.lat, dest.lng], { icon: MPMap.pin(L, { color: '#dc2626', icon: 'ti-home', label: 'Tu dirección' }) }).addTo(map);
        pts.push([dest.lat, dest.lng]);
        L.polyline(pts, { color: '#15803d', weight: 3, dashArray: '6 8', opacity: .8 }).addTo(map);
        // Tiempo estimado: distancia en línea recta a ~22 km/h más 6 min por entrega previa.
        const km = MPMap.distanceKm(driver, { lat: dest.lat, lng: dest.lng });
        const min = Math.max(3, Math.round(km / 22 * 60 + Number(s.ruta.paradas_antes || 0) * 6));
        const eta = document.getElementById(`po-eta-${i}`);
        if (eta) eta.innerHTML = `<i class="ti ti-clock"></i>Llegada estimada en <b>${min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`}</b> · a ${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} de ti<span>Ubicación ${driver.hace_seg < 60 ? 'de hace instantes' : `de hace ${Math.round(driver.hace_seg / 60)} min`}</span>`;
      }
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [46, 46], maxZoom: 16 });
    },

    async subirCaptura(id, input) {
      const file = input.files?.[0];
      if (!file) return;
      if (!this.validarVoucher(file)) { input.value = ''; return; }
      const fd = new FormData(); fd.append('voucher', file);
      const label = input.closest('label'); label.classList.add('busy');
      try {
        const r = await fetch(`${API}/mis-pedidos/${Number(id)}/voucher`, { method: 'POST', credentials: 'include', body: fd });
        const d = await r.json();
        this.toast(d.ok ? 'Captura enviada. La revisaremos en breve.' : (d.msg || 'No se pudo subir la imagen'), d.ok ? 'ok' : 'err');
        if (d.ok) this.renderPedido(id);
      } catch (_) { this.toast('No se pudo subir la imagen', 'err'); }
      finally { label.classList.remove('busy'); input.value = ''; }
    }
  });
})();
