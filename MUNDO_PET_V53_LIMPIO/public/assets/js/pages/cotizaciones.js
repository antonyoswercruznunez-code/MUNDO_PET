window.init_cotizaciones = async function () {

  const html = await fetch('/views/pages/cotizaciones.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  // ── Estilos (tarjetas del modal + botones de validez) ────────────────
  const style = document.createElement('style');
  style.textContent = `
    .ct-card { background: var(--card-bg); border: 1px solid var(--card-border);
               border-radius: 10px; padding: 14px 16px; }
    .ct-card-title { font-size: 11px; font-weight: 700; color: var(--texto-muted);
                     text-transform: uppercase; letter-spacing: .5px;
                     display: flex; align-items: center; gap: 6px; }
    .ct-dias-btn { flex:1; border:1.5px solid var(--card-border); background:var(--card-bg);
                   border-radius:7px; padding:6px 4px; font-size:12px; color:var(--texto-muted);
                   cursor:pointer; transition:all .15s; }
    .ct-dias-btn.active { border-color:var(--rojo); color:var(--rojo);
                          background:rgba(229,57,53,.08); }
    .suc-tab{background:none;border:none;border-bottom:2px solid transparent;
             padding:9px 16px;font-size:14px;color:var(--texto-muted);cursor:pointer}
    .suc-tab.active{color:var(--rojo);border-bottom-color:var(--rojo);font-weight:600}
  `;
  document.head.appendChild(style);

  // ── ESTADO ───────────────────────────────────────────────────────────
  let todos      = [];
  let todosProds = [];
  let ctItems    = [];
  let pagina     = 1;
  let limite     = 10;
  let buscar     = '';
  let esAdmin    = true;   // se ajusta abajo; el backend es el candado real
  let sucursales = [];
  let esGlobal   = !!window._esGlobal;
  let miSucursal = null;          // sucursal del vendedor (default no-admin)
  let ctSucursalActiva = null;    // sucursal que filtra el buscador de la cotización actual
  let ctEditId = null;

  const alerta = (icon, title, text, timer) => Swal.fire({
    icon, title, text,
    background: '#1a1a2e', color: '#e0e0e0',
    confirmButtonColor: '#159447',
    timer: timer || undefined,
    showConfirmButton: !timer
  });

  // Toast flotante (no bloquea ni cierra el modal)
  function ctToast(msg) {
    let t = document.getElementById('ct-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ct-toast';
      t.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);'
        + 'background:#00c853;color:#fff;padding:7px 16px;border-radius:20px;font-size:13px;'
        + 'font-weight:600;z-index:99999;box-shadow:0 4px 14px rgba(0,0,0,.35);opacity:0;'
        + 'transition:opacity .2s;pointer-events:none;display:flex;align-items:center;gap:6px';
      document.body.appendChild(t);
    }
    t.innerHTML = `<i class="ti ti-check"></i> ${msg}`;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 900);
  }

  // ── FECHAS (hora real de Perú) ───────────────────────────────────────
  function hoyPeru() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }
  const hoy = hoyPeru();

  // suma días a 'YYYY-MM-DD'
  function masDias(fechaISO, dias) {
    const [y, m, d] = fechaISO.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + (+dias || 0));
    return dt.toISOString().slice(0, 10);
  }
  // 'YYYY-MM-DD' → 'DD/MM/YYYY'
  function fechaLinda(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('T')[0].split('-');
    return `${d}/${m}/${y}`;
  }
  function fechaHoraLinda(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-PE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // ── BADGE DE ESTADO ──────────────────────────────────────────────────
  function badgeEstado(estadoReal) {
    const map = {
      vigente:    ['Vigente',    'var(--success)', 'rgba(0,200,83,.15)'],
      vencida:    ['Vencida',    'var(--warning)', 'rgba(255,152,0,.15)'],
      eliminada:  ['Eliminada',  'var(--texto-muted)', 'rgba(150,150,150,.12)']
    };
    const [txt, color, bg] = map[estadoReal] || map.vigente;
    return `<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:12px;
                 color:${color};background:${bg}">${txt}</span>`;
  }

  // ── CARGAR LISTADO ───────────────────────────────────────────────────
  async function cargar() {
    const params = new URLSearchParams();
    const desde  = document.getElementById('fil-desde').value;
    const hasta  = document.getElementById('fil-hasta').value;
    const estado = document.getElementById('fil-estado').value;
    if ((desde && desde > hoy) || (hasta && hasta > hoy)) return alerta('warning', 'Fecha inválida', 'No se permiten fechas futuras');
    if (desde && hasta && desde > hasta) return alerta('warning', 'Rango inválido', 'La fecha desde no puede ser mayor que hasta');
    if (desde)  params.append('desde', desde);
    if (hasta)  params.append('hasta', hasta);
    if (estado) params.append('estado', estado);

    const res = await Http.get(`/cotizaciones?${params.toString()}`);
    if (!res?.ok) return;
    todos = res.cotizaciones || [];
    renderTabla();
  }

  function renderTabla() {
    const filtrados = todos.filter(q => {
      const s = buscar.toLowerCase();
      return !s
        || (q.cliente_nombre || '').toLowerCase().includes(s)
        || (q.cliente_doc || '').toLowerCase().includes(s);
    });

    const total  = filtrados.length;
    const inicio = (pagina - 1) * limite;
    const data   = filtrados.slice(inicio, inicio + limite);
    const tbody  = document.getElementById('tbody-cotizaciones');

    if (!data.length) {
      tbody.innerHTML = `
        <tr><td colspan="8">
          <div class="empty-state">
            <i class="ti ti-file-text"></i>
            <p>No se encontraron cotizaciones</p>
          </div>
        </td></tr>`;
    } else {
      tbody.innerHTML = data.map(q => {
        const puedeEliminar = esAdmin;
        return `
          <tr>
            <td><span style="font-weight:700">${q.codigo || ('COT-' + String(q.id).padStart(5,'0'))}</span></td>
            <td>
              <div style="font-weight:500;color:var(--texto-fuerte)">${q.cliente_nombre || 'Cliente General'}</div>
              ${q.cliente_doc
                ? `<div style="font-size:11px;color:var(--texto-muted)">${(q.tipo_doc||'').toUpperCase()} ${q.cliente_doc}</div>`
                : ''}
            </td>
            <td style="text-align:center">${q.items_count || 0}</td>
            <td style="font-weight:700;color:var(--success)">S/ ${(+q.total).toFixed(2)}</td>
            <td>${badgeEstado(q.estado_real)}</td>
            <td style="font-size:12px;color:${q.vencida?'var(--warning)':'var(--texto-muted)'}">
              ${fechaLinda(q.vence_at)}</td>
            <td style="font-size:12px;color:var(--texto-muted)">${fechaHoraLinda(q.created_at)}</td>
            <td>
              <div style="display:flex;gap:6px">
                ${q.vencida ? '' : `
                  <button class="btn btn-outline btn-xs" onclick="_ctVerDetalle(${q.id})" title="Ver detalle"><i class="ti ti-eye"></i></button>
                  <button class="btn btn-outline btn-xs" onclick="_ctVerDocumento(${q.id})" title="Ver comprobante PDF" style="color:#0ea5e9;border-color:#0ea5e9"><i class="ti ti-file-type-pdf"></i></button>
                  ${esAdmin && q.estado === 'vigente' ? `<button class="btn btn-warning btn-xs" onclick="_ctEditar(${q.id})" title="Editar"><i class="ti ti-edit"></i></button>` : ''}
                  <button class="btn btn-outline btn-xs" onclick="_ctEnviar(${q.id})" title="Enviar por correo"><i class="ti ti-mail"></i></button>
                  <button class="btn btn-outline btn-xs" onclick="_ctWhatsapp(${q.id})" title="Enviar por WhatsApp" style="color:#25D366;border-color:#25D366"><i class="ti ti-brand-whatsapp"></i></button>`}
                ${puedeEliminar ? `<button class="btn btn-danger btn-xs" onclick="_ctEliminar(${q.id})" title="Eliminar"><i class="ti ti-trash"></i></button>` : ''}
              </div>
            </td>
          </tr>`;
      }).join('');
    }

    // Paginación
    const totalPags = Math.ceil(total / limite) || 1;
    document.getElementById('pag-info').textContent = total
      ? `Mostrando ${inicio + 1} a ${Math.min(inicio + limite, total)} de ${total} registros` : '';

    const btns = document.getElementById('pag-btns');
    btns.innerHTML = '';
    const mk = (html, disabled, fn, active) => {
      const b = document.createElement('button');
      b.className = `page-btn${active ? ' active' : ''}`;
      b.innerHTML = html; b.disabled = disabled; b.onclick = fn;
      btns.appendChild(b);
    };
    mk('<i class="ti ti-chevron-left"></i>', pagina === 1, () => { pagina--; renderTabla(); });
    for (let i = 1; i <= totalPags; i++) mk(i, false, () => { pagina = i; renderTabla(); }, i === pagina);
    mk('<i class="ti ti-chevron-right"></i>', pagina >= totalPags, () => { pagina++; renderTabla(); });
  }

  // ═════════════════════════════════════════════════════════════════════
  //  MODAL NUEVA COTIZACIÓN
  // ═════════════════════════════════════════════════════════════════════
  function abrirNueva() {
    ctEditId = null;
    ctLimpiar();
    document.getElementById('ct-modal-titulo').textContent = 'Nueva Cotización';
    document.getElementById('btn-ct-registrar').innerHTML = '<i class="ti ti-check"></i> Guardar Cotización';
    // Sucursal por defecto: admin → "Bidones" si existe, si no la primera; vendedor → la suya
    if (esGlobal && sucursales.length) {
      const def = sucursales.find(s => /bidon/i.test(s.nombre)) || sucursales[0];
      ctSucursalActiva = def ? def.id : null;
    } else {
      ctSucursalActiva = miSucursal || (sucursales[0] && sucursales[0].id) || null;
    }
    ctCargarProductos();
    // Validez por defecto: 7 días
    const vence = document.getElementById('ct-vence');
    vence.min   = hoy;
    vence.value = masDias(hoy, 7);
    marcarDiasBtn(7);
    document.getElementById('modal-cotizacion').classList.add('open');
  }

  function ctLimpiar() {
    ctItems = [];
    document.getElementById('ct-cli-id').value        = '';
    document.getElementById('ct-cli-tipo-doc').value  = '';
    document.getElementById('ct-doc-buscar').value    = '';
    document.getElementById('ct-doc-buscar').readOnly = false;
    document.getElementById('ct-cli-info').style.display = 'none';
    document.getElementById('ct-cli-resultado').innerHTML = '';
    document.getElementById('ct-observacion').value   = '';
    ctRenderItems();
    ctCalcTotales();
  }

  function marcarDiasBtn(dias) {
    document.querySelectorAll('.ct-dias-btn').forEach(b => {
      b.classList.toggle('active', +b.dataset.dias === +dias);
    });
  }

  // ── CLIENTE ──────────────────────────────────────────────────────────
  async function ctBuscarCliente() {
    const doc  = document.getElementById('ct-doc-buscar').value.trim();
    const res$ = document.getElementById('ct-cli-resultado');

    if (!/^\d+$/.test(doc) || (doc.length !== 8 && doc.length !== 11)) {
      res$.innerHTML = `<span style="color:var(--warning)">Ingresa 8 dígitos (DNI) o 11 (RUC)</span>`;
      return;
    }
    const tipo = doc.length === 11 ? 'ruc' : 'dni';
    res$.innerHTML = `<span style="color:var(--texto-muted)">
      <span class="spinner" style="width:12px;height:12px;border-width:2px"></span> Buscando...</span>`;

    const res = await Http.get(`/clientes/consultar?doc=${doc}&tipo=${tipo}`);
    if (!res?.ok) {
      res$.innerHTML = `<span style="color:var(--danger)"><i class="ti ti-alert-circle"></i> No encontrado</span>`;
      return;
    }

    const c = res.cliente;
    if (res.fuente === 'api' && !c.id) {
      const crear = await Http.post('/clientes', {
        tipo_doc: c.tipo_doc, numero_doc: c.numero_doc,
        nombre: c.nombre, razon_social: c.razon_social || '',
        apellido_paterno: c.apellido_paterno || '', apellido_materno: c.apellido_materno || '',
        direccion: c.direccion || '', distrito: c.distrito || '',
        provincia: c.provincia || '', departamento: c.departamento || '',
        origen_api: 1
      });
      if (crear?.ok) c.id = crear.id;
    }

    const nombreCompleto = c.razon_social
      || [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' ')
      || 'Sin nombre';

    document.getElementById('ct-cli-id').value       = c.id || '';
    document.getElementById('ct-cli-tipo-doc').value = c.tipo_doc || tipo;
    document.getElementById('ct-cli-nombre-label').textContent = nombreCompleto;
    document.getElementById('ct-cli-doc-label').textContent =
      `${(c.tipo_doc || tipo).toUpperCase()} ${c.numero_doc}`;
    document.getElementById('ct-cli-telefono-label').textContent =
      c.telefono ? `Tel: ${c.telefono}` : '';
    document.getElementById('ct-cli-info').style.display = 'block';
    document.getElementById('ct-doc-buscar').readOnly = true;
    res$.innerHTML = `<span style="color:var(--success)"><i class="ti ti-check"></i>
      ${res.fuente === 'bd' ? 'Encontrado en sistema' : 'Registrado automáticamente'}</span>`;
  }

  function ctLimpiarCliente() {
    document.getElementById('ct-cli-id').value       = '';
    document.getElementById('ct-cli-tipo-doc').value = '';
    const inp = document.getElementById('ct-doc-buscar');
    inp.value = ''; inp.readOnly = false;
    document.getElementById('ct-cli-info').style.display = 'none';
    document.getElementById('ct-cli-resultado').innerHTML = '';
  }

  // ── PRECIOS POR VOLUMEN ──────────────────────────────────────────────
  const volCache = {};
  async function ctCargarVolumenes(prodId) {
    if (volCache[prodId]) return volCache[prodId];
    try {
      const r = await Http.get(`/productos/${prodId}/volumenes`);
      volCache[prodId] = (r && r.ok) ? (r.volumenes || []) : [];
    } catch (e) { volCache[prodId] = []; }
    return volCache[prodId];
  }
  // Precio por la cantidad (escalón más alto). No aplica si el precio fue
  // editado a mano (manual) ni a presentaciones.
  function ctPrecioVolumen(item) {
    if (item.manual) return item.precio_unit;
    const base = (item.precio_base != null) ? +item.precio_base : +item.precio_unit;
    if (item.presentacion_id) return base;
    let precio = base;
    (item.volumenes || []).forEach(t => {
      if (item.cantidad >= +t.cantidad_desde) precio = +t.precio_unit;
    });
    return precio;
  }

  // ── SUCURSALES (pestañas dentro del buscador; misma lógica que Ventas) ──
  async function cargarSucursales() {
    const res  = await Http.get('/sucursales');
    sucursales = res?.ok ? (res.sucursales || []) : [];
  }

  // Productos visibles según la sucursal activa (los globales sin sucursal salen siempre)
  function ctProdsSucursal() {
    if (ctSucursalActiva == null) return todosProds;
    return todosProds.filter(p => p.sucursal_id == null || p.sucursal_id === ctSucursalActiva);
  }

  // Pestañas de sucursal DENTRO del buscador (solo admin global)
  function ctRenderTabsProd() {
    const cont = document.getElementById('ct-prod-tabs');
    if (!cont) return;
    if (!esGlobal || !sucursales.length) { cont.style.display = 'none'; return; }
    cont.style.display = 'flex';
    cont.innerHTML = sucursales.map(s =>
      `<button class="suc-tab ${s.id === ctSucursalActiva ? 'active' : ''}" data-suc="${s.id}">${s.nombre}</button>`
    ).join('');
    cont.querySelectorAll('.suc-tab').forEach(b => {
      b.onclick = () => {
        const nueva = +b.dataset.suc;
        if (nueva === ctSucursalActiva) return;
        ctCambiarSucursal(nueva);
      };
    });
  }

  // Cambiar la sucursal del buscador. Si hay productos de otra sucursal en la
  // cotización, se vacían para no mezclar (una cotización = una sucursal).
  async function ctCambiarSucursal(nueva) {
    if (ctItems.length) {
      const conf = await Swal.fire({
        icon: 'warning', title: 'Cambiar de sucursal',
        text: 'Se quitarán los productos ya agregados (una cotización es de una sola sucursal). ¿Continuar?',
        showCancelButton: true, confirmButtonText: 'Sí, cambiar', cancelButtonText: 'Cancelar',
        background: '#1a1a2e', color: '#e0e0e0', confirmButtonColor: '#e53935'
      });
      if (!conf.isConfirmed) { ctRenderTabsProd(); return; }
      ctItems = []; ctRenderItems(); ctCalcTotales();
    }
    ctSucursalActiva = nueva;
    ctRenderTabsProd();
    document.getElementById('ct-prod-buscar-inp').value = '';
    ctRenderProductosModal(ctProdsSucursal());
  }

  // ── PRODUCTOS (sin filtrar por stock: una cotización puede ser a futuro) ──
  async function ctCargarProductos() {
    const res = await Http.get('/productos');
    if (!res?.ok) return;
    todosProds = (res.productos || []).filter(p => p.estado === 0 && (Number(p.es_transferido) !== 1 || Number(p.transferencia_venta_panel ?? p.transferencia_venta_habilitada) === 1));
    ctRenderTabsProd();
    ctRenderProductosModal(ctProdsSucursal());
  }

  function ctRenderProductosModal(lista) {
    const cont = document.getElementById('ct-prod-lista');
    if (!lista.length) {
      cont.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--texto-muted)">
        <i class="ti ti-package" style="font-size:24px;opacity:.3;display:block;margin-bottom:8px"></i>
        Sin productos</div>`;
      return;
    }
    cont.innerHTML = lista.map(p => {
      const img = p.imagen_portada
        ? `<img src="${p.imagen_portada}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0">`
        : `<div style="width:40px;height:40px;background:var(--input-bg);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center"><i class="ti ti-photo" style="color:var(--texto-muted);font-size:14px"></i></div>`;
      const click = p.tiene_presentaciones
        ? `onclick="_ctMostrarPresentaciones(${p.id})"`
        : `onclick="_ctAgregarItem(${p.id},null)"`;
      return `
        <div ${click} style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;
             cursor:pointer;transition:background .15s;background:var(--card-bg);border:1px solid var(--card-border)"
             onmouseover="this.style.background='var(--tabla-hover)'"
             onmouseout="this.style.background='var(--card-bg)'">
          ${img}
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;color:var(--texto-fuerte);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.nombre}</div>
            <div style="font-size:11px;color:var(--texto-muted)">Stock: ${p.stock_actual}</div>
            <div style="font-size:11px;color:var(--texto-muted)">S/ ${parseFloat(p.precio_venta).toFixed(2)}
              ${p.tiene_presentaciones ? `<span style="color:var(--info);margin-left:6px"><i class="ti ti-layers"></i> Con presentaciones</span>` : ''}
            </div>
          </div>
          <i class="ti ti-${p.tiene_presentaciones ? 'chevron-right' : 'plus'}" style="color:var(--rojo);flex-shrink:0"></i>
        </div>`;
    }).join('');
  }

  window._ctMostrarPresentaciones = async function(prodId) {
    const res = await Http.get(`/productos/${prodId}`);
    if (!res?.ok) return;
    const p    = res.producto;
    const pres = (res.presentaciones || []).filter(pr => pr.estado === 0);
    if (!pres.length) { window._ctAgregarItem(prodId, null); return; }

    document.getElementById('ct-pres-modal-titulo').textContent = `Presentaciones — ${p.nombre}`;
    document.getElementById('ct-pres-modal-body').innerHTML = pres.map(pr => `
      <div onclick="_ctAgregarItem(${prodId},${pr.id})"
           style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-radius:8px;
                  cursor:pointer;margin-bottom:8px;border:1px solid var(--card-border);background:var(--card-bg)"
           onmouseover="this.style.background='var(--tabla-hover)'"
           onmouseout="this.style.background='var(--card-bg)'">
        <div>
          <div style="font-weight:600;color:var(--texto-fuerte)">${pr.nombre}</div>
          <div style="font-size:11px;color:var(--texto-muted)">Stock: ${pr.stock || 0}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;color:var(--success);font-size:15px">S/ ${parseFloat(pr.precio_venta).toFixed(2)}</div>
          ${pr.es_principal ? `<span style="font-size:10px;background:rgba(0,200,83,.15);color:var(--success);padding:1px 6px;border-radius:10px">Principal</span>` : ''}
        </div>
      </div>`).join('');
    document.getElementById('modal-ct-presentaciones').classList.add('open');
  };

  window._ctAgregarItem = async function(prodId, presId) {
    let nombre = '', precio = 0, prodBase = todosProds.find(x => x.id === prodId);
    if (prodBase) { nombre = prodBase.nombre; precio = +prodBase.precio_venta; }

    document.getElementById('modal-ct-presentaciones').classList.remove('open');

    const key = `${prodId}_${presId || 'base'}`;
    const existe = ctItems.find(i => i._key === key);
    if (existe) {
      existe.cantidad++;
      existe.precio_unit = ctPrecioVolumen(existe);
      existe.subtotal = existe.cantidad * existe.precio_unit;
    } else {
      const volumenes = presId ? [] : await ctCargarVolumenes(prodId);
      const item = {
        _key: key, producto_id: prodId, presentacion_id: presId || null,
        nombre, precio_base: precio, precio_unit: precio, cantidad: 1,
        subtotal: precio, volumenes, manual: false
      };
      item.precio_unit = ctPrecioVolumen(item);
      item.subtotal = item.cantidad * item.precio_unit;
      ctItems.push(item);
    }
    ctRenderItems();
    ctCalcTotales();
    ctToast(`Agregado: ${nombre}`);
  };

  function ctRenderItems() {
    const empty = document.getElementById('ct-items-empty');
    const wrap  = document.getElementById('ct-items-wrap');
    const tbody = document.getElementById('ct-items-tbody');
    if (!ctItems.length) { empty.style.display = 'block'; wrap.style.display = 'none'; return; }
    empty.style.display = 'none'; wrap.style.display = 'block';

    tbody.innerHTML = ctItems.map((item, idx) => {
      const volAct = (!item.manual && !item.presentacion_id && item.precio_base != null && item.precio_unit < +item.precio_base);
      return `
      <tr>
        <td><div style="font-weight:500;color:var(--texto-fuerte);font-size:12px">${item.nombre}</div>
          ${volAct ? `<div style="font-size:9px;color:var(--info);font-weight:700"><i class="ti ti-discount-2"></i> precio por volumen</div>` : ''}</td>
        <td style="text-align:right">
          <input type="text" value="${item.precio_unit.toFixed(2)}" inputmode="decimal"
                 onchange="_ctPrecio(${idx}, this.value)"
                 style="width:70px;background:var(--input-bg);border:1px solid var(--card-border);
                        border-radius:6px;color:var(--success);padding:3px 6px;font-size:12px;
                        text-align:right;font-weight:600;outline:none">
        </td>
        <td style="text-align:center">
          <div style="display:flex;align-items:center;gap:4px;justify-content:center">
            <button onclick="_ctCantidad(${idx},-1)" style="width:22px;height:22px;border-radius:50%;background:var(--input-bg);border:1px solid var(--card-border);color:var(--texto);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">−</button>
            <input type="text" inputmode="numeric" value="${item.cantidad}"
                   onkeydown="if(['e','E','+','-','.',','].includes(event.key))event.preventDefault()"
                   oninput="this.value=this.value.replace(/[^0-9]/g,'')"
                   onchange="_ctSetCantidad(${idx},this.value)"
                   style="width:46px;font-weight:700;text-align:center;background:var(--card-bg);border:1px solid var(--card-border);border-radius:6px;color:var(--texto);padding:3px 4px;font-size:13px;outline:none">
            <button onclick="_ctCantidad(${idx},1)" style="width:22px;height:22px;border-radius:50%;background:var(--input-bg);border:1px solid var(--card-border);color:var(--texto);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">+</button>
          </div>
        </td>
        <td style="text-align:right;font-weight:600;color:var(--success);font-size:13px">S/ ${item.subtotal.toFixed(2)}</td>
        <td><button class="btn btn-danger btn-xs" onclick="_ctQuitarItem(${idx})"><i class="ti ti-x"></i></button></td>
      </tr>`;
    }).join('');
  }

  window._ctCantidad = function(idx, delta) {
    const item = ctItems[idx];
    const nueva = item.cantidad + delta;
    if (nueva < 1) return;                  // sin tope de stock (es una proforma), pero nunca negativo
    item.cantidad = nueva;
    item.precio_unit = ctPrecioVolumen(item);
    item.subtotal = nueva * item.precio_unit;
    ctRenderItems(); ctCalcTotales();
  };

  // Escribir la cantidad directo (proforma: sin tope de stock, pero nunca < 1)
  window._ctSetCantidad = function(idx, val) {
    const item = ctItems[idx];
    let n = parseInt(val, 10);
    if (isNaN(n) || n < 1) n = 1;
    item.cantidad = n;
    item.precio_unit = ctPrecioVolumen(item);
    item.subtotal = n * item.precio_unit;
    ctRenderItems(); ctCalcTotales();
  };

  window._ctPrecio = function(idx, val) {
    let precio = parseFloat(val);
    if (isNaN(precio) || precio < 0) precio = 0;
    ctItems[idx].precio_unit = precio;
    ctItems[idx].manual      = true;   // precio puesto a mano → manda sobre el volumen
    ctItems[idx].subtotal    = precio * ctItems[idx].cantidad;
    ctRenderItems(); ctCalcTotales();
  };

  window._ctQuitarItem = function(idx) {
    ctItems.splice(idx, 1); ctRenderItems(); ctCalcTotales();
  };

  // ── TOTALES (sin descuento global: total = suma de líneas) ───────────
  function ctCalcTotales() {
    const subtotal = ctItems.reduce((a, i) => a + i.subtotal, 0);
    document.getElementById('ct-subtotal-label').textContent = `S/ ${subtotal.toFixed(2)}`;
    document.getElementById('ct-total-label').textContent    = `S/ ${subtotal.toFixed(2)}`;
  }

  // ── GUARDAR ──────────────────────────────────────────────────────────
  async function ctRegistrar() {
    if (!ctItems.length) return alerta('error', 'Sin productos', 'Agrega al menos un producto');
    for (const it of ctItems) {
      if (it.precio_unit <= 0 || it.cantidad <= 0)
        return alerta('error', 'Datos inválidos', 'Precios y cantidades deben ser mayores a 0');
    }

    const vence = document.getElementById('ct-vence').value;
    if (!vence) return alerta('error', 'Falta vencimiento', 'Indica hasta qué fecha es válida la cotización');
    if (vence < hoy) return alerta('error', 'Fecha inválida', 'El vencimiento no puede ser anterior a hoy');

    const body = {
      cliente_id: document.getElementById('ct-cli-id').value
        ? +document.getElementById('ct-cli-id').value : null,
      items: ctItems.map(i => ({
        producto_id: i.producto_id, presentacion_id: i.presentacion_id || null,
        cantidad: i.cantidad, precio_unit: i.precio_unit
      })),
      observacion: document.getElementById('ct-observacion').value.trim(),
      vence_at: vence,
      // La pestaña activa del buscador define la sucursal de la cotización.
      sucursal_id: ctSucursalActiva ? Number(ctSucursalActiva) : null
    };

    const btn = document.getElementById('btn-ct-registrar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Guardando...';

    const res = ctEditId
      ? await Http.put(`/cotizaciones/${ctEditId}`, body)
      : await Http.post('/cotizaciones', body);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Guardar Cotización';

    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'Error al guardar');

    document.getElementById('modal-cotizacion').classList.remove('open');
    alerta('success', ctEditId ? '¡Cotización actualizada!' : '¡Cotización guardada!', `N° #${String(res.id).padStart(4,'0')}`, 1600);
    ctEditId = null;
    await cargar();
  }

  window._ctEditar = async function(id) {
    const res = await Http.get(`/cotizaciones/${id}`);
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo cargar');
    const q = res.cotizacion;
    if (q.vencida || q.estado !== 'vigente') return alerta('warning', 'No editable', 'Solo se editan cotizaciones activas y vigentes');
    ctEditId = id;
    ctLimpiar();
    ctSucursalActiva = Number(q.sucursal_id) || miSucursal || null;
    await ctCargarProductos();
    ctItems = (res.items || []).map(it => ({
      _key: `${it.producto_id}_${it.presentacion_id || 'base'}`,
      producto_id: Number(it.producto_id), presentacion_id: it.presentacion_id ? Number(it.presentacion_id) : null,
      nombre: it.producto_nombre + (it.presentacion_nombre ? ` (${it.presentacion_nombre})` : ''),
      precio_base: Number(it.precio_unit), precio_unit: Number(it.precio_unit),
      cantidad: Number(it.cantidad), subtotal: Number(it.subtotal), volumenes: [], manual: true
    }));
    document.getElementById('ct-cli-id').value = q.cliente_id || '';
    document.getElementById('ct-doc-buscar').value = q.numero_doc || '';
    if (q.cliente_id) {
      document.getElementById('ct-cli-nombre-label').textContent = q.cliente_nombre || 'Cliente';
      document.getElementById('ct-cli-doc-label').textContent = `${(q.tipo_doc || '').toUpperCase()} ${q.numero_doc || ''}`;
      document.getElementById('ct-cli-info').style.display = 'block';
      document.getElementById('ct-doc-buscar').readOnly = true;
    }
    document.getElementById('ct-observacion').value = q.observacion || '';
    document.getElementById('ct-vence').min = hoy;
    document.getElementById('ct-vence').value = String(q.vence_at || '').slice(0,10);
    document.getElementById('ct-modal-titulo').textContent = `Editar ${q.codigo || 'Cotización'}`;
    document.getElementById('btn-ct-registrar').innerHTML = '<i class="ti ti-check"></i> Actualizar Cotización';
    ctRenderItems(); ctCalcTotales();
    document.getElementById('modal-cotizacion').classList.add('open');
  };

  // ── VER DETALLE ──────────────────────────────────────────────────────
  window._ctVerDetalle = async function(id) {
    const res = await Http.get(`/cotizaciones/${id}`);
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo cargar');
    const q     = res.cotizacion;
    const items = res.items || [];
    if (q.vencida) return alerta('warning', 'Cotización vencida', 'Una cotización vencida solo puede eliminarse');

    document.getElementById('ct-detalle-titulo').textContent = q.codigo || `Cotización #${String(q.id).padStart(4,'0')}`;
    document.getElementById('ct-detalle-body').innerHTML = `
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <div>
          <div style="font-size:11px;color:var(--texto-muted)">Cliente</div>
          <div style="font-weight:600;color:var(--texto-fuerte)">${q.cliente_nombre || 'Cliente General'}</div>
          ${q.numero_doc ? `<div style="font-size:12px;color:var(--texto-muted)">${(q.tipo_doc||'').toUpperCase()} ${q.numero_doc}</div>` : ''}
        </div>
        <div style="text-align:right">
          ${badgeEstado(q.estado_real)}
          <div style="font-size:12px;color:var(--texto-muted);margin-top:6px">Emitida: ${fechaHoraLinda(q.created_at)}</div>
          <div style="font-size:12px;color:${q.vencida?'var(--warning)':'var(--texto-muted)'}">Vence: ${fechaLinda(q.vence_at)}</div>
        </div>
      </div>
      <div class="tabla-container" style="margin:0">
        <table class="tabla" style="font-size:13px">
          <thead><tr>
            <th>Producto</th>
            <th style="text-align:right">P. Unit</th>
            <th style="text-align:center">Cant.</th>
            <th style="text-align:right">Subtotal</th>
          </tr></thead>
          <tbody>
            ${items.map(it => `
              <tr>
                <td>${it.producto_nombre}${it.presentacion_nombre ? ` <span style="font-size:11px;color:var(--texto-muted)">(${it.presentacion_nombre})</span>` : ''}</td>
                <td style="text-align:right">S/ ${(+it.precio_unit).toFixed(2)}</td>
                <td style="text-align:center">${it.cantidad}</td>
                <td style="text-align:right;font-weight:600;color:var(--success)">S/ ${(+it.subtotal).toFixed(2)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:5px;font-size:13px;max-width:260px;margin-left:auto">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--texto-muted)">Subtotal</span><span>S/ ${(+q.subtotal).toFixed(2)}</span></div>
        ${(+q.descuento) > 0 ? `<div style="display:flex;justify-content:space-between"><span style="color:var(--texto-muted)">Descuento</span><span>− S/ ${(+q.descuento).toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;border-top:1px solid var(--card-border);padding-top:6px">
          <span style="font-weight:700">TOTAL</span>
          <span style="font-weight:700;color:var(--success);font-size:16px">S/ ${(+q.total).toFixed(2)}</span>
        </div>
      </div>
      ${q.observacion ? `<div style="margin-top:14px;font-size:12px;color:var(--texto-muted)"><b>Observación:</b> ${q.observacion}</div>` : ''}
    `;
    document.getElementById('modal-ct-detalle').classList.add('open');
  };

  // ── ENVIAR POR CORREO (proforma a Gmail) ─────────────────────────────
  window._ctEnviar = async function(id) {
    // Prellenar con el correo del cliente si lo tiene
    let prefill = '';
    try {
      const r = await Http.get(`/cotizaciones/${id}`);
      if (r?.cotizacion?.vencida) return alerta('warning', 'Cotización vencida', 'Una cotización vencida solo puede eliminarse');
      prefill = r?.cotizacion?.cliente_email || '';
    } catch (e) {}

    const { value: email } = await Swal.fire({
      title: 'Enviar cotización por correo',
      input: 'email',
      inputValue: prefill,
      inputPlaceholder: 'correo@ejemplo.com',
      showCancelButton: true,
      confirmButtonText: '<i class="ti ti-mail"></i> Enviar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#e53935',
      background: '#1a1a2e', color: '#e0e0e0',
      inputValidator: (v) =>
        (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) ? 'Ingresa un correo válido' : undefined
    });
    if (!email) return;

    Swal.fire({
      title: 'Enviando...', allowOutsideClick: false,
      background: '#1a1a2e', color: '#e0e0e0',
      didOpen: () => Swal.showLoading()
    });

    const res = await Http.post(`/cotizaciones/${id}/enviar`, { email });
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo enviar');
    alerta('success', 'Correo enviado', res.msg || '', 1800);
  };


  window._ctVerDocumento = async function(id) {
    const pdf = await Http.get(`/cotizaciones/${id}/pdf?formato=a4`);
    if (!pdf?.ok || !pdf.url) return alerta('error','Documento no disponible',pdf?.msg || 'No se pudo generar el PDF');
    window.open(pdf.url,'_blank','noopener');
  };

  // ── ENVIAR POR WHATSAPP (resumen de la proforma) ─────────────────────
  window._ctWhatsapp = async function(id) {
    const res = await Http.get(`/cotizaciones/${id}`);
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo cargar la cotización');
    const q     = res.cotizacion;
    const items = res.items || [];
    if (q.vencida) return alerta('warning', 'Cotización vencida', 'Una cotización vencida solo puede eliminarse');

    // Teléfono: el de la cotización/cliente o se pide
    let tel = String(q.cliente_telefono || q.telefono || '').replace(/\D/g, '');
    if (!tel) {
      const r = await Swal.fire({
        title: 'Número de WhatsApp', input: 'text',
        inputPlaceholder: 'Ej. 987654321', inputAttributes: { inputmode: 'numeric' },
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#25D366', showCancelButton: true, confirmButtonText: 'Enviar'
      });
      if (!r.value) return;
      tel = String(r.value).replace(/\D/g, '');
    }
    if (tel.length < 9) return alerta('warning', 'Teléfono inválido', 'Ingresa un número de 9 dígitos');

    const codigo = q.codigo || ('COT-' + String(q.id).padStart(5, '0'));
    const vence  = fechaLinda(q.vence_at);
    const lineas = items.map(it =>
      `• ${it.cantidad} x ${it.producto_nombre}${it.presentacion_nombre ? ` (${it.presentacion_nombre})` : ''} — S/ ${(+it.subtotal).toFixed(2)}`
    ).join('\n');

    // Generar el PDF y obtener su enlace público (funciona en localhost y en tu dominio)
    let linkPdf = '';
    try {
      const p = await Http.get(`/cotizaciones/${id}/pdf`);
      if (p?.ok && p.url) linkPdf = `\n\n📄 Ver cotización en PDF:\n${p.url}`;
    } catch (e) {}

    const mensaje =
`*COTIZACIÓN ${codigo}*
Cliente: ${q.cliente_nombre || 'Cliente General'}

${lineas}

*TOTAL: S/ ${(+q.total).toFixed(2)}*
Válida hasta: ${vence}${linkPdf}

Gracias por su preferencia.`;

    window.open(`https://wa.me/51${tel}?text=${encodeURIComponent(mensaje)}`, '_blank');
  };

  // ── ELIMINAR (borrado lógico; el backend valida admin + no convertida) ──
  window._ctEliminar = async function(id) {
    const conf = await Swal.fire({
      title: '¿Eliminar cotización?',
      text: 'Esta acción no se puede deshacer',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#e53935', background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;

    const res = await Http.delete(`/cotizaciones/${id}`);
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo eliminar');
    alerta('success', 'Cotización eliminada', '', 1400);
    await cargar();
  };

  // ── EVENTOS ──────────────────────────────────────────────────────────
  document.getElementById('btn-nueva-cotizacion').addEventListener('click', abrirNueva);
  document.getElementById('btn-cerrar-cotizacion').addEventListener('click',
    () => document.getElementById('modal-cotizacion').classList.remove('open'));
  document.getElementById('btn-ct-registrar').addEventListener('click', ctRegistrar);

  document.getElementById('btn-ct-buscar-cli').addEventListener('click', ctBuscarCliente);
  document.getElementById('ct-doc-buscar').addEventListener('keydown', e => { if (e.key === 'Enter') ctBuscarCliente(); });
  document.getElementById('ct-doc-buscar').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); });
  document.getElementById('btn-ct-limpiar-cli').addEventListener('click', ctLimpiarCliente);

  // Buscar producto
  document.getElementById('btn-ct-agregar-prod').addEventListener('click', () => {
    document.getElementById('ct-prod-buscar-inp').value = '';
    ctRenderTabsProd();
    ctRenderProductosModal(ctProdsSucursal());
    document.getElementById('modal-ct-prod-buscar').classList.add('open');
  });
  document.getElementById('btn-cerrar-ct-prod-buscar').addEventListener('click',
    () => document.getElementById('modal-ct-prod-buscar').classList.remove('open'));
  document.getElementById('ct-prod-buscar-inp').addEventListener('input', e => {
    const s = e.target.value.toLowerCase();
    ctRenderProductosModal(ctProdsSucursal().filter(p =>
      p.nombre.toLowerCase().includes(s)));
  });
  document.getElementById('btn-cerrar-ct-presentaciones').addEventListener('click',
    () => document.getElementById('modal-ct-presentaciones').classList.remove('open'));
  document.getElementById('btn-cerrar-ct-detalle').addEventListener('click',
    () => document.getElementById('modal-ct-detalle').classList.remove('open'));

  // Validez (botones de días)
  document.querySelectorAll('.ct-dias-btn').forEach(b => {
    b.addEventListener('click', () => {
      const d = +b.dataset.dias;
      document.getElementById('ct-vence').value = masDias(hoy, d);
      marcarDiasBtn(d);
    });
  });
  document.getElementById('ct-vence').addEventListener('change', () => marcarDiasBtn(-1));

  // Filtros / búsqueda / paginación
  document.getElementById('btn-filtrar').addEventListener('click', () => { pagina = 1; cargar(); });
  document.getElementById('inp-buscar').addEventListener('input', e => { buscar = e.target.value; pagina = 1; renderTabla(); });
  document.getElementById('sel-limite').addEventListener('change', e => { limite = +e.target.value; pagina = 1; renderTabla(); });

  // Cerrar modales al hacer clic fuera
  ['modal-cotizacion','modal-ct-prod-buscar','modal-ct-presentaciones','modal-ct-detalle'].forEach(mid => {
    document.getElementById(mid).addEventListener('click', e => {
      if (e.target.id === mid) e.target.classList.remove('open');
    });
  });

  // Saber si el usuario es Administrador (para mostrar/ocultar "Eliminar")
  try {
    const s   = await Http.get('/auth/session');
    const usr = s?.usuario || s?.user || s?.data || s;
    if (usr && typeof usr.perfil_nombre === 'string')
      esAdmin = (usr.perfil_nombre === 'Administrador');
    if (usr) esGlobal   = !!usr.es_global;
    if (usr) miSucursal = usr.sucursal_id || null;
  } catch (e) { /* si falla, el backend es el candado real */ }

  const filDesde = document.getElementById('fil-desde');
  const filHasta = document.getElementById('fil-hasta');
  filDesde.value = hoy; filHasta.value = hoy;
  filDesde.max = hoy; filHasta.max = hoy;

  await cargarSucursales();
  await cargar();
};