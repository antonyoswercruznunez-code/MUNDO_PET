/*
 * MPCharts — gráficos del panel en SVG, sin dependencias.
 *
 * Todos comparten las mismas reglas: marcas finas, rejilla tenue, texto en
 * tinta neutra (el color solo identifica la serie), tooltip que nunca es la
 * única forma de leer un valor y animación de entrada que se desactiva si el
 * usuario pidió menos movimiento. Los colores salen de variables CSS (.mpc-*)
 * para que el modo oscuro tenga sus propios tonos.
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const SERIES = 6; // --mpc-s1 … --mpc-s6, orden fijo validado para daltonismo
  const seriesColor = index => `var(--mpc-s${(index % SERIES) + 1})`;

  // Escala "limpia": 0 / 500 / 1,000 en vez de 0 / 437.5 / 875.
  function niceScale(max, ticks = 4) {
    if (!(max > 0)) return { max: 1, step: 1, values: [0, 1] };
    const rough = max / ticks;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= rough) || rough;
    const top = Math.ceil(max / step) * step;
    const values = [];
    for (let v = 0; v <= top + step / 2; v += step) values.push(Number(v.toFixed(6)));
    return { max: top, step, values };
  }

  // Igual que niceScale pero con mínimo negativo: el cero siempre es una marca.
  function niceRange(min, max, ticks = 4) {
    if (!(min < 0)) { const s = niceScale(max, ticks); return { min: 0, max: s.max, values: s.values }; }
    const span = Math.max(max, 0) - min;
    const rough = span / ticks;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= rough) || rough;
    const lo = Math.floor(min / step) * step;
    const hi = Math.max(step, Math.ceil(Math.max(max, 0) / step) * step);
    const values = [];
    for (let v = lo; v <= hi + step / 2; v += step) values.push(Number(v.toFixed(6)));
    return { min: lo, max: hi, values };
  }

  function compact(value) {
    const n = Number(value || 0);
    const abs = Math.abs(n);
    if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, '')} M`;
    if (abs >= 1e4) return `${(n / 1e3).toFixed(0)} mil`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')} mil`;
    return Number.isInteger(n) ? String(n) : n.toFixed(abs < 10 ? 1 : 0);
  }

  /* ── Tooltip único para todos los gráficos ─────────────────────────── */
  let tipNode = null;
  function tip() {
    if (tipNode && document.body.contains(tipNode)) return tipNode;
    tipNode = document.createElement('div');
    tipNode.className = 'mpc-tip';
    tipNode.setAttribute('role', 'status');
    document.body.appendChild(tipNode);
    return tipNode;
  }
  // rows: [{ color?, value, label }]; el valor va primero y en negrita.
  function showTip(x, y, title, rows) {
    const node = tip();
    node.textContent = '';
    if (title) {
      const head = document.createElement('div');
      head.className = 'mpc-tip-title';
      head.textContent = title;
      node.appendChild(head);
    }
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'mpc-tip-row';
      if (row.color) {
        const key = document.createElement('i');
        key.style.background = row.color;
        line.appendChild(key);
      }
      const value = document.createElement('b');
      value.textContent = row.value;
      line.appendChild(value);
      if (row.label) {
        const label = document.createElement('span');
        label.textContent = row.label;
        line.appendChild(label);
      }
      node.appendChild(line);
    }
    node.classList.add('show');
    const box = node.getBoundingClientRect();
    let left = x + 14;
    let top = y - box.height - 12;
    if (left + box.width > window.innerWidth - 8) left = x - box.width - 14;
    if (top < 8) top = y + 16;
    node.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  }
  function hideTip() { if (tipNode) tipNode.classList.remove('show'); }
  window.addEventListener('scroll', hideTip, true);
  // Si el gráfico desaparece (cambio de módulo) o el puntero sale de él sin
  // avisar, el tooltip no debe quedarse flotando.
  const leftChart = event => { if (tipNode?.classList.contains('show') && !event.target.closest?.('.mpc-chart')) hideTip(); };
  document.addEventListener('pointermove', leftChart, true);
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTip(); }, true);

  // Ejecuta la animación de entrada cuando el gráfico entra en pantalla.
  function whenVisible(node, run) {
    if (reduceMotion() || !('IntersectionObserver' in window)) return run(false);
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); run(true); }
    }, { threshold: 0.05 });
    observer.observe(node);
  }

  // Redibuja al cambiar el ancho del contenedor (el SVG usa píxeles reales).
  function responsive(host, draw) {
    let lastWidth = 0;
    let animated = false;
    const render = () => {
      const width = Math.floor(host.clientWidth);
      if (!width || width === lastWidth) return;
      lastWidth = width;
      draw(width, !animated);
      animated = true;
    };
    render();
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => {
        if (!document.body.contains(host)) return observer.disconnect();
        render();
      });
      observer.observe(host);
    }
  }

  function empty(host, text) {
    host.innerHTML = `<div class="mpc-empty"><i class="ti ti-chart-dots-3"></i><span>${esc(text || 'Sin datos en el periodo')}</span></div>`;
  }

  /* ── Área / línea de una serie en el tiempo ────────────────────────── */
  // rows: [{ label, value, sub? }]  ·  format(value) → texto
  function area(host, { rows = [], format = String, height = 280, name = 'Valor', emptyText } = {}) {
    if (!rows.length || !rows.some(row => Number(row.value) !== 0)) return empty(host, emptyText);
    host.classList.add('mpc-chart');
    responsive(host, (width, animate) => {
      host.textContent = '';
      const pad = { top: 18, right: 16, bottom: 30, left: 46 };
      const innerW = Math.max(10, width - pad.left - pad.right);
      const innerH = height - pad.top - pad.bottom;
      const values = rows.map(row => Number(row.value || 0));
      const scale = niceRange(Math.min(...values), Math.max(...values));
      const x = index => pad.left + (rows.length === 1 ? innerW / 2 : (index * innerW) / (rows.length - 1));
      const y = value => pad.top + innerH - ((value - scale.min) / (scale.max - scale.min)) * innerH;
      const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', tabindex: 0, 'aria-label': `${name}: ${rows.length} puntos, máximo ${format(Math.max(...values))}` });

      for (const tick of scale.values) {
        svg.appendChild(svgEl('line', { x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick), class: tick === 0 ? 'mpc-axis' : 'mpc-grid' }));
        const label = svgEl('text', { x: pad.left - 8, y: y(tick) + 3.5, 'text-anchor': 'end', class: 'mpc-tick' });
        label.textContent = compact(tick);
        svg.appendChild(label);
      }
      const maxLabels = Math.max(2, Math.floor(innerW / 64));
      const every = Math.max(1, Math.ceil(rows.length / maxLabels));
      rows.forEach((row, index) => {
        if (index % every !== 0 && index !== rows.length - 1) return;
        if (index !== rows.length - 1 && rows.length - 1 - index < every / 2) return;
        const label = svgEl('text', { x: x(index), y: height - 9, 'text-anchor': index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle', class: 'mpc-tick' });
        label.textContent = row.label;
        svg.appendChild(label);
      });

      const linePath = rows.map((row, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(values[index]).toFixed(1)}`).join(' ');
      const areaPath = `${linePath} L${x(rows.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
      const fill = svgEl('path', { d: areaPath, class: 'mpc-area' });
      const line = svgEl('path', { d: linePath, class: 'mpc-line', fill: 'none' });
      svg.appendChild(fill);
      svg.appendChild(line);

      // Solo se rotula el punto máximo; el resto se lee con el eje y el cursor.
      const peak = values.indexOf(Math.max(...values));
      const peakLabel = svgEl('text', { x: Math.min(width - pad.right - 4, Math.max(pad.left + 4, x(peak))), y: Math.max(11, y(values[peak]) - 9), 'text-anchor': x(peak) > width - 90 ? 'end' : x(peak) < pad.left + 60 ? 'start' : 'middle', class: 'mpc-value' });
      peakLabel.textContent = format(values[peak]);
      svg.appendChild(peakLabel);
      svg.appendChild(svgEl('circle', { cx: x(peak), cy: y(values[peak]), r: 4, class: 'mpc-dot' }));

      // Los puntos bajo cero (pérdida) se marcan en rojo con su propio aviso.
      values.forEach((value, index) => {
        if (value < 0) svg.appendChild(svgEl('circle', { cx: x(index), cy: y(value), r: 3.5, class: 'mpc-dot mpc-dot-neg' }));
      });

      const cross = svgEl('line', { y1: pad.top, y2: pad.top + innerH, class: 'mpc-cross', visibility: 'hidden' });
      const marker = svgEl('circle', { r: 5, class: 'mpc-dot mpc-dot-live', visibility: 'hidden' });
      svg.appendChild(cross);
      svg.appendChild(marker);

      let current = -1;
      const focusOn = (index, clientX, clientY) => {
        current = Math.max(0, Math.min(rows.length - 1, index));
        const cx = x(current);
        const cy = y(values[current]);
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
        marker.setAttribute('cx', cx); marker.setAttribute('cy', cy); marker.setAttribute('visibility', 'visible');
        const box = svg.getBoundingClientRect();
        showTip(clientX ?? box.left + cx, clientY ?? box.top + cy, rows[current].title || rows[current].label,
          [{ color: 'var(--mpc-accent)', value: format(values[current]), label: rows[current].sub || name }]);
      };
      const leave = () => { cross.setAttribute('visibility', 'hidden'); marker.setAttribute('visibility', 'hidden'); hideTip(); current = -1; };
      svg.addEventListener('pointermove', event => {
        const box = svg.getBoundingClientRect();
        const ratio = (event.clientX - box.left - pad.left) / innerW;
        focusOn(Math.round(ratio * (rows.length - 1)), event.clientX, event.clientY);
      });
      svg.addEventListener('pointerleave', leave);
      svg.addEventListener('blur', leave);
      svg.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        focusOn(current < 0 ? rows.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1));
      });

      host.appendChild(svg);
      if (animate) {
        const length = line.getTotalLength();
        line.style.strokeDasharray = length;
        line.style.strokeDashoffset = length;
        fill.style.opacity = 0;
        whenVisible(host, moving => {
          if (!moving) { line.style.strokeDasharray = ''; line.style.strokeDashoffset = ''; fill.style.opacity = ''; return; }
          line.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.22,.8,.28,1)';
          fill.style.transition = 'opacity .7s ease .45s';
          requestAnimationFrame(() => { line.style.strokeDashoffset = 0; fill.style.opacity = ''; });
          setTimeout(() => { line.style.strokeDasharray = ''; line.style.transition = ''; }, 1300);
        });
      }
    });
  }

  /* ── Columnas (una serie por categoría ordenada, p. ej. horas) ─────── */
  function columns(host, { rows = [], format = String, height = 240, name = 'Valor', emptyText } = {}) {
    if (!rows.length || !rows.some(row => Number(row.value) > 0)) return empty(host, emptyText);
    host.classList.add('mpc-chart');
    responsive(host, (width, animate) => {
      host.textContent = '';
      const pad = { top: 18, right: 8, bottom: 26, left: 46 };
      const innerW = Math.max(10, width - pad.left - pad.right);
      const innerH = height - pad.top - pad.bottom;
      const values = rows.map(row => Number(row.value || 0));
      const scale = niceScale(Math.max(...values));
      const band = innerW / rows.length;
      const barW = Math.max(3, Math.min(24, band - 2));
      const y = value => pad.top + innerH - (value / scale.max) * innerH;
      const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${name} por categoría` });
      for (const tick of scale.values) {
        svg.appendChild(svgEl('line', { x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick), class: tick === 0 ? 'mpc-axis' : 'mpc-grid' }));
        const label = svgEl('text', { x: pad.left - 8, y: y(tick) + 3.5, 'text-anchor': 'end', class: 'mpc-tick' });
        label.textContent = compact(tick);
        svg.appendChild(label);
      }
      const every = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(innerW / 34))));
      const peak = values.indexOf(Math.max(...values));
      const bars = [];
      rows.forEach((row, index) => {
        const cx = pad.left + band * index + band / 2;
        const value = values[index];
        const top = y(value);
        const h = Math.max(value > 0 ? 2 : 0, pad.top + innerH - top);
        const r = Math.min(4, barW / 2, h);
        // Extremo redondeado arriba, recto en la línea base.
        const d = h <= 0 ? '' : `M${cx - barW / 2},${pad.top + innerH} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${pad.top + innerH} Z`;
        const group = svgEl('g', { class: 'mpc-col', tabindex: 0, role: 'img', 'aria-label': `${row.title || row.label}: ${format(value)}` });
        // Zona de contacto más ancha que la marca.
        group.appendChild(svgEl('rect', { x: pad.left + band * index, y: pad.top, width: band, height: innerH, fill: 'transparent' }));
        if (d) {
          const bar = svgEl('path', { d, class: index === peak ? 'mpc-bar mpc-bar-peak' : 'mpc-bar' });
          bar.style.transformOrigin = `${cx}px ${pad.top + innerH}px`;
          group.appendChild(bar);
          bars.push(bar);
        }
        if (index % every === 0) {
          const label = svgEl('text', { x: cx, y: height - 8, 'text-anchor': 'middle', class: 'mpc-tick' });
          label.textContent = row.label;
          svg.appendChild(label);
        }
        const show = event => {
          const box = group.getBoundingClientRect();
          showTip(event?.clientX ?? box.left + box.width / 2, event?.clientY ?? box.top + 20, row.title || row.label,
            [{ color: 'var(--mpc-accent)', value: format(value), label: row.sub || name }]);
        };
        group.addEventListener('pointermove', show);
        group.addEventListener('pointerleave', hideTip);
        group.addEventListener('focus', () => show());
        group.addEventListener('blur', hideTip);
        svg.appendChild(group);
      });
      if (values[peak] > 0) {
        const cx = pad.left + band * peak + band / 2;
        const label = svgEl('text', { x: Math.min(width - 4, Math.max(pad.left + 4, cx)), y: Math.max(11, y(values[peak]) - 6), 'text-anchor': cx > width - 60 ? 'end' : 'middle', class: 'mpc-value' });
        label.textContent = format(values[peak]);
        svg.appendChild(label);
      }
      host.appendChild(svg);
      if (animate) {
        bars.forEach(bar => { bar.style.transform = 'scaleY(0)'; });
        whenVisible(host, moving => {
          bars.forEach((bar, index) => {
            if (!moving) { bar.style.transform = ''; return; }
            bar.style.transition = `transform .55s cubic-bezier(.22,.8,.28,1) ${Math.min(index * 22, 420)}ms`;
            requestAnimationFrame(() => { bar.style.transform = 'scaleY(1)'; });
          });
        });
      }
    });
  }

  /* ── Barras horizontales (ranking) ─────────────────────────────────── */
  // rows: [{ label, value, sub? }] · valor rotulado en la punta de cada barra.
  function bars(host, { rows = [], format = String, limit = 8, emptyText } = {}) {
    const data = rows.slice(0, limit);
    if (!data.length) return empty(host, emptyText);
    const max = Math.max(1, ...data.map(row => Number(row.value || 0)));
    host.classList.add('mpc-rank');
    host.innerHTML = data.map((row, index) => `
      <div class="mpc-rank-row" tabindex="0">
        <span class="mpc-rank-pos">${index + 1}</span>
        <div class="mpc-rank-main">
          <div class="mpc-rank-head"><span class="mpc-rank-label" title="${esc(row.label)}">${esc(row.label)}</span><b>${esc(format(row.value, row))}</b></div>
          <div class="mpc-rank-track"><i style="--w:${Math.max(1.5, (Number(row.value || 0) / max) * 100).toFixed(2)}%"></i></div>
          ${row.sub ? `<small>${esc(row.sub)}</small>` : ''}
        </div>
      </div>`).join('');
    const fills = [...host.querySelectorAll('.mpc-rank-track i')];
    whenVisible(host, moving => fills.forEach((node, index) => {
      if (moving) node.style.transitionDelay = `${index * 55}ms`;
      else node.style.transition = 'none';
      requestAnimationFrame(() => node.classList.add('in'));
    }));
  }

  /* ── Dona (parte de un todo, máximo 6 segmentos) ───────────────────── */
  function donut(host, { rows = [], format = String, centerFormat = format, centerLabel = 'Total', emptyText } = {}) {
    let data = rows.filter(row => Number(row.value) > 0).sort((a, b) => b.value - a.value);
    if (data.length > SERIES) {
      const rest = data.slice(SERIES - 1);
      data = [...data.slice(0, SERIES - 1), { label: 'Otros', value: rest.reduce((sum, row) => sum + Number(row.value), 0) }];
    }
    const total = data.reduce((sum, row) => sum + Number(row.value), 0);
    if (!total) return empty(host, emptyText);
    host.classList.add('mpc-donut');
    const size = 168, stroke = 20, radius = (size - stroke) / 2, circumference = 2 * Math.PI * radius;
    const gap = data.length > 1 ? 2 : 0; // separación de 2 px en color de superficie
    let offset = 0;
    const arcs = data.map((row, index) => {
      const length = (Number(row.value) / total) * circumference;
      const visible = Math.max(0.5, length - gap);
      const arc = `<circle class="mpc-arc" data-i="${index}" cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${seriesColor(index)}" stroke-width="${stroke}" stroke-dasharray="${visible.toFixed(2)} ${(circumference - visible).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
      offset += length;
      return arc;
    }).join('');
    host.innerHTML = `
      <div class="mpc-donut-fig">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(centerLabel)} ${esc(format(total))}">
          <g transform="rotate(-90 ${size / 2} ${size / 2})" class="mpc-arcs">${arcs}</g>
        </svg>
        <div class="mpc-donut-center"><small>${esc(centerLabel)}</small><b>${esc(centerFormat(total))}</b></div>
      </div>
      <ul class="mpc-legend">${data.map((row, index) => `
        <li data-i="${index}" tabindex="0">
          <i style="background:${seriesColor(index)}"></i>
          <span>${esc(row.label)}${row.sub ? `<small>${esc(row.sub)}</small>` : ''}</span>
          <b>${esc(format(row.value))}</b>
          <em>${((Number(row.value) / total) * 100).toFixed(1)}%</em>
        </li>`).join('')}</ul>`;
    const center = host.querySelector('.mpc-donut-center');
    const highlight = index => {
      host.querySelectorAll('[data-i]').forEach(node => node.classList.toggle('dim', index !== null && Number(node.dataset.i) !== index));
      const row = index === null ? null : data[index];
      center.querySelector('small').textContent = row ? row.label : centerLabel;
      center.querySelector('b').textContent = centerFormat(row ? row.value : total);
    };
    host.querySelectorAll('[data-i]').forEach(node => {
      const index = Number(node.dataset.i);
      node.addEventListener('pointerenter', () => highlight(index));
      node.addEventListener('pointerleave', () => highlight(null));
      node.addEventListener('focus', () => highlight(index));
      node.addEventListener('blur', () => highlight(null));
    });
    const group = host.querySelector('.mpc-arcs');
    whenVisible(host, moving => { if (moving) group.classList.add('sweep'); });
  }

  /* ── Sparkline para tarjetas ───────────────────────────────────────── */
  function spark(values, { width = 96, height = 30 } = {}) {
    const data = (values || []).map(Number).filter(Number.isFinite);
    if (data.length < 2 || !data.some(v => v > 0)) return '';
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    const x = index => 2 + (index * (width - 6)) / (data.length - 1);
    const y = value => height - 4 - ((value - min) / range) * (height - 9);
    const path = data.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
    return `<svg class="mpc-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${path}" fill="none"/><circle cx="${x(data.length - 1).toFixed(1)}" cy="${y(data[data.length - 1]).toFixed(1)}" r="2.6"/></svg>`;
  }

  /* ── Número que cuenta hasta su valor ──────────────────────────────── */
  function countUp(node, value, format = String, duration = 900) {
    const target = Number(value || 0);
    if (reduceMotion() || !target) { node.textContent = format(target); return; }
    const start = performance.now();
    const frame = now => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = format(target * eased);
      if (progress < 1 && document.body.contains(node)) requestAnimationFrame(frame);
      else node.textContent = format(target);
    };
    requestAnimationFrame(frame);
  }

  window.MPCharts = { area, columns, bars, donut, spark, countUp, compact, hideTip, seriesColor };
})();
