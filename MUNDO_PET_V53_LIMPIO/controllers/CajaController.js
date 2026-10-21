const bcrypt = require('bcrypt');
const { wrap } = require('../helpers/response');
const CajaModel = require('../models/CajaModel');
const { hasPermission } = require('../middleware/permisos');
const { cerrarCajasVencidas } = require('../services/CajaAutoCloseService');

function peruNowSQL() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date());
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return `${out.year}-${out.month}-${out.day} ${out.hour}:${out.minute}:${out.second}`;
}

function fechaPeru() {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Lima', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}

function validarRangoFiltros(query = {}) {
  const desde = String(query.desde || '').slice(0,10);
  const hasta = String(query.hasta || '').slice(0,10);
  const hoy = fechaPeru();
  if ((desde && desde > hoy) || (hasta && hasta > hoy)) return 'Los filtros no permiten fechas futuras.';
  if (desde && hasta && desde > hasta) return 'La fecha Desde no puede ser posterior a Hasta.';
  return '';
}

function horaPeru() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return `${out.hour}:${out.minute}`;
}

function normalizar(value) {
  return String(value || '').trim().toLowerCase();
}

function esGlobal(u) {
  return !!(u?.es_global);
}


function horaDentroDeHorario(caja) {
  if (!caja.hora_apertura || !caja.hora_cierre) return true;
  const actual = horaPeru();
  return actual >= caja.hora_apertura.slice(0, 5) && actual <= caja.hora_cierre.slice(0, 5);
}

function calcularArqueo(sesion, totales, montoContado = null) {
  const esperado = Number(sesion.monto_inicial)
    + totales.total_ventas + totales.total_ingresos - totales.total_egresos;
  const arqueo = {
    monto_inicial: Number(sesion.monto_inicial),
    total_ventas: totales.total_ventas,
    total_ingresos: totales.total_ingresos,
    total_egresos: totales.total_egresos,
    esperado: +esperado.toFixed(2),
    efectivo_disponible: +esperado.toFixed(2)
  };
  if (montoContado !== null) {
    arqueo.monto_contado = Number(montoContado);
    arqueo.diferencia = +(Number(montoContado) - esperado).toFixed(2);
  }
  return arqueo;
}

function scopeDeUsuario(u, puedeSupervisar = false) {
  if (esGlobal(u)) return {};
  if (puedeSupervisar) return { sucursal_id: u.sucursal_id };
  return { usuario_id: u.id };
}

function puedeVerSesion(u, sesion, puedeSupervisar = false) {
  if (esGlobal(u)) return true;
  if (puedeSupervisar) return +sesion.sucursal_id === +u.sucursal_id;
  return +sesion.usuario_id === +u.id;
}

const CajaController = {
  // Mi sesión abierta (para el vendedor) y su arqueo en vivo.
  actual: wrap(async (req, res) => {
    await cerrarCajasVencidas();
    const sesion = await CajaModel.sesionAbiertaDe(req.session.usuario.id);
    if (!sesion) return res.json({ ok: true, sesion: null });

    const totales = await CajaModel.totales(sesion.id);
    const movimientos = await CajaModel.getMovimientos(sesion.id);
    res.json({ ok: true, sesion, totales, movimientos, arqueo: calcularArqueo(sesion, totales) });
  }),

  // Tarjetas de cajas habilitadas y disponibles para el vendedor de su sucursal.
  disponibles: wrap(async (req, res) => {
    await cerrarCajasVencidas();
    const u = req.session.usuario;
    const sucursalId = esGlobal(u) ? Number(req.query.sucursal_id || 0) : Number(u.sucursal_id || 0);
    if (!sucursalId) {
      return res.json({ ok: false, requiere_sucursal: esGlobal(u), msg: esGlobal(u)
        ? 'Selecciona la sucursal cuya caja deseas abrir.'
        : 'Tu usuario no tiene una sucursal asignada.' });
    }

    const abierta = await CajaModel.sesionAbiertaDe(u.id);
    const todas = await CajaModel.getCajasFisicas({ sucursal_id: sucursalId });
    const activas = todas.filter(c => Number(c.activo) === 1);

    // Se muestran las cajas libres aunque estén fuera del horario. Así el vendedor
    // sabe que existen y por qué no puede abrirlas, en vez de recibir una pantalla vacía.
    const cajas = activas
      .filter(c => !c.sesion_id)
      .map(c => ({ ...c, dentro_horario: horaDentroDeHorario(c) }));

    let msg = '';
    if (!cajas.length && !abierta) {
      if (!activas.length) {
        msg = 'El administrador todavía no ha habilitado ninguna caja para esta sucursal.';
      } else {
        msg = 'Todas las cajas habilitadas están en uso por otros vendedores.';
      }
    } else if (cajas.length && !cajas.some(c => c.dentro_horario)) {
      msg = 'Las cajas libres están fuera de su horario de apertura. El administrador puede actualizar el horario desde Cajas.';
    }

    res.json({
      ok: true,
      cajas,
      ya_tiene_caja_abierta: !!abierta,
      sesion: abierta || null,
      msg,
      hora_actual: horaPeru(),
      sucursal_nombre: todas[0]?.sucursal_nombre || ''
    });
  }),

  // Apertura desde el módulo "Apertura de caja". PIN del VENDEDOR, no de la caja.
  abrir: wrap(async (req, res) => {
    await cerrarCajasVencidas();
    const u = req.session.usuario;
    const caja_fisica_id = Number(req.body.caja_fisica_id);
    const credencial = String(req.body.pin_cajero || req.body.credencial || '').trim();

    if (!Number.isInteger(caja_fisica_id) || caja_fisica_id <= 0) {
      return res.json({ ok: false, msg: 'Selecciona una caja disponible.' });
    }

    const operador = await CajaModel.getUsuarioOperador(u.id);
    if (!operador || operador.estado !== 0) {
      return res.json({ ok: false, msg: 'Tu usuario ya no está habilitado para operar caja.' });
    }
    if (operador.pin_cajero_hash) {
      if (!/^\d{4,6}$/.test(credencial)) {
        return res.json({ ok: false, msg: 'Ingresa tu PIN de cajero de 4 a 6 dígitos.' });
      }
      if (!(await bcrypt.compare(credencial, operador.pin_cajero_hash))) {
        return res.json({ ok: false, msg: 'PIN de cajero incorrecto.' });
      }
    } else if (esGlobal(u)) {
      if (!credencial || !(await bcrypt.compare(credencial, operador.password_hash))) {
        return res.json({ ok: false, msg: 'Contraseña del administrador incorrecta.' });
      }
    } else {
      return res.json({ ok: false, msg: 'No tienes PIN de cajero. Solicita a un administrador que lo cree desde Usuarios.' });
    }

    const caja = await CajaModel.getCajaFisicaById(caja_fisica_id);
    if (!caja || (!esGlobal(u) && +caja.sucursal_id !== +u.sucursal_id)) {
      return res.json({ ok: false, msg: 'La caja no pertenece a tu sucursal.' });
    }
    if (!caja.activo) {
      return res.json({ ok: false, msg: 'Esta caja está deshabilitada.' });
    }
    if (!horaDentroDeHorario(caja)) {
      return res.json({
        ok: false,
        msg: `La caja está fuera de horario (${String(caja.hora_apertura).slice(0, 5)} a ${String(caja.hora_cierre).slice(0, 5)}).`
      });
    }

    // El fondo inicial se configura por caja desde Cajas. El vendedor no lo puede alterar.
    const monto_inicial = Number(caja.monto_inicial_predeterminado || 0);
    const id = await CajaModel.abrir({
      sucursal_id: Number(caja.sucursal_id),
      usuario_id: u.id,
      caja_fisica_id,
      monto_inicial,
      observacion: String(req.body.observacion || '').trim(),
      abierta_at: peruNowSQL()
    });
    res.json({ ok: true, msg: `Caja ${caja.codigo} abierta correctamente.`, sesion_id: id });
  }),

  movimiento: wrap(async (req, res) => {
    const u = req.session.usuario;
    const sesion = await CajaModel.sesionAbiertaDe(u.id);
    if (!sesion) return res.json({ ok: false, msg: 'No tienes una caja abierta.' });

    const tipo = req.body.tipo;
    const monto = Number(req.body.monto);
    const concepto = String(req.body.concepto || '').trim();
    if (!['ingreso', 'egreso'].includes(tipo)) {
      return res.json({ ok: false, msg: 'Tipo inválido.' });
    }
    if (Number.isNaN(monto) || monto <= 0) {
      return res.json({ ok: false, msg: 'El monto debe ser mayor a 0.' });
    }
    if (!concepto) return res.json({ ok: false, msg: 'Indica el concepto del movimiento.' });

    if (tipo === 'egreso') {
      const totales = await CajaModel.totales(sesion.id);
      const disponible = Number(sesion.monto_inicial)
        + totales.total_ventas + totales.total_ingresos - totales.total_egresos;
      if (monto > disponible) {
        return res.json({ ok: false, msg: `No hay suficiente efectivo. Disponible: S/ ${disponible.toFixed(2)}` });
      }
    }

    await CajaModel.insertMovimiento(null, {
      sesion_id: sesion.id,
      sucursal_id: sesion.sucursal_id,
      tipo,
      concepto,
      monto,
      venta_id: null,
      usuario_id: u.id,
      created_at: peruNowSQL()
    });
    res.json({ ok: true, msg: tipo === 'ingreso' ? 'Ingreso registrado.' : 'Egreso registrado.' });
  }),

  cerrar: wrap(async (req, res) => {
    const u = req.session.usuario;
    const sesion = await CajaModel.sesionAbiertaDe(u.id);
    if (!sesion) return res.json({ ok: false, msg: 'No tienes una caja abierta.' });

    const monto_contado = Number(req.body.monto_contado);
    if (Number.isNaN(monto_contado) || monto_contado < 0) {
      return res.json({ ok: false, msg: 'Ingresa el monto contado (0 o mayor).' });
    }

    const totales = await CajaModel.totales(sesion.id);
    const arqueo = calcularArqueo(sesion, totales, monto_contado);
    await CajaModel.cerrar(sesion.id, {
      monto_final: monto_contado,
      total_ventas: totales.total_ventas,
      total_ingresos: totales.total_ingresos,
      total_egresos: totales.total_egresos,
      observacion: String(req.body.observacion || sesion.observacion || '').trim(),
      cerrada_at: peruNowSQL()
    });
    res.json({ ok: true, msg: 'Caja cerrada. Queda pendiente de conciliación.', arqueo });
  }),

  // Operadores que están trabajando ahora. Solo administradores.
  abiertas: wrap(async (req, res) => {
    const u = req.session.usuario;
    const cajas = await CajaModel.getCajasFisicas(esGlobal(u) ? {} : { sucursal_id: u.sucursal_id });
    const abiertas = cajas.filter(c => c.sesion_id);
    res.json({ ok: true, abiertas });
  }),

  // Administración de tarjetas físicas: administrador global todas; admin sucursal, las suyas.
  fisicas: wrap(async (req, res) => {
    const u = req.session.usuario;
    const cajas = await CajaModel.getCajasFisicas(esGlobal(u) ? {} : { sucursal_id: u.sucursal_id });
    res.json({ ok: true, cajas });
  }),

  actualizarFisica: wrap(async (req, res) => {
    const u = req.session.usuario;
    const caja = await CajaModel.getCajaFisicaById(+req.params.id);
    if (!caja) return res.json({ ok: false, msg: 'Caja no encontrada.' });
    if (!esGlobal(u) && +caja.sucursal_id !== +u.sucursal_id) {
      return res.json({ ok: false, msg: 'Solo puedes configurar cajas de tu sucursal.' });
    }

    const activo = !!req.body.activo;
    const monto_inicial_predeterminado = Number(req.body.monto_inicial_predeterminado);
    const hora_apertura = String(req.body.hora_apertura || '').trim() || null;
    const hora_cierre = String(req.body.hora_cierre || '').trim() || null;
    if (Number.isNaN(monto_inicial_predeterminado) || monto_inicial_predeterminado < 0) {
      return res.json({ ok: false, msg: 'El fondo inicial debe ser 0 o mayor.' });
    }
    const reHora = /^\d{2}:\d{2}$/;
    if ((hora_apertura && !reHora.test(hora_apertura)) || (hora_cierre && !reHora.test(hora_cierre))) {
      return res.json({ ok: false, msg: 'Las horas deben tener formato HH:MM.' });
    }
    if ((hora_apertura && !hora_cierre) || (!hora_apertura && hora_cierre)) {
      return res.json({ ok: false, msg: 'Configura ambas horas o deja ambas vacías.' });
    }
    if (hora_apertura && hora_cierre && hora_apertura >= hora_cierre) {
      return res.json({ ok: false, msg: 'La hora de cierre debe ser posterior a la apertura.' });
    }

    await CajaModel.actualizarCajaFisica(caja.id, {
      activo,
      monto_inicial_predeterminado,
      hora_apertura,
      hora_cierre
    });
    res.json({ ok: true, msg: 'Configuración de caja actualizada.' });
  }),

  // Historial: global todas, admin por sucursal, vendedor solo las suyas.
  list: wrap(async (req, res) => {
    await cerrarCajasVencidas();
    const rangeError = validarRangoFiltros(req.query);
    if (rangeError) return res.status(400).json({ok:false,msg:rangeError});
    const u = req.session.usuario;
    const puedeSupervisar = await hasPermission(req, 'caja.supervisar');
    const sesiones = await CajaModel.getAll(scopeDeUsuario(u, puedeSupervisar), req.query);
    sesiones.forEach(s => {
      s.esperado = +(Number(s.monto_inicial) + Number(s.total_ventas)
        + Number(s.total_ingresos) - Number(s.total_egresos)).toFixed(2);
      s.diferencia = s.monto_final == null
        ? null
        : +(Number(s.monto_final) - s.esperado).toFixed(2);
      s.codigo = s.caja_fisica_codigo || ('CAJA-' + String(s.numero_caja || s.id).padStart(5, '0'));
    });
    res.json({ ok: true, sesiones });
  }),

  getOne: wrap(async (req, res) => {
    const u = req.session.usuario;
    const sesion = await CajaModel.getById(+req.params.id);
    if (!sesion) return res.json({ ok: false, msg: 'Sesión no encontrada.' });
    const puedeSupervisar = await hasPermission(req, 'caja.supervisar');
    if (!puedeVerSesion(u, sesion, puedeSupervisar)) return res.status(403).json({ ok: false, msg: 'No tienes acceso a esta sesión.' });

    const totales = await CajaModel.totales(sesion.id);
    const movimientos = await CajaModel.getMovimientos(sesion.id);
    const metodos = await CajaModel.paymentBreakdown(sesion.id);
    const arqueo = calcularArqueo(
      sesion,
      totales,
      ['cerrada', 'conciliada'].includes(sesion.estado) ? sesion.monto_final : null
    );
    sesion.codigo = sesion.caja_fisica_codigo || ('CAJA-' + String(sesion.numero_caja || sesion.id).padStart(5, '0'));
    res.json({ ok: true, sesion, totales, movimientos, metodos, arqueo });
  }),

  conciliar: wrap(async (req, res) => {
    const u = req.session.usuario;
    const caja = await CajaModel.getById(+req.params.id);
    if (!caja) return res.json({ ok: false, msg: 'Caja no encontrada.' });
    if (caja.estado !== 'cerrada') return res.json({ ok: false, msg: `No se puede conciliar una caja en estado ${caja.estado}.` });
    if (!esGlobal(u) && +caja.sucursal_id !== +u.sucursal_id) {
      return res.json({ ok: false, msg: 'Solo puedes conciliar cajas de tu sucursal.' });
    }
    await CajaModel.conciliar(caja.id, u.id, peruNowSQL());
    res.json({ ok: true, msg: 'Caja conciliada exitosamente.' });
  }),

  digital: wrap(async (req, res) => {
    const rangeError = validarRangoFiltros(req.query);
    if (rangeError) return res.status(400).json({ok:false,msg:rangeError});
    const u = req.session.usuario;
    const sid = esGlobal(u) ? null : u.sucursal_id;
    const { desde, hasta, metodo, estado } = req.query;
    const pagos = await CajaModel.listDigital(sid, { desde, hasta, metodo, estado });
    const totales = await CajaModel.totalesDigital(sid, { desde, hasta });
    res.json({ ok: true, pagos, totales });
  }),


  web: wrap(async (req,res) => {
    const rangeError = validarRangoFiltros(req.query);
    if (rangeError) return res.status(400).json({ok:false,msg:rangeError});
    const u=req.session.usuario;
    const sid=esGlobal(u)?null:u.sucursal_id;
    res.json({ok:true,...await CajaModel.webSummary(sid,req.query)});
  }),

  conciliarPago: wrap(async (req, res) => {
    const u = req.session.usuario;
    const estado = req.body.estado;
    if (!['conciliado', 'observado', 'pendiente'].includes(estado)) {
      return res.json({ ok: false, msg: 'Estado inválido.' });
    }
    await CajaModel.conciliarPago(+req.params.id, {
      estado,
      usuario_id: estado === 'pendiente' ? null : u.id,
      conciliado_at: estado === 'pendiente' ? null : peruNowSQL()
    });
    res.json({
      ok: true,
      msg: estado === 'conciliado' ? 'Pago conciliado.'
        : estado === 'observado' ? 'Pago observado.'
          : 'Marcado como pendiente.'
    });
  })
};

module.exports = CajaController;
