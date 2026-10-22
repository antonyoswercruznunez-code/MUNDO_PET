/*
 * MPQueue — orden y agrupación común de pedidos para Recojo en tienda y
 * Logística. Las dos listas se ven igual:
 *
 *   1. Agrupadas por etapa, en el orden en que se trabajan:
 *      Con incidencia → Por preparar → Preparando → Listos → En ruta → Entregados.
 *   2. Dentro de cada etapa, primero lo que vence antes: el recojo con hora
 *      más próxima y, si no tiene hora, el pedido más antiguo (se atiende en
 *      orden de llegada).
 *   3. Los paquetes de un mismo pedido quedan juntos y se marcan "1 de 3".
 */
(function () {
  const STAGES = [
    { key: 'incidencia', label: 'Con incidencia', icon: 'ti-alert-triangle', tone: 'bad' },
    { key: 'pendiente', label: 'Por preparar', icon: 'ti-clock', tone: 'wait' },
    { key: 'preparando', label: 'Preparando', icon: 'ti-package', tone: 'info' },
    { key: 'listo', label: 'Listos', icon: 'ti-circle-check', tone: 'ok' },
    { key: 'asignado', label: 'Asignados a ruta', icon: 'ti-route', tone: 'info' },
    { key: 'en_ruta', label: 'En ruta', icon: 'ti-truck-delivery', tone: 'info' },
    { key: 'entregado', label: 'Entregados', icon: 'ti-checks', tone: 'done' },
    { key: 'cancelado', label: 'Cancelados', icon: 'ti-circle-x', tone: 'done' }
  ];
  const RANK = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));
  const CLOSED = new Set(['entregado', 'cancelado']);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = v => { const t = new Date(String(v || '').replace(' ', 'T')).getTime(); return Number.isFinite(t) ? t : 0; };

  /*
   * opts.state(row)   etapa de la fila
   * opts.created(row) fecha del pedido
   * opts.due(row)     fecha y hora límite (recojo programado), opcional
   * opts.order(row)   identificador del pedido (para juntar sus paquetes)
   * opts.branch(row)  nombre de la sucursal
   */
  function sort(rows, opts) {
    const firstSeen = new Map();
    rows.forEach(r => {
      const key = opts.order(r);
      const t = time(opts.created(r));
      if (!firstSeen.has(key) || t < firstSeen.get(key)) firstSeen.set(key, t);
    });
    return [...rows].sort((a, b) => {
      const sa = RANK[opts.state(a)] ?? 99, sb = RANK[opts.state(b)] ?? 99;
      if (sa !== sb) return sa - sb;
      const closed = CLOSED.has(opts.state(a));
      const da = opts.due ? time(opts.due(a)) : 0, db = opts.due ? time(opts.due(b)) : 0;
      if (!closed && da && db && da !== db) return da - db;
      if (!closed && (da || db) && !(da && db)) return da ? -1 : 1;
      const oa = firstSeen.get(opts.order(a)), ob = firstSeen.get(opts.order(b));
      if (oa !== ob) return closed ? ob - oa : oa - ob;             // abiertos: el más antiguo primero; cerrados: el más reciente
      if (String(opts.order(a)) !== String(opts.order(b))) return String(opts.order(a)).localeCompare(String(opts.order(b)), 'es', { numeric: true });
      return String(opts.branch(a) || '').localeCompare(String(opts.branch(b) || ''), 'es');
    });
  }

  // Cuántos paquetes (sucursales) tiene cada pedido dentro de la lista.
  function packages(rows, orderKey) {
    const total = new Map();
    rows.forEach(r => total.set(orderKey(r), (total.get(orderKey(r)) || 0) + 1));
    const seen = new Map();
    return r => {
      const key = orderKey(r);
      const n = total.get(key) || 1;
      if (n < 2) return null;
      if (!seen.has(r)) {
        const index = rows.filter(x => orderKey(x) === key).indexOf(r) + 1;
        seen.set(r, index);
      }
      return { index: seen.get(r), total: n };
    };
  }

  // Antigüedad legible: "hace 25 min", "hace 3 h", "hace 2 días".
  function age(value) {
    const t = time(value);
    if (!t) return { text: '', late: false };
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    const text = min < 1 ? 'recién' : min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} ${Math.round(min / 1440) === 1 ? 'día' : 'días'}`;
    return { text, late: min >= 24 * 60 };
  }

  // Barra de filtros por etapa con contadores. "Activos" oculta lo cerrado.
  function chips(host, rows, stateOf, active, onChange, keys = null) {
    const counts = {};
    rows.forEach(r => { const s = stateOf(r); counts[s] = (counts[s] || 0) + 1; });
    const open = rows.filter(r => !CLOSED.has(stateOf(r))).length;
    const list = [{ key: 'activos', label: 'Activos', count: open, tone: 'all' },
      ...STAGES.filter(s => (keys ? keys.includes(s.key) : true) && (counts[s.key] || s.key === 'pendiente' || s.key === 'listo')).map(s => ({ ...s, count: counts[s.key] || 0 })),
      { key: 'todos', label: 'Todos', count: rows.length, tone: 'all' }];
    host.innerHTML = list.map(c => `<button type="button" class="oq-chip tone-${c.tone} ${active === c.key ? 'on' : ''}" data-k="${c.key}">${c.icon ? `<i class="ti ${c.icon}"></i>` : ''}${esc(c.label)}<b>${c.count}</b></button>`).join('');
    host.querySelectorAll('[data-k]').forEach(b => { b.onclick = () => onChange(b.dataset.k); });
  }

  function filter(rows, stateOf, active) {
    if (active === 'todos') return rows;
    if (active === 'activos') return rows.filter(r => !CLOSED.has(stateOf(r)));
    return rows.filter(r => stateOf(r) === active);
  }

  // Filas de tabla con un encabezado por etapa.
  function tableRows(rows, stateOf, colspan, renderRow) {
    let current = null;
    const counts = {};
    rows.forEach(r => { counts[stateOf(r)] = (counts[stateOf(r)] || 0) + 1; });
    return rows.map(r => {
      const s = stateOf(r);
      let head = '';
      if (s !== current) {
        current = s;
        const st = STAGES.find(x => x.key === s) || { label: s, icon: 'ti-point', tone: 'info' };
        head = `<tr class="oq-group tone-${st.tone}"><td colspan="${colspan}"><i class="ti ${st.icon}"></i>${esc(st.label)}<b>${counts[s]}</b></td></tr>`;
      }
      return head + renderRow(r);
    }).join('');
  }

  window.MPQueue = { STAGES, sort, packages, age, chips, filter, tableRows, CLOSED };
})();
