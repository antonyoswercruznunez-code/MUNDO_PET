const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const PUBLIC_ROOT = path.join(__dirname, '../public/uploads');
const PRIVATE_ROOT = path.join(__dirname, '../storage/private');
const MIME_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

function rawUpload(field, maxBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytes,
      files: 1,
      fields: 25,
      fieldNameSize: 100,
      fieldSize: 1024 * 1024,
      parts: 30
    },
    fileFilter: (req, file, cb) => {
      if (!MIME_ALLOWED.has(file.mimetype)) return cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP'));
      cb(null, true);
    }
  }).single(field);
}

function processor({ folder, publicFile, dynamicId = false, maxWidth = 2400, maxHeight = 2400, quality = 84 }) {
  return async (req, res, next) => {
    if (!req.file) return next();
    try {
      const sub = dynamicId ? String(Number(req.params.id) || 'general') : '';
      const root = publicFile ? PUBLIC_ROOT : PRIVATE_ROOT;
      const dir = path.join(root, folder, sub);
      await fs.mkdir(dir, { recursive: true });

      const metadata = await sharp(req.file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('El archivo no es una imagen válida');
      if (!metadata.width || !metadata.height) throw new Error('No se pudo validar la imagen');

      const name = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.webp`;
      const finalPath = path.join(dir, name);
      await sharp(req.file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(finalPath);

      req.file.filename = name;
      req.file.path = finalPath;
      req.file.size = (await fs.stat(finalPath)).size;
      req.file.sha256 = crypto.createHash('sha256').update(await fs.readFile(finalPath)).digest('hex');
      if (publicFile) {
        req.file.webPath = `/uploads/${folder}/${sub ? `${sub}/` : ''}${name}`;
      } else {
        req.file.privatePath = path.relative(path.join(__dirname, '..'), finalPath).replace(/\\/g, '/');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function pipeline(opts) {
  return [rawUpload(opts.field, opts.maxBytes), processor(opts)];
}

const producto = pipeline({ field: 'imagen', folder: 'productos', publicFile: true, dynamicId: true, maxBytes: 5 * 1024 * 1024, maxWidth: 1800, maxHeight: 1800 });
const logo = pipeline({ field: 'logo', folder: 'logos', publicFile: true, maxBytes: 5 * 1024 * 1024, maxWidth: 1200, maxHeight: 1200, quality: 90 });
const slider = pipeline({ field: 'slider', folder: 'sliders', publicFile: true, maxBytes: 15 * 1024 * 1024, maxWidth: 2560, maxHeight: 1600, quality: 88 });
const qr = pipeline({ field: 'qr', folder: 'qr', publicFile: true, maxBytes: 3 * 1024 * 1024, maxWidth: 1400, maxHeight: 1400, quality: 95 });
const payment = pipeline({ field: 'imagen_pago', folder: 'pagos', publicFile: true, maxBytes: 5 * 1024 * 1024, maxWidth: 1800, maxHeight: 1800, quality: 92 });
const voucher = pipeline({ field: 'voucher', folder: 'vouchers', publicFile: false, maxBytes: 10 * 1024 * 1024, maxWidth: 2200, maxHeight: 2200, quality: 86 });
const evidencia = pipeline({ field: 'imagen', folder: 'reparto', publicFile: false, maxBytes: 10 * 1024 * 1024, maxWidth: 2200, maxHeight: 2200, quality: 86 });

function uploadErrorHandler(error, req, res, next) {
  if (error instanceof multer.MulterError) {
    const msg = error.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera el tamaño permitido' : 'Carga de archivo inválida';
    return res.status(400).json({ ok: false, msg });
  }
  if (error) return res.status(400).json({ ok: false, msg: error.message || 'Archivo inválido' });
  next();
}

module.exports = { producto, logo, slider, qr, payment, voucher, evidencia, uploadErrorHandler, PUBLIC_ROOT, PRIVATE_ROOT };
