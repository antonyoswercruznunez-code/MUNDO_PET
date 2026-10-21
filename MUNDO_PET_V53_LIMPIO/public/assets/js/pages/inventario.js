window.init_inventario = async function () {

  const html = await fetch('/views/pages/inventario.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  // Estilos de pestañas de sucursal
  const _st = document.createElement('style');
  _st.textContent = `
    .suc-tab{background:none;border:none;border-bottom:2px solid transparent;
             padding:9px 16px;font-size:14px;color:var(--texto-muted);cursor:pointer}
    .suc-tab.active{color:var(--rojo);border-bottom-color:var(--rojo);font-weight:600}
  `;
  document.head.appendChild(_st);

  let stock        = [];
  let sucursales   = [];
  let sucActiva    = null;          // null = todas · <id>
  let pagina       = 1;
  let limite       = 10;
  let buscar       = '';
  let filtroEstado = '';

  const esGlobal = !!window._esGlobal;
  const puedeTransferir = esGlobal;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function cargarSucursales() {
    if (!esGlobal) return;
    const res  = await Http.get('/sucursales');
    sucursales = res?.ok ? res.sucursales : [];
    if (sucursales.length) renderTabs();
  }

  function renderTabs() {
    const cont = document.getElementById('inv-tabs');
    cont.style.display = 'flex';
    const tab = (val, lbl) =>
      `<button class="suc-tab ${val === sucActiva ? 'active' : ''}" data-suc="${val ?? ''}">${lbl}</button>`;
    cont.innerHTML = tab(null, 'Todas') + sucursales.map(s => tab(s.id, s.nombre)).join('');
    cont.querySelectorAll('.suc-tab').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.suc;
        sucActiva = v === '' ? null : +v;
        pagina = 1;
        renderTabs();
        renderTabla();
      };
    });
  }

  async function cargar() {
    const res = await Http.get('/inventario');
    if (!res?.ok) return;
    stock = res.stock;
    renderStats(res.resumen);
    renderTabla();
  }

  function renderStats(r) {
    if (!r) return;
    document.getElementById('stats-inv').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon blue"><i class="ti ti-package"></i></div>
        <div class="stat-info">
          <div class="stat-value">${r.total_productos}</div>
          <div class="stat-label">Productos activos</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red"><i class="ti ti-alert-triangle"></i></div>
        <div class="stat-info">
          <div class="stat-value" style="color:var(--danger)">
            ${r.stock_critico}
          </div>
          <div class="stat-label">Stock crítico</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="ti ti-circle-check"></i></div>
        <div class="stat-info">
          <div class="stat-value" style="color:var(--success)">
            ${r.stock_optimo}
          </div>
          <div class="stat-label">Stock óptimo</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber"><i class="ti ti-cash"></i></div>
        <div class="stat-info">
          <div class="stat-value">
            S/ ${parseFloat(r.valor_total||0).toFixed(2)}
          </div>
          <div class="stat-label">Valor total stock</div>
        </div>
      </div>`;
  }

  function renderTabla() {
    const filtrados = stock.filter(p => {
      if (sucActiva != null && p.sucursal_id !== sucActiva) return false;
      const q = buscar.toLowerCase();
      const matchBuscar = (
        p.nombre?.toLowerCase().includes(q) ||
        (p.sucursal_nombre || '').toLowerCase().includes(q) ||
        (p.sucursal_origen_nombre || '').toLowerCase().includes(q)
      );
      const matchEstado = !filtroEstado || p.estado_stock === filtroEstado;
      return matchBuscar && matchEstado;
    });

    const total  = filtrados.length;
    const inicio = (pagina - 1) * limite;
    const data   = filtrados.slice(inicio, inicio + limite);
    const tbody  = document.getElementById('tbody-inv');

    if (!data.length) {
      tbody.innerHTML = `
        <tr><td colspan="7">
          <div class="empty-state">
            <i class="ti ti-box"></i>
            <p>No se encontraron productos</p>
          </div>
        </td></tr>`;
    } else {
      tbody.innerHTML = data.map(p => {
        const critico = p.estado_stock === 'critico';
        const img     = p.imagen_portada
          ? `<img src="${p.imagen_portada}"
                  style="width:34px;height:34px;object-fit:cover;
                         border-radius:6px;margin-right:8px;flex-shrink:0;
                         border:1px solid var(--card-border)">`
          : `<div style="width:34px;height:34px;background:var(--input-bg);
                         border-radius:6px;margin-right:8px;flex-shrink:0;
                         display:flex;align-items:center;justify-content:center;
                         border:1px solid var(--card-border)">
               <i class="ti ti-photo"
                  style="color:var(--texto-muted);font-size:13px"></i>
             </div>`;

        const botonesAdmin = window._esAdmin
          ? `<button class="btn btn-xs btn-outline"
                     onclick="_abrirAjuste(${p.id})" title="Ajuste manual"
                     style="border-color:var(--warning);color:var(--warning)">
               <i class="ti ti-adjustments"></i>
             </button>`
          : '';

        return `
          <tr>
            <td>
              <div style="display:flex;align-items:center">
                ${img}
                <div>
                  <div style="font-weight:500;color:#fff">${p.nombre}</div>
                  ${Number(p.es_transferido) === 1 ? `<div style="font-size:11px;color:var(--info);margin-top:2px">
                    <i class="ti ti-transfer"></i> Transferido desde ${esc(p.sucursal_origen_nombre || 'otra sucursal')}
                  </div>` : ''}
                </div>
              </div>
            </td>
            <td>${p.sucursal_nombre || '<span class="text-muted">—</span>'}</td>
            <td>
              <span style="font-size:16px;font-weight:700;
                           color:${critico ? 'var(--danger)' : 'var(--success)'}">
                ${p.stock_actual}
              </span>
            </td>
            <td style="color:var(--texto-muted)">${p.stock_minimo}</td>
            <td>
              <span class="badge ${critico ? 'badge-danger' : 'badge-success'}">
                ${critico ? '⚠ Crítico' : '✓ Óptimo'}
              </span>
            </td>
            <td style="color:var(--texto-muted)">
              S/ ${parseFloat(p.valor_total || 0).toFixed(2)}
            </td>
            <td>
              <div style="display:flex;gap:6px">
                <button class="btn btn-success btn-xs"
                        onclick="_abrirMovimiento(${p.id})"
                        title="Entrada / Salida">
                  <i class="ti ti-transfer"></i>
                </button>
                <button class="btn btn-info btn-xs"
                        onclick="_abrirHistorial(${p.id})"
                        title="Historial"
                        style="background:rgba(0,176,255,.15);
                               color:var(--info);border:none">
                  <i class="ti ti-history"></i>
                </button>
                ${botonesAdmin}
                ${Number(p.es_transferido) === 1 && window._esAdmin ? `<button class="btn btn-xs ${(Number(p.transferencia_venta_panel ?? p.transferencia_venta_habilitada)===1 || Number(p.transferencia_venta_web ?? p.transferencia_venta_habilitada)===1) ? 'btn-success' : 'btn-outline'}"
                     onclick="_invToggleVentaTransferida(${p.id},${Number(p.transferencia_venta_panel ?? p.transferencia_venta_habilitada)},${Number(p.transferencia_venta_web ?? p.transferencia_venta_habilitada)})"
                     title="Configurar canales de venta">
                  <i class="ti ti-adjustments-check"></i>
                </button>` : ''}
              </div>
            </td>
          </tr>`;
      }).join('');
    }

    const totalPags = Math.ceil(total / limite) || 1;
    document.getElementById('pag-info').textContent = total
      ? `Mostrando ${inicio + 1} a ${Math.min(inicio + limite, total)} de ${total} registros`
      : '';

    const btns = document.getElementById('pag-btns');
    btns.innerHTML = '';
    const prev = document.createElement('button');
    prev.className = 'page-btn';
    prev.innerHTML = '<i class="ti ti-chevron-left"></i>';
    prev.disabled  = pagina === 1;
    prev.onclick   = () => { pagina--; renderTabla(); };
    btns.appendChild(prev);
    for (let i = 1; i <= totalPags; i++) {
      const b = document.createElement('button');
      b.className   = `page-btn${i === pagina ? ' active' : ''}`;
      b.textContent = i;
      b.onclick     = () => { pagina = i; renderTabla(); };
      btns.appendChild(b);
    }
    const next = document.createElement('button');
    next.className = 'page-btn';
    next.innerHTML = '<i class="ti ti-chevron-right"></i>';
    next.disabled  = pagina >= totalPags;
    next.onclick   = () => { pagina++; renderTabla(); };
    btns.appendChild(next);
  }

  // ── Bloqueo de teclas numéricas ──────────────────────────
  function bloquearTeclasEntero(e) {
    if (['-', '+', 'e', 'E', '.', ','].includes(e.key)) e.preventDefault();
  }
  function limpiarEntero(e) {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  }

  // ── MOVIMIENTO ───────────────────────────────────────────
  window._setTipoMov = function(tipo) {
    document.getElementById('mov-tipo').value = tipo;
    const btnE = document.getElementById('btn-tipo-entrada');
    const btnS = document.getElementById('btn-tipo-salida');
    if (tipo === 'entrada') {
      btnE.className = 'btn btn-success';
      btnS.className = 'btn btn-outline';
    } else {
      btnE.className = 'btn btn-outline';
      btnS.className = 'btn btn-danger';
    }
    btnE.style.flex = btnS.style.flex = '1';
    btnE.style.justifyContent = btnS.style.justifyContent = 'center';
  };

  window._abrirMovimiento = function(id) {
    const p = stock.find(x => x.id === id);
    if (!p) return;
    document.getElementById('mov-producto-id').value           = id;
    document.getElementById('mov-producto-nombre').textContent = p.nombre;
    document.getElementById('mov-stock-actual').textContent    = p.stock_actual;
    document.getElementById('mov-stock-minimo').textContent    = p.stock_minimo;
    document.getElementById('mov-cantidad').value    = '';
    document.getElementById('mov-referencia').value  = '';
    document.getElementById('mov-motivo').value      = '';
    document.getElementById('mov-observacion').value = '';
    _setTipoMov('entrada');
    document.getElementById('mov-titulo').textContent =
      `Movimiento — ${p.nombre}`;
    document.getElementById('modal-mov').classList.add('open');
  };

  document.getElementById('btn-guardar-mov').addEventListener('click', async () => {
    const producto_id = document.getElementById('mov-producto-id').value;
    const tipo        = document.getElementById('mov-tipo').value;
    const cantidad    = +document.getElementById('mov-cantidad').value;
    const motivo      = document.getElementById('mov-motivo').value.trim();
    const referencia  = document.getElementById('mov-referencia').value.trim();
    const observacion = document.getElementById('mov-observacion').value.trim();

    if (!cantidad || cantidad < 1 || !Number.isInteger(cantidad))
      return Swal.fire({
        icon: 'error', title: 'Error',
        text: 'Ingresa una cantidad válida (solo números positivos)',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    if (!motivo)
      return Swal.fire({
        icon: 'error', title: 'Error',
        text: 'El motivo es requerido',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    const btn = document.getElementById('btn-guardar-mov');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Registrando...';

    const res = await Http.post('/inventario/reponer', {
      producto_id: +producto_id, tipo, cantidad,
      motivo, referencia, observacion
    });

    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Registrar';

    if (!res?.ok)
      return Swal.fire({
        icon: 'error', title: 'Error', text: res?.msg,
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    document.getElementById('modal-mov').classList.remove('open');
    Swal.fire({
      icon: 'success', title: 'Movimiento registrado',
      timer: 1500, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
    await cargar();
  });

  // ── HISTORIAL ────────────────────────────────────────────
  window._abrirHistorial = async function(id) {
    const p = stock.find(x => x.id === id);
    document.getElementById('hist-titulo').textContent =
      `Historial — ${p?.nombre}`;
    document.getElementById('modal-hist').classList.add('open');
    document.getElementById('hist-contenido').innerHTML = `
      <div class="loading-center"><div class="spinner spinner-lg"></div></div>`;

    const res = await Http.get(`/inventario/${id}/movimientos`);

    if (!res?.ok) {
      document.getElementById('hist-contenido').innerHTML =
        `<div class="alert alert-danger">Error cargando historial</div>`;
      return;
    }
    if (!res.movimientos.length) {
      document.getElementById('hist-contenido').innerHTML = `
        <div class="empty-state">
          <i class="ti ti-history"></i>
          <p>Sin movimientos registrados</p>
        </div>`;
      return;
    }

    document.getElementById('hist-contenido').innerHTML = `
      <div class="tabla-container">
        <table class="tabla">
          <thead>
            <tr>
              <th>Fecha</th><th>Tipo</th><th>Cantidad</th>
              <th>Stock Antes</th><th>Stock Después</th>
              <th>Motivo / Ref.</th><th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            ${res.movimientos.map(m => {
              const esEntrada = ['REPOSICION','INGRESO_INICIAL',
                'AJUSTE_ENTRADA','ENTRADA'].includes(m.tipo);
              const esSalida  = ['SALIDA_VENTA','AJUSTE_SALIDA',
                'SALIDA','ANULACION'].includes(m.tipo);
              const fecha = new Date(m.created_at).toLocaleString('es-PE', {
                day:'2-digit', month:'2-digit', year:'numeric',
                hour:'2-digit', minute:'2-digit'
              });
              const tipoLabel = {
                REPOSICION:'Reposición', INGRESO_INICIAL:'Stock inicial',
                AJUSTE_ENTRADA:'Ajuste entrada', AJUSTE_SALIDA:'Ajuste salida',
                AJUSTE_MANUAL:'Ajuste manual', SALIDA_VENTA:'Venta',
                ANULACION:'Anulación', ENTRADA:'Entrada', SALIDA:'Salida'
              }[m.tipo] || m.tipo;

              return `
                <tr>
                  <td style="font-size:12px;color:var(--texto-muted);
                             white-space:nowrap">${fecha}</td>
                  <td>
                    <span class="badge ${esEntrada ? 'badge-success' :
                      esSalida ? 'badge-danger' : 'badge-warning'}">
                      ${esEntrada ? '↑' : esSalida ? '↓' : '⟳'} ${tipoLabel}
                    </span>
                  </td>
                  <td style="font-weight:700;
                             color:${esEntrada
                               ? 'var(--success)' : 'var(--danger)'}">
                    ${esEntrada ? '+' : '-'}${m.cantidad}
                  </td>
                  <td style="color:var(--texto-muted)">${m.stock_antes}</td>
                  <td style="font-weight:600">${m.stock_despues}</td>
                  <td style="font-size:12px;max-width:200px">
                    ${m.referencia || '-'}
                  </td>
                  <td style="font-size:12px">${m.usuario_nombre || '-'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  };

  // ── AJUSTE MANUAL ────────────────────────────────────────
  window._abrirAjuste = function(id) {
    const p = stock.find(x => x.id === id);
    if (!p) return;
    document.getElementById('ajuste-producto-id').value        = id;
    document.getElementById('ajuste-nombre').textContent       = p.nombre;
    document.getElementById('ajuste-stock-actual').textContent = p.stock_actual;
    document.getElementById('ajuste-stock').value              = p.stock_actual;
    document.getElementById('ajuste-referencia').value         = '';
    document.getElementById('ajuste-motivo').value             = '';
    document.getElementById('modal-ajuste').classList.add('open');
  };

  document.getElementById('btn-guardar-ajuste').addEventListener('click', async () => {
    const producto_id = document.getElementById('ajuste-producto-id').value;
    const nuevoStock  = document.getElementById('ajuste-stock').value;
    const referencia  = document.getElementById('ajuste-referencia').value.trim();
    const motivo      = document.getElementById('ajuste-motivo').value.trim();

    if (nuevoStock === '' || +nuevoStock < 0 || !Number.isInteger(+nuevoStock))
      return Swal.fire({
        icon: 'error', title: 'Error',
        text: 'Ingresa un stock válido (solo números positivos)',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    if (!motivo)
      return Swal.fire({
        icon: 'error', title: 'Error',
        text: 'El motivo es requerido',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    const conf = await Swal.fire({
      title: '¿Aplicar ajuste?',
      text: `El stock se actualizará a ${nuevoStock} unidades`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, aplicar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#e53935',
      background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;

    const btn = document.getElementById('btn-guardar-ajuste');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Aplicando...';

    const res = await Http.post('/inventario/ajuste', {
      producto_id: +producto_id,
      tipo:        'absoluto',
      cantidad:    +nuevoStock,
      referencia,
      observacion: motivo
    });

    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-adjustments"></i> Aplicar Ajuste';

    if (!res?.ok)
      return Swal.fire({
        icon: 'error', title: 'Error', text: res?.msg,
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    document.getElementById('modal-ajuste').classList.remove('open');
    Swal.fire({
      icon: 'success', title: 'Ajuste aplicado',
      timer: 1500, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
    await cargar();
  });


  // ── TRANSFERENCIAS ENTRE SUCURSALES ─────────────────────
  let transferencias = [];

  window._invToggleVentaTransferida = async function(id, panelActual, webActual) {
    const result = await Swal.fire({
      title: 'Canales de venta',
      width: 590,
      html: `<div style="text-align:left"><p style="color:#64748b;margin:0 0 14px">Controla por separado dónde puede venderse este producto transferido.</p>
        <label style="display:flex;align-items:center;gap:12px;padding:15px;border:1px solid #dbe7df;border-radius:12px;margin-bottom:10px;background:#f8fffa">
          <input id="inv-sale-panel" type="checkbox" ${Number(panelActual)===1?'checked':''} style="width:20px;height:20px"><span><b>Panel administrativo</b><small style="display:block;color:#64748b;margin-top:3px">Ventas y cotizaciones presenciales.</small></span>
        </label>
        <label style="display:flex;align-items:center;gap:12px;padding:15px;border:1px solid #dbe7df;border-radius:12px;background:#f8fffa">
          <input id="inv-sale-web" type="checkbox" ${Number(webActual)===1?'checked':''} style="width:20px;height:20px"><span><b>Página web</b><small style="display:block;color:#64748b;margin-top:3px">Catálogo, carrito y pedidos ecommerce.</small></span>
        </label></div>`,
      showCancelButton:true, confirmButtonText:'Guardar canales', cancelButtonText:'Cancelar', confirmButtonColor:'#16a34a',
      preConfirm:()=>({panel:document.getElementById('inv-sale-panel').checked,web:document.getElementById('inv-sale-web').checked})
    });
    if(!result.isConfirmed)return;
    const r = await Http.patch(`/productos/${id}/venta-transferida`, result.value);
    await Swal.fire(r?.ok ? 'Canales actualizados' : 'Error', r?.msg || '', r?.ok ? 'success' : 'error');
    if (r?.ok) await cargar();
  };

  async function cargarTransferencias() {
    const r = await Http.get('/inventario-transferencias');
    transferencias = r?.transferencias || [];
    const tbody = document.getElementById('tr-tbody');
    tbody.innerHTML = transferencias.length ? transferencias.map(t => {
      const pendiente = t.estado === 'enviada';
      return `<tr>
        <td><b>${esc(t.codigo)}</b></td><td>${esc(t.sucursal_origen)}</td><td>${esc(t.sucursal_destino)}</td>
        <td>${esc(t.detalle)}</td><td><span class="badge ${t.estado==='recibida'?'badge-success':t.estado==='cancelada'?'badge-danger':'badge-warning'}">${esc(t.estado)}</span></td>
        <td>${t.created_at ? new Date(t.created_at).toLocaleString('es-PE') : '—'}</td>
        <td><div style="display:flex;gap:5px">
          ${pendiente ? `<button class="btn btn-success btn-xs" onclick="_recibirTransferencia(${t.id})" title="Confirmar recepción"><i class="ti ti-package-import"></i></button>` : ''}
          ${pendiente ? `<button class="btn btn-danger btn-xs" onclick="_cancelarTransferencia(${t.id})" title="Cancelar"><i class="ti ti-x"></i></button>` : ''}
        </div></td></tr>`;
    }).join('') : '<tr><td colspan="7"><div class="empty-state"><i class="ti ti-arrows-transfer-up"></i><p>Sin transferencias registradas</p></div></td></tr>';
  }

  async function cargarCandidatos(origenId) {
    const select = document.getElementById('tr-destino');
    if (!origenId) { select.innerHTML='<option value="">Selecciona primero el origen</option>'; return; }
    select.innerHTML='<option value="">Cargando...</option>';
    const r = await Http.get(`/inventario-transferencias/candidatos?origen_id=${Number(origenId)}`);
    if (!r?.ok) { select.innerHTML=`<option value="">${esc(r?.msg || 'No se pudo cargar')}</option>`; return; }
    const rows = r.candidatos || [];
    select.innerHTML = '<option value="">Seleccionar sucursal destino...</option>' + rows.map(x =>
      `<option value="${Number(x.sucursal_id)}:${Number(x.producto_destino_id || 0)}">${esc(x.sucursal_nombre)} — ${x.producto_destino_id ? `producto existente, stock ${Number(x.stock_destino||0)}` : 'se creará como transferido'}</option>`
    ).join('');
    if (!rows.length) select.innerHTML='<option value="">No hay otras sucursales activas</option>';
  }

  window._abrirTransferencias = async function () {
    const origin = document.getElementById('tr-origen');
    const originRows = stock.filter(x => Number(x.stock_actual) > 0 && x.sucursal_id);
    origin.innerHTML = '<option value="">Seleccionar...</option>' + originRows.map(x =>
      `<option value="${x.id}">${esc(x.sucursal_nombre||'Sucursal')} — ${esc(x.nombre)} (stock ${Number(x.stock_actual||0)})</option>`
    ).join('');
    document.getElementById('tr-destino').innerHTML='<option value="">Selecciona primero el origen</option>';
    document.getElementById('tr-cantidad').value='';
    document.getElementById('tr-motivo').value='';
    document.getElementById('modal-transferencias').classList.add('open');
    await cargarTransferencias();
  };

  window._recibirTransferencia = async function(id) {
    const c = await Swal.fire({title:'¿Confirmar recepción?',text:'El stock ingresará a la sucursal destino.',icon:'question',showCancelButton:true,confirmButtonText:'Sí, recibir'});
    if(!c.isConfirmed) return;
    const r=await Http.patch(`/inventario-transferencias/${id}/recibir`,{});
    await Swal.fire(r?.ok?'Listo':'Error',r?.msg||'',r?.ok?'success':'error');
    if(r?.ok){await cargar();await cargarTransferencias();}
  };

  window._cancelarTransferencia = async function(id) {
    const c=await Swal.fire({title:'Cancelar transferencia',input:'textarea',inputLabel:'Motivo',showCancelButton:true,inputValidator:v=>String(v||'').trim().length<5?'Escribe al menos 5 caracteres':undefined});
    if(!c.isConfirmed)return;
    const r=await Http.patch(`/inventario-transferencias/${id}/cancelar`,{motivo:c.value});
    await Swal.fire(r?.ok?'Listo':'Error',r?.msg||'',r?.ok?'success':'error');
    if(r?.ok){await cargar();await cargarTransferencias();}
  };

  if (puedeTransferir) {
    const btn = document.getElementById('btn-transferencias');
    btn.style.display='inline-flex';
    btn.onclick=window._abrirTransferencias;
    document.getElementById('tr-origen').addEventListener('change',e=>{
      const item=stock.find(x=>Number(x.id)===Number(e.target.value));
      const cantidad=document.getElementById('tr-cantidad'); cantidad.max=String(Number(item?.stock_actual||0)); cantidad.placeholder=`Máximo ${Number(item?.stock_actual||0)}`;
      cargarCandidatos(e.target.value);
    });
    document.getElementById('btn-enviar-transferencia').addEventListener('click',async()=>{
      const destinoValor = document.getElementById('tr-destino').value;
      const [sucursalDestino, productoDestino] = destinoValor.split(':').map(Number);
      const data={
        producto_origen_id:Number(document.getElementById('tr-origen').value),
        sucursal_destino_id:sucursalDestino,
        producto_destino_id:productoDestino || null,
        cantidad:Number(document.getElementById('tr-cantidad').value),
        motivo:document.getElementById('tr-motivo').value.trim()
      };
      const origen=stock.find(x=>Number(x.id)===data.producto_origen_id);
      if(!data.producto_origen_id)return Swal.fire('Falta el producto','Selecciona el producto de origen.','warning');
      if(!data.sucursal_destino_id)return Swal.fire('Falta la sucursal','Selecciona una sucursal destino.','warning');
      if(!Number.isInteger(data.cantidad)||data.cantidad<=0)return Swal.fire('Cantidad inválida','La cantidad debe ser un número entero mayor a cero.','warning');
      if(data.cantidad>Number(origen?.stock_actual||0))return Swal.fire('Stock insuficiente',`Solo hay ${Number(origen?.stock_actual||0)} unidades disponibles.`,'warning');
      if(data.motivo.length<3)return Swal.fire('Falta el motivo','Escribe un motivo de al menos 3 caracteres.','warning');
      const btn=document.getElementById('btn-enviar-transferencia'); btn.disabled=true;
      const r=await Http.post('/inventario-transferencias',data); btn.disabled=false;
      await Swal.fire(r?.ok?'Transferencia registrada':'Error',r?.msg||'',r?.ok?'success':'error');
      if(r?.ok){await cargar();await window._abrirTransferencias();}
    });
    document.getElementById('btn-cerrar-transferencias').onclick=()=>document.getElementById('modal-transferencias').classList.remove('open');
    document.getElementById('modal-transferencias').addEventListener('click',e=>{if(e.target.id==='modal-transferencias')e.currentTarget.classList.remove('open');});
  }

  // ── CERRAR MODALES ───────────────────────────────────────
  document.getElementById('btn-cerrar-mov').addEventListener('click', () => {
    document.getElementById('modal-mov').classList.remove('open');
  });
  document.getElementById('btn-cancelar-mov').addEventListener('click', () => {
    document.getElementById('modal-mov').classList.remove('open');
  });
  document.getElementById('btn-cerrar-hist').addEventListener('click', () => {
    document.getElementById('modal-hist').classList.remove('open');
  });
  document.getElementById('btn-cerrar-ajuste').addEventListener('click', () => {
    document.getElementById('modal-ajuste').classList.remove('open');
  });
  document.getElementById('btn-cancelar-ajuste').addEventListener('click', () => {
    document.getElementById('modal-ajuste').classList.remove('open');
  });

  ['modal-mov','modal-hist','modal-ajuste'].forEach(mid => {
    document.getElementById(mid).addEventListener('click', e => {
      if (e.target.id === mid)
        document.getElementById(mid).classList.remove('open');
    });
  });

  // ── Aplicar bloqueo a campos numéricos ──────────────────
  ['mov-cantidad','ajuste-stock'].forEach(campoId => {
    const el = document.getElementById(campoId);
    el.addEventListener('keydown', bloquearTeclasEntero);
    el.addEventListener('input', limpiarEntero);
  });

  // ── FILTROS ──────────────────────────────────────────────
  document.getElementById('inp-buscar').addEventListener('input', e => {
    buscar = e.target.value; pagina = 1; renderTabla();
  });
  document.getElementById('sel-limite').addEventListener('change', e => {
    limite = parseInt(e.target.value); pagina = 1; renderTabla();
  });
  document.getElementById('fil-estado').addEventListener('change', e => {
    filtroEstado = e.target.value; pagina = 1; renderTabla();
  });

  await cargarSucursales();
  await cargar();
};