window.init_dashboard = async function initDashboard() {
  const root = document.getElementById('contenido');
  const C = window.MPCharts;
  const TZ = 'America/Lima';
  const isoDate = date => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const today = isoDate(new Date());
  const shiftDays = (iso, days) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const money = value => `S/ ${Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const moneyShort = value => Math.abs(Number(value || 0)) >= 10000 ? `S/ ${C.compact(value)}` : money(value);
  const integer = value => Number(value || 0).toLocaleString('es-PE');
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const shortDate = iso => { const [, m, d] = String(iso || '').split('-'); return m ? `${Number(d)} ${MONTHS[Number(m) - 1]}` : ''; };
  const longDate = iso => { const [y, m, d] = String(iso || '').split('-'); return m ? `${Number(d)} de ${MONTHS[Number(m) - 1]}. de ${y}` : ''; };
  const plural = (n, one, many) => `${integer(n)} ${Number(n) === 1 ? one : many}`;
  const PAYMENT = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia', izipay: 'POS Izipay', credito: 'Crédito' };
  const CHANNEL = { presencial: 'Tienda física', web: 'Tienda web' };
  const DOC = { boleta: ['Boleta', 'info'], factura: ['Factura', 'warn'], nota: ['Nota de venta', 'muted'], nota_venta: ['Nota de venta', 'muted'] };

  const PRESETS = [
    { id: 'hoy', label: 'Hoy', range: () => [today, today] },
    { id: '7d', label: '7 días', range: () => [shiftDays(today, -6), today] },
    { id: '30d', label: '30 días', range: () => [shiftDays(today, -29), today] },
    { id: 'mes', label: 'Este mes', range: () => [`${today.slice(0, 7)}-01`, today] }
  ];
  let [from, to] = PRESETS[3].range();

  root.innerHTML = `
    <div class="dx">
      <div class="dx-head">
        <div><h2>Resumen del negocio</h2><p id="dx-period"></p></div>
        <div class="dx-filters">
          <div class="dx-presets" role="group" aria-label="Periodo">${PRESETS.map(p => `<button type="button" data-preset="${p.id}">${p.label}</button>`).join('')}</div>
          <label class="dx-range" title="Rango personalizado"><i class="ti ti-calendar"></i><input id="dx-from" type="date" max="${today}" aria-label="Desde"><span>a</span><input id="dx-to" type="date" max="${today}" aria-label="Hasta"></label>
          <select id="dx-branch" class="dx-select" aria-label="Sucursal" hidden><option value="">Todas las sucursales</option></select>
        </div>
      </div>
      <div id="dx-body" class="dx-body"><div class="loading-center"><div class="spinner spinner-lg"></div></div></div>
    </div>`;

  const body = document.getElementById('dx-body');
  const fromInput = document.getElementById('dx-from');
  const toInput = document.getElementById('dx-to');
  const branchSelect = document.getElementById('dx-branch');

  if (window._esGlobal) {
    const branches = await Http.get('/sucursales');
    if (branches?.ok && branches.sucursales?.length) {
      branchSelect.innerHTML = '<option value="">Todas las sucursales</option>' + branches.sucursales.map(b => `<option value="${Number(b.id)}">${esc(b.nombre)}</option>`).join('');
      branchSelect.hidden = false;
    }
  }

  function syncControls() {
    fromInput.value = from; toInput.value = to; fromInput.max = to; toInput.min = from;
    const active = PRESETS.find(p => { const [a, b] = p.range(); return a === from && b === to; });
    document.querySelectorAll('[data-preset]').forEach(button => button.classList.toggle('on', button.dataset.preset === active?.id));
  }

  const delta = value => {
    const n = Number(value || 0);
    const cls = n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat';
    const icon = cls === 'up' ? 'ti-arrow-up-right' : cls === 'down' ? 'ti-arrow-down-right' : 'ti-minus';
    return `<span class="dx-delta ${cls}"><i class="ti ${icon}"></i>${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
  };

  const kpi = ({ label, value, foot, icon, tone, go, spark = '', meter = null, i }) => `
    <button type="button" class="dx-kpi" style="--i:${i};${tone ? `--tone:var(--mp-${tone});--tone-bg:var(--mp-${tone}-bg)` : ''}" onclick="Router.navegar('${go}')">
      <span class="dx-kpi-top"><span class="dx-kpi-label">${esc(label)}</span><span class="dx-kpi-icon"><i class="ti ${icon}"></i></span></span>
      <span class="dx-kpi-value">${value}</span>
      ${meter !== null ? `<span class="dx-meter"><i data-w="${Math.max(0, Math.min(100, meter)).toFixed(1)}"></i></span>` : ''}
      <span class="dx-kpi-foot"><small>${foot}</small>${spark}</span>
    </button>`;

  const card = (i, title, subtitle, content, action = '') => `
    <section class="dx-card" style="--i:${i}">
      <header class="dx-card-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${action}</header>
      ${content}
    </section>`;
  const link = (text, page) => `<button type="button" class="dx-link" onclick="Router.navegar('${page}')">${esc(text)}<i class="ti ti-chevron-right"></i></button>`;

  function todoList(k) {
    const items = [];
    if (k.pagosPendientes) items.push(['ti-credit-card', 'warn', 'Pagos web por verificar', plural(k.pagosPendientes, 'pago espera', 'pagos esperan') + ' revisión', 'pagos']);
    if (k.stockBajo) items.push(['ti-package-off', 'bad', 'Stock por reponer', plural(k.stockBajo, 'producto está', 'productos están') + ' bajo el mínimo', 'inventario']);
    if (k.comprobantesRevisar) items.push(['ti-file-alert', 'bad', 'Comprobantes por revisar', plural(k.comprobantesRevisar, 'comprobante', 'comprobantes') + ' sin aceptar en SUNAT', 'comprobantes']);
    if (k.incidenciasEntrega) items.push(['ti-truck-off', 'bad', 'Entregas con incidencia', plural(k.incidenciasEntrega, 'entrega necesita', 'entregas necesitan') + ' seguimiento', 'recojo']);
    if (k.cajasAbiertas) items.push(['ti-cash', 'info', 'Cajas abiertas', plural(k.cajasAbiertas, 'caja sigue', 'cajas siguen') + ' en turno', 'cajas']);
    if (!items.length) return `<div class="dx-allgood"><i class="ti ti-check"></i><span>Todo al día.<br>No hay pendientes que atender.</span></div>`;
    return `<div class="dx-todo">${items.map(([icon, tone, title, text, page]) => `
      <button type="button" onclick="Router.navegar('${page}')">
        <span class="dx-todo-icon" style="--tone:var(--mp-${tone});--tone-bg:var(--mp-${tone}-bg)"><i class="ti ${icon}"></i></span>
        <span><b>${esc(title)}</b><small>${esc(text)}</small></span><i class="ti ti-chevron-right"></i>
      </button>`).join('')}</div>`;
  }

  function channelSplit(rows) {
    const data = (rows || []).map(r => ({ label: CHANNEL[r.canal] || r.canal, value: Number(r.total || 0), n: Number(r.n || 0) })).filter(r => r.value > 0);
    const total = data.reduce((sum, r) => sum + r.value, 0);
    if (!total) return '<div class="mpc-empty"><i class="ti ti-chart-dots-3"></i><span>Sin ventas en el periodo</span></div>';
    return `
      <div class="dx-split-bar" role="img" aria-label="${esc(data.map(r => `${r.label} ${(r.value / total * 100).toFixed(0)}%`).join(', '))}">${data.map((r, i) => `<i data-w="${(r.value / total * 100).toFixed(2)}" style="background:${C.seriesColor(i)}"></i>`).join('')}</div>
      <div class="dx-split-list">${data.map((r, i) => `
        <div class="dx-split-item"><span><i style="background:${C.seriesColor(i)}"></i>${esc(r.label)}</span><b>${money(r.value)}</b><small>${(r.value / total * 100).toFixed(1)}% · ${plural(r.n, 'venta', 'ventas')}</small></div>`).join('')}</div>`;
  }

  function stockTable(rows) {
    if (!rows?.length) return `<div class="dx-allgood"><i class="ti ti-check"></i><span>Ningún producto está bajo su mínimo.</span></div>`;
    return `<div class="mp-table-wrap"><table class="mp-table"><thead><tr><th>Producto</th><th>Sucursal</th><th class="num">Stock / mínimo</th></tr></thead><tbody>${rows.map(r => {
      const actual = Number(r.stock_actual || 0), minimum = Number(r.stock_minimo || 0);
      return `<tr><td class="strong">${esc(r.nombre)}</td><td class="muted">${esc(r.sucursal_nombre || '—')}</td>
        <td class="num"><span class="mp-stockbar"><i style="--w:${minimum > 0 ? Math.min(100, actual / minimum * 100).toFixed(0) : 0}%"></i><span><b class="strong">${integer(actual)}</b> / ${integer(minimum)}</span></span></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function salesTable(rows) {
    if (!rows?.length) return '<div class="mpc-empty"><i class="ti ti-receipt-off"></i><span>Aún no hay ventas registradas</span></div>';
    return `<div class="mp-table-wrap"><table class="mp-table"><thead><tr><th>Documento</th><th>Cliente</th><th>Fecha</th><th class="num">Total</th></tr></thead><tbody>${rows.map(r => {
      const [docLabel, docTone] = DOC[r.tipo_comprobante] || ['Venta', 'muted'];
      const [date, time] = String(r.created_at || '').split('T');
      return `<tr>
        <td><div class="cell-main"><span class="strong">${esc(r.numero)}</span><span><span class="mp-chip ${docTone}">${docLabel}</span></span></div></td>
        <td><div class="cell-main"><span>${esc(r.cliente_nombre || 'Cliente general')}</span><span class="muted">${esc(r.sucursal_nombre || '')}</span></div></td>
        <td class="muted">${date === today ? 'Hoy' : esc(shortDate(date))}${time ? ` · ${esc(time.slice(0, 5))}` : ''}</td>
        <td class="num strong">${money(r.total)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  let requestId = 0;
  async function load() {
    syncControls();
    const current = ++requestId;
    const query = new URLSearchParams({ desde: from, hasta: to });
    if (branchSelect.value) query.set('sucursal_id', branchSelect.value);
    body.classList.add('loading');           // se conserva el render anterior, atenuado
    const data = await Http.get(`/dashboard/resumen?${query}`);
    if (current !== requestId || !document.body.contains(body)) return;
    body.classList.remove('loading');
    if (!data?.ok) {
      body.innerHTML = `<div class="dx-card"><div class="mpc-empty"><i class="ti ti-cloud-off"></i><span>${esc(data?.msg || 'No se pudo cargar el resumen')}</span></div></div>`;
      return;
    }

    const k = data.kpis || {};
    const profit = data.rentabilidad;
    const series = data.serie14 || [];
    const period = data.periodo || {};
    const sameDay = from === to;
    document.getElementById('dx-period').textContent = sameDay ? longDate(from) : `Del ${longDate(from)} al ${longDate(to)}`;

    const daysWithSales = series.filter(r => Number(r.n) > 0);
    const dailyTickets = daysWithSales.map(r => Number(r.total) / Number(r.n));
    const recentTotals = series.slice(-14).map(r => Number(r.total || 0));
    const bestDay = daysWithSales.reduce((best, r) => (!best || Number(r.total) > Number(best.total) ? r : best), null);

    const kpis = [
      { label: 'Ventas de hoy', value: money(k.ventasHoyMonto), foot: plural(k.ventasHoyCount || 0, 'operación', 'operaciones'), icon: 'ti-calendar-dollar', go: 'ventas', spark: C.spark(recentTotals) },
      { label: 'Ticket promedio', value: money(k.ticketPromedio), foot: 'por venta en el periodo', icon: 'ti-receipt-2', tone: 'info', go: 'reportes', spark: C.spark(dailyTickets.slice(-14)) }
    ];
    if (profit) kpis.push({ label: 'Margen bruto', value: money(profit.margen_bruto), foot: `${Number(profit.margen_pct || 0).toFixed(1)}% de lo vendido`, icon: 'ti-chart-pie-2', go: 'rentabilidad', meter: Number(profit.margen_pct || 0) });
    kpis.push(
      { label: 'Entregas en curso', value: integer(k.entregasActivas), foot: Number(k.incidenciasEntrega) ? plural(k.incidenciasEntrega, 'incidencia', 'incidencias') : 'sin incidencias', icon: 'ti-truck-delivery', tone: Number(k.incidenciasEntrega) ? 'bad' : 'info', go: 'recojo' },
      { label: 'Stock bajo mínimo', value: integer(k.stockBajo), foot: `de ${plural(k.productos || 0, 'producto activo', 'productos activos')}`, icon: 'ti-package', tone: Number(k.stockBajo) ? 'bad' : 'good', go: 'inventario' },
      { label: 'Clientes', value: integer(k.clientes), foot: 'registrados', icon: 'ti-users', tone: 'info', go: 'clientes' }
    );

    const quotes = data.cotizaciones || {}, receipts = data.comprobantes || {}, cash = data.caja || {};
    let i = 0;
    body.innerHTML = `
      <div class="dx-row hero">
        <section class="dx-card" style="--i:${i++}">
          <div class="dx-hero-top">
            <div>
              <div class="dx-hero-label">Ventas del periodo</div>
              <div class="dx-hero-value" id="dx-hero-value">${money(0)}</div>
              <div class="dx-hero-meta">${delta(k.variacionVentas)}<span>frente al periodo anterior${period.anterior_desde ? ` (${esc(shortDate(period.anterior_desde))} – ${esc(shortDate(period.anterior_hasta))})` : ''}</span></div>
            </div>
            <div class="dx-hero-side">
              <div><small>Operaciones</small><b>${integer(k.ventasMesCount)}</b></div>
              ${bestDay && !sameDay ? `<div><small>Mejor día</small><b>${esc(shortDate(bestDay.fecha))}</b></div>` : ''}
            </div>
          </div>
          <div id="dx-sales"></div>
        </section>
        ${card(i++, 'Por atender', 'Pendientes que necesitan una acción', todoList(k))}
      </div>
      <div class="dx-kpis" style="--cols:${kpis.length}">${kpis.map(item => kpi({ ...item, i: i++ })).join('')}</div>
      <div class="dx-row wide-left">
        ${card(i++, 'Ventas por hora', 'Importe vendido según la hora del día', '<div id="dx-hours"></div>')}
        ${card(i++, 'Métodos de pago', 'Cómo pagaron los clientes', '<div id="dx-methods"></div>', link('Caja', 'cajas'))}
      </div>
      <div class="dx-row two">
        ${card(i++, 'Productos más vendidos', 'Unidades vendidas en el periodo', '<div id="dx-top"></div>', link('Reportes', 'reportes'))}
        ${card(i++, 'Canales de venta', 'Tienda física frente a tienda web', `${channelSplit(data.canales)}
          <div class="dx-mini">
            <div><small>Cotizaciones</small><b>${integer(quotes.total)}</b><span>${integer(quotes.vigentes)} vigentes</span></div>
            <div><small>Comprobantes</small><b>${integer(receipts.total)}</b><span>${integer(receipts.aceptados)} aceptados</span></div>
            <div><small>Turnos de caja</small><b>${integer(cash.turnos)}</b><span>${integer(cash.abiertas)} abiertos</span></div>
          </div>`)}
      </div>
      ${data.porSucursal?.length > 1 ? card(i++, 'Ventas por sucursal', 'Importe acumulado de cada sede', '<div id="dx-branches"></div>') : ''}
      <div class="dx-row two">
        ${card(i++, 'Últimas ventas', 'Movimientos más recientes', salesTable(data.ultimasVentas), link('Ver ventas', 'ventas'))}
        ${card(i++, 'Productos por reponer', 'Stock actual frente al mínimo definido', stockTable(data.stockBajoLista), link('Inventario', 'inventario'))}
      </div>`;

    C.countUp(document.getElementById('dx-hero-value'), k.ventasMesMonto, money);
    C.area(document.getElementById('dx-sales'), {
      name: 'Ventas', format: money, height: sameDay ? 200 : 270,
      emptyText: 'Sin ventas en el periodo seleccionado',
      rows: series.map(r => ({ label: shortDate(r.fecha), title: longDate(r.fecha), value: Number(r.total || 0), sub: plural(r.n || 0, 'venta', 'ventas') }))
    });

    const byHour = new Map((data.horas || []).map(r => [Number(r.hora), r]));
    const hoursUsed = [...byHour.keys()];
    const firstHour = Math.min(7, ...hoursUsed), lastHour = Math.max(21, ...hoursUsed);
    C.columns(document.getElementById('dx-hours'), {
      name: 'Ventas', format: money, emptyText: 'Sin ventas en el periodo seleccionado',
      rows: Array.from({ length: lastHour - firstHour + 1 }, (_, index) => {
        const hour = firstHour + index, row = byHour.get(hour) || {};
        const hh = String(hour).padStart(2, '0');
        return { label: hh, title: `${hh}:00 – ${hh}:59`, value: Number(row.total || 0), sub: plural(row.n || 0, 'venta', 'ventas') };
      })
    });
    C.donut(document.getElementById('dx-methods'), {
      format: money, centerFormat: moneyShort, centerLabel: 'Cobrado',
      rows: (data.metodos || []).map(r => ({ label: PAYMENT[r.m] || r.m || 'Otro', value: Number(r.s || 0), sub: plural(r.n || 0, 'venta', 'ventas') }))
    });
    C.bars(document.getElementById('dx-top'), {
      format: value => `${integer(value)} uds.`, emptyText: 'Sin productos vendidos en el periodo',
      rows: (data.topProductos || []).map(r => ({ label: r.nombre, value: Number(r.cant || 0), sub: money(r.s) }))
    });
    const branchesHost = document.getElementById('dx-branches');
    if (branchesHost) C.bars(branchesHost, { format: money, rows: data.porSucursal.map(r => ({ label: r.nombre, value: Number(r.total || 0), sub: plural(r.n || 0, 'venta', 'ventas') })) });

    // Barras de proporción: crecen desde cero al aparecer.
    requestAnimationFrame(() => body.querySelectorAll('[data-w]').forEach(node => node.style.setProperty('--w', `${node.dataset.w}%`)));
  }

  document.querySelectorAll('[data-preset]').forEach(button => {
    button.onclick = () => { [from, to] = PRESETS.find(p => p.id === button.dataset.preset).range(); load(); };
  });
  const applyCustom = () => {
    const a = fromInput.value, b = toInput.value;
    if (!a || !b) return;
    if (a > b || b > today) {
      syncControls();
      return Swal.fire({ icon: 'warning', title: 'Rango de fechas inválido', text: 'La fecha inicial debe ser anterior a la final y ninguna puede ser futura.' });
    }
    from = a; to = b; load();
  };
  fromInput.onchange = applyCustom;
  toInput.onchange = applyCustom;
  branchSelect.onchange = load;

  await load();
};
