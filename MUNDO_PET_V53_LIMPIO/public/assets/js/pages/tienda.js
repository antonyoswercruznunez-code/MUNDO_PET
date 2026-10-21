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

  let deliveryTariffs = [];
  let branches = [];
  let uploadBusy = false;

  function deliveryCalculation(baseValue, extraValue, freeValue, unitsValue, subtotalValue) {
    const base = Math.max(0, Number(baseValue || 0));
    const extra = Math.max(0, Number(extraValue || 0));
    const freeFrom = Math.max(0, Number(freeValue || 0));
    const units = Math.max(1, Math.min(10000, Math.floor(Number(unitsValue || 1))));
    const subtotal = Math.max(0, Number(subtotalValue || 0));
    const extraUnits = Math.max(0, units - 1);
    const free = freeFrom > 0 && subtotal >= freeFrom;
    return { base, extra, freeFrom, units, extraUnits, subtotal, free, total: free ? 0 : Number((base + extraUnits * extra).toFixed(2)) };
  }

  function updateDeliveryPreview() {
    const root = document.getElementById('td-delivery-preview-result');
    if (!root) return;
    const quote = deliveryCalculation(
      document.getElementById('td-delivery-costo')?.value,
      document.getElementById('td-delivery-unidad')?.value,
      document.getElementById('td-delivery-gratis')?.value,
      document.getElementById('td-preview-units')?.value,
      document.getElementById('td-preview-subtotal')?.value
    );
    root.innerHTML = quote.free
      ? `<strong>Gratis</strong><small>Subtotal desde S/ ${quote.freeFrom.toFixed(2)}</small>`
      : `<strong>S/ ${quote.total.toFixed(2)}</strong><small>S/ ${quote.base.toFixed(2)} + ${quote.extraUnits} unidad(es) adicional(es) × S/ ${quote.extra.toFixed(2)}</small>`;
  }

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

  function renderTariffs() {
    const body = document.getElementById('td-tarifas-body');
    if (!body) return;
    body.innerHTML = deliveryTariffs.length ? deliveryTariffs.map(tariff => {
      const zone = [tariff.distrito, tariff.provincia, tariff.departamento].filter(Boolean).join(' · ') || 'Todas las zonas';
      return `<tr>
        <td><b>${esc(tariff.nombre)}</b></td>
        <td>${esc(zone)}</td>
        <td>${esc(tariff.sucursal_nombre || 'Todas')}</td>
        <td>S/ ${Number(tariff.tarifa_base || 0).toFixed(2)}</td>
        <td>S/ ${Number(tariff.cargo_por_unidad || 0).toFixed(2)}<small style="display:block;color:#64748b">desde la 2.ª unidad</small></td>
        <td>${Number(tariff.gratis_desde || 0) > 0 ? `S/ ${Number(tariff.gratis_desde).toFixed(2)}` : '—'}</td>
        <td><span class="badge ${Number(tariff.activo) === 1 ? 'badge-success' : 'badge-muted'}">${Number(tariff.activo) === 1 ? 'Activa' : 'Inactiva'}</span></td>
        <td class="td-actions"><button class="btn btn-outline btn-xs" onclick="_tdTarifa(${Number(tariff.id)})" title="Editar"><i class="ti ti-edit"></i></button><button class="btn btn-danger btn-xs" onclick="_tdEliminarTarifa(${Number(tariff.id)})" title="Eliminar"><i class="ti ti-trash"></i></button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="8"><div class="empty-state"><p>No hay tarifas registradas.</p></div></td></tr>';
  }

  async function loadTariffs() {
    const [tariffResponse, branchResponse] = await Promise.all([
      Http.get('/config/delivery-tarifas'),
      Http.get('/sucursales')
    ]);
    deliveryTariffs = tariffResponse?.data || [];
    branches = branchResponse?.sucursales || branchResponse?.data || [];
    renderTariffs();
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

    document.getElementById('td-delivery-costo').value = Number(cfg.delivery_costo || 0).toFixed(2);
    document.getElementById('td-delivery-unidad').value = Number(cfg.delivery_cargo_unidad || 0).toFixed(2);
    document.getElementById('td-delivery-gratis').value = Number(cfg.delivery_gratis_desde || 0).toFixed(2);
    updateDeliveryPreview();
    await loadTariffs();
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
      izipay_instrucciones: valueOf('td-izipay-instrucciones'),
      delivery_costo: String(Math.max(0, Number(document.getElementById('td-delivery-costo').value || 0))),
      delivery_cargo_unidad: String(Math.max(0, Number(document.getElementById('td-delivery-unidad').value || 0))),
      delivery_gratis_desde: String(Math.max(0, Number(document.getElementById('td-delivery-gratis').value || 0)))
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

  window._tdTarifa = async id => {
    const tariff = deliveryTariffs.find(item => Number(item.id) === Number(id)) || {};
    const branchOptions = branches.map(branch => `<option value="${Number(branch.id)}" ${Number(tariff.sucursal_id) === Number(branch.id) ? 'selected' : ''}>${esc(branch.nombre)}</option>`).join('');
    const result = await Swal.fire({
      title: id ? 'Editar tarifa' : 'Nueva tarifa',
      width: 760,
      customClass: { popup: 'td-tariff-popup' },
      showCancelButton: true,
      confirmButtonText: 'Guardar tarifa',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#16a34a',
      html: `<div class="td-tariff-form">
        <div class="td-tariff-help"><b>Fórmula:</b> tarifa base + (unidades − 1) × cargo adicional. La primera unidad ya está incluida en la tarifa base.</div>
        <label>Nombre<input id="tdt-name" maxlength="120" value="${esc(tariff.nombre || '')}"></label>
        <label>Sucursal<select id="tdt-branch"><option value="">Todas</option>${branchOptions}</select></label>
        <div class="td-tariff-grid">
          <label>Departamento<input id="tdt-dep" maxlength="100" value="${esc(tariff.departamento || '')}"></label>
          <label>Provincia<input id="tdt-prov" maxlength="100" value="${esc(tariff.provincia || '')}"></label>
          <label>Distrito<input id="tdt-dist" maxlength="100" value="${esc(tariff.distrito || '')}"></label>
          <label>Tarifa base<input id="tdt-base" type="number" min="0" max="100000" step="0.10" value="${Number(tariff.tarifa_base || 0)}"></label>
          <label>Cargo por unidad adicional<input id="tdt-unit" type="number" min="0" max="100000" step="0.10" value="${Number(tariff.cargo_por_unidad || 0)}"></label>
          <label>Envío gratis desde<input id="tdt-free" type="number" min="0" max="100000" step="1" value="${Number(tariff.gratis_desde || 0)}"></label>
        </div>
        <label class="td-check"><input id="tdt-active" type="checkbox" ${Number(tariff.activo ?? 1) === 1 ? 'checked' : ''}> Tarifa activa</label>
        <div id="tdt-preview" class="td-tariff-preview"></div>
      </div>`,
      didOpen: () => {
        const update = () => {
          const quote = deliveryCalculation(
            document.getElementById('tdt-base')?.value,
            document.getElementById('tdt-unit')?.value,
            document.getElementById('tdt-free')?.value,
            5,
            100
          );
          const preview = document.getElementById('tdt-preview');
          if (preview) preview.innerHTML = `<span>Ejemplo con 5 unidades y subtotal S/ 100.00</span><b>${quote.free ? 'Gratis' : `S/ ${quote.total.toFixed(2)}`}</b><small>${quote.free ? `Supera el mínimo de S/ ${quote.freeFrom.toFixed(2)}` : `S/ ${quote.base.toFixed(2)} + ${quote.extraUnits} × S/ ${quote.extra.toFixed(2)}`}</small>`;
        };
        ['tdt-base','tdt-unit','tdt-free'].forEach(field => document.getElementById(field)?.addEventListener('input', update));
        update();
      },
      preConfirm: () => {
        const payload = {
          nombre: document.getElementById('tdt-name').value.trim(),
          sucursal_id: Number(document.getElementById('tdt-branch').value) || null,
          departamento: document.getElementById('tdt-dep').value.trim(),
          provincia: document.getElementById('tdt-prov').value.trim(),
          distrito: document.getElementById('tdt-dist').value.trim(),
          tarifa_base: Number(document.getElementById('tdt-base').value),
          cargo_por_unidad: Number(document.getElementById('tdt-unit').value),
          gratis_desde: Number(document.getElementById('tdt-free').value),
          activo: document.getElementById('tdt-active').checked ? 1 : 0
        };
        if (!payload.nombre) return Swal.showValidationMessage('Ingresa el nombre de la tarifa.');
        if ([payload.tarifa_base, payload.cargo_por_unidad, payload.gratis_desde].some(amount => !Number.isFinite(amount) || amount < 0)) return Swal.showValidationMessage('Los montos deben ser válidos y no negativos.');
        return payload;
      }
    });
    if (!result.isConfirmed) return;
    const saved = await (id ? Http.put(`/config/delivery-tarifas/${id}`, result.value) : Http.post('/config/delivery-tarifas', result.value));
    if (!saved?.ok) return notify('error', 'Error', saved?.msg || 'No se pudo guardar');
    await loadTariffs();
    notify('success', id ? 'Tarifa actualizada' : 'Tarifa creada', '', 1300);
  };

  window._tdEliminarTarifa = async id => {
    const confirmation = await Swal.fire({ title: '¿Eliminar tarifa?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' });
    if (!confirmation.isConfirmed) return;
    const result = await Http.delete(`/config/delivery-tarifas/${id}`);
    if (!result?.ok) return notify('error', 'Error', result?.msg || 'No se pudo eliminar');
    await loadTariffs();
  };

  document.getElementById('td-nueva-tarifa').onclick = () => window._tdTarifa();
  ['td-delivery-costo','td-delivery-unidad','td-delivery-gratis','td-preview-units','td-preview-subtotal']
    .forEach(id => document.getElementById(id)?.addEventListener('input', updateDeliveryPreview));
  await load();
};
