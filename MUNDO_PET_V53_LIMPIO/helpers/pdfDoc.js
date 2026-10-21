// helpers/pdfDoc.js
// Generador de PDF (nota de venta / cotización) con PDFKit.
// Guarda en storage/documents y devuelve el nombre del archivo.
const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');

const DIR_OUT = path.join(__dirname, '../storage/documents');
fs.mkdirSync(DIR_OUT, { recursive: true });

const VERDE   = '#16A34A';
const CELESTE = '#0EA5E9';
const GRIS    = '#64748B';
const OSCURO  = '#0F172A';
const LINEA   = '#E2E8F0';
const BLANCO  = '#FFFFFF';

function rutaLogoFisica(rutaWeb) {
  if (!rutaWeb) return null;
  const f = path.join(__dirname, '../public', String(rutaWeb).replace(/^\//, ''));
  return fs.existsSync(f) ? f : null;
}

function generarComprobantePDF(datos) {
  return new Promise((resolve, reject) => {
    try {
      const doc    = new PDFDocument({ size: 'A4', margin: 44 });
      const ruta   = path.join(DIR_OUT, datos.nombreArchivo);
      const stream = fs.createWriteStream(ruta);
      doc.pipe(stream);
      doc.page.margins.bottom = 0;

      const emp  = datos.empresa || {};
      const L    = doc.page.margins.left;          // 44
      const R    = doc.page.width - doc.page.margins.right; // ~551
      const W    = R - L;                          // ancho útil ~507

      // ════════════════════════════════════════════════
      //  ENCABEZADO
      // ════════════════════════════════════════════════
      const LOGO_SIZE = 100;
      const BOX_W     = 178;
      const BOX_H     = 72;
      const TOP       = 44;

      // ── Logo (izquierda) ──
      if (datos.logoFisico) {
        try { doc.image(datos.logoFisico, L, TOP, { fit: [LOGO_SIZE, LOGO_SIZE] }); }
        catch(e) {}
      }

      // ── Datos de empresa (centro-izquierda) ──
      const empX  = datos.logoFisico ? L + LOGO_SIZE + 14 : L;
      const empW  = R - empX - BOX_W - 14;

      // Nombre: tamaño adaptable para NO cortar nunca
      const nomStr  = emp.nombre || 'DISTRIBUCIONES MAOZ E.I.R.L.';
      const nomSize = nomStr.length > 36 ? 10
                    : nomStr.length > 28 ? 11
                    : nomStr.length > 20 ? 13 : 15;

      doc.fillColor(VERDE).fontSize(nomSize).font('Helvetica-Bold')
         .text(nomStr, empX, TOP, { width: Math.max(empW, 120), lineBreak: false });

      let yi = TOP + nomSize + 5;
      doc.fillColor(GRIS).fontSize(8.5).font('Helvetica');
      if (emp.ruc) {
        doc.text('RUC: ' + emp.ruc, empX, yi, { width: Math.max(empW, 120), lineBreak: false });
        yi += 12;
      }
      if (emp.direccion) {
        doc.text(emp.direccion, empX, yi, { width: Math.max(empW, 120) });
        yi = doc.y + 2;
      }
      if (emp.telefono) {
        doc.text('Tel: ' + emp.telefono, empX, yi, { width: Math.max(empW, 120), lineBreak: false });
      }

      // ── Cuadro tipo de comprobante (derecha) ──
      const boxX = R - BOX_W;
      const boxY = TOP;
      doc.roundedRect(boxX, boxY, BOX_W, BOX_H, 8)
         .lineWidth(1.5).fillAndStroke('#F0FDF4', VERDE);

      doc.fillColor(OSCURO).fontSize(10).font('Helvetica-Bold')
         .text(datos.titulo || 'NOTA DE VENTA', boxX + 4, boxY + 10,
               { width: BOX_W - 8, align: 'center', lineBreak: false });

      doc.fillColor(VERDE).fontSize(14).font('Helvetica-Bold')
         .text(datos.numero || '', boxX + 4, boxY + 26,
               { width: BOX_W - 8, align: 'center', lineBreak: false });

      doc.fillColor(GRIS).fontSize(7.5).font('Helvetica')
         .text(datos.subtitulo || 'Documento interno', boxX + 4, boxY + 52,
               { width: BOX_W - 8, align: 'center', lineBreak: false });

      // ── Línea separadora ──
      const sepY = TOP + Math.max(LOGO_SIZE, BOX_H) + 10;
      doc.moveTo(L, sepY).lineTo(R, sepY).lineWidth(1.2).stroke(LINEA);

      // ════════════════════════════════════════════════
      //  SECCIÓN CLIENTE + FECHA
      // ════════════════════════════════════════════════
      const SEC_Y = sepY + 10;
      const colW  = (W - 10) / 2;

      // Columna izquierda: cliente
      doc.fillColor(CELESTE).fontSize(7.5).font('Helvetica-Bold')
         .text('CLIENTE', L, SEC_Y, { lineBreak: false });
      doc.fillColor(OSCURO).fontSize(10).font('Helvetica-Bold')
         .text(datos.cliente?.nombre || 'Cliente General', L, SEC_Y + 10,
               { width: colW, lineBreak: false });
      let cliY = SEC_Y + 22;
      if (datos.cliente?.doc) {
        doc.fillColor(GRIS).fontSize(8.5).font('Helvetica')
           .text(datos.cliente.doc, L, cliY, { width: colW, lineBreak: false });
        cliY += 12;
      }
      if (datos.vendedor) {
        doc.fillColor(GRIS).fontSize(8.5).font('Helvetica')
           .text('Vendedor: ' + datos.vendedor, L, cliY, { width: colW, lineBreak: false });
      }

      // Columna derecha: fecha
      const fechaX = L + colW + 10;
      doc.fillColor(CELESTE).fontSize(7.5).font('Helvetica-Bold')
         .text('FECHA DE EMISIÓN', fechaX, SEC_Y, { width: colW, align: 'right', lineBreak: false });
      doc.fillColor(OSCURO).fontSize(10).font('Helvetica-Bold')
         .text(datos.fecha || '', fechaX, SEC_Y + 10, { width: colW, align: 'right', lineBreak: false });
      if (datos.extraFecha) {
        doc.fillColor(CELESTE).fontSize(7.5).font('Helvetica-Bold')
           .text(datos.extraFecha.label, fechaX, SEC_Y + 22, { width: colW, align: 'right', lineBreak: false });
        doc.fillColor(OSCURO).fontSize(10).font('Helvetica-Bold')
           .text(datos.extraFecha.valor, fechaX, SEC_Y + 32, { width: colW, align: 'right', lineBreak: false });
      }

      // ════════════════════════════════════════════════
      //  TABLA DE PRODUCTOS
      // ════════════════════════════════════════════════
      let y = SEC_Y + 52;

      // Cabecera de tabla
      doc.rect(L, y, W, 20).fill(VERDE);
      doc.fillColor(BLANCO).fontSize(8.5).font('Helvetica-Bold');
      const C = {
        n:    L + 4,
        desc: L + 24,
        pu:   R - 190,
        cant: R - 110,
        imp:  R - 66
      };
      doc.text('#',          C.n,    y + 6, { lineBreak: false });
      doc.text('DESCRIPCIÓN', C.desc, y + 6, { lineBreak: false });
      doc.text('P. UNIT',    C.pu,   y + 6, { width: 70, align: 'right', lineBreak: false });
      doc.text('CANT.',      C.cant, y + 6, { width: 36, align: 'center', lineBreak: false });
      doc.text('IMPORTE',    C.imp,  y + 6, { width: 62, align: 'right', lineBreak: false });
      y += 20;

      // Filas
      doc.font('Helvetica').fontSize(9);
      (datos.items || []).forEach((it, i) => {
        const rh = 19;
        if (i % 2 === 0) doc.rect(L, y, W, rh).fill('#F8FAFC');
        doc.fillColor(OSCURO);
        doc.text(String(i + 1),                   C.n,    y + 5, { lineBreak: false });
        doc.text(it.nombre || '',                  C.desc, y + 5, { width: C.pu - C.desc - 6, lineBreak: false });
        doc.text('S/ ' + (+it.precio_unit).toFixed(2), C.pu, y + 5, { width: 70, align: 'right', lineBreak: false });
        doc.text(String(it.cantidad),              C.cant, y + 5, { width: 36, align: 'center', lineBreak: false });
        doc.text('S/ ' + (+it.subtotal).toFixed(2), C.imp, y + 5, { width: 62, align: 'right', lineBreak: false });
        y += rh;
      });
      doc.moveTo(L, y).lineTo(R, y).lineWidth(1).stroke(LINEA);

      // ════════════════════════════════════════════════
      //  TOTALES
      // ════════════════════════════════════════════════
      y += 12;
      const totX  = R - 220;
      const totW1 = 120;
      const totW2 = 90;

      const fila = (lbl, val, negrita) => {
        const fs_ = negrita ? 12 : 9.5;
        doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs_)
           .fillColor(negrita ? OSCURO : GRIS)
           .text(lbl, totX, y, { width: totW1, align: 'right', lineBreak: false });
        doc.fillColor(negrita ? VERDE : OSCURO).font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs_)
           .text(val, totX + totW1 + 8, y, { width: totW2, align: 'right', lineBreak: false });
        y += negrita ? 20 : 14;
      };

      fila('Subtotal', 'S/ ' + (+datos.subtotal).toFixed(2));
      if (+datos.descuento > 0)
        fila('Descuento', '- S/ ' + (+datos.descuento).toFixed(2));
      if (+datos.delivery > 0)
        fila('Delivery', 'S/ ' + (+datos.delivery).toFixed(2));
      doc.moveTo(totX, y).lineTo(R, y).lineWidth(1).stroke(VERDE); y += 5;
      fila('TOTAL', 'S/ ' + (+datos.total).toFixed(2), true);

      if (datos.observacion) {
        y += 6;
        doc.font('Helvetica').fontSize(8.5).fillColor(GRIS)
           .text('Obs: ' + datos.observacion, L, y, { width: W });
        y = doc.y;
      }

      // ── Métodos de pago (solo en nota de venta, si vienen) ──
      if (datos.pagos && datos.pagos.length) {
        y += 10;
        // Etiqueta de sección
        doc.rect(L, y, W, 18).fill('#F0FDF4');
        doc.fillColor(VERDE).fontSize(8.5).font('Helvetica-Bold')
           .text('FORMA DE PAGO', L + 6, y + 5, { lineBreak: false });
        y += 18;

        const LABEL = {
          efectivo:      'Efectivo',
          yape:          'Yape',
          plin:          'Plin',
          transferencia: 'Transferencia',
          tarjeta:       'Tarjeta'
        };

        datos.pagos.forEach((p, i) => {
          const label = LABEL[p.metodo] || (p.metodo.charAt(0).toUpperCase() + p.metodo.slice(1));
          const monto = 'S/ ' + (+p.monto).toFixed(2);
          // Alternar fondo
          if (i % 2 === 0) doc.rect(L, y, W, 16).fill('#F8FAFC');
          doc.fillColor(OSCURO).fontSize(9).font('Helvetica')
             .text(label, L + 8, y + 4, { lineBreak: false });
          doc.fillColor(VERDE).font('Helvetica-Bold')
             .text(monto, L, y + 4, { width: W - 8, align: 'right', lineBreak: false });
          y += 16;
        });

        // Si hay varios pagos, mostrar el total pagado
        if (datos.pagos.length > 1) {
          const totalPagado = datos.pagos.reduce((a, p) => a + (+p.monto), 0);
          doc.moveTo(L, y).lineTo(R, y).lineWidth(0.8).stroke(LINEA); y += 4;
          doc.fillColor(GRIS).fontSize(8.5).font('Helvetica-Bold')
             .text('Total pagado', L + 8, y + 3, { lineBreak: false });
          doc.fillColor(VERDE)
             .text('S/ ' + totalPagado.toFixed(2), L, y + 3,
                   { width: W - 8, align: 'right', lineBreak: false });
          y += 16;
        }
      }

      // ════════════════════════════════════════════════
      //  PIE DE PÁGINA
      // ════════════════════════════════════════════════
      const footY = doc.page.height - 60;

      // Línea verde decorativa
      doc.rect(L, footY, W, 2).fill(VERDE);

      doc.fontSize(11).font('Helvetica-Bold').fillColor(VERDE)
         .text('¡Gracias por su preferencia!', L, footY + 8,
               { width: W, align: 'center', lineBreak: false });

      const pieLinea2 = [
        emp.nombre || '',
        emp.ruc ? 'RUC ' + emp.ruc : '',
        datos.numero
      ].filter(Boolean).join('  |  ');

      doc.fontSize(7.5).font('Helvetica').fillColor(GRIS)
         .text(pieLinea2, L, footY + 22,
               { width: W, align: 'center', lineBreak: false });

      doc.text(datos.piePersonalizado || 'Documento interno · No es comprobante de pago electrónico',
               L, footY + 33, { width: W, align: 'center', lineBreak: false });

      doc.end();
      stream.on('finish', () => resolve(datos.nombreArchivo));
      stream.on('error', reject);
    } catch(e) { reject(e); }
  });
}


function generarTicketPDF(datos) {
  return new Promise((resolve, reject) => {
    try {
      const items = Array.isArray(datos.items) ? datos.items : [];
      const pagos = Array.isArray(datos.pagos) ? datos.pagos : [];
      const pageWidth = 226.77; // 80 mm
      const estimatedHeight = Math.max(560, 430 + items.length * 34 + pagos.length * 22 + (datos.observacion ? 55 : 0));
      const doc = new PDFDocument({ size: [pageWidth, estimatedHeight], margin: 14 });
      const ruta = path.join(DIR_OUT, datos.nombreArchivo);
      const stream = fs.createWriteStream(ruta);
      doc.pipe(stream);

      const L = 14;
      const R = pageWidth - 14;
      const W = R - L;
      const emp = datos.empresa || {};
      let y = 14;

      if (datos.logoFisico) {
        try {
          doc.image(datos.logoFisico, (pageWidth - 46) / 2, y, { fit: [46, 46] });
          y += 51;
        } catch (_) {}
      }

      doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(10)
        .text(emp.nombre || 'MUNDO PET', L, y, { width: W, align: 'center' });
      y = doc.y + 2;
      if (emp.ruc) {
        doc.fillColor(GRIS).font('Helvetica').fontSize(7.5)
          .text(`RUC ${emp.ruc}`, L, y, { width: W, align: 'center' });
        y = doc.y + 1;
      }
      if (emp.direccion) {
        doc.text(emp.direccion, L, y, { width: W, align: 'center' });
        y = doc.y + 1;
      }
      if (emp.telefono) {
        doc.text(`Tel. ${emp.telefono}`, L, y, { width: W, align: 'center' });
        y = doc.y + 3;
      }

      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.8).stroke(VERDE);
      y += 7;
      doc.fillColor(OSCURO).font('Helvetica-Bold').fontSize(10)
        .text(datos.titulo || 'NOTA DE VENTA', L, y, { width: W, align: 'center' });
      y = doc.y + 2;
      doc.fillColor(VERDE).fontSize(12)
        .text(datos.numero || '', L, y, { width: W, align: 'center' });
      y = doc.y + 2;
      doc.fillColor(GRIS).font('Helvetica').fontSize(7)
        .text(datos.subtitulo || 'Documento interno', L, y, { width: W, align: 'center' });
      y = doc.y + 8;

      const line = (label, value) => {
        const labelWidth = 54;
        doc.fillColor(GRIS).font('Helvetica').fontSize(7.5)
          .text(label, L, y, { width: labelWidth, continued: false });
        doc.fillColor(OSCURO).font('Helvetica-Bold')
          .text(String(value || '—'), L + labelWidth, y, { width: W - labelWidth, align: 'right' });
        y = Math.max(doc.y, y + 11);
      };

      line('Fecha:', datos.fecha);
      line('Cliente:', datos.cliente?.nombre || 'Cliente General');
      if (datos.cliente?.doc) line('Documento:', datos.cliente.doc);
      if (datos.vendedor) line('Vendedor:', datos.vendedor);
      if (datos.extraFecha) line(`${datos.extraFecha.label}:`, datos.extraFecha.valor);

      y += 2;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).stroke(LINEA);
      y += 6;
      doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(7.5)
        .text('PRODUCTO', L, y, { width: 105 })
        .text('CANT.', L + 106, y, { width: 28, align: 'center' })
        .text('IMPORTE', L + 134, y, { width: W - 134, align: 'right' });
      y += 12;

      items.forEach((it) => {
        const name = String(it.nombre || 'Producto');
        const rowHeight = Math.max(23, doc.heightOfString(name, { width: 100, fontSize: 7.6 }) + 13);
        doc.fillColor(OSCURO).font('Helvetica-Bold').fontSize(7.6)
          .text(name, L, y, { width: 100 });
        doc.fillColor(GRIS).font('Helvetica').fontSize(7)
          .text(`S/ ${Number(it.precio_unit || 0).toFixed(2)} c/u`, L, y + rowHeight - 10, { width: 100 });
        doc.fillColor(OSCURO).font('Helvetica').fontSize(7.6)
          .text(String(it.cantidad || 0), L + 106, y + 2, { width: 28, align: 'center' })
          .text(`S/ ${Number(it.subtotal || 0).toFixed(2)}`, L + 134, y + 2, { width: W - 134, align: 'right' });
        y += rowHeight;
        doc.moveTo(L, y - 2).lineTo(R, y - 2).lineWidth(0.35).stroke(LINEA);
      });

      y += 5;
      const totalLine = (label, amount, bold = false, negative = false) => {
        doc.fillColor(bold ? OSCURO : GRIS).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8)
          .text(label, L, y, { width: 105, align: 'right' });
        doc.fillColor(bold ? VERDE : OSCURO).font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .text(`${negative ? '- ' : ''}S/ ${Number(amount || 0).toFixed(2)}`, L + 110, y, { width: W - 110, align: 'right' });
        y += bold ? 16 : 12;
      };
      totalLine('Subtotal', datos.subtotal);
      if (Number(datos.descuento) > 0) totalLine('Descuento', datos.descuento, false, true);
      if (Number(datos.delivery) > 0) totalLine('Delivery', datos.delivery);
      doc.moveTo(L + 70, y).lineTo(R, y).lineWidth(0.8).stroke(VERDE);
      y += 4;
      totalLine('TOTAL', datos.total, true);

      if (pagos.length) {
        y += 2;
        doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(8)
          .text('FORMA DE PAGO', L, y, { width: W, align: 'center' });
        y += 13;
        const labels = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia', tarjeta: 'POS / Tarjeta', izipay: 'POS Izipay' };
        pagos.forEach((p) => {
          line(labels[String(p.metodo || '').toLowerCase()] || p.metodo || 'Pago', `S/ ${Number(p.monto || 0).toFixed(2)}`);
          if (p.referencia) line('Operación:', p.referencia);
        });
      }

      if (datos.observacion) {
        y += 3;
        doc.fillColor(GRIS).font('Helvetica').fontSize(7)
          .text(`Observación: ${datos.observacion}`, L, y, { width: W, align: 'left' });
        y = doc.y + 5;
      }

      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.8).stroke(VERDE);
      y += 7;
      doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(9)
        .text('¡Gracias por su preferencia!', L, y, { width: W, align: 'center' });
      y = doc.y + 3;
      doc.fillColor(GRIS).font('Helvetica').fontSize(6.8)
        .text(datos.piePersonalizado || 'Documento interno · No es comprobante electrónico', L, y, { width: W, align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(datos.nombreArchivo));
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { generarComprobantePDF, generarTicketPDF, rutaLogoFisica, DIR_OUT };