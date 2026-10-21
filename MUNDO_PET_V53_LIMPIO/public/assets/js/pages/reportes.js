window.init_reportes = async function () {
  const html = await fetch('/views/pages/reportes.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  const esAdmin = window._esAdmin === true || window._esGlobal === true;
  if (!esAdmin) {
    document.getElementById('rep-no-admin').style.display = 'block';
    return;
  }
  document.getElementById('rep-contenido').style.display = 'block';

  // Mostrar filtro de sucursal solo para admin global
  if (window._esGlobal) {
    const block = document.getElementById('rep-sucursal-block');
    block.style.display = 'block';
    const sel = document.getElementById('rep-sucursal');
    const sr = await Http.get('/sucursales');
    const sucursales = sr?.sucursales || sr?.data || [];
    sel.innerHTML = `<option value="">Todas</option>` + sucursales.map(x =>
      `<option value="${Number(x.id)}">${String(x.nombre || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</option>`
    ).join('');
  }

  // Estado de filtros
  let tabActivo = 'ventas';
  const fmt = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtNum = n => Number(n || 0).toLocaleString('es-PE');
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hoyPeru = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

  // Rango de fechas por defecto: mes actual
  function setRangoMes() {
    const current=hoyPeru();
    document.getElementById('rep-desde').value = `${current.slice(0,7)}-01`;
    document.getElementById('rep-hasta').value = current;
  }
  setRangoMes();
  document.getElementById('rep-desde').max=hoyPeru();
  document.getElementById('rep-hasta').max=hoyPeru();

  window.repRango = function(tipo) {
    const current=hoyPeru();
    const desde=tipo==='hoy'?current:tipo==='mes'?`${current.slice(0,7)}-01`:`${current.slice(0,4)}-01-01`;
    document.getElementById('rep-desde').value=desde;
    document.getElementById('rep-hasta').value=current;
    repAplicar();
  };

  function getFiltros() {
    const desde = document.getElementById('rep-desde').value;
    const hasta = document.getElementById('rep-hasta').value;
    const hoy=hoyPeru();
    if(!desde||!hasta||desde>hasta||desde>hoy||hasta>hoy) throw new Error('Selecciona un rango válido sin fechas futuras');
    const sucursal = document.getElementById('rep-sucursal')?.value || '';
    const qs = new URLSearchParams();
    if (desde) qs.append('desde', desde);
    if (hasta) qs.append('hasta', hasta);
    if (sucursal) qs.append('sucursal_id', sucursal);
    return qs.toString();
  }

  window.repSwitchTab = function(e, tab) {
    e.preventDefault();
    tabActivo = tab;
    document.querySelectorAll('.rep-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.rep-content').forEach(c => c.style.display = 'none');
    e.target.closest('.rep-tab').classList.add('active');
    document.getElementById('rep-tab-' + tab).style.display = 'block';
    cargarTab(tab);
  };

  window.repAplicar = function() {
    cargarTab(tabActivo);
  };

  // ══════════ GRÁFICOS (SVG/CSS puro) ══════════
  let chartSequence=0;

  // Gráfico de barras horizontal
  function barrasHorizontales(datos, labelKey, valueKey, colorFn) {
    if (!datos.length) return '<div class="rep-empty">Sin datos</div>';
    const max = Math.max(...datos.map(d => Number(d[valueKey]) || 0), 1);
    return datos.map(d => {
      const val = Number(d[valueKey]) || 0;
      const pct = (val / max) * 100;
      const color = colorFn ? colorFn(d) : 'var(--primary,#4a90d9)';
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span style="color:var(--texto-fuerte)">${d[labelKey] || '—'}</span>
          <span style="font-weight:600;color:var(--texto-fuerte)">${fmt(val)}</span>
        </div>
        <div style="height:8px;background:var(--input-bg);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width .5s"></div>
        </div>
      </div>`;
    }).join('');
  }

  // Gráfico de línea SVG PROFESIONAL (ejes, grid, etiquetas, valores, puntos)
  function graficoLinea(datos, fechaKey, valueKey, opts = {}) {
    if (!datos.length) return '<div class="rep-empty">Sin datos en el periodo seleccionado</div>';

    const W = 800, H = 300;
    const padL = 70, padR = 25, padT = 25, padB = 55;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const vals = datos.map(d => Number(d[valueKey]) || 0);
    const maxRaw = Math.max(...vals, 1);
    // Redondear el máximo a un número "bonito"
    const magnitud = Math.pow(10, Math.floor(Math.log10(maxRaw)));
    const max = Math.ceil(maxRaw / magnitud) * magnitud;
    const esMoneda = opts.moneda !== false;

    const n = datos.length;
    const stepX = n > 1 ? chartW / (n - 1) : 0;

    const puntos = datos.map((d, i) => {
      const x = padL + (n > 1 ? i * stepX : chartW / 2);
      const val = Number(d[valueKey]) || 0;
      const y = padT + chartH - (val / max) * chartH;
      return { x, y, val, fecha: d[fechaKey] };
    });

    // Líneas de cuadrícula horizontales + etiquetas eje Y
    const numLineas = 5;
    let grid = '';
    let ejeY = '';
    for (let i = 0; i <= numLineas; i++) {
      const y = padT + (chartH / numLineas) * i;
      const valLinea = max - (max / numLineas) * i;
      grid += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--card-border,#333)" stroke-width="1" stroke-dasharray="${i===numLineas?'0':'3,3'}" opacity="0.5"/>`;
      const etiqueta = esMoneda
        ? (valLinea >= 1000 ? 'S/' + (valLinea/1000).toFixed(valLinea>=10000?0:1) + 'k' : 'S/' + valLinea.toFixed(0))
        : Math.round(valLinea).toString();
      ejeY += `<text x="${padL-10}" y="${y+4}" text-anchor="end" font-size="11" fill="var(--texto-muted,#888)">${etiqueta}</text>`;
    }

    // Etiquetas eje X (fechas) - máximo ~8 para no saturar
    let ejeX = '';
    const stepLabel = Math.max(1, Math.ceil(n / 8));
    puntos.forEach((p, i) => {
      if (i % stepLabel === 0 || i === n - 1) {
        const fecha = new Date(p.fecha);
        const lbl = isNaN(fecha) ? p.fecha : `${fecha.getDate()}/${fecha.getMonth()+1}`;
        ejeX += `<text x="${p.x}" y="${H-padB+20}" text-anchor="middle" font-size="10" fill="var(--texto-muted,#888)">${lbl}</text>`;
      }
    });

    const linePath = puntos.map((p, i) => `${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ');
    const areaPath = `M ${puntos[0].x} ${padT+chartH} ` + puntos.map(p => `L ${p.x} ${p.y}`).join(' ') + ` L ${puntos[n-1].x} ${padT+chartH} Z`;

    // Puntos con valores encima
    let circulos = '';
    puntos.forEach((p, i) => {
      const mostrarVal = n <= 15 || i % stepLabel === 0 || i === n-1;
      circulos += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--primary,#4a90d9)" stroke="#fff" stroke-width="1.5">
        <title>${p.fecha}: ${esMoneda ? fmt(p.val) : fmtNum(p.val)}</title></circle>`;
      if (mostrarVal) {
        const valTxt = esMoneda
          ? (p.val >= 1000 ? 'S/' + (p.val/1000).toFixed(1) + 'k' : 'S/' + p.val.toFixed(0))
          : fmtNum(p.val);
        circulos += `<text x="${p.x}" y="${p.y-10}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--texto-fuerte,#fff)">${valTxt}</text>`;
      }
    });

    const gradientId=`lineGrad${++chartSequence}`;
    return `<svg role="img" aria-label="Gráfico de evolución" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;min-height:230px;max-height:320px">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--primary,#4a90d9)" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="var(--primary,#4a90d9)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${grid}
      ${ejeY}
      ${ejeX}
      <path d="${areaPath}" fill="url(#${gradientId})"/>
      <path d="${linePath}" fill="none" stroke="var(--primary,#4a90d9)" stroke-width="2.5" stroke-linejoin="round"/>
      ${circulos}
    </svg>`;
  }

  // Gráfico de barras VERTICALES (comparativa) con ejes y valores
  function graficoBarrasVert(datos, labelKey, valueKey, opts = {}) {
    if (!datos.length) return '<div class="rep-empty">Sin datos</div>';
    const W = 800, H = 300;
    const padL = 70, padR = 25, padT = 30, padB = 60;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const esMoneda = opts.moneda !== false;

    const vals = datos.map(d => Number(d[valueKey]) || 0);
    const maxRaw = Math.max(...vals, 1);
    const magnitud = Math.pow(10, Math.floor(Math.log10(maxRaw)));
    const max = Math.ceil(maxRaw / magnitud) * magnitud;

    const n = datos.length;
    const gap = 0.35;
    const bandW = chartW / n;
    const barW = bandW * (1 - gap);

    const colores = ['#4a90d9','#5cb85c','#f0ad4e','#d9534f','#9b59b6','#1abc9c','#e67e22','#34495e'];

    let grid = '', ejeY = '';
    const numLineas = 5;
    for (let i = 0; i <= numLineas; i++) {
      const y = padT + (chartH / numLineas) * i;
      const valLinea = max - (max / numLineas) * i;
      grid += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--card-border,#333)" stroke-width="1" stroke-dasharray="${i===numLineas?'0':'3,3'}" opacity="0.5"/>`;
      const etiqueta = esMoneda
        ? (valLinea >= 1000 ? 'S/' + (valLinea/1000).toFixed(valLinea>=10000?0:1) + 'k' : 'S/' + valLinea.toFixed(0))
        : Math.round(valLinea).toString();
      ejeY += `<text x="${padL-10}" y="${y+4}" text-anchor="end" font-size="11" fill="var(--texto-muted,#888)">${etiqueta}</text>`;
    }

    let barras = '';
    datos.forEach((d, i) => {
      const val = Number(d[valueKey]) || 0;
      const h = (val / max) * chartH;
      const x = padL + i * bandW + (bandW - barW) / 2;
      const y = padT + chartH - h;
      const color = colores[i % colores.length];
      const valTxt = esMoneda
        ? (val >= 1000 ? 'S/' + (val/1000).toFixed(1) + 'k' : 'S/' + val.toFixed(0))
        : fmtNum(val);
      const lbl = String(d[labelKey] || '').substring(0, 12);
      barras += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${color}">
        <title>${d[labelKey]}: ${esMoneda ? fmt(val) : fmtNum(val)}</title></rect>
        <text x="${x+barW/2}" y="${y-6}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--texto-fuerte,#fff)">${valTxt}</text>
        <text x="${x+barW/2}" y="${H-padB+18}" text-anchor="middle" font-size="10" fill="var(--texto-muted,#888)">${lbl}</text>`;
    });

    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:320px">
      ${grid}${ejeY}${barras}
    </svg>`;
  }

  // Gráfico de DONA (pie) con leyenda
  function graficoDona(datos, labelKey, valueKey) {
    if (!datos.length) return '<div class="rep-empty">Sin datos</div>';
    const total = datos.reduce((a, d) => a + (Number(d[valueKey]) || 0), 0);
    if (total === 0) return '<div class="rep-empty">Sin datos</div>';

    const colores = ['#4a90d9','#5cb85c','#f0ad4e','#d9534f','#9b59b6','#1abc9c','#e67e22','#34495e'];
    const cx = 110, cy = 110, r = 90, rInner = 55;

    let angulo = -90;
    let segmentos = '';
    let leyenda = '';

    datos.forEach((d, i) => {
      const val = Number(d[valueKey]) || 0;
      const pct = val / total;
      const angBarrido = pct * 360;
      const color = colores[i % colores.length];

      const a1 = (angulo * Math.PI) / 180;
      const a2 = ((angulo + angBarrido) * Math.PI) / 180;
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const xi1 = cx + rInner * Math.cos(a1), yi1 = cy + rInner * Math.sin(a1);
      const xi2 = cx + rInner * Math.cos(a2), yi2 = cy + rInner * Math.sin(a2);
      const largeArc = angBarrido > 180 ? 1 : 0;

      segmentos += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${rInner} ${rInner} 0 ${largeArc} 0 ${xi1} ${yi1} Z" fill="${color}">
        <title>${d[labelKey]}: ${fmt(val)} (${(pct*100).toFixed(1)}%)</title></path>`;

      leyenda += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px">
        <span style="width:12px;height:12px;border-radius:3px;background:${color};display:inline-block;flex-shrink:0"></span>
        <span style="color:var(--texto-fuerte);flex:1;text-transform:capitalize">${d[labelKey]}</span>
        <span style="color:var(--texto-muted)">${(pct*100).toFixed(1)}%</span>
        <span style="font-weight:600;color:var(--texto-fuerte);min-width:80px;text-align:right">${fmt(val)}</span>
      </div>`;
      angulo += angBarrido;
    });

    return `<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;justify-content:center">
      <svg viewBox="0 0 220 220" style="width:200px;height:200px;flex-shrink:0">
        ${segmentos}
        <text x="110" y="105" text-anchor="middle" font-size="13" fill="var(--texto-muted,#888)">Total</text>
        <text x="110" y="125" text-anchor="middle" font-size="15" font-weight="700" fill="var(--texto-fuerte,#fff)">${total>=1000?'S/'+(total/1000).toFixed(1)+'k':fmt(total)}</text>
      </svg>
      <div style="flex:1;min-width:220px">${leyenda}</div>
    </div>`;
  }

  // Tabla genérica
  function tabla(columnas, filas, rowFn) {
    if (!filas.length) return '<div class="rep-empty">Sin datos</div>';
    let html = `<div style="overflow-x:auto"><table class="rep-table"><thead><tr>`;
    columnas.forEach(c => html += `<th style="${c.align ? 'text-align:'+c.align : ''}">${c.label}</th>`);
    html += `</tr></thead><tbody>`;
    filas.forEach((f,i) => html += '<tr>' + rowFn(f,i) + '</tr>');
    html += '</tbody></table></div>';
    return html;
  }

  // ══════════ EXPORTAR EXCEL PROFESIONAL (xlsx-js-style) ══════════
  function detectarTipo(valor, columna) {
    // Detecta si una columna es monto (para formato S/) o número
    const col = (columna || '').toLowerCase();
    const esMoneda = /total|monto|precio|costo|venta|saldo|gastado|ganancia|pagado|esperado|contado|diferencia|ticket/.test(col);
    const esNumero = /cantidad|unidades|#|compras|convertidas|días|dias|stock|margen/.test(col);
    if (esMoneda) return 'moneda';
    if (esNumero) return 'numero';
    return 'texto';
  }

  function exportarExcel(nombre, columnas, filas) {
    if (typeof XLSX === 'undefined') {
      return Swal.fire({ icon:'error', title:'Error', text:'La librería de Excel no cargó. Recarga la página.', background:'#1a1a2e', color:'#e0e0e0' });
    }

    const empresa = 'DISTRIBUCIONES MAOZ E.I.R.L.';
    const periodo = `Periodo: ${document.getElementById('rep-desde').value}  al  ${document.getElementById('rep-hasta').value}`;
    const generado = `Generado: ${new Date().toLocaleString('es-PE')}`;

    // Tipos de columna
    const tipos = columnas.map(c => detectarTipo(null, c));

    // ─── Construir matriz de celdas (AOA) ───
    const aoa = [];
    aoa.push([empresa]);              // fila 0: empresa
    aoa.push([nombre.toUpperCase()]); // fila 1: título reporte
    aoa.push([periodo]);              // fila 2
    aoa.push([generado]);             // fila 3
    aoa.push([]);                     // fila 4: vacía
    aoa.push(columnas);               // fila 5: encabezados
    filas.forEach(f => aoa.push(f));  // datos

    // Fila de TOTALES (solo columnas de moneda/número)
    const totalRow = columnas.map((c, i) => {
      if (i === 0) return 'TOTAL';
      if (tipos[i] === 'moneda' || tipos[i] === 'numero') {
        return filas.reduce((sum, f) => sum + (Number(f[i]) || 0), 0);
      }
      return '';
    });
    const idxTotal = aoa.length; // índice de la fila de totales
    aoa.push(totalRow);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // ─── Estilos ───
    const AZUL   = '1F4E78';   // encabezado principal
    const ROJO   = 'C00000';   // marca
    const GRIS_H = '4472C4';   // header tabla
    const GRIS_F = 'D9E1F2';   // fila alterna
    const AMARILLO = 'FFF2CC'; // total

    const nCols = columnas.length;
    const lastCol = XLSX.utils.encode_col(nCols - 1);

    // Merges (títulos ocupan todo el ancho)
    ws['!merges'] = [
      { s:{r:0,c:0}, e:{r:0,c:nCols-1} },
      { s:{r:1,c:0}, e:{r:1,c:nCols-1} },
      { s:{r:2,c:0}, e:{r:2,c:nCols-1} },
      { s:{r:3,c:0}, e:{r:3,c:nCols-1} }
    ];

    // Estilo: nombre empresa
    if (ws['A1']) ws['A1'].s = {
      font:{ bold:true, sz:16, color:{rgb:ROJO} },
      alignment:{ horizontal:'center', vertical:'center' }
    };
    // Estilo: título reporte
    if (ws['A2']) ws['A2'].s = {
      font:{ bold:true, sz:13, color:{rgb:AZUL} },
      alignment:{ horizontal:'center' }
    };
    // periodo y generado
    ['A3','A4'].forEach(ref => { if (ws[ref]) ws[ref].s = {
      font:{ sz:10, italic:true, color:{rgb:'808080'} },
      alignment:{ horizontal:'center' }
    };});

    // Encabezados de tabla (fila 5, índice 5)
    for (let c = 0; c < nCols; c++) {
      const ref = XLSX.utils.encode_cell({ r:5, c });
      if (!ws[ref]) ws[ref] = { v: columnas[c], t:'s' };
      ws[ref].s = {
        font:{ bold:true, sz:11, color:{rgb:'FFFFFF'} },
        fill:{ fgColor:{rgb:GRIS_H} },
        alignment:{ horizontal:'center', vertical:'center', wrapText:true },
        border:{
          top:{style:'thin',color:{rgb:'FFFFFF'}}, bottom:{style:'thin',color:{rgb:'FFFFFF'}},
          left:{style:'thin',color:{rgb:'FFFFFF'}}, right:{style:'thin',color:{rgb:'FFFFFF'}}
        }
      };
    }

    // Filas de datos
    for (let r = 0; r < filas.length; r++) {
      const filaExcel = 6 + r; // datos empiezan en fila 6
      const alterna = r % 2 === 1;
      for (let c = 0; c < nCols; c++) {
        const ref = XLSX.utils.encode_cell({ r:filaExcel, c });
        if (!ws[ref]) continue;
        const tipo = tipos[c];

        // Formato de número/moneda
        if (tipo === 'moneda') {
          ws[ref].t = 'n';
          ws[ref].z = '"S/ "#,##0.00';
        } else if (tipo === 'numero' && !isNaN(Number(ws[ref].v))) {
          ws[ref].t = 'n';
          ws[ref].z = '#,##0';
        }

        ws[ref].s = {
          font:{ sz:10, color:{rgb:'333333'} },
          fill:{ fgColor:{rgb: alterna ? GRIS_F : 'FFFFFF'} },
          alignment:{ horizontal: (tipo==='texto' ? 'left':'right'), vertical:'center' },
          border:{
            top:{style:'hair',color:{rgb:'CCCCCC'}}, bottom:{style:'hair',color:{rgb:'CCCCCC'}},
            left:{style:'hair',color:{rgb:'CCCCCC'}}, right:{style:'hair',color:{rgb:'CCCCCC'}}
          }
        };
      }
    }

    // Fila de totales
    for (let c = 0; c < nCols; c++) {
      const ref = XLSX.utils.encode_cell({ r:idxTotal, c });
      if (!ws[ref]) continue;
      if ((tipos[c] === 'moneda') && typeof ws[ref].v === 'number') {
        ws[ref].t = 'n'; ws[ref].z = '"S/ "#,##0.00';
      } else if (tipos[c] === 'numero' && typeof ws[ref].v === 'number') {
        ws[ref].t = 'n'; ws[ref].z = '#,##0';
      }
      ws[ref].s = {
        font:{ bold:true, sz:11, color:{rgb:AZUL} },
        fill:{ fgColor:{rgb:AMARILLO} },
        alignment:{ horizontal: (c===0 ? 'left':'right'), vertical:'center' },
        border:{
          top:{style:'medium',color:{rgb:AZUL}}, bottom:{style:'medium',color:{rgb:AZUL}}
        }
      };
    }

    // Ancho de columnas (auto según contenido)
    ws['!cols'] = columnas.map((c, i) => {
      let maxLen = String(c).length;
      filas.forEach(f => { const l = String(f[i] ?? '').length; if (l > maxLen) maxLen = l; });
      return { wch: Math.min(Math.max(maxLen + 4, 12), 42) };
    });

    // Alto de filas
    ws['!rows'] = [];
    ws['!rows'][0] = { hpt: 26 };
    ws['!rows'][1] = { hpt: 22 };
    ws['!rows'][5] = { hpt: 28 };

    // ─── Crear libro y descargar ───
    const wb = XLSX.utils.book_new();
    const hoja = nombre.substring(0, 28).replace(/[:\\/?*\[\]]/g, '');
    XLSX.utils.book_append_sheet(wb, ws, hoja || 'Reporte');
    XLSX.writeFile(wb, `${nombre.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function exportarPDF(titulo, columnas, filas) {
    const filtros = `Periodo: ${document.getElementById('rep-desde').value} al ${document.getElementById('rep-hasta').value}`;
    const win = window.open('', '_blank');
    let html = `<html><head><title>${titulo}</title><style>
      body{font-family:Arial,sans-serif;padding:30px;color:#333}
      h1{font-size:18px;margin-bottom:4px}
      .sub{font-size:12px;color:#666;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{background:#e53935;color:#fff;padding:8px;text-align:left}
      td{padding:7px;border-bottom:1px solid #ddd}
      tr:nth-child(even){background:#f9f9f9}
      @media print{button{display:none}}
    </style></head><body>
      <h1>${titulo}</h1>
      <div class="sub">${filtros} · Generado: ${new Date().toLocaleString('es-PE')}</div>
      <button onclick="window.print()" style="margin-bottom:16px;padding:8px 16px;background:#e53935;color:#fff;border:none;border-radius:6px;cursor:pointer">Imprimir / Guardar PDF</button>
      <table><thead><tr>${columnas.map(c => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${filas.map(f => `<tr>${f.map(v => `<td>${v ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </body></html>`;
    win.document.write(html);
    win.document.close();
  }

  // Guardar datos actuales para exportar
  let datosActuales = {};

  function botonesExport(nombre) {
    return `<div style="display:flex;gap:6px">
      <button class="btn btn-outline rep-btn-export" onclick="repExportCSV('${nombre}')"><i class="ti ti-file-spreadsheet"></i> Excel</button>
      <button class="btn btn-outline rep-btn-export" onclick="repExportPDF('${nombre}')"><i class="ti ti-file-text"></i> PDF</button>
    </div>`;
  }

  // ══════════ CARGA DE CADA TAB ══════════
  async function cargarTab(tab) {
    const cont = document.getElementById('rep-tab-' + tab);
    cont.innerHTML = '<div class="rep-loading"><div class="spinner"></div> Cargando reportes...</div>';
    const filtros = getFiltros();

    try {
      const endpoint = tab === 'ecommerce' ? 'ventas' : tab;
      const res = await Http.get(`/reportes/${endpoint}?${filtros}`);
      if (!res?.ok) {
        cont.innerHTML = `<div class="rep-empty">${res?.msg || 'Error al cargar'}</div>`;
        return;
      }
      if (tab === 'ventas') renderVentas(cont, res);
      else if (tab === 'ecommerce') renderEcommerce(cont, res);
      else if (tab === 'productos') renderProductos(cont, res);
      else if (tab === 'clientes') renderClientes(cont, res);
      else if (tab === 'finanzas') renderFinanzas(cont, res);
      else if (tab === 'cotizaciones') renderCotizaciones(cont, res);
      else if (tab === 'inventario') renderInventario(cont,res);
      else if (tab === 'comprobantes') renderComprobantes(cont,res);
      else if (tab === 'logistica') renderLogistica(cont, res);
    } catch (e) {
      cont.innerHTML = `<div class="rep-empty">Error: ${e.message}</div>`;
    }
  }

  // ══════════ RENDER: VENTAS ══════════
  function renderVentas(cont, d) {
    const k = d.kpi || {};
    const porCanal = d.porCanal || [];
    const web = porCanal.find(x => String(x.canal).toLowerCase() === 'web') || {};
    const presencial = porCanal.find(x => String(x.canal).toLowerCase() === 'presencial') || {};
    const webReport = d.web || {};
    const webKpi = webReport.kpi || {};

    datosActuales.ventas_vendedor = d.porVendedor || [];
    datosActuales.ventas_sucursal = d.porSucursal || [];
    datosActuales.ventas_canal = porCanal;
    datosActuales.ventas_dia_canal = d.porDiaCanal || [];
    datosActuales.ventas_metodo_canal = d.metodoPorCanal || [];
    datosActuales.ventas_entrega_canal = d.entregaPorCanal || [];
    datosActuales.ventas_detalle = d.detalleVentas || [];
    datosActuales.web_estado = webReport.porEstado || [];
    datosActuales.web_metodo = webReport.porMetodo || [];
    datosActuales.web_entrega = webReport.porEntrega || [];
    datosActuales.web_detalle = webReport.detalle || [];

    const channelBadge = channel => {
      const isWeb = String(channel).toLowerCase() === 'web';
      return `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${isWeb ? 'rgba(14,165,233,.14)' : 'rgba(34,197,94,.14)'};color:${isWeb ? '#38bdf8' : '#4ade80'}"><i class="ti ${isWeb ? 'ti-world-www' : 'ti-building-store'}"></i>${isWeb ? 'Página web' : 'Presencial'}</span>`;
    };
    const pct = (value,total) => Number(total||0)>0 ? ((Number(value||0)/Number(total))*100).toFixed(1)+'%' : '0.0%';

    let html = `
      <div class="rep-kpi-grid">
        <div class="rep-kpi"><div class="rep-kpi-label">Total vendido</div><div class="rep-kpi-value" style="color:var(--success)">${fmt(k.total_vendido)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Ventas registradas</div><div class="rep-kpi-value">${fmtNum(k.num_ventas)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Ticket promedio</div><div class="rep-kpi-value">${fmt(k.ticket_promedio)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">IGV registrado</div><div class="rep-kpi-value">${fmt(k.igv)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Descuentos</div><div class="rep-kpi-value" style="color:var(--danger)">${fmt(k.descuentos)}</div></div>
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Comparación: página web vs atención presencial ${botonesExport('ventas_canal')}</div>
        <div class="rep-kpi-grid" style="margin-bottom:16px">
          <div class="rep-kpi" style="border-left:4px solid #38bdf8">
            <div class="rep-kpi-label"><i class="ti ti-world-www"></i> Ventas por página web</div>
            <div class="rep-kpi-value">${fmt(web.total)}</div>
            <div style="font-size:12px;color:var(--texto-muted);margin-top:8px">${fmtNum(web.cantidad)} ventas · Ticket ${fmt(web.ticket_promedio)} · ${pct(web.total,k.total_vendido)} del total</div>
          </div>
          <div class="rep-kpi" style="border-left:4px solid #4ade80">
            <div class="rep-kpi-label"><i class="ti ti-building-store"></i> Ventas presenciales</div>
            <div class="rep-kpi-value">${fmt(presencial.total)}</div>
            <div style="font-size:12px;color:var(--texto-muted);margin-top:8px">${fmtNum(presencial.cantidad)} ventas · Ticket ${fmt(presencial.ticket_promedio)} · ${pct(presencial.total,k.total_vendido)} del total</div>
          </div>
        </div>
        ${tabla(
          [{label:'Canal'},{label:'Ventas',align:'right'},{label:'Unidades',align:'right'},{label:'Subtotal',align:'right'},{label:'IGV',align:'right'},{label:'Descuentos',align:'right'},{label:'Total',align:'right'},{label:'Ticket prom.',align:'right'}],
          porCanal,
          x => `<td>${channelBadge(x.canal)}</td><td style="text-align:right">${fmtNum(x.cantidad)}</td><td style="text-align:right">${fmtNum(x.unidades)}</td><td style="text-align:right">${fmt(x.subtotal)}</td><td style="text-align:right">${fmt(x.igv)}</td><td style="text-align:right">${fmt(x.descuentos)}</td><td style="text-align:right;font-weight:700">${fmt(x.total)}</td><td style="text-align:right">${fmt(x.ticket_promedio)}</td>`
        )}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Tendencia total de ventas por día</div>
        ${graficoLinea(d.porDia || [], 'fecha', 'total', {moneda:true})}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Detalle diario por canal ${botonesExport('ventas_dia_canal')}</div>
        ${tabla(
          [{label:'Fecha'},{label:'Ventas web',align:'right'},{label:'Total web',align:'right'},{label:'Ventas presenciales',align:'right'},{label:'Total presencial',align:'right'},{label:'Total del día',align:'right'}],
          d.porDiaCanal || [],
          x => `<td>${esc(String(x.fecha||'').slice(0,10))}</td><td style="text-align:right">${fmtNum(x.ventas_web)}</td><td style="text-align:right">${fmt(x.total_web)}</td><td style="text-align:right">${fmtNum(x.ventas_presenciales)}</td><td style="text-align:right">${fmt(x.total_presencial)}</td><td style="text-align:right;font-weight:700">${fmt(x.total)}</td>`
        )}
      </div>`;

    if (d.porSucursal && d.porSucursal.length) {
      html += `<div class="rep-card">
        <div class="rep-card-title">Ventas por sucursal ${botonesExport('ventas_sucursal')}</div>
        ${graficoBarrasVert(d.porSucursal, 'sucursal', 'total', {moneda:true})}
      </div>`;
    }

    html += `<div class="rep-card">
      <div class="rep-card-title">Ranking de vendedores ${botonesExport('ventas_vendedor')}</div>
      ${tabla(
        [{label:'#'},{label:'Vendedor'},{label:'# Ventas',align:'right'},{label:'Total',align:'right'},{label:'Ticket prom.',align:'right'}],
        d.porVendedor || [],
        (v,i) => `<td style="color:var(--texto-muted)">${i+1}</td><td>${esc(v.vendedor)}</td><td style="text-align:right">${fmtNum(v.cantidad)}</td><td style="text-align:right;font-weight:600">${fmt(v.total)}</td><td style="text-align:right">${fmt(v.ticket_promedio)}</td>`
      )}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:18px">
      <div class="rep-card">
        <div class="rep-card-title">Métodos de pago generales</div>
        ${graficoDona(d.porMetodo || [], 'metodo', 'total')}
      </div>
      <div class="rep-card">
        <div class="rep-card-title">Participación por canal</div>
        ${graficoDona(porCanal, 'canal', 'total')}
      </div>
    </div>

    <div class="rep-card">
      <div class="rep-card-title">Métodos de pago por canal ${botonesExport('ventas_metodo_canal')}</div>
      ${tabla(
        [{label:'Canal'},{label:'Método'},{label:'Operaciones',align:'right'},{label:'Total',align:'right'},{label:'Ticket prom.',align:'right'}],
        d.metodoPorCanal || [],
        x => `<td>${channelBadge(x.canal)}</td><td style="text-transform:capitalize">${esc(x.metodo)}</td><td style="text-align:right">${fmtNum(x.cantidad)}</td><td style="text-align:right;font-weight:700">${fmt(x.total)}</td><td style="text-align:right">${fmt(x.ticket_promedio)}</td>`
      )}
    </div>

    <div class="rep-card">
      <div class="rep-card-title">Modalidad de entrega por canal ${botonesExport('ventas_entrega_canal')}</div>
      ${tabla(
        [{label:'Canal'},{label:'Entrega'},{label:'Ventas',align:'right'},{label:'Total',align:'right'}],
        d.entregaPorCanal || [],
        x => `<td>${channelBadge(x.canal)}</td><td style="text-transform:capitalize">${esc(x.tipo_entrega)}</td><td style="text-align:right">${fmtNum(x.cantidad)}</td><td style="text-align:right;font-weight:700">${fmt(x.total)}</td>`
      )}
    </div>`;

    if (d.porComprobante && d.porComprobante.length) {
      html += `<div class="rep-card">
        <div class="rep-card-title">Tipo de comprobante</div>
        ${graficoDona(d.porComprobante, 'comprobante', 'total')}
      </div>`;
    }

    html += `
      <div class="rep-card">
        <div class="rep-card-title"><span><i class="ti ti-world-www"></i> Rendimiento de pedidos de la página web</span></div>
        <div class="rep-kpi-grid">
          <div class="rep-kpi"><div class="rep-kpi-label">Pedidos recibidos</div><div class="rep-kpi-value">${fmtNum(webKpi.pedidos)}</div></div>
          <div class="rep-kpi"><div class="rep-kpi-label">Aprobados</div><div class="rep-kpi-value" style="color:var(--success)">${fmtNum(webKpi.aprobados)}</div></div>
          <div class="rep-kpi"><div class="rep-kpi-label">Pendientes / observados</div><div class="rep-kpi-value" style="color:var(--warning)">${fmtNum(Number(webKpi.pendientes||0)+Number(webKpi.observados||0))}</div></div>
          <div class="rep-kpi"><div class="rep-kpi-label">Rechazados</div><div class="rep-kpi-value" style="color:var(--danger)">${fmtNum(webKpi.rechazados)}</div></div>
          <div class="rep-kpi"><div class="rep-kpi-label">Monto aprobado</div><div class="rep-kpi-value">${fmt(webKpi.monto_aprobado)}</div></div>
          <div class="rep-kpi"><div class="rep-kpi-label">Tasa de aprobación</div><div class="rep-kpi-value">${Number(webKpi.tasa_aprobacion||0).toFixed(1)}%</div></div>
          <div class="rep-kpi"><div class="rep-kpi-label">Tiempo prom. de revisión</div><div class="rep-kpi-value">${Number(webKpi.minutos_promedio_revision||0).toFixed(0)} min</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
          <div>
            <div style="font-weight:700;margin-bottom:8px">Estados del pago web ${botonesExport('web_estado')}</div>
            ${tabla(
              [{label:'Estado'},{label:'Pedidos',align:'right'},{label:'Monto',align:'right'}],
              webReport.porEstado || [],
              x => `<td style="text-transform:capitalize">${esc(x.estado)}</td><td style="text-align:right">${fmtNum(x.cantidad)}</td><td style="text-align:right">${fmt(x.total)}</td>`
            )}
          </div>
          <div>
            <div style="font-weight:700;margin-bottom:8px">Métodos usados en la web ${botonesExport('web_metodo')}</div>
            ${tabla(
              [{label:'Método'},{label:'Pedidos',align:'right'},{label:'Aprobados',align:'right'},{label:'Monto',align:'right'}],
              webReport.porMetodo || [],
              x => `<td style="text-transform:capitalize">${esc(x.metodo)}</td><td style="text-align:right">${fmtNum(x.cantidad)}</td><td style="text-align:right">${fmtNum(x.aprobados)}</td><td style="text-align:right">${fmt(x.total)}</td>`
            )}
          </div>
          <div>
            <div style="font-weight:700;margin-bottom:8px">Entrega solicitada en la web ${botonesExport('web_entrega')}</div>
            ${tabla(
              [{label:'Entrega'},{label:'Pedidos',align:'right'},{label:'Aprobados',align:'right'},{label:'Monto',align:'right'}],
              webReport.porEntrega || [],
              x => `<td style="text-transform:capitalize">${esc(x.tipo_entrega)}</td><td style="text-align:right">${fmtNum(x.cantidad)}</td><td style="text-align:right">${fmtNum(x.aprobados)}</td><td style="text-align:right">${fmt(x.total)}</td>`
            )}
          </div>
        </div>
      </div>

      <div class="rep-card">
        <div class="rep-card-title"><span><i class="ti ti-list-details"></i> Trazabilidad completa de pedidos web (hasta 1000 registros)</span>${botonesExport('web_detalle')}</div>
        ${tabla(
          [{label:'Fecha'},{label:'Pedido / estado'},{label:'Cliente y contacto'},{label:'Sucursales y productos'},{label:'Pago'},{label:'Entrega'},{label:'Monto',align:'right'},{label:'Venta generada'},{label:'Procesamiento'}],
          webReport.detalle || [],
          x => `<td style="white-space:nowrap">${esc(x.fecha)}</td>
            <td><b>${esc(x.numero_orden)}</b><br><small style="text-transform:capitalize">Pago: ${esc(x.estado_pago)} · Pedido: ${esc(x.estado_pedido)}</small>${x.observacion_resultado ? `<br><small>${esc(x.observacion_resultado)}</small>` : ''}</td>
            <td><b>${esc(x.cliente)}</b><br><small>${esc(x.documento||'Sin documento')}</small><br><small>${esc([x.telefono,x.email].filter(Boolean).join(' · ')||'Sin contacto')}</small></td>
            <td><b>${esc(x.sucursales||'—')}</b><br><small>${esc(x.productos||`${fmtNum(x.lineas)} líneas · ${fmtNum(x.unidades)} uds.`)}</small></td>
            <td style="text-transform:capitalize">${esc(x.metodo_pago||'—')}${x.numero_operacion ? `<br><small>Op.: ${esc(x.numero_operacion)}</small>` : ''}</td>
            <td style="text-transform:capitalize">${esc(x.tipo_entrega||'—')}${x.direccion_entrega ? `<br><small>${esc(x.direccion_entrega)}</small>` : ''}</td>
            <td style="text-align:right;font-weight:800">${fmt(x.total)}<br><small>IGV ${fmt(x.igv)}</small></td>
            <td>${x.venta_numero ? `<b>${esc(x.venta_numero)}</b>` : '<span style="color:var(--texto-muted)">Aún no generada</span>'}</td>
            <td>${x.procesado_at ? `${esc(x.procesado_at)}<br><small>${esc(x.procesado_por||'Usuario no disponible')} · ${fmtNum(x.minutos_revision)} min</small>` : '<span style="color:var(--texto-muted)">Pendiente</span>'}</td>`
        )}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Detalle completo de ventas web y presenciales (hasta 1000 registros) ${botonesExport('ventas_detalle')}</div>
        ${tabla(
          [{label:'Fecha'},{label:'Canal'},{label:'Venta / pedido'},{label:'Cliente y contacto'},{label:'Sucursal / vendedor'},{label:'Pago'},{label:'Entrega / comprobante'},{label:'Productos',align:'right'},{label:'Subtotal',align:'right'},{label:'IGV',align:'right'},{label:'Descuento',align:'right'},{label:'Total',align:'right'}],
          d.detalleVentas || [],
          x => `<td style="white-space:nowrap">${esc(x.fecha)}</td>
            <td>${channelBadge(x.canal)}</td>
            <td><b>${esc(x.numero)}</b>${x.pedido_web ? `<br><small>Pedido ${esc(x.pedido_web)} · ${esc(x.estado_pago_web||'')}</small>` : '<br><small>Registro directo</small>'}</td>
            <td><b>${esc(x.cliente)}</b><br><small>${esc(x.documento||'Sin documento')}</small><br><small>${esc([x.telefono,x.email].filter(Boolean).join(' · ')||'Sin contacto')}</small>${x.direccion_entrega ? `<br><small>${esc(x.direccion_entrega)}</small>` : ''}</td>
            <td>${esc(x.sucursal||'—')}<br><small>Vendedor: ${esc(x.vendedor||'—')}</small>${x.aprobado_por ? `<br><small>Aprobado por: ${esc(x.aprobado_por)}${x.aprobado_at ? ` · ${esc(x.aprobado_at)}` : ''}</small>` : ''}</td>
            <td style="text-transform:capitalize">${esc(x.metodo_pago||'efectivo')}${x.referencias_pago ? `<br><small>Op.: ${esc(x.referencias_pago)}</small>` : ''}</td>
            <td style="text-transform:capitalize">${esc(x.tipo_entrega||'—')}<br><small>${esc(x.tipo_comprobante||'—')}</small></td>
            <td style="text-align:right">${fmtNum(x.lineas)} líneas<br><small>${fmtNum(x.unidades)} uds.</small>${x.productos ? `<br><small>${esc(x.productos)}</small>` : ''}</td>
            <td style="text-align:right">${fmt(x.subtotal)}</td>
            <td style="text-align:right">${fmt(x.igv)}</td>
            <td style="text-align:right">${fmt(x.descuento)}</td>
            <td style="text-align:right;font-weight:800">${fmt(x.total)}</td>`
        )}
      </div>`;

    cont.innerHTML = html;
  }

  // ══════════ RENDER: ECOMMERCE ══════════
  function renderEcommerce(cont, d) {
    const webReport = d.web || {};
    const k = webReport.kpi || {};
    const detalle = webReport.detalle || [];
    const diario = (d.porDiaCanal || []).map(x => ({
      fecha: String(x.fecha || '').slice(0,10),
      pedidos: Number(x.ventas_web || 0),
      total: Number(x.total_web || 0)
    }));
    const webVentas = (d.detalleVentas || []).filter(x => String(x.canal || '').toLowerCase() === 'web');
    const totalPedidos = Number(k.total_pedidos || k.pedidos || detalle.length || 0);
    const aprobados = Number(k.aprobados || 0);
    const pendientes = Number(k.pendientes || 0);
    const observados = Number(k.observados || 0);
    const rechazados = Number(k.rechazados || 0);
    const monto = Number(k.monto_aprobado || webVentas.reduce((a,x)=>a+Number(x.total||0),0));
    const delivery = (webReport.porEntrega || []).find(x => String(x.tipo_entrega).toLowerCase() === 'delivery') || {};
    const recojo = (webReport.porEntrega || []).find(x => String(x.tipo_entrega).toLowerCase() === 'recojo') || {};
    const clientes = new Set(detalle.map(x => String(x.documento || x.email || x.cliente || '')).filter(Boolean)).size;
    const ticket = aprobados ? monto / aprobados : 0;

    datosActuales.web_estado = webReport.porEstado || [];
    datosActuales.web_metodo = webReport.porMetodo || [];
    datosActuales.web_entrega = webReport.porEntrega || [];
    datosActuales.web_detalle = detalle;
    datosActuales.ecommerce_diario = diario;
    datosActuales.ecommerce_ventas = webVentas;

    const stateBadge = value => {
      const v=String(value||'pendiente').toLowerCase();
      const map={aprobado:['#dcfce7','#166534'],pendiente:['#fef3c7','#92400e'],observado:['#ffedd5','#9a3412'],rechazado:['#fee2e2','#991b1b']};
      const c=map[v]||['#e2e8f0','#334155'];
      return `<span style="display:inline-flex;padding:4px 9px;border-radius:999px;background:${c[0]};color:${c[1]};font-weight:800;font-size:10px;text-transform:uppercase">${esc(v)}</span>`;
    };

    cont.innerHTML = `
      <div class="rep-card" style="border-left:5px solid #0ea5e9;background:linear-gradient(135deg,rgba(14,165,233,.08),transparent)">
        <div class="rep-card-title"><span><i class="ti ti-world-www"></i> Control completo del Ecommerce</span>${botonesExport('web_detalle')}</div>
        <p style="font-size:12px;color:var(--texto-muted);margin:-8px 0 0">Pedidos, pagos, entrega, conversión y ventas generadas desde la página web.</p>
      </div>
      <div class="rep-kpi-grid">
        <div class="rep-kpi"><div class="rep-kpi-label">Pedidos web</div><div class="rep-kpi-value">${fmtNum(totalPedidos)}</div><small>${fmtNum(clientes)} compradores identificados</small></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Aprobados</div><div class="rep-kpi-value" style="color:var(--success)">${fmtNum(aprobados)}</div><small>${Number(k.tasa_aprobacion||0).toFixed(1)}% de aprobación</small></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Pendientes / observados</div><div class="rep-kpi-value" style="color:var(--warning)">${fmtNum(pendientes+observados)}</div><small>Requieren revisión</small></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Rechazados</div><div class="rep-kpi-value" style="color:var(--danger)">${fmtNum(rechazados)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Monto aprobado</div><div class="rep-kpi-value">${fmt(monto)}</div><small>Ticket ${fmt(ticket)}</small></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Tiempo de revisión</div><div class="rep-kpi-value">${Number(k.minutos_promedio_revision||0).toFixed(0)} min</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Delivery</div><div class="rep-kpi-value">${fmtNum(delivery.cantidad)}</div><small>${fmt(delivery.total)}</small></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Recojo</div><div class="rep-kpi-value">${fmtNum(recojo.cantidad)}</div><small>${fmt(recojo.total)}</small></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px">
        <div class="rep-card"><div class="rep-card-title">Pedidos por estado ${botonesExport('web_estado')}</div>${graficoDona(webReport.porEstado||[],'estado','cantidad')}</div>
        <div class="rep-card"><div class="rep-card-title">Métodos de pago ${botonesExport('web_metodo')}</div>${graficoDona(webReport.porMetodo||[],'metodo','total')}</div>
        <div class="rep-card"><div class="rep-card-title">Modalidad de entrega ${botonesExport('web_entrega')}</div>${graficoBarrasVert(webReport.porEntrega||[],'tipo_entrega','total',{moneda:true})}</div>
      </div>
      <div class="rep-card">
        <div class="rep-card-title">Evolución diaria de ventas web ${botonesExport('ecommerce_diario')}</div>
        ${graficoLinea(diario,'fecha','total',{moneda:true})}
        ${tabla([{label:'Fecha'},{label:'Pedidos',align:'right'},{label:'Total',align:'right'}],diario,x=>`<td>${esc(x.fecha)}</td><td style="text-align:right">${fmtNum(x.pedidos)}</td><td style="text-align:right;font-weight:800">${fmt(x.total)}</td>`)}
      </div>
      <div class="rep-card">
        <div class="rep-card-title"><span><i class="ti ti-route"></i> Trazabilidad Ecommerce (hasta 1000 pedidos)</span>${botonesExport('web_detalle')}</div>
        ${tabla(
          [{label:'Pedido / fecha'},{label:'Comprador'},{label:'Pago'},{label:'Entrega'},{label:'Sucursales / productos'},{label:'Monto',align:'right'},{label:'Venta'},{label:'Procesamiento'}],
          detalle,
          x=>`<td><b>${esc(x.numero_orden)}</b><br><small>${esc(x.fecha||'—')}</small><br>${stateBadge(x.estado_pago)}</td>
              <td><b>${esc(x.cliente||'—')}</b><br><small>${esc(x.documento||'Sin documento')}</small><br><small>${esc([x.telefono,x.email].filter(Boolean).join(' · ')||'Sin contacto')}</small></td>
              <td style="text-transform:capitalize">${esc(x.metodo_pago||'—')}${x.numero_operacion?`<br><small>Op. ${esc(x.numero_operacion)}</small>`:''}</td>
              <td style="text-transform:capitalize"><b>${esc(x.tipo_entrega||'—')}</b>${x.direccion_entrega?`<br><small>${esc(x.direccion_entrega)}</small>`:''}</td>
              <td><b>${esc(x.sucursales||'—')}</b><br><small>${esc(x.productos||`${fmtNum(x.lineas)} líneas · ${fmtNum(x.unidades)} uds.`)}</small></td>
              <td style="text-align:right;font-weight:900">${fmt(x.total)}</td>
              <td>${x.venta_numero?`<b>${esc(x.venta_numero)}</b>`:'<span style="color:var(--texto-muted)">No generada</span>'}</td>
              <td>${x.procesado_at?`${esc(x.procesado_at)}<br><small>${esc(x.procesado_por||'—')} · ${fmtNum(x.minutos_revision)} min</small>`:'<span style="color:var(--warning)">Pendiente</span>'}</td>`
        )}
      </div>
      <div class="rep-card">
        <div class="rep-card-title">Ventas generadas por Ecommerce ${botonesExport('ecommerce_ventas')}</div>
        ${tabla(
          [{label:'Fecha'},{label:'Venta / pedido'},{label:'Cliente'},{label:'Sucursal'},{label:'Pago'},{label:'Entrega'},{label:'Productos'},{label:'Total',align:'right'}],
          webVentas,
          x=>`<td>${esc(x.fecha||'—')}</td><td><b>${esc(x.numero)}</b><br><small>${esc(x.pedido_web||'—')}</small></td><td>${esc(x.cliente||'—')}<br><small>${esc(x.documento||'')}</small></td><td>${esc(x.sucursal||'—')}</td><td>${esc(x.metodo_pago||'—')}<br><small>${esc(x.referencias_pago||'')}</small></td><td>${esc(x.tipo_entrega||'—')}</td><td><small>${esc(x.productos||'—')}</small></td><td style="text-align:right;font-weight:900">${fmt(x.total)}</td>`
        )}
      </div>`;
  }

  // ══════════ RENDER: PRODUCTOS ══════════
  function renderProductos(cont, d) {
    datosActuales.prod_vendidos = d.masVendidos || [];
    datosActuales.prod_stock = d.bajoStock || [];
    datosActuales.prod_margen = d.margen || [];
    datosActuales.prod_sinmov = d.sinMovimiento || [];

    let html = `
      <div class="rep-card">
        <div class="rep-card-title">Productos más vendidos ${botonesExport('prod_vendidos')}</div>
        ${tabla(
          [{label:'Producto'},{label:'Marca'},{label:'Unidades',align:'right'},{label:'Total vendido',align:'right'},{label:'# Ventas',align:'right'}],
          d.masVendidos || [],
          p => `<td>${esc(p.nombre)}</td><td style="color:var(--texto-muted)">${esc(p.marca||'—')}</td><td style="text-align:right;font-weight:600">${fmtNum(p.unidades)}</td><td style="text-align:right">${fmt(p.total_vendido)}</td><td style="text-align:right">${fmtNum(p.num_ventas)}</td>`
        )}
      </div>

      <div class="rep-card">
        <div class="rep-card-title" style="color:var(--danger)">⚠ Bajo stock / Sin stock ${botonesExport('prod_stock')}</div>
        ${tabla(
          [{label:'Producto'},{label:'Sucursal'},{label:'Stock actual',align:'right'},{label:'Stock mínimo',align:'right'}],
          d.bajoStock || [],
          p => `<td>${esc(p.nombre)}</td><td>${esc(p.sucursal||'Global')}</td><td style="text-align:right;font-weight:600;color:${p.stock_actual<=0?'var(--danger)':'var(--warning)'}">${fmtNum(p.stock_actual)}</td><td style="text-align:right">${fmtNum(p.stock_minimo)}</td>`
        )}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Margen de ganancia por producto ${botonesExport('prod_margen')}</div>
        ${tabla(
          [{label:'Producto'},{label:'Costo',align:'right'},{label:'Venta',align:'right'},{label:'Margen %',align:'right'},{label:'Uds. vend.',align:'right'},{label:'Ganancia',align:'right'}],
          d.margen || [],
          p => `<td>${p.nombre}</td><td style="text-align:right">${fmt(p.precio_costo)}</td><td style="text-align:right">${fmt(p.precio_venta)}</td><td style="text-align:right;font-weight:600;color:var(--success)">${p.margen_pct}%</td><td style="text-align:right">${fmtNum(p.unidades_vendidas)}</td><td style="text-align:right;font-weight:600">${fmt(p.ganancia_total)}</td>`
        )}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Productos sin movimiento (no vendidos en el periodo) ${botonesExport('prod_sinmov')}</div>
        ${tabla(
          [{label:'Producto'},{label:'Sucursal'},{label:'Stock',align:'right'}],
          d.sinMovimiento || [],
          p => `<td>${esc(p.nombre)}</td><td>${esc(p.sucursal||'Global')}</td><td style="text-align:right">${fmtNum(p.stock_actual)}</td>`
        )}
      </div>`;

    cont.innerHTML = html;
  }

  // ══════════ RENDER: CLIENTES ══════════
  function renderClientes(cont, d) {
    datosActuales.cli_top = d.top || [];
    datosActuales.cli_inactivos = d.inactivos || [];

    const totalNuevos = (d.nuevos || []).reduce((a, n) => a + Number(n.cantidad), 0);

    let html = `
      <div class="rep-kpi-grid">
        <div class="rep-kpi"><div class="rep-kpi-label">Clientes nuevos (periodo)</div><div class="rep-kpi-value" style="color:var(--success)">${fmtNum(totalNuevos)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Clientes activos (top)</div><div class="rep-kpi-value">${fmtNum((d.top||[]).length)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Clientes inactivos (+60d)</div><div class="rep-kpi-value" style="color:var(--danger)">${fmtNum((d.inactivos||[]).length)}</div></div>
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Nuevos clientes por día</div>
        ${graficoLinea(d.nuevos || [], 'fecha', 'cantidad', {moneda:false})}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Top compradores ${botonesExport('cli_top')}</div>
        ${tabla(
          [{label:'Cliente'},{label:'Documento'},{label:'Tipo'},{label:'# Compras',align:'right'},{label:'Total gastado',align:'right'},{label:'Última compra',align:'right'}],
          d.top || [],
          c => `<td>${c.nombre}</td><td style="color:var(--texto-muted)">${c.numero_doc}</td><td>${c.tipo_cliente}</td><td style="text-align:right">${fmtNum(c.num_compras)}</td><td style="text-align:right;font-weight:600">${fmt(c.total_gastado)}</td><td style="text-align:right;color:var(--texto-muted)">${c.ultima_compra||'—'}</td>`
        )}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Distribución por tipo de cliente</div>
        ${graficoDona(d.porTipo || [], 'tipo_cliente', 'total')}
      </div>

      <div class="rep-card">
        <div class="rep-card-title" style="color:var(--warning)">Clientes inactivos (sin comprar +60 días) ${botonesExport('cli_inactivos')}</div>
        ${tabla(
          [{label:'Cliente'},{label:'Documento'},{label:'Teléfono'},{label:'Días sin comprar',align:'right'},{label:'Total histórico',align:'right'}],
          d.inactivos || [],
          c => `<td>${c.nombre}</td><td style="color:var(--texto-muted)">${c.numero_doc}</td><td>${c.telefono||'—'}</td><td style="text-align:right;font-weight:600;color:var(--danger)">${fmtNum(c.dias_sin_comprar)}</td><td style="text-align:right">${fmt(c.total_historico)}</td>`
        )}
      </div>`;

    cont.innerHTML = html;
  }

  // ══════════ RENDER: FINANZAS ══════════
  function renderFinanzas(cont, d) {
    datosActuales.fin_arqueos = d.arqueos || [];
    datosActuales.fin_cxc = d.cxc || [];

    const totalIngresos = (d.flujo || []).reduce((a, f) => a + Number(f.ingresos), 0);
    const totalEgresos = (d.flujo || []).reduce((a, f) => a + Number(f.egresos), 0);
    const totalConciliado = (d.conciliacion || []).reduce((a, c) => a + Number(c.conciliado), 0);
    const totalPendiente = (d.conciliacion || []).reduce((a, c) => a + Number(c.pendiente), 0);

    let html = `
      <div class="rep-kpi-grid">
        <div class="rep-kpi"><div class="rep-kpi-label">Ingresos (caja)</div><div class="rep-kpi-value" style="color:var(--success)">${fmt(totalIngresos)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Egresos (caja)</div><div class="rep-kpi-value" style="color:var(--danger)">${fmt(totalEgresos)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Digital conciliado</div><div class="rep-kpi-value" style="color:var(--success)">${fmt(totalConciliado)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Digital pendiente</div><div class="rep-kpi-value" style="color:var(--warning)">${fmt(totalPendiente)}</div></div>
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Flujo de caja — Ingresos por día</div>
        ${graficoLinea(d.flujo || [], 'fecha', 'ingresos', {moneda:true})}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Conciliación de pagos digitales (gráfico)</div>
        ${(d.conciliacion && d.conciliacion.length) ? graficoDona(d.conciliacion, 'metodo', 'total') : '<div class="rep-empty">Sin pagos digitales en el periodo</div>'}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Conciliación de pagos digitales</div>
        ${tabla(
          [{label:'Método'},{label:'Cantidad',align:'right'},{label:'Total',align:'right'},{label:'Conciliado',align:'right'},{label:'Pendiente',align:'right'}],
          d.conciliacion || [],
          c => `<td style="text-transform:uppercase;font-weight:600">${c.metodo}</td><td style="text-align:right">${fmtNum(c.cantidad)}</td><td style="text-align:right">${fmt(c.total)}</td><td style="text-align:right;color:var(--success)">${fmt(c.conciliado)}</td><td style="text-align:right;color:var(--warning)">${fmt(c.pendiente)}</td>`
        )}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Arqueos de caja ${botonesExport('fin_arqueos')}</div>
        ${tabla(
          [{label:'Caja'},{label:'Cajero'},{label:'Sucursal'},{label:'Esperado',align:'right'},{label:'Contado',align:'right'},{label:'Diferencia',align:'right'},{label:'Estado'}],
          d.arqueos || [],
          a => {
            const difColor = a.diferencia == null ? '' : a.diferencia < 0 ? 'color:var(--danger)' : a.diferencia > 0 ? 'color:var(--success)' : '';
            return `<td>CAJA-${String(a.numero_caja||a.id).padStart(5,'0')}</td><td>${a.cajero||'—'}</td><td>${a.sucursal||'—'}</td><td style="text-align:right">${fmt(a.esperado)}</td><td style="text-align:right">${a.monto_final!=null?fmt(a.monto_final):'—'}</td><td style="text-align:right;${difColor};font-weight:600">${a.diferencia!=null?fmt(a.diferencia):'—'}</td><td>${a.estado}</td>`;
          }
        )}
      </div>`;

    // CxC solo si hay datos
    if (d.cxc && d.cxc.length) {
      html += `<div class="rep-card">
        <div class="rep-card-title" style="color:var(--warning)">Cuentas por cobrar ${botonesExport('fin_cxc')}</div>
        ${tabla(
          [{label:'Cliente'},{label:'Documento'},{label:'Total',align:'right'},{label:'Pagado',align:'right'},{label:'Saldo',align:'right'},{label:'Días vencido',align:'right'}],
          d.cxc,
          c => `<td>${c.cliente||'—'}</td><td style="color:var(--texto-muted)">${c.numero_doc||'—'}</td><td style="text-align:right">${fmt(c.monto_total)}</td><td style="text-align:right;color:var(--success)">${fmt(c.monto_pagado)}</td><td style="text-align:right;font-weight:600;color:var(--danger)">${fmt(c.saldo)}</td><td style="text-align:right">${c.dias_vencido>0?c.dias_vencido:'—'}</td>`
        )}
      </div>`;
    }

    cont.innerHTML = html;
  }

  // ══════════ RENDER: COTIZACIONES ══════════
  function renderCotizaciones(cont, d) {
    datosActuales.cot_vendedor = d.porVendedor || [];
    const c = d.conversion || {};
    const tasaConversion = c.total_cotizaciones > 0 ? ((c.convertidas / c.total_cotizaciones) * 100).toFixed(1) : 0;

    let html = `
      <div class="rep-kpi-grid">
        <div class="rep-kpi"><div class="rep-kpi-label">Total cotizaciones</div><div class="rep-kpi-value">${fmtNum(c.total_cotizaciones)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Tasa de conversión</div><div class="rep-kpi-value" style="color:var(--success)">${tasaConversion}%</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Convertidas</div><div class="rep-kpi-value">${fmtNum(c.convertidas)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Monto convertido</div><div class="rep-kpi-value" style="color:var(--success)">${fmt(c.monto_convertido)}</div></div>
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Estado de cotizaciones</div>
        ${graficoDona(d.porEstado || [], 'estado', 'total')}
      </div>

      <div class="rep-card">
        <div class="rep-card-title">Cotizaciones por vendedor ${botonesExport('cot_vendedor')}</div>
        ${tabla(
          [{label:'Vendedor'},{label:'Total',align:'right'},{label:'Convertidas',align:'right'},{label:'Monto',align:'right'}],
          d.porVendedor || [],
          v => `<td>${v.vendedor}</td><td style="text-align:right">${fmtNum(v.total_cotizaciones)}</td><td style="text-align:right;color:var(--success)">${fmtNum(v.convertidas)}</td><td style="text-align:right;font-weight:600">${fmt(v.monto_total)}</td>`
        )}
      </div>`;

    cont.innerHTML = html;
  }

  // ══════════ RENDER: INVENTARIO ══════════
  function renderInventario(cont,d){
    const k=d.kpi||{};datosActuales.inv_movimientos=d.movimientos||[];
    cont.innerHTML=`<div class="rep-kpi-grid">
      <div class="rep-kpi"><div class="rep-kpi-label">Productos activos</div><div class="rep-kpi-value">${fmtNum(k.productos_activos)}</div></div>
      <div class="rep-kpi"><div class="rep-kpi-label">Unidades disponibles</div><div class="rep-kpi-value">${fmtNum(k.unidades_disponibles)}</div></div>
      <div class="rep-kpi"><div class="rep-kpi-label">Stock bajo</div><div class="rep-kpi-value" style="color:var(--warning)">${fmtNum(k.stock_bajo)}</div></div>
      <div class="rep-kpi"><div class="rep-kpi-label">Sin stock</div><div class="rep-kpi-value" style="color:var(--danger)">${fmtNum(k.sin_stock)}</div></div>
      <div class="rep-kpi"><div class="rep-kpi-label">Valor a costo</div><div class="rep-kpi-value">${fmt(k.valor_costo)}</div></div>
      <div class="rep-kpi"><div class="rep-kpi-label">Valor de venta</div><div class="rep-kpi-value" style="color:var(--success)">${fmt(k.valor_venta)}</div></div></div>
      <div class="rep-card"><div class="rep-card-title">Movimientos por tipo</div>${graficoBarrasVert(d.porTipo||[],'tipo','unidades',{moneda:false})}</div>
      <div class="rep-card"><div class="rep-card-title">Kardex reciente ${botonesExport('inv_movimientos')}</div>${tabla(
        [{label:'Fecha'},{label:'Producto'},{label:'Sucursal'},{label:'Tipo'},{label:'Cantidad',align:'right'},{label:'Antes',align:'right'},{label:'Después',align:'right'},{label:'Referencia'}],d.movimientos||[],
        x=>`<td>${x.created_at?new Date(x.created_at).toLocaleString('es-PE'):'—'}</td><td>${esc(x.producto)}</td><td>${esc(x.sucursal||'—')}</td><td>${esc(x.tipo)}</td><td style="text-align:right">${fmtNum(x.cantidad)}</td><td style="text-align:right">${fmtNum(x.stock_antes)}</td><td style="text-align:right">${fmtNum(x.stock_despues)}</td><td>${esc(x.referencia||'—')}</td>`
      )}</div>`;
  }

  // ══════════ RENDER: COMPROBANTES ══════════
  function renderComprobantes(cont,d){
    const k=d.kpi||{};datosActuales.comp_detalle=d.detalle||[];
    cont.innerHTML=`<div class="rep-kpi-grid">
      <div class="rep-kpi"><div class="rep-kpi-label">Emitidos</div><div class="rep-kpi-value">${fmtNum(k.emitidos)}</div></div>
      <div class="rep-kpi"><div class="rep-kpi-label">Monto emitido</div><div class="rep-kpi-value">${fmt(k.monto_emitido)}</div></div>
      <div class="rep-kpi"><div class="rep-kpi-label">Aceptados</div><div class="rep-kpi-value" style="color:var(--success)">${fmtNum(k.aceptados)}</div></div>
      <div class="rep-kpi"><div class="rep-kpi-label">Observados</div><div class="rep-kpi-value" style="color:var(--warning)">${fmtNum(k.observados)}</div></div>
      <div class="rep-kpi"><div class="rep-kpi-label">Pendientes</div><div class="rep-kpi-value">${fmtNum(k.pendientes)}</div></div>
      <div class="rep-kpi"><div class="rep-kpi-label">Rechazados</div><div class="rep-kpi-value" style="color:var(--danger)">${fmtNum(k.rechazados)}</div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px"><div class="rep-card"><div class="rep-card-title">Estado SUNAT</div>${graficoDona(d.porEstado||[],'estado','total')}</div><div class="rep-card"><div class="rep-card-title">Tipo de comprobante</div>${graficoDona(d.porTipo||[],'tipo','total')}</div></div>
      <div class="rep-card"><div class="rep-card-title">Detalle emitido ${botonesExport('comp_detalle')}</div>${tabla(
        [{label:'Comprobante'},{label:'Venta'},{label:'Cliente'},{label:'Sucursal'},{label:'Emisión'},{label:'Total',align:'right'},{label:'SUNAT'},{label:'Mensaje'}],d.detalle||[],
        x=>`<td>${esc(x.numero_full||'—')}<br><small>${esc(x.tipo)}</small></td><td>${esc(x.venta_numero||'—')}</td><td>${esc(x.cliente||'—')}</td><td>${esc(x.sucursal||'—')}</td><td>${x.emitido_at?new Date(x.emitido_at).toLocaleString('es-PE'):'—'}</td><td style="text-align:right">${fmt(x.total)}</td><td>${esc(x.estado_sunat)}</td><td>${esc(x.cdr_mensaje||x.cdr_codigo||'—')}</td>`
      )}</div>`;
  }

  // ══════════ RENDER: LOGÍSTICA ══════════
  function renderLogistica(cont, d) {
    datosActuales.log_rutas = d.rutas || [];
    const k = d.kpi || {};
    const rendimiento = d.rendimiento || [];
    let html = `
      <div class="rep-kpi-grid">
        <div class="rep-kpi"><div class="rep-kpi-label">Rutas</div><div class="rep-kpi-value">${fmtNum(k.rutas)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">En ruta</div><div class="rep-kpi-value" style="color:var(--primary)">${fmtNum(k.en_ruta)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Completadas</div><div class="rep-kpi-value" style="color:var(--success)">${fmtNum(k.completadas)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Pendientes por asignar</div><div class="rep-kpi-value" style="color:var(--warning)">${fmtNum(k.pendientes)}</div></div>
        <div class="rep-kpi"><div class="rep-kpi-label">Kilómetros</div><div class="rep-kpi-value">${Number(k.km_recorridos||0).toFixed(1)}</div></div>
      </div>
      <div class="rep-card">
        <div class="rep-card-title">Rendimiento de repartidores</div>
        ${tabla(
          [{label:'Repartidor'},{label:'Rutas',align:'right'},{label:'Paradas',align:'right'},{label:'Entregados',align:'right'},{label:'No entregados',align:'right'},{label:'Efectividad',align:'right'}],
          rendimiento,
          x => `<td>${x.repartidor||'—'}</td><td style="text-align:right">${fmtNum(x.rutas)}</td><td style="text-align:right">${fmtNum(x.paradas)}</td><td style="text-align:right;color:var(--success)">${fmtNum(x.entregados)}</td><td style="text-align:right;color:var(--danger)">${fmtNum(x.no_entregados)}</td><td style="text-align:right;font-weight:700">${Number(x.efectividad||0).toFixed(1)}%</td>`
        )}
      </div>
      <div class="rep-card">
        <div class="rep-card-title">Detalle de rutas ${botonesExport('log_rutas')}</div>
        ${tabla(
          [{label:'Código'},{label:'Fecha'},{label:'Sucursal'},{label:'Repartidor'},{label:'Camión'},{label:'Paradas',align:'right'},{label:'Entregados',align:'right'},{label:'Cobrado',align:'right'},{label:'Km',align:'right'},{label:'Estado'}],
          d.rutas || [],
          x => `<td>${x.codigo}</td><td>${String(x.fecha||'').slice(0,10)}</td><td>${x.sucursal||'—'}</td><td>${x.repartidor||'—'}</td><td>${x.placa||'—'}</td><td style="text-align:right">${fmtNum(x.paradas)}</td><td style="text-align:right">${fmtNum(x.entregados)}</td><td style="text-align:right">${fmt(x.cobrado)}</td><td style="text-align:right">${Number(x.kilometros||0).toFixed(1)}</td><td>${x.estado}</td>`
        )}
      </div>`;
    cont.innerHTML = html;
  }

  // ══════════ EXPORT HANDLERS ══════════
  const exportConfig = {
    ventas_vendedor: { titulo:'Ventas por vendedor', cols:['Vendedor','# Ventas','Total','Ticket promedio'], map: v => [v.vendedor, v.cantidad, v.total, Number(v.ticket_promedio).toFixed(2)] },
    ventas_sucursal: { titulo:'Ventas por sucursal', cols:['Sucursal','Cantidad','Total'], map: v => [v.sucursal, v.cantidad, v.total] },
    ventas_canal: { titulo:'Ventas web vs presencial', cols:['Canal','Ventas','Unidades','Subtotal','IGV','Descuentos','Total','Ticket promedio'], map:x=>[x.canal,x.cantidad,x.unidades,x.subtotal,x.igv,x.descuentos,x.total,x.ticket_promedio] },
    ventas_dia_canal: { titulo:'Ventas diarias por canal', cols:['Fecha','Ventas web','Total web','Ventas presenciales','Total presencial','Total del día'], map:x=>[String(x.fecha||'').slice(0,10),x.ventas_web,x.total_web,x.ventas_presenciales,x.total_presencial,x.total] },
    ventas_metodo_canal: { titulo:'Métodos de pago por canal', cols:['Canal','Método','Operaciones','Total','Ticket promedio'], map:x=>[x.canal,x.metodo,x.cantidad,x.total,x.ticket_promedio] },
    ventas_entrega_canal: { titulo:'Modalidades de entrega por canal', cols:['Canal','Entrega','Ventas','Total'], map:x=>[x.canal,x.tipo_entrega,x.cantidad,x.total] },
    ventas_detalle: { titulo:'Detalle completo de ventas web y presenciales', cols:['Fecha','Canal','Venta','Pedido web','Cliente','Documento','Teléfono','Correo','Dirección','Sucursal','Vendedor','Aprobado por','Fecha aprobación','Minutos revisión','Método','Referencia','Entrega','Comprobante','Líneas','Unidades','Productos','Subtotal','IGV','Descuento','Total','Estado'], map:x=>[x.fecha,x.canal,x.numero,x.pedido_web||'',x.cliente,x.documento,x.telefono,x.email,x.direccion_entrega,x.sucursal,x.vendedor,x.aprobado_por||'',x.aprobado_at||'',x.minutos_revision??'',x.metodo_pago,x.referencias_pago,x.tipo_entrega,x.tipo_comprobante,x.lineas,x.unidades,x.productos,x.subtotal,x.igv,x.descuento,x.total,x.estado_venta] },
    web_estado: { titulo:'Pedidos web por estado', cols:['Estado','Pedidos','Monto'], map:x=>[x.estado,x.cantidad,x.total] },
    web_metodo: { titulo:'Pedidos web por método de pago', cols:['Método','Pedidos','Aprobados','Monto'], map:x=>[x.metodo,x.cantidad,x.aprobados,x.total] },
    web_entrega: { titulo:'Pedidos web por modalidad de entrega', cols:['Entrega','Pedidos','Aprobados','Monto'], map:x=>[x.tipo_entrega,x.cantidad,x.aprobados,x.total] },
    web_detalle: { titulo:'Trazabilidad completa de pedidos web', cols:['Fecha','Pedido','Estado pago','Estado pedido','Cliente','Documento','Teléfono','Correo','Dirección','Sucursales','Productos','Líneas','Unidades','Método','Operación','Entrega','Subtotal','IGV','Total','Venta generada','Procesado por','Procesado el','Minutos revisión','Resultado'], map:x=>[x.fecha,x.numero_orden,x.estado_pago,x.estado_pedido,x.cliente,x.documento,x.telefono,x.email,x.direccion_entrega,x.sucursales,x.productos,x.lineas,x.unidades,x.metodo_pago,x.numero_operacion,x.tipo_entrega,x.subtotal,x.igv,x.total,x.venta_numero||'',x.procesado_por||'',x.procesado_at||'',x.minutos_revision??'',x.observacion_resultado||''] },
    ecommerce_diario: { titulo:'Ecommerce por día', cols:['Fecha','Pedidos','Total'], map:x=>[x.fecha,x.pedidos,x.total] },
    ecommerce_ventas: { titulo:'Ventas generadas por Ecommerce', cols:['Fecha','Venta','Pedido web','Cliente','Documento','Sucursal','Método','Referencia','Entrega','Productos','Subtotal','IGV','Descuento','Total'], map:x=>[x.fecha,x.numero,x.pedido_web||'',x.cliente,x.documento,x.sucursal,x.metodo_pago,x.referencias_pago,x.tipo_entrega,x.productos,x.subtotal,x.igv,x.descuento,x.total] },
    prod_vendidos: { titulo:'Productos más vendidos', cols:['Producto','Marca','Unidades','Total vendido','# Ventas'], map: p => [p.nombre, p.marca||'', p.unidades, p.total_vendido, p.num_ventas] },
    prod_stock: { titulo:'Bajo stock', cols:['Producto','Sucursal','Stock actual','Stock mínimo'], map: p => [p.nombre, p.sucursal||'Global', p.stock_actual, p.stock_minimo] },
    prod_margen: { titulo:'Margen por producto', cols:['Producto','Costo','Venta','Margen %','Uds vendidas','Ganancia'], map: p => [p.nombre, p.precio_costo, p.precio_venta, p.margen_pct, p.unidades_vendidas, p.ganancia_total] },
    prod_sinmov: { titulo:'Productos sin movimiento', cols:['Producto','Sucursal','Stock'], map: p => [p.nombre, p.sucursal||'Global', p.stock_actual] },
    cli_top: { titulo:'Top compradores', cols:['Cliente','Documento','Tipo','# Compras','Total gastado','Última compra'], map: c => [c.nombre, c.numero_doc, c.tipo_cliente, c.num_compras, c.total_gastado, c.ultima_compra] },
    cli_inactivos: { titulo:'Clientes inactivos', cols:['Cliente','Documento','Teléfono','Días sin comprar','Total histórico'], map: c => [c.nombre, c.numero_doc, c.telefono, c.dias_sin_comprar, c.total_historico] },
    fin_arqueos: { titulo:'Arqueos de caja', cols:['Caja','Cajero','Sucursal','Esperado','Contado','Diferencia','Estado'], map: a => [`CAJA-${String(a.numero_caja||a.id).padStart(5,'0')}`, a.cajero, a.sucursal, a.esperado, a.monto_final, a.diferencia, a.estado] },
    fin_cxc: { titulo:'Cuentas por cobrar', cols:['Cliente','Documento','Total','Pagado','Saldo','Días vencido'], map: c => [c.cliente, c.numero_doc, c.monto_total, c.monto_pagado, c.saldo, c.dias_vencido] },
    cot_vendedor: { titulo:'Cotizaciones por vendedor', cols:['Vendedor','Total','Convertidas','Monto'], map: v => [v.vendedor, v.total_cotizaciones, v.convertidas, v.monto_total] },
    log_rutas: { titulo:'Rutas de reparto', cols:['Código','Fecha','Sucursal','Repartidor','Camión','Paradas','Entregados','No entregados','Cobrado','Kilómetros','Estado'], map: x => [x.codigo,String(x.fecha||'').slice(0,10),x.sucursal,x.repartidor,x.placa,x.paradas,x.entregados,x.no_entregados,x.cobrado,x.kilometros,x.estado] },
    inv_movimientos: { titulo:'Kardex de inventario', cols:['Fecha','Producto','Sucursal','Tipo','Cantidad','Stock antes','Stock después','Referencia'], map:x=>[x.created_at,x.producto,x.sucursal,x.tipo,x.cantidad,x.stock_antes,x.stock_despues,x.referencia] },
    comp_detalle: { titulo:'Comprobantes emitidos', cols:['Comprobante','Tipo','Venta','Cliente','Sucursal','Emisión','Total','Estado SUNAT','Mensaje'], map:x=>[x.numero_full,x.tipo,x.venta_numero,x.cliente,x.sucursal,x.emitido_at,x.total,x.estado_sunat,x.cdr_mensaje||x.cdr_codigo] }
  };

  window.repExportCSV = function(key) {
    const cfg = exportConfig[key];
    if (!cfg) return Swal.fire({ icon:'error', title:'Error', text:'No se encontró la configuración del reporte', background:'#1a1a2e', color:'#e0e0e0' });
    const datos = datosActuales[key] || [];
    if (!datos.length) return Swal.fire({ icon:'info', title:'Sin datos', text:'No hay datos para exportar', background:'#1a1a2e', color:'#e0e0e0' });
    exportarExcel(cfg.titulo, cfg.cols, datos.map(cfg.map));
  };

  window.repExportPDF = function(key) {
    const cfg = exportConfig[key];
    if (!cfg) return Swal.fire({ icon:'error', title:'Error', text:'No se encontró la configuración del reporte', background:'#1a1a2e', color:'#e0e0e0' });
    const datos = datosActuales[key] || [];
    if (!datos.length) return Swal.fire({ icon:'info', title:'Sin datos', text:'No hay datos para exportar', background:'#1a1a2e', color:'#e0e0e0' });
    exportarPDF(cfg.titulo, cfg.cols, datos.map(cfg.map));
  };

  // ══════════ INICIAL ══════════
  cargarTab('ventas');
};