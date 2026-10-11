window.init_logistica = async function initLogistica() {
  const root = document.getElementById('contenido');
  root.innerHTML = await fetch('/views/pages/logistica.html').then(r => r.text());

  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money = n => `S/ ${Number(n || 0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const peruDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const canManage = window._esGlobal || window._permisos?.has('logistica.gestionar');
  const canOperate = window._esGlobal || window._permisos?.has('logistica.operar');
  const assignmentLabel = 'Asignar pedidos';
  let sucursales = [], repartidores = [], vehiculos = [], rutas = [], deliveries = [];

  const label = e => ({pendiente:'Pendiente',preparando:'Preparando',listo:'Listo para ruta',asignado:'Asignado',planificada:'Planificada',cargada:'Cargada',en_ruta:'En ruta',completada:'Completada',cancelada:'Cancelada',entregado:'Entregado',no_entregado:'No entregado',disponible:'Disponible',mantenimiento:'Mantenimiento',inactivo:'Inactivo'}[e] || String(e||'').replaceAll('_',' '));
  const stage = e => `<span class="lg-stage ${esc(e)}">${esc(label(e))}</span>`;
  const empty = (text, icon='ti-package-off') => `<div class="lg-empty"><i class="ti ${icon}"></i><p>${esc(text)}</p></div>`;

  function modal({title, body, footer='', small=false}) {
    const holder = document.getElementById('lg-modal-root');
    holder.innerHTML = `<div class="lg-modal-backdrop" id="lg-modal-backdrop"><div class="lg-modal ${small?'small':''}"><header class="lg-modal-head"><h3>${title}</h3><button class="lg-modal-close" id="lg-modal-close">×</button></header><div class="lg-modal-body">${body}</div>${footer?`<footer class="lg-modal-foot">${footer}</footer>`:''}</div></div>`;
    document.getElementById('lg-modal-close').onclick = closeModal;
    document.getElementById('lg-modal-backdrop').onclick = e => { if (e.target.id === 'lg-modal-backdrop') closeModal(); };
  }
  function closeModal(){ document.getElementById('lg-modal-root').innerHTML=''; }
  window._lgClose = closeModal;

  function switchTab(name) {
    document.querySelectorAll('[data-lg-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.lgTab === name));
    document.querySelectorAll('.lg-panel').forEach(panel => panel.hidden = panel.id !== `lg-tab-${name}`);
    if (name === 'mapa') openLiveMap();
  }

  // El mapa en vivo se crea la primera vez que se abre su pestaña.
  let liveMap = null;
  async function openLiveMap() {
    if (liveMap) return liveMap.refresh?.();
    liveMap = {};
    liveMap = await MPLiveMap.mount(document.getElementById('lg-live'));
  }
  if (canManage) document.getElementById('lg-tab-btn-mapa').hidden = false;

  async function loadBase() {
    const [sr, rr, vr] = await Promise.all([Http.get('/sucursales'),Http.get('/logistica/repartidores'),Http.get('/logistica/vehiculos')]);
    sucursales = sr?.sucursales || sr?.data || [];
    repartidores = rr?.data || [];
    vehiculos = vr?.data || [];
    const branch = document.getElementById('lg-pedidos-sucursal');
    branch.innerHTML = `<option value="">Todas</option>${sucursales.map(s=>`<option value="${s.id}">${esc(s.nombre)}</option>`).join('')}`;
    renderRepartidores(); renderVehiculos();
  }

  async function loadDeliveries() {
    const sid = document.getElementById('lg-pedidos-sucursal').value;
    const response = await Http.get(`/logistica/candidatos${sid?`?sucursal_id=${sid}`:''}`);
    if (!response?.ok) {
      deliveries = [];
      renderDeliveries();
      return Swal.fire('No se cargaron los pedidos', response?.msg || 'Revisa la conexión y vuelve a actualizar.', 'error');
    }
    deliveries = response.data || [];
    renderDeliveries();
  }

  function filteredDeliveries() {
    const state = document.getElementById('lg-pedidos-estado').value;
    const term = document.getElementById('lg-pedidos-buscar').value.trim().toLocaleLowerCase('es-PE');
    return deliveries.filter(x => (!state || x.estado_preparacion === state) && (!term || [x.numero,x.cliente,x.direccion,x.telefono,x.sucursal_nombre].some(v=>String(v||'').toLocaleLowerCase('es-PE').includes(term))));
  }

  function renderDeliveries() {
    const counts = {pendiente:0,preparando:0,listo:0};
    deliveries.forEach(x => { if (counts[x.estado_preparacion] !== undefined) counts[x.estado_preparacion]++; });
    document.getElementById('lg-ready-count').textContent = counts.listo;
    document.getElementById('lg-pedido-kpis').innerHTML = [
      ['Pendientes de preparación',counts.pendiente,'pendiente'],['En preparación',counts.preparando,'preparando'],['Listos para asignar',counts.listo,'listo']
    ].map(x=>`<article><span>${x[0]}</span><b>${x[1]}</b>${stage(x[2])}</article>`).join('');
    const list = filteredDeliveries();
    document.getElementById('lg-pedidos-body').innerHTML = list.length ? list.map(x => {
      const action = x.estado_preparacion === 'listo'
        ? `<button class="btn btn-primary btn-sm" onclick="_lgCrearRutaConPedido(${Number(x.entrega_sucursal_id||0)},${Number(x.sucursal_id)})"><i class="ti ti-route"></i> Asignar a ruta</button>`
        : `<button class="btn btn-outline btn-sm" onclick="Router.navegar('recojo')"><i class="ti ti-package"></i> Ir a preparación</button>`;
      return `<tr><td><b>${esc(x.numero)}</b><br><small>${new Date(x.created_at).toLocaleString('es-PE',{timeZone:'America/Lima'})}</small></td><td class="lg-customer"><b>${esc(x.cliente)}</b><small>${esc(x.telefono||'Sin teléfono')}</small></td><td>${esc(x.sucursal_nombre||'')}</td><td>${esc(x.direccion||'Sin dirección')}</td><td>${Number(x.peso_estimado_kg||0)}</td><td>${stage(x.estado_preparacion)}</td><td class="lg-next">${canManage?action:'<span class="text-muted">Solo consulta</span>'}</td></tr>`;
    }).join('') : `<tr><td colspan="7">${empty('No hay pedidos delivery en esta etapa.')}</td></tr>`;
  }

  async function loadResumen() {
    const d = document.getElementById('lg-desde').value, h = document.getElementById('lg-hasta').value;
    const r = await Http.get(`/logistica/resumen?desde=${d}&hasta=${h}`); if(!r?.ok) return;
    const k = r.kpi || {};
    document.getElementById('lg-kpis').innerHTML = [['Rutas',k.rutas,'ti-route'],['En ruta',k.en_ruta,'ti-truck-delivery'],['Completadas',k.completadas,'ti-circle-check'],['Por asignar',k.pendientes,'ti-package'],['Km recorridos',Number(k.km_recorridos||0).toFixed(1),'ti-road']].map(x=>`<div class="stat-card"><div class="stat-icon"><i class="ti ${x[2]}"></i></div><div><div class="stat-value">${x[1]||0}</div><div class="stat-label">${x[0]}</div></div></div>`).join('');
    const max = Math.max(1,...(r.porEstado||[]).map(x=>Number(x.cantidad||0)));
    document.getElementById('lg-estados').innerHTML = (r.porEstado||[]).length ? (r.porEstado||[]).map(x=>`<div style="display:grid;grid-template-columns:115px 1fr 32px;gap:8px;align-items:center;margin:12px 0">${stage(x.estado)}<div class="lg-progress"><span style="width:${Number(x.cantidad||0)/max*100}%"></span></div><b>${x.cantidad}</b></div>`).join('') : empty('Sin rutas en el periodo','ti-route-off');
    document.getElementById('lg-rendimiento').innerHTML = (r.rendimiento||[]).length ? `<div class="table-responsive"><table class="table lg-table"><thead><tr><th>Repartidor</th><th>Rutas</th><th>Entregados</th><th>No entregados</th><th>Efectividad</th></tr></thead><tbody>${r.rendimiento.map(x=>`<tr><td><b>${esc(x.repartidor)}</b></td><td>${Number(x.rutas||0)}</td><td>${Number(x.entregados||0)}</td><td>${Number(x.no_entregados||0)}</td><td><b>${Number(x.efectividad||0).toFixed(1)}%</b></td></tr>`).join('')}</tbody></table></div>` : empty('Sin actividad de reparto','ti-chart-off');
  }

  async function loadRutas() {
    const q = new URLSearchParams({desde:document.getElementById('lg-desde').value,hasta:document.getElementById('lg-hasta').value});
    const state = document.getElementById('lg-estado').value; if(state) q.set('estado',state);
    const r = await Http.get(`/logistica/rutas?${q}`); rutas = r?.data || []; renderRutas();
  }

  function renderRutas() {
    document.getElementById('lg-rutas-body').innerHTML = rutas.length ? rutas.map(x=>{
      const total=Number(x.paradas||0), done=Number(x.entregados||0); const pct=total?Math.round(done/total*100):0;
      return `<tr><td><b>${esc(x.codigo)}</b><br><small>${esc(x.sucursal_nombre||'')}</small></td><td>${esc(String(x.fecha||'').slice(0,10))}</td><td>${esc(x.repartidor||'—')}</td><td>${esc(x.placa||'—')}</td><td>${total}<br><small>${Number(x.peso_estimado_kg||0)} unidades</small></td><td><b>${done}/${total}</b><div class="lg-progress"><span style="width:${pct}%"></span></div></td><td>${stage(x.estado)}</td><td><button class="btn btn-info btn-sm" onclick="_lgVerRuta(${x.id})"><i class="ti ti-eye"></i> Abrir</button></td></tr>`;
    }).join('') : `<tr><td colspan="8">${empty('No hay rutas en el periodo.','ti-route-off')}</td></tr>`;
  }

  function renderRepartidores() {
    document.getElementById('lg-repartidores-body').innerHTML = repartidores.length ? repartidores.map(x=>`<tr><td class="lg-customer"><b>${esc(x.nombres)}</b><small>${esc(x.usuario_nombre||'Sin usuario vinculado')}</small></td><td>${esc(x.documento||'—')}</td><td>${esc(x.telefono||'—')}</td><td>${esc([x.licencia,x.categoria_licencia].filter(Boolean).join(' · ')||'—')}</td><td>${esc(String(x.licencia_vencimiento||'').slice(0,10)||'—')}</td><td>${esc(x.sucursal_nombre||'Todas')}</td><td>${stage(Number(x.estado)===1?'disponible':'inactivo')}</td><td>${canManage?`<button class="btn btn-outline btn-xs" onclick="_lgRepartidor(${x.id})"><i class="ti ti-edit"></i></button>`:''}</td></tr>`).join('') : `<tr><td colspan="8">${empty('No hay repartidores registrados.','ti-users-off')}</td></tr>`;
  }

  function renderVehiculos() {
    document.getElementById('lg-vehiculos-body').innerHTML = vehiculos.length ? vehiculos.map(x=>`<tr><td><b>${esc(x.placa)}</b></td><td>${esc([x.marca,x.modelo,x.anio].filter(Boolean).join(' ')||x.tipo)}</td><td>${Number(x.capacidad_kg||0).toLocaleString('es-PE')} kg<br><small>${Number(x.capacidad_m3||0)} m³</small></td><td>${esc(String(x.soat_vencimiento||'').slice(0,10)||'—')} ${Number(x.soat_vencido)?'<span class="badge badge-danger">Vencido</span>':''}</td><td>${esc(String(x.revision_vencimiento||'').slice(0,10)||'—')} ${Number(x.revision_vencida)?'<span class="badge badge-danger">Vencida</span>':''}</td><td>${esc(x.sucursal_nombre||'Todas')}</td><td>${stage(x.estado_operativo)}</td><td>${canManage?`<button class="btn btn-outline btn-xs" onclick="_lgVehiculo(${x.id})"><i class="ti ti-edit"></i></button>`:''}</td></tr>`).join('') : `<tr><td colspan="8">${empty('No hay camiones registrados.','ti-truck-off')}</td></tr>`;
  }

  function availableForBranch(rows,sid){ return rows.filter(x=>Number(x.estado)===1 && (!Number(x.sucursal_id)||Number(x.sucursal_id)===Number(sid))); }

  async function createRoute(preselectedDeliveryId=null, preselectedBranchId=null) {
    const branchOptions=sucursales.map(s=>`<option value="${s.id}" ${Number(s.id)===Number(preselectedBranchId)?'selected':''}>${esc(s.nombre)}</option>`).join('');
    modal({title:'Crear ruta de reparto',body:`<div class="lg-form-grid"><div class="lg-field"><label>Fecha</label><input id="lgn-fecha" type="date" min="${peruDate()}" value="${peruDate()}" class="form-control"></div><div class="lg-field"><label>Sucursal</label><select id="lgn-sucursal" class="form-control"><option value="">Selecciona</option>${branchOptions}</select></div><div class="lg-field"><label>Repartidor</label><select id="lgn-repartidor" class="form-control"><option value="">Selecciona la sucursal</option></select></div><div class="lg-field"><label>Camión</label><select id="lgn-vehiculo" class="form-control"><option value="">Selecciona la sucursal</option></select></div><div class="lg-field"><label>Hora de salida</label><input id="lgn-hora" type="time" value="08:00" class="form-control"></div><div class="lg-field full"><label>Pedidos listos para incluir</label><div id="lgn-pedidos">${empty('Selecciona una sucursal para ver pedidos listos.')}</div></div></div>`,footer:`<button class="btn btn-outline" onclick="_lgClose()">Cancelar</button><button id="lgn-guardar" class="btn btn-primary"><i class="ti ti-route"></i> Crear y asignar</button>`});
    const branch=document.getElementById('lgn-sucursal');
    async function refresh(){
      const sid=Number(branch.value); const drivers=availableForBranch(repartidores,sid), trucks=vehiculos.filter(x=>Number(x.estado)===1&&x.estado_operativo==='disponible'&&(!Number(x.sucursal_id)||Number(x.sucursal_id)===sid));
      document.getElementById('lgn-repartidor').innerHTML=`<option value="">Selecciona</option>${drivers.map(x=>`<option value="${x.id}">${esc(x.nombres)} · ${esc(x.licencia||'sin licencia')}</option>`).join('')}`;
      document.getElementById('lgn-vehiculo').innerHTML=`<option value="">Selecciona</option>${trucks.map(x=>`<option value="${x.id}">${esc(x.placa)} · ${esc([x.marca,x.modelo].filter(Boolean).join(' '))}</option>`).join('')}`;
      if(!sid){document.getElementById('lgn-pedidos').innerHTML=empty('Selecciona una sucursal para ver pedidos listos.');return;}
      const r=await Http.get(`/logistica/candidatos?sucursal_id=${sid}&solo_listos=1`); const list=r?.data||[];
      document.getElementById('lgn-pedidos').innerHTML=list.length?list.map((x,i)=>`<label class="lg-select-card"><input type="checkbox" class="lgn-item" data-json="${encodeURIComponent(JSON.stringify(x))}" ${Number(x.entrega_sucursal_id)===Number(preselectedDeliveryId)?'checked':''}><b>${esc(x.numero)}</b><span class="lg-customer"><b>${esc(x.cliente)}</b><small>${esc(x.direccion||'Sin dirección')}</small></span><span>${Number(x.peso_estimado_kg||0)} unidades</span></label>`).join(''):empty('Esta sucursal todavía no tiene pedidos listos para ruta.');
    }
    branch.onchange=refresh; await refresh();
    document.getElementById('lgn-guardar').onclick=async()=>{
      const payload={fecha:document.getElementById('lgn-fecha').value,sucursal_id:Number(branch.value),repartidor_id:Number(document.getElementById('lgn-repartidor').value),vehiculo_id:Number(document.getElementById('lgn-vehiculo').value),hora_salida_programada:document.getElementById('lgn-hora').value};
      if(!payload.sucursal_id||!payload.repartidor_id||!payload.vehiculo_id)return Swal.fire('Faltan datos','Selecciona sucursal, repartidor y camión.','warning');
      const selected=[...document.querySelectorAll('.lgn-item:checked')].map(el=>JSON.parse(decodeURIComponent(el.dataset.json)));
      const r=await Http.post('/logistica/rutas',payload); if(!r?.ok)return Swal.fire('No se creó la ruta',r?.msg||'Error','error');
      if(selected.length){const a=await Http.post(`/logistica/rutas/${r.id}/pedidos`,{items:selected});if(!a?.ok)return Swal.fire('Ruta creada, pero sin pedidos',a?.msg||'No se pudo asignar','warning');}
      closeModal();await Promise.all([loadRutas(),loadResumen(),loadDeliveries()]);switchTab('rutas');window._lgVerRuta(r.id);
    };
  }
  window._lgCrearRutaConPedido=(deliveryId,branchId)=>createRoute(deliveryId,branchId);

  window._lgVerRuta=async id=>{
    const r=await Http.get(`/logistica/rutas/${id}`); if(!r?.ok)return Swal.fire('Error',r?.msg||'No se pudo cargar','error'); const x=r.data;
    const total=(x.pedidos||[]).length, done=(x.pedidos||[]).filter(p=>p.estado==='entregado').length;
    const actions=[];
    if(canManage&&['planificada','cargada'].includes(x.estado))actions.push(`<button class="btn btn-outline" onclick="_lgAsignar(${id})"><i class="ti ti-package-import"></i> Agregar pedidos listos</button>`);
    if(canOperate&&x.estado==='planificada')actions.push(`<button class="btn btn-info" onclick="_lgRutaEstado(${id},'cargada')"><i class="ti ti-package"></i> Confirmar carga</button>`);
    if(canOperate&&x.estado==='cargada')actions.push(`<button class="btn btn-primary" onclick="_lgRutaEstado(${id},'en_ruta')"><i class="ti ti-route"></i> Iniciar ruta</button>`);
    if(canOperate&&x.estado==='en_ruta')actions.push(`<button class="btn btn-success" onclick="_lgRutaEstado(${id},'completada')"><i class="ti ti-flag-check"></i> Cerrar ruta</button>`);
    const rows=(x.pedidos||[]).map(d=>`<tr><td>${d.orden}</td><td class="lg-customer"><b>${esc(d.numero_orden||d.venta_numero||'')}</b><small>${esc(d.cliente_nombre)}</small></td><td>${esc(d.direccion||'—')}<br><small>${esc(d.telefono||'')}</small></td><td>${Number(d.peso_estimado_kg||0)}<br><small>${money(d.monto_cobrar)}</small></td><td>${stage(d.estado)}</td><td><div class="lg-actions">${(d.evidencias||[]).map(e=>`<a class="btn btn-outline btn-xs" href="/api/logistica/evidencias/${e.id}" target="_blank"><i class="ti ti-photo"></i></a>`).join('')}${canOperate&&!['entregado','no_entregado'].includes(d.estado)?`<button class="btn btn-success btn-xs" onclick="_lgEntrega(${id},${d.id},'entregado')"><i class="ti ti-check"></i></button><button class="btn btn-danger btn-xs" onclick="_lgEntrega(${id},${d.id},'no_entregado')"><i class="ti ti-alert-triangle"></i></button>`:''}</div></td></tr>`).join('');
    modal({title:`Ruta ${esc(x.codigo)}`,body:`<div class="lg-route-summary"><article><small>Fecha</small><b>${esc(String(x.fecha||'').slice(0,10))}</b></article><article><small>Sucursal</small><b>${esc(x.sucursal_nombre||'—')}</b></article><article><small>Repartidor</small><b>${esc(x.repartidor||'—')}</b></article><article><small>Camión</small><b>${esc(x.placa||'—')}</b></article><article><small>Estado</small><b>${stage(x.estado)}</b></article><article><small>Progreso</small><b>${done}/${total}</b></article></div><div class="lg-actions" style="margin-bottom:14px">${actions.join('')}</div><div class="table-responsive"><table class="table lg-table"><thead><tr><th>#</th><th>Pedido y cliente</th><th>Dirección</th><th>Carga / cobrar</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows||`<tr><td colspan="6">${empty('Ruta sin pedidos. Agrega pedidos listos antes de confirmar la carga.')}</td></tr>`}</tbody></table></div>`});
  };

  window._lgAsignar=async id=>{
    const route=await Http.get(`/logistica/rutas/${id}`); if(!route?.ok)return Swal.fire('Error',route?.msg||'No se pudo leer la ruta','error');
    const r=await Http.get(`/logistica/candidatos?sucursal_id=${route.data.sucursal_id}&solo_listos=1`), list=r?.data||[];
    if(!list.length)return Swal.fire('Sin pedidos listos','La sucursal debe marcar primero los pedidos como “Listo para despacho”.','info');
    modal({title:'Agregar pedidos a la ruta',body:`<p style="color:#64748b;margin-top:0">${esc(route.data.codigo)} · ${esc(route.data.sucursal_nombre)}</p>${list.map(x=>`<label class="lg-select-card"><input type="checkbox" class="lga-item" data-json="${encodeURIComponent(JSON.stringify(x))}"><b>${esc(x.numero)}</b><span class="lg-customer"><b>${esc(x.cliente)}</b><small>${esc(x.direccion||'Sin dirección')}</small></span><span>${Number(x.peso_estimado_kg||0)} unidades</span></label>`).join('')}`,footer:`<button class="btn btn-outline" onclick="_lgClose()">Cancelar</button><button id="lga-save" class="btn btn-primary">Asignar seleccionados</button>`});
    document.getElementById('lga-save').onclick=async()=>{const items=[...document.querySelectorAll('.lga-item:checked')].map(e=>JSON.parse(decodeURIComponent(e.dataset.json)));if(!items.length)return Swal.fire('Selecciona pedidos','','warning');const a=await Http.post(`/logistica/rutas/${id}/pedidos`,{items});if(!a?.ok)return Swal.fire('Error',a?.msg||'No se pudo asignar','error');closeModal();await Promise.all([loadRutas(),loadResumen(),loadDeliveries()]);window._lgVerRuta(id);};
  };

  window._lgRutaEstado=async(id,estado)=>{let payload={estado};if(estado==='en_ruta'){const c=await Swal.fire({title:'Kilometraje inicial',input:'number',inputValue:0,showCancelButton:true});if(!c.isConfirmed)return;payload.km_inicial=Number(c.value)||0;}if(estado==='completada'){const c=await Swal.fire({title:'Kilometraje final',input:'number',showCancelButton:true});if(!c.isConfirmed)return;payload.km_final=Number(c.value)||0;}const r=await Http.patch(`/logistica/rutas/${id}/estado`,payload);if(!r?.ok)return Swal.fire('Error',r?.msg||'No se pudo actualizar','error');closeModal();await Promise.all([loadRutas(),loadResumen(),loadDeliveries()]);window._lgVerRuta(id);};

  window._lgEntrega=async(id,detailId,status)=>{
    const delivered=status==='entregado';
    modal({title:delivered?'Confirmar entrega':'Registrar incidencia de entrega',small:true,body:`<div class="lg-form-grid">
      ${delivered?`<div class="lg-field"><label>Persona que recibe *</label><input id="lge-r" class="form-control" maxlength="160" placeholder="Nombres y apellidos"></div><div class="lg-field"><label>DNI (opcional)</label><input id="lge-d" class="form-control" inputmode="numeric" maxlength="8" placeholder="8 dígitos"></div>`:''}
      <div class="lg-field full"><label>${delivered?'Fotografía de entrega *':'Fotografía de la incidencia (opcional)'}</label><div class="lg-evidence-box"><label class="lg-evidence-trigger" for="lge-f"><i class="ti ti-camera"></i> Tomar foto o elegir imagen</label><input id="lge-f" type="file" accept="image/*" capture="environment"><div id="lge-preview" class="lg-evidence-preview"><img alt="Vista previa de evidencia"><div id="lge-file-name" class="lg-help"></div></div><div class="lg-help">Desde el celular se abrirá la cámara. Formatos permitidos: JPG, PNG y WEBP, máximo 10 MB.</div></div></div>
      <div class="lg-field full"><label>${delivered?'Observación':'Motivo de la no entrega *'}</label><textarea id="lge-o" class="form-control" rows="4" maxlength="500" placeholder="${delivered?'Observación opcional':'Explica claramente lo ocurrido'}"></textarea></div>
    </div>`,footer:`<button class="btn btn-outline" onclick="_lgClose()">Cancelar</button><button id="lge-save" class="btn ${delivered?'btn-success':'btn-danger'}"><i class="ti ${delivered?'ti-check':'ti-alert-triangle'}"></i> ${delivered?'Confirmar entrega':'Registrar incidencia'}</button>`});
    const input=document.getElementById('lge-f');
    input.onchange=()=>{const file=input.files?.[0],box=document.getElementById('lge-preview');if(!file){box.style.display='none';return;}if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){input.value='';box.style.display='none';return Swal.fire('Imagen no válida','Usa JPG, PNG o WEBP de máximo 10 MB.','warning');}const url=URL.createObjectURL(file);box.querySelector('img').src=url;document.getElementById('lge-file-name').textContent=`${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`;box.style.display='block';};
    document.getElementById('lge-save').onclick=async()=>{const receiver=delivered?document.getElementById('lge-r').value.trim():'',documento=delivered?document.getElementById('lge-d').value.replace(/\D/g,''):'',observacion=document.getElementById('lge-o').value.trim(),file=input.files?.[0];if(delivered&&!receiver)return Swal.fire('Falta el receptor','Registra quién recibió el pedido.','warning');if(delivered&&!file)return Swal.fire('Falta la evidencia','Toma o selecciona una fotografía de la entrega.','warning');if(!delivered&&observacion.length<5)return Swal.fire('Falta el motivo','Describe la incidencia con al menos 5 caracteres.','warning');const save=document.getElementById('lge-save');save.disabled=true;try{if(file){const fd=new FormData();fd.append('imagen',file);fd.append('tipo',delivered?'entrega':'incidencia');const up=await Http.postForm(`/logistica/rutas/${id}/pedidos/${detailId}/evidencias`,fd);if(!up?.ok)return Swal.fire('Error',up?.msg||'No se guardó la evidencia','error');}const r=await Http.patch(`/logistica/rutas/${id}/pedidos/${detailId}/estado`,{estado:status,observacion,receptor_nombre:receiver,receptor_documento:documento});if(!r?.ok)return Swal.fire('Error',r?.msg||'No se pudo registrar','error');closeModal();await Promise.all([loadRutas(),loadResumen(),loadDeliveries()]);window._lgVerRuta(id);}finally{save.disabled=false;}};
  };

  window._lgRepartidor=async id=>{
    const x=repartidores.find(y=>Number(y.id)===Number(id))||{}; const opts=sucursales.map(s=>`<option value="${s.id}" ${Number(x.sucursal_id)===Number(s.id)?'selected':''}>${esc(s.nombre)}</option>`).join('');
    modal({title:id?'Editar repartidor':'Nuevo repartidor',small:true,body:`<div class="lg-form-grid"><div class="lg-field full"><label>DNI</label><div style="display:flex;gap:8px"><input id="lgr-doc" class="form-control" maxlength="8" value="${esc(x.documento||'')}"><button id="lgr-api" class="btn btn-outline">Consultar API</button></div></div><div class="lg-field full"><label>Nombres y apellidos</label><input id="lgr-name" class="form-control" value="${esc(x.nombres||'')}"></div><div class="lg-field"><label>Teléfono</label><input id="lgr-phone" class="form-control" value="${esc(x.telefono||'')}"></div><div class="lg-field"><label>Licencia</label><input id="lgr-license" class="form-control" value="${esc(x.licencia||'')}"></div><div class="lg-field"><label>Categoría</label><input id="lgr-cat" class="form-control" value="${esc(x.categoria_licencia||'')}"></div><div class="lg-field"><label>Vencimiento</label><input id="lgr-exp" type="date" min="${peruDate()}" class="form-control" value="${esc(String(x.licencia_vencimiento||'').slice(0,10))}"></div><div class="lg-field full"><label>Sucursal</label><select id="lgr-branch" class="form-control"><option value="">Todas las sucursales</option>${opts}</select></div></div>`,footer:`<button class="btn btn-outline" onclick="_lgClose()">Cancelar</button><button id="lgr-save" class="btn btn-primary">Guardar repartidor</button>`});
    document.getElementById('lgr-api').onclick=async()=>{const doc=document.getElementById('lgr-doc').value.replace(/\D/g,'');if(doc.length!==8)return Swal.fire('DNI inválido','','warning');const r=await Http.get(`/clientes/consultar?doc=${doc}`);if(r?.ok){const d=r.cliente||r.data||r;document.getElementById('lgr-name').value=d.nombre_completo||[d.nombre,d.apellido_paterno,d.apellido_materno].filter(Boolean).join(' ');}};
    document.getElementById('lgr-save').onclick=async()=>{const payload={documento:document.getElementById('lgr-doc').value.replace(/\D/g,''),nombres:document.getElementById('lgr-name').value.trim(),telefono:document.getElementById('lgr-phone').value.trim(),licencia:document.getElementById('lgr-license').value.trim(),categoria_licencia:document.getElementById('lgr-cat').value.trim(),licencia_vencimiento:document.getElementById('lgr-exp').value,sucursal_id:Number(document.getElementById('lgr-branch').value)||null,estado:1};const r=await (id?Http.put(`/logistica/repartidores/${id}`,payload):Http.post('/logistica/repartidores',payload));if(!r?.ok)return Swal.fire('Error',r?.msg||'No se pudo guardar','error');closeModal();await loadBase();};
  };

  window._lgVehiculo=async id=>{
    const x=vehiculos.find(y=>Number(y.id)===Number(id))||{}; const opts=sucursales.map(s=>`<option value="${s.id}" ${Number(x.sucursal_id)===Number(s.id)?'selected':''}>${esc(s.nombre)}</option>`).join('');
    modal({title:id?'Editar camión':'Nuevo camión',small:true,body:`<div class="lg-form-grid"><div class="lg-field"><label>Placa</label><input id="lgv-placa" class="form-control" value="${esc(x.placa||'')}"></div><div class="lg-field"><label>Tipo</label><select id="lgv-tipo" class="form-control"><option value="camion">Camión</option><option value="furgon">Furgón</option><option value="moto">Moto</option></select></div><div class="lg-field"><label>Marca</label><input id="lgv-marca" class="form-control" value="${esc(x.marca||'')}"></div><div class="lg-field"><label>Modelo</label><input id="lgv-modelo" class="form-control" value="${esc(x.modelo||'')}"></div><div class="lg-field"><label>Año</label><input id="lgv-anio" type="number" class="form-control" value="${esc(x.anio||'')}"></div><div class="lg-field"><label>Capacidad kg</label><input id="lgv-kg" type="number" class="form-control" value="${Number(x.capacidad_kg||0)}"></div><div class="lg-field"><label>SOAT</label><input id="lgv-soat" type="date" min="${peruDate()}" class="form-control" value="${esc(String(x.soat_vencimiento||'').slice(0,10))}"></div><div class="lg-field"><label>Revisión técnica</label><input id="lgv-rev" type="date" min="${peruDate()}" class="form-control" value="${esc(String(x.revision_vencimiento||'').slice(0,10))}"></div><div class="lg-field full"><label>Sucursal</label><select id="lgv-branch" class="form-control"><option value="">Todas las sucursales</option>${opts}</select></div></div>`,footer:`<button class="btn btn-outline" onclick="_lgClose()">Cancelar</button><button id="lgv-save" class="btn btn-primary">Guardar camión</button>`});
    document.getElementById('lgv-tipo').value=x.tipo||'camion';document.getElementById('lgv-save').onclick=async()=>{const payload={placa:document.getElementById('lgv-placa').value.trim(),tipo:document.getElementById('lgv-tipo').value,marca:document.getElementById('lgv-marca').value.trim(),modelo:document.getElementById('lgv-modelo').value.trim(),anio:Number(document.getElementById('lgv-anio').value)||null,capacidad_kg:Number(document.getElementById('lgv-kg').value)||0,soat_vencimiento:document.getElementById('lgv-soat').value,revision_vencimiento:document.getElementById('lgv-rev').value,sucursal_id:Number(document.getElementById('lgv-branch').value)||null,estado_operativo:'disponible',estado:1};const r=await(id?Http.put(`/logistica/vehiculos/${id}`,payload):Http.post('/logistica/vehiculos',payload));if(!r?.ok)return Swal.fire('Error',r?.msg||'No se pudo guardar','error');closeModal();await loadBase();};
  };

  document.querySelectorAll('[data-lg-tab]').forEach(btn=>btn.onclick=()=>switchTab(btn.dataset.lgTab));
  document.getElementById('lg-pedidos-filtrar').onclick=renderDeliveries;
  document.getElementById('lg-pedidos-sucursal').onchange=loadDeliveries;
  document.getElementById('lg-pedidos-estado').onchange=renderDeliveries;
  document.getElementById('lg-pedidos-buscar').oninput=renderDeliveries;
  document.getElementById('lg-nueva-ruta').onclick=()=>createRoute();
  document.getElementById('lg-nuevo-repartidor').onclick=()=>window._lgRepartidor();
  document.getElementById('lg-nuevo-vehiculo').onclick=()=>window._lgVehiculo();
  document.getElementById('lg-filtrar').onclick=async()=>{const d=document.getElementById('lg-desde').value,h=document.getElementById('lg-hasta').value,t=peruDate();if((d&&d>t)||(h&&h>t)||d>h)return Swal.fire('Fechas inválidas','Los filtros no permiten fechas futuras.','warning');await Promise.all([loadRutas(),loadResumen()]);};
  document.getElementById('lg-refrescar').onclick=async()=>{
    const button=document.getElementById('lg-refrescar');
    button.disabled=true;button.innerHTML='<i class="ti ti-loader-2 ti-spin"></i> Actualizando';
    try{await loadBase();await Promise.all([loadDeliveries(),loadRutas(),loadResumen()]);}
    finally{button.disabled=false;button.innerHTML='<i class="ti ti-refresh"></i> Actualizar';}
  };
  if(!canManage){document.getElementById('lg-nueva-ruta').hidden=true;document.getElementById('lg-nuevo-repartidor').hidden=true;document.getElementById('lg-nuevo-vehiculo').hidden=true;}
  document.getElementById('lg-desde').value=`${peruDate().slice(0,7)}-01`; document.getElementById('lg-hasta').value=peruDate();document.getElementById('lg-desde').max=peruDate();document.getElementById('lg-hasta').max=peruDate();
  await loadBase(); await Promise.all([loadDeliveries(),loadRutas(),loadResumen()]);
  const handoff=JSON.parse(sessionStorage.getItem('mp_logistica_asignar')||'null'); if(handoff){sessionStorage.removeItem('mp_logistica_asignar');switchTab('pedidos');setTimeout(()=>createRoute(handoff.entrega_id,handoff.sucursal_id),120);}
};
