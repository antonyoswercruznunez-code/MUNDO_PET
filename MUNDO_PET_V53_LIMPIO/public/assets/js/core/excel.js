/*
 * MPExcel — exportación de tablas a Excel con formato de reporte.
 *
 * Usa xlsx-js-style (window.XLSX). Cada hoja lleva encabezado de marca,
 * periodo, encabezados con filtro, números con su formato real (moneda,
 * cantidad o porcentaje), filas alternas y una fila de totales con fórmulas,
 * para que el archivo siga cuadrando si alguien filtra o edita en Excel.
 */
(function () {
  const C = {
    brand: '15803D', brandSoft: 'DCFCE7', ink: '0F172A', inkSoft: '475569',
    head: '1E293B', line: 'E2E8F0', zebra: 'F8FAFC', white: 'FFFFFF', muted: '64748B',
    good: '166534', bad: 'B91C1C'
  };
  const FMT = { money: '"S/" #,##0.00;[Red]-"S/" #,##0.00', int: '#,##0', pct: '0.00"%"', dec: '#,##0.00' };

  const COUNT_NAMES = /^(ventas|pedidos|aprobados|rechazados|pendientes|operaciones|cantidad|cant\.?|unidades|uds\.?|items|ítems|productos|clientes|compras|convertidas|vigentes|vencidas|registros|turnos|entregas|entregados|rutas|stock|stock actual|stock mínimo|mínimo|minimo|días|dias|n°|nro\.?|#|líneas|lineas)$/;
  const COUNT_PARTS = /cantidad|unidades|stock|días|dias|n° de|nro de|# de|pedidos|operaciones/;
  const MONEY_PARTS = /total|monto|precio|costo|ingreso|importe|subtotal|igv|descuento|saldo|gastado|ganancia|pagado|esperado|contado|diferencia|ticket|margen|utilidad|cobrado|egreso|delivery|venta|valor|inversi/;
  const PCT_PARTS = /%|porcentaje|tasa|participaci|conversi/;

  // "S/ 1,250.50" o "45.2%" → número; cualquier otro texto queda igual.
  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    if (!/^-?\s*(S\/\.?\s*)?-?[\d.,]+\s*%?$/i.test(text)) return null;
    const clean = text.replace(/S\/\.?/i, '').replace(/%/g, '').replace(/\s/g, '');
    const normalized = /,\d{1,2}$/.test(clean) && !/\.\d/.test(clean) ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  // El tipo sale del nombre de la columna y se confirma con los valores:
  // así "Ventas" es una cantidad si son enteros y un importe si traen céntimos.
  function columnType(name, values) {
    const label = String(name || '').toLowerCase().trim();
    const numbers = values.map(toNumber);
    const filled = values.filter(v => v !== null && v !== undefined && v !== '');
    const numeric = filled.length > 0 && numbers.filter(n => n !== null).length === filled.length;
    if (!numeric) return 'text';
    const hasDecimals = numbers.some(n => n !== null && !Number.isInteger(n));
    if (PCT_PARTS.test(label)) return 'pct';
    if (COUNT_NAMES.test(label)) return hasDecimals ? 'money' : 'int';
    if (MONEY_PARTS.test(label)) return 'money';
    if (COUNT_PARTS.test(label)) return hasDecimals ? 'dec' : 'int';
    return hasDecimals ? 'dec' : 'int';
  }

  // Un código (DNI, RUC, teléfono, N° de documento) no es una cantidad.
  const looksLikeCode = (name, values) => /dni|ruc|documento|doc\.|teléfono|telefono|celular|código|codigo|operaci|n° venta|numero|número|serie|placa|sku/.test(String(name).toLowerCase())
    || values.some(v => typeof v === 'string' && /^0\d+$/.test(v.trim()));

  const border = (color = C.line, style = 'thin') => ({ style, color: { rgb: color } });

  function exportTable({ title, columns, rows, period = '', company = 'DISTRIBUCIONES MAOZ E.I.R.L.', fileName, totals = true }) {
    if (typeof XLSX === 'undefined') throw new Error('La librería de Excel no cargó. Recarga la página.');
    const nCols = Math.max(1, columns.length);
    const types = columns.map((name, c) => {
      const values = rows.map(row => row[c]);
      return looksLikeCode(name, values) ? 'text' : columnType(name, values);
    });
    const numericCols = types.map(t => t !== 'text');
    const generated = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'long', timeStyle: 'short' }).format(new Date());

    const HEAD_ROW = 5;                      // fila (base 0) de los encabezados
    const FIRST = HEAD_ROW + 1;              // primera fila de datos
    const LAST = FIRST + rows.length - 1;
    const hasTotals = totals && rows.length > 0 && types.some(t => t === 'money' || t === 'int' || t === 'dec');
    const TOTAL_ROW = LAST + 1;

    const aoa = [
      [company], [String(title || 'Reporte')],
      [[period, `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`].filter(Boolean).join('   ·   ')],
      [`Generado el ${generated}`], [], columns,
      ...rows.map(row => columns.map((_, c) => {
        const value = row[c];
        if (!numericCols[c]) return value === null || value === undefined ? '' : String(value);
        const n = toNumber(value);
        return n === null ? '' : n;
      }))
    ];
    if (hasTotals) aoa.push(columns.map((_, c) => (c === 0 ? 'TOTAL' : '')));
    aoa.push([]);
    aoa.push(['Mundo Pet · Sistema de gestión']);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const cell = (r, c) => XLSX.utils.encode_cell({ r, c });
    const ensure = (r, c) => (ws[cell(r, c)] ||= { t: 's', v: '' });

    ws['!merges'] = [0, 1, 2, 3].map(r => ({ s: { r, c: 0 }, e: { r, c: nCols - 1 } }));
    const band = (r, style) => { for (let c = 0; c < nCols; c++) ensure(r, c).s = style; };
    band(0, { font: { bold: true, sz: 15, color: { rgb: C.white }, name: 'Calibri' }, fill: { fgColor: { rgb: C.brand } }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } });
    band(1, { font: { bold: true, sz: 12, color: { rgb: C.white }, name: 'Calibri' }, fill: { fgColor: { rgb: C.brand } }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } });
    band(2, { font: { sz: 10, color: { rgb: C.good }, name: 'Calibri' }, fill: { fgColor: { rgb: C.brandSoft } }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } });
    band(3, { font: { sz: 9, italic: true, color: { rgb: C.muted }, name: 'Calibri' }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } });

    for (let c = 0; c < nCols; c++) {
      ensure(HEAD_ROW, c).s = {
        font: { bold: true, sz: 10, color: { rgb: C.white }, name: 'Calibri' },
        fill: { fgColor: { rgb: C.head } },
        alignment: { horizontal: numericCols[c] ? 'right' : 'left', vertical: 'center', wrapText: true },
        border: { bottom: border(C.brand, 'medium'), left: border(C.head), right: border(C.head) }
      };
    }

    const widths = columns.map(name => String(name).length);
    rows.forEach((row, index) => {
      const r = FIRST + index;
      for (let c = 0; c < nCols; c++) {
        const node = ensure(r, c);
        const type = types[c];
        if (type !== 'text' && typeof node.v === 'number') { node.t = 'n'; node.z = FMT[type]; }
        const shown = type === 'money' && typeof node.v === 'number' ? `S/ ${node.v.toFixed(2)}` : String(node.v ?? '');
        widths[c] = Math.max(widths[c], Math.min(shown.length, 60));
        node.s = {
          font: { sz: 10, color: { rgb: C.ink }, name: 'Calibri' },
          fill: { fgColor: { rgb: index % 2 ? C.zebra : C.white } },
          alignment: { horizontal: type === 'text' ? 'left' : 'right', vertical: 'center', wrapText: type === 'text' && shown.length > 46 },
          border: { bottom: border() }
        };
      }
    });

    if (hasTotals) {
      for (let c = 0; c < nCols; c++) {
        const node = ensure(TOTAL_ROW, c);
        const type = types[c];
        if (c > 0 && (type === 'money' || type === 'int' || type === 'dec')) {
          const column = XLSX.utils.encode_col(c);
          const sum = rows.reduce((acc, row) => acc + (toNumber(row[c]) || 0), 0);
          // SUBTOTAL(109) suma solo lo visible: respeta los filtros de Excel.
          Object.assign(node, { t: 'n', v: Number(sum.toFixed(2)), f: `SUBTOTAL(109,${column}${FIRST + 1}:${column}${LAST + 1})`, z: FMT[type] });
          widths[c] = Math.max(widths[c], (type === 'money' ? `S/ ${sum.toFixed(2)}` : String(sum)).length + 1);
        }
        node.s = {
          font: { bold: true, sz: 11, color: { rgb: C.good }, name: 'Calibri' },
          fill: { fgColor: { rgb: C.brandSoft } },
          alignment: { horizontal: c === 0 ? 'left' : 'right', vertical: 'center' },
          border: { top: border(C.brand, 'medium'), bottom: border(C.brand, 'thin') }
        };
      }
    }
    const footerRow = (hasTotals ? TOTAL_ROW : LAST) + 2;
    ensure(footerRow, 0).s = { font: { sz: 8, italic: true, color: { rgb: C.muted }, name: 'Calibri' } };

    ws['!cols'] = widths.map((len, c) => ({ wch: Math.max(numericCols[c] ? 13 : 11, Math.min(len + 3, 52)) }));
    const heights = [];
    heights[0] = { hpt: 30 }; heights[1] = { hpt: 22 }; heights[2] = { hpt: 20 }; heights[3] = { hpt: 16 }; heights[4] = { hpt: 6 };
    heights[HEAD_ROW] = { hpt: 26 };
    for (let r = FIRST; r <= LAST; r++) heights[r] = { hpt: 19 };
    if (hasTotals) heights[TOTAL_ROW] = { hpt: 24 };
    ws['!rows'] = heights;
    if (rows.length) ws['!autofilter'] = { ref: `${cell(HEAD_ROW, 0)}:${cell(LAST, nCols - 1)}` };
    ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };

    const wb = XLSX.utils.book_new();
    wb.Props = { Title: String(title || 'Reporte'), Author: company, CreatedDate: new Date() };
    const sheetName = String(title || 'Reporte').replace(/[:\\/?*\[\]]/g, '').slice(0, 31) || 'Reporte';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
    const safe = String(fileName || title || 'Reporte').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
    XLSX.writeFile(wb, `${safe}_${date}.xlsx`);
  }

  window.MPExcel = { exportTable, toNumber, columnType };
})();
