window.init_tienda = async function initTienda() {
  document.getElementById('contenido').innerHTML = await fetch('/views/pages/tienda.html').then(r => r.text());

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const valueOf = id => document.getElementById(id)?.value?.trim() || '';
  const checked = id => Boolean(document.getElementById(id)?.checked);
  const imageOk = file => Boolean(file)
    && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    && /\.(jpe?g|png|webp)$/i.test(file.name || '');
  const notify = (icon, title, text = '', timer = 0) => Swal.fire({
    icon,
    title,
    text,
    timer: timer || undefined,
    showConfirmButton: !timer,
    confirmButtonColor: '#16a34a'
  });

  let uploadBusy = false;

  function renderPreview(type, route) {
    const box = document.getElementById(`td-${type}-preview`);
    if (!box) return;
    box.dataset.ruta = route || '';
    box.innerHTML = route
      ? `<button type="button" class="td-preview-button" onclick="_tdPreview('${esc(route)}','${esc(type)}')"><img src="${esc(route)}" alt="Imagen de ${esc(type)}"></button>`
      : '<span><i class="ti ti-photo-off"></i> Sin imagen configurada</span>';
  }

  function renderSliders(rows) {
    const root = document.getElementById('td-sliders');
    root.innerHTML = rows.length ? rows.map(item => `
      <article class="td-slider-card">
        <button type="button" class="td-slider-image" onclick="_tdPreview('${esc(item.ruta)}','slider')">
          <img src="${esc(item.ruta)}" alt="${esc(item.nombre)}">
        </button>
        <div class="td-slider-meta">
          <div><b>${esc(item.nombre)}</b><small>${Number(item.estado) === 1 ? 'Publicado' : 'Oculto'}</small></div>
          <label>Orden<input type="number" value="${Number(item.orden) || 0}" min="0" max="999" class="form-control" onchange="_tdOrden(${Number(item.id)},this.value)"></label>
          <button class="btn btn-xs ${Number(item.estado) === 1 ? 'btn-warning' : 'btn-success'}" onclick="_tdEstado(${Number(item.id)},${Number(item.estado) === 1 ? 0 : 1})">
            ${Number(item.estado) === 1 ? 'Ocultar' : 'Publicar'}
          </button>
          <button class="btn btn-danger btn-xs" onclick="_tdEliminarSlider(${Number(item.id)})" title="Eliminar"><i class="ti ti-trash"></i></button>
        </div>
      </article>`).join('') : '<div class="empty-state" style="grid-column:1/-1"><i class="ti ti-photo-off"></i><p>Sin sliders registrados</p></div>';
  }

  async function load() {
    const response = await Http.get('/config');
    if (!response?.ok) return notify('error', 'Error', response?.msg || 'No se pudo cargar la configuración');
    const cfg = response.cfg || {};
    renderSliders(response.sliders || []);

    document.getElementById('td-yape-activo').checked = cfg.yape_activo !== 'false';
    document.getElementById('td-yape-numero').value = cfg.yape_numero || '';
    document.getElementById('td-yape-titular').value = cfg.yape_titular || '';
    renderPreview('yape', cfg.yape_qr_ruta || cfg.yape_imagen_ruta || '');

    document.getElementById('td-plin-activo').checked = cfg.plin_activo !== 'false';
    document.getElementById('td-plin-numero').value = cfg.plin_numero || '';
    document.getElementById('td-plin-titular').value = cfg.plin_titular || '';
    renderPreview('plin', cfg.plin_qr_ruta || cfg.plin_imagen_ruta || '');

    document.getElementById('td-transferencia-activo').checked = cfg.transferencia_activo !== 'false';
    document.getElementById('td-transferencia-banco').value = cfg.transferencia_banco || '';
    document.getElementById('td-transferencia-titular').value = cfg.transferencia_titular || '';
    document.getElementById('td-transferencia-cuenta').value = cfg.transferencia_cuenta || '';
    document.getElementById('td-transferencia-cci').value = cfg.transferencia_cci || '';
    renderPreview('transferencia', cfg.transferencia_imagen_ruta || '');

    document.getElementById('td-izipay-activo').checked = cfg.izipay_activo === 'true';
    document.getElementById('td-izipay-instrucciones').value = cfg.izipay_instrucciones || '';
    renderPreview('izipay', cfg.izipay_imagen_ruta || '');

  }

  async function uploadImage(url, inputId, fieldName) {
    if (uploadBusy) return;
    const input = document.getElementById(inputId);
    const file = input?.files?.[0];
    if (!imageOk(file)) return notify('warning', 'Imagen no válida', 'Selecciona únicamente JPG, PNG o WEBP.');
    const form = new FormData();
    form.append(fieldName, file);
    uploadBusy = true;
    try {
      const result = await Http.postForm(url, form);
      if (!result?.ok) return notify('error', 'Error', result?.msg || 'No se pudo subir la imagen');
      input.value = '';
      await load();
      notify('success', 'Imagen guardada', '', 1400);
    } finally {
      uploadBusy = false;
    }
  }

  document.getElementById('td-slider-form').addEventListener('submit', event => {
    event.preventDefault();
    uploadImage('/config/slider', 'td-slider', 'slider');
  });

  document.getElementById('td-guardar-pagos').addEventListener('click', async () => {
    const payload = {
      yape_activo: String(checked('td-yape-activo')),
      yape_numero: valueOf('td-yape-numero'),
      yape_titular: valueOf('td-yape-titular'),
      plin_activo: String(checked('td-plin-activo')),
      plin_numero: valueOf('td-plin-numero'),
      plin_titular: valueOf('td-plin-titular'),
      transferencia_activo: String(checked('td-transferencia-activo')),
      transferencia_banco: valueOf('td-transferencia-banco'),
      transferencia_titular: valueOf('td-transferencia-titular'),
      transferencia_cuenta: valueOf('td-transferencia-cuenta'),
      transferencia_cci: valueOf('td-transferencia-cci'),
      izipay_activo: String(checked('td-izipay-activo')),
      izipay_instrucciones: valueOf('td-izipay-instrucciones')
    };
    if (payload.yape_activo === 'true' && !payload.yape_numero && !document.getElementById('td-yape-preview').dataset.ruta) return notify('warning', 'Yape incompleto', 'Ingresa un número o carga una imagen.');
    if (payload.plin_activo === 'true' && !payload.plin_numero && !document.getElementById('td-plin-preview').dataset.ruta) return notify('warning', 'Plin incompleto', 'Ingresa un número o carga una imagen.');
    if (payload.transferencia_activo === 'true' && !payload.transferencia_cuenta && !payload.transferencia_cci) return notify('warning', 'Transferencia incompleta', 'Ingresa una cuenta o CCI.');

    const button = document.getElementById('td-guardar-pagos');
    button.disabled = true;
    try {
      const result = await Http.post('/config/medios-pago', payload);
      if (!result?.ok) return notify('error', 'Error', result?.msg || 'No se pudo guardar');
      await load();
      notify('success', 'Configuración guardada', '', 1500);
    } finally {
      button.disabled = false;
    }
  });

  window._tdSubirPago = async type => {
    const input = document.getElementById(`td-${type}-file`);
    const file = input?.files?.[0];
    if (!imageOk(file)) return notify('warning', 'Imagen no válida', 'Selecciona únicamente JPG, PNG o WEBP.');
    const form = new FormData();
    form.append('imagen_pago', file);
    form.append('tipo', type);
    const result = await Http.postForm('/config/metodo-pago-imagen', form);
    if (!result?.ok) return notify('error', 'Error', result?.msg || 'No se pudo subir');
    input.value = '';
    await load();
    notify('success', 'Imagen guardada', '', 1400);
  };

  window._tdEliminarPago = async type => {
    const preview = document.getElementById(`td-${type}-preview`);
    if (!preview?.dataset?.ruta) return;
    const confirmation = await Swal.fire({ title: '¿Quitar esta imagen?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar' });
    if (!confirmation.isConfirmed) return;
    const result = await Http.delete(`/config/metodo-pago-imagen/${encodeURIComponent(type)}`);
    if (!result?.ok) return notify('error', 'Error', result?.msg || 'No se pudo eliminar');
    await load();
  };

  window._tdPreview = (route, title) => Swal.fire({
    title: String(title || 'Imagen').replace(/^./, char => char.toUpperCase()),
    imageUrl: route,
    imageAlt: title || 'Imagen',
    width: 720,
    confirmButtonText: 'Cerrar',
    confirmButtonColor: '#16a34a'
  });

  window._tdEstado = async (id, state) => {
    const result = await Http.patch(`/config/slider/${id}/estado`, { estado: state });
    if (!result?.ok) return notify('error', 'Error', result?.msg || 'No se pudo actualizar');
    await load();
  };

  window._tdOrden = async (id, order) => {
    const result = await Http.patch(`/config/slider/${id}/orden`, { orden: Number(order) });
    if (!result?.ok) notify('error', 'Error', result?.msg || 'No se pudo ordenar');
  };

  window._tdEliminarSlider = async id => {
    const confirmation = await Swal.fire({ title: '¿Eliminar slider?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' });
    if (!confirmation.isConfirmed) return;
    const result = await Http.delete(`/config/slider/${id}`);
    if (!result?.ok) return notify('error', 'Error', result?.msg || 'No se pudo eliminar');
    await load();
  };

  // El delivery por zonas tiene su propio guardado (mapa + anillos).
  const deliveryHost = document.getElementById('td-delivery-zonas');
  if (deliveryHost && window.MPDeliveryAdmin) MPDeliveryAdmin.mount(deliveryHost);
  await load();
};
