window.init_rentabilidad = async function () {
  const root = document.getElementById('contenido');
  const hoy = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const mes = hoy.slice(0,7) + '-01';
  const money = n => `S/ ${Number(n||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const esc = v => String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  root.innerHTML = `
    <div class="page-header"><div class="page-header-left"><h2><i class="ti ti-chart-pie-2"></i> Rentabilidad</h2><p>Comprueba si el negocio gana, pierde y qué productos sostienen el resultado.</p></div></div>
    <div class="card" style="padding:16px;margin-bottom:16px"><div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:10px;align-items:end">
      <div class="form-group"><label class="form-label">Desde</label><input class="form-control" type="date" id="ren-desde" value="${mes}" max="${hoy}"></div>
      <div class="form-group"><label class="form-label">Hasta</label><input class="form-control" type="date" id="ren-hasta" value="${hoy}" max="${hoy}"></div>
      <div class="form-group" id="ren-sucursal-wrap"><label class="form-label">Sucursal</label><select class="form-control" id="ren-sucursal"><option value="">Todas</option></select></div>
      <button class="btn btn-primary" id="ren-aplicar"><i class="ti ti-refresh"></i> Aplicar</button>
    </div></div>
    <div id="ren-body"><div class="loading-center"><div class="spinner spinner-lg"></div></div></div>`;

  const sucWrap=document.getElementById('ren-sucursal-wrap');
  if(!window._esGlobal) sucWrap.style.display='none';
  else {
    const d=await Http.get('/sucursales');
    if(d?.ok) document.getElementById('ren-sucursal').innerHTML='<option value="">Todas</option>'+d.sucursales.map(x=>`<option value="${x.id}">${esc(x.nombre)}</option>`).join('');
  }

  function bars(rows, key='margen') {
    if(!rows?.length) return '<div class="empty-state"><i class="ti ti-chart-bar-off"></i><p>Sin datos en el periodo</p></div>';
    const max=Math.max(...rows.map(x=>Number(x[key]||0)),1);
    return rows.slice(0,12).map(x=>`<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;gap:10px;font-size:12px"><b>${esc(x.nombre||x.canal||'—')}</b><span>${money(x[key])}</span></div><div style="height:10px;background:var(--input-bg);border-radius:999px;overflow:hidden;margin-top:5px"><div style="width:${Math.max(2,Number(x[key]||0)/max*100)}%;height:100%;background:linear-gradient(90deg,#16a34a,#0ea5e9);border-radius:999px"></div></div></div>`).join('');
  }

  function lineChart(rows) {
    if(!rows?.length) return '<div class="empty-state"><p>Sin movimiento diario</p></div>';
    const vals=rows.map(x=>Number(x.margen||0));
    const max=Math.max(...vals,0,1), min=Math.min(...vals,0);
    const W=820,H=270,pL=68,pR=20,pT=30,pB=48;
    const range=Math.max(1,max-min);
    const x=(i)=>pL+i*(W-pL-pR)/Math.max(1,rows.length-1);
    const y=(v)=>pT+(max-v)*(H-pT-pB)/range;
    const pts=rows.map((r,i)=>`${x(i)},${y(Number(r.margen||0))}`).join(' ');
    const step=Math.max(1,Math.ceil(rows.length/8));
    const grid=[0,.25,.5,.75,1].map(fr=>{const val=max-range*fr, yy=y(val);return `<line x1="${pL}" y1="${yy}" x2="${W-pR}" y2="${yy}" stroke="rgba(100,116,139,.25)"/><text x="${pL-8}" y="${yy+4}" text-anchor="end" font-size="11" fill="#64748b">${money(val).replace('S/ ','')}</text>`}).join('');
    const zeroY=y(0);
    return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:700px;height:290px">
      ${grid}<line x1="${pL}" y1="${zeroY}" x2="${W-pR}" y2="${zeroY}" stroke="#94a3b8" stroke-width="1.5"/>
      <polyline points="${pts}" fill="none" stroke="#16a34a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      ${rows.map((r,i)=>{const cx=x(i),cy=y(Number(r.margen||0)), show=i%step===0||i===rows.length-1;return `<circle cx="${cx}" cy="${cy}" r="5" fill="${Number(r.margen||0)>=0?'#0ea5e9':'#dc2626'}"><title>${esc(r.fecha)} · Ingreso ${money(r.ingresos)} · Costo ${money(r.costo)} · Margen ${money(r.margen)}</title></circle>${show?`<text x="${cx}" y="${Math.max(14,cy-10)}" text-anchor="middle" font-size="10" font-weight="700" fill="${Number(r.margen||0)>=0?'#166534':'#991b1b'}">${money(r.margen).replace('S/ ','')}</text><text x="${cx}" y="${H-17}" text-anchor="middle" font-size="10" fill="#64748b">${esc(String(r.fecha||'').slice(5))}</text>`:''}`}).join('')}
    </svg></div>`;
  }

  function dailyTable(rows){
    if(!rows?.length)return '';
    return `<div style="overflow:auto;max-height:320px;margin-top:12px"><table class="tabla"><thead><tr><th>Fecha</th><th style="text-align:right">Ingresos</th><th style="text-align:right">Costo</th><th style="text-align:right">Margen</th><th style="text-align:right">Margen %</th></tr></thead><tbody>${rows.map(x=>{const ingresos=Number(x.ingresos||0),costo=Number(x.costo||0),margen=Number(x.margen||0),pct=ingresos?margen/ingresos*100:0;return `<tr><td>${esc(String(x.fecha||'').slice(0,10))}</td><td style="text-align:right">${money(ingresos)}</td><td style="text-align:right">${money(costo)}</td><td style="text-align:right;font-weight:800;color:${margen>=0?'var(--success)':'var(--danger)'}">${money(margen)}</td><td style="text-align:right">${pct.toFixed(2)}%</td></tr>`}).join('')}</tbody></table></div>`;
  }

  function channelTable(rows){
    if(!rows?.length)return '<div class="empty-state"><p>Sin ventas por canal</p></div>';
    return `<div style="overflow:auto;margin-top:14px"><table class="tabla"><thead><tr><th>Canal</th><th style="text-align:right">Ventas</th><th style="text-align:right">Ingresos</th><th style="text-align:right">Costo</th><th style="text-align:right">Margen</th></tr></thead><tbody>${rows.map(x=>`<tr><td style="text-transform:capitalize"><b>${esc(x.canal||'—')}</b></td><td style="text-align:right">${Number(x.ventas||x.cantidad||0)}</td><td style="text-align:right">${money(x.ingresos||x.total)}</td><td style="text-align:right">${money(x.costo)}</td><td style="text-align:right;font-weight:800;color:${Number(x.margen||0)>=0?'var(--success)':'var(--danger)'}">${money(x.margen)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function cargar(){
    const desde=document.getElementById('ren-desde').value, hasta=document.getElementById('ren-hasta').value;
    if(desde>hoy||hasta>hoy) return Swal.fire({icon:'warning',title:'Fecha futura',text:'Solo puedes consultar hasta hoy.'});
    const qs=new URLSearchParams({desde,hasta}); const sid=document.getElementById('ren-sucursal')?.value;if(sid)qs.set('sucursal_id',sid);
    const body=document.getElementById('ren-body');body.innerHTML='<div class="loading-center"><div class="spinner spinner-lg"></div></div>';
    const d=await Http.get('/rentabilidad/resumen?'+qs.toString());
    if(!d?.ok){body.innerHTML=`<div class="empty-state"><i class="ti ti-alert-triangle"></i><p>${esc(d?.msg||'No se pudo cargar')}</p></div>`;return;}
    const k=d.kpis;
    body.innerHTML=`
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:16px">
        ${[['Ingresos',money(k.ingresos),'ti-cash','#0ea5e9'],['Costo utilizado',money(k.costo),'ti-package-export','#64748b'],['Margen bruto',money(k.margen_bruto),'ti-trending-up','#16a34a'],['Margen %',Number(k.margen_pct).toFixed(2)+'%','ti-percentage','#7c3aed'],['Egresos',money(k.egresos),'ti-cash-off','#f59e0b'],['Resultado estimado',money(k.resultado_estimado),k.resultado_estimado>=0?'ti-circle-check':'ti-alert-triangle',k.resultado_estimado>=0?'#16a34a':'#dc2626'],['Ticket promedio',money(k.ticket_promedio),'ti-receipt','#0891b2'],['Ventas / unidades',`${k.ventas} / ${k.unidades}`,'ti-shopping-cart','#475569']].map(x=>`<div class="card" style="padding:18px;border-top:4px solid ${x[3]}"><i class="ti ${x[2]}" style="float:right;font-size:25px;color:${x[3]}"></i><div style="font-size:11px;color:var(--texto-muted);text-transform:uppercase;font-weight:700">${x[0]}</div><div style="font-size:24px;font-weight:900;margin-top:7px;color:${x[0]==='Resultado estimado'?(k.resultado_estimado>=0?'var(--success)':'var(--danger)'):'var(--texto-fuerte)'}">${x[1]}</div></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:16px">
        ${[['Inversión actual en inventario',money(k.inversion_inventario),'Capital inmovilizado en stock'],['Valor potencial de venta',money(k.valor_venta_inventario),'Valor estimado si se vende el stock'],['Ganancia potencial del inventario',money(k.ganancia_potencial_inventario),'Diferencia entre venta y costo'],['ROI del periodo',Number(k.roi_periodo||0).toFixed(2)+'%','Resultado frente a costo y egresos'],['Punto de equilibrio',money(k.punto_equilibrio),'Ventas necesarias para cubrir egresos'],['Productos críticos',`${k.productos_criticos||0} de ${k.productos_activos||0}`,'Stock igual o menor al mínimo']].map(x=>`<div class="card" style="padding:16px"><div style="font-size:11px;color:var(--texto-muted);text-transform:uppercase;font-weight:800">${x[0]}</div><div style="font-size:22px;font-weight:900;color:var(--texto-fuerte);margin:7px 0">${x[1]}</div><small style="color:var(--texto-muted)">${x[2]}</small></div>`).join('')}
      </div>
      ${k.items_costo_inconsistente?`<div class="card" style="padding:14px;margin-bottom:16px;border-left:5px solid #f59e0b;background:#fffbeb"><b><i class="ti ti-alert-triangle"></i> ${k.items_costo_inconsistente} línea(s) con costo inconsistente</b><p style="font-size:12px;margin-top:5px;color:#92400e">${esc(d.nota_costos)}</p></div>`:''}
      <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(300px,1fr);gap:14px;margin-bottom:16px"><div class="card" style="padding:18px"><h3>Margen diario con valores</h3><p style="font-size:12px;color:var(--texto-muted);margin-top:-4px">Cada punto muestra la utilidad bruta del día. La tabla permite comprobar ingresos, costo y porcentaje.</p>${lineChart(d.diario)}${dailyTable(d.diario)}</div><div class="card" style="padding:18px"><h3>Margen por canal</h3>${bars(d.canales)}${channelTable(d.canales)}</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px"><div class="card" style="padding:18px"><h3>Productos que más margen generan</h3>${bars(d.productos)}</div><div class="card" style="padding:18px"><h3>Alertas de precio y costo</h3>${d.alertas?.length?`<div class="tabla-container"><table class="tabla"><thead><tr><th>Producto</th><th>Costo</th><th>Venta</th><th>Alerta</th></tr></thead><tbody>${d.alertas.map(x=>`<tr><td><b>${esc(x.nombre)}</b><small style="display:block">${esc(x.sucursal_nombre||'')}</small></td><td>${money(x.precio_costo)}</td><td>${money(x.precio_venta)}</td><td><span class="badge badge-warning">${esc(String(x.tipo).replaceAll('_',' '))}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><i class="ti ti-circle-check"></i><p>Sin alertas de costos</p></div>'}</div></div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(380px,1fr);gap:14px;margin-bottom:16px"><div class="card" style="padding:18px"><h3>Ingresos por medio de pago</h3>${bars((d.medios_pago||[]).map(x=>({...x,nombre:String(x.metodo||'').toUpperCase(),margen:x.monto})))}</div><div class="card" style="padding:18px"><h3 style="margin-bottom:4px">Lectura rápida del negocio</h3><p style="font-size:12px;color:var(--texto-muted);margin:0 0 14px">Resumen ejecutivo del periodo seleccionado.</p><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px"><article style="grid-column:1/-1;padding:16px;border-radius:14px;border:1px solid ${k.resultado_estimado>=0?'#86efac':'#fecaca'};background:${k.resultado_estimado>=0?'#f0fdf4':'#fef2f2'}"><span style="display:block;font-size:10px;text-transform:uppercase;font-weight:900;color:${k.resultado_estimado>=0?'#166534':'#991b1b'}">${k.resultado_estimado>=0?'Utilidad estimada':'Pérdida estimada'}</span><strong style="display:block;font-size:27px;margin-top:5px;color:${k.resultado_estimado>=0?'#15803d':'#dc2626'}">${money(Math.abs(k.resultado_estimado))}</strong></article><article style="padding:14px;border:1px solid #bae6fd;background:#f0f9ff;border-radius:13px"><span style="font-size:10px;color:#0369a1;text-transform:uppercase;font-weight:900">Margen bruto</span><strong style="display:block;font-size:22px;color:#0c4a6e;margin-top:5px">${Number(k.margen_pct||0).toFixed(2)}%</strong></article><article style="padding:14px;border:1px solid #ddd6fe;background:#f5f3ff;border-radius:13px"><span style="font-size:10px;color:#6d28d9;text-transform:uppercase;font-weight:900">ROI del periodo</span><strong style="display:block;font-size:22px;color:#5b21b6;margin-top:5px">${Number(k.roi_periodo||0).toFixed(2)}%</strong></article><article style="grid-column:1/-1;padding:14px;border:1px solid #fde68a;background:#fffbeb;border-radius:13px"><span style="font-size:10px;color:#92400e;text-transform:uppercase;font-weight:900">Capital en inventario</span><strong style="display:block;font-size:22px;color:#78350f;margin:5px 0">${money(k.inversion_inventario)}</strong><small style="color:#92400e">Controla productos sin rotación y stock crítico para liberar capital.</small></article></div></div></div>
      ${d.sucursales?.length?`<div class="card" style="padding:18px"><h3>Rentabilidad por sucursal</h3>${bars(d.sucursales)}</div>`:''}`;
  }
  document.getElementById('ren-aplicar').onclick=cargar;
  cargar();
};
