window.init_comprobantes = async function () {
  document.getElementById('contenido').innerHTML = await fetch('/views/pages/comprobantes.html').then(r => r.text());
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => 'S/ ' + Number(n || 0).toFixed(2);
  // emitido_at ya llega como hora local de Perú. No se usa new Date(), porque
  // el navegador podía reinterpretarla y restar varias horas.
  const fechaHoraExacta = value => {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return '—';
    const h = Number(m[4]);
    const hora12 = h % 12 || 12;
    return `${m[3]}/${m[2]}/${m[1]}, ${hora12}:${m[5]}:${m[6] || '00'} ${h >= 12 ? 'p. m.' : 'a. m.'}`;
  };
  const peruToday = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const hoy = peruToday();
  const desde = document.getElementById('cp-desde'), hasta = document.getElementById('cp-hasta');
  desde.value = hoy; hasta.value = hoy; desde.max = hoy; hasta.max = hoy;
  function validar() {
    if (!desde.value || !hasta.value) return 'Selecciona ambas fechas';
    if (desde.value > hoy || hasta.value > hoy) return 'No puedes consultar fechas futuras';
    if (desde.value > hasta.value) return 'La fecha desde no puede ser posterior a la fecha hasta';
    return '';
  }
  async function load() {
    const error = validar(); if (error) return Swal.fire('Fechas inválidas', error, 'warning');
    const q = new URLSearchParams({desde:desde.value,hasta:hasta.value});
    const e = document.getElementById('cp-estado').value; if (e) q.set('estado', e);
    const r = await Http.get('/comprobantes?' + q);
    if (!r?.ok) return Swal.fire('Error', r?.msg || 'No se pudo consultar', 'error');
    const rows = r.comprobantes || [];
    document.getElementById('cp-tbody').innerHTML = rows.length ? rows.map(c => `<tr><td><b>${esc(c.numero_full || `${c.serie}-${c.numero}`)}</b><br><small>${esc(c.tipo)}</small></td><td>${esc(c.venta_numero || '')}</td><td>${esc(c.cliente_nombre || '')}</td><td>${esc(c.sucursal_nombre || '')}</td><td><b>${money(c.total)}</b></td><td><span class="badge ${c.estado_sunat === 'aceptado' ? 'badge-success' : c.estado_sunat === 'rechazado' ? 'badge-danger' : c.estado_sunat === 'observado' ? 'badge-warning' : 'badge-info'}">${esc(c.estado_sunat)}</span><br><small>${esc(c.cdr_mensaje || '')}</small></td><td>${fechaHoraExacta(c.emitido_at)}</td></tr>`).join('') : '<tr><td colspan="7"><div class="empty-state"><i class="ti ti-receipt-off"></i><p>Sin comprobantes emitidos en el periodo</p></div></td></tr>';
  }
  [desde,hasta].forEach(input => input.addEventListener('change', () => { input.max = peruToday(); }));
  document.getElementById('cp-buscar').onclick = load;
  await load();
};
