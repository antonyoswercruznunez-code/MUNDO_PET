window.init_notas_credito = async function () {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // emitido_at ya llega en hora de Perú: se formatea sin pasar por new Date().
  const fecha = value => {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return '—';
    const h = Number(m[4]);
    return `${m[3]}/${m[2]}/${m[1]} · ${h % 12 || 12}:${m[5]} ${h >= 12 ? 'p. m.' : 'a. m.'}`;
  };
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  const inicioMes = hoy.slice(0, 8) + '01';

  document.getElementById('contenido').innerHTML = `
    <div class="page-header">
      <div class="page-header-left"><h2><i class="ti ti-receipt-refund"></i> Notas de crédito</h2></div>
      <button class="btn btn-outline" id="nc-excel"><i class="ti ti-file-spreadsheet"></i> Excel</button>
    </div>
    <div class="dx-kpis nc-kpis" id="nc-kpis"></div>
    <div class="card">
      <div class="tabla-toolbar">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input type="date" id="nc-desde" class="form-control" value="${inicioMes}" max="${hoy}" aria-label="Desde">
          <input type="date" id="nc-hasta" class="form-control" value="${hoy}" max="${hoy}" aria-label="Hasta">
          <select id="nc-estado" class="form-control" aria-label="Estado">
            <option value="">Todos los estados</option><option value="aceptado">Aceptadas</option>
            <option value="pendiente">Pendientes</option><option value="rechazado">Rechazadas</option>
          </select>
          <input type="search" id="nc-q" class="form-control" placeholder="Buscar nota, comprobante o cliente" style="min-width:250px">
        </div>
        <button id="nc-buscar" class="btn btn-primary"><i class="ti ti-search"></i> Consultar</button>
      </div>
      <div class="mp-table-wrap" style="margin:0"><table class="mp-table nc-table">
        <thead><tr><th>Nota de crédito</th><th>Anula</th><th>Cliente</th><th>Motivo</th><th>Sucursal</th><th>Emitida</th><th style="text-align:right">Importe</th><th>SUNAT</th><th style="text-align:right">Acciones</th></tr></thead>
        <tbody id="nc-tbody"></tbody>
      </table></div>
    </div>`;

  let notas = [];
  const estadoChip = n => ['aceptado', 'observado'].includes(n.cdr_estado) ? '<span class="badge badge-success">Aceptada</span>'
    : n.cdr_estado === 'rechazado' ? `<span class="badge badge-danger" title="${esc(n.cdr_mensaje || '')}">Rechazada</span>`
    : '<span class="badge badge-warning">Pendiente</span>';
  const kpi = (label, value, icon, tone) => `<div class="dx-kpi" style="--tone:${tone};--tone-bg:color-mix(in srgb, ${tone} 13%, transparent)">
      <div class="dx-kpi-top"><span class="dx-kpi-label">${label}</span><span class="dx-kpi-icon"><i class="ti ${icon}"></i></span></div>
      <div class="dx-kpi-value">${value}</div></div>`;

  function pintar(resumen) {
    document.getElementById('nc-kpis').innerHTML =
      kpi('Notas emitidas', resumen.total, 'ti-receipt-refund', '#2563eb') +
      kpi('Importe anulado', money(resumen.monto), 'ti-cash-off', '#dc2626') +
      kpi('Aceptadas por SUNAT', resumen.aceptadas, 'ti-circle-check', '#16a34a') +
      kpi('Pendientes o rechazadas', resumen.pendientes + resumen.rechazadas, 'ti-alert-triangle', '#d97706');
    document.getElementById('nc-tbody').innerHTML = notas.length ? notas.map((n, i) => {
      const ok = ['aceptado', 'observado'].includes(n.cdr_estado);
      const link = (url, icon, title) => url ? `<a class="btn btn-outline btn-xs" href="${esc(url)}" target="_blank" rel="noopener" title="${title}"><i class="ti ${icon}"></i></a>` : '';
      return `<tr>
        <td><b>${esc(n.numero_full)}</b><br><small style="color:var(--texto-muted)">Venta ${esc(n.venta_numero)}</small></td>
        <td>${esc(n.comprobante_ref || '—')}</td>
        <td>${esc(n.cliente_nombre)}<br><small style="color:var(--texto-muted)">${esc(n.cliente_doc)}</small></td>
        <td style="max-width:220px">${esc(n.motivo_anula || '—')}</td>
        <td>${esc(n.sucursal_nombre || '—')}</td>
        <td style="white-space:nowrap">${fecha(n.emitido_at)}<br><small style="color:var(--texto-muted)">${esc(n.emitida_por || '')}</small></td>
        <td style="text-align:right;font-weight:700;white-space:nowrap">${money(n.total)}</td>
        <td>${estadoChip(n)}</td>
        <td><div class="nc-actions">
          ${link(n.pdf_a4_path, 'ti-file-type-pdf', 'PDF A4')}${link(n.pdf_ticket_path, 'ti-receipt', 'Ticket')}${link(n.xml_path, 'ti-file-code', 'XML firmado')}${link(n.cdr_path, 'ti-certificate', 'CDR de SUNAT')}
          ${ok ? `<button class="btn btn-outline btn-xs" data-mail="${i}" title="Enviar por correo"><i class="ti ti-mail"></i></button>
                  <button class="btn btn-outline btn-xs nc-wa" data-wa="${i}" title="Enviar por WhatsApp"><i class="ti ti-brand-whatsapp"></i></button>` : ''}
        </div></td></tr>`;
    }).join('') : '<tr><td colspan="9" style="text-align:center;padding:34px;color:var(--texto-muted)">No hay notas de crédito en el periodo.</td></tr>';
  }

  async function load() {
    const desde = document.getElementById('nc-desde').value, hasta = document.getElementById('nc-hasta').value;
    if (!desde || !hasta || desde > hasta) return Swal.fire({ icon: 'warning', title: 'Fechas inválidas', text: 'Revisa el rango de fechas.' });
    const q = new URLSearchParams({ desde, hasta });
    const estado = document.getElementById('nc-estado').value; if (estado) q.set('estado', estado);
    const texto = document.getElementById('nc-q').value.trim(); if (texto) q.set('q', texto);
    const res = await Http.get('/notas-credito?' + q);
    if (!res?.ok) return Swal.fire({ icon: 'error', title: 'Error', text: res?.msg || 'No se pudo consultar' });
    notas = res.notas || [];
    pintar(res.resumen);
  }

  document.getElementById('nc-buscar').onclick = load;
  document.getElementById('nc-q').addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  document.getElementById('nc-tbody').addEventListener('click', e => {
    const mail = e.target.closest('[data-mail]'), wa = e.target.closest('[data-wa]');
    if (mail) MPNotaCredito.correo(notas[Number(mail.dataset.mail)]);
    if (wa) MPNotaCredito.whatsapp(notas[Number(wa.dataset.wa)]);
  });
  document.getElementById('nc-excel').onclick = () => {
    if (!notas.length) return Swal.fire({ icon: 'info', title: 'Sin datos', text: 'No hay notas de crédito para exportar.' });
    MPExcel.exportTable({
      title: 'Notas de crédito',
      period: `Periodo: ${document.getElementById('nc-desde').value} al ${document.getElementById('nc-hasta').value}`,
      columns: ['Nota de crédito', 'Comprobante anulado', 'N° Venta', 'Cliente', 'Documento', 'Motivo', 'Sucursal', 'Emitida', 'Estado SUNAT', 'Subtotal', 'IGV', 'Total'],
      rows: notas.map(n => [n.numero_full, n.comprobante_ref || '', n.venta_numero, n.cliente_nombre, n.cliente_doc, n.motivo_anula || '', n.sucursal_nombre || '', fecha(n.emitido_at), n.cdr_estado || 'pendiente', Number(n.subtotal || 0), Number(n.igv || 0), Number(n.total || 0)])
    });
  };
  await load();
};
