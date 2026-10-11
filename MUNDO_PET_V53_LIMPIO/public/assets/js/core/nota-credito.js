/*
 * MPNotaCredito — envío de una nota de crédito al cliente (correo o WhatsApp).
 * Lo usan el módulo Notas de crédito y el detalle de una venta anulada.
 */
(function () {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function buscar(numero) {
    const res = await Http.get('/notas-credito?q=' + encodeURIComponent(numero));
    const nota = (res?.notas || []).find(n => n.numero_full === numero);
    if (!nota) Swal.fire({ icon: 'error', title: 'No se encontró la nota de crédito' });
    return nota || null;
  }

  async function correo(nota) {
    const { value: email, isConfirmed } = await Swal.fire({
      title: `Enviar ${esc(nota.numero_full)}`,
      input: 'email', inputValue: nota.cliente_email || '', inputPlaceholder: 'correo@cliente.com',
      inputLabel: 'Correo del cliente', showCancelButton: true,
      confirmButtonText: '<i class="ti ti-send"></i> Enviar', cancelButtonText: 'Cancelar',
      validationMessage: 'Ingresa un correo válido', showLoaderOnConfirm: true,
      preConfirm: async value => {
        const res = await Http.post(`/notas-credito/${nota.id}/enviar-correo`, { email: String(value).trim() });
        if (!res?.ok) { Swal.showValidationMessage(res?.msg || 'No se pudo enviar el correo'); return false; }
        return res;
      },
      allowOutsideClick: () => !Swal.isLoading()
    });
    if (isConfirmed && email) Swal.fire({ icon: 'success', title: 'Correo enviado', text: email.msg, timer: 2600, showConfirmButton: false });
  }

  async function whatsapp(nota) {
    const { value: telefono, isConfirmed } = await Swal.fire({
      title: 'Enviar por WhatsApp', input: 'tel', inputLabel: 'Celular del cliente',
      inputValue: String(nota.cliente_telefono || '').replace(/\D/g, '').slice(-9), inputPlaceholder: '987654321',
      showCancelButton: true, confirmButtonText: '<i class="ti ti-brand-whatsapp"></i> Abrir WhatsApp', cancelButtonText: 'Cancelar',
      inputValidator: value => /^9\d{8}$/.test(String(value).replace(/\D/g, '')) ? undefined : 'Ingresa un celular de 9 dígitos'
    });
    if (!isConfirmed) return;
    const lineas = [
      `Estimado/a ${nota.cliente_nombre || 'cliente'}:`, '',
      `Le enviamos la nota de crédito ${nota.numero_full} que anula el comprobante ${nota.comprobante_ref || nota.venta_numero}.`,
      `Importe: S/ ${Number(nota.total || 0).toFixed(2)}`
    ];
    if (nota.pdf_a4_path) lineas.push('', 'Nota de crédito en PDF:', nota.pdf_a4_path);
    window.open(`https://wa.me/51${String(telefono).replace(/\D/g, '')}?text=${encodeURIComponent(lineas.join('\n'))}`, '_blank', 'noopener');
  }

  window.MPNotaCredito = {
    correo, whatsapp,
    correoPorNumero: async numero => { const nota = await buscar(numero); if (nota) correo(nota); },
    whatsappPorNumero: async numero => { const nota = await buscar(numero); if (nota) whatsapp(nota); }
  };
})();
