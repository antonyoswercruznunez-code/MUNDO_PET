window.init_temporadas = async function init_temporadas() {
  document.getElementById('contenido').innerHTML = await fetch('/views/pages/temporadas.html').then(r => r.text());

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const peruToday = () => {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-CA', {
      timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date())) p[x.type] = x.value;
    return `${p.year}-${p.month}-${p.day}`;
  };

  let temporadas = [];
  let productos = [];

  async function load() {
    const [t,p] = await Promise.all([Http.get('/temporadas'),Http.get('/productos')]);
    temporadas = t?.temporadas || [];
    productos = p?.productos || [];
    render();
  }

  function render() {
    document.getElementById('tm-lista').innerHTML = temporadas.length
      ? temporadas.map(t => `
        <section class="card season-card" style="padding:14px">
          <div style="display:flex;gap:10px;align-items:center">
            <div style="flex:1">
              <h3 style="margin:0">${esc(t.nombre)}</h3>
              <small>${esc(String(t.fecha_inicio).slice(0,10))} al ${esc(String(t.fecha_fin).slice(0,10))}</small>
              <span class="badge ${Number(t.vigente)===1?'badge-success':'badge-muted'}">
                ${Number(t.vigente)===1?'Vigente':Number(t.estado)===0?'Programada':'Inactiva'}
              </span>
            </div>
            <button class="btn btn-info btn-xs" onclick="_tmEditar(${t.id})"><i class="ti ti-edit"></i></button>
            <button class="btn btn-primary btn-xs" onclick="_tmRegla(${t.id})"><i class="ti ti-discount"></i> Regla</button>
            <button class="btn btn-danger btn-xs" onclick="_tmEliminar(${t.id})"><i class="ti ti-trash"></i></button>
          </div>
          <div style="margin-top:10px">
            ${(t.descuentos||[]).length
              ? (t.descuentos||[]).map(d => `
                <span class="badge badge-info" style="margin:3px">
                  ${esc(d.producto_nombre||'Producto')} · ${d.tipo_descuento==='monto'?`S/ ${Number(d.monto||0).toFixed(2)}`:`${Number(d.porcentaje||0)}%`}
                  <button onclick="_tmQuitarRegla(${t.id},${d.id})" style="border:0;background:none;color:inherit;cursor:pointer">×</button>
                </span>`).join('')
              : '<small style="color:var(--texto-muted)">Sin descuentos asignados.</small>'}
          </div>
        </section>`).join('')
      : '<div class="empty-state"><i class="ti ti-gift-off"></i><p>Sin temporadas</p></div>';
  }

  function open(t = {}) {
    const today = peruToday();
    const start = String(t.fecha_inicio || '').slice(0,10);
    const end = String(t.fecha_fin || '').slice(0,10);
    const startInput = document.getElementById('tm-inicio');
    const endInput = document.getElementById('tm-fin');

    document.getElementById('tm-id').value = t.id || '';
    document.getElementById('tm-nombre').value = t.nombre || '';
    startInput.value = start || today;
    endInput.value = end || startInput.value;
    document.getElementById('tm-activa').checked = Number(t.estado || 0) === 0;

    startInput.dataset.original = start;
    endInput.dataset.original = end;
    startInput.min = start && start < today ? start : today;
    endInput.min = end && end < today ? end : today;

    const syncEndMin = () => {
      const requestedMin = startInput.value > today ? startInput.value : today;
      endInput.min = end && end < today ? end : requestedMin;
      if (endInput.value && endInput.value < startInput.value && endInput.value !== end) {
        endInput.value = startInput.value;
      }
    };
    startInput.onchange = syncEndMin;
    syncEndMin();
    document.getElementById('tm-modal').classList.add('open');
  }

  document.getElementById('tm-nueva').onclick = () => open();
  window._tmEditar = id => open(temporadas.find(x => Number(x.id) === Number(id)) || {});

  document.getElementById('tm-guardar').onclick = async () => {
    const id = document.getElementById('tm-id').value;
    const startInput = document.getElementById('tm-inicio');
    const endInput = document.getElementById('tm-fin');
    const nombre = document.getElementById('tm-nombre').value.trim();
    const inicio = startInput.value;
    const fin = endInput.value;
    const today = peruToday();

    if (nombre.length < 3) return Swal.fire('Revisa', 'El nombre debe tener al menos 3 caracteres', 'warning');
    if (!inicio || !fin) return Swal.fire('Revisa', 'Selecciona las fechas de inicio y fin', 'warning');
    if (fin < inicio) return Swal.fire('Revisa', 'La fecha final no puede ser anterior al inicio', 'warning');
    if (inicio < today && inicio !== startInput.dataset.original) {
      return Swal.fire('Revisa', 'La fecha de inicio no puede estar en el pasado', 'warning');
    }
    if (fin < today && fin !== endInput.dataset.original) {
      return Swal.fire('Revisa', 'La fecha final no puede estar en el pasado', 'warning');
    }

    const body = {
      nombre,
      fecha_inicio: inicio,
      fecha_fin: fin,
      estado: document.getElementById('tm-activa').checked ? 0 : 1
    };
    const r = id ? await Http.put(`/temporadas/${id}`,body) : await Http.post('/temporadas',body);
    await Swal.fire(r?.ok?'Listo':'Error',r?.msg||'',r?.ok?'success':'error');
    if (r?.ok) {
      document.getElementById('tm-modal').classList.remove('open');
      await load();
    }
  };

  window._tmEliminar = async id => {
    const c = await Swal.fire({title:'¿Eliminar temporada?',showCancelButton:true,confirmButtonText:'Eliminar'});
    if (!c.isConfirmed) return;
    const r = await Http.delete(`/temporadas/${id}`);
    if (!r?.ok) return Swal.fire('Error',r?.msg||'No se pudo eliminar','error');
    await load();
  };

  window._tmRegla = async id => {
    const existing=new Set((temporadas.find(t=>Number(t.id)===Number(id))?.descuentos||[]).map(d=>Number(d.producto_id)));
    const available=productos.filter(p=>!existing.has(Number(p.id)));
    if(!available.length) return Swal.fire('Sin productos disponibles','Todos los productos ya tienen una regla en esta temporada.','info');
    const options=available.map(p=>`<option value="${Number(p.id)}" data-name="${esc(String(p.nombre).toLowerCase())}">${esc(p.nombre)} · S/ ${Number(p.precio_venta||0).toFixed(2)}</option>`).join('');
    const result=await Swal.fire({
      title:'Agregar descuento',
      width:620,
      html:`<div class="season-discount-form">
        <label>Buscar producto<input id="tm-search-product" class="swal2-input" placeholder="Escribe el nombre del producto"></label>
        <label>Producto<select id="tm-product" class="swal2-select" size="7">${options}</select></label>
        <div class="season-discount-grid"><label>Tipo<select id="tm-type" class="swal2-select"><option value="porcentaje">Porcentaje (%)</option><option value="monto">Monto en soles (S/)</option></select></label><label>Valor<input id="tm-value" type="number" min="0.01" step="0.01" class="swal2-input" placeholder="0.00"></label></div>
        <small id="tm-help">Ingresa un porcentaje mayor a 0 y máximo 100.</small>
      </div>`,
      showCancelButton:true,confirmButtonText:'Agregar descuento',
      didOpen:()=>{
        const search=document.getElementById('tm-search-product');const select=document.getElementById('tm-product');const type=document.getElementById('tm-type');const help=document.getElementById('tm-help');
        search.addEventListener('input',()=>{const q=search.value.toLowerCase().trim();[...select.options].forEach(o=>o.hidden=q&&!o.dataset.name.includes(q));const first=[...select.options].find(o=>!o.hidden);if(first)select.value=first.value;});
        type.addEventListener('change',()=>{help.textContent=type.value==='monto'?'Ingresa un monto positivo menor al precio de venta.':'Ingresa un porcentaje mayor a 0 y máximo 100.';});
      },
      preConfirm:()=>{
        const producto_id=Number(document.getElementById('tm-product').value);const tipo_descuento=document.getElementById('tm-type').value;const valor=Number(document.getElementById('tm-value').value);
        if(!producto_id)return Swal.showValidationMessage('Selecciona un producto');
        if(!Number.isFinite(valor)||valor<=0)return Swal.showValidationMessage('Ingresa un valor mayor a cero');
        if(tipo_descuento==='porcentaje'&&valor>100)return Swal.showValidationMessage('El porcentaje no puede superar 100%');
        const product=available.find(p=>Number(p.id)===producto_id);if(tipo_descuento==='monto'&&valor>=Number(product?.precio_venta||0))return Swal.showValidationMessage('El monto debe ser menor al precio de venta');
        return {producto_id,tipo_descuento,valor};
      }
    });
    if(!result.isConfirmed)return;
    const response=await Http.post(`/temporadas/${id}/descuentos`,result.value);
    await Swal.fire(response?.ok?'Descuento agregado':'Error',response?.msg||'',response?.ok?'success':'error');
    if(response?.ok)await load();
  };

  window._tmQuitarRegla = async (tid,did) => {
    const r = await Http.delete(`/temporadas/${tid}/descuentos/${did}`);
    if (!r?.ok) return Swal.fire('Error',r?.msg||'No se pudo eliminar','error');
    await load();
  };

  await load();
};
