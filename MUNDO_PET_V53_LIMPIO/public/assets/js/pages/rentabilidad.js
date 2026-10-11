window.init_rentabilidad = async function initRentabilidad() {
  const root = document.getElementById('contenido');
  const C = window.MPCharts;
  const TZ = 'America/Lima';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shiftDays = (iso, days) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const money = value => `${Number(value) < 0 ? '−' : ''}S/ ${Math.abs(Number(value || 0)).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const moneyShort = value => Math.abs(Number(value || 0)) >= 10000 ? `S/ ${C.compact(value)}` : money(value);
  const integer = value => Number(value || 0).toLocaleString('es-PE');
  const pct = value => `${Number(value || 0).toFixed(1)}%`;
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const shortDate = iso => { const [, m, d] = String(iso || '').split('-'); return m ? `${Number(d)} ${MONTHS[Number(m) - 1]}` : ''; };
  const longDate = iso => { const [y, m, d] = String(iso || '').split('-'); return m ? `${Number(d)} de ${MONTHS[Number(m) - 1]}. de ${y}` : ''; };
  const plural = (n, one, many) => `${integer(n)} ${Number(n) === 1 ? one : many}`;
  const PAYMENT = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia', izipay: 'POS Izipay', credito: 'Crédito' };
  const CHANNEL = { presencial: 'Tienda física', web: 'Tienda web' };
  const ALERT = { sin_costo: 'Sin costo registrado', costo_mayor_venta: 'Costo mayor que el precio', margen_bajo: 'Margen muy bajo', sin_precio: 'Sin precio de venta' };

  const PRESETS = [
    { id: '7d', label: '7 días', range: () => [shiftDays(today, -6), today] },
    { id: '30d', label: '30 días', range: () => [shiftDays(today, -29), today] },
    { id: 'mes', label: 'Este mes', range: () => [`${today.slice(0, 7)}-01`, today] },
    { id: 'anio', label: 'Este año', range: () => [`${today.slice(0, 4)}-01-01`, today] }
  ];
  let [from, to] = PRESETS[2].range();

  root.innerHTML = `
    <div class="dx">
      <div class="dx-head">
        <div><h2>Rentabilidad</h2><p id="rn-period"></p></div>
        <div class="dx-filters">
          <div class="dx-presets" role="group" aria-label="Periodo">${PRESETS.map(p => `<button type="button" data-preset="${p.id}">${p.label}</button>`).join('')}</div>
          <label class="dx-range" title="Rango personalizado"><i class="ti ti-calendar"></i><input id="rn-from" type="date" max="${today}" aria-label="Desde"><span>a</span><input id="rn-to" type="date" max="${today}" aria-label="Hasta"></label>
          <select id="rn-branch" class="dx-select" aria-label="Sucursal" hidden><option value="">Todas las sucursales</option></select>
        </div>
      </div>
      <div id="rn-body" class="dx-body"><div class="loading-center"><div class="spinner spinner-lg"></div></div></div>
    </div>`;

  const body = document.getElementById('rn-body');
  const fromInput = document.getElementById('rn-from');
  const toInput = document.getElementById('rn-to');
  const branchSelect = document.getElementById('rn-branch');

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

  const card = (i, title, subtitle, content, action = '') => `
    <section class="dx-card" style="--i:${i}">
      <header class="dx-card-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${action}</header>
      ${content}
    </section>`;

  const tile = ({ label, value, foot, icon, tone, i }) => `
    <div class="dx-kpi rn-tile" style="--i:${i};${tone ? `--tone:var(--mp-${tone});--tone-bg:var(--mp-${tone}-bg)` : ''}">
      <span class="dx-kpi-top"><span class="dx-kpi-label">${esc(label)}</span><span class="dx-kpi-icon"><i class="ti ${icon}"></i></span></span>
      <span class="dx-kpi-value">${value}</span>
      <span class="dx-kpi-foot"><small>${foot}</small></span>
    </div>`;

  // Cuenta de resultados en una sola lectura: de lo vendido a lo que queda.
  function statement(k) {
    const base = Math.max(Number(k.ingresos) || 0, 1);
    const rows = [
      { label: 'Ventas', hint: `${plural(k.ventas, 'venta', 'ventas')} · ${plural(k.unidades, 'unidad', 'unidades')}`, value: k.ingresos, kind: 'in' },
      { label: 'Costo de lo vendido', hint: 'Lo que costó la mercadería que salió', value: -k.costo, kind: 'out' },
      { label: 'Margen bruto', hint: `${pct(k.margen_pct)} de cada sol vendido`, value: k.margen_bruto, kind: 'sub' },
      { label: 'Gastos de caja', hint: 'Egresos registrados en caja', value: -k.egresos, kind: 'out' },
      { label: 'Resultado', hint: k.resultado_estimado >= 0 ? 'Lo que quedó de ganancia' : 'Lo que faltó para cubrir costos y gastos', value: k.resultado_estimado, kind: 'total' }
    ];
    return `<div class="rn-statement">${rows.map(row => {
      const amount = Number(row.value || 0);
      const negative = amount < 0;
      const width = Math.min(100, Math.abs(amount) / base * 100);
      const tone = row.kind === 'out' ? 'out' : negative ? 'loss' : row.kind === 'in' ? 'in' : 'gain';
      return `<div class="rn-line ${row.kind}">
        <div class="rn-line-text"><b>${esc(row.label)}</b><small>${esc(row.hint)}</small></div>
        <div class="rn-line-bar"><i class="${tone}" data-w="${width.toFixed(2)}"></i></div>
        <div class="rn-line-value ${negative && row.kind !== 'out' ? 'loss' : ''}">${row.kind === 'out' && amount !== 0 ? '− ' + money(Math.abs(amount)) : money(amount)}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function dailyTable(rows) {
    if (!rows?.length) return '';
    return `<details class="rn-details"><summary>Ver el detalle día por día</summary>
      <div class="mp-table-wrap"><table class="mp-table"><thead><tr><th>Fecha</th><th class="num">Ventas</th><th class="num">Costo</th><th class="num">Margen</th><th class="num">Margen %</th></tr></thead><tbody>${rows.map(r => {
        const income = Number(r.ingresos || 0), margin = Number(r.margen || 0);
        return `<tr><td>${esc(longDate(r.fecha))}</td><td class="num">${money(income)}</td><td class="num">${money(r.costo)}</td><td class="num strong" style="color:var(${margin >= 0 ? '--mp-good' : '--mp-bad'})">${money(margin)}</td><td class="num muted">${income ? pct(margin / income * 100) : '—'}</td></tr>`;
      }).join('')}</tbody></table></div></details>`;
  }

  function productTable(rows) {
    if (!rows?.length) return '<div class="mpc-empty"><i class="ti ti-package-off"></i><span>Sin productos vendidos en el periodo</span></div>';
    return `<div class="mp-table-wrap"><table class="mp-table"><thead><tr><th>Producto</th><th class="num">Unidades</th><th class="num">Ventas</th><th class="num">Costo</th><th class="num">Ganancia</th><th class="num">Margen</th></tr></thead><tbody>${rows.slice(0, 12).map(r => {
      const margin = Number(r.margen || 0), mp = Number(r.margen_pct || 0);
      const tone = margin < 0 ? 'bad' : mp < 15 ? 'warn' : 'good';
      return `<tr><td><div class="cell-main"><span class="strong">${esc(r.nombre)}</span><span class="muted">${esc(r.sucursal_nombre || '')}</span></div></td>
        <td class="num">${integer(r.unidades)}</td><td class="num">${money(r.ingresos)}</td><td class="num">${money(r.costo)}</td>
        <td class="num strong">${money(margin)}</td><td class="num">${Number(r.costo) > 0 ? `<span class="mp-chip ${tone}">${pct(mp)}</span>` : '<span class="mp-chip warn" title="Sin costo registrado, el margen no es real">Sin costo</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function alertTable(rows) {
    if (!rows?.length) return `<div class="dx-allgood"><i class="ti ti-check"></i><span>Todos los productos tienen costo y precio coherentes.</span></div>`;
    return `<div class="mp-table-wrap"><table class="mp-table"><thead><tr><th>Producto</th><th class="num">Costo</th><th class="num">Precio</th><th>Qué revisar</th></tr></thead><tbody>${rows.map(r => `
      <tr><td><div class="cell-main"><span class="strong">${esc(r.nombre)}</span><span class="muted">${esc(r.sucursal_nombre || '')}</span></div></td>
        <td class="num">${money(r.precio_costo)}</td><td class="num">${money(r.precio_venta)}</td>
        <td><span class="mp-chip warn"><i class="ti ti-alert-triangle"></i>${esc(ALERT[r.tipo] || String(r.tipo || '').replaceAll('_', ' '))}</span></td></tr>`).join('')}</tbody></table></div>`;
  }

  function channelBlock(rows) {
    const data = (rows || []).filter(r => Number(r.ingresos) > 0);
    if (!data.length) return '<div class="mpc-empty"><i class="ti ti-chart-dots-3"></i><span>Sin ventas en el periodo</span></div>';
    const total = data.reduce((sum, r) => sum + Number(r.ingresos), 0);
    return `
      <div class="dx-split-bar" role="img" aria-label="Ventas por canal">${data.map((r, i) => `<i data-w="${(Number(r.ingresos) / total * 100).toFixed(2)}" style="background:${C.seriesColor(i)}"></i>`).join('')}</div>
      <div class="mp-table-wrap"><table class="mp-table"><thead><tr><th>Canal</th><th class="num">Ventas</th><th class="num">Importe</th><th class="num">Ganancia</th></tr></thead><tbody>${data.map((r, i) => `
        <tr><td><span style="display:inline-flex;align-items:center;gap:8px"><i style="width:10px;height:10px;border-radius:3px;background:${C.seriesColor(i)}"></i><span class="strong">${esc(CHANNEL[r.canal] || r.canal)}</span></span></td>
          <td class="num">${integer(r.ventas)}</td><td class="num">${money(r.ingresos)}</td><td class="num strong" style="color:var(${Number(r.margen) >= 0 ? '--mp-good' : '--mp-bad'})">${money(r.margen)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  let requestId = 0;
  async function load() {
    syncControls();
    const current = ++requestId;
    const query = new URLSearchParams({ desde: from, hasta: to });
    if (branchSelect.value) query.set('sucursal_id', branchSelect.value);
    body.classList.add('loading');
    const data = await Http.get(`/rentabilidad/resumen?${query}`);
    if (current !== requestId || !document.body.contains(body)) return;
    body.classList.remove('loading');
    if (!data?.ok) {
      body.innerHTML = `<div class="dx-card"><div class="mpc-empty"><i class="ti ti-cloud-off"></i><span>${esc(data?.msg || 'No se pudo cargar la rentabilidad')}</span></div></div>`;
      return;
    }

    const k = data.kpis || {};
    const result = Number(k.resultado_estimado || 0);
    const noSales = !Number(k.ventas);
    const gain = result >= 0;
    document.getElementById('rn-period').textContent = from === to ? longDate(from) : `Del ${longDate(from)} al ${longDate(to)}`;

    const verdict = noSales
      ? { cls: 'flat', icon: 'ti-moon', title: 'Sin ventas en el periodo', text: 'No hay ventas registradas entre estas fechas, así que todavía no hay resultado que mostrar.' }
      : gain
        ? { cls: 'gain', icon: 'ti-trending-up', title: 'El negocio ganó', text: `Después de cubrir el costo de la mercadería y los gastos de caja, quedaron ${money(result)}. De cada S/ 100 vendidos, ${(Number(k.ingresos) ? result / Number(k.ingresos) * 100 : 0).toFixed(0)} fueron ganancia.` }
        : { cls: 'loss', icon: 'ti-trending-down', title: 'El negocio perdió', text: `Las ventas no alcanzaron para cubrir el costo de la mercadería y los gastos de caja. Faltaron ${money(Math.abs(result))}.` };

    const tiles = [
      { label: 'Margen sobre ventas', value: pct(k.margen_pct), foot: 'ganancia bruta por cada sol vendido', icon: 'ti-percentage', tone: Number(k.margen_pct) >= 20 ? 'good' : Number(k.margen_pct) > 0 ? 'warn' : 'bad' },
      { label: 'Ticket promedio', value: money(k.ticket_promedio), foot: 'importe medio por venta', icon: 'ti-receipt-2', tone: 'info' },
      { label: 'Retorno del periodo', value: pct(k.roi_periodo), foot: 'ganancia frente a lo invertido en costo y gastos', icon: 'ti-arrow-back-up', tone: Number(k.roi_periodo) >= 0 ? 'good' : 'bad' },
      { label: 'Punto de equilibrio', value: money(k.punto_equilibrio), foot: Number(k.punto_equilibrio) ? (Number(k.ingresos) >= Number(k.punto_equilibrio) ? 'ya se superó con las ventas del periodo' : `faltan ${money(Number(k.punto_equilibrio) - Number(k.ingresos))} en ventas`) : 'sin gastos de caja que cubrir', icon: 'ti-scale', tone: Number(k.ingresos) >= Number(k.punto_equilibrio) ? 'good' : 'warn' }
    ];

    let i = 0;
    body.innerHTML = `
      <div class="dx-row hero">
        <section class="dx-card rn-verdict ${verdict.cls}" style="--i:${i++}">
          <div class="rn-verdict-head">
            <span class="rn-verdict-icon"><i class="ti ${verdict.icon}"></i></span>
            <div><div class="dx-hero-label">${esc(verdict.title)}</div><div class="dx-hero-value" id="rn-result">${money(0)}</div></div>
          </div>
          <p class="rn-verdict-text">${esc(verdict.text)}</p>
          ${noSales ? '' : statement(k)}
        </section>
        <div class="rn-side">${tiles.map(item => tile({ ...item, i: i++ })).join('')}</div>
      </div>
      ${Number(k.items_costo_inconsistente) ? `<div class="rn-note" style="--i:${i++}"><i class="ti ti-alert-triangle"></i><div><b>${plural(k.items_costo_inconsistente, 'línea vendida tiene', 'líneas vendidas tienen')} un costo mayor que su precio.</b><span>${esc(data.nota_costos || '')}</span></div></div>` : ''}
      ${card(i++, 'Ganancia día por día', 'Margen bruto de cada día. Los puntos rojos son días con pérdida.', `<div id="rn-daily"></div>${dailyTable(data.diario)}`)}
      <div class="dx-row wide-left">
        ${card(i++, 'Ganancia por producto', 'Qué productos sostienen el resultado', productTable(data.productos))}
        ${card(i++, 'Por canal de venta', 'Tienda física frente a tienda web', channelBlock(data.canales))}
      </div>
      <div class="dx-row two">
        ${card(i++, 'Cómo se cobró', 'Importe recibido por cada medio de pago', '<div id="rn-payments"></div>')}
        ${card(i++, 'Dinero en inventario', 'Lo que hay hoy en stock y lo que rendiría al venderse', `
          <div class="rn-inventory">
            <div><small>Invertido en stock</small><b>${money(k.inversion_inventario)}</b><span>a precio de costo</span></div>
            <div><small>Valor si se vende todo</small><b>${money(k.valor_venta_inventario)}</b><span>a precio de venta</span></div>
            <div class="accent"><small>Ganancia potencial</small><b>${money(k.ganancia_potencial_inventario)}</b><span>${plural(k.productos_criticos || 0, 'producto bajo', 'productos bajo')} mínimo de ${integer(k.productos_activos)}</span></div>
          </div>`)}
      </div>
      ${data.sucursales?.length > 1 ? card(i++, 'Ganancia por sucursal', 'Margen bruto de cada sede en el periodo', '<div id="rn-branches"></div>') : ''}
      ${card(i++, 'Costos y precios por revisar', 'Datos que pueden estar distorsionando la ganancia', alertTable(data.alertas))}`;

    C.countUp(document.getElementById('rn-result'), Math.abs(result), value => money(gain ? value : -value));
    C.area(document.getElementById('rn-daily'), {
      name: 'Margen', format: money, height: 250, emptyText: 'Sin movimiento en el periodo seleccionado',
      rows: (data.diario || []).map(r => ({ label: shortDate(r.fecha), title: longDate(r.fecha), value: Number(r.margen || 0), sub: `de ${money(r.ingresos)} vendidos` }))
    });
    C.donut(document.getElementById('rn-payments'), {
      format: money, centerFormat: moneyShort, centerLabel: 'Cobrado',
      rows: (data.medios_pago || []).map(r => ({ label: PAYMENT[r.metodo] || r.metodo, value: Number(r.monto || 0), sub: plural(r.operaciones || 0, 'pago', 'pagos') }))
    });
    const branchesHost = document.getElementById('rn-branches');
    if (branchesHost) C.bars(branchesHost, { format: money, rows: data.sucursales.map(r => ({ label: r.nombre, value: Math.max(0, Number(r.margen || 0)), sub: `de ${money(r.ingresos)} vendidos` })) });

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
