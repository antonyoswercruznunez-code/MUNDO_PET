window.init_pagos = async function () {
  document.getElementById('contenido').innerHTML = await fetch('/views/pages/pagos.html').then(r => r.text());
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => 'S/ ' + Number(n || 0).toFixed(2);
  const text = (...values) => values.map(v => String(v ?? '').trim()).find(Boolean) || '—';
  const date = v => v ? new Date(v).toLocaleString('es-PE', { timeZone: 'America/Lima' }) : '—';
  const close = () => document.getElementById('pg-modal')?.classList.remove('open');
  let pedidos = [];
  let aprobandoPedido = false;

  async function load() {
    const r = await Http.get('/pedidos-web');
    pedidos = r?.pedidos || [];
    render();
  }

  function render() {
    const q = document.getElementById('pg-buscar').value.toLowerCase().trim();
    const estado = document.getElementById('pg-estado').value;
    const rows = pedidos.filter(p => (!estado || p.estado_pago === estado) && (!q || `${p.numero_orden} ${p.cliente?.nombre_completo || p.cliente?.razon_social || p.cuenta_nombre || ''} ${p.sucursales || ''}`.toLowerCase().includes(q)));
    document.getElementById('pg-tbody').innerHTML = rows.length ? rows.map(p => `<tr>
      <td><b>${esc(p.numero_orden)}</b>${Number(p.es_multisucursal) === 1 ? '<br><span class="badge badge-info">Multisucursal</span>' : ''}</td>
      <td>${esc(p.cliente?.nombre_completo || p.cliente?.razon_social || p.cuenta_nombre || 'Cliente web')}<br><small>${esc(p.cliente?.numero_doc || '')}</small></td>
      <td>${esc(p.sucursales || '—')}</td><td><b>${money(p.total)}</b></td><td>${esc(p.metodo_pago || '—')}<br><small>${esc(p.codigo_operacion || 'Sin operación')}</small></td>
      <td><span class="badge ${p.estado_pago === 'aprobado' ? 'badge-success' : p.estado_pago === 'rechazado' ? 'badge-danger' : p.estado_pago === 'observado' ? 'badge-warning' : 'badge-info'}">${esc(p.estado_pago)}</span>${p.tiene_voucher ? '<br><small>Con imagen</small>' : ''}</td>
      <td>${date(p.created_at)}</td><td><button class="btn btn-info btn-xs" onclick="_pagoDetalle(${p.id})" title="Ver detalle"><i class="ti ti-eye"></i></button></td></tr>`).join('') : '<tr><td colspan="8"><div class="empty-state"><i class="ti ti-credit-card-off"></i><p>Sin pedidos</p></div></td></tr>';
  }

  function infoCard(title, rows) {
    return `<div class="card" style="padding:14px"><small style="font-weight:800;text-transform:uppercase;color:var(--texto-muted)">${esc(title)}</small>${rows.map(([label,value]) => `<div style="margin-top:8px"><span style="font-size:12px;color:var(--texto-muted)">${esc(label)}</span><div style="font-weight:600;word-break:break-word">${esc(text(value))}</div></div>`).join('')}</div>`;
  }

  window._pagoDetalle = async id => {
    const r = await Http.get(`/pedidos-web/${id}`);
    if (!r?.ok) return Swal.fire('Error', r?.msg || 'No se pudo abrir', 'error');
    const p = r.pedido, c = p.cliente || {}, d = p.direccion || {}, f = p.facturacion || {};
    const fullName = c.nombre_completo || c.razon_social || [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' ');
    document.getElementById('pg-modal-title').textContent = p.numero_orden;
    const voucherLinks = [
      p.comprobante_cliente ? `<a class="btn btn-outline btn-sm" href="/api/pedidos-web/${id}/voucher?tipo=cliente" target="_blank" rel="noopener"><i class="ti ti-photo"></i> Ver imagen del cliente</a>` : '',
      p.comprobante_admin ? `<a class="btn btn-outline btn-sm" href="/api/pedidos-web/${id}/voucher?tipo=admin" target="_blank" rel="noopener"><i class="ti ti-photo-check"></i> Ver imagen administrativa</a>` : ''
    ].filter(Boolean).join(' ');
    const terminal = ['aprobado', 'rechazado'].includes(p.estado_pago);
    const uploader = terminal ? '' : `<div class="form-group" style="margin-top:14px"><label class="form-label">Imagen administrativa opcional</label><input type="file" id="pg-voucher-admin" accept="image/png,image/jpeg,image/webp" class="form-control"><button class="btn btn-outline btn-sm" style="margin-top:7px" onclick="_subirVoucherAdmin(${id})"><i class="ti ti-upload"></i> Subir imagen</button></div>`;
    const reason = p.estado_pago === 'rechazado'
      ? `<div class="alert alert-danger" style="margin-top:14px"><b>Motivo del rechazo</b><div style="margin-top:6px">${esc(p.rechazo_motivo || 'No se registró un motivo.')}</div></div>`
      : p.notas_admin ? `<div class="alert alert-warning" style="margin-top:14px"><b>Observación administrativa</b><div style="margin-top:6px">${esc(p.notas_admin)}</div></div>` : '';

    document.getElementById('pg-detalle').innerHTML = `
      <div class="dash-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px">
        ${infoCard('Cuenta web', [['Nombre', p.cuenta_nombre], ['Correo', p.cuenta_email], ['Fecha del pedido', date(p.created_at)]])}
        ${infoCard('Comprador identificado', [['Nombre o razón social', fullName], ['Documento', `${String(c.tipo_doc || '').toUpperCase()} ${c.numero_doc || ''}`], ['Teléfono', c.telefono], ['Correo', c.email]])}
        ${infoCard('Entrega', [['Modalidad', p.tipo_entrega], ['Departamento', d.departamento], ['Provincia', d.provincia], ['Distrito', d.distrito], ['Dirección', d.direccion || d.direccion_entrega || p.direccion_entrega], ['Referencia', d.referencia], ['Recibe', d.nombre_receptor || d.receptor_nombre]])}
        ${infoCard('Pago y facturación', [['Estado', p.estado_pago], ['Subtotal', money(p.subtotal)], ['Delivery', money(p.costo_delivery)], ['Total', money(p.total)], ['Método', p.metodo_pago], ['Código de operación', p.codigo_operacion || p.numero_operacion], ['Solicita factura', f.solicitar_factura ? 'Sí' : 'No'], ['Mensaje para factura', f.comentario_facturacion || '—'], ['Procesado', date(p.processed_at)], ['Venta generada', p.venta_numero], ['Fecha de venta', date(p.venta_fecha)]])}
      </div>
      <div class="tabla-container" style="margin-top:14px"><table class="tabla"><thead><tr><th>Sucursal</th><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th>Stock actual</th></tr></thead><tbody>${(r.items || []).map(i => `<tr><td>${esc(i.sucursal_nombre)}</td><td>${esc(i.nombre_snapshot || `Producto #${i.producto_id}`)}</td><td>${Number(i.cantidad)}</td><td>${money(i.precio_unit)}</td><td>${money(i.subtotal)}</td><td>${Number(i.stock_actual || 0)}</td></tr>`).join('') || '<tr><td colspan="6">Sin productos</td></tr>'}</tbody></table></div>
      ${(r.entregas || []).length ? `<div style="margin-top:14px"><h4 style="margin:0 0 8px">Códigos y estado de entrega</h4><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">${r.entregas.map(e => `<div class="card" style="padding:14px;border:1px solid var(--card-border)"><div style="font-weight:700">${esc(e.sucursal_nombre)}</div><div style="font-size:12px;color:var(--texto-muted);margin-top:3px">${esc(e.tipo_entrega === 'delivery' ? 'Delivery' : 'Recojo en tienda')} · ${esc(e.estado)}</div>${e.codigo ? `<div style="font-size:23px;letter-spacing:3px;font-weight:800;text-align:center;margin-top:10px;padding:10px;border-radius:8px;background:var(--input-bg);color:var(--success)">${esc(e.codigo)}</div>` : '<div style="margin-top:10px;color:var(--texto-muted)">Código no disponible</div>'}</div>`).join('')}</div></div>` : ''}
      ${reason}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${voucherLinks}</div>${uploader}`;

    document.getElementById('pg-acciones').innerHTML = p.estado_pago === 'aprobado'
      ? `<button class="btn btn-outline" onclick="_reenviarPedido(${id})"><i class="ti ti-mail-forward"></i> Reenviar correo</button><button class="btn btn-primary" onclick="Router.navegar('ventas')"><i class="ti ti-shopping-cart"></i> Ver venta ${esc(p.venta_numero || '')}</button>`
      : p.estado_pago === 'rechazado' ? '' : `<button class="btn btn-outline" onclick="_observarPedido(${id})">Observar</button><button class="btn btn-danger" onclick="_rechazarPedido(${id})">Rechazar</button><button class="btn btn-primary" onclick="_aprobarPedido(${id})"><i class="ti ti-check"></i> Aprobar y generar nota</button>`;
    document.getElementById('pg-modal').classList.add('open');
  };

  window._subirVoucherAdmin = async id => {
    const f = document.getElementById('pg-voucher-admin')?.files?.[0];
    if (!f) return Swal.fire('Atención', 'Selecciona una imagen', 'warning');
    const fd = new FormData(); fd.append('voucher', f);
    const r = await Http.postForm(`/pedidos-web/${id}/voucher-admin`, fd);
    await Swal.fire(r?.ok ? 'Listo' : 'Error', r?.msg || '', r?.ok ? 'success' : 'error');
    if (r?.ok) window._pagoDetalle(id);
  };
  async function reasonPrompt(title) {
    const r = await Swal.fire({title, input:'textarea', inputLabel:'Motivo', showCancelButton:true, inputValidator:v => String(v || '').trim().length < 5 ? 'Escribe al menos 5 caracteres' : undefined});
    return r.isConfirmed ? r.value : null;
  }
  window._observarPedido = async id => { const motivo = await reasonPrompt('Observar pedido'); if (motivo === null) return; const r = await Http.patch(`/pedidos-web/${id}/observar`, {motivo}); await Swal.fire(r?.ok ? 'Listo' : 'Error', r?.msg || '', r?.ok ? 'success' : 'error'); if (r?.ok) { close(); load(); } };
  window._rechazarPedido = async id => { const motivo = await reasonPrompt('Rechazar pedido'); if (motivo === null) return; const r = await Http.patch(`/pedidos-web/${id}/rechazar`, {motivo}); await Swal.fire(r?.ok ? 'Listo' : 'Error', r?.msg || '', r?.ok ? 'success' : 'error'); if (r?.ok) { close(); load(); } };
  window._aprobarPedido = async id => {
    if (aprobandoPedido) return;
    const c = await Swal.fire({
      title:'¿Aprobar pago?',
      text:'Se creará el cliente oficial, la venta web completa y se descontará el stock de cada sucursal.',
      icon:'warning', showCancelButton:true, confirmButtonText:'Sí, aprobar', cancelButtonText:'Cancelar'
    });
    if (!c.isConfirmed) return;
    aprobandoPedido = true;
    try {
      Swal.fire({title:'Procesando pedido', text:'Creando cliente, venta, pago y movimientos de inventario...', allowOutsideClick:false, allowEscapeKey:false, didOpen:()=>Swal.showLoading()});
      const r = await Http.patch(`/pedidos-web/${id}/aprobar`, {});
      if (!r?.ok) {
        await Swal.fire('No se pudo aprobar', r?.msg || 'Revisa los datos del pedido', 'error');
        return;
      }
      close();
      await load();
      const done = await Swal.fire({
        title:'Pedido aprobado',
        html:`La venta <b>${esc(r.numero_venta || '')}</b> ya fue creada con los datos del cliente y aparece en el módulo Ventas.`,
        icon:'success', showCancelButton:true, confirmButtonText:'Ver venta', cancelButtonText:'Seguir en pagos'
      });
      if (done.isConfirmed) Router.navegar('ventas');
    } finally {
      aprobandoPedido = false;
    }
  };
  window._reenviarPedido = async id => { const r = await Http.post(`/pedidos-web/${id}/reenviar-correo`, {}); Swal.fire(r?.ok ? 'Listo' : 'Error', r?.msg || '', r?.ok ? 'success' : 'error'); };

  const modal = document.getElementById('pg-modal');
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  document.getElementById('pg-buscar').addEventListener('input', render);
  document.getElementById('pg-estado').addEventListener('change', render);
  document.getElementById('pg-refrescar').onclick = load;
  await load();
};
