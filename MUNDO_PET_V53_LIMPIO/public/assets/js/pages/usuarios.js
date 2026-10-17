window.init_usuarios = async function () {

  const html = await fetch('/views/pages/usuarios.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  // Estilos de pestañas de sucursal
  const _st = document.createElement('style');
  _st.textContent = `
    .suc-tab{background:none;border:none;border-bottom:2px solid transparent;
             padding:9px 16px;font-size:14px;color:var(--texto-muted);cursor:pointer}
    .suc-tab.active{color:var(--rojo);border-bottom-color:var(--rojo);font-weight:600}
  `;
  document.head.appendChild(_st);

  // ── Regex de validación ────────────────────────────────
  const RE_NOMBRE   = /^[A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s]+$/; // letras, números y espacios
  const RE_USERNAME = /^[A-Za-z0-9]+$/;             // letras y números (camion1)
  const RE_PASSWORD = /^[A-Za-z0-9]+$/;             // solo letras y números
  const RE_EMAIL    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Botón nuevo solo si es admin
  if (window._esAdmin) {
    document.getElementById('slot-btn-nuevo-usuario').innerHTML = `
      <button class="btn btn-primary" id="btn-nuevo-usuario">
        <i class="ti ti-plus"></i> Nuevo Usuario
      </button>`;
  }

  let todos      = [];
  let perfiles   = [];
  let sucursales = [];
  let sucActiva  = null;            // null=todas · 'global' · <id>
  let pagina     = 1;
  let limite     = 10;
  let buscar     = '';
  let usuarioEditando = null;

  const esGlobal = !!window._esGlobal;

  async function cargar() {
    const res = await Http.get('/usuarios');
    if (!res?.ok) return;
    todos      = res.usuarios;
    perfiles   = res.perfiles;
    sucursales = res.sucursales;
    if (esGlobal && sucursales.length) renderTabs();
    renderTabla();
  }

  function renderTabs() {
    const cont = document.getElementById('usr-tabs');
    cont.style.display = 'flex';
    const tab = (val, lbl) =>
      `<button class="suc-tab ${val === sucActiva ? 'active' : ''}" data-suc="${val === null ? '' : val}">${lbl}</button>`;
    cont.innerHTML = tab(null, 'Todas') + tab('global', 'Global')
      + sucursales.map(s => tab(s.id, s.nombre)).join('');
    cont.querySelectorAll('.suc-tab').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.suc;
        sucActiva = v === '' ? null : (v === 'global' ? 'global' : +v);
        pagina = 1;
        renderTabs();
        renderTabla();
      };
    });
  }

  function renderTabla() {
    const q = buscar.toLowerCase();
    const filtrados = todos.filter(u => {
      if (sucActiva === 'global' && u.sucursal_id != null) return false;
      if (typeof sucActiva === 'number' && u.sucursal_id !== sucActiva) return false;
      return (
        u.nombre?.toLowerCase().includes(q)       ||
        u.username?.toLowerCase().includes(q)     ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.perfil_nombre || '').toLowerCase().includes(q)
      );
    });

    const total  = filtrados.length;
    const inicio = (pagina - 1) * limite;
    const data   = filtrados.slice(inicio, inicio + limite);
    const tbody  = document.getElementById('tbody-usuarios');

    if (!data.length) {
      tbody.innerHTML = `
        <tr><td colspan="6">
          <div class="empty-state">
            <i class="ti ti-users"></i>
            <p>No se encontraron usuarios</p>
          </div>
        </td></tr>`;
    } else {
      tbody.innerHTML = data.map(u => {
        const esPrincipal = u.id === 1;
        const activo      = u.estado === 0;
        const inicial     = (u.nombre || 'U')[0].toUpperCase();

        const principalEditable = esPrincipal && Number(window._usuario?.id) === 1;
        const esPerfilAdmin = String(u.perfil_nombre || '').toLowerCase() === 'administrador';
        const acciones = esPrincipal
          ? (principalEditable
              ? `<button class="btn btn-warning btn-xs" onclick="_editarUsuario(${u.id})" title="Editar mi cuenta"><i class="ti ti-edit"></i></button>`
              : `<span style="font-size:12px;color:var(--texto-muted)">Protegido</span>`)
          : !window._esAdmin
            ? `<span style="font-size:12px;color:var(--texto-muted)">Sin permiso</span>`
            : `<div style="display:flex;gap:6px;align-items:center">
                 <button class="btn btn-warning btn-xs" onclick="_editarUsuario(${u.id})" title="Editar"><i class="ti ti-edit"></i></button>
                 ${Number(u.id) === Number(window._usuario?.id) ? '' : `<button class="btn ${activo ? 'btn-outline' : 'btn-success'} btn-xs" onclick="_toggleUsuario(${u.id},${activo ? 1 : 0})" title="${activo ? 'Desactivar' : 'Activar'}"><i class="ti ti-${activo ? 'user-off' : 'user-check'}"></i></button>`}
                 ${esPerfilAdmin ? '<span class="badge badge-muted">No eliminable</span>' : `<button class="btn btn-danger btn-xs" onclick="_eliminarUsuario(${u.id},'${u.nombre.replace(/'/g,"\'")}')" title="Eliminar"><i class="ti ti-trash"></i></button>`}
               </div>`;

        return `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:34px;height:34px;background:var(--rojo);
                            border-radius:50%;display:flex;align-items:center;
                            justify-content:center;font-weight:700;
                            color:#fff;font-size:13px;flex-shrink:0">
                  ${inicial}
                </div>
                <div>
                  <div style="font-weight:500;color:#fff">${u.nombre}</div>
                  <div style="font-size:11px;color:var(--texto-muted)">
                    @${u.username}
                  </div>
                </div>
              </div>
            </td>
            <td style="color:var(--texto-muted)">${u.email || '-'}</td>
            <td><span class="badge badge-info">${u.perfil_nombre}</span></td>
            <td>${u.sucursal_nombre ||
              '<span class="text-muted">Global</span>'}</td>
            <td>
              <span class="badge ${activo ? 'badge-success' : 'badge-muted'}">
                ${activo ? 'Activo' : 'Inactivo'}
              </span>
            </td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                ${Number(u.doble_factor_activo) === 1
                  ? '<span class="badge badge-success"><i class="ti ti-shield-check"></i> Configurado</span>'
                  : '<span class="badge badge-warning"><i class="ti ti-shield-half"></i> Pendiente</span>'}
                ${window._esAdmin && Number(u.doble_factor_activo) === 1 ? `<button class="btn btn-outline btn-xs" onclick="_resetAutenticador(${u.id})" title="Reiniciar autenticador"><i class="ti ti-refresh"></i></button>` : ''}
              </div>
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

  function llenarSelects() {
    const selPerfil = document.getElementById('usr-perfil');
    selPerfil.innerHTML = '<option value="">Selecciona perfil</option>';
    perfiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.nombre;
      selPerfil.appendChild(opt);
    });
    const selSuc = document.getElementById('usr-sucursal');
    selSuc.innerHTML = '';
    sucursales.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id; opt.textContent = s.nombre;
      selSuc.appendChild(opt);
    });
  }

  function esPerfilVendedor(perfilId) {
    const perfil = perfiles.find(p => +p.id === +perfilId);
    return String(perfil?.nombre || '').trim().toLowerCase() === 'vendedor';
  }

  function actualizarSeccionPin() {
    const esVendedor = esPerfilVendedor(document.getElementById('usr-perfil').value);
    const bloque = document.getElementById('grupo-pin-cajero');
    if (!esVendedor) {
      bloque.style.display = 'none';
      document.getElementById('usr-pin-cajero').value = '';
      document.getElementById('usr-confirmar-pin-cajero').value = '';
      return;
    }

    const esNuevo = !document.getElementById('usr-id').value;
    const tienePin = !!Number(usuarioEditando?.tiene_pin_cajero || 0);
    const obligatorio = esNuevo || !tienePin;
    const estadoPin = document.getElementById('pin-cajero-estado');
    bloque.style.display = 'block';
    document.getElementById('pin-cajero-requerido').style.display = obligatorio ? 'inline' : 'none';
    document.getElementById('pin-cajero-confirmar-requerido').style.display = obligatorio ? 'inline' : 'none';
    document.getElementById('usr-pin-cajero').required = obligatorio;
    document.getElementById('usr-confirmar-pin-cajero').required = obligatorio;

    estadoPin.style.display = 'block';
    if (obligatorio) {
      estadoPin.style.color = 'var(--danger)';
      estadoPin.innerHTML = '<i class="ti ti-alert-circle"></i> PIN obligatorio para el perfil Vendedor';
      document.getElementById('pin-cajero-ayuda').textContent =
        'No se puede guardar ni activar un vendedor sin PIN de cajero. Debe tener de 4 a 6 dígitos.';
    } else {
      estadoPin.style.color = 'var(--success)';
      estadoPin.innerHTML = '<i class="ti ti-circle-check"></i> PIN de cajero registrado';
      document.getElementById('pin-cajero-ayuda').textContent =
        'Este vendedor ya tiene PIN. Escribe y confirma otro PIN solo si deseas reemplazarlo.';
    }
  }

  function mostrarErrorPin(mensaje) {
    const el = document.getElementById('err-pin-cajero');
    el.textContent = mensaje;
    el.style.display = 'block';
    document.getElementById('usr-pin-cajero').style.borderColor = 'var(--danger)';
    document.getElementById('usr-confirmar-pin-cajero').style.borderColor = 'var(--danger)';
  }

  function limpiarErrorPin() {
    document.getElementById('err-pin-cajero').style.display = 'none';
    document.getElementById('usr-pin-cajero').style.borderColor = '';
    document.getElementById('usr-confirmar-pin-cajero').style.borderColor = '';
  }

  function cerrarModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    limpiarModal();
  }

  function limpiarModal() {
    ['usr-id','usr-nombre','usr-username','usr-email',
     'usr-password','usr-nueva-pass','usr-pin-cajero','usr-confirmar-pin-cajero'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('usr-estado').value = '0';
    document.getElementById('usr-estado').disabled = false;
    document.getElementById('grupo-estado-usr').style.display  = 'none';
    document.getElementById('grupo-pass-crear').style.display  = 'block';
    document.getElementById('grupo-pass-editar').style.display = 'none';
    document.getElementById('grupo-pin-cajero').style.display = 'none';
    document.getElementById('pin-cajero-estado').style.display = 'none';
    usuarioEditando = null;
    limpiarErrorPin();
    document.getElementById('usr-username').removeAttribute('readonly');
    document.getElementById('usr-username').style.opacity = '1';
    document.getElementById('usr-username').style.cursor  = 'auto';
    limpiarErrores();
  }

  // ── Helpers de error visual ─────────────────────────────
  function mostrarError(campo, mensaje) {
    const el  = document.getElementById(`err-${campo}`);
    const inp = document.getElementById(`usr-${campo}`);
    if (el)  { el.textContent = mensaje; el.style.display = 'block'; }
    if (inp) inp.style.borderColor = 'var(--danger)';
  }
  function ocultarError(campo) {
    const el  = document.getElementById(`err-${campo}`);
    const inp = document.getElementById(`usr-${campo}`);
    if (el)  el.style.display = 'none';
    if (inp) inp.style.borderColor = '';
  }
  function limpiarErrores() {
    ['nombre','username','email','password'].forEach(ocultarError);
    limpiarErrorPin();
  }

  // ── Validación en tiempo real ───────────────────────────
  function validarNombreVivo() {
    const v = document.getElementById('usr-nombre').value;
    if (v && !RE_NOMBRE.test(v)) {
      mostrarError('nombre', 'Solo se permiten letras, números y espacios');
      return false;
    }
    ocultarError('nombre');
    return true;
  }
  function validarUsernameVivo() {
    const v = document.getElementById('usr-username').value;
    if (v && !RE_USERNAME.test(v)) {
      mostrarError('username', 'Solo se permiten letras y números (sin espacios ni símbolos)');
      return false;
    }
    ocultarError('username');
    return true;
  }
  function validarEmailVivo() {
    const v = document.getElementById('usr-email').value.trim();
    if (v && !RE_EMAIL.test(v)) {
      mostrarError('email', 'Formato de email inválido');
      return false;
    }
    ocultarError('email');
    return true;
  }

  async function guardar() {
    limpiarErrores();
    const id       = document.getElementById('usr-id').value;
    const nombre   = document.getElementById('usr-nombre').value.trim();
    const username = document.getElementById('usr-username').value.trim();
    const email    = document.getElementById('usr-email').value.trim();
    const perfil   = document.getElementById('usr-perfil').value;
    const sucursal = document.getElementById('usr-sucursal').value;

    if (!nombre) {
      mostrarError('nombre', 'El nombre es requerido');
      return;
    }
    if (nombre.length < 3) {
      mostrarError('nombre', 'El nombre debe tener al menos 3 caracteres');
      return;
    }
    if (!RE_NOMBRE.test(nombre)) {
      mostrarError('nombre', 'Solo se permiten letras, números y espacios (sin símbolos)');
      return;
    }

    if (!username) {
      mostrarError('username', 'El username es requerido');
      return;
    }
    if (username.length < 3) {
      mostrarError('username', 'El username debe tener al menos 3 caracteres');
      return;
    }
    if (!RE_USERNAME.test(username)) {
      mostrarError('username', 'Solo se permiten letras y números (sin espacios ni símbolos)');
      return;
    }

    if (email && !RE_EMAIL.test(email)) {
      mostrarError('email', 'Formato de email inválido');
      return;
    }

    if (!perfil)
      return Swal.fire({
        icon: 'error', title: 'Error', text: 'Selecciona un perfil',
        background: '#1a1a2e', color: '#e0e0e0', confirmButtonColor: '#e53935'
      });
    const editandoPrincipalGlobal = Number(id || 0) === 1 && !!window._esGlobal;
    if (!sucursal && !editandoPrincipalGlobal)
      return Swal.fire({
        icon: 'error', title: 'Error', text: 'Selecciona una sucursal',
        background: '#1a1a2e', color: '#e0e0e0', confirmButtonColor: '#e53935'
      });

    const vendedor = esPerfilVendedor(perfil);
    const pin = document.getElementById('usr-pin-cajero').value.trim();
    const confirmarPin = document.getElementById('usr-confirmar-pin-cajero').value.trim();
    if (vendedor) {
      const obligatorio = !id || !Number(usuarioEditando?.tiene_pin_cajero || 0);
      if (obligatorio && !pin) {
        mostrarErrorPin('Debes crear el PIN de cajero para este vendedor');
        return;
      }
      if (pin || confirmarPin) {
        if (!/^\d{4,6}$/.test(pin)) {
          mostrarErrorPin('El PIN debe tener entre 4 y 6 dígitos');
          return;
        }
        if (pin !== confirmarPin) {
          mostrarErrorPin('Los PIN no coinciden');
          return;
        }
      }
    }

    const body = {
      nombre, username, email: email || null,
      perfil_id: +perfil,
      sucursal_id: sucursal ? +sucursal : null
    };
    if (vendedor && pin) body.pin_cajero = pin;

    if (!id) {
      const pass = document.getElementById('usr-password').value;
      if (!pass || pass.length < 8 || !/[A-Za-z]/.test(pass) || !/\d/.test(pass)) {
        mostrarError('password', 'Mínimo 8 caracteres, con al menos una letra y un número');
        return;
      }
      if (!RE_PASSWORD.test(pass)) {
        mostrarError('password', 'Solo letras y números (sin caracteres especiales)');
        return;
      }
      body.password = pass;
    } else {
      body.estado = +document.getElementById('usr-estado').value;
      const nueva = document.getElementById('usr-nueva-pass').value;
      if (nueva) {
        if (nueva.length < 8 || !/[A-Za-z]/.test(nueva) || !/\d/.test(nueva))
          return Swal.fire({
            icon: 'error', title: 'Error',
            text: 'La nueva contraseña debe tener mínimo 8 caracteres, con al menos una letra y un número',
            background: '#1a1a2e', color: '#e0e0e0', confirmButtonColor: '#e53935'
          });
        if (!RE_PASSWORD.test(nueva))
          return Swal.fire({
            icon: 'error', title: 'Error',
            text: 'La contraseña solo puede contener letras y números',
            background: '#1a1a2e', color: '#e0e0e0', confirmButtonColor: '#e53935'
          });
        body.cambiar_password = true;
        body.nueva_password   = nueva;
      }
    }

    if (id && (String(usuarioEditando?.perfil_nombre || '').toLowerCase().startsWith('administrador') || Number(id) === Number(window._usuario?.id))) {
      const confirmacion = await Swal.fire({
        title:'Confirma tu contraseña', input:'password', inputPlaceholder:'Contraseña actual',
        showCancelButton:true, confirmButtonText:'Confirmar', cancelButtonText:'Cancelar',
        background:'#1a1a2e', color:'#e0e0e0', confirmButtonColor:'#00a651',
        inputValidator:v => !v ? 'La contraseña es obligatoria' : undefined
      });
      if (!confirmacion.isConfirmed) return;
      body.current_password = confirmacion.value;
    }

    const btn = document.getElementById('btn-guardar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Guardando...';

    const res = id
      ? await Http.put(`/usuarios/${id}`, body)
      : await Http.post('/usuarios', body);

    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Guardar';

    if (!res?.ok)
      return Swal.fire({
        icon: 'error', title: 'Error',
        text: res?.msg || 'Error al guardar',
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });

    const titulo = res.reactivado ? 'Usuario reactivado'
      : id ? 'Usuario actualizado' : 'Usuario creado';

    cerrarModal();
    Swal.fire({
      icon: 'success', title: titulo,
      timer: 1500, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
    await cargar();
  }

  window._editarUsuario = function(id) {
    const u = todos.find(x => x.id === id);
    if (!u) return;
    limpiarErrores();
    usuarioEditando = u;
    llenarSelects();
    document.getElementById('usr-id').value         = u.id;
    document.getElementById('usr-nombre').value     = u.nombre;
    document.getElementById('usr-username').value   = u.username;
    document.getElementById('usr-email').value      = u.email || '';
    document.getElementById('usr-estado').value     = u.estado;
    // La cuenta propia no se puede desactivar desde aquí.
    document.getElementById('usr-estado').disabled = Number(u.id) === Number(window._usuario?.id);
    document.getElementById('usr-nueva-pass').value = '';
    document.getElementById('grupo-estado-usr').style.display  = 'block';
    document.getElementById('grupo-pass-crear').style.display  = 'none';
    document.getElementById('grupo-pass-editar').style.display = 'block';
    document.getElementById('usr-username').removeAttribute('readonly');
    document.getElementById('usr-username').style.opacity = '1';
    document.getElementById('usr-username').style.cursor  = 'auto';
    document.getElementById('modal-titulo').textContent = 'Editar Usuario';
    document.getElementById('modal-overlay').classList.add('open');
    setTimeout(() => {
      document.getElementById('usr-perfil').value   = u.perfil_id;
      document.getElementById('usr-sucursal').value = u.sucursal_id || '';
      actualizarSeccionPin();
    }, 50);
  };

  window._toggleUsuario = async function(id, nuevoEstado) {
    const u = todos.find(x => x.id === id);
    if (nuevoEstado === 0) {
      const perfil = perfiles.find(p => p.id === u?.perfil_id);
      if (perfil && perfil.estado !== 0) {
        Swal.fire({
          icon: 'warning', title: 'No se puede activar',
          text: `El perfil "${perfil.nombre}" está desactivado. Activa el perfil primero.`,
          background: '#1a1a2e', color: '#e0e0e0',
          confirmButtonColor: '#e53935'
        });
        return;
      }
    }
    let admin_password='';
    const objetivoAdmin=String(u?.perfil_nombre||'').toLowerCase().startsWith('administrador');
    if(objetivoAdmin){
      const auth = await Swal.fire({title:'Confirma la acción administrativa',input:'password',inputPlaceholder:'Tu contraseña',showCancelButton:true,confirmButtonText:'Continuar',cancelButtonText:'Cancelar',background:'#1a1a2e',color:'#e0e0e0',confirmButtonColor:'#00a651',inputValidator:v=>!v?'La contraseña es obligatoria':undefined});
      if(!auth.isConfirmed)return; admin_password=auth.value;
    }
    const res = await Http.patch(`/usuarios/${id}/estado`, { estado: nuevoEstado, admin_password });
    if (!res?.ok)
      return Swal.fire({
        icon: 'error', title: 'Error', text: res?.msg,
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });
    await cargar();
  };

  // Reiniciar autenticador (celular perdido o cambiado).
  window._resetAutenticador = async function(id) {
    const u = todos.find(x => x.id === id);
    const conf = await Swal.fire({
      icon: 'warning', title: 'Reiniciar autenticador',
      html: `<b>${String(u?.nombre || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</b> tendrá que escanear un QR nuevo en su próximo ingreso y se cerrarán sus sesiones abiertas.`,
      input: 'password', inputPlaceholder: 'Tu contraseña para confirmar',
      showCancelButton: true, confirmButtonText: 'Reiniciar', cancelButtonText: 'Cancelar', confirmButtonColor: '#d97706',
      inputValidator: v => v ? undefined : 'Escribe tu contraseña'
    });
    if (!conf.isConfirmed) return;
    const res = await Http.patch(`/usuarios/${id}/2fa-reset`, { admin_password: conf.value });
    if (!res?.ok) return Swal.fire({ icon: 'error', title: 'No se pudo reiniciar', text: res?.msg || '' });
    await Swal.fire({ icon: 'success', title: 'Listo', text: res.msg, timer: 2600, showConfirmButton: false });
    if (id === Number(window._usuario?.id)) return Http.post('/auth/logout').finally(() => { window.location.href = '/login'; });
    await cargar();
  };

  window._eliminarUsuario = async function(id, nombre) {
    const conf = await Swal.fire({
      title: `¿Eliminar a "${nombre}"?`,
      text: 'Esta acción no se puede deshacer', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar', confirmButtonColor: '#e53935',
      background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;
    const res = await Http.delete(`/usuarios/${id}`, {});
    if (!res?.ok)
      return Swal.fire({
        icon: 'error', title: 'Error', text: res?.msg,
        background: '#1a1a2e', color: '#e0e0e0',
        confirmButtonColor: '#e53935'
      });
    Swal.fire({
      icon: 'success', title: 'Usuario eliminado',
      timer: 1500, showConfirmButton: false,
      background: '#1a1a2e', color: '#e0e0e0'
    });
    await cargar();
  };

  if (window._esAdmin) {
    document.getElementById('btn-nuevo-usuario')
      ?.addEventListener('click', () => {
        limpiarModal(); llenarSelects();
        document.getElementById('modal-titulo').textContent = 'Nuevo Usuario';
        document.getElementById('modal-overlay').classList.add('open');
        actualizarSeccionPin();
      });
  }

  // ── Filtrado de teclas en tiempo real ───────────────────
  // Nombre: bloquea todo lo que no sea letra o espacio
  document.getElementById('usr-nombre').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s]/g, '');
    validarNombreVivo();
  });
  // Username: letras y números (camion1, camion2)
  document.getElementById('usr-username').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, '');
    validarUsernameVivo();
  });
  document.getElementById('usr-email').addEventListener('input', validarEmailVivo);
  // Contraseña: bloquea caracteres especiales en tiempo real
  document.getElementById('usr-password').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, '');
  });
  document.getElementById('usr-nueva-pass').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, '');
  });

  document.getElementById('usr-perfil').addEventListener('change', actualizarSeccionPin);
  ['usr-pin-cajero','usr-confirmar-pin-cajero'].forEach(id => {
    document.getElementById(id).addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\D/g, '');
      limpiarErrorPin();
    });
  });

  document.getElementById('btn-cerrar-modal').addEventListener('click', cerrarModal);
  document.getElementById('btn-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('btn-guardar').addEventListener('click', guardar);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') cerrarModal();
  });
  document.getElementById('inp-buscar').addEventListener('input', e => {
    buscar = e.target.value; pagina = 1; renderTabla();
  });
  document.getElementById('sel-limite').addEventListener('change', e => {
    limite = parseInt(e.target.value); pagina = 1; renderTabla();
  });

  await cargar();
};