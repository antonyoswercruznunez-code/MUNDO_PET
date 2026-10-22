
window.init_tienda = async function initTienda() {
  const contenido = document.getElementById('contenido');

  try {
    const responseHtml = await fetch('/views/pages/tienda.html');
    if (!responseHtml.ok) throw new Error('No se pudo cargar la página de tienda');
    contenido.innerHTML = await responseHtml.text();
  } catch (error) {
    console.error('Error cargando tienda:', error);
    contenido.innerHTML = '<div class="alert alert-danger">No se pudo cargar la tienda. Recarga la página.</div>';
    return;
  }

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const valueOf = id => document.getElementById(id)?.value?.trim() || '';
  const checked = id => Boolean(document.getElementById(id)?.checked);

  const imageOk = file =>
    Boolean(file) &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) &&
    /\.(jpe?g|png|webp)$/i.test(file.name || '');

  const notify = (icon, title, text = '', timer = 0) =>
    Swal.fire({
      icon,
      title,
      text,
      timer: timer || undefined,
      showConfirmButton: !timer,
      confirmButtonColor: '#16a34a'
    });

  let uploadBusy = false;
  const paymentUploads = new Set();

  async function safeRequest(callback, message = 'Ocurrió un error inesperado') {
    try {
      return await callback();
    } catch (error) {
      console.error(message, error);
      await notify('error', 'Error', message);
      return null;
    }
  }

  function renderPreview(type, route) {
    const box = document.getElementById(`td-${type}-preview`);
    if (!box) return;

    box.dataset.ruta = route || '';

    box.innerHTML = route
      ? `<button type="button" class="td-preview-button" onclick="_tdPreview('${esc(route)}','${esc(type)}')">
          <img src="${esc(route)}" alt="Imagen de ${esc(type)}" loading="lazy">
        </button>`
      : '<span><i class="ti ti-photo-off"></i> Sin imagen configurada</span>';
  }

  function renderSliders(rows) {
    const root = document.getElementById('td-sliders');
    if (!root) return;

    root.innerHTML = rows.length
      ? rows.map(item => {
          const id = Number(item.id);
          const estado = Number(item.estado) === 1;
          const orden = Number(item.orden) || 0;

          return `
            <article class="td-slider-card">
              <button type="button" class="td-slider-image"
                onclick="_tdPreview('${esc(item.ruta)}','slider')">
                <img src="${esc(item.ruta)}" alt="${esc(item.nombre)}" loading="lazy">
              </button>

              <div class="td-slider-meta">
                <div>
                  <b>${esc(item.nombre)}</b>
                  <small>${estado ? 'Publicado' : 'Oculto'}</small>
                </div>

                <label>
                  Orden
                  <input type="number" value="${orden}" min="0" max="999"
                    class="form-control"
                    onchange="_tdOrden(${id},this.value)">
                </label>

                <button type="button"
                  class="btn btn-xs ${estado ? 'btn-warning' : 'btn-success'}"
                  onclick="_tdEstado(${id},${estado ? 0 : 1})">
                  ${estado ? 'Ocultar' : 'Publicar'}
                </button>

                <button type="button" class="btn btn-danger btn-xs"
                  onclick="_tdEliminarSlider(${id})" title="Eliminar">
                  <i class="ti ti-trash"></i>
                </button>
              </div>
            </article>`;
        }).join('')
      : `<div class="empty-state" style="grid-column:1/-1">
          <i class="ti ti-photo-off"></i>
          <p>Sin sliders registrados</p>
        </div>`;
  }

  async function load() {
    const response = await Http.get('/config');

    if (!response?.ok) {
      await notify('error', 'Error', response?.msg || 'No se pudo cargar la configuración');
      return;
    }

    const cfg = response.cfg || {};
    renderSliders(response.sliders || []);

    const setValue = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.value = value || '';
    };

    const setChecked = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.checked = value;
    };

    setChecked('td-yape-activo', cfg.yape_activo !== 'false');
    setValue('td-yape-numero', cfg.yape_numero);
    setValue('td-yape-titular', cfg.yape_titular);
    renderPreview('yape', cfg.yape_qr_ruta || cfg.yape_imagen_ruta || '');

    setChecked('td-plin-activo', cfg.plin_activo !== 'false');
    setValue('td-plin-numero', cfg.plin_numero);
    setValue('td-plin-titular', cfg.plin_titular);
    renderPreview('plin', cfg.plin_qr_ruta || cfg.plin_imagen_ruta || '');

    setChecked('td-transferencia-activo', cfg.transferencia_activo !== 'false');
    setValue('td-transferencia-banco', cfg.transferencia_banco);
    setValue('td-transferencia-titular', cfg.transferencia_titular);
    setValue('td-transferencia-cuenta', cfg.transferencia_cuenta);
    setValue('td-transferencia-cci', cfg.transferencia_cci);
    renderPreview('transferencia', cfg.transferencia_imagen_ruta || '');

    setChecked('td-izipay-activo', cfg.izipay_activo === 'true');
    setValue('td-izipay-instrucciones', cfg.izipay_instrucciones);
    renderPreview('izipay', cfg.izipay_imagen_ruta || '');
  }

  async function uploadImage(url, inputId, fieldName) {
    if (uploadBusy) return;

    const input = document.getElementById(inputId);
    const file = input?.files?.[0];

    if (!imageOk(file)) {
      return notify('warning', 'Imagen no válida', 'Selecciona únicamente JPG, PNG o WEBP.');
    }

    const form = new FormData();
    form.append(fieldName, file);
    uploadBusy = true;

    try {
      const result = await Http.postForm(url, form);

      if (!result?.ok) {
        return notify('error', 'Error', result?.msg || 'No se pudo subir la imagen');
      }

      input.value = '';
      await load();
      await notify('success', 'Imagen guardada', '', 1400);
    } catch (error) {
      console.error('Error subiendo imagen:', error);
      await notify('error', 'Error', 'No se pudo subir la imagen. Comprueba tu conexión.');
    } finally {
      uploadBusy = false;
    }
  }

  document.getElementById('td-slider-form')?.addEventListener('submit', event => {
    event.preventDefault();
    uploadImage('/config/slider', 'td-slider', 'slider');
  });

  document.getElementById('td-guardar-pagos')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled) return;

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

    if (
      payload.yape_activo === 'true' &&
      !payload.yape_numero &&
      !document.getElementById('td-yape-preview')?.dataset.ruta
    ) {
      return notify('warning', 'Yape incompleto', 'Ingresa un número o carga una imagen.');
    }

    if (
      payload.plin_activo === 'true' &&
      !payload.plin_numero &&
      !document.getElementById('td-plin-preview')?.dataset.ruta
    ) {
      return notify('warning', 'Plin incompleto', 'Ingresa un número o carga una imagen.');
    }

    if (
      payload.transferencia_activo === 'true' &&
      !payload.transferencia_cuenta &&
      !payload.transferencia_cci
    ) {
      return notify('warning', 'Transferencia incompleta', 'Ingresa una cuenta o CCI.');
    }

    button.disabled = true;

    try {
      const result = await Http.post('/config/medios-pago', payload);

      if (!result?.ok) {
        return notify('error', 'Error', result?.msg || 'No se pudo guardar');
      }

      await load();
      await notify('success', 'Configuración guardada', '', 1500);
    } catch (error) {
      console.error('Error guardando pagos:', error);
      await notify('error', 'Error', 'No se pudo guardar la configuración.');
    } finally {
      button.disabled = false;
    }
  });

  window._tdSubirPago = async type => {
    if (paymentUploads.has(type)) return;

    if (!['yape', 'plin', 'transferencia', 'izipay'].includes(type)) {
      return notify('warning', 'Método no válido', 'Selecciona un método de pago válido.');
    }

    const input = document.getElementById(`td-${type}-file`);
    const file = input?.files?.[0];

    if (!imageOk(file)) {
      return notify('warning', 'Imagen no válida', 'Selecciona únicamente JPG, PNG o WEBP.');
    }

    paymentUploads.add(type);

    try {
      const form = new FormData();
      form.append('imagen_pago', file);
      form.append('tipo', type);

      const result = await Http.postForm('/config/metodo-pago-imagen', form);

      if (!result?.ok) {
        return notify('error', 'Error', result?.msg || 'No se pudo subir');
      }

      input.value = '';
      await load();
      await notify('success', 'Imagen guardada', '', 1400);
    } catch (error) {
      console.error('Error subiendo imagen de pago:', error);
      await notify('error', 'Error', 'No se pudo subir la imagen.');
    } finally {
      paymentUploads.delete(type);
    }
  };

  window._tdEliminarPago = async type => {
    if (!['yape', 'plin', 'transferencia', 'izipay'].includes(type)) return;

    const preview = document.getElementById(`td-${type}-preview`);
    if (!preview?.dataset?.ruta) return;

    const confirmation = await Swal.fire({
      title: '¿Quitar esta imagen?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Quitar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626'
    });

    if (!confirmation.isConfirmed) return;

    await safeRequest(async () => {
      const result = await Http.delete(`/config/metodo-pago-imagen/${encodeURIComponent(type)}`);

      if (!result?.ok) {
        return notify('error', 'Error', result?.msg || 'No se pudo eliminar');
      }

      await load();
      await notify('success', 'Imagen eliminada', '', 1200);
    }, 'No se pudo eliminar la imagen.');
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
    await safeRequest(async () => {
      const result = await Http.patch(`/config/slider/${id}/estado`, { estado: state });

      if (!result?.ok) {
        return notify('error', 'Error', result?.msg || 'No se pudo actualizar');
      }

      await load();
    }, 'No se pudo actualizar el slider.');
  };

  window._tdOrden = async (id, order) => {
    const value = Number(order);

    if (!Number.isInteger(value) || value < 0 || value > 999) {
      return notify('warning', 'Orden no válido', 'Ingresa un número entre 0 y 999.');
    }

    await safeRequest(async () => {
      const result = await Http.patch(`/config/slider/${id}/orden`, { orden: value });

      if (!result?.ok) {
        return notify('error', 'Error', result?.msg || 'No se pudo ordenar');
      }
    }, 'No se pudo actualizar el orden.');
  };

  window._tdEliminarSlider = async id => {
    const confirmation = await Swal.fire({
      title: '¿Eliminar slider?',
      text: 'Esta acción no se puede deshacer.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626'
    });

    if (!confirmation.isConfirmed) return;

    await safeRequest(async () => {
      const result = await Http.delete(`/config/slider/${id}`);

      if (!result?.ok) {
        return notify('error', 'Error', result?.msg || 'No se pudo eliminar');
      }

      await load();
      await notify('success', 'Slider eliminado', '', 1200);
    }, 'No se pudo eliminar el slider.');
  };

  const deliveryHost = document.getElementById('td-delivery-zonas');

  if (deliveryHost && window.MPDeliveryAdmin) {
    MPDeliveryAdmin.mount(deliveryHost);
  }

  await safeRequest(load, 'No se pudo cargar la configuración de la tienda.');
};
