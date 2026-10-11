'use strict';

/*
 * Informe de cierre de caja en PDF.
 *
 * Resume un turno completo: quién lo abrió y cerró, el arqueo de efectivo
 * (esperado contra contado), cómo cobró por cada medio de pago, las ventas
 * del turno y los demás movimientos, con espacio para las firmas.
 */
const PDFDocument = require('pdfkit');
const { clean } = require('./reportePdf');

const C = {
  brand: '#15803D', brandSoft: '#DCFCE7', brandInk: '#166534', ink: '#0F172A', soft: '#475569',
  muted: '#94A3B8', head: '#1E293B', line: '#E2E8F0', zebra: '#F8FAFC', white: '#FFFFFF',
  bad: '#B91C1C', badSoft: '#FEE2E2', warn: '#B45309', warnSoft: '#FEF3C7'
};
const money = value => `S/ ${Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = value => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
};
const METHODS = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia', izipay: 'Izipay', credito: 'Crédito', sin_metodo: 'Sin método' };
const STATES = { abierta: 'Abierta', cerrada: 'Cerrada', conciliada: 'Conciliada', pendiente_arqueo: 'Pendiente de arqueo', pendiente_revision: 'Pendiente de revisión', observada: 'Observada' };

function buildCashReportPdf({ empresa, sesion, arqueo, metodos, ventas, movimientos, generado, generadoPor }) {
  return new Promise((resolve, reject) => {
    try {
      const M = 40;
      const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: `Cierre de caja ${clean(sesion.codigo)}`, Author: clean(empresa.nombre) } });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const W = doc.page.width - M * 2;
      const BOTTOM = doc.page.height - M - 20;
      let y = M;

      const ensure = height => { if (y + height > BOTTOM) { doc.addPage(); y = M + 6; doc.rect(0, 0, doc.page.width, 6).fill(C.brand); } };
      const section = title => {
        ensure(40);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.ink).text(clean(title).toUpperCase(), M, y, { characterSpacing: 0.7, lineBreak: false });
        doc.moveTo(M, y + 15).lineTo(M + W, y + 15).lineWidth(0.8).strokeColor(C.line).stroke();
        doc.moveTo(M, y + 15).lineTo(M + 34, y + 15).lineWidth(1.6).strokeColor(C.brand).stroke();
        y += 25;
      };

      // ── Encabezado ──
      doc.rect(0, 0, doc.page.width, 6).fill(C.brand);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.brand).text(clean(empresa.nombre).toUpperCase(), M, y, { characterSpacing: 0.6, lineBreak: false });
      if (empresa.ruc) doc.font('Helvetica').fontSize(8).fillColor(C.soft).text(`RUC ${clean(empresa.ruc)}`, M, y + 11, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(19).fillColor(C.ink).text('Informe de cierre de caja', M, y + 26, { lineBreak: false });
      const state = STATES[sesion.estado] || clean(sesion.estado);
      const closed = ['cerrada', 'conciliada'].includes(sesion.estado);
      doc.font('Helvetica-Bold').fontSize(8.5);
      const badgeW = doc.widthOfString(state.toUpperCase()) + 20;
      doc.roundedRect(M + W - badgeW, y, badgeW, 19, 9.5).fill(closed ? C.brandSoft : C.warnSoft);
      doc.fillColor(closed ? C.brandInk : C.warn).text(state.toUpperCase(), M + W - badgeW, y + 5.5, { width: badgeW, align: 'center', lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(15).fillColor(C.ink).text(clean(sesion.codigo), M, y + 27, { width: W, align: 'right', lineBreak: false });
      y += 58;
      doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1.4).strokeColor(C.brand).stroke();
      y += 14;

      // ── Datos del turno ──
      const facts = [
        ['Sucursal', sesion.sucursal_nombre], ['Cajero', sesion.cajero_nombre],
        ['Apertura', when(sesion.abierta_at)], ['Cierre', sesion.cerrada_at ? when(sesion.cerrada_at) : 'Turno abierto'],
        ['Cerrado por', sesion.cierre_nombre || (sesion.cerrada_at ? sesion.cajero_nombre : '-')], ['Conciliado', sesion.conciliada_at ? `${when(sesion.conciliada_at)}${sesion.conciliador_nombre ? ' · ' + clean(sesion.conciliador_nombre) : ''}` : 'Pendiente']
      ];
      const colW = W / 3;
      facts.forEach(([label, value], index) => {
        const x = M + (index % 3) * colW, fy = y + Math.floor(index / 3) * 32;
        doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(label.toUpperCase(), x, fy, { characterSpacing: 0.5, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(clean(value) || '-', x, fy + 11, { width: colW - 10, lineBreak: false, ellipsis: true });
      });
      y += 84;

      // ── Arqueo de efectivo ──
      section('Arqueo de efectivo');
      const hasCount = arqueo.monto_contado !== undefined && arqueo.monto_contado !== null;
      const diff = hasCount ? Number(arqueo.diferencia || 0) : null;
      const leftW = W * 0.56;
      const lines = [
        ['Fondo inicial', arqueo.monto_inicial, ''], ['Ventas cobradas en caja', arqueo.total_ventas, '+'],
        ['Otros ingresos', arqueo.total_ingresos, '+'], ['Egresos', arqueo.total_egresos, '-']
      ];
      let ly = y;
      lines.forEach(([label, value, sign]) => {
        doc.font('Helvetica').fontSize(10).fillColor(C.soft).text(label, M, ly, { lineBreak: false });
        doc.font('Helvetica').fontSize(10).fillColor(sign === '-' ? C.bad : C.ink).text(`${sign === '-' ? '- ' : sign === '+' ? '+ ' : ''}${money(value)}`, M, ly, { width: leftW, align: 'right', lineBreak: false });
        doc.moveTo(M, ly + 16).lineTo(M + leftW, ly + 16).lineWidth(0.5).strokeColor(C.line).stroke();
        ly += 21;
      });
      doc.rect(M, ly, leftW, 24).fill(C.zebra);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.ink).text('Efectivo esperado', M + 8, ly + 7, { lineBreak: false });
      doc.text(money(arqueo.esperado), M, ly + 7, { width: leftW - 8, align: 'right', lineBreak: false });

      const bx = M + leftW + 18, bw = W - leftW - 18, bh = 108;
      const tone = !hasCount ? [C.zebra, C.soft] : Math.abs(diff) < 0.005 ? [C.brandSoft, C.brandInk] : diff < 0 ? [C.badSoft, C.bad] : [C.warnSoft, C.warn];
      doc.roundedRect(bx, y - 2, bw, bh, 10).fill(tone[0]);
      doc.font('Helvetica').fontSize(8).fillColor(C.soft).text('EFECTIVO CONTADO', bx + 14, y + 10, { characterSpacing: 0.5, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(17).fillColor(C.ink).text(hasCount ? money(arqueo.monto_contado) : 'Sin contar', bx + 14, y + 22, { lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor(C.soft).text('DIFERENCIA', bx + 14, y + 52, { characterSpacing: 0.5, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(17).fillColor(tone[1]).text(hasCount ? `${diff > 0 ? '+ ' : diff < 0 ? '- ' : ''}${money(Math.abs(diff))}` : '-', bx + 14, y + 64, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(tone[1]).text(!hasCount ? 'El turno aún no se cierra' : Math.abs(diff) < 0.005 ? 'Caja cuadrada' : diff < 0 ? 'Faltante de efectivo' : 'Sobrante de efectivo', bx + 14, y + 88, { lineBreak: false });
      y = Math.max(ly + 24, y + bh) + 20;

      // ── Tabla genérica ──
      const table = (cols, rows, emptyText) => {
        const xs = []; cols.reduce((x, col, i) => { xs[i] = x; return x + col.w * W; }, M);
        const head = () => {
          doc.rect(M, y, W, 20).fill(C.head);
          doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white);
          cols.forEach((col, i) => doc.text(col.t, xs[i] + 6, y + 6.5, { width: col.w * W - 12, align: col.a || 'left', lineBreak: false }));
          y += 20;
        };
        ensure(44); head();
        if (!rows.length) {
          doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(emptyText, M, y + 9, { width: W, align: 'center', lineBreak: false });
          y += 30; return;
        }
        rows.forEach((row, index) => {
          doc.font('Helvetica').fontSize(8.5);
          const h = Math.max(...row.map((cell, i) => doc.heightOfString(clean(cell.v ?? cell) || ' ', { width: cols[i].w * W - 12 }))) + 9;
          if (y + h > BOTTOM) { doc.addPage(); doc.rect(0, 0, doc.page.width, 6).fill(C.brand); y = M + 6; head(); }
          if (index % 2) doc.rect(M, y, W, h).fill(C.zebra);
          row.forEach((cell, i) => {
            const value = clean(cell.v ?? cell), color = cell.c || C.ink;
            doc.font(cell.b ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(color).text(value, xs[i] + 6, y + 5, { width: cols[i].w * W - 12, align: cols[i].a || 'left' });
          });
          doc.moveTo(M, y + h).lineTo(M + W, y + h).lineWidth(0.4).strokeColor(C.line).stroke();
          y += h;
        });
        y += 16;
      };

      // ── Medios de pago ──
      section('Cobros por medio de pago');
      const totalMethods = metodos.reduce((sum, m) => sum + Number(m.total || 0), 0);
      table(
        [{ t: 'Medio', w: .34 }, { t: 'Operaciones', w: .2, a: 'right' }, { t: 'Total', w: .26, a: 'right' }, { t: '% del turno', w: .2, a: 'right' }],
        [...metodos.map(m => [METHODS[m.metodo] || m.metodo, String(m.operaciones), money(m.total), totalMethods ? `${(Number(m.total) / totalMethods * 100).toFixed(1)}%` : '-']),
          ...(metodos.length ? [[{ v: 'Total', b: true, c: C.brandInk }, { v: String(metodos.reduce((s, m) => s + Number(m.operaciones || 0), 0)), b: true, c: C.brandInk }, { v: money(totalMethods), b: true, c: C.brandInk }, { v: '100%', b: true, c: C.brandInk }]] : [])],
        'No hubo cobros en este turno.'
      );

      // ── Ventas del turno ──
      section(`Ventas del turno (${ventas.length})`);
      table(
        [{ t: 'Hora', w: .1 }, { t: 'N° venta', w: .17 }, { t: 'Cliente', w: .33 }, { t: 'Pago', w: .14 }, { t: 'Estado', w: .12 }, { t: 'Total', w: .14, a: 'right' }],
        ventas.map(v => {
          const voided = v.estado_venta === 'anulada';
          return [String(v.hora || ''), v.numero, v.cliente || 'Cliente general', METHODS[v.metodo_pago] || v.metodo_pago || '-',
            { v: voided ? 'Anulada' : 'Vigente', c: voided ? C.bad : C.brandInk }, { v: money(v.total), c: voided ? C.muted : C.ink }];
        }),
        'No se registraron ventas en este turno.'
      );

      // ── Otros movimientos ──
      const others = movimientos.filter(m => !m.venta_id || m.tipo === 'egreso');
      section(`Ingresos y egresos manuales (${others.length})`);
      table(
        [{ t: 'Hora', w: .1 }, { t: 'Tipo', w: .12 }, { t: 'Concepto', w: .44 }, { t: 'Usuario', w: .18 }, { t: 'Monto', w: .16, a: 'right' }],
        others.map(m => [String(m.created_at || '').slice(11, 16), { v: m.tipo === 'egreso' ? 'Egreso' : 'Ingreso', c: m.tipo === 'egreso' ? C.bad : C.brandInk }, m.concepto, m.usuario_nombre || '-',
          { v: `${m.tipo === 'egreso' ? '- ' : '+ '}${money(m.monto)}`, c: m.tipo === 'egreso' ? C.bad : C.ink }]),
        'Sin ingresos ni egresos manuales.'
      );

      // ── Observaciones ──
      const notes = [sesion.observacion, sesion.observacion_revision].map(clean).filter(Boolean).join('  ·  ');
      if (notes) {
        section('Observaciones');
        doc.font('Helvetica').fontSize(9.5).fillColor(C.soft);
        const h = doc.heightOfString(notes, { width: W });
        ensure(h + 10); doc.text(notes, M, y, { width: W }); y += h + 18;
      }

      // ── Firmas ──
      ensure(86);
      y += 44;
      const sw = (W - 50) / 2;
      [[sesion.cajero_nombre, 'Cajero'], [sesion.conciliador_nombre || '', 'Supervisor']].forEach(([name, role], i) => {
        const x = M + i * (sw + 50);
        doc.moveTo(x, y).lineTo(x + sw, y).lineWidth(0.8).strokeColor(C.soft).stroke();
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(clean(name) || ' ', x, y + 6, { width: sw, align: 'center', lineBreak: false });
        doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(role, x, y + 18, { width: sw, align: 'center', lineBreak: false });
      });

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0;
        const fy = doc.page.height - M - 2;
        doc.font('Helvetica').fontSize(7.5).fillColor(C.muted)
          .text(`Generado el ${clean(generado)}${generadoPor ? ' por ' + clean(generadoPor) : ''}`, M, fy, { width: W * 0.7, lineBreak: false })
          .text(`Página ${i + 1} de ${range.count}`, M + W * 0.7, fy, { width: W * 0.3, align: 'right', lineBreak: false });
      }
      doc.end();
    } catch (error) { reject(error); }
  });
}

module.exports = { buildCashReportPdf };
