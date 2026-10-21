window.init_config = async function () {

  const html = await fetch('/views/pages/config.html').then(r => r.text());
  document.getElementById('contenido').innerHTML = html;

  // Estilos de labels
  if (!document.getElementById('cfg-style')) {
    const st = document.createElement('style');
    st.id = 'cfg-style';
    st.textContent = `
      .cfg-lbl{display:block;font-size:12px;font-weight:600;color:var(--texto-muted);
               margin-bottom:5px;text-transform:uppercase;letter-spacing:.3px}
    `;
    document.head.appendChild(st);
  }

  const esAdmin = window._esAdmin === true;

  // Si no es admin: bloquear toda la página
  if (!esAdmin) {
    document.getElementById('cfg-no-admin').style.display = 'block';
    document.getElementById('cfg-contenido').style.display = 'none';
    return;
  }
  document.getElementById('cfg-contenido').style.display = 'block';

  const alerta = (icon, title, text, timer) => Swal.fire({
    icon, title, text,
    background: '#1a1a2e', color: '#e0e0e0',
    confirmButtonColor: '#e53935',
    timer: timer || undefined, showConfirmButton: !timer
  });

  const val = id => document.getElementById(id).value.trim();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };

  let logosCola = [];   // archivos seleccionados, pendientes de subir

  // Renderiza las previas (antes de subir) con botón X para quitar
  function renderPrevias() {
    const cont = document.getElementById('cfg-logo-previas');
    cont.innerHTML = '';
    if (!logosCola.length) {
      document.getElementById('btn-subir-logo').style.display = 'none';
      return;
    }
    document.getElementById('btn-subir-logo').style.display = 'inline-flex';
    logosCola.forEach((f, idx) => {
      const url = URL.createObjectURL(f);
      const div = document.createElement('div');
      div.style.cssText = 'position:relative;display:inline-block';
      div.innerHTML = `
        <img src="${url}" style="width:90px;height:90px;object-fit:contain;border-radius:8px;
             background:var(--input-bg);border:1px solid var(--card-border);padding:4px;display:block">
        <button onclick="_cfgQuitarPrevia(${idx})"
                style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;
                       background:var(--rojo);color:#fff;border:none;cursor:pointer;font-size:13px;
                       display:flex;align-items:center;justify-content:center;line-height:1">×</button>
        <div style="font-size:10px;color:var(--texto-muted);text-align:center;margin-top:3px;
             max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</div>`;
      cont.appendChild(div);
    });
  }

  window._cfgQuitarPrevia = function(idx) {
    logosCola.splice(idx, 1);
    renderPrevias();
  };

  async function subirLogos() {
    if (!logosCola.length) return;
    const btn = document.getElementById('btn-subir-logo');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Subiendo...';

    let ok = 0, fail = 0;
    for (const f of logosCola) {
      const fd = new FormData();
      fd.append('logo', f);
      try {
        const res = await Http.postForm('/config/logo', fd);
        if (res?.ok) ok++; else fail++;
      } catch (e) { fail++; }
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-cloud-upload"></i> Subir seleccionadas';
    logosCola = [];
    document.getElementById('cfg-logo-file').value = '';
    renderPrevias();

    if (ok > 0) alerta('success', `${ok} logo(s) subido(s)`,
      fail > 0 ? `${fail} no se pudieron subir` : 'Pulsa "Activar" en el que quieras usar', 2000);
    else alerta('error', 'Error', 'No se pudo subir ningún logo');
    await cargar();
  }

  // ── CARGAR CONFIG ACTUAL ───────────────────────────────
  async function cargar() {
    const res = await Http.get('/config');
    if (!res?.ok) return;
    const c = res.cfg || {};

    // Empresa
    set('cfg-empresa_nombre',    c.empresa_nombre);
    set('cfg-empresa_ruc',       c.empresa_ruc);
    set('cfg-empresa_direccion', c.empresa_direccion);
    set('cfg-empresa_telefono',  c.empresa_telefono);
    set('cfg-empresa_email',     c.empresa_email || c.email_empresa);

    // Correo (host y puerto son fijos: smtp.gmail.com:587)
    set('cfg-mail_from_name', c.mail_from_name);
    set('cfg-mail_user',      c.mail_user);

    // Facturación / MiAPI (URL fija: https://miapi.cloud)
    const modo = document.getElementById('cfg-sunat_modo');
    if (modo) modo.value = c.sunat_modo || 'beta';

    renderLogos(res.logos || []);
    const sr = await Http.get('/sucursales');
    renderSucursales(sr?.sucursales || []);
  }

  function renderSucursales(lista) {
    const root=document.getElementById('cfg-sucursales-lista');
    if(!root)return;
    root.innerHTML=lista.map(x=>`<section style="border:1px solid var(--card-border);border-radius:10px;padding:12px;background:var(--input-bg)">
      <b style="display:block;margin-bottom:9px;color:var(--texto-fuerte)">${x.nombre}</b>
      <label class="cfg-lbl">Dirección</label><input class="form-control" id="cfg-suc-dir-${x.id}" value="${String(x.direccion||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">
      <label class="cfg-lbl" style="margin-top:8px">Teléfono</label><input class="form-control" id="cfg-suc-tel-${x.id}" value="${String(x.telefono||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">
      <button class="btn btn-outline btn-sm" style="margin-top:10px;width:100%" onclick="_cfgGuardarSucursal(${x.id})"><i class="ti ti-device-floppy"></i> Guardar sucursal</button>
    </section>`).join('');
  }

  window._cfgGuardarSucursal=async function(id){
    const direccion=document.getElementById(`cfg-suc-dir-${id}`)?.value.trim();
    const telefono=document.getElementById(`cfg-suc-tel-${id}`)?.value.trim();
    if(!direccion)return alerta('warning','Dirección requerida','Escribe la dirección de la sucursal.');
    const r=await Http.put(`/sucursales/${id}`,{direccion,telefono});
    alerta(r?.ok?'success':'error',r?.ok?'Sucursal actualizada':'Error',r?.msg||'',r?.ok?1300:undefined);
  };

  // ── GALERÍA DE LOGOS ───────────────────────────────────
  function renderLogos(logos) {
    const cont = document.getElementById('cfg-logos-galeria');
    if (!logos.length) {
      cont.innerHTML = `<div style="grid-column:1/-1;color:var(--texto-muted);font-size:13px;text-align:center;padding:14px">
        Aún no has subido ningún logo</div>`;
      return;
    }
    cont.innerHTML = logos.map(l => {
      const activo = l.estado === 1;
      return `
        <div style="border:2px solid ${activo ? 'var(--success)' : 'var(--card-border)'};
             border-radius:10px;padding:8px;text-align:center;background:var(--input-bg);position:relative">
          <img src="${l.ruta}" style="width:100%;height:70px;object-fit:contain;margin-bottom:6px">
          ${activo
            ? `<div style="font-size:11px;color:var(--success);font-weight:700;margin-bottom:6px"><i class="ti ti-check"></i> Activo</div>`
            : `<button class="btn btn-outline btn-xs" style="width:100%;margin-bottom:6px" onclick="_cfgActivarLogo(${l.id})">Activar</button>`}
          <button class="btn btn-danger btn-xs" style="width:100%" onclick="_cfgEliminarLogo(${l.id})">
            <i class="ti ti-trash"></i>
          </button>
        </div>`;
    }).join('');
  }

  // ── GUARDAR EMPRESA ────────────────────────────────────
  async function guardarEmpresa() {
    const ruc = val('cfg-empresa_ruc');
    if (ruc && !/^\d{11}$/.test(ruc))
      return alerta('error', 'RUC inválido', 'El RUC debe tener 11 dígitos numéricos');
    const tel = val('cfg-empresa_telefono');
    if (tel && !/^\d+$/.test(tel))
      return alerta('error', 'Teléfono inválido', 'El teléfono solo puede contener números');

    const btn = document.getElementById('btn-guardar-empresa');
    btn.disabled = true;
    const res = await Http.post('/config', {
      empresa_nombre:    val('cfg-empresa_nombre'),
      empresa_ruc:       ruc,
      empresa_direccion: val('cfg-empresa_direccion'),
      empresa_telefono:  tel,
      empresa_email:     val('cfg-empresa_email')
    });
    btn.disabled = false;
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo guardar');
    alerta('success', 'Guardado', 'Datos de empresa actualizados', 1500);
  }

  // ── GUARDAR CORREO ─────────────────────────────────────
  async function guardarCorreo() {
    const port = val('cfg-mail_port');
    if (port && !/^\d+$/.test(port))
      return alerta('error', 'Puerto inválido', 'El puerto solo puede contener números');

    const btn = document.getElementById('btn-guardar-correo');
    btn.disabled = true;
    const res = await Http.post('/config', {
      mail_host:      val('cfg-mail_host'),
      mail_port:      port,
      mail_from_name: val('cfg-mail_from_name'),
      mail_user:      val('cfg-mail_user')
    });
    btn.disabled = false;
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo guardar');
    alerta('success', 'Guardado', 'Configuración de correo actualizada', 1500);
  }

  // ── GUARDAR FACTURACIÓN (MiAPI) ────────────────────────
  async function guardarFacturacion() {
    const btn = document.getElementById('btn-guardar-facturacion');
    btn.disabled = true;
    const res = await Http.post('/config', {
      miapi_url:   val('cfg-miapi_url'),
      sunat_modo:  document.getElementById('cfg-sunat_modo').value
    });
    btn.disabled = false;
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo guardar');
    alerta('success', 'Guardado', 'Configuración de facturación actualizada', 1500);
  }

  // ── PROBAR CONEXIONES ──────────────────────────────────
  async function probarCorreo() {
    const btn = document.getElementById('btn-probar-correo');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Probando...';
    const res = await Http.post('/config/probar-correo', {});
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-plug-connected"></i> Probar conexión';
    alerta(res?.ok ? 'success' : 'error', res?.ok ? 'Conexión OK' : 'Sin conexión', res?.msg || '');
  }

  async function probarMiapi() {
    const btn = document.getElementById('btn-probar-miapi');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Probando...';
    const res = await Http.post('/config/probar-miapi', {});
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-plug-connected"></i> Probar conexión MiAPI';
    alerta(res?.ok ? 'success' : 'error', res?.ok ? 'Conexión OK' : 'Sin conexión', res?.msg || '');
  }

  // ── SUBIR LOGO ─────────────────────────────────────────
  // (subirLogos está arriba, en la sección de logosCola)

  // ── ACTIVAR / ELIMINAR LOGO ────────────────────────────
  window._cfgActivarLogo = async function(id) {
    const res = await Http.post(`/config/logo/${id}/activar`, {});
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo activar');
    alerta('success', 'Logo activado', 'Recarga para verlo en el menú y login', 1800);
    await cargar();
  };

  window._cfgEliminarLogo = async function(id) {
    const conf = await Swal.fire({
      title: '¿Eliminar este logo?', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#e53935', background: '#1a1a2e', color: '#e0e0e0'
    });
    if (!conf.isConfirmed) return;
    const res = await Http.delete(`/config/logo/${id}`);
    if (!res?.ok) return alerta('error', 'Error', res?.msg || 'No se pudo eliminar');
    alerta('success', 'Logo eliminado', '', 1400);
    await cargar();
  };

  // ── EVENTOS ────────────────────────────────────────────
  document.getElementById('btn-guardar-empresa').addEventListener('click', guardarEmpresa);
  document.getElementById('btn-guardar-correo').addEventListener('click', guardarCorreo);
  document.getElementById('btn-guardar-facturacion').addEventListener('click', guardarFacturacion);
  document.getElementById('btn-probar-correo').addEventListener('click', probarCorreo);
  document.getElementById('btn-probar-miapi').addEventListener('click', probarMiapi);
  document.getElementById('btn-subir-logo').addEventListener('click', subirLogos);

  document.getElementById('btn-elegir-logo').addEventListener('click', () => {
    document.getElementById('cfg-logo-file').click();
  });
  document.getElementById('cfg-logo-file').addEventListener('change', e => {
    const nuevos = Array.from(e.target.files).filter(f =>
      /^image\/(jpeg|jpg|png|webp|gif)$/i.test(f.type)
    );
    if (!nuevos.length) return alerta('warning', 'Formato no válido', 'Solo se permiten imágenes JPG, PNG, WEBP o GIF');
    // Agrega a la cola (no reemplaza lo anterior)
    logosCola = [...logosCola, ...nuevos];
    e.target.value = '';   // limpia para poder elegir el mismo archivo otra vez
    renderPrevias();
  });

  // Solo números en RUC y teléfono (el puerto SMTP es fijo, no editable)
  ['cfg-empresa_ruc', 'cfg-empresa_telefono'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', e => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
  });

  // Ver/ocultar contraseña y token
  const btnVerPass = document.getElementById('btn-ver-pass');
  if (btnVerPass) btnVerPass.addEventListener('click', () => {
    const inp = document.getElementById('cfg-mail_pass');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  const btnVerToken = document.getElementById('btn-ver-token');
  if (btnVerToken) btnVerToken.addEventListener('click', () => {
    const inp = document.getElementById('cfg-miapi_token');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  await cargar();
};