const CajaModel = require('../models/CajaModel');

function peruParts() {
  const out = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
  }).formatToParts(new Date())) out[part.type]=part.value;
  const hour = out.hour === '24' ? '00' : out.hour;
  return {
    fecha:`${out.year}-${out.month}-${out.day}`,
    hora:`${hour}:${out.minute}`,
    sql:`${out.year}-${out.month}-${out.day} ${hour}:${out.minute}:${out.second}`
  };
}

async function cerrarCajasVencidas() {
  const now = peruParts();
  const sesiones = await CajaModel.sesionesAbiertasVencidas(now);
  let cerradas = 0;
  for (const sesion of sesiones) {
    const totales = await CajaModel.totales(sesion.id);
    const esperado = Number(sesion.monto_inicial || 0)
      + Number(totales.total_ventas || 0)
      + Number(totales.total_ingresos || 0)
      - Number(totales.total_egresos || 0);
    const observacionAnterior = String(sesion.observacion || '').trim();
    const motivo = `Cierre automático diario a las ${String(sesion.caja_hora_cierre || 'hora configurada').slice(0,5)}. Pendiente de conciliación.`;
    await CajaModel.cerrar(sesion.id, {
      monto_final:Number(esperado.toFixed(2)),
      total_ventas:totales.total_ventas,
      total_ingresos:totales.total_ingresos,
      total_egresos:totales.total_egresos,
      observacion:[observacionAnterior,motivo].filter(Boolean).join(' | ').slice(0,2000),
      cerrada_at:now.sql
    });
    cerradas++;
  }
  return cerradas;
}

module.exports={cerrarCajasVencidas};
