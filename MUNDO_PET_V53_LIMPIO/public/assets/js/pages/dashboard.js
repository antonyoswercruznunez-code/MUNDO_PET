window.init_dashboard = async function initDashboard() {
  const root = document.getElementById('contenido');
  const peruDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const today = peruDate();
  const monthStart = `${today.slice(0,7)}-01`;
  const money = value => `S/ ${Number(value||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const esc = value => String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const palette = ['#16a34a','#0ea5e9','#7c3aed','#f59e0b','#ec4899','#0f766e','#64748b'];

  if (!document.getElementById('dash-v52-style')) {
    const style = document.createElement('style');
    style.id = 'dash-v52-style';
    style.textContent = `
      .d52-filter{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:10px;align-items:end;padding:16px;margin-bottom:16px}
      .d52-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:13px;margin-bottom:16px}
      .d52-kpi{position:relative;overflow:hidden;padding:18px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;box-shadow:0 7px 24px rgba(15,23,42,.045)}
      .d52-kpi-action{width:100%;text-align:left;color:inherit;font:inherit;cursor:pointer}.d52-kpi-action:hover{transform:translateY(-2px);border-color:#16a34a}
      .d52-kpi:after{content:'';position:absolute;right:-25px;bottom:-32px;width:105px;height:105px;border-radius:50%;background:var(--soft,#dcfce7)}
      .d52-kpi-clickable{cursor:pointer}
      .d52-kpi i{position:relative;z-index:1;float:right;font-size:28px;color:var(--tone,#16a34a)}.d52-kpi small{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:900;color:var(--texto-muted)}
      .d52-kpi strong{position:relative;z-index:1;display:block;font-size:24px;margin-top:8px;color:var(--texto-fuerte)}.d52-kpi p{position:relative;z-index:1;margin:5px 0 0;font-size:11px;color:var(--texto-muted)}
      .d52-grid-main{display:grid;grid-template-columns:minmax(0,2fr) minmax(300px,1fr);gap:14px;margin-bottom:14px}.d52-grid-eq{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}
      .d52-card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;padding:18px;box-shadow:0 7px 24px rgba(15,23,42,.04);min-width:0}.d52-card h3{display:flex;align-items:center;gap:8px;margin:0 0 5px;font-size:15px}.d52-card h3 i{font-size:20px;color:#16a34a}.d52-sub{font-size:11px;color:var(--texto-muted);margin-bottom:12px}
      .d52-chart{position:relative;min-height:250px}.d52-chart svg{width:100%;height:280px;overflow:visible}.d52-point{cursor:pointer;transition:r .15s}.d52-point:hover{r:7}.d52-tooltip{position:fixed;z-index:9999;pointer-events:none;background:#0f172a;color:#fff;border-radius:10px;padding:9px 11px;font-size:11px;box-shadow:0 12px 30px rgba(15,23,42,.3);display:none;max-width:220px}
      .d52-bars{display:grid;gap:10px}.d52-bar-head{display:flex;justify-content:space-between;gap:12px;font-size:12px}.d52-track{height:10px;background:#e8eef3;border-radius:999px;overflow:hidden;margin-top:5px}.d52-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#16a34a,#0ea5e9)}
      .d52-donut-wrap{display:grid;grid-template-columns:155px 1fr;gap:18px;align-items:center}.d52-donut{width:150px;height:150px;border-radius:50%;position:relative}.d52-donut:after{content:'';position:absolute;inset:31px;border-radius:50%;background:var(--card-bg)}.d52-donut-total{position:absolute;inset:0;z-index:1;display:grid;place-items:center;text-align:center;font-size:12px;font-weight:900}.d52-legend{display:grid;gap:8px}.d52-legend-row{display:flex;justify-content:space-between;gap:10px;font-size:12px}.d52-dot{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:6px}
      .d52-hour-bars{height:250px;display:flex;align-items:flex-end;gap:5px;padding-top:15px}.d52-hour{flex:1;min-width:12px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:5px}.d52-hour span{width:100%;max-width:28px;border-radius:7px 7px 2px 2px;background:linear-gradient(180deg,#0ea5e9,#16a34a);min-height:3px;cursor:pointer}.d52-hour small{font-size:9px;color:#64748b;transform:rotate(-45deg);height:22px}
      .d52-table{width:100%;border-collapse:collapse;font-size:12px}.d52-table th{background:#f1f5f9;color:#475569;text-align:left;padding:10px;text-transform:uppercase;font-size:9px}.d52-table td{padding:10px;border-top:1px solid #edf2f7}.d52-alerts{display:grid;gap:9px}.d52-alert{display:flex;align-items:flex-start;gap:10px;padding:11px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;cursor:pointer}.d52-alert i{font-size:20px;color:#f59e0b}.d52-alert b{display:block;font-size:12px}.d52-alert small{color:#64748b}
      .d52-shortcuts{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px}.d52-shortcuts button{flex:1;min-width:145px;border:1px solid var(--card-border);background:var(--card-bg);border-radius:12px;padding:12px;font-weight:800;color:var(--texto-fuerte);transition:.2s}.d52-shortcuts button:hover{transform:translateY(-2px);border-color:#16a34a}.d52-shortcuts i{color:#16a34a;margin-right:6px}
      @media(max-width:980px){.d52-grid-main,.d52-grid-eq{grid-template-columns:1fr}.d52-filter{grid-template-columns:1fr 1fr}.d52-donut-wrap{grid-template-columns:1fr;justify-items:center}.d52-legend{width:100%}}@media(max-width:560px){.d52-filter{grid-template-columns:1fr}.d52-kpis{grid-template-columns:1fr 1fr}.d52-kpi strong{font-size:19px}}
    `;
    document.head.appendChild(style);
  }

  root.innerHTML = `
    <div class="page-header"><div class="page-header-left"><h2><i class="ti ti-layout-dashboard"></i> Dashboard ejecutivo</h2><p>Ventas, operaciones, inventario, canales y alertas con datos reales del sistema.</p></div></div>
    <div class="card d52-filter"><div class="form-group"><label class="form-label">Desde</label><input id="dash-desde" class="form-control" type="date" value="${monthStart}" max="${today}"></div><div class="form-group"><label class="form-label">Hasta</label><input id="dash-hasta" class="form-control" type="date" value="${today}" max="${today}"></div><div class="form-group" id="dash-sucursal-wrap"><label class="form-label">Sucursal</label><select id="dash-sucursal" class="form-control"><option value="">Todas</option></select></div><button id="dash-aplicar" class="btn btn-primary"><i class="ti ti-filter"></i> Aplicar</button></div>
    <div class="d52-shortcuts"><button onclick="Router.navegar('ventas')"><i class="ti ti-shopping-cart-plus"></i>Nueva venta</button><button onclick="Router.navegar('pagos')"><i class="ti ti-credit-card"></i>Pagos web</button><button onclick="Router.navegar('inventario')"><i class="ti ti-package"></i>Inventario</button><button onclick="Router.navegar('logistica')"><i class="ti ti-truck-delivery"></i>Distribución</button><button onclick="Router.navegar('rentabilidad')"><i class="ti ti-chart-pie-2"></i>Rentabilidad</button></div>
    <div id="dash-body"><div class="loading-center"><div class="spinner spinner-lg"></div></div></div><div id="d52-tooltip" class="d52-tooltip"></div>`;

  if (!window._esGlobal) document.getElementById('dash-sucursal-wrap').style.display='none';
  else {
    const branches = await Http.get('/sucursales');
    if (branches?.ok) document.getElementById('dash-sucursal').innerHTML='<option value="">Todas</option>'+branches.sucursales.map(branch=>`<option value="${branch.id}">${esc(branch.nombre)}</option>`).join('');
  }


  const kpi = (label,value,detail,icon,tone='#16a34a',soft='#dcfce7',destination) => destination
    ? `<button type="button" class="d52-kpi d52-kpi-action" style="--tone:${tone};--soft:${soft}" onclick="Router.navegar('${destination}')" aria-label="Ver ${esc(label)} en ${esc(destination)}"><i class="ti ${icon}"></i><small>${esc(label)}</small><strong>${value}</strong><p>${detail}</p></button>`
    : `<article class="d52-kpi" style="--tone:${tone};--soft:${soft}"><i class="ti ${icon}"></i><small>${esc(label)}</small><strong>${value}</strong><p>${detail}</p></article>`;

  

  function empty(text){return `<div class="empty-state"><i class="ti ti-chart-off"></i><p>${esc(text)}</p></div>`;}
  function bars(rows,labelKey,valueKey,formatter=money){
    if(!rows?.length)return empty('Sin datos en el periodo');
    const max=Math.max(1,...rows.map(row=>Number(row[valueKey]||0)));
    return `<div class="d52-bars">${rows.slice(0,10).map(row=>`<div><div class="d52-bar-head"><b>${esc(row[labelKey]||'—')}</b><span>${formatter(row[valueKey],row)}</span></div><div class="d52-track"><div class="d52-fill" style="width:${Math.max(2,Number(row[valueKey]||0)/max*100)}%"></div></div></div>`).join('')}</div>`;
  }
  function lineChart(rows){
    if(!rows?.length)return empty('Sin ventas en el periodo');
    const width=820,height=290,left=62,right=20,top=25,bottom=44;
    const values=rows.map(row=>Number(row.total||0)); const max=Math.max(1,...values); const min=0;
    const x=index=>left+index*(width-left-right)/Math.max(1,rows.length-1); const y=value=>top+(max-value)*(height-top-bottom)/Math.max(1,max-min);
    const points=rows.map((row,index)=>`${x(index)},${y(Number(row.total||0))}`).join(' ');
    const area=`${left},${height-bottom} ${points} ${width-right},${height-bottom}`;
    const grid=[0,.25,.5,.75,1].map(f=>{const value=max*(1-f),yy=y(value);return `<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" stroke="#e2e8f0"/><text x="${left-8}" y="${yy+4}" text-anchor="end" font-size="10" fill="#64748b">${money(value).replace('S/ ','')}</text>`}).join('');
    const step=Math.max(1,Math.ceil(rows.length/8));
    return `<div class="d52-chart"><svg viewBox="0 0 ${width} ${height}"><defs><linearGradient id="d52-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16a34a" stop-opacity=".34"/><stop offset="1" stop-color="#16a34a" stop-opacity="0"/></linearGradient></defs>${grid}<polygon points="${area}" fill="url(#d52-area)"/><polyline points="${points}" fill="none" stroke="#16a34a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${rows.map((row,index)=>`<circle class="d52-point" cx="${x(index)}" cy="${y(Number(row.total||0))}" r="4.5" fill="#0ea5e9" data-tip="${esc(`${row.fecha} · ${money(row.total)} · ${Number(row.n||0)} venta(s)`) }"></circle>${index%step===0||index===rows.length-1?`<text x="${x(index)}" y="${height-14}" text-anchor="middle" font-size="9" fill="#64748b">${esc(String(row.fecha||'').slice(5))}</text>`:''}`).join('')}</svg></div>`;
  }
  function donut(rows,labelKey,valueKey){
    const total=(rows||[]).reduce((sum,row)=>sum+Number(row[valueKey]||0),0);if(!total)return empty('Sin información');
    let acc=0;const segments=rows.map((row,index)=>{const start=acc/total*360;acc+=Number(row[valueKey]||0);return `${palette[index%palette.length]} ${start}deg ${acc/total*360}deg`;});
    return `<div class="d52-donut-wrap"><div class="d52-donut" style="background:conic-gradient(${segments.join(',')})"><div class="d52-donut-total">${money(total)}</div></div><div class="d52-legend">${rows.map((row,index)=>`<div class="d52-legend-row"><span><i class="d52-dot" style="background:${palette[index%palette.length]}"></i>${esc(row[labelKey]||'Otro')}</span><b>${money(row[valueKey])}</b></div>`).join('')}</div></div>`;
  }
  function hourly(rows){
    const map=new Map((rows||[]).map(row=>[Number(row.hora),row]));const data=Array.from({length:24},(_,hour)=>map.get(hour)||{hora:hour,n:0,total:0});const max=Math.max(1,...data.map(row=>Number(row.total||0)));
    return `<div class="d52-hour-bars">${data.map(row=>`<div class="d52-hour"><span style="height:${Math.max(3,Number(row.total||0)/max*190)}px" data-tip="${String(row.hora).padStart(2,'0')}:00 · ${money(row.total)} · ${Number(row.n||0)} venta(s)"></span><small>${String(row.hora).padStart(2,'0')}</small></div>`).join('')}</div>`;
  }
  function bindTips(){
    const tip=document.getElementById('d52-tooltip');
    document.querySelectorAll('[data-tip]').forEach(node=>{node.onmousemove=event=>{tip.innerHTML=esc(node.dataset.tip);tip.style.display='block';tip.style.left=`${event.clientX+14}px`;tip.style.top=`${event.clientY+14}px`;};node.onmouseleave=()=>tip.style.display='none';});
  }

  async function load(){
    const from=document.getElementById('dash-desde').value,to=document.getElementById('dash-hasta').value;
    if(!from||!to||from>to||to>today)return Swal.fire('Fechas inválidas','Selecciona un rango válido que no supere la fecha actual.','warning');
    const query=new URLSearchParams({desde:from,hasta:to});const branch=document.getElementById('dash-sucursal')?.value;if(branch)query.set('sucursal_id',branch);
    const body=document.getElementById('dash-body');body.innerHTML='<div class="loading-center"><div class="spinner spinner-lg"></div></div>';
    const data=await Http.get(`/dashboard/resumen?${query}`);if(!data?.ok){body.innerHTML=empty(data?.msg||'No se pudo cargar el dashboard');return;}
    const k=data.kpis||{},profit=data.rentabilidad,trend=Number(k.variacionVentas||0);
    const alerts=[];if(k.stockBajo)alerts.push(['Stock crítico',`${k.stockBajo} producto(s) requieren reposición`,'inventario']);if(k.pagosPendientes)alerts.push(['Pagos web',`${k.pagosPendientes} pago(s) requieren revisión`,'pagos']);if(k.comprobantesRevisar)alerts.push(['Comprobantes',`${k.comprobantesRevisar} comprobante(s) por revisar`,'comprobantes']);if(k.cajasAbiertas)alerts.push(['Cajas abiertas',`${k.cajasAbiertas} caja(s) permanecen abiertas`,'cajas']);if(k.incidenciasEntrega)alerts.push(['Incidencias',`${k.incidenciasEntrega} entrega(s) necesitan seguimiento`,'logistica']);
    body.innerHTML=`

      <div class="d52-kpis">${kpi('Ventas del periodo',money(k.ventasMesMonto),`${k.ventasMesCount||0} operaciones · ${trend>=0?'+':''}${trend.toFixed(1)}% vs. periodo anterior`,'ti-cash','#16a34a','#dcfce7')}${kpi('Ticket promedio',money(k.ticketPromedio),`${k.ventasMesCount||0} ventas registradas`,'ti-receipt','#0ea5e9','#e0f2fe')}${kpi('Ventas de hoy',money(k.ventasHoyMonto),`${k.ventasHoyCount||0} operaciones`,'ti-calendar-dollar','#7c3aed','#ede9fe')}${kpi('Clientes activos',Number(k.clientes||0).toLocaleString('es-PE'),'Base comercial disponible','ti-users','#0891b2','#cffafe')}${kpi('Productos activos',Number(k.productos||0).toLocaleString('es-PE'),'Productos habilitados en inventario','ti-package','#2563eb','#dbeafe','inventario')}${kpi('Stock crítico',Number(k.stockBajo||0).toLocaleString('es-PE'),'Productos que requieren reposición','ti-package-off','#dc2626','#fee2e2')}${kpi('Entregas activas',Number(k.entregasActivas||0).toLocaleString('es-PE'),`${k.incidenciasEntrega||0} incidencia(s)`,'ti-truck-delivery','#f59e0b','#fef3c7','logistica')}${profit?kpi('Margen bruto',money(profit.margen_bruto),`${Number(profit.margen_pct||0).toFixed(1)}% del ingreso`,'ti-chart-line','#16a34a','#dcfce7'):''}</div>

      
                                                                                                                         
      <div class="d52-grid-main"><section class="d52-card"><h3><i class="ti ti-chart-area-line"></i>Evolución de ventas</h3><div class="d52-sub">Monto diario. Pasa el mouse por cada punto para ver fecha, importe y número de ventas.</div>${lineChart(data.serie14)}</section><section class="d52-card"><h3><i class="ti ti-bell-ringing"></i>Alertas operativas</h3><div class="d52-sub">Pendientes que requieren una acción.</div><div class="d52-alerts">${alerts.length?alerts.map(item=>`<div class="d52-alert" onclick="Router.navegar('${item[2]}')"><i class="ti ti-alert-triangle"></i><div><b>${esc(item[0])}</b><small>${esc(item[1])}</small></div></div>`).join(''):empty('No existen alertas críticas')}</div></section></div>
      <div class="d52-grid-eq"><section class="d52-card"><h3><i class="ti ti-clock-hour-4"></i>Ventas por hora</h3><div class="d52-sub">Horas con mayor actividad comercial.</div>${hourly(data.horas)}</section><section class="d52-card"><h3><i class="ti ti-credit-card"></i>Ingresos por método de pago</h3><div class="d52-sub">Distribución real del monto cobrado.</div>${donut(data.metodos,'m','s')}</section></div>
      <div class="d52-grid-eq"><section class="d52-card"><h3><i class="ti ti-device-desktop-analytics"></i>Canal de venta</h3><div class="d52-sub">Comparación entre atención presencial y ecommerce.</div>${donut(data.canales,'canal','total')}</section><section class="d52-card"><h3><i class="ti ti-trophy"></i>Productos con mayor movimiento</h3><div class="d52-sub">Unidades vendidas en el periodo.</div>${bars(data.topProductos,'nombre','cant',(value)=>`${Number(value||0)} uds.`)}</section></div>
      ${data.porSucursal?.length?`<section class="d52-card" style="margin-bottom:14px"><h3><i class="ti ti-building-store"></i>Rendimiento por sucursal</h3><div class="d52-sub">Ventas acumuladas por sede.</div>${bars(data.porSucursal,'nombre','total')}</section>`:''}
      <div class="d52-grid-eq"><section class="d52-card"><h3><i class="ti ti-package"></i>Productos por reponer</h3><div class="d52-sub">Stock actual frente al mínimo.</div>${data.stockBajoLista?.length?`<table class="d52-table"><thead><tr><th>Producto</th><th>Sucursal</th><th>Actual</th><th>Mínimo</th></tr></thead><tbody>${data.stockBajoLista.map(row=>`<tr><td><b>${esc(row.nombre)}</b></td><td>${esc(row.sucursal_nombre||'—')}</td><td style="color:#dc2626;font-weight:900">${Number(row.stock_actual||0)}</td><td>${Number(row.stock_minimo||0)}</td></tr>`).join('')}</tbody></table>`:empty('No hay productos críticos')}</section><section class="d52-card"><h3><i class="ti ti-history"></i>Últimas ventas</h3><div class="d52-sub">Movimientos más recientes del sistema.</div>${data.ultimasVentas?.length?`<table class="d52-table"><thead><tr><th>Documento</th><th>Cliente</th><th>Sucursal</th><th>Total</th></tr></thead><tbody>${data.ultimasVentas.map(row=>`<tr><td><b>${esc(row.numero)}</b></td><td>${esc(row.cliente_nombre)}</td><td>${esc(row.sucursal_nombre||'—')}</td><td><b>${money(row.total)}</b></td></tr>`).join('')}</tbody></table>`:empty('Sin ventas recientes')}</section></div>`;
    bindTips();
  }

  document.getElementById('dash-aplicar').onclick=load;
  await load();
};
