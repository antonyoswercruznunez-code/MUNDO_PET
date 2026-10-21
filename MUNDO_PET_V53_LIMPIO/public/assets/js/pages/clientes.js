window.init_clientes = async function () {

  // ── CARGAR VISTA HTML SEPARADA ─────────────────────────
  const html = await fetch('/views/pages/clientes.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  // ── ESTADO ─────────────────────────────────────────────
  let todos      = [];
  let pagina     = 1;
  let limite     = 10;
  let buscar     = '';
  let modoEditar = false;
  let docBloqueado = false;   // true cuando ya se buscó un documento válido
  let puedeGestionar = false; // solo admin (global o sucursal) crea/edita/elimina

  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ── NOMBRE A MOSTRAR ───────────────────────────────────
  function nombreCompleto(c) {
    if (c.tipo_doc === 'ruc') return (c.razon_social || c.nombre || '').trim();
    return [c.nombre, c.apellido_paterno, c.apellido_materno]
      .filter(Boolean).join(' ').trim() || (c.nombre || '');
  }

  // ── CARGAR DATOS ───────────────────────────────────────
  async function cargar() {
    const tbody=document.getElementById('tbody-clientes');
    if(tbody)tbody.innerHTML='<tr><td colspan="6"><div class="loading-center"><div class="spinner"></div></div></td></tr>';
    const res = await Http.get('/clientes');
    if (!res?.ok) {
      if(tbody)tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><i class="ti ti-alert-triangle"></i><p>${String(res?.msg||'No se pudieron cargar los clientes')}</p><button class="btn btn-primary btn-sm" id="cli-reintentar">Reintentar</button></div></td></tr>`;
      document.getElementById('cli-reintentar')?.addEventListener('click',cargar);
      return;
    }
    todos = Array.isArray(res.clientes)?res.clientes:[];
    puedeGestionar = !!res.puede_gestionar;
    // Mostrar/ocultar el botón "Nuevo Cliente" según permiso
    const btnNuevo = document.getElementById('btn-nuevo-cliente');
    if (btnNuevo) btnNuevo.style.display = puedeGestionar ? '' : 'none';
    renderTabla();
  }

  function renderTabla() {
    const filtrados = todos.filter(c => {
      const q = buscar.toLowerCase();
      return (
        c.numero_doc?.toLowerCase().includes(q) ||
        nombreCompleto(c).toLowerCase().includes(q) ||
        (c.razon_social || '').toLowerCase().includes(q) ||
        (c.telefono || '').includes(q)
      );
    });

    const total  = filtrados.length;
    const inicio = (pagina - 1) * limite;
    const fin    = inicio + limite;
    const data   = filtrados.slice(inicio, fin);
    const tbody  = document.getElementById('tbody-clientes');

    if (!data.length) {
      tbody.innerHTML = `
        <tr><td colspan="6">
          <div class="empty-state">
            <i class="ti ti-users-group"></i>
            <p>No se encontraron clientes</p>
          </div>
        </td></tr>`;
    } else {
      tbody.innerHTML = data.map(c => {
        const esGeneral = c.es_general;
        const nombre    = nombreCompleto(c);
        const activo    = c.activo === 1;
        const docClass  = c.tipo_doc === 'ruc' ? 'ruc' : esGeneral ? 'general' : 'dni';
        const docLabel  = c.tipo_doc === 'ruc' ? 'RUC' : esGeneral ? 'General' : 'DNI';

        // Acciones: solo admin. El vendedor solo ve.
        let acciones;
        if (!puedeGestionar) {
          acciones = `<span style="font-size:12px;color:var(--texto-muted)">—</span>`;
        } else if (esGeneral) {
          acciones = `<span style="font-size:12px;color:var(--texto-muted)">Protegido</span>`;
        } else {
          acciones = `<div style="display:flex;gap:6px">
                        <button class="btn btn-warning btn-xs"
                                onclick="editarCliente(${c.id})" title="Editar">
                          <i class="ti ti-edit"></i>
                        </button>
                        <button class="btn btn-danger btn-xs"
                                onclick="eliminarCliente(${c.id},'${nombre.replace(/'/g,"\\'")}')"
                                title="Eliminar">
                          <i class="ti ti-trash"></i>
                        </button>
                      </div>`;
        }

        return `
          <tr>
            <td>
              <span class="doc-badge ${docClass}">${docLabel}</span>
              <span style="margin-left:6px;font-weight:600">${c.numero_doc}</span>
            </td>
            <td>
              <div style="font-weight:500;color:var(--texto-fuerte)">${nombre}</div>
              ${c.email
                ? `<div style="font-size:11px;color:var(--texto-muted)">${c.email}</div>`
                : ''}
            </td>
            <td>${c.telefono || '<span class="text-muted">-</span>'}</td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;
                       white-space:nowrap">
              ${c.distrito && c.provincia
                ? `${c.distrito}, ${c.provincia}`
                : (c.direccion || '<span class="text-muted">-</span>')}
            </td>
            <td>
              <span class="badge ${activo ? 'badge-success' : 'badge-muted'}">
                ${activo ? 'Activo' : 'Inactivo'}
              </span>
            </td>
            <td>${acciones}</td>
          </tr>`;
      }).join('');
    }

    const totalPags = Math.ceil(total / limite) || 1;
    document.getElementById('pag-info').textContent = total
      ? `Mostrando ${inicio + 1} a ${Math.min(fin, total)} de ${total} registros`
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

  // ── MODAL ──────────────────────────────────────────────
  function abrirModal(titulo = 'Nuevo Cliente') {
    document.getElementById('modal-titulo').textContent = titulo;
    document.getElementById('modal-overlay').classList.add('open');
  }

  function cerrarModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    limpiarModal();
  }

  function limpiarModal() {
    modoEditar   = false;
    docBloqueado = false;
    document.getElementById('cli-id').value           = '';
    document.getElementById('cli-tipo-doc').value     = 'dni';
    document.getElementById('cli-numero-doc').value   = '';
    document.getElementById('cli-ap-paterno').value   = '';
    document.getElementById('cli-ap-materno').value   = '';
    document.getElementById('cli-nombre').value       = '';
    document.getElementById('cli-razon-social').value = '';
    document.getElementById('cli-telefono').value     = '';
    document.getElementById('cli-email').value        = '';
    document.getElementById('cli-direccion').value    = '';
    document.getElementById('cli-distrito').value     = '';
    document.getElementById('cli-provincia').value    = '';
    document.getElementById('cli-departamento').value = '';
    document.getElementById('api-resultado').innerHTML = '';
    document.getElementById('grupo-estado').style.display    = 'none';
    document.getElementById('zona-busqueda').style.display   = 'block';
    document.getElementById('cli-tipo-doc').disabled = false;
    desbloquearDocBusqueda();
    ocultarErrorTel();
    toggleGrupoDoc('dni');
  }

  function toggleGrupoDoc(tipo) {
    document.getElementById('grupo-dni').style.display =
      tipo === 'dni' ? 'block' : 'none';
    document.getElementById('grupo-ruc').style.display =
      tipo === 'ruc' ? 'block' : 'none';
    document.getElementById('cli-tipo-doc').value = tipo;
  }

  // ── Bloqueo / desbloqueo del campo de búsqueda ─────────
  function bloquearDocBusqueda() {
    docBloqueado = true;
    const inp = document.getElementById('inp-doc-buscar');
    inp.readOnly = true;
    inp.style.opacity = '.85';
    document.getElementById('btn-limpiar-doc').style.display = 'flex';
    document.getElementById('btn-buscar-doc').style.display  = 'none';
  }
  function desbloquearDocBusqueda() {
    docBloqueado = false;
    const inp = document.getElementById('inp-doc-buscar');
    inp.readOnly = false;
    inp.style.opacity = '1';
    inp.value = '';
    document.getElementById('btn-limpiar-doc').style.display = 'none';
    document.getElementById('btn-buscar-doc').style.display  = 'inline-flex';
  }

  // ── Errores teléfono ───────────────────────────────────
  function mostrarErrorTel(msg) {
    const el  = document.getElementById('err-cli-telefono');
    const inp = document.getElementById('cli-telefono');
    if (el)  { el.textContent = msg; el.style.display = 'block'; }
    if (inp) inp.style.borderColor = 'var(--danger)';
  }
  function ocultarErrorTel() {
    const el  = document.getElementById('err-cli-telefono');
    const inp = document.getElementById('cli-telefono');
    if (el)  el.style.display = 'none';
    if (inp) inp.style.borderColor = '';
  }

  // ── BUSCAR DOCUMENTO ───────────────────────────────────
  async function buscarDocumento() {
    if (docBloqueado) return;
    const doc  = document.getElementById('inp-doc-buscar').value.trim();
    const res$ = document.getElementById('api-resultado');

    if (!doc || (doc.length !== 8 && doc.length !== 11)) {
      res$.innerHTML = `<span style="color:var(--warning)">
        Ingresa 8 dígitos (DNI) o 11 dígitos (RUC)</span>`;
      return;
    }

    const tipo = doc.length === 11 ? 'ruc' : 'dni';
    const btn  = document.getElementById('btn-buscar-doc');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>';
    res$.innerHTML = '';

    const res = await Http.get(`/clientes/consultar?doc=${doc}&tipo=${tipo}`);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-search"></i> Buscar';

    if (!res?.ok) {
      res$.innerHTML = `<span style="color:var(--danger)">
        <i class="ti ti-alert-circle"></i> ${res?.msg || 'No encontrado'}</span>`;
      return;
    }

    const c = res.cliente;

    // Cliente eliminado → preguntar reactivar
    if (res.fuente === 'bd_eliminado') {
      res$.innerHTML = `<span style="color:var(--warning)">
        <i class="ti ti-alert-circle"></i>
        Cliente eliminado. ¿Deseas reactivarlo?</span>`;

      const conf = await Swal.fire({
        title: '¿Reactivar cliente?',
        text:  `El cliente con ${tipo.toUpperCase()} ${doc} fue eliminado.`,
        icon:  'question',
        showCancelButton:  true,
        confirmButtonText: 'Sí, reactivar',
        cancelButtonText:  'Cancelar',
        confirmButtonColor: '#e53935',
        background: '#1a1a2e', color: '#e0e0e0'
      });
      if (!conf.isConfirmed) return;

      const r = await Http.post('/clientes', {
        tipo_doc:         c.tipo_doc,
        numero_doc:       c.numero_doc,
        nombre:           c.nombre,
        razon_social:     c.razon_social     || '',
        apellido_paterno: c.apellido_paterno || '',
        apellido_materno: c.apellido_materno || '',
        telefono:         c.telefono || '',
        email:            c.email    || '',
        reactivar: true
      });

      if (r?.ok) {
        cerrarModal();
        Swal.fire({
          icon: 'success', title: 'Cliente reactivado',
          timer: 1500, showConfirmButton: false,
          background: '#1a1a2e', color: '#e0e0e0'
        });
        await cargar();
      } else {
        Swal.fire({
          icon: 'error', title: 'Error',
          text: r?.msg || 'No se pudo reactivar',
          background: '#1a1a2e', color: '#e0e0e0', confirmButtonColor: '#e53935'
        });
      }
      return;
    }

    // BD o API → llenar formulario y BLOQUEAR el documento
    res$.innerHTML = `<span style="color:var(--success)">
      <i class="ti ti-check"></i>
      ${res.fuente === 'bd' ? 'Encontrado en sistema' : 'Datos de la API'}
    </span>`;

    toggleGrupoDoc(c.tipo_doc || tipo);
    document.getElementById('cli-numero-doc').value   = c.numero_doc || doc;
    document.getElementById('cli-ap-paterno').value   = c.apellido_paterno || '';
    document.getElementById('cli-ap-materno').value   = c.apellido_materno || '';
    document.getElementById('cli-nombre').value       = c.nombre || '';
    document.getElementById('cli-razon-social').value = c.razon_social || '';
    document.getElementById('cli-telefono').value     = c.telefono || '';
    document.getElementById('cli-email').value        = c.email || '';
    document.getElementById('cli-direccion').value    = c.direccion || '';
    document.getElementById('cli-distrito').value     = c.distrito || '';
    document.getElementById('cli-provincia').value    = c.provincia || '';
    document.getElementById('cli-departamento').value = c.departamento || '';

    bloquearDocBusqueda();
  }

  // ── GUARDAR ────────────────────────────────────────────
  async function guardar() {
    if (!puedeGestionar) return;   // candado extra
    ocultarErrorTel();
    const id       = document.getElementById('cli-id').value;
    const tipo_doc = document.getElementById('cli-tipo-doc').value;
    const numero   = document.getElementById('cli-numero-doc').value.trim();
    const telefono = document.getElementById('cli-telefono').value.trim();
    const email    = document.getElementById('cli-email').value.trim();
    const nombre   = tipo_doc === 'ruc'
      ? document.getElementById('cli-razon-social').value.trim()
      : document.getElementById('cli-nombre').value.trim();

    if (!numero || !nombre) {
      Swal.fire({
        icon: 'error', title: 'Error',
        text: 'Busca primero un DNI o RUC válido',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });
      return;
    }

    // Validar número de dígitos del documento
    const digitos = tipo_doc === 'ruc' ? 11 : 8;
    if (numero.length !== digitos) {
      Swal.fire({
        icon: 'error', title: 'Documento incompleto',
        text: `El ${tipo_doc.toUpperCase()} debe tener exactamente ${digitos} dígitos`,
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });
      return;
    }

    // Validar teléfono (solo números, opcional)
    if (telefono && !/^[0-9]+$/.test(telefono)) {
      mostrarErrorTel('El teléfono solo puede contener números');
      return;
    }

    // Validar email (opcional)
    if (email && !RE_EMAIL.test(email)) {
      Swal.fire({
        icon: 'error', title: 'Error', text: 'El email no tiene un formato válido',
        background: '#1a1a2e', color: '#e0e0e0', confirmButtonColor: '#e53935'
      });
      return;
    }

    const btn = document.getElementById('btn-guardar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Guardando...';

    let res;
    if (id) {
      res = await Http.put(`/clientes/${id}`, {
        telefono, email,
        activo: parseInt(document.getElementById('cli-activo').value)
      });
    } else {
      res = await Http.post('/clientes', {
        tipo_doc,
        numero_doc:       numero,
        nombre,
        razon_social:     document.getElementById('cli-razon-social').value.trim(),
        apellido_paterno: document.getElementById('cli-ap-paterno').value.trim(),
        apellido_materno: document.getElementById('cli-ap-materno').value.trim(),
        telefono,
        email,
        direccion:        document.getElementById('cli-direccion').value.trim(),
        distrito:         document.getElementById('cli-distrito').value.trim(),
        provincia:        document.getElementById('cli-provincia').value.trim(),
        departamento:     document.getElementById('cli-departamento').value.trim(),
      });
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Guardar';

    if (!res?.ok) {
      Swal.fire({
        icon: 'error', title: 'Error',
        text: res?.msg || 'Error al guardar',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });
      return;
    }

    cerrarModal();
    Swal.fire({
      icon: 'success',
      title: id ? 'Cliente actualizado' : 'Cliente creado',
      timer: 1500, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
    await cargar();
  }

  // ── EDITAR ─────────────────────────────────────────────
  window.editarCliente = function(id) {
    if (!puedeGestionar) return;   // candado extra
    const c = todos.find(x => x.id === id);
    if (!c) return;

    modoEditar = true;
    document.getElementById('cli-id').value           = c.id;
    document.getElementById('cli-tipo-doc').value     = c.tipo_doc;
    document.getElementById('cli-numero-doc').value   = c.numero_doc;
    document.getElementById('cli-ap-paterno').value   = c.apellido_paterno || '';
    document.getElementById('cli-ap-materno').value   = c.apellido_materno || '';
    document.getElementById('cli-nombre').value       = c.nombre || '';
    document.getElementById('cli-razon-social').value = c.razon_social || '';
    document.getElementById('cli-telefono').value     = c.telefono || '';
    document.getElementById('cli-email').value        = c.email || '';
    document.getElementById('cli-direccion').value    = c.direccion || '';
    document.getElementById('cli-distrito').value     = c.distrito || '';
    document.getElementById('cli-provincia').value    = c.provincia || '';
    document.getElementById('cli-departamento').value = c.departamento || '';
    document.getElementById('cli-activo').value       = c.activo ?? 1;
    document.getElementById('grupo-estado').style.display  = 'block';
    document.getElementById('zona-busqueda').style.display = 'none';
    document.getElementById('cli-tipo-doc').disabled = true;
    ocultarErrorTel();
    toggleGrupoDoc(c.tipo_doc);
    abrirModal('Editar Cliente');
  };

  // ── ELIMINAR ───────────────────────────────────────────
  window.eliminarCliente = async function(id, nombre) {
    if (!puedeGestionar) return;   // candado extra
    const conf = await Swal.fire({
      title: `¿Eliminar a "${nombre}"?`,
      text:  'Esta acción no se puede deshacer',
      icon:  'warning',
      showCancelButton:  true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText:  'Cancelar',
      confirmButtonColor: '#e53935',
      background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;

    const res = await Http.delete(`/clientes/${id}`);
    if (!res?.ok) {
      Swal.fire({
        icon: 'error', title: 'Error',
        text: res?.msg || 'Error al eliminar',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });
      return;
    }
    Swal.fire({
      icon: 'success', title: 'Cliente eliminado',
      timer: 1500, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
    await cargar();
  };

  // ── Filtrado de teclas en tiempo real ──────────────────
  document.getElementById('inp-doc-buscar').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  });
  document.getElementById('cli-telefono').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
    ocultarErrorTel();
  });

  // ── EVENTOS ────────────────────────────────────────────
  document.getElementById('btn-nuevo-cliente')
    .addEventListener('click', () => {
      if (!puedeGestionar) return;
      limpiarModal(); abrirModal('Nuevo Cliente');
    });
  document.getElementById('btn-cerrar-modal')
    .addEventListener('click', cerrarModal);
  document.getElementById('btn-cancelar')
    .addEventListener('click', cerrarModal);
  document.getElementById('btn-guardar')
    .addEventListener('click', guardar);
  document.getElementById('btn-buscar-doc')
    .addEventListener('click', buscarDocumento);
  document.getElementById('btn-limpiar-doc')
    .addEventListener('click', () => {
      desbloquearDocBusqueda();
      document.getElementById('api-resultado').innerHTML = '';
      document.getElementById('cli-numero-doc').value   = '';
      document.getElementById('cli-ap-paterno').value   = '';
      document.getElementById('cli-ap-materno').value   = '';
      document.getElementById('cli-nombre').value       = '';
      document.getElementById('cli-razon-social').value = '';
      document.getElementById('cli-telefono').value     = '';
      document.getElementById('cli-email').value        = '';
      document.getElementById('cli-direccion').value    = '';
      document.getElementById('cli-distrito').value     = '';
      document.getElementById('cli-provincia').value    = '';
      document.getElementById('cli-departamento').value = '';
      toggleGrupoDoc('dni');
      document.getElementById('inp-doc-buscar').focus();
    });
  document.getElementById('inp-doc-buscar')
    .addEventListener('keydown', e => {
      if (e.key === 'Enter') buscarDocumento();
    });
  document.getElementById('inp-buscar')
    .addEventListener('input', e => {
      buscar = e.target.value; pagina = 1; renderTabla();
    });
  document.getElementById('sel-limite')
    .addEventListener('change', e => {
      limite = parseInt(e.target.value); pagina = 1; renderTabla();
    });
  document.getElementById('modal-overlay')
    .addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') cerrarModal();
    });

  await cargar();
};