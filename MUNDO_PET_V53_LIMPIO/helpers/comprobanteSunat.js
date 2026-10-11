/*
 * Armado de comprobantes electrónicos (boleta, factura y nota de crédito)
 * para MiAPI / SUNAT.
 *
 * Todo el cálculo se hace en céntimos enteros. Así la suma de las líneas es
 * siempre igual al total cobrado y la base más el IGV nunca se descuadra por
 * decimales de punto flotante.
 */

const IGV_PORCENTAJE = 18;

// Soles (número o texto) → céntimos enteros, redondeo comercial.
function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((Math.abs(n) + 1e-9) * 100) * (n < 0 ? -1 : 1);
}
const toSoles = cents => Number((cents / 100).toFixed(2));
const round6 = n => Number(n.toFixed(6));

// Reparte `target` céntimos entre las líneas en proporción a su importe bruto.
// Método del resto mayor: nunca sobra ni falta un céntimo.
function allocate(grossCents, target) {
  const sum = grossCents.reduce((a, b) => a + b, 0);
  if (sum === target || sum <= 0) return [...grossCents];
  const exact = grossCents.map(g => (g * target) / sum);
  const result = exact.map(Math.floor);
  let pending = target - result.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (let i = 0; pending > 0; i = (i + 1) % order.length, pending--) result[order[i].index]++;
  return result;
}

/*
 * Convierte una venta en líneas gravadas con IGV incluido.
 * - venta.total es lo realmente cobrado (productos − descuento + delivery).
 * - El descuento global se prorratea entre los productos.
 * - El delivery se factura como una línea de servicio aparte.
 */
function buildLines(venta, items) {
  const totalCents = toCents(venta.total);
  const deliveryCents = Math.max(0, toCents(venta.costo_delivery || 0));
  const productCents = totalCents - deliveryCents;
  if (totalCents <= 0) throw new Error('La venta no tiene un importe mayor a cero para facturar');
  if (!items.length) throw new Error('La venta no tiene productos para facturar');
  if (productCents <= 0) throw new Error('El importe de los productos debe ser mayor a cero');

  const quantities = items.map(item => {
    const quantity = Number(item.cantidad);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Hay un producto con cantidad inválida');
    return quantity;
  });
  const gross = items.map((item, index) => toCents(item.precio_unit) * quantities[index]);
  const lineTotals = allocate(gross, productCents);

  const lines = items.map((item, index) => ({
    codigo: `P${item.producto_id}`,
    descripcion: String(item.producto_nombre || 'Producto').slice(0, 250),
    cantidad: quantities[index],
    total: lineTotals[index]
  }));
  if (deliveryCents > 0) {
    lines.push({ codigo: 'SERV-DELIVERY', descripcion: 'Servicio de delivery', cantidad: 1, total: deliveryCents, unidad: 'ZZ' });
  }

  let baseSum = 0;
  let igvSum = 0;
  for (const line of lines) {
    if (line.total <= 0) {
      throw new Error(`"${line.descripcion}" quedó con importe cero por el descuento. SUNAT no acepta líneas gravadas sin valor.`);
    }
    line.base = Math.round((line.total * 100) / (100 + IGV_PORCENTAJE));
    line.igv = line.total - line.base;
    baseSum += line.base;
    igvSum += line.igv;
  }
  return { lines, totals: { base: baseSum, igv: igvSum, total: totalCents } };
}

function clienteSunat(venta) {
  if (!venta.numero_doc) {
    return { codigoPais: 'PE', tipoDoc: '0', numDoc: '00000000', rznSocial: 'CLIENTE VARIOS', direccion: '-' };
  }
  const nombre = (venta.cli_nombre && venta.cli_nombre !== 'Cliente General') ? venta.cli_nombre : 'CLIENTE VARIOS';
  return {
    codigoPais: 'PE',
    tipoDoc: venta.tipo_doc === 'ruc' ? '6' : '1',
    numDoc: String(venta.numero_doc),
    rznSocial: String(nombre).slice(0, 250),
    direccion: String(venta.cli_direccion || '-').slice(0, 250)
  };
}

const totalsInSoles = totals => ({ base: toSoles(totals.base), igv: toSoles(totals.igv), total: toSoles(totals.total) });

// Boleta (03) o factura (01).
function buildInvoice({ venta, items, tipo, serie, correlativo, fecha, hora }) {
  const { lines, totals } = buildLines(venta, items);
  return {
    payload: {
      comprobante: {
        tipoOperacion: '0101',
        tipoDoc: tipo === 'factura' ? '01' : '03',
        serie,
        correlativo: String(correlativo),
        fechaEmision: fecha,
        horaEmision: hora,
        tipoMoneda: 'PEN',
        tipoPago: 'Contado',
        observacion: String(venta.observacion || '').slice(0, 250)
      },
      cliente: clienteSunat(venta),
      items: lines.map(line => ({
        codProducto: line.codigo,
        descripcion: line.descripcion,
        unidad: line.unidad || 'NIU',
        cantidad: line.cantidad,
        mtoBaseIgv: toSoles(line.base),
        mtoValorUnitario: round6(line.base / 100 / line.cantidad),
        mtoPrecioUnitario: round6(line.total / 100 / line.cantidad),
        codeAfect: '10',
        igvPorcent: IGV_PORCENTAJE,
        igv: toSoles(line.igv)
      }))
    },
    totales: totalsInSoles(totals)
  };
}

// Nota de crédito (07) que anula por completo una boleta o factura aceptada.
function buildCreditNote({ venta, items, original, serie, correlativo, fecha, hora, motivo }) {
  const { lines, totals } = buildLines(venta, items);
  const originalTotal = toCents(original.total);
  if (originalTotal !== totals.total || toCents(original.subtotal) !== totals.base || toCents(original.igv) !== totals.igv) {
    throw new Error('Los importes de la venta ya no coinciden con el comprobante emitido. No se puede generar la nota de crédito automáticamente.');
  }
  return {
    payload: {
      comprobante: {
        tipoDoc: '07',
        serie,
        correlativo: String(correlativo),
        codmotivo: '01',
        descripcion: String(motivo || 'ANULACION DE LA OPERACION').toUpperCase().slice(0, 250),
        serieRef: original.serie,
        correlativoRef: String(original.numero),
        tipoCompRef: original.tipo === 'factura' ? '01' : '03',
        fechaEmision: fecha,
        horaEmision: hora,
        tipoMoneda: 'PEN',
        total: toSoles(totals.total),
        mtoIGV: toSoles(totals.igv),
        mtoOperGravadas: toSoles(totals.base),
        mtoOperExoneradas: 0,
        mtoOperInafectas: 0,
        mtoOperGratuitas: 0,
        icbper: 0,
        totalTexto: montoEnLetras(totals.total)
      },
      cliente: clienteSunat(venta),
      // MiAPI arma cada línea de la nota con el valor unitario tal cual, sin
      // multiplicarlo por la cantidad (SUNAT la rechaza con 3031/3103/3277 si
      // hay más de una unidad). Por eso cada línea va con cantidad 1 y el valor
      // total de la línea; las unidades reales quedan en la descripción.
      items: lines.map(line => ({
        codProducto: line.codigo,
        descripcion: line.cantidad > 1 ? `${line.descripcion} (${line.cantidad} unidades)`.slice(0, 250) : line.descripcion,
        unidad: line.unidad || 'NIU',
        cantidad: 1,
        mtoValorUnitario: toSoles(line.base),
        mtoPrecioUnitario: toSoles(line.total),
        tipoPrecio: '01',
        igvOpi: toSoles(line.igv),
        igv: toSoles(line.igv),
        igvPorcent: IGV_PORCENTAJE,
        codeAfectAlt: '10',
        codeAfect: '1000',
        nameAfect: 'IGV',
        tipoAfect: 'VAT',
        icbper: 0
      }))
    },
    totales: totalsInSoles(totals)
  };
}

/*
 * Importe en letras, como lo exige la representación impresa:
 * 2050 céntimos → "VEINTE CON 50/100 SOLES".
 */
const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE',
  'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDOS',
  'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS',
  'OCHOCIENTOS', 'NOVECIENTOS'];

function hastaMil(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  let texto = CENTENAS[centena];
  if (resto > 0) {
    const parte = resto < 30
      ? UNIDADES[resto]
      : DECENAS[Math.floor(resto / 10)] + (resto % 10 ? ` Y ${UNIDADES[resto % 10]}` : '');
    texto += (texto ? ' ' : '') + parte;
  }
  return texto;
}

// "UNO" pasa a "UN" delante de MIL, MILLONES o la moneda (VEINTIUNO → VEINTIUN).
const apocopar = texto => texto.replace(/UNO$/, 'UN');

function enteroEnLetras(n) {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1000000);
  const miles = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  const partes = [];
  if (millones) partes.push(millones === 1 ? 'UN MILLON' : `${apocopar(hastaMil(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? 'MIL' : `${apocopar(hastaMil(miles))} MIL`);
  if (resto) partes.push(hastaMil(resto));
  return partes.join(' ');
}

function montoEnLetras(cents) {
  const entero = Math.floor(cents / 100);
  const decimales = String(cents % 100).padStart(2, '0');
  return `${apocopar(enteroEnLetras(entero))} CON ${decimales}/100 SOLES`;
}

module.exports = { IGV_PORCENTAJE, toCents, toSoles, allocate, buildLines, buildInvoice, buildCreditNote, montoEnLetras };
