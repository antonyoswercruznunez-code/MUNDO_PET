window.init_perfiles = async function () {

  const html = await fetch('/views/pages/perfiles.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  // Solo letras + espacios + tildes
  const RE_NOMBRE = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/;

  if (window._esAdmin) {
    document.getElementById('slot-btn-nuevo-perfil').innerHTML = `
      <button class="btn btn-primary" id="btn-nuevo-perfil">
        <i class="ti ti-plus"></i> Nuevo Perfil
      </button>`;
  }

  let perfiles     = [];
  let opciones     = [];
  let asignadas    = [];
  let perfilActivo = null;
  let pagina       = 1;
  let limite       = 10;
  let buscar       = '';

  async function cargar() {
    const res = await Http.get('/perfiles');
    if (!res?.ok) return;
    perfiles  = res.perfiles;
    opciones  = res.opciones;
    asignadas = res.asignadas;
    renderTabla();
  }

  function renderTabla() {
    const filtrados = perfiles.filter(p => {
      const q = buscar.toLowerCase();
      return p.nombre?.toLowerCase().includes(q) ||
             (p.descripcion || '').toLowerCase().includes(q);
    });

    const total  = filtrados.length;
    const inicio = (pagina - 1) * limite;
    const data   = filtrados.slice(inicio, inicio + limite);
    const tbody  = document.getElementById('tbody-perfiles');

    if (!data.length) {
      tbody.innerHTML = `
        <tr><td colspan="6">
          <div class="empty-state">
            <i class="ti ti-shield"></i>
            <p>No se encontraron perfiles</p>
          </div>
        </td></tr>`;
    } else {
      tbody.innerHTML = data.map(p => {
        const esAdmin = p.id === 1;
        const activo  = p.estado === 0;
        const mods    = asignadas.filter(a => a.perfil_id === p.id).length;

        const acciones = esAdmin
          ? (window._esGlobal ? `<div style="display:flex;gap:6px;align-items:center"><button class="btn btn-info btn-xs" onclick="_abrirPermisos(${p.id})" title="Configurar módulos y acciones de administradores no globales"><i class="ti ti-lock"></i> Permisos</button><span style="font-size:11px;color:var(--texto-muted)">El admin global conserva todo</span></div>` : `<span style="font-size:12px;color:var(--texto-muted)">Protegido</span>`)
          : !window._esAdmin
            ? `<span style="font-size:12px;color:var(--texto-muted)">Sin permiso</span>`
            : `<div style="display:flex;gap:6px">
                 <button class="btn btn-info btn-xs"
                         onclick="_abrirPermisos(${p.id})" title="Permisos"
                         style="background:rgba(0,176,255,.15);
                                color:var(--info);border:none">
                   <i class="ti ti-lock"></i>
                 </button>
                 <button class="btn btn-warning btn-xs"
                         onclick="_editarPerfil(${p.id})" title="Editar">
                   <i class="ti ti-edit"></i>
                 </button>
                 <button class="btn btn-danger btn-xs"
                         onclick="_eliminarPerfil(${p.id},'${p.nombre.replace(/'/g,"\\'")}')"
                         title="Eliminar">
                   <i class="ti ti-trash"></i>
                 </button>
               </div>`;

        return `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:34px;height:34px;
                            background:${esAdmin ? 'var(--rojo)' : 'rgba(0,176,255,.15)'};
                            border-radius:8px;display:flex;align-items:center;
                            justify-content:center;flex-shrink:0">
                  <i class="ti ${esAdmin ? 'ti-shield-check' : 'ti-shield'}"
                     style="color:${esAdmin ? '#fff' : 'var(--info)'}"></i>
                </div>
                <div style="font-weight:700;color:var(--texto)">${p.nombre}</div>
              </div>
            </td>
            <td style="color:var(--texto-muted)">${p.descripcion || '-'}</td>
            <td><span class="badge badge-info">${mods} módulo(s)</span></td>
            <td><button class="btn btn-outline btn-xs" onclick="_verUsuariosPerfil(${p.id})"><i class="ti ti-users"></i> ${Number(p.usuarios_count||0)}</button></td>
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

  window._verUsuariosPerfil = async function(id) {
    const p = perfiles.find(x => Number(x.id) === Number(id));
    const users = String(p?.usuarios_nombres || '').split('||').filter(Boolean);
    await Swal.fire({
      title: `Usuarios · ${p?.nombre || 'Perfil'}`,
      width: 620,
      html: users.length ? `<div style="text-align:left;display:grid;gap:8px">${users.map(u=>`<div style="padding:11px 13px;border:1px solid #dbe7df;border-radius:10px;background:#f8fafc"><i class="ti ti-user-circle" style="color:#16a34a;margin-right:7px"></i>${u.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}</div>`).join('')}</div>` : '<div class="empty-state"><i class="ti ti-users-off"></i><p>No hay usuarios asignados.</p></div>',
      confirmButtonText:'Cerrar', confirmButtonColor:'#16a34a'
    });
  };

  // ── PERMISOS ─────────────────────────────────────────────
  window._abrirPermisos = function(id) {
    perfilActivo = id;
    const perfil = perfiles.find(p => p.id === id);
    const asignadasPerfil = asignadas
      .filter(a => a.perfil_id === id).map(a => a.opcion_id);

    document.getElementById('permisos-titulo').textContent =
      `Permisos — ${perfil?.nombre}`;

    document.getElementById('lista-opciones-modal').innerHTML =
      opciones.map(o => {
        const tiene = asignadasPerfil.includes(o.id);
        return `
          <label style="display:flex;align-items:center;gap:8px;
                        padding:9px 10px;border-radius:6px;cursor:pointer;
                        background:${tiene ? 'rgba(0,200,83,.07)' : 'transparent'}">
            <input type="checkbox" data-opcion="${o.id}" ${tiene ? 'checked' : ''}>
            <i class="ti ${o.icono || 'ti-circle'}"
               style="color:var(--texto-muted);width:16px"></i>
            <span style="font-size:13px;color:var(--texto)">${o.nombre}</span>
          </label>`;
      }).join('');

    document.getElementById('modal-permisos').classList.add('open');
  };


  window._marcarTodos = function(valor) {
    document.querySelectorAll('#lista-opciones-modal input[type="checkbox"]')
      .forEach(chk => chk.checked = valor);
  };

  document.getElementById('btn-guardar-permisos')
    .addEventListener('click', async () => {
      if (!perfilActivo) return;
      const opcSeleccionadas = Array.from(
        document.querySelectorAll(
          '#lista-opciones-modal input[type="checkbox"]:checked'
        )
      ).map(chk => +chk.dataset.opcion);

      if (!opcSeleccionadas.length)
        return Swal.fire({
          icon: 'warning', title: 'Atención',
          text: 'Selecciona al menos un módulo',
          background: '#1a1a2e', color: '#e0e0e0',
          confirmButtonColor: '#e53935'
        });

      const res = await Http.post(`/perfiles/${perfilActivo}/opciones`, { opciones: opcSeleccionadas });
      if (!res?.ok) return Swal.fire({ icon:'error', title:'Error', text:res?.msg, background:'#1a1a2e', color:'#e0e0e0' });

      document.getElementById('modal-permisos').classList.remove('open');
      Swal.fire({
        icon: 'success', title: 'Permisos guardados',
        timer: 1500, showConfirmButton: false,
        background: '#1a1a2e', color: '#e0e0e0'
      });
      await cargar();
    });

  document.getElementById('btn-cerrar-permisos').addEventListener('click', () => {
    document.getElementById('modal-permisos').classList.remove('open');
  });
  document.getElementById('btn-cancelar-permisos').addEventListener('click', () => {
    document.getElementById('modal-permisos').classList.remove('open');
  });
  document.getElementById('modal-permisos').addEventListener('click', e => {
    if (e.target.id === 'modal-permisos')
      document.getElementById('modal-permisos').classList.remove('open');
  });

  // ── MODAL PERFIL ─────────────────────────────────────────
  function mostrarErrorNombre(mensaje) {
    const el  = document.getElementById('err-prf-nombre');
    const inp = document.getElementById('prf-nombre');
    if (el)  { el.textContent = mensaje; el.style.display = 'block'; }
    if (inp) inp.style.borderColor = 'var(--danger)';
  }
  function ocultarErrorNombre() {
    const el  = document.getElementById('err-prf-nombre');
    const inp = document.getElementById('prf-nombre');
    if (el)  el.style.display = 'none';
    if (inp) inp.style.borderColor = '';
  }

  function cerrarModalPerfil() {
    document.getElementById('modal-perfil').classList.remove('open');
    document.getElementById('prf-id').value          = '';
    document.getElementById('prf-nombre').value      = '';
    document.getElementById('prf-descripcion').value = '';
    document.getElementById('prf-estado').value      = '0';
    document.getElementById('grupo-estado-prf').style.display = 'none';
    ocultarErrorNombre();
  }

  async function guardarPerfil() {
    ocultarErrorNombre();
    const id          = document.getElementById('prf-id').value;
    const nombre      = document.getElementById('prf-nombre').value.trim();
    const descripcion = document.getElementById('prf-descripcion').value.trim();

    // Validar nombre
    if (!nombre) {
      mostrarErrorNombre('El nombre es requerido');
      return;
    }
    if (nombre.length < 2) {
      mostrarErrorNombre('El nombre debe tener al menos 2 caracteres');
      return;
    }
    if (!RE_NOMBRE.test(nombre)) {
      mostrarErrorNombre('Solo se permiten letras y espacios (sin números ni símbolos)');
      return;
    }

    const body = { nombre, descripcion };
    if (id) body.estado = +document.getElementById('prf-estado').value;

    const btn = document.getElementById('btn-guardar-perfil');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Guardando...';

    const res = id
      ? await Http.put(`/perfiles/${id}`, body)
      : await Http.post('/perfiles', body);

    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Guardar';

    if (!res?.ok)
      return Swal.fire({
        icon: 'error', title: 'Error', text: res?.msg,
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    cerrarModalPerfil();
    Swal.fire({
      icon: 'success',
      title: id ? 'Perfil actualizado' : 'Perfil creado',
      timer: 1500, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
    await cargar();
  }

  window._editarPerfil = function(id) {
    const p = perfiles.find(x => x.id === id);
    if (!p) return;
    ocultarErrorNombre();
    document.getElementById('prf-id').value          = p.id;
    document.getElementById('prf-nombre').value      = p.nombre;
    document.getElementById('prf-descripcion').value = p.descripcion || '';
    document.getElementById('prf-estado').value      = p.estado;
    document.getElementById('grupo-estado-prf').style.display = 'block';
    document.getElementById('modal-perfil-titulo').textContent = 'Editar Perfil';
    document.getElementById('modal-perfil').classList.add('open');
  };

  window._eliminarPerfil = async function(id, nombre) {
    const conf = await Swal.fire({
      title: `¿Eliminar "${nombre}"?`,
      text: 'Esta acción no se puede deshacer', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar', confirmButtonColor: '#e53935',
      background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;

    const res = await Http.delete(`/perfiles/${id}`);
    if (!res?.ok)
      return Swal.fire({
        icon: 'error', title: 'Error', text: res?.msg,
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    Swal.fire({
      icon: 'success', title: 'Perfil eliminado',
      timer: 1500, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
    await cargar();
  };

  if (window._esAdmin) {
    document.getElementById('btn-nuevo-perfil')
      ?.addEventListener('click', () => {
        cerrarModalPerfil();
        document.getElementById('modal-perfil-titulo').textContent = 'Nuevo Perfil';
        document.getElementById('modal-perfil').classList.add('open');
      });
  }

  // ── Filtrado de teclas en tiempo real ───────────────────
  document.getElementById('prf-nombre').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ\s]/g, '');
    const v = e.target.value;
    if (v && !RE_NOMBRE.test(v))
      mostrarErrorNombre('Solo se permiten letras y espacios');
    else
      ocultarErrorNombre();
  });

  document.getElementById('btn-cerrar-perfil')
    .addEventListener('click', cerrarModalPerfil);
  document.getElementById('btn-cancelar-perfil')
    .addEventListener('click', cerrarModalPerfil);
  document.getElementById('btn-guardar-perfil')
    .addEventListener('click', guardarPerfil);
  document.getElementById('modal-perfil').addEventListener('click', e => {
    if (e.target.id === 'modal-perfil') cerrarModalPerfil();
  });
  document.getElementById('inp-buscar').addEventListener('input', e => {
    buscar = e.target.value; pagina = 1; renderTabla();
  });
  document.getElementById('sel-limite').addEventListener('change', e => {
    limite = parseInt(e.target.value); pagina = 1; renderTabla();
  });

  await cargar();
};