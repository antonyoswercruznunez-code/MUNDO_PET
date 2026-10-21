window.init_apertura_caja = async function () {
  const html = await fetch('/views/pages/apertura-caja.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  const alerta = (icon, title, text, timer) => Swal.fire({
    icon, title, text,
    background: '#1a1a2e', color: '#e0e0e0',
    confirmButtonColor: '#e53935', timer: timer || undefined,
    showConfirmButton: !timer
  });
  const fmt = n => `S/ ${Number(n || 0).toFixed(2)}`;
  const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  let cajaSeleccionada = null;
  let esGlobal = false;
  let sucursalSeleccionada = null;
  let sucursales = [];

  function cerrarModal() {
    document.getElementById('modal-apertura-caja').style.display = 'none';
    cajaSeleccionada = null;
  }

  function abrirModal(caja) {
    cajaSeleccionada = caja;
    document.getElementById('apertura-caja-nombre').textContent = caja.codigo;
    document.getElementById('apertura-pin').value = '';
    document.getElementById('apertura-monto').textContent = fmt(caja.monto_inicial_predeterminado || 0);
    document.getElementById('apertura-observacion').value = '';
    document.getElementById('modal-apertura-caja').style.display = 'flex';
    setTimeout(() => document.getElementById('apertura-pin').focus(), 0);
  }

  async function cargar() {
    const endpoint = esGlobal && sucursalSeleccionada
      ? `/caja/disponibles?sucursal_id=${encodeURIComponent(sucursalSeleccionada)}`
      : '/caja/disponibles';
    const respuesta = await Http.get(endpoint);
    const mensaje = document.getElementById('apertura-mensaje');
    const cont = document.getElementById('apertura-cajas');
    const bloque = document.getElementById('apertura-disponibles');

    if (!respuesta?.ok) {
      bloque.style.display = 'none';
      mensaje.innerHTML = `
        <div class="card" style="padding:24px;text-align:center;max-width:620px;margin:26px auto">
          <i class="ti ti-lock" style="font-size:38px;color:var(--warning)"></i>
          <h3 style="margin:12px 0 6px;color:var(--texto-fuerte)">Apertura no disponible</h3>
          <p style="margin:0;color:var(--texto-muted)">${escapeHtml(respuesta?.msg || 'No tienes acceso a la apertura de caja.')}</p>
        </div>`;
      return;
    }

    if (respuesta.ya_tiene_caja_abierta && respuesta.sesion) {
      const s = respuesta.sesion;
      bloque.style.display = 'none';
      mensaje.innerHTML = `
        <div class="card" style="max-width:650px;padding:26px;margin:26px auto;text-align:center">
          <i class="ti ti-lock-check" style="font-size:42px;color:var(--success)"></i>
          <h3 style="margin:12px 0 6px;color:var(--texto-fuerte)">Ya tienes una caja abierta</h3>
          <p style="margin:0 0 18px;color:var(--texto-muted)">
            Estás operando <b>${escapeHtml(s.caja_fisica_codigo || s.codigo || 'una caja')}</b>. Debes cerrarla antes de abrir otra.
          </p>
          <button class="btn btn-primary" id="btn-ir-cajas"><i class="ti ti-cash"></i> Ir a Cajas</button>
        </div>`;
      document.getElementById('btn-ir-cajas').onclick = () => Router.navegar('cajas');
      return;
    }

    bloque.style.display = 'block';
    mensaje.innerHTML = '';
    const cajas = respuesta.cajas || [];
    document.getElementById('apertura-sucursal').textContent = cajas[0]
      ? `Sucursal: ${cajas[0].sucursal_nombre}`
      : (respuesta.sucursal_nombre ? `Sucursal: ${respuesta.sucursal_nombre}` : 'Sucursal asignada');

    if (!cajas.length) {
      cont.innerHTML = `
        <div class="card" style="grid-column:1/-1;padding:30px;text-align:center">
          <i class="ti ti-lock" style="font-size:36px;color:var(--texto-muted)"></i>
          <h3 style="margin:10px 0 5px;color:var(--texto-fuerte)">No hay cajas disponibles</h3>
          <p style="margin:0;color:var(--texto-muted);font-size:13px">${escapeHtml(respuesta.msg || 'Todas las cajas habilitadas están en uso, están fuera de horario o aún no han sido activadas por el administrador.')}</p>
        </div>`;
      return;
    }

    cont.innerHTML = cajas.map(c => {
      const horario = c.hora_apertura && c.hora_cierre
        ? `${c.hora_apertura} – ${c.hora_cierre}`
        : 'Sin horario restringido';
      const puedeAbrir = c.dentro_horario !== false;
      const estado = puedeAbrir
        ? '<span class="badge badge-success">Disponible</span>'
        : '<span class="badge badge-warning">Fuera de horario</span>';
      const detalle = puedeAbrir
        ? '<span style="color:var(--success)"><i class="ti ti-circle-check"></i> Puedes abrirla ahora</span>'
        : `<span style="color:var(--warning)"><i class="ti ti-clock-exclamation"></i> Disponible en su horario (${horario})</span>`;
      const boton = puedeAbrir
        ? `<button class="btn btn-primary" style="width:100%" data-caja-id="${c.id}"><i class="ti ti-lock-open"></i> Abrir esta caja</button>`
        : `<button class="btn btn-outline" style="width:100%;opacity:.7;cursor:not-allowed" disabled><i class="ti ti-clock"></i> Fuera de horario</button>`;
      return `
        <article class="apertura-card" style="${puedeAbrir ? '' : 'opacity:.82'}">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;margin-bottom:14px">
            <div>
              <h3 style="margin:0;color:var(--texto-fuerte);font-size:17px"><i class="ti ti-cash"></i> ${escapeHtml(c.codigo)}</h3>
              <p style="margin:5px 0 0;font-size:12px;color:var(--texto-muted)">${escapeHtml(c.sucursal_nombre)}</p>
            </div>
            ${estado}
          </div>
          <div style="font-size:12px;color:var(--texto-muted);margin-bottom:8px"><i class="ti ti-clock"></i> Horario: ${horario}</div>
          <div style="font-size:12px;margin-bottom:15px">${detalle}</div>
          ${boton}
        </article>`;
    }).join('');

    cont.querySelectorAll('[data-caja-id]').forEach(btn => {
      btn.onclick = () => abrirModal(cajas.find(c => +c.id === +btn.dataset.cajaId));
    });
  }

  document.getElementById('apertura-pin').addEventListener('input', e => {
    if (!esGlobal) e.target.value = e.target.value.replace(/\D/g, '');
  });
  document.getElementById('btn-cancelar-apertura').onclick = cerrarModal;
  document.getElementById('btn-cancelar-apertura-2').onclick = cerrarModal;
  document.getElementById('modal-apertura-caja').addEventListener('click', e => {
    if (e.target.id === 'modal-apertura-caja') cerrarModal();
  });

  document.getElementById('btn-confirmar-apertura').onclick = async () => {
    if (!cajaSeleccionada) return;
    const pin_cajero = document.getElementById('apertura-pin').value.trim();
    const observacion = document.getElementById('apertura-observacion').value.trim();
    if (!esGlobal && !/^\d{4,6}$/.test(pin_cajero)) return alerta('error', 'PIN inválido', 'Ingresa tu PIN de cajero de 4 a 6 dígitos.');
    if (esGlobal && !pin_cajero) return alerta('error', 'Contraseña requerida', 'Ingresa tu contraseña de administrador.');

    const btn = document.getElementById('btn-confirmar-apertura');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Abriendo...';
    const res = await Http.post('/caja/abrir', {
      caja_fisica_id: cajaSeleccionada.id,
      observacion,
      pin_cajero,
      sucursal_id: sucursalSeleccionada
    });
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-lock-open"></i> Abrir caja';
    if (!res?.ok) return alerta('error', 'No se pudo abrir', res?.msg || 'Intenta nuevamente.');

    cerrarModal();
    alerta('success', 'Caja abierta', res.msg || `Puedes operar ${cajaSeleccionada.codigo}.`, 1500);
    await cargar();
  };

  try {
    const sesion = await Http.get('/auth/session');
    const usuario = sesion?.usuario || sesion?.user || sesion?.data || sesion || {};
    esGlobal = !!usuario.es_global;
    if (esGlobal) {
      const r = await Http.get('/sucursales');
      sucursales = r?.sucursales || [];
      const selectorWrap = document.getElementById('apertura-selector-global');
      const selector = document.getElementById('apertura-sucursal-select');
      selectorWrap.style.display = 'block';
      selector.innerHTML = sucursales.map(s => `<option value="${s.id}">${escapeHtml(s.nombre)}</option>`).join('');
      sucursalSeleccionada = Number(selector.value || sucursales[0]?.id || 0) || null;
      selector.onchange = async () => {
        sucursalSeleccionada = Number(selector.value || 0) || null;
        await cargar();
      };
      const input = document.getElementById('apertura-pin');
      document.getElementById('apertura-credencial-label').textContent = 'Contraseña del administrador *';
      input.inputMode = 'text'; input.maxLength = 100; input.placeholder = 'Tu contraseña de inicio de sesión';
    }
  } catch (_) {}

  await cargar();
};
