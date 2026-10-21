const { resolveToken } = require('../services/DocumentService');

const DocumentController = {
  async open(req, res, next) {
    try {
      const token = String(req.params.token || '');
      if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return res.status(404).send('Documento no encontrado');
      const doc = await resolveToken(token);
      if (!doc) return res.status(404).send('Documento no encontrado o enlace vencido');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Helmet aplica frame-ancestors 'none' al resto del sistema. Para este
      // PDF se permite únicamente el visor del mismo localhost/dominio.
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${String(doc.archivo_relativo || 'documento.pdf').replace(/["\r\n]/g, '')}"`);
      res.sendFile(doc.file);
    } catch (error) {
      next(error);
    }
  }
};

module.exports = DocumentController;
