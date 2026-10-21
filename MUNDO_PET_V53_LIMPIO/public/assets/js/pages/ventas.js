window.init_ventas = async function () {

  // Ventas SIEMPRE está disponible. La caja física (efectivo) solo se valida
  // al momento de guardar la venta y únicamente si hay pago en efectivo.
  const html = await fetch('/views/pages/ventas.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  // Estilos inline
  const style = document.createElement('style');
  style.textContent = `
    .nv-card { background: var(--card-bg); border: 1px solid var(--card-border);
               border-radius: 10px; padding: 14px 16px; }
    .nv-card-title { font-size: 11px; font-weight: 700; color: var(--texto-muted);
                     text-transform: uppercase; letter-spacing: .5px;
                     margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }
    .metodo-pago-card { background: var(--input-bg); border: 1px solid var(--card-border);
                        border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
    .metodo-pago-card .metodo-label { font-size: 11px; color: var(--texto-muted);
                        margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
    .metodo-btn { border: 1.5px solid var(--card-border); background: var(--card-bg);
                  border-radius: 7px; padding: 5px 10px; font-size: 11px;
                  color: var(--texto-muted); cursor: pointer; transition: all .15s; }
    .metodo-btn.active { border-color: var(--rojo); color: var(--rojo);
                         background: rgba(229,57,53,.08); }
    .comp-card { border: 2px solid var(--card-border); border-radius: 12px; padding: 20px;
                 text-align: center; cursor: pointer; transition: all .2s; background: var(--card-bg); }
    .comp-card:hover { border-color: var(--rojo); transform: translateY(-2px); }
    .comp-card.sel { border-color: var(--rojo); background: rgba(229,57,53,.06); }
    .sunat-file-btn { display:flex; align-items:center; gap:10px; width:100%;
                      padding:11px 14px; border:1px solid var(--card-border);
                      border-radius:9px; background:var(--card-bg); color:var(--texto);
                      cursor:pointer; transition:all .15s; font-size:13px; text-align:left; }
    .sunat-file-btn:hover { border-color:var(--rojo); background:var(--input-bg); }
    .sunat-file-btn i:first-child { font-size:20px; flex-shrink:0; }
    .sunat-file-btn .sf-txt { flex:1; }
    .sunat-file-btn .sf-sub { font-size:11px; color:var(--texto-muted); }
    /* Timeline historial */
    .tl { position:relative; padding-left:28px; }
    .tl::before { content:''; position:absolute; left:9px; top:4px; bottom:4px;
                  width:2px; background:var(--card-border); }
    .tl-item { position:relative; padding-bottom:18px; }
    .tl-item:last-child { padding-bottom:0; }
    .tl-dot { position:absolute; left:-24px; top:1px; width:20px; height:20px;
              border-radius:50%; display:flex; align-items:center; justify-content:center;
              font-size:11px; color:#fff; }
    .tl-tit { font-weight:600; color:var(--texto-fuerte); font-size:13px; }
    .tl-det { font-size:12px; color:var(--texto-muted); margin-top:2px; }
    .tl-fec { font-size:11px; color:var(--texto-muted); margin-top:3px; opacity:.8; }
    .suc-tab{background:none;border:none;border-bottom:2px solid transparent;
             padding:9px 16px;font-size:14px;color:var(--texto-muted);cursor:pointer}
    .suc-tab.active{color:var(--rojo);border-bottom-color:var(--rojo);font-weight:600}
  `;
  document.head.appendChild(style);

  // ── ESTADO ──────────────────────────────────────────────────────────
  let ventas     = [];
  let todosProds = [];
  let nvItems    = [];
  let nvPagos    = [];
  let nvCotizacionId = null;   // cotización cargada en la venta actual (badge CANJE)
  let pagina     = 1;
  let limite     = 10;
  let buscar     = '';
  let empresaCfg = {};   // datos de la empresa para impresión de notas
  let esAdmin    = true;  // se ajusta al cargar; el backend es el candado real
  let sucursales = [];
  let sucActiva  = null;  // null = todas (pestañas, solo admin global)
  let esGlobal   = !!window._esGlobal;
  let nvSucursalVenta = null;  // sucursal a la que pertenece la venta en curso
  let miSucursal = null;       // sucursal del vendedor (para default no-admin)
  let cajaSucursalId = null;   // la caja física fija la sucursal de cualquier cobro en efectivo
  let cajaSucursalNombre = '';

  const METODOS_INFO = {
    efectivo:     { icon: 'ti-cash',            label: 'Efectivo',     color: '#4caf50' },
    yape:         { icon: 'ti-brand-whatsapp',  label: 'Yape',         color: '#7b1fa2' },
    plin:         { icon: 'ti-device-mobile',   label: 'Plin',         color: '#00acc1' },
    transferencia:{ icon: 'ti-building-bank',   label: 'Transferencia',color: '#f57c00' },
    izipay:       { icon: 'ti-credit-card',     label: 'POS Izipay',   color: '#1976d2' },
  };
  const METODOS = Object.keys(METODOS_INFO);

  const alerta = (icon, title, text, timer) => Swal.fire({
    icon, title, text,
    background: '#1a1a2e', color: '#e0e0e0',
    confirmButtonColor: '#e53935',
    timer: timer || undefined,
    showConfirmButton: !timer
  });

  // Toast flotante (no bloquea ni cierra el modal de productos)
  function nvToast(msg) {
    let t = document.getElementById('nv-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'nv-toast';
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

  // ── FECHA DE PERÚ (sin depender de la zona horaria del navegador) ────
  // Devuelve 'YYYY-MM-DD' del día actual en Lima.
  function hoyPeru() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }
  const hoy = hoyPeru();

  // ── CARGAR CONFIG DE EMPRESA (para impresión de notas) ───────────────
  async function cargarEmpresa() {
    try {
      const r = await Http.get('/config');
      // El endpoint puede devolver distintas formas; las cubrimos todas.
      let datos = {};
      if (Array.isArray(r?.config)) {
        r.config.forEach(c => { if (c?.clave) datos[c.clave] = c.valor; });
      } else if (r?.config && typeof r.config === 'object') {
        datos = r.config;
      } else if (r && typeof r === 'object') {
        datos = r;
      }
      empresaCfg = {
        nombre:    datos.empresa_nombre    || 'DISTRIBUCIONES MAOZ E.I.R.L.',
        ruc:       datos.empresa_ruc       || '',
        direccion: datos.empresa_direccion || '',
        telefono:  datos.empresa_telefono  || '',
        logo:      ''
      };
      // Logo activo (si existe) desde el módulo de logos
      try {
        const lg = await fetch('/api/publico/logo').then(r => r.json());
        if (lg?.ok && lg.ruta) empresaCfg.logo = lg.ruta;
      } catch (e) {}
    } catch (e) {
      empresaCfg = { nombre: 'DISTRIBUCIONES MAOZ E.I.R.L.', ruc: '', direccion: '', telefono: '', logo: '' };
    }
  }

  // ── VALIDACIÓN NUMÉRICA (solo números positivos, sin caracteres raros) ─
  // Bloquea e, E, +, - en inputs numéricos.
  function bloquearTeclasNum(e) {
    if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
  }
  // Limpia el valor dejando solo dígitos y un punto decimal.
  function sanearNumero(el) {
    let v = el.value.replace(/[^0-9.]/g, '');
    const partes = v.split('.');
    if (partes.length > 2) v = partes[0] + '.' + partes.slice(1).join('');
    el.value = v;
  }

  // ── FILTROS DE FECHA: "Hasta" nunca futura, "Desde" tampoco ──────────
  const filDesde = document.getElementById('fil-desde');
  const filHasta = document.getElementById('fil-hasta');
  filDesde.value = hoy;
  filHasta.value = hoy;
  filDesde.max   = hoy;   // el calendario nativo no deja elegir días futuros
  filHasta.max   = hoy;

  // Si intenta escribir/pegar una fecha futura desde el teclado → se revierte
  function limitarFutura(el) {
    el.addEventListener('input',  () => { if (el.value && el.value > hoy) el.value = hoy; });
    el.addEventListener('change', () => { if (el.value && el.value > hoy) el.value = hoy; });
  }
  limitarFutura(filDesde);
  limitarFutura(filHasta);

  // ── CARGAR VENTAS ────────────────────────────────────────────────────
  // ── SUCURSALES (pestañas + selector del modal) ───────────────────────
  async function cargarSucursales() {
    const res  = await Http.get('/sucursales');
    sucursales = res?.ok ? (res.sucursales || []) : [];

    if (esGlobal && sucursales.length) renderTabsSuc();
  }

  function renderTabsSuc() {
    const cont = document.getElementById('ventas-tabs');
    if (!cont) return;
    cont.style.display = 'flex';
    const tab = (val, lbl) =>
      `<button class="suc-tab ${val === sucActiva ? 'active' : ''}" data-suc="${val ?? ''}">${lbl}</button>`;
    cont.innerHTML = tab(null, 'Todas') + sucursales.map(s => tab(s.id, s.nombre)).join('');
    cont.querySelectorAll('.suc-tab').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.suc;
        sucActiva = v === '' ? null : +v;
        pagina = 1;
        renderTabsSuc();
        renderTabla();
      };
    });
  }

  async function cargar() {
    let desde = filDesde.value;
    let hasta = filHasta.value;

    if (hasta && hasta > hoy) { filHasta.value = hoy; hasta = hoy; }
    if (desde && desde > hoy) { filDesde.value = hoy; desde = hoy; }
    if (desde && hasta && desde > hasta) {
      alerta('warning', 'Fechas inválidas',
        'La fecha "Desde" no puede ser mayor que "Hasta".');
      return;
    }

    const tipo = document.getElementById('fil-tipo').value;
    let url = `/ventas?desde=${desde}&hasta=${hasta}`;
    if (tipo)   url += `&tipo=${tipo}`;
    if (buscar) url += `&buscar=${encodeURIComponent(buscar)}`;
    const res = await Http.get(url);
    if (!res?.ok) return;
    ventas = res.ventas;
    renderStats();
    renderTabla();
  }

  function renderStats() {
    const activas  = ventas.filter(v => v.estado_venta !== 'anulada');
    const deHoy    = activas.filter(v => (v.created_at || '').startsWith(hoy));
    const totalHoy = deHoy.reduce((a, v) => a + +v.total, 0);
    const emitidas = activas.filter(v => v.estado_sunat === 'aceptado').length;
    const total    = activas.reduce((a, v) => a + +v.total, 0);
    document.getElementById('stats-ventas').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon red"><i class="ti ti-shopping-cart"></i></div>
        <div class="stat-info"><div class="stat-value">${deHoy.length}</div>
          <div class="stat-label">Ventas hoy</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="ti ti-cash"></i></div>
        <div class="stat-info"><div class="stat-value">S/ ${totalHoy.toFixed(2)}</div>
          <div class="stat-label">Total hoy</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber"><i class="ti ti-file-invoice"></i></div>
        <div class="stat-info"><div class="stat-value">${emitidas}</div>
          <div class="stat-label">Comprobantes SUNAT</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue"><i class="ti ti-report-money"></i></div>
        <div class="stat-info"><div class="stat-value">S/ ${total.toFixed(2)}</div>
          <div class="stat-label">Total período</div></div>
      </div>`;
  }

  function renderTabla() {
    const filtrados = ventas.filter(v => {
      if (sucActiva != null && v.sucursal_id !== sucActiva) return false;
      const q = buscar.toLowerCase();
      return (
        v.numero?.toLowerCase().includes(q) ||
        (v.cliente_nombre || '').toLowerCase().includes(q) ||
        (v.cliente_doc || '').includes(q)
      );
    });

    const total  = filtrados.length;
    const inicio = (pagina - 1) * limite;
    const data   = filtrados.slice(inicio, inicio + limite);
    const tbody  = document.getElementById('tbody-ventas');

    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="9">
        <div class="empty-state"><i class="ti ti-shopping-cart"></i>
          <p>No se encontraron ventas</p></div></td></tr>`;
    } else {
      tbody.innerHTML = data.map(v => {
        const anulada = v.estado_venta === 'anulada';
        const esNota  = ['nota','nota_venta'].includes(v.tipo_comprobante);
        const aceptadoS  = v.estado_sunat === 'aceptado';
        const pendienteS = v.estado_sunat === 'emitido';     // generado, pendiente de SUNAT
        const rechazadoS = v.estado_sunat === 'rechazado';
        const emitido    = aceptadoS || pendienteS || rechazadoS;  // ya tiene comprobante

        // Fecha: el backend ya manda hora de Perú como texto ISO-local
        const fecha = new Date(v.created_at).toLocaleString('es-PE', {
          day:'2-digit', month:'2-digit', year:'numeric',
          hour:'2-digit', minute:'2-digit'
        });

        const badgeComp = {
          nota:    `<span class="badge badge-muted" style="font-size:10px">NV</span>`,
          nota_venta: `<span class="badge badge-muted" style="font-size:10px">NV</span>`,
          boleta:  `<span class="badge badge-info" style="font-size:10px">Boleta</span>`,
          factura: `<span class="badge badge-warning" style="font-size:10px">Factura</span>`,
        }[v.tipo_comprobante] || '-';

        const badgeSunat = {
          sin_emitir: `<span class="badge badge-muted" style="font-size:10px">Sin emitir</span>`,
          emitido:    `<span class="badge badge-warning" style="font-size:10px">⏳ Pendiente SUNAT</span>`,
          aceptado:   `<span class="badge badge-success" style="font-size:10px">✓ Aceptado</span>`,
          rechazado:  `<span class="badge badge-danger" style="font-size:10px">✕ Rechazado</span>`,
        }[v.estado_sunat] || '-';

        // Una venta anulada queda sin acciones: no se abre, imprime ni reenvía.
        let acciones = '';

        if (!anulada) {
          acciones += `
            <button class="btn btn-info btn-xs" onclick="_vVerDetalle(${v.id})"
                    title="Ver detalle"
                    style="background:rgba(0,176,255,.15);color:var(--info);border:none">
              <i class="ti ti-eye"></i>
            </button>`;
          if (esNota) {
            acciones += `
              <button class="btn btn-outline btn-xs" onclick="_vVerDocumento(${v.id})"
                      title="Ver comprobante PDF" style="color:#0ea5e9;border-color:#0ea5e9">
                <i class="ti ti-file-type-pdf"></i>
              </button>`;
          }
          // Imprimir (chooser A4/Ticket)
          acciones += `
            <button class="btn btn-outline btn-xs" onclick="_vAbrirImprimir(${v.id})"
                    title="Imprimir">
              <i class="ti ti-printer"></i>
            </button>`;

          // Correo
          acciones += `
            <button class="btn btn-outline btn-xs" onclick="_vCorreo(${v.id})"
                    title="Enviar por correo"
                    style="color:var(--success);border-color:var(--success)">
              <i class="ti ti-mail"></i>
            </button>`;

          // WhatsApp
          acciones += `
            <button class="btn btn-outline btn-xs" onclick="_vWhatsapp(${v.id})"
                    title="Enviar por WhatsApp"
                    style="color:#25D366;border-color:#25D366">
              <i class="ti ti-brand-whatsapp"></i>
            </button>`;

          if (esNota && !emitido) {
            acciones += `
              <button class="btn btn-warning btn-xs" onclick="_vEmitir(${v.id})"
                      title="Emitir boleta/factura" style="color:#000">
                <i class="ti ti-file-invoice"></i>
              </button>`;
            if (esAdmin) acciones += `
              <button class="btn btn-danger btn-xs"
                      onclick="_vEliminar(${v.id},'${v.numero}')"
                      title="Eliminar nota de venta">
                <i class="ti ti-trash"></i>
              </button>`;
          }

          // RECHAZADO → permitir corregir y reemitir
          if (rechazadoS) {
            acciones += `
              <button class="btn btn-warning btn-xs" onclick="_vEmitir(${v.id})"
                      title="Corregir y reemitir" style="color:#000">
                <i class="ti ti-refresh"></i>
              </button>`;
          }

          // PENDIENTE → reintentar envío a SUNAT
          if (pendienteS) {
            acciones += `
              <button class="btn btn-xs" onclick="_vReintentar(${v.id})"
                      title="Reintentar envío a SUNAT"
                      style="background:rgba(255,160,0,.18);color:#ffa000;border:none">
                <i class="ti ti-cloud-upload"></i>
              </button>`;
          }

          // Con comprobante (pendiente/aceptado) → ver comprobante
          if (esNota || aceptadoS || pendienteS) {
            acciones += `
              <button class="btn btn-xs" onclick="_vVerComprobante(${v.id})"
                      title="Ver comprobante"
                      style="background:rgba(0,176,255,.15);color:var(--info);border:none">
                <i class="ti ti-file-search"></i>
              </button>`;
          }

          // Cualquier comprobante (incluido rechazado) → archivos SUNAT
          if (emitido) {
            acciones += `
              <button class="btn btn-xs" onclick="_vArchivosSunat(${v.id})"
                      title="Archivos SUNAT"
                      style="background:rgba(0,200,83,.15);color:var(--success);border:none">
                <i class="ti ti-folder"></i>
              </button>`;
          }

          // Historial: siempre disponible
          acciones += `
            <button class="btn btn-xs" onclick="_vHistorial(${v.id})"
                    title="Historial de la venta"
                    style="background:rgba(123,31,162,.15);color:#b388ff;border:none">
              <i class="ti ti-history"></i>
            </button>`;
        }

        return `
          <tr style="${anulada ? 'opacity:.45' : ''}">
            <td><div style="font-weight:600;color:var(--info);font-size:13px">${v.numero}</div>
              ${v.cotizacion_id
                ? `<span style="font-size:9px;font-weight:700;background:rgba(123,31,162,.18);color:#b388ff;padding:1px 6px;border-radius:8px;letter-spacing:.5px">CANJE</span>`
                : ''}
            </td>
            <td>
              <div style="font-weight:500;max-width:160px;overflow:hidden;
                          text-overflow:ellipsis;white-space:nowrap">
                ${v.cliente_nombre || 'Cliente General'}
              </div>
              ${v.cliente_doc
                ? `<div style="font-size:11px;color:var(--texto-muted)">${v.cliente_doc}</div>`
                : ''}
            </td>
            <td>${badgeComp}</td>
            <td style="font-weight:700;color:var(--success)">S/ ${parseFloat(v.total).toFixed(2)}</td>
            <td><span class="badge badge-success" style="font-size:10px">Contado</span></td>
            <td>${anulada
              ? `<span class="badge badge-danger" style="font-size:10px">Anulada</span>`
              : badgeSunat}</td>
            <td style="font-size:12px;color:var(--texto-muted)">${v.vendedor_nombre || '-'}
              ${esGlobal && v.sucursal_nombre ? `<div style="font-size:10px;color:var(--info)"><i class="ti ti-building-store"></i> ${v.sucursal_nombre}</div>` : ''}
            </td>
            <td style="font-size:11px;color:var(--texto-muted);white-space:nowrap">${fecha}</td>
            <td><div style="display:flex;gap:4px;flex-wrap:wrap">${acciones}</div></td>
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

  // ── NUEVA VENTA — CLIENTE ────────────────────────────────────────────
  async function nvBuscarCliente() {
    const doc  = document.getElementById('nv-doc-buscar').value.trim();
    const res$ = document.getElementById('nv-cli-resultado');

    if (!/^\d+$/.test(doc) || (doc.length !== 8 && doc.length !== 11)) {
      res$.innerHTML = `<span style="color:var(--warning)">
        Ingresa 8 dígitos (DNI) o 11 (RUC)</span>`;
      return;
    }

    const tipo = doc.length === 11 ? 'ruc' : 'dni';
    res$.innerHTML = `<span style="color:var(--texto-muted)">
      <span class="spinner" style="width:12px;height:12px;border-width:2px"></span>
      Buscando...</span>`;

    const res = await Http.get(`/clientes/consultar?doc=${doc}&tipo=${tipo}`);
    if (!res?.ok) {
      res$.innerHTML = `<span style="color:var(--danger)">
        <i class="ti ti-alert-circle"></i> No encontrado</span>`;
      return;
    }

    const c = res.cliente;
    if (res.fuente === 'api' && !c.id) {
      const crear = await Http.post('/clientes', {
        tipo_doc: c.tipo_doc, numero_doc: c.numero_doc,
        nombre: c.nombre, razon_social: c.razon_social || '',
        apellido_paterno: c.apellido_paterno || '',
        apellido_materno: c.apellido_materno || '',
        direccion: c.direccion || '', distrito: c.distrito || '',
        provincia: c.provincia || '', departamento: c.departamento || '',
        origen_api: 1
      });
      if (crear?.ok) c.id = crear.id;
    }

    const nombreCompleto = c.razon_social
      || [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' ')
      || 'Sin nombre';

    document.getElementById('nv-cli-id').value       = c.id || '';
    document.getElementById('nv-cli-tipo-doc').value = c.tipo_doc || tipo;
    document.getElementById('nv-cli-nombre-label').textContent = nombreCompleto;
    document.getElementById('nv-cli-doc-label').textContent =
      `${(c.tipo_doc || tipo).toUpperCase()} ${c.numero_doc}`;
    document.getElementById('nv-cli-telefono-label').textContent =
      c.telefono ? `Tel: ${c.telefono}` : '';
    document.getElementById('nv-cli-info').style.display = 'block';
    document.getElementById('nv-doc-buscar').readOnly = true;

    res$.innerHTML = `<span style="color:var(--success)">
      <i class="ti ti-check"></i>
      ${res.fuente === 'bd' ? 'Encontrado en sistema' : 'Registrado automáticamente'}
    </span>`;
  }

  function nvLimpiarCliente() {
    document.getElementById('nv-cli-id').value           = '';
    document.getElementById('nv-cli-tipo-doc').value     = '';
    const inp = document.getElementById('nv-doc-buscar');
    inp.value = ''; inp.readOnly = false;
    document.getElementById('nv-cli-info').style.display = 'none';
    document.getElementById('nv-cli-resultado').innerHTML = '';
  }

  // ════════════════════════════════════════════════════════════════════
  //  CARGAR COTIZACIÓN EN LA VENTA
  // ════════════════════════════════════════════════════════════════════
  async function nvAbrirCargarCot() {
    const cont = document.getElementById('cargar-cot-lista');
    cont.innerHTML = `<div style="text-align:center;padding:20px;color:var(--texto-muted)">Cargando...</div>`;
    document.getElementById('modal-cargar-cot').classList.add('open');

    let res;
    try { res = await Http.get('/cotizaciones/vigentes'); }
    catch (e) { res = null; }

    // Si NO viene el array, la ruta no respondió bien (server sin reiniciar / index.js viejo)
    if (!res || !Array.isArray(res.cotizaciones)) {
      cont.innerHTML = `<div style="text-align:center;padding:24px;color:var(--danger)">
        <i class="ti ti-alert-triangle" style="font-size:26px;display:block;margin-bottom:8px"></i>
        No se pudo cargar la lista de cotizaciones.<br>
        <span style="font-size:12px;color:var(--texto-muted)">
          Verifica que reiniciaste el servidor y que <code>routes/index.js</code>
          tenga la ruta <code>/cotizaciones/vigentes</code> (antes de <code>/cotizaciones/:id</code>).
        </span></div>`;
      return;
    }

    const lista = res.cotizaciones;
    if (!lista.length) {
      // Diagnóstico: ¿cuántas cotizaciones hay y en qué estado?
      let extra = '';
      try {
        const all = await Http.get('/cotizaciones');
        const cs  = all?.cotizaciones || [];
        if (cs.length) {
          const vig = cs.filter(c => c.estado_real === 'vigente').length;
          const ven = cs.filter(c => c.estado_real === 'vencida').length;
          const con = cs.filter(c => c.estado_real === 'convertida').length;
          extra = `<div style="font-size:12px;color:var(--texto-muted);margin-top:12px;line-height:1.7;
                        background:var(--input-bg);padding:10px 14px;border-radius:8px;text-align:left">
            Tienes <b>${cs.length}</b> cotización(es):
            <b style="color:var(--success)">${vig} vigente(s)</b>, ${ven} vencida(s), ${con} convertida(s).<br>
            ${vig > 0
              ? '⚠️ <b style="color:var(--warning)">Hay vigentes pero no se listaron.</b> Reinicia el servidor y confirma que reemplazaste <code>CotizacionController.js</code> y <code>CotizacionModel.js</code>.'
              : 'Solo se pueden cargar las <b>vigentes</b> (no vencidas ni convertidas). Crea una nueva o revisa su fecha de vencimiento.'}
          </div>`;
        }
      } catch (e) {}
      cont.innerHTML = `<div style="text-align:center;padding:28px;color:var(--texto-muted)">
        <i class="ti ti-file-off" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px"></i>
        No hay cotizaciones vigentes para cargar${extra}</div>`;
      return;
    }

    cont.innerHTML = lista.map(q => {
      const codigo = 'COT-' + String(q.id).padStart(5, '0');
      const vence  = (q.vence_at || '').split('T')[0].split('-').reverse().join('/');
      return `
        <div onclick="_nvCargarCotizacion(${q.id})"
             style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;
                    border:1px solid var(--card-border);border-radius:10px;cursor:pointer;background:var(--card-bg)"
             onmouseover="this.style.background='var(--tabla-hover)'"
             onmouseout="this.style.background='var(--card-bg)'">
          <div>
            <div style="font-weight:700;color:var(--info)">${codigo}</div>
            <div style="font-size:13px;color:#fff">${q.cliente_nombre || 'Cliente General'}</div>
            <div style="font-size:11px;color:var(--texto-muted)">${q.items_count} ítem(s) · vence ${vence}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700;color:var(--success);font-size:16px">S/ ${(+q.total).toFixed(2)}</div>
            <span style="font-size:11px;color:var(--rojo)">Cargar <i class="ti ti-arrow-right"></i></span>
          </div>
        </div>`;
    }).join('');
  }

  window._nvCargarCotizacion = async function(id) {
    const res = await Http.get(`/cotizaciones/${id}`);
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo cargar la cotización');
    const q     = res.cotizacion;
    const items = res.items || [];

    if (q.estado !== 'vigente' || q.vencida)
      return alerta('warning', 'No disponible', 'Esta cotización ya no está vigente.');
    if (!items.length)
      return alerta('warning', 'Vacía', 'La cotización no tiene productos');

    // ── BLOQUEAR si algún producto no tiene stock suficiente ──
    const sinStock = items.filter(it => (+it.cantidad) > (+it.stock_actual));
    if (sinStock.length) {
      const detalle = sinStock.map(it =>
        `• ${it.producto_nombre}: cotiza ${it.cantidad}, hay ${it.stock_actual}`).join('<br>');
      return Swal.fire({
        icon: 'error', title: 'Stock insuficiente',
        html: `No se puede cargar hasta tener stock para:<br><br>${detalle}`,
        background: '#1a1a2e', color: '#e0e0e0', confirmButtonColor: '#e53935'
      });
    }

    // ── Cargar productos al carrito con el PRECIO COTIZADO ──
    nvItems = items.map(it => ({
      _key: `${it.producto_id}_${it.presentacion_id || 'base'}`,
      producto_id:     it.producto_id,
      presentacion_id: it.presentacion_id || null,
      nombre:          it.producto_nombre + (it.presentacion_nombre ? ` (${it.presentacion_nombre})` : ''),
      precio_base:     +it.precio_unit,
      precio_unit:     +it.precio_unit,
      cantidad:        +it.cantidad,
      subtotal:        (+it.precio_unit) * (+it.cantidad),
      stock_actual:    +it.stock_actual,
      volumenes:       [],
      congelado:       true
    }));

    // ── Cargar el cliente de la cotización (si tiene) ──
    if (q.cliente_id) {
      document.getElementById('nv-cli-id').value       = q.cliente_id;
      document.getElementById('nv-cli-tipo-doc').value = q.tipo_doc || '';
      document.getElementById('nv-cli-nombre-label').textContent = q.cliente_nombre || 'Cliente';
      document.getElementById('nv-cli-doc-label').textContent =
        q.numero_doc ? `${(q.tipo_doc||'').toUpperCase()} ${q.numero_doc}` : '';
      document.getElementById('nv-cli-telefono-label').textContent = '';
      document.getElementById('nv-cli-info').style.display = 'block';
      document.getElementById('nv-doc-buscar').readOnly = true;
    }

    // ── Marcar la cotización como cargada ──
    nvCotizacionId = id;
    document.getElementById('nv-cot-codigo').textContent = 'COT-' + String(id).padStart(5, '0');
    document.getElementById('nv-cot-cargada').style.display = 'flex';

    document.getElementById('modal-cargar-cot').classList.remove('open');
    nvRenderItems();
    nvCalcTotales();
    nvToast('Cotización cargada');
  };

  // Quitar el vínculo de la cotización (NO borra los productos, solo desliga el CANJE)
  function nvQuitarCotizacion() {
    nvCotizacionId = null;
    const ind = document.getElementById('nv-cot-cargada');
    if (ind) ind.style.display = 'none';
  }

  // ── PRODUCTOS ─────────────────────────────────────────────────────────
  async function nvCargarProductos() {
    const res = await Http.get('/productos');
    if (!res?.ok) return;
    todosProds = (res.productos || []).filter(p => p.estado === 0 && p.stock_actual > 0);
    nvRenderTabsProd();
    nvRenderProductosModal(nvProdsSucursal());
  }

  // Productos visibles según la sucursal de la venta (los globales sin sucursal salen siempre)
  function nvProdsSucursal() {
    if (nvSucursalVenta == null) return todosProds;
    return todosProds.filter(p => p.sucursal_id == null || p.sucursal_id === nvSucursalVenta);
  }

  // Pestañas de sucursal DENTRO del buscador (solo admin global)
  function nvRenderTabsProd() {
    const cont = document.getElementById('nv-prod-tabs');
    if (!cont) return;
    if (!esGlobal || !sucursales.length) { cont.style.display = 'none'; return; }
    cont.style.display = 'flex';
    cont.innerHTML = sucursales.map(s =>
      `<button class="suc-tab ${s.id === nvSucursalVenta ? 'active' : ''}" data-suc="${s.id}">${s.nombre}</button>`
    ).join('');
    cont.querySelectorAll('.suc-tab').forEach(b => {
      b.onclick = () => {
        const nueva = +b.dataset.suc;
        if (nueva === nvSucursalVenta) return;
        nvCambiarSucursalVenta(nueva);
      };
    });
  }

  // Cambiar la sucursal de la venta (admin). Si hay productos en el carrito de otra
  // sucursal, se vacían para no mezclar (una venta = una sucursal).
  async function nvCambiarSucursalVenta(nueva) {
    const usaEfectivo = nvPagos.some(p => p.metodo === 'efectivo');
    if (usaEfectivo && cajaSucursalId && Number(nueva) !== Number(cajaSucursalId)) {
      return alerta('warning','Caja de otra sucursal',`La caja abierta pertenece a ${cajaSucursalNombre || 'otra sucursal'}. Para cambiar de sucursal, elimina primero el pago en efectivo.`);
    }
    if (nvItems.length) {
      const conf = await Swal.fire({
        icon: 'warning', title: 'Cambiar de sucursal',
        text: 'Se quitarán los productos ya agregados (una venta es de una sola sucursal). ¿Continuar?',
        showCancelButton: true, confirmButtonText: 'Sí, cambiar', cancelButtonText: 'Cancelar',
        background: '#1a1a2e', color: '#e0e0e0', confirmButtonColor: '#e53935'
      });
      if (!conf.isConfirmed) { nvRenderTabsProd(); return; }
      nvItems = []; nvRenderItems(); nvCalcTotales();
    }
    nvSucursalVenta = nueva;
    const sel = document.getElementById('nv-sucursal');
    if (sel) sel.value = String(nueva);
    nvRenderTabsProd();
    document.getElementById('nv-prod-buscar-inp').value = '';
    nvRenderProductosModal(nvProdsSucursal());
  }

  function nvRenderProductosModal(lista) {
    const cont = document.getElementById('nv-prod-lista');
    if (!lista.length) {
      cont.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;
        color:var(--texto-muted)">
        <i class="ti ti-package" style="font-size:24px;opacity:.3;display:block;margin-bottom:8px"></i>
        Sin productos con stock disponible</div>`;
      return;
    }
    cont.innerHTML = lista.map(p => {
      const stockColor = p.stock_actual <= p.stock_minimo ? 'var(--danger)' : 'var(--success)';
      const img = p.imagen_portada
        ? `<img src="${p.imagen_portada}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0">`
        : `<div style="width:40px;height:40px;background:var(--input-bg);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center"><i class="ti ti-photo" style="color:var(--texto-muted);font-size:14px"></i></div>`;
      const click = p.tiene_presentaciones
        ? `onclick="_nvMostrarPresentaciones(${p.id})"`
        : `onclick="_nvAgregarItem(${p.id},null)"`;
      return `
        <div ${click} style="display:flex;align-items:center;gap:10px;padding:10px;
             border-radius:8px;cursor:pointer;transition:background .15s;
             background:var(--card-bg);border:1px solid var(--card-border)"
             onmouseover="this.style.background='var(--tabla-hover)'"
             onmouseout="this.style.background='var(--card-bg)'">
          ${img}
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;color:#fff;font-size:13px;overflow:hidden;
                        text-overflow:ellipsis;white-space:nowrap">${p.nombre}</div>
            <div style="font-size:11px;color:${stockColor}">Stock: ${p.stock_actual}</div>
            <div style="font-size:11px;color:var(--texto-muted)">
              S/ ${parseFloat(p.precio_venta).toFixed(2)}
              ${p.tiene_presentaciones ? `<span style="color:var(--info);margin-left:6px"><i class="ti ti-layers"></i> Con presentaciones</span>` : ''}
            </div>
          </div>
          <i class="ti ti-${p.tiene_presentaciones ? 'chevron-right' : 'plus'}" style="color:var(--rojo);flex-shrink:0"></i>
        </div>`;
    }).join('');
  }

  window._nvMostrarPresentaciones = async function(prodId) {
    const res = await Http.get(`/productos/${prodId}`);
    if (!res?.ok) return;
    const p    = res.producto;
    const pres = (res.presentaciones || []).filter(pr => pr.estado === 0);
    if (!pres.length) { window._nvAgregarItem(prodId, null); return; }

    document.getElementById('pres-modal-titulo').textContent = `Presentaciones — ${p.nombre}`;
    document.getElementById('pres-modal-body').innerHTML = pres.map(pr => `
      <div onclick="_nvAgregarItem(${prodId},${pr.id})"
           style="display:flex;justify-content:space-between;align-items:center;
                  padding:12px;border-radius:8px;cursor:pointer;margin-bottom:8px;
                  border:1px solid var(--card-border);background:var(--card-bg)"
           onmouseover="this.style.background='var(--tabla-hover)'"
           onmouseout="this.style.background='var(--card-bg)'">
        <div>
          <div style="font-weight:600;color:#fff">${pr.nombre}</div>
          <div style="font-size:11px;color:var(--texto-muted)">Stock: ${pr.stock || 0}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;color:var(--success);font-size:15px">
            S/ ${parseFloat(pr.precio_venta).toFixed(2)}</div>
          ${pr.es_principal ? `<span style="font-size:10px;background:rgba(0,200,83,.15);color:var(--success);padding:1px 6px;border-radius:10px">Principal</span>` : ''}
        </div>
      </div>`).join('');
    document.getElementById('modal-presentaciones').classList.add('open');
  };

  // ── PRECIOS POR VOLUMEN ────────────────────────────────────────────
  const volCache = {};   // producto_id -> [{cantidad_desde, precio_unit}, ...]

  async function nvCargarVolumenes(prodId) {
    if (volCache[prodId]) return volCache[prodId];
    try {
      const r = await Http.get(`/productos/${prodId}/volumenes`);
      volCache[prodId] = (r && r.ok) ? (r.volumenes || []) : [];
    } catch (e) { volCache[prodId] = []; }
    return volCache[prodId];
  }

  // Precio que corresponde a la cantidad actual (escalón más alto alcanzado).
  // No aplica si viene de cotización (precio congelado) ni a presentaciones.
  function nvPrecioVolumen(item) {
    if (item.congelado) return item.precio_unit;
    const base = (item.precio_base != null) ? +item.precio_base : +item.precio_unit;
    if (item.presentacion_id) return base;
    let precio = base;
    (item.volumenes || []).forEach(t => {
      if (item.cantidad >= +t.cantidad_desde) precio = +t.precio_unit;
    });
    return precio;
  }

  window._nvAgregarItem = async function(prodId, presId) {
    const p = todosProds.find(x => x.id === prodId);
    if (!p) return;
    const precio = +p.precio_venta;

    // Solo cerramos el sub-modal de presentaciones; el buscador queda ABIERTO
    // para seguir agregando varios productos sin reabrirlo.
    document.getElementById('modal-presentaciones').classList.remove('open');

    const key = `${prodId}_${presId || 'base'}`;
    const existe = nvItems.find(i => i._key === key);
    if (existe) {
      if (existe.cantidad >= existe.stock_actual) {
        alerta('warning', 'Sin stock', `Stock disponible: ${existe.stock_actual}`, 1800);
        return;
      }
      existe.cantidad++;
      existe.precio_unit = nvPrecioVolumen(existe);
      existe.subtotal = existe.cantidad * existe.precio_unit;
    } else {
      // Escalones de volumen (solo producto base; las presentaciones no usan volumen)
      const volumenes = presId ? [] : await nvCargarVolumenes(prodId);
      const item = {
        _key: key, producto_id: p.id, presentacion_id: presId || null,
        nombre: p.nombre, precio_base: precio, precio_unit: precio, cantidad: 1,
        subtotal: precio, stock_actual: p.stock_actual,
        volumenes, congelado: false
      };
      item.precio_unit = nvPrecioVolumen(item);
      item.subtotal = item.cantidad * item.precio_unit;
      nvItems.push(item);
    }
    nvRenderItems();
    nvCalcTotales();
    nvToast(`Agregado: ${p.nombre}`);
  };

  function nvRenderItems() {
    const empty = document.getElementById('nv-items-empty');
    const wrap  = document.getElementById('nv-items-wrap');
    const tbody = document.getElementById('nv-items-tbody');
    if (!nvItems.length) { empty.style.display='block'; wrap.style.display='none'; return; }
    empty.style.display='none'; wrap.style.display='block';

    tbody.innerHTML = nvItems.map((item, idx) => `
      <tr>
        <td>
          <div style="font-weight:500;color:#fff;font-size:12px">${item.nombre}</div>
          <div style="font-size:10px;color:${item.stock_actual<=3?'var(--warning)':'var(--texto-muted)'}">
            Stock: ${item.stock_actual}</div>
        </td>
        <td style="text-align:right;font-weight:600;color:var(--success);font-size:13px">
          S/ ${item.precio_unit.toFixed(2)}
          ${(!item.congelado && !item.presentacion_id && item.precio_base != null && item.precio_unit < +item.precio_base)
            ? `<div style="font-size:9px;color:var(--info);font-weight:700;margin-top:1px"><i class="ti ti-discount-2"></i> volumen</div>`
            : ''}</td>
        <td style="text-align:center">
          <div style="display:flex;align-items:center;gap:4px;justify-content:center">
            <button onclick="_nvCantidad(${idx},-1)" style="width:22px;height:22px;border-radius:50%;background:var(--input-bg);border:1px solid var(--card-border);color:var(--texto);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">−</button>
            <input type="text" inputmode="numeric" value="${item.cantidad}"
                   onkeydown="if(['e','E','+','-','.',','].includes(event.key))event.preventDefault()"
                   oninput="this.value=this.value.replace(/[^0-9]/g,'')"
                   onchange="_nvSetCantidad(${idx},this.value)"
                   style="width:46px;font-weight:700;text-align:center;background:var(--card-bg);border:1px solid var(--input-border);border-radius:6px;color:var(--texto);padding:3px 4px;font-size:13px;outline:none">
            <button onclick="_nvCantidad(${idx},1)" style="width:22px;height:22px;border-radius:50%;background:var(--input-bg);border:1px solid var(--card-border);color:var(--texto);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">+</button>
          </div>
        </td>
        <td style="text-align:right;font-weight:600;color:var(--success);font-size:13px">
          S/ ${item.subtotal.toFixed(2)}</td>
        <td><button class="btn btn-danger btn-xs" onclick="_nvQuitarItem(${idx})"><i class="ti ti-x"></i></button></td>
      </tr>`).join('');
  }

  window._nvCantidad = function(idx, delta) {
    const item = nvItems[idx];
    const nueva = item.cantidad + delta;
    if (nueva < 1) return;
    if (nueva > item.stock_actual) {
      alerta('warning', 'Sin stock', `Stock disponible: ${item.stock_actual}`, 1800);
      return;
    }
    item.cantidad = nueva;
    item.precio_unit = nvPrecioVolumen(item);
    item.subtotal = nueva * item.precio_unit;
    nvRenderItems(); nvCalcTotales();
  };

  window._nvQuitarItem = function(idx) {
    nvItems.splice(idx, 1); nvRenderItems(); nvCalcTotales();
  };

  // Escribir la cantidad directamente: nunca negativa, nunca mayor al stock
  window._nvSetCantidad = function(idx, val) {
    const item = nvItems[idx];
    let n = parseInt(val, 10);
    if (isNaN(n) || n < 1) n = 1;                 // mínimo 1, jamás negativo
    if (n > item.stock_actual) {
      alerta('warning', 'Stock insuficiente',
        `Solo hay ${item.stock_actual} en stock. Se ajustó al máximo disponible.`, 2200);
      n = item.stock_actual;                       // se limita al stock (cero negativos)
    }
    item.cantidad = n;
    item.precio_unit = nvPrecioVolumen(item);
    item.subtotal = n * item.precio_unit;
    nvRenderItems(); nvCalcTotales();
  };

  // ── PAGOS ─────────────────────────────────────────────────────────────
  function nvRenderPagos() {
    const lista = document.getElementById('nv-pagos-lista');
    if (!nvPagos.length) {
      lista.innerHTML = `<div style="font-size:12px;color:var(--texto-muted);text-align:center;padding:6px 0">Sin métodos de pago</div>`;
      nvCalcTotales(); return;
    }
    lista.innerHTML = nvPagos.map((p, i) => {
      const info = METODOS_INFO[p.metodo] || METODOS_INFO.efectivo;
      return `
        <div class="metodo-pago-card">
          <div class="metodo-label">
            <i class="ti ${info.icon}" style="color:${info.color}"></i>
            Método de pago
            <button class="btn btn-danger btn-xs" onclick="_nvQuitarPago(${i})" style="margin-left:auto"><i class="ti ti-x"></i></button>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
            ${METODOS.map(m => {
              const mi = METODOS_INFO[m];
              return `<button class="metodo-btn ${p.metodo===m?'active':''}" onclick="_nvSetMetodo(${i},'${m}')"><i class="ti ${mi.icon}"></i> ${mi.label}</button>`;
            }).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;color:var(--texto-muted);white-space:nowrap">Monto S/</span>
            <input type="text" inputmode="decimal" value="${p.monto}"
                   oninput="_nvSanearMonto(this);_nvUpdateMonto(${i},+this.value)"
                   onkeydown="_nvBloqueoNum(event)"
                   style="flex:1;background:var(--card-bg);border:1px solid var(--input-border);border-radius:6px;color:var(--texto);padding:7px 10px;font-size:14px;font-weight:600;outline:none">
          </div>
          ${p.metodo !== 'efectivo' ? `
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
            <span style="font-size:12px;color:var(--texto-muted);white-space:nowrap">
              N.º / código de operación
            </span>
            <input type="text" inputmode="text" value="${p.referencia || ''}"
                   maxlength="40"
                   placeholder="Según la app, banco o POS"
                   oninput="_nvSanearCodigo(this,${i})"
                   style="flex:1;background:var(--card-bg);border:1px solid var(--input-border);border-radius:6px;color:var(--texto);padding:7px 10px;font-size:14px;outline:none">
          </div>` : ''}
        </div>`;
    }).join('');
    nvCalcTotales();
  }

  // Helpers de validación numérica expuestos para los inputs de pago
  window._nvBloqueoNum  = bloquearTeclasNum;
  window._nvSanearMonto = sanearNumero;
  window._nvSanearCodigo = (el, idx) => {
    // Evita expresiones regulares inline que algunos navegadores interpretaban
    // como un rango inválido y, por ello, nunca guardaban el código escrito.
    const limpio = String(el?.value || '')
      .split('')
      .filter(ch => /[A-Za-z0-9._ ]/.test(ch) || ch === '-')
      .join('')
      .slice(0, 60);
    if (el) el.value = limpio;
    if (nvPagos[idx]) nvPagos[idx].referencia = limpio;
  };

  window._nvSetMetodo  = (idx, m) => {
    if (m === 'efectivo' && cajaSucursalId && nvSucursalVenta && Number(nvSucursalVenta) !== Number(cajaSucursalId)) {
      return alerta('warning','Caja de otra sucursal',`Tu caja abierta es de ${cajaSucursalNombre || 'otra sucursal'}. El efectivo solo puede registrarse con productos de esa sucursal.`);
    }
    nvPagos[idx].metodo = m; nvPagos[idx].referencia = ''; nvRenderPagos();
  };
  window._nvUpdateMonto= (idx, v) => { nvPagos[idx].monto = (isNaN(v) || v < 0) ? 0 : v; nvCalcTotales(); };
  window._nvUpdateCodigo = (idx, v) => { nvPagos[idx].referencia = v; };
  window._nvQuitarPago = (idx)    => { nvPagos.splice(idx,1); nvRenderPagos(); };

  // ── TOTALES ───────────────────────────────────────────────────────────
  function nvCalcTotales() {
    const subtotalBruto = nvItems.reduce((a, i) => a + i.subtotal, 0);
    let desc = +document.getElementById('nv-descuento').value || 0;
    if (desc < 0 || isNaN(desc)) desc = 0;

    // El descuento no puede superar el subtotal de los productos
    const descInp = document.getElementById('nv-descuento');
    if (desc > subtotalBruto + 0.009) {
      descInp.style.borderColor = 'var(--danger)';
    } else {
      descInp.style.borderColor = '';
    }

    const total = parseFloat(Math.max(0, subtotalBruto - desc).toFixed(2));

    document.getElementById('nv-subtotal-label').textContent = `S/ ${subtotalBruto.toFixed(2)}`;
    document.getElementById('nv-total-label').textContent = `S/ ${total.toFixed(2)}`;

    const filaV = document.getElementById('nv-fila-vuelto');
    const pagado = nvPagos.reduce((a, p) => a + (+p.monto || 0), 0);
    const vuelto = pagado - total;
    if (nvPagos.length && pagado > 0) {
      filaV.style.display = 'flex';
      const lbl = document.getElementById('nv-vuelto-label');
      lbl.textContent = `S/ ${Math.max(0, vuelto).toFixed(2)}`;
      lbl.style.color = vuelto >= 0 ? 'var(--success)' : 'var(--danger)';
    } else {
      filaV.style.display = 'none';
    }
  }

  // ── REGISTRAR VENTA ───────────────────────────────────────────────────
  async function nvRegistrar() {
    if (!nvItems.length) return alerta('error', 'Sin productos', 'Agrega al menos un producto');
    for (const it of nvItems) {
      if (it.precio_unit <= 0 || it.cantidad <= 0)
        return alerta('error', 'Datos inválidos', 'Precios y cantidades deben ser mayores a 0');
    }
    if (!nvPagos.length) return alerta('error', 'Sin pago', 'Agrega al menos un método de pago');

    let desc = +document.getElementById('nv-descuento').value || 0;
    if (desc < 0 || isNaN(desc)) desc = 0;
    const subBruto = nvItems.reduce((a, i) => a + i.subtotal, 0);
    if (desc > subBruto + 0.009)
      return alerta('error', 'Descuento inválido', `El descuento no puede ser mayor al subtotal (S/ ${subBruto.toFixed(2)})`);
    const total  = subBruto - desc;
    const pagado = nvPagos.reduce((a, p) => a + (+p.monto || 0), 0);

    for (const p of nvPagos) {
      if (+p.monto <= 0)
        return alerta('error', 'Pago inválido', 'Los montos de pago deben ser mayores a 0');
      // Código obligatorio y con formato para yape/plin/transferencia
      if (p.metodo !== 'efectivo') {
        const ref = (p.referencia || '').trim();
        if (!ref)
          return alerta('error', 'Falta el código', `Ingresa el código de operación del pago con ${p.metodo}`);
        if (ref.length < 3 || ref.length > 40 || [...ref].some(ch => !(/[A-Za-z0-9._ ]/.test(ch) || ch === '-')))
          return alerta('error', 'Código inválido', 'El número o código de operación debe tener entre 3 y 40 caracteres válidos');
      }
    }
    // Que no se repitan códigos entre los pagos de ESTA misma venta
    const cods = nvPagos.filter(p => p.metodo !== 'efectivo').map(p => p.metodo + ':' + (p.referencia||'').trim());
    if (new Set(cods).size !== cods.length)
      return alerta('error', 'Código repetido', 'No puedes usar el mismo código en dos pagos');
    if (pagado + 0.001 < total)
      return alerta('warning', 'Pago incompleto', `Falta S/ ${(total - pagado).toFixed(2)} para cubrir el total`);

    const body = {
      cliente_id: document.getElementById('nv-cli-id').value
        ? +document.getElementById('nv-cli-id').value : null,
      items: nvItems.map(i => ({
        producto_id: i.producto_id, presentacion_id: i.presentacion_id || null,
        cantidad: i.cantidad, precio_unit: i.precio_unit, descuento: 0
      })),
      pagos: nvPagos,
      descuento: desc,
      observacion: document.getElementById('nv-observacion').value.trim(),
      cotizacion_id: nvCotizacionId,
      // La pestaña activa es la fuente de verdad. Antes se buscaba un selector
      // inexistente (nv-sucursal), por eso el backend recibía la sucursal 1.
      sucursal_id: nvSucursalVenta ? Number(nvSucursalVenta) : null
    };

    const btn = document.getElementById('btn-nv-registrar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Registrando...';

    const res = await Http.post('/ventas', body);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Registrar Venta';

    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'Error al registrar');

    document.getElementById('modal-venta').classList.remove('open');
    const { isConfirmed } = await Swal.fire({
      icon: 'success', title: '¡Venta registrada!', text: `N° ${res.numero}`,
      showCancelButton: true,
      confirmButtonText: '<i class="ti ti-printer"></i> Imprimir',
      cancelButtonText: 'Cerrar',
      confirmButtonColor: '#e53935', background: '#1a1a2e', color: '#e0e0e0'
    });
    if (isConfirmed) _vAbrirImprimir(res.venta_id);
    await cargar();
  }

  // ════════════════════════════════════════════════════════════════════
  //  IMPRESIÓN  (modal interno con iframe)
  //  - Nota de venta  → HTML generado aquí (estirado), srcdoc
  //  - Boleta/Factura → PDF real de SUNAT (A4 o Ticket) según se elija
  // ════════════════════════════════════════════════════════════════════
  let _printUrl    = null;   // URL del PDF (boleta/factura)
  let _printIsPdf  = false;
  let _printSrcdoc = '';     // HTML de la nota (para abrir en pestaña)


  window._vVerDocumento = async function(id) {
    const pdf = await Http.get(`/ventas/${id}/pdf?formato=a4`);
    if (!pdf?.ok || !pdf.url) return alerta('error','Documento no disponible',pdf?.msg || 'No se pudo generar el PDF');
    window.open(pdf.url,'_blank','noopener');
  };

  // Paso 1: abrir el selector de formato
  window._vAbrirImprimir = function(id) {
    document.getElementById('imprimir-venta-id').value = id;
    document.getElementById('modal-imprimir').classList.add('open');
  };

  // Paso 2: cargar el documento (A4 o Ticket) en el modal de impresión
  window._vImprimir = async function(id, formato) {
    document.getElementById('modal-imprimir').classList.remove('open');

    const res = await Http.get(`/ventas/${id}`);
    if (!res?.ok) { alerta('error', 'Error', 'No se pudo cargar la venta'); return; }
    const { venta, items, pagos } = res;

    const esNota  = ['nota','nota_venta'].includes(venta.tipo_comprobante);
    const emitido = ['emitido','aceptado','rechazado'].includes(venta.estado_sunat);
    const iframe  = document.getElementById('print-iframe');

    if (!esNota && emitido) {
      // Boleta/Factura emitida → traer el PDF real que corresponde
      const arch = await Http.get(`/ventas/${id}/archivos`);
      if (!arch?.ok) { alerta('info', 'Sin comprobante', arch?.msg || 'No tiene comprobante'); return; }
      const url = formato === 'ticket'
        ? (arch.archivos.pdf_ticket || arch.archivos.pdf_a4)
        : (arch.archivos.pdf_a4     || arch.archivos.pdf_ticket);
      if (!url) { alerta('warning', 'PDF no disponible', 'El comprobante no tiene ese formato'); return; }

      _printUrl    = url;
      _printIsPdf  = true;
      _printSrcdoc = '';
      iframe.removeAttribute('srcdoc');
      iframe.src = url;
      document.getElementById('print-titulo').textContent =
        `${arch.numero || venta.numero} — ${formato === 'ticket' ? 'Ticket 80mm' : 'Hoja A4'}`;
    } else {
      // Nota de venta → utilizar el mismo PDF corporativo para ver, correo e impresión.
      const pdf = await Http.get(`/ventas/${id}/pdf?formato=${encodeURIComponent(formato)}`);
      if (!pdf?.ok || !pdf.url) {
        alerta('error', 'PDF no disponible', pdf?.msg || 'No se pudo generar la nota de venta');
        return;
      }
      _printUrl = pdf.url;
      _printIsPdf = true;
      _printSrcdoc = '';
      iframe.removeAttribute('srcdoc');
      iframe.src = pdf.url;
      document.getElementById('print-titulo').textContent =
        `${venta.numero} — Nota de venta (${formato === 'ticket' ? 'Ticket 80mm' : 'A4'})`;
    }

    document.getElementById('modal-print').classList.add('open');
  };

  // Botón "Imprimir" del modal de impresión
  document.getElementById('btn-print-go').addEventListener('click', () => {
    const iframe = document.getElementById('print-iframe');
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      // PDF cross-origin (miapi.cloud) no permite imprimir por script → nueva pestaña
      if (_printUrl) window.open(_printUrl, '_blank');
    }
  });

  // Botón "Abrir en pestaña"
  document.getElementById('btn-print-tab').addEventListener('click', () => {
    if (_printIsPdf && _printUrl) {
      window.open(_printUrl, '_blank');
    } else if (_printSrcdoc) {
      const w = window.open('', '_blank');
      w.document.write(_printSrcdoc);
      w.document.close();
    }
  });

  document.getElementById('btn-cerrar-print').addEventListener('click', () => {
    document.getElementById('modal-print').classList.remove('open');
    const ifr = document.getElementById('print-iframe');
    ifr.removeAttribute('src'); ifr.removeAttribute('srcdoc');
  });

  // ── PLANTILLA DE RESPALDO — TICKET 80mm (el flujo principal usa PDF corporativo) ─
  function notaTicketHTML(venta, items, pagos, fecha) {
    const emp = empresaCfg;
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${venta.numero}</title>
<style>
  @page{size:80mm auto;margin:0}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:80mm}
  body{font-family:'Courier New',monospace;font-size:12.5px;line-height:1.55;
       width:80mm;padding:14px 9px 26px;background:#fff;color:#000}
  .c{text-align:center}.b{font-weight:bold}
  .l{border-top:1px dashed #000;margin:9px 0}
  .r{display:flex;justify-content:space-between;margin:2px 0}
  table{width:100%;border-collapse:collapse;margin:4px 0}
  th,td{padding:4px 0;font-size:11.5px;vertical-align:top}
  th{border-bottom:1px solid #000;text-align:left}
  .tot{font-size:15px;font-weight:bold}
  .sp{height:8px}
  .foot{margin-top:14px;text-align:center;font-size:11px;line-height:1.8}
</style></head><body>
${emp.logo ? `<div class="c" style="margin-bottom:6px"><img src="${emp.logo}" style="max-width:54px;max-height:54px;object-fit:contain"></div>` : ''}
<div class="c b" style="font-size:16px">${emp.nombre}</div>
${emp.ruc ? `<div class="c" style="font-size:11px">RUC: ${emp.ruc}</div>` : ''}
${emp.direccion ? `<div class="c" style="font-size:10.5px">${emp.direccion}</div>` : ''}
${emp.telefono ? `<div class="c" style="font-size:10.5px">Tel: ${emp.telefono}</div>` : ''}
<div class="l"></div>
<div class="c b" style="font-size:14px;letter-spacing:1px">NOTA DE VENTA</div>
<div class="c b" style="font-size:13px;margin-top:3px">${venta.numero}</div>
<div class="c" style="font-size:10px;margin-top:2px">Documento interno - No es comprobante de pago</div>
<div class="l"></div>
<div class="sp"></div>
<div class="r"><span class="b">Fecha:</span><span>${fecha}</span></div>
<div class="r"><span class="b">Cliente:</span><span style="text-align:right">${venta.cliente_nombre || 'Cliente General'}</span></div>
${venta.numero_doc ? `<div class="r"><span class="b">${(venta.tipo_doc||'Doc').toUpperCase()}:</span><span>${venta.numero_doc}</span></div>` : ''}
<div class="r"><span class="b">Vendedor:</span><span style="text-align:right">${venta.vendedor_nombre || '-'}</span></div>
<div class="r"><span class="b">Forma pago:</span><span>Contado</span></div>
<div class="l"></div>
<div class="sp"></div>
<table>
  <tr><th>PRODUCTO</th><th style="text-align:center">CANT</th><th style="text-align:right">P.U.</th><th style="text-align:right">TOTAL</th></tr>
  ${items.map(i => `<tr>
    <td>${i.producto_nombre || ''}${i.presentacion_nombre ? `<br><span style="font-size:10px">(${i.presentacion_nombre})</span>` : ''}</td>
    <td style="text-align:center">${i.cantidad}</td>
    <td style="text-align:right">${parseFloat(i.precio_unit).toFixed(2)}</td>
    <td style="text-align:right">${parseFloat(i.subtotal).toFixed(2)}</td></tr>`).join('')}
</table>
<div class="l"></div>
<div class="sp"></div>
<div class="r"><span>Subtotal:</span><span>S/ ${parseFloat(venta.subtotal).toFixed(2)}</span></div>
${+venta.descuento > 0 ? `<div class="r"><span>Descuento:</span><span>-S/ ${parseFloat(venta.descuento).toFixed(2)}</span></div>` : ''}
<div class="r tot" style="margin-top:6px"><span>TOTAL:</span><span>S/ ${parseFloat(venta.total).toFixed(2)}</span></div>
<div class="l"></div>
<div class="c b" style="font-size:11px;margin:4px 0">FORMA DE PAGO</div>
${pagos.map(p => `<div class="r"><span style="text-transform:capitalize">${p.metodo}:</span><span>S/ ${parseFloat(p.monto).toFixed(2)}</span></div>`).join('')}
${venta.observacion ? `<div class="l"></div><div style="font-size:11px"><span class="b">Obs:</span> ${venta.observacion}</div>` : ''}
<div class="l"></div>
<div class="foot">
  <div class="b" style="font-size:13px">¡Gracias por su compra!</div>
  <div>Conserve este documento</div>
  <div style="margin-top:6px">${emp.nombre}</div>
  ${emp.ruc ? `<div>RUC ${emp.ruc}</div>` : ''}
  <div style="margin-top:6px">- - - - - - - - - - - - - - - -</div>
  <div style="font-size:10px;margin-top:4px">Documento interno sin valor tributario</div>
</div>
</body></html>`;
  }

  // ── PLANTILLA DE RESPALDO — A4 (el flujo principal usa PDF corporativo) ───────────────────────────────────────────────
  function notaA4HTML(venta, items, pagos, fecha) {
    const emp = empresaCfg;
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${venta.numero}</title>
<style>
  @page{size:A4;margin:18mm}
  @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:12px;color:#222;background:#fff;line-height:1.5}
  .header{display:flex;justify-content:space-between;border-bottom:3px solid #159447;padding-bottom:16px;margin-bottom:20px}
  .emp-nombre{font-size:20px;font-weight:700;color:#159447}
  .emp-info{font-size:12px;color:#555;margin-top:4px}
  .comp-box{text-align:center;border:2px solid #159447;border-radius:8px;padding:14px 22px;min-width:200px}
  .comp-tipo{font-size:13px;font-weight:700;letter-spacing:.5px}
  .comp-num{font-size:18px;font-weight:700;color:#159447;margin-top:5px}
  .comp-sub{font-size:10px;color:#999;margin-top:4px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:22px}
  .info-box{border:1px solid #ddd;border-radius:6px;padding:10px 12px}
  .info-lbl{font-size:10px;text-transform:uppercase;color:#999;margin-bottom:3px}
  .info-val{font-weight:600;font-size:13px}
  table{width:100%;border-collapse:collapse;margin-bottom:22px}
  th{background:#159447;color:#fff;padding:9px 10px;text-align:left;font-size:11px}
  td{padding:9px 10px;border-bottom:1px solid #eee;font-size:12px}
  tr:nth-child(even) td{background:#fafafa}
  .totales{display:flex;justify-content:flex-end;margin-bottom:22px}
  .tot-box{width:280px}
  .tot-row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}
  .tot-total{font-size:17px;font-weight:700;border-top:2px solid #159447;padding-top:8px;margin-top:6px}
  .pagos-box{margin-bottom:22px;font-size:12px}
  .footer{text-align:center;color:#888;font-size:11px;border-top:1px solid #ddd;padding-top:14px;margin-top:30px;line-height:1.9}
</style></head><body>
<div class="header">
  <div style="display:flex;align-items:center;gap:14px">
    ${emp.logo ? `<img src="${emp.logo}" style="width:64px;height:64px;object-fit:contain">` : ''}
    <div>
      <div class="emp-nombre">${emp.nombre}</div>
      ${emp.ruc ? `<div class="emp-info">RUC: ${emp.ruc}</div>` : ''}
      ${emp.direccion ? `<div class="emp-info">${emp.direccion}</div>` : ''}
      ${emp.telefono ? `<div class="emp-info">Tel: ${emp.telefono}</div>` : ''}
    </div>
  </div>
  <div class="comp-box">
    <div class="comp-tipo">NOTA DE VENTA</div>
    <div class="comp-num">${venta.numero}</div>
    <div class="comp-sub">Documento interno</div>
  </div>
</div>
<div class="info-grid">
  <div class="info-box">
    <div class="info-lbl">Cliente</div>
    <div class="info-val">${venta.cliente_nombre || 'Cliente General'}</div>
    ${venta.numero_doc ? `<div style="font-size:11px;color:#666;margin-top:3px">${(venta.tipo_doc||'').toUpperCase()}: ${venta.numero_doc}</div>` : ''}
    ${venta.direccion ? `<div style="font-size:11px;color:#666">${venta.direccion}</div>` : ''}
  </div>
  <div class="info-box"><div class="info-lbl">Fecha de emisión</div><div class="info-val">${fecha}</div></div>
  <div class="info-box"><div class="info-lbl">Vendedor</div><div class="info-val">${venta.vendedor_nombre || '-'}</div></div>
  <div class="info-box"><div class="info-lbl">Forma de pago</div><div class="info-val">Al Contado</div></div>
</div>
<table>
  <thead><tr><th>#</th><th>Descripción</th><th style="text-align:right">P. Unit.</th><th style="text-align:center">Cant.</th><th style="text-align:right">Importe</th></tr></thead>
  <tbody>
    ${items.map((i, n) => `<tr>
      <td>${n + 1}</td>
      <td>${i.producto_nombre}${i.presentacion_nombre ? ` (${i.presentacion_nombre})` : ''}</td>
      <td style="text-align:right">S/ ${parseFloat(i.precio_unit).toFixed(2)}</td>
      <td style="text-align:center">${i.cantidad}</td>
      <td style="text-align:right;font-weight:600">S/ ${parseFloat(i.subtotal).toFixed(2)}</td></tr>`).join('')}
  </tbody>
</table>
<div class="totales"><div class="tot-box">
  <div class="tot-row"><span>Subtotal</span><span>S/ ${parseFloat(venta.subtotal).toFixed(2)}</span></div>
  ${+venta.descuento > 0 ? `<div class="tot-row"><span>Descuento</span><span style="color:#159447">-S/ ${parseFloat(venta.descuento).toFixed(2)}</span></div>` : ''}
  <div class="tot-row tot-total"><span>TOTAL</span><span>S/ ${parseFloat(venta.total).toFixed(2)}</span></div>
</div></div>
${pagos.length ? `<div class="pagos-box">
  <div style="font-size:11px;text-transform:uppercase;color:#888;margin-bottom:6px;font-weight:600">Pagos registrados</div>
  ${pagos.map(p => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f0f0f0"><span style="text-transform:capitalize">${p.metodo}</span><span>S/ ${parseFloat(p.monto).toFixed(2)}</span></div>`).join('')}
</div>` : ''}
${venta.observacion ? `<div style="border:1px solid #ddd;border-radius:6px;padding:10px;margin-bottom:18px;font-size:11px;color:#666"><strong>Observación:</strong> ${venta.observacion}</div>` : ''}
<div class="footer">
  <div style="font-weight:700;color:#159447;font-size:13px">¡Gracias por su preferencia!</div>
  <div>${emp.nombre}${emp.ruc ? ` &nbsp;|&nbsp; RUC ${emp.ruc}` : ''}</div>
  <div>${venta.numero} &nbsp;|&nbsp; ${fecha}</div>
  <div style="margin-top:6px;font-size:10px">Documento interno — No es un comprobante de pago electrónico</div>
</div>
</body></html>`;
  }

  // ════════════════════════════════════════════════════════════════════
  //  HISTORIAL (timeline)
  // ════════════════════════════════════════════════════════════════════
  window._vHistorial = async function(id) {
    document.getElementById('historial-body').innerHTML =
      '<div class="loading-center"><div class="spinner spinner-lg"></div></div>';
    document.getElementById('modal-historial').classList.add('open');

    const res = await Http.get(`/ventas/${id}/historial`);
    if (!res?.ok) {
      document.getElementById('historial-body').innerHTML =
        `<div style="text-align:center;color:var(--texto-muted);padding:20px">
           ${res?.msg || 'No se pudo cargar el historial'}</div>`;
      return;
    }

    document.getElementById('historial-titulo').textContent =
      `Historial — ${res.venta?.numero || ''}`;

    const eventos = res.eventos || [];
    if (!eventos.length) {
      document.getElementById('historial-body').innerHTML =
        `<div style="text-align:center;color:var(--texto-muted);padding:20px">Sin eventos registrados</div>`;
      return;
    }

    document.getElementById('historial-body').innerHTML = `
      <div style="margin-bottom:16px;text-align:center">
        <div style="font-weight:700;color:var(--info);font-size:16px">${res.venta?.numero || ''}</div>
        <div style="font-size:12px;color:var(--texto-muted)">
          ${res.venta?.cliente || 'Cliente General'} · S/ ${parseFloat(res.venta?.total || 0).toFixed(2)}
        </div>
      </div>
      <div class="tl">
        ${eventos.map(e => {
          const f = new Date(e.fecha).toLocaleString('es-PE', {
            day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'
          });
          return `
            <div class="tl-item">
              <div class="tl-dot" style="background:${e.color || '#888'}">
                <i class="ti ${e.icon || 'ti-point'}"></i>
              </div>
              <div class="tl-tit">${e.titulo || ''}</div>
              ${e.detalle ? `<div class="tl-det">${e.detalle}</div>` : ''}
              <div class="tl-fec"><i class="ti ti-clock" style="font-size:10px"></i> ${f}</div>
            </div>`;
        }).join('')}
      </div>`;
  };

  // ── VER DETALLE ───────────────────────────────────────────────────────
  window._vVerDetalle = async function(id) {
    document.getElementById('modal-detalle').classList.add('open');
    document.getElementById('detalle-body').innerHTML =
      '<div class="loading-center"><div class="spinner spinner-lg"></div></div>';

    const res = await Http.get(`/ventas/${id}`);
    if (!res?.ok) return;
    const { venta, items, pagos } = res;

    const fecha = new Date(venta.created_at).toLocaleString('es-PE', {
      day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
    });

    const esNota  = ['nota','nota_venta'].includes(venta.tipo_comprobante);
    const anulada = venta.estado_venta === 'anulada';
    const emitido = ['emitido','aceptado','rechazado'].includes(venta.estado_sunat);

    document.getElementById('detalle-titulo').textContent = `Venta — ${venta.numero}`;

    document.getElementById('detalle-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="background:var(--input-bg);border-radius:8px;padding:12px">
          <div style="font-size:10px;color:var(--texto-muted);text-transform:uppercase;margin-bottom:4px">Cliente</div>
          <div style="font-weight:600;color:#fff">${venta.cliente_nombre || 'Cliente General'}</div>
          ${venta.numero_doc ? `<div style="font-size:12px;color:var(--texto-muted)">${venta.tipo_doc?.toUpperCase()} ${venta.numero_doc}</div>` : ''}
        </div>
        <div style="background:var(--input-bg);border-radius:8px;padding:12px">
          <div style="font-size:10px;color:var(--texto-muted);text-transform:uppercase;margin-bottom:4px">Vendedor</div>
          <div style="font-weight:600;color:#fff">${venta.vendedor_nombre}</div>
          <div style="font-size:12px;color:var(--texto-muted)">${fecha}</div>
        </div>
        <div style="background:var(--input-bg);border-radius:8px;padding:12px">
          <div style="font-size:10px;color:var(--texto-muted);text-transform:uppercase;margin-bottom:4px">N° Comprobante</div>
          <div style="font-weight:600;color:var(--info)">${venta.numero}</div>
          <div style="font-size:12px;color:var(--texto-muted)">${venta.tipo_comprobante?.toUpperCase()}</div>
        </div>
        <div style="background:var(--input-bg);border-radius:8px;padding:12px">
          <div style="font-size:10px;color:var(--texto-muted);text-transform:uppercase;margin-bottom:4px">Estado</div>
          <span class="badge ${anulada ? 'badge-danger' : 'badge-success'}">${anulada ? 'Anulada' : 'Registrada'}</span>
          &nbsp;
          <span class="badge ${venta.estado_sunat==='aceptado'?'badge-success':venta.estado_sunat==='emitido'?'badge-info':venta.estado_sunat==='rechazado'?'badge-danger':'badge-muted'}">
            ${(venta.estado_sunat||'').replace('_',' ').toUpperCase()}</span>
        </div>
      </div>

      <div class="tabla-container" style="margin-bottom:16px">
        <table class="tabla" style="font-size:13px">
          <thead><tr><th>Producto</th><th style="text-align:right">P. Unit.</th><th style="text-align:center">Cant.</th><th style="text-align:right">Subtotal</th></tr></thead>
          <tbody>
            ${items.map(i => `<tr>
              <td>${i.producto_nombre}${i.presentacion_nombre ? `<span style="font-size:11px;color:var(--texto-muted)"> (${i.presentacion_nombre})</span>` : ''}</td>
              <td style="text-align:right">S/ ${parseFloat(i.precio_unit).toFixed(2)}</td>
              <td style="text-align:center">${i.cantidad}</td>
              <td style="text-align:right;font-weight:600;color:var(--success)">S/ ${parseFloat(i.subtotal).toFixed(2)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div>
          <div style="font-size:11px;color:var(--texto-muted);text-transform:uppercase;margin-bottom:8px;font-weight:600">Pagos</div>
          ${pagos.length ? pagos.map(p => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--card-border);font-size:13px">
            <span style="color:var(--texto-muted);text-transform:capitalize">${p.metodo}</span>
            <span style="font-weight:600">S/ ${parseFloat(p.monto).toFixed(2)}</span></div>`).join('')
            : `<div style="color:var(--texto-muted);font-size:13px">Sin pagos</div>`}
        </div>
        <div style="text-align:right">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span style="color:var(--texto-muted)">Subtotal</span><span>S/ ${parseFloat(venta.subtotal).toFixed(2)}</span></div>
          ${+venta.descuento > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="color:var(--texto-muted)">Descuento</span><span style="color:var(--danger)">-S/ ${parseFloat(venta.descuento).toFixed(2)}</span></div>` : ''}
          ${+venta.igv > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="color:var(--texto-muted)">IGV (18%)</span><span>S/ ${parseFloat(venta.igv).toFixed(2)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--card-border);padding-top:8px">
            <span style="font-weight:700">TOTAL</span>
            <span style="font-weight:700;font-size:18px;color:var(--success)">S/ ${parseFloat(venta.total).toFixed(2)}</span></div>
        </div>
      </div>

      <!-- ACCIONES según estado -->
      ${anulada
        ? `<div class="alert alert-danger" style="margin:0"><i class="ti ti-ban"></i> Venta anulada: todas las acciones están bloqueadas.</div>`
        : `<div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="_vImprimir(${venta.id},'a4')">
          <i class="ti ti-file-text"></i> Imprimir A4
        </button>
        <button class="btn btn-outline btn-sm" onclick="_vImprimir(${venta.id},'ticket')">
          <i class="ti ti-receipt"></i> Ticket 80mm
        </button>
        <button class="btn btn-outline btn-sm" onclick="_vCorreo(${venta.id})"
                style="color:var(--success);border-color:var(--success)">
          <i class="ti ti-mail"></i> Enviar correo
        </button>
        <button class="btn btn-outline btn-sm" onclick="_vWhatsapp(${venta.id})"
                style="color:#25D366;border-color:#25D366">
          <i class="ti ti-brand-whatsapp"></i> WhatsApp
        </button>
        <button class="btn btn-sm" onclick="_vHistorial(${venta.id})"
                style="background:rgba(123,31,162,.15);color:#b388ff;border:none">
          <i class="ti ti-history"></i> Historial
        </button>
        ${emitido
          ? `<button class="btn btn-primary btn-sm" onclick="_vVerComprobante(${venta.id})">
               <i class="ti ti-file-search"></i> Ver comprobante
             </button>
             <button class="btn btn-sm" onclick="_vArchivosSunat(${venta.id})"
                     style="background:rgba(0,200,83,.15);color:var(--success);border:none">
               <i class="ti ti-folder"></i> Archivos SUNAT
             </button>`
          : ''}
        ${!anulada && esNota && !emitido
          ? `<button class="btn btn-warning btn-sm" onclick="_vEmitir(${venta.id})" style="color:#000">
               <i class="ti ti-file-invoice"></i> Emitir boleta/factura
             </button>
             ${esAdmin ? `<button class="btn btn-danger btn-sm" onclick="_vEliminar(${venta.id},'${venta.numero}')">
               <i class="ti ti-trash"></i> Eliminar NV
             </button>` : ''}`
          : ''}
      </div>`}
`;
  };

  // ── EMITIR ────────────────────────────────────────────────────────────
  window._vEmitir = async function(id) {
    const res = await Http.get(`/ventas/${id}`);
    if (!res?.ok) return;
    const { venta } = res;
    if (!venta.numero_doc) {
      document.getElementById('asignar-venta-id').value = id;
      document.getElementById('asignar-doc-inp').value  = '';
      document.getElementById('asignar-resultado').innerHTML = '';
      document.getElementById('modal-asignar-doc').classList.add('open');
      return;
    }
    _mostrarModalEmitir(id, venta, res.items);
  };

  function _mostrarModalEmitir(id, venta, items) {
    const tipDoc  = venta.tipo_doc || '';
    const soloBol = tipDoc === 'dni';
    const soloFac = tipDoc === 'ruc';

    const total = +venta.total;
    const base  = parseFloat((total / 1.18).toFixed(2));
    const igv   = parseFloat((total - base).toFixed(2));

    const body = document.getElementById('emitir-body');
    body.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:var(--texto-muted);margin-bottom:12px;text-align:center">
          Selecciona el tipo de comprobante electrónico
        </div>
        <div style="display:grid;grid-template-columns:${(soloFac||soloBol)?'1fr':'1fr 1fr'};gap:12px">
          ${!soloFac ? `
            <div onclick="_nvSelTipoComp('boleta')" id="btn-sel-boleta" class="comp-card">
              <i class="ti ti-receipt" style="font-size:34px;color:var(--info);display:block;margin-bottom:8px"></i>
              <div style="font-weight:700;color:#fff;font-size:15px">Boleta</div>
              <div style="font-size:11px;color:var(--texto-muted);margin-top:3px">Para clientes con DNI</div>
              <div style="font-size:10px;color:var(--texto-muted);margin-top:2px">Serie B001 · Tipo 03</div>
            </div>` : ''}
          ${!soloBol ? `
            <div onclick="_nvSelTipoComp('factura')" id="btn-sel-factura" class="comp-card">
              <i class="ti ti-file-invoice" style="font-size:34px;color:var(--warning);display:block;margin-bottom:8px"></i>
              <div style="font-weight:700;color:#fff;font-size:15px">Factura</div>
              <div style="font-size:11px;color:var(--texto-muted);margin-top:3px">Para clientes con RUC</div>
              <div style="font-size:10px;color:var(--texto-muted);margin-top:2px">Serie F001 · Tipo 01</div>
            </div>` : ''}
        </div>
      </div>

      <div id="emitir-form" style="display:none">
        <input type="hidden" id="emitir-venta-id" value="${id}">
        <input type="hidden" id="emitir-tipo">
        <div style="background:var(--input-bg);border-radius:10px;padding:14px;margin-bottom:12px">
          <div style="font-size:10px;color:var(--texto-muted);text-transform:uppercase;margin-bottom:6px">Cliente</div>
          <div style="font-weight:600;color:#fff;font-size:14px">${venta.cliente_nombre || 'Cliente General'}</div>
          ${venta.numero_doc ? `<div style="font-size:12px;color:var(--texto-muted)">${(venta.tipo_doc||'').toUpperCase()} ${venta.numero_doc}</div>` : ''}
        </div>
        <div class="tabla-container" style="margin-bottom:12px">
          <table class="tabla" style="font-size:12px">
            <thead><tr><th>Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">V. Unit (sin IGV)</th><th style="text-align:right">Importe</th></tr></thead>
            <tbody>
              ${items.map(i => {
                const sinIgv = i.precio_unit / 1.18;
                return `<tr><td>${i.producto_nombre}</td><td style="text-align:center">${i.cantidad}</td>
                  <td style="text-align:right">S/ ${sinIgv.toFixed(2)}</td>
                  <td style="text-align:right">S/ ${(sinIgv * i.cantidad).toFixed(2)}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="background:var(--input-bg);border-radius:10px;padding:14px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
            <span style="color:var(--texto-muted)">Op. Gravada</span><span>S/ ${base.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
            <span style="color:var(--texto-muted)">IGV (18%)</span><span>S/ ${igv.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;border-top:1px solid var(--card-border);padding-top:10px">
            <span>TOTAL</span><span style="color:var(--success)">S/ ${total.toFixed(2)}</span></div>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-outline" style="flex:1" onclick="document.getElementById('emitir-form').style.display='none'">
            <i class="ti ti-arrow-left"></i> Cambiar tipo</button>
          <button class="btn btn-primary" style="flex:2" id="btn-emitir-confirmar">
            <i class="ti ti-cloud-upload"></i> Emitir y enviar a SUNAT</button>
        </div>
      </div>`;

    document.getElementById('modal-emitir').classList.add('open');

    document.getElementById('btn-emitir-confirmar').addEventListener('click', async () => {
      const tipo = document.getElementById('emitir-tipo').value;
      if (!tipo) return;
      const btn = document.getElementById('btn-emitir-confirmar');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Emitiendo...';

      const r = await Http.post(`/ventas/${id}/emitir`, { tipo });
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-cloud-upload"></i> Emitir y enviar a SUNAT';

      if (!r?.ok) { alerta('error', 'Error al emitir', r?.msg); return; }

      document.getElementById('modal-emitir').classList.remove('open');
      const swBase = { confirmButtonText: 'Listo', confirmButtonColor: '#e53935',
                       background: '#1a1a2e', color: '#e0e0e0' };
      const nombreTipo = tipo.charAt(0).toUpperCase() + tipo.slice(1);

      if (r.estado === 'aceptado') {
        await Swal.fire({ ...swBase, icon: 'success', title: '¡Aceptado por SUNAT!',
          html: `<div style="font-size:14px">${nombreTipo} <strong>${r.numero}</strong><br>
            <span style="color:#00c853;font-size:13px"><i class="ti ti-check"></i> Aceptado por SUNAT</span></div>` });
      } else if (r.estado === 'observado') {
        await Swal.fire({ ...swBase, icon: 'warning', title: 'Aceptado con observaciones',
          html: `<div style="font-size:14px">${nombreTipo} <strong>${r.numero}</strong><br>
            <span style="color:#ffb300;font-size:12px">SUNAT lo aceptó, pero con advertencias:</span><br>
            <span style="font-size:12px;color:#bbb">${r.observaciones || r.msg || ''}</span></div>` });
      } else if (r.estado === 'pendiente') {
        await Swal.fire({ ...swBase, icon: 'info', title: 'Generado, pendiente de SUNAT',
          html: `<div style="font-size:14px">${nombreTipo} <strong>${r.numero}</strong><br>
            <span style="font-size:12px;color:#bbb">${r.msg || 'El comprobante se generó pero SUNAT aún no lo confirma. Usa "Reintentar envío".'}</span></div>` });
      } else if (r.estado === 'rechazado') {
        await Swal.fire({ ...swBase, icon: 'error', title: 'SUNAT rechazó el comprobante',
          html: `<div style="font-size:13px;text-align:left">
            <div style="margin-bottom:8px">${r.codigo ? '<strong>Código '+r.codigo+'</strong><br>' : ''}${r.msg || ''}</div>
            <div style="color:#bbb;font-size:12px">Corrige los datos del cliente o productos y vuelve a emitir con el botón <i class="ti ti-refresh"></i>.</div>
          </div>` });
      } else {
        await Swal.fire({ ...swBase, icon: 'success', title: 'Comprobante emitido',
          html: `<div style="font-size:14px">${nombreTipo} <strong>${r.numero || ''}</strong></div>` });
      }
      await cargar();
    });
  }

  window._nvSelTipoComp = function(tipo) {
    const bB = document.getElementById('btn-sel-boleta');
    const bF = document.getElementById('btn-sel-factura');
    if (bB) bB.classList.toggle('sel', tipo === 'boleta');
    if (bF) bF.classList.toggle('sel', tipo === 'factura');
    document.getElementById('emitir-tipo').value = tipo;
    document.getElementById('emitir-form').style.display = 'block';
  };

  // ── REINTENTAR envío a SUNAT (comprobantes pendientes) ────────────────
  window._vReintentar = async function(id) {
    const conf = await Swal.fire({
      icon: 'question', title: 'Reintentar envío a SUNAT',
      text: 'Se volverá a enviar el comprobante generado a SUNAT. ¿Continuar?',
      showCancelButton: true, confirmButtonText: 'Sí, reintentar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#e53935', background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;

    Swal.fire({ title: 'Enviando a SUNAT...', allowOutsideClick: false,
      background: '#1a1a2e', color: '#e0e0e0', didOpen: () => Swal.showLoading() });

    const r = await Http.post(`/ventas/${id}/reintentar-envio`, {});
    const swBase = { confirmButtonText: 'Listo', confirmButtonColor: '#e53935',
                     background: '#1a1a2e', color: '#e0e0e0' };

    if (!r?.ok) { Swal.fire({ ...swBase, icon: 'error', title: 'Error', text: r?.msg }); return; }

    if (r.estado === 'aceptado') {
      await Swal.fire({ ...swBase, icon: 'success', title: '¡Aceptado por SUNAT!', text: r.msg });
    } else if (r.estado === 'observado') {
      await Swal.fire({ ...swBase, icon: 'warning', title: 'Aceptado con observaciones',
        html: `<div style="font-size:12px;color:#bbb">${r.observaciones || r.msg || ''}</div>` });
    } else if (r.estado === 'rechazado') {
      await Swal.fire({ ...swBase, icon: 'error', title: 'SUNAT lo rechazó',
        html: `<div style="font-size:13px">${r.codigo ? '<strong>Código '+r.codigo+'</strong><br>' : ''}${r.msg || ''}</div>` });
    } else {
      await Swal.fire({ ...swBase, icon: 'info', title: 'Sigue pendiente', text: r.msg });
    }
    await cargar();
  };

  // ── Asignar documento antes de emitir ─────────────────────────────────
  document.getElementById('btn-asignar-buscar').addEventListener('click', async () => {
    const doc = document.getElementById('asignar-doc-inp').value.trim();
    const res$= document.getElementById('asignar-resultado');
    if (!/^\d+$/.test(doc) || (doc.length !== 8 && doc.length !== 11)) {
      res$.innerHTML = `<span style="color:var(--warning)">DNI: 8 dígitos · RUC: 11 dígitos</span>`;
      return;
    }
    const tipo = doc.length === 11 ? 'ruc' : 'dni';
    const id   = +document.getElementById('asignar-venta-id').value;
    res$.innerHTML = `<span style="color:var(--texto-muted)"><span class="spinner" style="width:12px;height:12px;border-width:2px"></span> Buscando...</span>`;

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
        apellido_paterno: c.apellido_paterno || '',
        apellido_materno: c.apellido_materno || '',
        direccion: c.direccion || '', distrito: c.distrito || '',
        provincia: c.provincia || '', departamento: c.departamento || '',
        origen_api: 1
      });
      if (crear?.ok) c.id = crear.id;
    }
    if (!c.id) {
      res$.innerHTML = `<span style="color:var(--danger)">No se pudo registrar el cliente</span>`;
      return;
    }

    const upd = await Http.put(`/ventas/${id}/cliente`, { cliente_id: c.id });
    if (!upd?.ok) {
      res$.innerHTML = `<span style="color:var(--danger)">${upd?.msg || 'Error al asignar'}</span>`;
      return;
    }

    document.getElementById('modal-asignar-doc').classList.remove('open');
    const res2 = await Http.get(`/ventas/${id}`);
    if (res2?.ok) _mostrarModalEmitir(id, res2.venta, res2.items);
  });

  document.getElementById('asignar-doc-inp').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });
  document.getElementById('asignar-doc-inp').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-asignar-buscar').click();
  });

  // ── VER COMPROBANTE (visor PDF con QR) ────────────────────────────────
  let _visorPdfUrl = null;

  window._vVerComprobante = async function(id) {
    const ventaRes = await Http.get(`/ventas/${id}`);
    if (!ventaRes?.ok) return alerta('error','Error','No se pudo cargar la venta');
    const venta = ventaRes.venta || {};
    const esNota = ['nota','nota_venta'].includes(venta.tipo_comprobante);
    let pdfUrl = '', titulo = venta.numero || 'Documento', a = {};
    if (esNota) {
      const pdf = await Http.get(`/ventas/${id}/pdf?formato=a4`);
      if (!pdf?.ok || !pdf.url) return alerta('warning','PDF no disponible',pdf?.msg || 'No se pudo generar la nota');
      pdfUrl = pdf.url;
      titulo = `${venta.numero} — Nota de venta`;
    } else {
      const res = await Http.get(`/ventas/${id}/archivos`);
      if (!res?.ok) return alerta('info','Sin comprobante',res?.msg || 'Esta venta no tiene comprobante emitido');
      a = res.archivos || {};
      pdfUrl = a.pdf_a4 || a.pdf_ticket;
      if (!pdfUrl) return alerta('warning','PDF no disponible','El comprobante no tiene PDF generado');
      titulo = `${res.numero || venta.numero || 'Comprobante'} — ${res.estado === 'aceptado' ? 'Aceptado por SUNAT ✓' : (res.estado || '').toUpperCase()}`;
    }
    _visorPdfUrl = pdfUrl;
    document.getElementById('visor-titulo').textContent = titulo;
    document.getElementById('visor-iframe').src = pdfUrl;
    const setBtn = (btnId, url) => {
      const b = document.getElementById(btnId);
      if (url) { b.style.display = 'inline-flex'; b.onclick = () => window.open(url, '_blank'); }
      else b.style.display = 'none';
    };
    setBtn('btn-visor-xml-sf', a.xml_sin_firmar);
    setBtn('btn-visor-xml', a.xml);
    setBtn('btn-visor-cdr', a.cdr);
    document.getElementById('modal-visor').classList.add('open');
  };

  // ── ARCHIVOS SUNAT (lista completa de documentos) ─────────────────────
  window._vArchivosSunat = async function(id) {
    const res = await Http.get(`/ventas/${id}/archivos`);
    if (!res?.ok) { alerta('info', 'Sin comprobante', res?.msg || 'Esta venta no tiene comprobante emitido'); return; }

    const a = res.archivos;
    const ce = res.cdr_estado || res.estado;
    const pdfUrl = a.pdf_a4 || a.pdf_ticket;

    const estadoUI = {
      aceptado:  { cls:'badge-success', txt:'✓ ACEPTADO POR SUNAT' },
      observado: { cls:'badge-warning', txt:'⚠ ACEPTADO CON OBSERVACIONES' },
      rechazado: { cls:'badge-danger',  txt:'✕ RECHAZADO POR SUNAT' },
      pendiente: { cls:'badge-warning', txt:'⏳ PENDIENTE DE SUNAT' }
    }[ce] || { cls:'badge-muted', txt:(res.estado||'').toUpperCase() };

    const fila = (url, icon, color, txt, sub) => url
      ? `<button class="sunat-file-btn" onclick="window.open('${url}','_blank')">
           <i class="ti ${icon}" style="color:${color}"></i>
           <div class="sf-txt"><div>${txt}</div><div class="sf-sub">${sub}</div></div>
           <i class="ti ti-download" style="color:var(--texto-muted);font-size:15px"></i>
         </button>` : '';

    const body = document.getElementById('emitir-body');
    body.innerHTML = `
      <div style="text-align:center;margin-bottom:18px">
        <div style="font-size:11px;color:var(--texto-muted);text-transform:uppercase;margin-bottom:6px">
          Acciones de Comprobante</div>
        <div style="font-weight:700;color:var(--info);font-size:18px">${res.numero || ''}</div>
        <span class="badge ${estadoUI.cls}" style="font-size:12px;padding:6px 14px;margin-top:6px;display:inline-block">
          ${estadoUI.txt}</span>
        ${res.codigo ? `<div style="font-size:11px;color:var(--texto-muted);margin-top:6px">Código SUNAT: ${res.codigo}</div>` : ''}
        ${res.mensaje ? `<div style="font-size:11px;color:${ce==='rechazado'?'#ff6b6b':'var(--texto-muted)'};margin-top:4px">${res.mensaje}</div>` : ''}
        ${ce==='pendiente' ? `<div style="margin-top:10px"><button class="btn btn-warning btn-sm" style="color:#000" onclick="document.getElementById('modal-emitir').classList.remove('open');_vReintentar(${id})"><i class="ti ti-cloud-upload"></i> Reintentar envío</button></div>` : ''}
        ${ce==='rechazado' ? `<div style="margin-top:10px"><button class="btn btn-warning btn-sm" style="color:#000" onclick="document.getElementById('modal-emitir').classList.remove('open');_vEmitir(${id})"><i class="ti ti-refresh"></i> Corregir y reemitir</button></div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${fila(a.xml_sin_firmar, 'ti-file-code', 'var(--texto-muted)', 'XML sin firmar', 'Documento sin firma digital')}
        ${fila(a.xml,            'ti-file-code', 'var(--info)',        'XML firmado',    'Comprobante electrónico oficial')}
        ${fila(a.pdf_a4,         'ti-file-type-pdf', '#e53935',        'PDF formato A4', 'Representación impresa')}
        ${fila(a.pdf_ticket,     'ti-receipt',   '#e53935',           'PDF formato Ticket', 'Impresora térmica 80mm')}
        ${fila(a.cdr,            'ti-certificate','var(--success)',    'CDR de SUNAT', 'Constancia de recepción')}
        ${pdfUrl
          ? `<button class="sunat-file-btn" onclick="_vVerComprobante(${id})" style="border-color:var(--rojo)">
               <i class="ti ti-qrcode" style="color:var(--rojo)"></i>
               <div class="sf-txt"><div>Imprimir con código QR</div><div class="sf-sub">Abre el visor del comprobante</div></div>
               <i class="ti ti-chevron-right" style="color:var(--texto-muted);font-size:15px"></i>
             </button>` : ''}
      </div>`;
    document.getElementById('modal-emitir').classList.add('open');
  };

  // ── CORREO ────────────────────────────────────────────────────────────
  window._vWhatsapp = async function(id) {
    const res = await Http.get(`/ventas/${id}`);
    if (!res?.ok) return alerta('error', 'Error', 'No se pudo cargar la venta');
    const v = res.venta;

    let tel = String(v.cliente_telefono || '').replace(/\D/g, '');
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

    const esNota  = ['nota','nota_venta'].includes(v.tipo_comprobante);
    const emitido = ['emitido', 'aceptado', 'rechazado'].includes(v.estado_sunat);
    let enlaces = '';
    if (!esNota && emitido) {
      const arch = await Http.get(`/ventas/${id}/archivos`);
      const a = arch?.archivos || {};
      if (a.pdf_a4)      enlaces += `\n\n📄 PDF:\n${a.pdf_a4}`;
      if (a.xml_firmado) enlaces += `\n\n📋 XML:\n${a.xml_firmado}`;
      if (a.cdr_path)    enlaces += `\n\n✅ CDR:\n${a.cdr_path}`;
    } else {
      // Nota de venta → generamos nuestro PDF y mandamos el enlace
      try {
        const p = await Http.get(`/ventas/${id}/pdf`);
        if (p?.ok && p.url) enlaces += `\n\n📄 Nota de venta en PDF:\n${p.url}`;
      } catch (e) {}
    }

    const empresa = (typeof empresaCfg !== 'undefined' && empresaCfg?.nombre) || 'Distribuciones MAOZ E.I.R.L.';
    const mensaje =
`Estimado/a ${v.cliente_nombre || 'cliente'}:

Su comprobante ${v.numero} de ${empresa} ha sido emitido correctamente.` +
      (enlaces || '\n\nGracias por su compra.');

    window.open(`https://wa.me/51${tel}?text=${encodeURIComponent(mensaje)}`, '_blank');
  };

  window._vCorreo = async function(id) {
    const arch = await Http.get(`/ventas/${id}/archivos`);
    const tieneComp = arch?.ok;
    document.getElementById('correo-aviso-adjuntos').style.display = tieneComp ? 'block' : 'none';
    document.getElementById('correo-venta-id').value = id;
    document.getElementById('correo-email').value    = '';
    document.getElementById('modal-correo').classList.add('open');
  };

  document.getElementById('btn-enviar-correo').addEventListener('click', async () => {
    const id    = document.getElementById('correo-venta-id').value;
    const email = document.getElementById('correo-email').value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return alerta('error', 'Error', 'Ingresa un correo válido');

    document.getElementById('modal-correo').classList.remove('open');
    Swal.fire({ title: 'Enviando...', html: '<div class="spinner" style="margin:0 auto;width:30px;height:30px"></div>',
      showConfirmButton: false, allowOutsideClick: false, background: '#1a1a2e', color: '#e0e0e0' });

    const res = await Http.post(`/ventas/${id}/enviar-correo`, { email });
    Swal.close();
    Swal.fire({
      icon: res?.ok ? 'success' : 'error',
      title: res?.ok ? 'Correo enviado' : 'Error',
      text:  res?.ok ? res.msg : res?.msg,
      background: '#1a1a2e', color: '#e0e0e0', confirmButtonColor: '#e53935',
      timer: res?.ok ? 2500 : undefined, showConfirmButton: !res?.ok
    });
  });

  // ── ELIMINAR ──────────────────────────────────────────────────────────
  window._vEliminar = async function(id, numero) {
    const conf = await Swal.fire({
      title: `¿Eliminar "${numero}"?`,
      html: `<div style="font-size:13px;color:var(--texto-muted)">Solo se pueden eliminar notas de venta. Se revertirá el stock. Esta acción no se puede deshacer.</div>`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#e53935', background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;

    const res = await Http.patch(`/ventas/${id}/anular`, {});
    if (!res?.ok) return alerta('error', 'Error', res?.msg);

    document.getElementById('modal-detalle').classList.remove('open');
    alerta('success', 'Nota de venta eliminada', '', 1500);
    await cargar();
  };

  // ── LIMPIAR MODAL NV ──────────────────────────────────────────────────
  function nvLimpiar() {
    nvItems = []; nvPagos = [];
    nvQuitarCotizacion();
    nvLimpiarCliente();
    document.getElementById('nv-descuento').value   = '0';
    document.getElementById('nv-observacion').value = '';
    // Sucursal por defecto de la venta:
    //  - Admin global → "Bidones" si existe, si no la primera sucursal.
    //  - Vendedor     → su propia sucursal.
    if (esGlobal && sucursales.length) {
      const def = cajaSucursalId ? sucursales.find(s => Number(s.id) === Number(cajaSucursalId)) : (sucursales.find(s => /bidon/i.test(s.nombre)) || sucursales[0]);
      nvSucursalVenta = def ? def.id : null;
    } else {
      nvSucursalVenta = miSucursal || (sucursales[0] && sucursales[0].id) || null;
    }
    nvRenderItems(); nvRenderPagos(); nvCalcTotales();
  }

  // ── EVENTOS ───────────────────────────────────────────────────────────
  document.getElementById('btn-nueva-venta').addEventListener('click', () => {
    nvLimpiar(); document.getElementById('modal-venta').classList.add('open');
  });
  document.getElementById('btn-cerrar-venta').addEventListener('click', () => {
    document.getElementById('modal-venta').classList.remove('open');
  });
  document.getElementById('btn-nv-buscar-cli').addEventListener('click', nvBuscarCliente);
  document.getElementById('nv-doc-buscar').addEventListener('keydown', e => {
    if (e.key === 'Enter') nvBuscarCliente();
  });
  document.getElementById('nv-doc-buscar').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });
  document.getElementById('btn-nv-limpiar-cli').addEventListener('click', nvLimpiarCliente);
  document.getElementById('btn-nv-agregar-prod').addEventListener('click', async () => {
    document.getElementById('nv-prod-buscar-inp').value = '';
    document.getElementById('modal-prod-buscar').classList.add('open');
    await nvCargarProductos();
  });
  // Cargar cotización
  document.getElementById('btn-nv-cargar-cot').addEventListener('click', nvAbrirCargarCot);
  document.getElementById('btn-cerrar-cargar-cot').addEventListener('click', () => {
    document.getElementById('modal-cargar-cot').classList.remove('open');
  });
  document.getElementById('btn-nv-quitar-cot').addEventListener('click', nvQuitarCotizacion);
  document.getElementById('modal-cargar-cot').addEventListener('click', e => {
    if (e.target.id === 'modal-cargar-cot') e.target.classList.remove('open');
  });
  document.getElementById('nv-prod-buscar-inp').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    nvRenderProductosModal(nvProdsSucursal().filter(p =>
      p.nombre.toLowerCase().includes(q)));
  });
  document.getElementById('btn-cerrar-prod-buscar').addEventListener('click', () => {
    document.getElementById('modal-prod-buscar').classList.remove('open');
  });
  document.getElementById('btn-cerrar-presentaciones').addEventListener('click', () => {
    document.getElementById('modal-presentaciones').classList.remove('open');
  });
  document.getElementById('btn-nv-agregar-pago').addEventListener('click', () => {
    if (cajaSucursalId && nvSucursalVenta && Number(cajaSucursalId) !== Number(nvSucursalVenta)) {
      return alerta('warning','Efectivo no disponible para esta sucursal',`La caja abierta pertenece a ${cajaSucursalNombre || 'otra sucursal'}. Usa un medio digital o cambia la venta a la sucursal de la caja.`);
    }
    const total  = nvItems.reduce((a, i) => a + i.subtotal, 0) - (+document.getElementById('nv-descuento').value || 0);
    const pagado = nvPagos.reduce((a, p) => a + (+p.monto || 0), 0);
    nvPagos.push({ metodo: 'efectivo', monto: Math.max(0, total - pagado) });
    nvRenderPagos();
  });

  // Validación numérica del descuento (solo números positivos)
  const descInp = document.getElementById('nv-descuento');
  descInp.addEventListener('keydown', bloquearTeclasNum);
  descInp.addEventListener('input', e => {
    sanearNumero(e.target);
    if (+e.target.value < 0) e.target.value = '0';
    nvCalcTotales();
  });

  document.getElementById('btn-nv-registrar').addEventListener('click', nvRegistrar);

  document.getElementById('btn-cerrar-detalle').addEventListener('click', () => {
    document.getElementById('modal-detalle').classList.remove('open');
  });
  document.getElementById('btn-cerrar-emitir').addEventListener('click', () => {
    document.getElementById('modal-emitir').classList.remove('open');
  });
  document.getElementById('btn-cerrar-correo').addEventListener('click', () => {
    document.getElementById('modal-correo').classList.remove('open');
  });
  document.getElementById('btn-cancelar-correo').addEventListener('click', () => {
    document.getElementById('modal-correo').classList.remove('open');
  });
  document.getElementById('btn-cerrar-imprimir').addEventListener('click', () => {
    document.getElementById('modal-imprimir').classList.remove('open');
  });
  document.getElementById('btn-cerrar-historial').addEventListener('click', () => {
    document.getElementById('modal-historial').classList.remove('open');
  });
  document.getElementById('btn-cerrar-asignar-doc').addEventListener('click', () => {
    document.getElementById('modal-asignar-doc').classList.remove('open');
  });

  // Visor
  document.getElementById('btn-cerrar-visor').addEventListener('click', () => {
    document.getElementById('modal-visor').classList.remove('open');
    document.getElementById('visor-iframe').src = '';
  });
  document.getElementById('btn-visor-imprimir').addEventListener('click', () => {
    const ifr = document.getElementById('visor-iframe');
    try { ifr.contentWindow.focus(); ifr.contentWindow.print(); }
    catch(e) { if (_visorPdfUrl) window.open(_visorPdfUrl, '_blank'); }
  });
  document.getElementById('btn-visor-descargar').addEventListener('click', () => {
    if (_visorPdfUrl) window.open(_visorPdfUrl, '_blank');
  });

  // Cerrar al click fuera
  ['modal-venta','modal-prod-buscar','modal-presentaciones','modal-detalle',
   'modal-emitir','modal-correo','modal-imprimir','modal-asignar-doc','modal-visor',
   'modal-print','modal-historial'].forEach(mid => {
    const el = document.getElementById(mid);
    if (el) el.addEventListener('click', e => {
      if (e.target.id === mid) el.classList.remove('open');
    });
  });

  document.getElementById('btn-filtrar').addEventListener('click', () => { pagina = 1; cargar(); });
  document.getElementById('inp-buscar').addEventListener('input', e => {
    buscar = e.target.value; pagina = 1; renderTabla();
  });
  document.getElementById('sel-limite').addEventListener('change', e => {
    limite = parseInt(e.target.value); pagina = 1; renderTabla();
  });

  // Saber si el usuario es Administrador (para mostrar/ocultar "Eliminar")
  try {
    const s   = await Http.get('/auth/session');
    const usr = s?.usuario || s?.user || s?.data || s;
    if (usr && typeof usr.perfil_nombre === 'string')
      esAdmin = (usr.perfil_nombre === 'Administrador');
    if (usr) esGlobal = !!usr.es_global;
    if (usr) miSucursal = usr.sucursal_id || null;
  } catch (e) { /* si falla, se deja visible y el backend valida */ }

  try {
    const caja=await Http.get('/caja/actual');
    if(caja?.ok && caja.sesion){cajaSucursalId=Number(caja.sesion.sucursal_id)||null;cajaSucursalNombre=caja.sesion.sucursal_nombre||'';}
  } catch(_) {}
  await cargarEmpresa();
  await cargarSucursales();
  await cargar();
};