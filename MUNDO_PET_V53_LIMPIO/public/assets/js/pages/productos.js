window.init_productos = async function () {

  const html = await fetch('/views/pages/productos.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  // Estilos de las pestañas de sucursal
  const _st = document.createElement('style');
  _st.textContent = `
    .suc-tab{background:none;border:none;border-bottom:2px solid transparent;
             padding:9px 16px;font-size:14px;color:var(--texto-muted);cursor:pointer}
    .suc-tab.active{color:var(--rojo);border-bottom-color:var(--rojo);font-weight:600}
  `;
  document.head.appendChild(_st);

  // ── Regex de validación ────────────────────────────────
  const RE_ALFANUM     = /^[A-Za-z0-9ÁÉÍÓÚáéíóúÑñ\s]+$/;
  const RE_SOLO_LETRAS = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/;

  let todos      = [];
  let sucursales = [];
  let sucActiva  = null;            // null = todas
  let pagina     = 1;
  let limite     = 10;
  let buscar     = '';
  let archivos   = [];

  const esGlobal = !!window._esGlobal;
  const perfilActual = String(window._usuario?.perfil_nombre || '').trim().toLowerCase();
  const esAdmin  = esGlobal || perfilActual === 'administrador' || perfilActual.startsWith('administrador ');
  const puedeCrear = esGlobal;

  // Los precios y ofertas solo pueden ser modificados por el administrador global.
  ['prod-precio-costo','prod-precio-venta','prod-oferta'].forEach(id => {
    const campo = document.getElementById(id);
    if (!campo) return;
    campo.disabled = !esGlobal;
    if (!esGlobal) campo.title = 'Solo el administrador global puede modificar precios';
  });

  // ── SUCURSALES (pestañas + selector del formulario) ─────
  async function cargarSucursales() {
    const res  = await Http.get('/sucursales');
    sucursales = res?.ok ? res.sucursales : [];

    const sel = document.getElementById('prod-sucursal');
    if (sel) {
      sel.innerHTML = '<option value="">Selecciona sucursal</option>'
        + sucursales.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
    }
    // El selector de sucursal solo lo ve el admin (los demás van fijos a su sucursal)
    document.getElementById('grupo-sucursal').style.display = esAdmin ? '' : 'none';

    // Las pestañas solo para admin/global
    if (esAdmin && sucursales.length) renderTabs();
  }

  function renderTabs() {
    const cont = document.getElementById('prod-tabs');
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
    const res = await Http.get('/productos');
    if (!res?.ok) return;
    todos = res.productos;
    renderTabla();
  }

  function renderTabla() {
    const q = buscar.toLowerCase();
    const filtrados = todos.filter(p => {
      if (sucActiva != null && p.sucursal_id !== sucActiva) return false;
      return (
        p.nombre?.toLowerCase().includes(q) ||
        (p.marca || '').toLowerCase().includes(q) ||
        (p.sucursal_nombre || '').toLowerCase().includes(q)
      );
    });

    const total  = filtrados.length;
    const inicio = (pagina - 1) * limite;
    const fin    = inicio + limite;
    const data   = filtrados.slice(inicio, fin);
    const tbody  = document.getElementById('tbody-productos');

    if (!data.length) {
      tbody.innerHTML = `
        <tr><td colspan="7">
          <div class="empty-state">
            <i class="ti ti-package"></i>
            <p>No se encontraron productos</p>
          </div>
        </td></tr>`;
    } else {
      tbody.innerHTML = data.map(p => {
        const stockCritico = p.stock_actual <= p.stock_minimo;
        const activo       = p.estado === 0;
        const img          = p.imagen_portada
          ? `<img src="${p.imagen_portada}"
                  style="width:38px;height:38px;object-fit:cover;border-radius:6px;
                         margin-right:10px;border:1px solid var(--card-border)"
                  onerror="this.style.display='none'">`
          : `<div style="width:38px;height:38px;background:var(--input-bg);
                         border-radius:6px;margin-right:10px;flex-shrink:0;
                         display:inline-flex;align-items:center;
                         justify-content:center;
                         border:1px solid var(--card-border)">
               <i class="ti ti-photo"
                  style="color:var(--texto-muted);font-size:14px"></i>
             </div>`;
        return `
          <tr>
            <td>
              <div style="display:flex;align-items:center">
                ${img}
                <div>
                  <div style="font-weight:500;color:var(--texto-fuerte)">${p.nombre}</div>
                  ${Number(p.es_transferido) === 1 ? `<div style="font-size:10px;color:var(--info);margin-top:3px">
                    <i class="ti ti-transfer"></i> Transferido desde ${p.sucursal_origen_nombre || 'otra sucursal'}
                  </div>` : ''}
                </div>
              </div>
            </td>
            <td>${p.sucursal_nombre || '<span class="text-muted">—</span>'}</td>
            <td style="font-weight:600;color:var(--success)">
              S/ ${parseFloat(p.precio_venta).toFixed(2)}
            </td>
            <td style="font-weight:600">${p.stock_actual}</td>
            <td>
              <span class="badge ${stockCritico ? 'badge-danger' : 'badge-success'}">
                ${stockCritico ? 'Crítico' : 'Óptimo'}
              </span>
            </td>
            <td>
              <span class="badge ${activo ? 'badge-success' : 'badge-muted'}">
                ${activo ? 'Activo' : 'Inactivo'}
              </span>
            </td>
            <td>
              <div style="display:flex;gap:6px">
                <button class="btn btn-warning btn-xs"
                        onclick="_editarProducto(${p.id})" title="Editar">
                  <i class="ti ti-edit"></i>
                </button>
                <button class="btn btn-danger btn-xs"
                        onclick="_eliminarProducto(${p.id},'${p.nombre.replace(/'/g,"\\'")}')"
                        title="Eliminar">
                  <i class="ti ti-trash"></i>
                </button>
              </div>
            </td>
          </tr>`;
      }).join('');
    }

    const totalPags = Math.ceil(total / limite) || 1;
    document.getElementById('pag-info').textContent = total
      ? `Mostrando ${inicio + 1} a ${Math.min(fin, total)} de ${total} registros`
      : 'Sin registros';

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

  // ── TABS del modal (info / imágenes / volumen) ──────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn')
        .forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel')
        .forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

      const prodId = document.getElementById('prod-id').value;
      if (btn.dataset.tab === 'imagenes') {
        if (prodId) {
          document.getElementById('upload-zona').style.display   = 'block';
          document.getElementById('prod-id-aviso').style.display = 'none';
          cargarImagenes(+prodId);
        } else {
          document.getElementById('upload-zona').style.display   = 'none';
          document.getElementById('prod-id-aviso').style.display = 'flex';
        }
      }
      if (btn.dataset.tab === 'volumen') {
        if (prodId) {
          document.getElementById('vol-zona').style.display     = 'block';
          document.getElementById('vol-id-aviso').style.display = 'none';
          cargarVolumenes(+prodId);
        } else {
          document.getElementById('vol-zona').style.display     = 'none';
          document.getElementById('vol-id-aviso').style.display = 'flex';
        }
      }
    });
  });

  // ── MODAL ───────────────────────────────────────────────
  function abrirModal(titulo = 'Nuevo Producto') {
    document.getElementById('modal-titulo').textContent = titulo;
    document.getElementById('modal-overlay').classList.add('open');
    document.querySelectorAll('.tab-btn')
      .forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel')
      .forEach(p => p.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="info"]').classList.add('active');
    document.getElementById('tab-info').classList.add('active');
  }

  function cerrarModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    limpiarModal();
  }

  function limpiarModal() {
    ['prod-id','prod-nombre','prod-marca','prod-descripcion',
     'prod-precio-costo','prod-precio-venta','prod-oferta',
     'prod-stock-min','prod-garantia','prod-atributo']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    document.getElementById('prod-sucursal').value             = '';
    document.getElementById('prod-sucursal').disabled          = false;
    document.getElementById('prod-estado').value               = '0';
    document.getElementById('grupo-estado-prod').style.display = 'none';
    document.getElementById('galeria-imgs').innerHTML          = '';
    document.getElementById('preview-container').style.display = 'none';
    document.getElementById('preview-imgs').innerHTML          = '';
    document.getElementById('prod-stock').value                = '0';
    document.getElementById('prod-stock').setAttribute('readonly', true);
    document.getElementById('prod-stock').style.opacity        = '.6';
    document.getElementById('prod-stock').style.cursor         = 'not-allowed';
    // Limpiar pestaña de volumen
    const volBody = document.getElementById('vol-tbody');
    if (volBody) volBody.innerHTML = '';
    const volCant = document.getElementById('vol-cantidad');
    const volPre  = document.getElementById('vol-precio');
    if (volCant) volCant.value = '';
    if (volPre)  volPre.value  = '';
    if (document.getElementById('vol-zona'))     document.getElementById('vol-zona').style.display     = 'none';
    if (document.getElementById('vol-id-aviso')) document.getElementById('vol-id-aviso').style.display = 'none';
    archivos = [];
    limpiarErrores();
  }

  // ── Helpers de error ────────────────────────────────────
  function mostrarError(campo, mensaje) {
    const el  = document.getElementById(`err-${campo}`);
    const inp = document.getElementById(campo);
    if (el)  { el.textContent = mensaje; el.style.display = 'block'; }
    if (inp) inp.style.borderColor = 'var(--danger)';
  }
  function ocultarError(campo) {
    const el  = document.getElementById(`err-${campo}`);
    const inp = document.getElementById(campo);
    if (el)  el.style.display = 'none';
    if (inp) inp.style.borderColor = '';
  }
  function limpiarErrores() {
    ['prod-nombre','prod-descripcion','prod-marca','prod-atributo','prod-sucursal'].forEach(ocultarError);
  }

  // ── IMÁGENES ────────────────────────────────────────────
  const TIPOS_PERMITIDOS = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  function filtrarImagenes(lista) {
    const validas    = [];
    let huboInvalido = false;
    for (const f of lista) {
      if (TIPOS_PERMITIDOS.includes(f.type)) validas.push(f);
      else huboInvalido = true;
    }
    if (huboInvalido) {
      Swal.fire({
        icon: 'warning', title: 'Archivo no permitido',
        text: 'Solo se aceptan imágenes JPG, PNG o WEBP.',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });
    }
    return validas;
  }

  document.getElementById('inp-imagen').addEventListener('change', e => {
    const validas = filtrarImagenes(Array.from(e.target.files));
    archivos = [...archivos, ...validas];
    mostrarPreview();
    e.target.value = '';
  });

  document.getElementById('drop-zona').addEventListener('dragover', e => {
    e.preventDefault();
  });

  document.getElementById('drop-zona').addEventListener('drop', e => {
    e.preventDefault();
    const validas = filtrarImagenes(Array.from(e.dataTransfer.files));
    archivos = [...archivos, ...validas];
    mostrarPreview();
  });

  function mostrarPreview() {
    if (!archivos.length) {
      document.getElementById('preview-container').style.display = 'none';
      return;
    }
    const container = document.getElementById('preview-container');
    const previewEl = document.getElementById('preview-imgs');
    container.style.display = 'block';
    document.getElementById('preview-count').textContent = archivos.length;
    previewEl.innerHTML = '';
    archivos.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = e => {
        const div = document.createElement('div');
        div.style.cssText = 'position:relative;width:80px;height:80px';
        div.innerHTML = `
          <img src="${e.target.result}"
               style="width:80px;height:80px;object-fit:cover;border-radius:8px;
                      border:1px solid var(--card-border)">
          <button onclick="this.parentElement.remove();_quitarArchivo(${idx})"
                  style="position:absolute;top:-6px;right:-6px;
                         background:var(--rojo);border:none;color:#fff;
                         width:18px;height:18px;border-radius:50%;cursor:pointer;
                         font-size:10px;display:flex;align-items:center;
                         justify-content:center">
            <i class="ti ti-x"></i>
          </button>
          <div style="position:absolute;bottom:2px;left:2px;right:2px;
                      background:rgba(0,0,0,.65);border-radius:4px;
                      font-size:9px;color:#fff;text-align:center;padding:1px">
            ${file.name.slice(0,10)}
          </div>`;
        previewEl.appendChild(div);
      };
      reader.readAsDataURL(file);
    });
  }

  window._quitarArchivo = function(idx) {
    archivos.splice(idx, 1);
    document.getElementById('preview-count').textContent = archivos.length;
    if (!archivos.length)
      document.getElementById('preview-container').style.display = 'none';
  };

  document.getElementById('btn-subir-img').addEventListener('click', async () => {
    const prodId = document.getElementById('prod-id').value;
    if (!prodId || !archivos.length) return;

    const btn = document.getElementById('btn-subir-img');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"
      style="width:14px;height:14px;border-width:2px"></span>
      Subiendo ${archivos.length} imagen(es)...`;

    for (const archivo of archivos) {
      const fd = new FormData();
      fd.append('imagen', archivo);
      await Http.postForm(`/productos/${prodId}/imagenes`, fd);
    }

    archivos = [];
    document.getElementById('inp-imagen').value        = '';
    document.getElementById('preview-container').style.display = 'none';
    document.getElementById('preview-imgs').innerHTML  = '';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-upload"></i> Subir todas';
    await cargarImagenes(+prodId);
    await cargar();
    Swal.fire({
      icon: 'success', title: 'Imágenes subidas',
      timer: 1500, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
  });

  document.getElementById('btn-cancelar-preview').addEventListener('click', () => {
    archivos = [];
    document.getElementById('preview-container').style.display = 'none';
    document.getElementById('preview-imgs').innerHTML = '';
    document.getElementById('inp-imagen').value = '';
  });

  async function cargarImagenes(prodId) {
    const res       = await Http.get(`/productos/${prodId}/imagenes`);
    const galeria   = document.getElementById('galeria-imgs');
    const galTitulo = document.getElementById('galeria-titulo');
    if (!res?.ok) return;

    if (!res.imagenes.length) {
      galeria.innerHTML    = `
        <div class="empty-state" style="width:100%">
          <i class="ti ti-photo"></i>
          <p>Sin imágenes. Sube la primera arriba.</p>
        </div>`;
      galTitulo.textContent = '';
      return;
    }

    galTitulo.textContent = 'Imágenes guardadas — elige cuál será la portada';
    galeria.innerHTML = res.imagenes.map(img => `
      <div style="position:relative;width:120px" id="gimg-${img.id}">
        <img src="${img.ruta}"
             style="width:120px;height:120px;object-fit:cover;border-radius:8px;
                    border:2px solid ${img.es_portada
                      ? 'var(--rojo)' : 'var(--card-border)'}"
             onerror="this.src='/assets/img/no-img.png'">
        <button onclick="_eliminarImagen(${prodId},${img.id})"
                title="Eliminar imagen"
                style="position:absolute;top:4px;right:4px;background:var(--rojo);
                       border:none;color:#fff;width:24px;height:24px;
                       border-radius:50%;cursor:pointer;display:flex;
                       align-items:center;justify-content:center;font-size:13px">
          <i class="ti ti-x"></i>
        </button>
        ${img.es_portada
          ? `<div style="position:absolute;bottom:4px;left:4px;right:4px;
                         background:var(--rojo);color:#fff;font-size:10px;
                         padding:4px 0;border-radius:5px;text-align:center;
                         font-weight:700;letter-spacing:.5px">
               <i class="ti ti-star-filled"></i> PORTADA
             </div>`
          : `<button onclick="_setPortada(${prodId},${img.id})"
                     title="Usar como portada"
                     style="position:absolute;bottom:4px;left:4px;right:4px;
                            background:rgba(0,0,0,.78);border:none;color:#fff;
                            font-size:10px;padding:5px 0;border-radius:5px;
                            cursor:pointer;font-weight:600">
               <i class="ti ti-star"></i> Elegir portada
             </button>`}
      </div>`).join('');
  }

  window._setPortada = async function(prodId, imgId) {
    await Http.patch(`/productos/${prodId}/imagenes/${imgId}/portada`, {});
    await cargarImagenes(prodId);
    await cargar();
    Swal.fire({
      icon: 'success', title: 'Portada actualizada',
      timer: 1200, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
  };

  window._eliminarImagen = async function(prodId, imgId) {
    const conf = await Swal.fire({
      title: '¿Eliminar imagen?', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar', confirmButtonColor: '#e53935',
      background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;
    await Http.delete(`/productos/${prodId}/imagenes/${imgId}`);
    await cargarImagenes(prodId);
    await cargar();
  };

  // ── PRECIOS POR VOLUMEN ─────────────────────────────────
  async function cargarVolumenes(prodId) {
    const res = await Http.get(`/productos/${prodId}/volumenes`);
    if (!res?.ok) return;
    renderVolumenes(res.volumenes || []);
  }

  function renderVolumenes(lista) {
    const tbody       = document.getElementById('vol-tbody');
    const precioVenta = +document.getElementById('prod-precio-venta').value || 0;
    const costo       = +document.getElementById('prod-precio-costo').value || 0;

    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="5">
        <div class="empty-state" style="padding:24px">
          <i class="ti ti-discount-2"></i>
          <p>Sin precios por volumen. Agrega el primero arriba.</p>
        </div></td></tr>`;
      return;
    }

    tbody.innerHTML = lista.map(v => {
      const precio  = +v.precio_unit;
      const ahorro  = precioVenta > 0 ? (precioVenta - precio) : 0;
      const margen = Number.isFinite(+v.margen_unitario) ? +v.margen_unitario : (precio - costo);
      const resultado = margen < 0 ? 'Pérdida' : margen === 0 ? 'Sin margen' : 'Ganancia';
      const colorMargen = margen < 0 ? 'var(--danger)' : margen === 0 ? 'var(--texto-muted)' : 'var(--success)';
      return `
        <tr>
          <td style="font-weight:600">Desde ${v.cantidad_desde} uds</td>
          <td style="text-align:right;font-weight:600;color:var(--success)">S/ ${precio.toFixed(2)}</td>
          <td style="text-align:right;color:${ahorro > 0 ? 'var(--info)' : 'var(--texto-muted)'}">
            ${ahorro > 0 ? `−S/ ${ahorro.toFixed(2)} c/u` : '—'}
          </td>
          <td style="text-align:right;color:${colorMargen};font-weight:600">
            ${resultado}: ${margen < 0 ? '−' : ''}S/ ${Math.abs(margen).toFixed(2)} c/u
          </td>
          <td style="text-align:center">
            <button class="btn btn-danger btn-xs" onclick="_volQuitar(${v.id})" title="Quitar escalón">
              <i class="ti ti-trash"></i>
            </button>
          </td>
        </tr>`;
    }).join('');
  }

  window._volQuitar = async function(volId) {
    const prodId = document.getElementById('prod-id').value;
    const conf = await Swal.fire({
      title: '¿Quitar este escalón?', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, quitar',
      cancelButtonText: 'Cancelar', confirmButtonColor: '#e53935',
      background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;
    const res = await Http.delete(`/productos/${prodId}/volumenes/${volId}`);
    if (!res?.ok) return Swal.fire({ icon:'error', title:'Error', text:res?.msg,
      background:'#1a1a2e', color:'#e0e0e0', confirmButtonColor:'#e53935' });
    await cargarVolumenes(+prodId);
  };

  async function volAgregar() {
    const prodId   = document.getElementById('prod-id').value;
    if (!prodId) return;
    const cantidad = document.getElementById('vol-cantidad').value;
    const precio   = document.getElementById('vol-precio').value;

    if (!cantidad || +cantidad < 2)
      return Swal.fire({ icon:'warning', title:'Cantidad inválida',
        text:'La cantidad "desde" debe ser 2 o más.',
        background:'#1a1a2e', color:'#e0e0e0', confirmButtonColor:'#e53935' });
    if (!precio || +precio <= 0)
      return Swal.fire({ icon:'warning', title:'Precio inválido',
        text:'El precio debe ser mayor a 0.',
        background:'#1a1a2e', color:'#e0e0e0', confirmButtonColor:'#e53935' });

    const res = await Http.post(`/productos/${prodId}/volumenes`, {
      cantidad_desde: parseInt(cantidad, 10),
      precio_unit:    parseFloat(precio)
    });

    if (!res?.ok)
      return Swal.fire({ icon:'error', title:'No se agregó', text:res?.msg || 'Error',
        background:'#1a1a2e', color:'#e0e0e0', confirmButtonColor:'#e53935' });

    document.getElementById('vol-cantidad').value = '';
    document.getElementById('vol-precio').value   = '';
    await cargarVolumenes(+prodId);

    // Alerta anti-pérdida (no bloquea, solo avisa)
    if (res.aviso) {
      Swal.fire({ icon:'warning', title:'Escalón agregado, pero ojo:',
        text: res.aviso,
        background:'#1a1a2e', color:'#e0e0e0', confirmButtonColor:'#e53935' });
    }
  }

  // ── GUARDAR PRODUCTO ────────────────────────────────────
  async function guardar() {
    limpiarErrores();
    const id     = document.getElementById('prod-id').value;
    const nombre = document.getElementById('prod-nombre').value.trim();
    const desc   = document.getElementById('prod-descripcion').value.trim();
    const marca  = document.getElementById('prod-marca').value.trim();
    const atrib  = document.getElementById('prod-atributo').value.trim();
    const venta  = document.getElementById('prod-precio-venta').value;

    if (!nombre) { mostrarError('prod-nombre', 'El nombre es requerido'); return; }
    if (nombre.length > 120) { mostrarError('prod-nombre', 'Máximo 120 caracteres'); return; }
    if (desc.length > 1500) { mostrarError('prod-descripcion', 'Máximo 1500 caracteres'); return; }
    if (marca.length > 80) { mostrarError('prod-marca', 'Máximo 80 caracteres'); return; }
    if (atrib.length > 120) { mostrarError('prod-atributo', 'Máximo 120 caracteres'); return; }

    // Sucursal (solo el admin la elige; los demás van con la suya por backend)
    let sucursal_id = null;
    if (esAdmin) {
      sucursal_id = document.getElementById('prod-sucursal').value;
      if (!id && !sucursal_id) {
        mostrarError('prod-sucursal', 'Selecciona la sucursal');
        return;
      }
    }

    if (!venta || +venta <= 0)
      return Swal.fire({
        icon: 'error', title: 'Error',
        text: 'El precio de venta es requerido y debe ser mayor a 0',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    const costo = +document.getElementById('prod-precio-costo').value || 0;
    if (costo > +venta) {
      return Swal.fire({
        icon: 'error', title: 'Precio inválido',
        text: 'El precio costo no puede ser mayor al precio de venta',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });
    }

    const numericos = {
      'prod-precio-costo': 'Precio costo',
      'prod-oferta':       '% Oferta',
      'prod-stock-min':    'Stock mínimo',
      'prod-garantia':     'Garantía'
    };
    for (const [campoId, label] of Object.entries(numericos)) {
      const input = document.getElementById(campoId);
      if (!input) continue;
      const v = input.value;
      if (v !== '' && +v < 0)
        return Swal.fire({
          icon: 'error', title: 'Error',
          text: `${label} no puede ser negativo`,
          background: '#1a1a2e', color: '#e0e0e0',
          confirmButtonColor: '#e53935'
        });
    }

    const oferta = +document.getElementById('prod-oferta').value || 0;
    if (oferta > 100)
      return Swal.fire({
        icon: 'error', title: 'Error',
        text: 'El % de oferta no puede ser mayor a 100',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    const body = {
      nombre,
      descripcion:       desc,
      marca,
      precio_costo:      +document.getElementById('prod-precio-costo').value || 0,
      precio_venta:      +venta,
      porcentaje_oferta: oferta,
      stock_actual:      0,
      stock_minimo:      +document.getElementById('prod-stock-min').value || 0,
      garantia_meses:    +document.getElementById('prod-garantia').value || 0,
      atributo_extra:    atrib || null,
    };
    if (esAdmin && sucursal_id) body.sucursal_id = +sucursal_id;
    if (id) body.estado = +document.getElementById('prod-estado').value;

    const btn = document.getElementById('btn-guardar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Guardando...';

    const res = id
      ? await Http.put(`/productos/${id}`, body)
      : await Http.post('/productos', body);

    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Guardar';

    if (!res?.ok)
      return Swal.fire({
        icon: 'error', title: 'Error', text: res?.msg || 'Error al guardar',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    if (!id && res.id) {
      document.getElementById('prod-id').value = res.id;
      document.getElementById('prod-sucursal').disabled = true;
      document.getElementById('grupo-estado-prod').style.display = 'block';
      document.querySelectorAll('.tab-btn')
        .forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel')
        .forEach(p => p.classList.remove('active'));
      document.querySelector('.tab-btn[data-tab="imagenes"]').classList.add('active');
      document.getElementById('tab-imagenes').classList.add('active');
      document.getElementById('upload-zona').style.display   = 'block';
      document.getElementById('prod-id-aviso').style.display = 'none';
      cargarImagenes(res.id);
    }

    Swal.fire({
      icon: 'success',
      title: id ? 'Producto actualizado' : '¡Producto creado!',
      text: !id ? 'Ahora puedes agregar imágenes y precios por volumen' : '',
      timer: 2000, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
    await cargar();
  }

  // ── EDITAR ──────────────────────────────────────────────
  window._editarProducto = async function(id) {
    const res = await Http.get(`/productos/${id}`);
    if (!res?.ok) return;
    const p = res.producto;
    limpiarErrores();

    document.getElementById('prod-id').value            = p.id;
    document.getElementById('prod-nombre').value        = p.nombre;
    document.getElementById('prod-sucursal').value      = p.sucursal_id || '';
    document.getElementById('prod-sucursal').disabled   = true;   // no se cambia en edición
    document.getElementById('prod-descripcion').value   = p.descripcion || '';
    document.getElementById('prod-marca').value         = p.marca || '';
    document.getElementById('prod-precio-costo').value  = p.precio_costo || '';
    document.getElementById('prod-precio-venta').value  = p.precio_venta;
    document.getElementById('prod-oferta').value        = p.porcentaje_oferta || '';
    document.getElementById('prod-stock').value         = p.stock_actual;
    document.getElementById('prod-stock-min').value     = p.stock_minimo;
    document.getElementById('prod-garantia').value      = p.garantia_meses || '';
    document.getElementById('prod-atributo').value      = p.atributo_extra || '';
    document.getElementById('prod-estado').value        = p.estado;
    document.getElementById('grupo-estado-prod').style.display = 'block';
    document.getElementById('prod-stock').setAttribute('readonly', true);
    document.getElementById('prod-stock').style.opacity = '.6';
    document.getElementById('prod-stock').style.cursor  = 'not-allowed';
    abrirModal('Editar Producto');
  };

  // ── ELIMINAR ────────────────────────────────────────────
  window._eliminarProducto = async function(id, nombre) {
    const conf = await Swal.fire({
      title: `¿Eliminar "${nombre}"?`,
      text: 'Esta acción no se puede deshacer', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar', confirmButtonColor: '#e53935',
      background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;
    const res = await Http.delete(`/productos/${id}`);
    if (!res?.ok)
      return Swal.fire({
        icon: 'error', title: 'Error', text: res?.msg,
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });
    Swal.fire({
      icon: 'success', title: 'Producto eliminado',
      timer: 1500, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
    await cargar();
  };

  // ── Bloqueo de teclas en numéricos ──────────────────────
  function bloquearTeclasNumericas(e) {
    if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
  }
  function limpiarValorNumerico(e) {
    let v = e.target.value;
    if (v.includes('-') || +v < 0) {
      e.target.value = v.replace(/-/g, '');
      if (+e.target.value < 0) e.target.value = '';
    }
  }

  ['prod-precio-costo','prod-precio-venta','prod-oferta',
   'prod-stock-min','prod-garantia','vol-cantidad','vol-precio'].forEach(campoId => {
    const el = document.getElementById(campoId);
    if (!el) return;
    el.addEventListener('keydown', bloquearTeclasNumericas);
    el.addEventListener('input', limpiarValorNumerico);
  });

  // ── Filtrado de teclas en texto (tiempo real) ───────────
  document.getElementById('prod-nombre').addEventListener('input', () => ocultarError('prod-nombre'));
  document.getElementById('prod-descripcion').addEventListener('input', () => ocultarError('prod-descripcion'));
  document.getElementById('prod-marca').addEventListener('input', () => ocultarError('prod-marca'));
  document.getElementById('prod-atributo').addEventListener('input', () => ocultarError('prod-atributo'));

  // ── EVENTOS ─────────────────────────────────────────────
  document.getElementById('btn-nuevo-producto')
    .addEventListener('click', () => { limpiarModal(); abrirModal(); });
  document.getElementById('btn-cerrar-modal')
    .addEventListener('click', cerrarModal);
  document.getElementById('btn-cancelar')
    .addEventListener('click', cerrarModal);
  document.getElementById('btn-guardar')
    .addEventListener('click', guardar);
  document.getElementById('btn-vol-agregar')
    .addEventListener('click', volAgregar);
  document.getElementById('modal-overlay')
    .addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') cerrarModal();
    });
  document.getElementById('inp-buscar').addEventListener('input', e => {
    buscar = e.target.value; pagina = 1; renderTabla();
  });
  document.getElementById('sel-limite').addEventListener('change', e => {
    limite = parseInt(e.target.value); pagina = 1; renderTabla();
  });

  await cargarSucursales();
  await cargar();
};