'use strict';

/*
 * PDF de reportes en tabla.
 *
 * Recibe los mismos datos que se exportan a Excel (columnas, tipos y filas ya
 * formateadas) y devuelve un archivo PDF real: encabezado de marca, tabla con
 * anchos calculados según el contenido, encabezado repetido en cada página,
 * fila de totales y numeración de páginas.
 */
const PDFDocument = require('pdfkit');

const C = {
  brand: '#15803D', brandSoft: '#DCFCE7', brandInk: '#166534', ink: '#0F172A',
  soft: '#475569', muted: '#94A3B8', head: '#1E293B', line: '#E2E8F0', zebra: '#F8FAFC', white: '#FFFFFF'
};

// Las fuentes estándar del PDF solo cubren Latin-1: lo demás se simplifica.
function clean(value) {
  return String(value ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E¡-ÿ]/g, '')
    .trim();
}

function buildReportPdf({ titulo, empresa, periodo, columnas, tipos, filas, totales, generado }) {
  return new Promise((resolve, reject) => {
    try {
      const cols = columnas.map(clean);
      const rows = filas.map(row => cols.map((_, c) => clean(row[c])));
      const foot = Array.isArray(totales) && totales.some(v => clean(v)) ? cols.map((_, c) => clean(totales[c])) : null;
      const numeric = cols.map((_, c) => tipos[c] && tipos[c] !== 'text');
      const landscape = cols.length > 6;
      const M = 34;
      const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: M, bufferPages: true,
        info: { Title: clean(titulo), Author: clean(empresa) } });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width - M * 2;
      const BOTTOM = doc.page.height - M - 18;
      const size = cols.length > 10 ? 6.6 : cols.length > 8 ? 7.2 : cols.length > 6 ? 7.8 : 8.6;
      const PAD = cols.length > 8 ? 4 : 6;

      // Ancho natural de cada columna: su encabezado o su contenido más largo.
      doc.font('Helvetica-Bold').fontSize(size);
      const headW = cols.map(text => doc.widthOfString(text) + PAD * 2 + 2);
      doc.font('Helvetica').fontSize(size);
      const sample = rows.length > 400 ? rows.filter((_, i) => i % Math.ceil(rows.length / 400) === 0) : rows;
      const natural = cols.map((_, c) => {
        let max = headW[c];
        for (const row of sample) max = Math.max(max, doc.widthOfString(row[c]) + PAD * 2 + 2);
        if (foot) { doc.font('Helvetica-Bold'); max = Math.max(max, doc.widthOfString(foot[c]) + PAD * 2 + 2); doc.font('Helvetica'); }
        return max;
      });
      // Los números nunca se parten; el texto largo cede espacio y pasa a varias líneas.
      const minimum = cols.map((_, c) => numeric[c] ? natural[c] : Math.min(natural[c], Math.max(headW[c], 46)));
      let widths = natural.map((w, c) => numeric[c] ? w : Math.min(w, landscape ? 230 : 190));
      const total = () => widths.reduce((a, b) => a + b, 0);
      if (total() > W) {
        const flexible = widths.map((w, c) => Math.max(0, w - minimum[c]));
        const room = flexible.reduce((a, b) => a + b, 0);
        const excess = total() - W;
        widths = widths.map((w, c) => room > 0 ? w - flexible[c] * Math.min(1, excess / room) : w);
        if (total() > W) { const k = W / total(); widths = widths.map(w => w * k); }
      } else {
        // Sobra espacio: se reparte para que la tabla ocupe todo el ancho.
        const extra = W - total();
        const weight = widths.reduce((a, b) => a + b, 0);
        widths = widths.map(w => w + extra * (w / weight));
      }
      const xs = []; widths.reduce((x, w, c) => { xs[c] = x; return x + w; }, M);

      const header = () => {
        doc.rect(0, 0, doc.page.width, 6).fill(C.brand);
        doc.fillColor(C.brand).font('Helvetica-Bold').fontSize(8).text(clean(empresa).toUpperCase(), M, M - 6, { width: W * 0.6, characterSpacing: 0.6, lineBreak: false });
        doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(17).text(clean(titulo), M, M + 7, { width: W * 0.62, lineBreak: false, ellipsis: true });
        const metaX = M + W * 0.64, metaW = W * 0.36;
        doc.font('Helvetica').fontSize(8).fillColor(C.soft)
          .text(clean(periodo), metaX, M - 6, { width: metaW, align: 'right', lineBreak: false })
          .text(`${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`, metaX, M + 6, { width: metaW, align: 'right', lineBreak: false })
          .text(`Generado el ${clean(generado)}`, metaX, M + 18, { width: metaW, align: 'right', lineBreak: false });
        doc.moveTo(M, M + 36).lineTo(M + W, M + 36).lineWidth(1.4).strokeColor(C.brand).stroke();
        return M + 48;
      };

      const cellOptions = c => ({ width: widths[c] - PAD * 2, align: numeric[c] ? 'right' : 'left', lineGap: 1 });
      const rowHeight = (cells, font) => {
        doc.font(font).fontSize(size);
        let h = 0;
        cells.forEach((text, c) => { h = Math.max(h, doc.heightOfString(text || ' ', cellOptions(c))); });
        return Math.ceil(h) + PAD * 2 - 1;
      };
      const drawCells = (cells, y, font, color) => {
        doc.font(font).fontSize(size).fillColor(color);
        cells.forEach((text, c) => doc.text(text, xs[c] + PAD, y + PAD, cellOptions(c)));
      };
      const tableHead = y => {
        const h = rowHeight(cols, 'Helvetica-Bold');
        doc.rect(M, y, W, h).fill(C.head);
        drawCells(cols, y, 'Helvetica-Bold', C.white);
        return y + h;
      };

      let y = tableHead(header());
      if (!rows.length) {
        doc.font('Helvetica').fontSize(10).fillColor(C.soft).text('No hay datos en el periodo seleccionado.', M, y + 26, { width: W, align: 'center' });
      }
      rows.forEach((cells, index) => {
        const h = rowHeight(cells, 'Helvetica');
        if (y + h > BOTTOM) { doc.addPage(); y = tableHead(header()); }
        if (index % 2) doc.rect(M, y, W, h).fill(C.zebra);
        drawCells(cells, y, 'Helvetica', C.ink);
        doc.moveTo(M, y + h).lineTo(M + W, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
        y += h;
      });
      if (foot && rows.length) {
        const h = rowHeight(foot, 'Helvetica-Bold') + 2;
        if (y + h > BOTTOM) { doc.addPage(); y = tableHead(header()); }
        doc.rect(M, y, W, h).fill(C.brandSoft);
        doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1.2).strokeColor(C.brand).stroke();
        drawCells(foot, y + 1, 'Helvetica-Bold', C.brandInk);
      }

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const fy = doc.page.height - M - 4;
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(7.5).fillColor(C.muted)
          .text('Mundo Pet · Sistema de gestión', M, fy, { width: W / 2, lineBreak: false })
          .text(`Página ${i + 1} de ${range.count}`, M + W / 2, fy, { width: W / 2, align: 'right', lineBreak: false });
      }
      doc.end();
    } catch (error) { reject(error); }
  });
}

module.exports = { buildReportPdf, clean };
