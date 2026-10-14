window.init_cajas = async function () {
  const html = await fetch('/views/pages/cajas.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  const cajaStyle=document.createElement('style');
  cajaStyle.textContent=`
    .caja-ui-card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,.06)}
    .caja-web-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}
    .caja-web-kpi{padding:17px;border:1px solid var(--card-border);border-radius:13px;background:var(--card-bg);position:relative;overflow:hidden}
    .caja-web-kpi:after{content:'';position:absolute;left:0;right:0;bottom:0;height:4px;background:var(--accent,#16a34a)}
    .caja-web-kpi small{color:var(--texto-muted);font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:.35px}
    .caja-web-kpi strong{display:block;font-size:22px;margin-top:7px;color:var(--texto-fuerte)}
    .caja-section{padding:18px;margin-bottom:16px;border:1px solid var(--card-border);border-radius:14px;background:var(--card-bg)}
    .caja-section-title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 14px;font-size:15px}
    .caja-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;min-width:760px}
    .caja-table th{padding:10px;background:var(--input-bg);color:var(--texto-muted);font-weight:800;text-align:left;border-bottom:1px solid var(--card-border)}
    .caja-table td{padding:11px 10px;border-bottom:1px solid var(--card-border);vertical-align:middle}
    .caja-table tbody tr:hover{background:rgba(14,165,233,.05)}
    .caja-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:999px;font-weight:800;font-size:10px;text-transform:uppercase}
    .caja-chip--ok{background:#dcfce7;color:#166534}.caja-chip--warn{background:#fef3c7;color:#92400e}.caja-chip--danger{background:#fee2e2;color:#991b1b}.caja-chip--info{background:#e0f2fe;color:#075985}
    .caja-state-btn{border:1px solid var(--card-border);border-radius:9px;padding:7px 10px;background:var(--card-bg);color:var(--texto-fuerte);font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
    .caja-state-btn:hover{border-color:#0ea5e9;background:rgba(14,165,233,.08)}
    .caja-detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px}
    .caja-detail-card{padding:13px;border-radius:11px;border:1px solid #e2e8f0;background:#f8fafc}
    .caja-detail-card small{display:block;color:#64748b;font-weight:700;text-transform:uppercase;font-size:9px;letter-spacing:.4px}.caja-detail-card b{display:block;color:#0f172a;font-size:14px;margin-top:5px;word-break:break-word}
    @media(max-width:760px){.caja-web-filter>div:last-child{grid-template-columns:1fr}.caja-detail-grid{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(cajaStyle);

  let cajaActual = null;
  let arqueoActual = null;
  const hoyPeru = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const validarRango = (desde,hasta) => {
    const hoy=hoyPeru();
    if ((desde && desde>hoy)||(hasta && hasta>hoy)) return 'No se permiten fechas futuras en los filtros.';
    if (desde && hasta && desde>hasta) return 'La fecha Desde no puede ser posterior a Hasta.';
    return '';
  };

  const alerta = (icon, title, text, timer) => Swal.fire({
    icon, title, text,
    background: '#1a1a2e', color: '#e0e0e0',
    confirmButtonColor: '#e53935',
    timer: timer || undefined, showConfirmButton: !timer
  });

  // ── HELPERS ────────────────────────────────────────────
  window.switchTab = function(e, tab) {
    e.preventDefault();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    e.target.closest('.tab-btn').classList.add('active');
    document.getElementById('tab-' + tab).style.display = 'block';
    if (tab === 'historial') cargarHistorial();
    else if (tab === 'digital') cargarDigital();
    else if (tab === 'web') cargarCajaWeb();
  };

  window.cerrarModal = function(id) {
    document.getElementById(id).style.display = 'none';
  };

  const fmt = n => 'S/ ' + Number(n).toFixed(2);
  const esAdmin = window._esAdmin === true || window._esGlobal === true;
  const esVendedor = String(window._usuario?.perfil_nombre || '').toLowerCase() === 'vendedor';
  const escapeHtml = value => String(value || '').replace(/[&<>'\"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  let cajasFisicas = [];

  // ── CARGAR CAJA ACTUAL ─────────────────────────────────
  async function cargarCajaActual() {
    const res = await Http.get('/caja/actual');
    if (!res?.ok) return;

    cajaActual = res.sesion;
    arqueoActual = res.arqueo;
    const noAbierta = document.getElementById('caja-no-abierta');
    const abierta = document.getElementById('caja-abierta');

    // Ocultar únicamente los modales que pertenecen a este módulo.
    document.getElementById('modal-movimiento').style.display = 'none';
    document.getElementById('modal-cerrar-caja').style.display = 'none';

    if (!cajaActual) {
      noAbierta.style.display = 'block';
      abierta.style.display = 'none';
      const btnApertura = document.getElementById('btn-ir-apertura-caja');
      if (btnApertura) {
        btnApertura.style.display = esVendedor ? 'inline-flex' : 'none';
        btnApertura.onclick = () => Router.navegar('apertura-caja');
      }
      return;
    }

    noAbierta.style.display = 'none';
    abierta.style.display = 'block';

    // Datos sesión
    document.getElementById('caja-codigo').textContent = cajaActual.caja_fisica_codigo || ('CAJA-' + String(cajaActual.numero_caja || cajaActual.id).padStart(5, '0'));
    document.getElementById('caja-cajero').textContent = cajaActual.cajero_nombre || '—';
    document.getElementById('caja-sucursal').textContent = cajaActual.sucursal_nombre || '—';
    const fApe = new Date(cajaActual.abierta_at);
    document.getElementById('caja-apertura').textContent = fApe.toLocaleString('es-PE', { 
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    // Arqueo
    document.getElementById('arqueo-inicial').textContent = fmt(arqueoActual.monto_inicial);
    document.getElementById('arqueo-ventas').textContent = fmt(arqueoActual.total_ventas);
    document.getElementById('arqueo-ingresos').textContent = fmt(arqueoActual.total_ingresos);
    document.getElementById('arqueo-egresos').textContent = fmt(arqueoActual.total_egresos);
    document.getElementById('arqueo-esperado').textContent = fmt(arqueoActual.esperado);

    // Movimientos (solo los de ESTA sesión)
    const movs = res.movimientos || [];
    if (!movs.length) {
      document.getElementById('caja-movimientos-tabla').innerHTML = `
        <div style="text-align:center;color:var(--texto-muted);padding:24px;font-size:13px">
          No hay movimientos aún
        </div>`;
    } else {
      let html = `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="border-bottom:1px solid var(--card-border)">
          <tr style="height:32px">
            <th style="text-align:left;font-weight:600;color:var(--texto-muted)">Concepto</th>
            <th style="text-align:center;font-weight:600;color:var(--texto-muted)">Tipo</th>
            <th style="text-align:right;font-weight:600;color:var(--texto-muted)">Monto</th>
            <th style="text-align:right;font-weight:600;color:var(--texto-muted)">Hora</th>
          </tr>
        </thead>
        <tbody>`;
      movs.forEach((m) => {
        const color = m.tipo === 'ingreso' ? 'var(--success)' : 'var(--danger)';
        const sign = m.tipo === 'ingreso' ? '+' : '−';
        const dt = new Date(m.created_at);
        const hora = dt.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
        html += `<tr style="border-bottom:1px solid var(--card-border);height:36px">
          <td style="padding:8px 0">${m.concepto}</td>
          <td style="text-align:center"><span style="color:${color};font-weight:600">${m.tipo}</span></td>
          <td style="text-align:right;color:${color};font-weight:600;padding:8px 0">${sign} ${Number(m.monto).toFixed(2)}</td>
          <td style="text-align:right;color:var(--texto-muted);padding:8px 0;font-size:12px">${hora}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      document.getElementById('caja-movimientos-tabla').innerHTML = html;
    }

    // Botones de acción: solo "Agregar" y "Cerrar"
    document.getElementById('caja-acciones').style.display = 'flex';
  }

  // ── AGREGAR MOVIMIENTO ─────────────────────────────────
  window.showAgregarMovimiento = function() {
    if (!cajaActual) return alerta('error', 'Error', 'No hay caja abierta');
    document.getElementById('mov-concepto').value = '';
    document.getElementById('mov-monto').value = '';
    document.querySelector('input[name="mov-tipo"][value="ingreso"]').checked = true;
    document.getElementById('modal-movimiento').style.display = 'flex';
  };

  document.getElementById('btn-movimiento-submit')?.addEventListener('click', async () => {
    const tipo = document.querySelector('input[name="mov-tipo"]:checked').value;
    const concepto = document.getElementById('mov-concepto').value.trim();
    const monto = Number(document.getElementById('mov-monto').value);

    if (!concepto) return alerta('error', 'Error', 'Indica el concepto');
    if (isNaN(monto) || monto <= 0) return alerta('error', 'Error', 'El monto debe ser > 0');

    const btn = document.getElementById('btn-movimiento-submit');
    btn.disabled = true;
    const res = await Http.post('/caja/movimiento', { tipo, concepto, monto });
    btn.disabled = false;

    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo agregar');

    alerta('success', 'Movimiento registrado', '', 1200);
    cerrarModal('modal-movimiento');
    await cargarCajaActual();
  });

  // ── CERRAR CAJA ────────────────────────────────────────
  window.showCerrarCaja = function() {
    if (!cajaActual) return alerta('error', 'Error', 'No hay caja abierta');

    const modal = document.getElementById('modal-cerrar-caja');
    const esperado = arqueoActual.esperado;

    document.getElementById('cierre-inicial').textContent = fmt(arqueoActual.monto_inicial);
    document.getElementById('cierre-ventas').textContent = fmt(arqueoActual.total_ventas);
    document.getElementById('cierre-ingresos').textContent = fmt(arqueoActual.total_ingresos);
    document.getElementById('cierre-egresos').textContent = fmt(arqueoActual.total_egresos);
    document.getElementById('cierre-esperado').textContent = fmt(esperado);

    document.getElementById('cierre-contado').value = '';
    document.getElementById('cierre-obs').value = '';
    document.getElementById('cierre-diferencia-block').style.display = 'none';
    document.getElementById('cierre-obs-requerida').style.display = 'none';

    const contadoInput = document.getElementById('cierre-contado');
    contadoInput.oninput = () => {
      const contado = Number(contadoInput.value);
      const diferencia = contado - esperado;
      const block = document.getElementById('cierre-diferencia-block');
      const reqBlock = document.getElementById('cierre-obs-requerida');

      if (contado === esperado || contadoInput.value === '') {
        block.style.display = 'none';
        reqBlock.style.display = 'none';
      } else {
        block.style.display = 'block';
        const label = document.getElementById('cierre-diferencia-label');
        const monto = document.getElementById('cierre-diferencia-monto');
        if (diferencia > 0) {
          label.textContent = 'Sobrante: ';
          label.style.color = 'var(--success)';
          monto.textContent = fmt(diferencia);
          monto.style.color = 'var(--success)';
          reqBlock.style.display = 'none';
        } else {
          label.textContent = 'Faltante: ';
          label.style.color = 'var(--danger)';
          monto.textContent = fmt(Math.abs(diferencia));
          monto.style.color = 'var(--danger)';
          // Mostrar aviso si hay faltante
          if (Math.abs(diferencia) > 0) reqBlock.style.display = 'block';
        }
      }
    };

    modal.style.display = 'flex';
  };

  document.getElementById('btn-cerrar-caja-submit')?.addEventListener('click', async () => {
    const contado = Number(document.getElementById('cierre-contado').value);
    const obs = document.getElementById('cierre-obs').value.trim();

    if (isNaN(contado)) return alerta('error', 'Error', 'Indica el monto contado');

    const esperado = arqueoActual.esperado;
    const diferencia = contado - esperado;

    // Si hay diferencia (faltante), observación es OBLIGATORIA
    if (diferencia !== 0 && !obs) {
      return alerta('error', 'Observación requerida', 'Debes indicar el motivo de la diferencia (faltante/sobrante)');
    }

    const btn = document.getElementById('btn-cerrar-caja-submit');
    btn.disabled = true;
    const res = await Http.post('/caja/cerrar', { monto_contado: contado, observacion: obs });
    btn.disabled = false;

    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo cerrar');

    alerta('success', 'Caja cerrada', 'Pendiente de conciliación por admin', 1500);
    cerrarModal('modal-cerrar-caja');
    
    // Mostrar botón para ir a historial
    const btn_ir = document.getElementById('btn-ir-historial');
    if (btn_ir) btn_ir.style.display = 'block';
    
    await cargarCajaActual();
  });

  window.irAHistorial = function() {
    switchTab({ target: document.querySelector('[data-tab="historial"]') }, 'historial');
  };

  // ── RESUMEN ADMIN: QUIÉN ESTÁ OPERANDO AHORA ───────────
  async function cargarOperadoresActivos() {
    if (!esAdmin) return;
    const res = await Http.get('/caja/abiertas');
    if (!res?.ok) return;
    const cont = document.getElementById('admin-operadores-lista');
    const abiertas = res.abiertas || [];
    if (!abiertas.length) {
      cont.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--texto-muted);padding:14px;font-size:13px">No hay vendedores operando caja en este momento.</div>`;
      return;
    }
    cont.innerHTML = abiertas.map(c => {
      const fecha = c.abierta_at ? new Date(c.abierta_at).toLocaleString('es-PE', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—';
      return `<article style="padding:14px;border:1px solid var(--card-border);border-radius:10px;background:var(--input-bg)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:start">
          <div><div style="font-weight:700;color:var(--texto-fuerte)"><i class="ti ti-cash"></i> ${escapeHtml(c.codigo)}</div><div style="font-size:11px;color:var(--texto-muted);margin-top:4px">${escapeHtml(c.sucursal_nombre)}</div></div>
          <span class="badge badge-success">En uso</span>
        </div>
        <div style="margin-top:12px;font-size:13px"><i class="ti ti-user"></i> <b>${escapeHtml(c.cajero_nombre)}</b></div>
        <div style="margin-top:6px;font-size:11px;color:var(--texto-muted)"><i class="ti ti-clock"></i> Apertura: ${fecha}</div>
      </article>`;
    }).join('');
  }

  async function cargarCajasFisicas() {
    if (!esAdmin) return;
    const res = await Http.get('/caja/fisicas');
    if (!res?.ok) return;

    cajasFisicas = res.cajas || [];
    const cont = document.getElementById('admin-cajas-fisicas-lista');
    const grupos = new Map();

    cajasFisicas.forEach(c => {
      if (!grupos.has(c.sucursal_nombre)) grupos.set(c.sucursal_nombre, []);
      grupos.get(c.sucursal_nombre).push(c);
    });

    if (!grupos.size) {
      cont.innerHTML = '<div style="color:var(--texto-muted);font-size:13px;padding:12px 0">No hay cajas físicas configuradas.</div>';
      return;
    }

    cont.innerHTML = [...grupos.entries()].map(([sucursal, cajas]) => {
      const cards = cajas.map(c => {
        const enUso = Boolean(c.sesion_id);
        const disponible = Boolean(Number(c.activo)) && !enUso;
        const estadoTexto = enUso ? 'En uso' : (disponible ? 'Disponible' : 'Deshabilitada');
        const estadoClase = enUso ? 'uso' : (disponible ? 'disponible' : 'inactiva');
        const cardClase = enUso ? 'caja-fisica-card--ocupada' : (!Number(c.activo) ? 'caja-fisica-card--inactiva' : '');
        const horario = c.hora_apertura && c.hora_cierre
          ? `${escapeHtml(c.hora_apertura)} – ${escapeHtml(c.hora_cierre)}`
          : 'Sin restricción';
        const operador = enUso
          ? `<div class="caja-fisica-card__operator"><i class="ti ti-user"></i> Operando ahora<strong title="${escapeHtml(c.cajero_nombre || '')}">${escapeHtml(c.cajero_nombre || 'Sin identificar')}</strong></div>`
          : `<div class="caja-fisica-card__operator"><i class="ti ti-circle-check"></i> Estado<strong>${disponible ? 'Lista para apertura' : 'No disponible'}</strong></div>`;

        return `
          <article class="caja-fisica-card ${cardClase}">
            <div class="caja-fisica-card__top">
              <div class="caja-fisica-card__name"><i class="ti ti-cash"></i> ${escapeHtml(c.codigo)}</div>
              <span class="caja-fisica-card__badge caja-fisica-card__badge--${estadoClase}">${estadoTexto}</span>
            </div>
            ${operador}
            <div class="caja-fisica-card__details">
              <div class="caja-fisica-card__row"><span><i class="ti ti-clock"></i> Horario</span><span>${horario}</span></div>
              <div class="caja-fisica-card__row"><span><i class="ti ti-wallet"></i> Fondo</span><span>${fmt(c.monto_inicial_predeterminado || 0)}</span></div>
            </div>
            <button class="btn btn-outline btn-sm caja-fisica-card__action" data-config-caja="${c.id}"><i class="ti ${Number(c.activo) ? 'ti-settings' : 'ti-circle-check'}"></i> ${Number(c.activo) ? 'Configurar' : 'Configurar y habilitar'}</button>
          </article>`;
      }).join('');

      return `
        <section class="cajas-sucursal-group">
          <h5 class="cajas-sucursal-title"><i class="ti ti-building-store"></i> ${escapeHtml(sucursal)}</h5>
          <div class="cajas-config-grid">${cards}</div>
        </section>`;
    }).join('');

    cont.querySelectorAll('[data-config-caja]').forEach(btn => {
      btn.onclick = () => window.editarCajaFisica(+btn.dataset.configCaja);
    });
  }

  let cajaConfigurando = null;

  function prepararEstadoConfig(caja) {
    const habilitada = !!Number(caja?.activo);
    const estado = document.getElementById('cfg-caja-estado');
    const textoBtn = document.getElementById('btn-guardar-cfg-caja-texto');
    if (estado) {
      estado.style.background = habilitada ? 'rgba(22,163,74,.10)' : 'rgba(245,158,11,.10)';
      estado.innerHTML = habilitada
        ? '<i class="ti ti-circle-check" style="font-size:16px;color:var(--success)"></i><span>Esta caja ya está habilitada. Puedes actualizar fondo u horario y guardar los cambios.</span>'
        : '<i class="ti ti-info-circle" style="font-size:16px;color:var(--warning)"></i><span>Configura el fondo y horario. Después usa <b>Habilitar caja</b> para que aparezca al vendedor.</span>';
    }
    if (textoBtn) textoBtn.textContent = habilitada ? 'Guardar cambios' : 'Habilitar caja';
  }

  window.editarCajaFisica = function(id) {
    const caja = cajasFisicas.find(c => +c.id === +id);
    if (!caja) return;
    cajaConfigurando = caja;
    document.getElementById('cfg-caja-id').value = caja.id;
    document.getElementById('cfg-caja-nombre').textContent = caja.codigo;
    document.getElementById('cfg-caja-sucursal').textContent = caja.sucursal_nombre;
    document.getElementById('cfg-caja-monto-inicial').value = Number(caja.monto_inicial_predeterminado || 0).toFixed(2);
    document.getElementById('cfg-caja-hora-apertura').value = caja.hora_apertura || '';
    document.getElementById('cfg-caja-hora-cierre').value = caja.hora_cierre || '';
    prepararEstadoConfig(caja);
    document.getElementById('modal-config-caja-fisica').style.display = 'flex';
  };

  function cerrarConfigCaja() {
    document.getElementById('modal-config-caja-fisica').style.display = 'none';
    cajaConfigurando = null;
  }

  document.getElementById('btn-cerrar-cfg-caja')?.addEventListener('click', cerrarConfigCaja);
  document.getElementById('btn-cancelar-cfg-caja')?.addEventListener('click', cerrarConfigCaja);
  document.getElementById('modal-config-caja-fisica')?.addEventListener('click', e => {
    if (e.target.id === 'modal-config-caja-fisica') cerrarConfigCaja();
  });
  document.getElementById('btn-guardar-cfg-caja')?.addEventListener('click', async () => {
    const id = +document.getElementById('cfg-caja-id').value;
    // Configurar y guardar una caja pendiente la habilita de inmediato.
    // Por eso no existe un switch que el administrador pueda olvidar marcar.
    const activo = true;
    const estabaHabilitada = !!Number(cajaConfigurando?.activo);
    const monto_inicial_predeterminado = Number(document.getElementById('cfg-caja-monto-inicial').value);
    const hora_apertura = document.getElementById('cfg-caja-hora-apertura').value;
    const hora_cierre = document.getElementById('cfg-caja-hora-cierre').value;
    if (Number.isNaN(monto_inicial_predeterminado) || monto_inicial_predeterminado < 0) {
      return alerta('error', 'Fondo inválido', 'El fondo inicial debe ser 0 o mayor.');
    }
    const btn = document.getElementById('btn-guardar-cfg-caja');
    btn.disabled = true;
    const res = await Http.put('/caja/fisicas/' + id, { activo, monto_inicial_predeterminado, hora_apertura, hora_cierre });
    btn.disabled = false;
    if (!res?.ok) return alerta('error', 'No se pudo guardar', res?.msg || 'Revisa la configuración.');
    cerrarConfigCaja();
    alerta('success', estabaHabilitada ? 'Caja actualizada' : 'Caja habilitada',
      estabaHabilitada ? (res.msg || 'Los cambios fueron guardados.') : 'La caja ya aparece disponible para los vendedores de esta sucursal.', 1500);
    await Promise.all([cargarCajasFisicas(), cargarOperadoresActivos()]);
  });

  // ── HISTORIAL ──────────────────────────────────────────
  async function cargarHistorial() {
    const desde = document.getElementById('hist-desde').value;
    const hasta = document.getElementById('hist-hasta').value;
    const estado = document.getElementById('hist-estado').value;
    const errorRango=validarRango(desde,hasta); if(errorRango)return alerta('warning','Fechas inválidas',errorRango);

    const qs = new URLSearchParams();
    if (desde) qs.append('desde', desde);
    if (hasta) qs.append('hasta', hasta);
    if (estado) qs.append('estado', estado);

    const res = await Http.get('/caja?' + qs.toString());
    if (!res?.ok) return;

    const sesiones = res.sesiones || [];
    window._cajaHistorial = sesiones;
    const tabla = document.getElementById('historial-tabla');

    if (!sesiones.length) {
      tabla.innerHTML = '<div style="text-align:center;color:var(--texto-muted);padding:24px;font-size:13px">Sin registros</div>';
      return;
    }

    let html = `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="border-bottom:1px solid var(--card-border);background:var(--input-bg)">
          <tr style="height:36px">
            <th style="text-align:left;font-weight:600;color:var(--texto-muted);padding:8px">Código</th>
            <th style="text-align:left;font-weight:600;color:var(--texto-muted);padding:8px">Sucursal</th>
            <th style="text-align:left;font-weight:600;color:var(--texto-muted);padding:8px">Cajero</th>
            <th style="text-align:left;font-weight:600;color:var(--texto-muted);padding:8px">Apertura</th>
            <th style="text-align:left;font-weight:600;color:var(--texto-muted);padding:8px">Cierre</th>
            <th style="text-align:right;font-weight:600;color:var(--texto-muted);padding:8px">Esperado</th>
            <th style="text-align:right;font-weight:600;color:var(--texto-muted);padding:8px">Contado</th>
            <th style="text-align:right;font-weight:600;color:var(--texto-muted);padding:8px">Diferencia</th>
            <th style="text-align:center;font-weight:600;color:var(--texto-muted);padding:8px">Estado</th>
            <th style="text-align:center;font-weight:600;color:var(--texto-muted);padding:8px">Acciones</th>
          </tr>
        </thead>
        <tbody>`;

    sesiones.forEach(s => {
      const estilo = s.estado === 'conciliada' ? 'color:var(--success);font-weight:600' :
                     s.estado === 'cerrada' ? 'color:var(--warning);font-weight:600' :
                     'color:var(--info);font-weight:600';
      const difColor = !s.diferencia ? '' :
                       s.diferencia > 0 ? 'color:var(--success)' :
                       'color:var(--danger)';
      const difMonto = s.diferencia == null ? '—'
        : Math.abs(s.diferencia) < 0.005 ? '<span style="color:var(--success)">Cuadrada</span>'
        : `${fmt(Math.abs(s.diferencia))}<br><small style="font-weight:600">${s.diferencia < 0 ? 'Faltante' : 'Sobrante'}</small>`;

      const fechaApertura = s.abierta_at
        ? new Date(s.abierta_at).toLocaleString('es-PE', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' })
        : '—';
      const fechaCierre = s.cerrada_at
        ? new Date(s.cerrada_at).toLocaleString('es-PE', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' })
        : '—';

      html += `<tr style="border-bottom:1px solid var(--card-border);height:40px;hover-style">
        <td style="padding:8px">${escapeHtml(s.codigo)}</td>
        <td style="padding:8px">${escapeHtml(s.sucursal_nombre || '—')}</td>
        <td style="padding:8px">${escapeHtml(s.cajero_nombre || '—')}</td>
        <td style="padding:8px;white-space:nowrap;font-size:11px">${fechaApertura}</td>
        <td style="padding:8px;white-space:nowrap;font-size:11px">${fechaCierre}</td>
        <td style="padding:8px;text-align:right">${fmt(s.esperado)}</td>
        <td style="padding:8px;text-align:right">${s.monto_final !== null ? fmt(s.monto_final) : '—'}</td>
        <td style="padding:8px;text-align:right;${difColor}">${difMonto}</td>
        <td style="padding:8px;text-align:center"><span style="${estilo}">${s.estado}</span></td>
        <td style="padding:8px;text-align:center">
          <div style="display:flex;gap:6px;justify-content:center">
            <button class="btn btn-outline btn-xs" onclick="verDetalleCaja(${s.id})" title="Ver detalles">
              <i class="ti ti-eye"></i>
            </button>
            <a class="btn btn-outline btn-xs" href="/api/caja/${s.id}/informe" target="_blank" rel="noopener" title="Informe de cierre en PDF">
              <i class="ti ti-file-type-pdf"></i>
            </a>
            ${s.estado === 'cerrada' && esAdmin ? 
              `<button class="btn btn-success btn-xs" onclick="conciliarCaja(${s.id})" title="Conciliar">
                <i class="ti ti-check"></i>
              </button>` : ''}
          </div>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    tabla.innerHTML = html;
  }

  window.filtrarHistorial = cargarHistorial;

  // Excel con el detalle de cada cierre: medios de pago, arqueo y diferencia.
  window.exportarHistorialCaja = function() {
    const rows = window._cajaHistorial || [];
    if (!rows.length) return alerta('info', 'Sin datos', 'No hay cierres para exportar con estos filtros.');
    const fecha = v => v ? new Date(v).toLocaleString('es-PE', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
    const desde = document.getElementById('hist-desde')?.value, hasta = document.getElementById('hist-hasta')?.value;
    MPExcel.exportTable({
      title: 'Cierres de caja',
      period: desde || hasta ? `Periodo: ${desde || '…'} al ${hasta || '…'}` : '',
      columns: ['Código', 'Sucursal', 'Cajero', 'Apertura', 'Cierre', 'Estado', 'Operaciones', 'Efectivo', 'Yape', 'Plin', 'Transferencia', 'Tarjeta', 'Fondo inicial', 'Otros ingresos', 'Egresos', 'Esperado', 'Contado', 'Diferencia', 'Resultado', 'Motivo'],
      rows: rows.map(s => {
        const dif = s.diferencia == null ? null : Number(s.diferencia);
        return [s.codigo, s.sucursal_nombre || '', s.cajero_nombre || '', fecha(s.abierta_at), fecha(s.cerrada_at), s.estado,
          Number(s.operaciones || 0), Number(s.cobro_efectivo || 0), Number(s.cobro_yape || 0), Number(s.cobro_plin || 0), Number(s.cobro_transferencia || 0), Number(s.cobro_tarjeta || 0),
          Number(s.monto_inicial || 0), Number(s.total_ingresos || 0), Number(s.total_egresos || 0), Number(s.esperado || 0),
          s.monto_final == null ? '' : Number(s.monto_final), dif == null ? '' : dif,
          dif == null ? 'Abierta' : Math.abs(dif) < 0.005 ? 'Cuadrada' : dif < 0 ? 'Faltante' : 'Sobrante', s.observacion || ''];
      })
    });
  };

  window.verDetalleCaja = async function(id) {
    const res = await Http.get('/caja/' + id);
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo cargar');
    const s = res.sesion, a=res.arqueo||{};
    const apertura = s.abierta_at ? new Date(s.abierta_at).toLocaleString('es-PE') : '—';
    const cierre = s.cerrada_at ? new Date(s.cerrada_at).toLocaleString('es-PE') : 'Aún abierta';
    const chip=estado=>`<span class="caja-chip caja-chip--${estado==='conciliada'?'ok':estado==='cerrada'?'warn':'info'}">${escapeHtml(estado||'—')}</span>`;
    const methods=(res.metodos||[]).map(m=>`<tr><td><b>${escapeHtml(String(m.metodo||'').toUpperCase())}</b></td><td>${Number(m.operaciones||0)}</td><td style="text-align:right;font-weight:800">${fmt(m.total)}</td><td>${Number(m.conciliadas||0)} conciliadas${Number(m.observadas||0)?` · ${Number(m.observadas)} observadas`:''}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#64748b">Sin pagos asociados</td></tr>';
    const movements=(res.movimientos||[]).slice(0,200).map(m=>`<tr><td>${escapeHtml(m.concepto||'')}</td><td><span class="caja-chip caja-chip--${m.tipo==='ingreso'?'ok':'danger'}">${escapeHtml(m.tipo||'')}</span></td><td>${m.venta_numero?escapeHtml(m.venta_numero):'—'}</td><td style="text-align:right;font-weight:800">${fmt(m.monto)}</td><td>${m.created_at?new Date(m.created_at).toLocaleString('es-PE'):'—'}</td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:#64748b">Sin movimientos</td></tr>';
    await Swal.fire({
      title:`Detalle completo · ${escapeHtml(s.codigo)}`,width:1000,confirmButtonColor:'#16a34a',background:'#fff',color:'#0f172a',confirmButtonText:'Cerrar',
      showDenyButton:true,denyButtonText:'<i class="ti ti-file-type-pdf"></i> Informe PDF',denyButtonColor:'#0f172a',preDeny:()=>{window.open(`/api/caja/${s.id}/informe`,'_blank','noopener');return false;},
      html:`<div style="text-align:left;font-size:13px;color:#334155">
        <div class="caja-detail-grid">
          <div class="caja-detail-card"><small>Cajero</small><b>${escapeHtml(s.cajero_nombre||'—')}</b></div>
          <div class="caja-detail-card"><small>Sucursal</small><b>${escapeHtml(s.sucursal_nombre||'—')}</b></div>
          <div class="caja-detail-card"><small>Estado</small><b>${chip(s.estado)}</b></div>
          <div class="caja-detail-card"><small>Apertura</small><b>${apertura}</b></div>
          <div class="caja-detail-card"><small>Cierre</small><b>${cierre}</b></div>
          <div class="caja-detail-card"><small>Observación</small><b>${escapeHtml(s.observacion||'Sin observación')}</b></div>
        </div>
        <h4 style="margin:18px 0 10px;color:#0f172a"><i class="ti ti-calculator"></i> Arqueo de efectivo</h4>
        <div class="caja-detail-grid">
          ${[['Fondo inicial',fmt(a.monto_inicial)],['Ventas efectivo',fmt(a.total_ventas)],['Otros ingresos',fmt(a.total_ingresos)],['Egresos',fmt(a.total_egresos)],['Esperado',fmt(a.esperado)],['Contado',a.monto_contado==null?'—':fmt(a.monto_contado)],['Diferencia',a.diferencia==null?'—':fmt(a.diferencia)]].map(x=>`<div class="caja-detail-card"><small>${x[0]}</small><b>${x[1]}</b></div>`).join('')}
        </div>
        <h4 style="margin:18px 0 10px;color:#0f172a"><i class="ti ti-credit-card"></i> Pagos por método</h4><div style="overflow:auto;border:1px solid #e2e8f0;border-radius:10px"><table class="caja-table"><thead><tr><th>Método</th><th>Operaciones</th><th>Total</th><th>Conciliación</th></tr></thead><tbody>${methods}</tbody></table></div>
        <h4 style="margin:18px 0 10px;color:#0f172a"><i class="ti ti-arrows-exchange"></i> Movimientos</h4><div style="overflow:auto;max-height:300px;border:1px solid #e2e8f0;border-radius:10px"><table class="caja-table"><thead><tr><th>Concepto</th><th>Tipo</th><th>Venta</th><th>Monto</th><th>Fecha</th></tr></thead><tbody>${movements}</tbody></table></div>
      </div>`
    });
  };

  window.conciliarCaja = async function(id) {
    const conf = await Swal.fire({
      title: '¿Conciliar esta caja?',
      text: 'Se marcará como conciliada.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, conciliar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#e53935',
      background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;

    const res = await Http.patch('/caja/' + id + '/conciliar', {});
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo conciliar');
    alerta('success', 'Conciliada', 'Caja marcada como conciliada', 1500);
    await cargarHistorial();
  };


  // ── DIGITAL (Pagos no-efectivo) ────────────────────────
  async function cargarDigital() {
    const desde = document.getElementById('dig-desde').value;
    const hasta = document.getElementById('dig-hasta').value;
    const metodo = document.getElementById('dig-metodo').value;
    const errorRango=validarRango(desde,hasta); if(errorRango)return alerta('warning','Fechas inválidas',errorRango);

    const qs = new URLSearchParams();
    if (desde) qs.append('desde', desde);
    if (hasta) qs.append('hasta', hasta);
    if (metodo) qs.append('metodo', metodo);

    const res = await Http.get('/caja/digital?' + qs.toString());
    if (!res?.ok) return;

    // Totales
    const totales = res.totales || [];
    const totalBlock = document.getElementById('digital-totales');
    if (!totales.length) {
      totalBlock.innerHTML = '<div style="color:var(--texto-muted);text-align:center;padding:20px">Sin datos</div>';
    } else {
      let html = '';
      totales.forEach(t => {
        const porcentajeConc = t.cantidad > 0 ? ((t.conciliado / t.total) * 100).toFixed(0) : 0;
        html += `<div class="card" style="padding:16px;text-align:center">
          <div style="font-size:13px;font-weight:700;color:var(--texto-muted);text-transform:uppercase;margin-bottom:10px;letter-spacing:.2px">
            ${t.metodo}
          </div>
          <div style="font-size:18px;font-weight:700;color:var(--primary);margin-bottom:8px">
            ${fmt(t.total)}
          </div>
          <div style="font-size:11px;color:var(--texto-muted);margin-bottom:6px">
            ${t.cantidad} transacción${t.cantidad !== 1 ? 'es' : ''}
          </div>
          <div style="font-size:11px;font-weight:600">
            <span style="color:var(--success)">${porcentajeConc}% conciliado</span>
          </div>
        </div>`;
      });
      totalBlock.innerHTML = html;
    }

    // Tabla de pagos
    const pagos = res.pagos || [];
    const tabla = document.getElementById('digital-tabla');

    if (!pagos.length) {
      tabla.innerHTML = '<div style="text-align:center;color:var(--texto-muted);padding:24px;font-size:13px">Sin registros</div>';
      return;
    }

    let html = `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="border-bottom:1px solid var(--card-border);background:var(--input-bg)">
          <tr style="height:36px">
            <th style="text-align:left;font-weight:600;color:var(--texto-muted);padding:8px">Método</th>
            <th style="text-align:left;font-weight:600;color:var(--texto-muted);padding:8px">Venta</th>
            <th style="text-align:right;font-weight:600;color:var(--texto-muted);padding:8px">Monto</th>
            <th style="text-align:left;font-weight:600;color:var(--texto-muted);padding:8px">Referencia</th>
            <th style="text-align:center;font-weight:600;color:var(--texto-muted);padding:8px">Estado</th>
            <th style="text-align:center;font-weight:600;color:var(--texto-muted);padding:8px">Acción</th>
          </tr>
        </thead>
        <tbody>`;

    pagos.forEach(p => {
      const estadoColor = p.estado_conciliacion === 'conciliado' ? 'color:var(--success)' :
                          p.estado_conciliacion === 'observado' ? 'color:var(--warning)' :
                          'color:var(--info)';
      const estado = p.estado_conciliacion || 'pendiente';
      html += `<tr style="border-bottom:1px solid var(--card-border);height:40px">
        <td style="padding:8px"><span style="font-weight:600;text-transform:uppercase">${p.metodo}</span></td>
        <td style="padding:8px">${p.venta_numero || '—'}</td>
        <td style="padding:8px;text-align:right;font-weight:600">${fmt(p.monto)}</td>
        <td style="padding:8px;font-size:11px;color:var(--texto-muted)">${p.referencia || '—'}</td>
        <td style="padding:8px;text-align:center"><span style="${estadoColor};font-weight:600">${estado}</span></td>
        <td style="padding:8px;text-align:center">
          <button class="caja-state-btn" onclick="cambiarEstadoDigital(${p.id},'${estado}')"><i class="ti ti-adjustments"></i> Cambiar estado</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    tabla.innerHTML = html;

  }

  window.filtrarDigital = cargarDigital;

  window.cambiarEstadoDigital = async function(id, actual) {
    const opciones={conciliado:{label:'Conciliado',icon:'ti-circle-check',color:'#16a34a',bg:'#dcfce7'},observado:{label:'Observado',icon:'ti-alert-triangle',color:'#d97706',bg:'#fef3c7'},pendiente:{label:'Pendiente',icon:'ti-clock',color:'#0284c7',bg:'#e0f2fe'}};
    let seleccionado='';
    await Swal.fire({title:'Estado del pago digital',background:'#fff',color:'#0f172a',showConfirmButton:false,showCloseButton:true,
      html:`<p style="color:#64748b;font-size:13px">Estado actual: <b>${escapeHtml(actual)}</b></p><div style="display:grid;gap:10px">${Object.entries(opciones).map(([v,o])=>`<button type="button" data-dig-state="${v}" style="border:1px solid ${o.color};background:${o.bg};color:${o.color};border-radius:11px;padding:13px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px"><i class="ti ${o.icon}"></i>${o.label}</button>`).join('')}</div>`,
      didOpen:()=>document.querySelectorAll('[data-dig-state]').forEach(b=>b.onclick=()=>{seleccionado=b.dataset.digState;Swal.close();})
    });
    if(!seleccionado)return;
    await cambiarEstadoPago(id,seleccionado);
  };

  async function cambiarEstadoPago(id, nuevoEstado) {
    const res = await Http.patch('/caja/digital/' + id + '/conciliar', { estado: nuevoEstado });
    if (!res?.ok) return alerta('error', 'Error', res?.msg);
    alerta('success', 'Actualizado', res.msg, 1200);
    await cargarDigital();
  }

  // ── CAJA WEB (Ecommerce) ───────────────────────────────
  async function cargarCajaWeb() {
    const tabla=document.getElementById('caja-web-tabla');
    if(!tabla)return;
    tabla.innerHTML='<div class="caja-section"><div class="loading-center"><div class="spinner"></div><p>Cargando conciliación Ecommerce...</p></div></div>';
    const hoy=hoyPeru();
    const desde=document.getElementById('web-desde')?.value||hoy;
    const hasta=document.getElementById('web-hasta')?.value||hoy;
    const metodo=document.getElementById('web-metodo')?.value||'';
    const errorRango=validarRango(desde,hasta);if(errorRango){tabla.innerHTML='';return alerta('warning','Fechas inválidas',errorRango);}
    const qs=new URLSearchParams({desde,hasta});if(metodo)qs.set('metodo',metodo);
    const res=await Http.get('/caja/web?'+qs.toString());
    if(!res?.ok){tabla.innerHTML=`<div class="caja-section"><div class="empty-state"><p>${escapeHtml(res?.msg||'No se pudo cargar Caja Web')}</p></div></div>`;return;}
    const k=res.kpi||{};
    const cards=[
      ['Ventas web',k.ventas||0,'#0ea5e9','ti-shopping-cart'],['Total web',fmt(k.total||0),'#16a34a','ti-cash'],['Ticket promedio',fmt(k.ticket_promedio||0),'#8b5cf6','ti-receipt'],['Clientes',k.clientes||0,'#f59e0b','ti-users'],['Delivery',k.delivery||0,'#06b6d4','ti-truck-delivery'],['Recojo',k.recojo||0,'#ec4899','ti-building-store']
    ];
    const methods=(res.metodos||[]).filter(m=>!metodo||String(m.metodo).toLowerCase()===metodo).map(m=>{const pending=Number(m.pendiente||0),total=Number(m.total||0),pct=total?Number(m.conciliado||0)/total*100:0;return `<tr><td><b>${escapeHtml(String(m.metodo||'').toUpperCase())}</b></td><td>${m.operaciones}</td><td style="text-align:right;font-weight:800">${fmt(m.total)}</td><td style="text-align:right;color:var(--success)">${fmt(m.conciliado)}</td><td style="text-align:right;color:${pending?'var(--warning)':'var(--success)'}">${fmt(pending)}</td><td><div style="width:120px;height:8px;background:var(--input-bg);border-radius:99px;overflow:hidden"><div style="height:100%;width:${Math.min(100,pct)}%;background:#16a34a"></div></div><small>${pct.toFixed(0)}%</small></td></tr>`}).join('');
    const sales=(res.ventas||[]).filter(v=>!metodo||String(v.metodo_pago).toLowerCase()===metodo).map(v=>{const st=String(v.conciliacion||'pendiente').toLowerCase();return `<tr><td><b>${escapeHtml(v.numero||'')}</b><small style="display:block">${v.created_at?new Date(v.created_at).toLocaleString('es-PE'):'—'}</small></td><td>${escapeHtml(v.numero_orden||'—')}</td><td><b>${escapeHtml(v.cliente||'Cliente web')}</b><small style="display:block">${escapeHtml(v.documento||'')}</small></td><td>${escapeHtml(v.sucursal||'')}</td><td><span class="caja-chip caja-chip--${String(v.tipo_entrega).toLowerCase()==='delivery'?'info':'ok'}">${escapeHtml(v.tipo_entrega||'—')}</span></td><td>${escapeHtml(String(v.metodo_pago||'').toUpperCase())}<small style="display:block">Op. ${escapeHtml(v.codigo_operacion||'—')}</small></td><td><span class="caja-chip caja-chip--${st==='conciliado'?'ok':st==='observado'?'danger':'warn'}">${escapeHtml(st)}</span></td><td style="text-align:right;font-weight:900">${fmt(v.total)}</td></tr>`}).join('');
    const daily=res.porDia||[];const max=Math.max(1,...daily.map(x=>Number(x.total||0)));
    const chart=daily.length?`<div style="display:grid;gap:9px">${daily.map(x=>`<div style="display:grid;grid-template-columns:90px 1fr 95px;gap:10px;align-items:center;font-size:12px"><span>${escapeHtml(String(x.fecha||'').slice(0,10))}</span><div style="height:12px;background:var(--input-bg);border-radius:99px;overflow:hidden"><div style="height:100%;width:${Math.max(2,Number(x.total||0)/max*100)}%;background:linear-gradient(90deg,#0ea5e9,#16a34a)"></div></div><b style="text-align:right">${fmt(x.total)}</b></div>`).join('')}</div>`:'<div class="empty-state"><p>Sin movimiento web en el periodo.</p></div>';
    tabla.innerHTML=`
      <div class="caja-web-kpis">${cards.map(x=>`<div class="caja-web-kpi" style="--accent:${x[2]}"><i class="ti ${x[3]}" style="float:right;font-size:24px;color:${x[2]}"></i><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join('')}</div>
      <div class="caja-section"><h3 class="caja-section-title"><span><i class="ti ti-chart-line"></i> Evolución diaria</span><small style="color:var(--texto-muted)">${escapeHtml(desde)} al ${escapeHtml(hasta)}</small></h3>${chart}</div>
      <div class="caja-section"><h3 class="caja-section-title"><span><i class="ti ti-shield-check"></i> Conciliación por método</span></h3><div style="overflow:auto"><table class="caja-table"><thead><tr><th>Método</th><th>Operaciones</th><th>Total</th><th>Conciliado</th><th>Pendiente</th><th>Avance</th></tr></thead><tbody>${methods||'<tr><td colspan="6" style="text-align:center">Sin pagos web</td></tr>'}</tbody></table></div></div>
      <div class="caja-section"><h3 class="caja-section-title"><span><i class="ti ti-list-details"></i> Ventas web registradas</span><span class="caja-chip caja-chip--info">${(res.ventas||[]).length} registros</span></h3><div style="overflow:auto"><table class="caja-table"><thead><tr><th>Nota / fecha</th><th>Pedido</th><th>Cliente</th><th>Sucursal</th><th>Entrega</th><th>Pago</th><th>Conciliación</th><th>Total</th></tr></thead><tbody>${sales||'<tr><td colspan="8" style="text-align:center">Sin ventas web</td></tr>'}</tbody></table></div></div>`;
  }

  const hoy=hoyPeru();
  for(const id of ['hist-desde','hist-hasta','dig-desde','dig-hasta','web-desde','web-hasta']){
    const input=document.getElementById(id); if(!input)continue; input.max=hoy; if(!input.value)input.value=hoy;
  }

  window.refrescarCajasOperando = async function(){
    const btn=document.getElementById('btn-refrescar-operadores');
    if(btn){btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Actualizando...';}
    try{await Promise.all([cargarOperadoresActivos(),cargarCajasFisicas(),cargarCajaActual()]);}
    finally{if(btn){btn.disabled=false;btn.innerHTML='<i class="ti ti-refresh"></i> Actualizar';btn.title='Actualizado '+new Date().toLocaleTimeString('es-PE');}}
  };
  document.getElementById('btn-refrescar-caja-web')?.addEventListener('click',cargarCajaWeb);
  document.getElementById('btn-filtrar-caja-web')?.addEventListener('click',cargarCajaWeb);

  // ── INICIAL ────────────────────────────────────────────
  if (esAdmin) {
    document.getElementById('admin-resumen-cajas').style.display = 'block';
    document.getElementById('btn-refrescar-operadores')?.addEventListener('click', window.refrescarCajasOperando);
    await Promise.all([cargarOperadoresActivos(), cargarCajasFisicas()]);
  }
  await cargarCajaActual();
};