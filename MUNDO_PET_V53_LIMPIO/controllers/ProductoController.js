const { wrap } = require('../helpers/response');
const ProductoModel = require('../models/ProductoModel');
const fs = require('fs');
const { hasPermission, userScope } = require('../middleware/permisos');

function esAdministradorDeProductos(req) {
  const u = req.session?.usuario || {};
  const perfil = String(u.perfil_nombre || '').trim().toLowerCase();
  return Boolean(u.es_global || perfil === 'administrador' || perfil.startsWith('administrador '));
}
function esAdminGlobal(req) { return !!req.session?.usuario?.es_global; }

function textoSeguro(valor, max = 500) {
  const v = String(valor || '').trim();
  if (v.length > max) return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v)) return null;
  return v;
}

async function productoEnAlcance(req, id) {
  const p = await ProductoModel.getById(Number(id));
  if (!p) return null;
  const scope = userScope(req);
  if (!scope.isGlobal && p.sucursal_id && Number(p.sucursal_id) !== Number(scope.sucursalId)) return false;
  return p;
}

function validarProducto(data) {
  const nombre = textoSeguro(data.nombre, 120);
  const descripcion = textoSeguro(data.descripcion, 1500);
  const marca = textoSeguro(data.marca, 80);
  const atributoExtra = textoSeguro(data.atributo_extra, 120);
  if (!nombre) return 'El nombre es requerido y debe ser válido';
  if (descripcion === null || marca === null || atributoExtra === null) return 'Uno de los textos supera el límite permitido';

  const venta = Number(data.precio_venta);
  const costo = Number(data.precio_costo || 0);
  const oferta = Number(data.porcentaje_oferta || 0);
  const stockMin = Number(data.stock_minimo || 0);
  const garantia = Number(data.garantia_meses || 0);
  if (!Number.isFinite(venta) || venta <= 0) return 'El precio de venta debe ser mayor a 0';
  if (!Number.isFinite(costo) || costo < 0) return 'El precio costo no puede ser negativo';
  if (costo > venta) return 'El precio costo no puede ser mayor al precio de venta';
  if (!Number.isFinite(oferta) || oferta < 0 || oferta > 100) return 'El porcentaje de oferta debe estar entre 0 y 100';
  if (!Number.isFinite(stockMin) || stockMin < 0) return 'El stock mínimo no puede ser negativo';
  if (!Number.isFinite(garantia) || garantia < 0) return 'La garantía no puede ser negativa';
  return null;
}

const ProductoController = {
  list: wrap(async (req, res) => {
    const u = req.session.usuario;
    const sid = u?.es_global ? null : u?.sucursal_id;
    const productos = await ProductoModel.getAll(sid);
    const canSeeCost = await hasPermission(req, 'productos.ver_costo');
    if (!canSeeCost) productos.forEach(p => { delete p.precio_costo; });
    res.json({ ok: true, productos });
  }),

  getOne: wrap(async (req, res) => {
    const p = await productoEnAlcance(req, req.params.id);
    if (p === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
    const [imagenes, presentaciones, volumenes] = await Promise.all([
      ProductoModel.getImagenes(p.id),
      ProductoModel.getPresentaciones(p.id),
      ProductoModel.getVolumenes(p.id)
    ]);
    if (!(await hasPermission(req, 'productos.ver_costo'))) {
      delete p.precio_costo;
      volumenes.forEach(v => { delete v.precio_costo; delete v.margen_unitario; delete v.resultado; });
    }
    res.json({ ok: true, producto: p, imagenes, presentaciones, volumenes });
  }),

  create: wrap(async (req, res) => {
    const u = req.session.usuario;
    if (!esAdminGlobal(req)) {
      return res.status(403).json({ ok: false, msg: 'Solo el administrador global puede crear productos y definir precios' });
    }
    const data = {
      nombre: req.body.nombre,
      descripcion: req.body.descripcion || '',
      marca: req.body.marca || '',
      precio_costo: req.body.precio_costo || 0,
      precio_venta: req.body.precio_venta,
      porcentaje_oferta: req.body.porcentaje_oferta || 0,
      stock_actual: req.body.stock_actual || 0,
      stock_minimo: req.body.stock_minimo || 0,
      garantia_meses: req.body.garantia_meses || 0,
      atributo_extra: req.body.atributo_extra || null,
      sucursal_id: u?.es_global ? Number(req.body.sucursal_id || 0) : Number(u?.sucursal_id || 0)
    };
    const err = validarProducto(data);
    if (err) return res.status(400).json({ ok: false, msg: err });
    if (!data.sucursal_id) return res.status(400).json({ ok: false, msg: 'Selecciona una sucursal para el producto' });
    const stock = Number(data.stock_actual);
    if (!Number.isFinite(stock) || stock < 0) return res.status(400).json({ ok: false, msg: 'El stock inicial no puede ser negativo' });
    data.nombre = textoSeguro(data.nombre, 120);
    data.descripcion = textoSeguro(data.descripcion, 1500);
    data.marca = textoSeguro(data.marca, 80);
    data.atributo_extra = textoSeguro(data.atributo_extra, 120) || null;
    const id = await ProductoModel.crear(data, u.id);
    res.status(201).json({ ok: true, msg: 'Producto creado', id });
  }),

  update: wrap(async (req, res) => {
    const id = Number(req.params.id);
    const actual = await productoEnAlcance(req, id);
    if (actual === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    if (!actual) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });

    const puedeEditarPrecios = esAdminGlobal(req);
    const data = {
      nombre: req.body.nombre,
      descripcion: req.body.descripcion || '',
      marca: req.body.marca || '',
      precio_costo: puedeEditarPrecios ? req.body.precio_costo : actual.precio_costo,
      precio_venta: puedeEditarPrecios ? req.body.precio_venta : actual.precio_venta,
      porcentaje_oferta: puedeEditarPrecios ? req.body.porcentaje_oferta : actual.porcentaje_oferta,
      stock_minimo: req.body.stock_minimo || 0,
      garantia_meses: req.body.garantia_meses || 0,
      atributo_extra: req.body.atributo_extra || null,
      estado: [0, 1].includes(Number(req.body.estado)) ? Number(req.body.estado) : Number(actual.estado)
    };
    const err = validarProducto(data);
    if (err) return res.status(400).json({ ok: false, msg: err });
    data.nombre = textoSeguro(data.nombre, 120);
    data.descripcion = textoSeguro(data.descripcion, 1500);
    data.marca = textoSeguro(data.marca, 80);
    data.atributo_extra = textoSeguro(data.atributo_extra, 120) || null;
    await ProductoModel.actualizar(id, data);
    res.json({ ok: true, msg: 'Producto actualizado' });
  }),

  remove: wrap(async (req, res) => {
    const p = await productoEnAlcance(req, req.params.id);
    if (p === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
    if (Number(p.stock_actual) > 0) return res.status(409).json({ ok: false, msg: 'No se puede eliminar un producto con stock. Transfiere o ajusta el stock primero.' });
    await ProductoModel.eliminar(Number(req.params.id));
    res.json({ ok: true, msg: 'Producto eliminado' });
  }),

  toggleEstado: wrap(async (req, res) => {
    const p = await productoEnAlcance(req, req.params.id);
    if (p === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
    const estado = Number(req.body.estado);
    if (![0, 1].includes(estado)) return res.status(400).json({ ok: false, msg: 'Estado inválido' });
    await ProductoModel.cambiarEstado(p.id, estado);
    res.json({ ok: true, msg: estado === 0 ? 'Producto activado' : 'Producto desactivado' });
  }),

  toggleVentaTransferida: wrap(async (req, res) => {
    if (!esAdministradorDeProductos(req)) return res.status(403).json({ ok: false, msg: 'Solo un administrador puede controlar la venta desde Inventario' });
    const p = await productoEnAlcance(req, req.params.id);
    if (p === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
    if (Number(p.es_transferido) !== 1) return res.status(409).json({ ok: false, msg: 'Este producto no fue creado por una transferencia' });
    const panel = req.body.panel === true || Number(req.body.panel) === 1;
    const web = req.body.web === true || Number(req.body.web) === 1;
    if (!Object.prototype.hasOwnProperty.call(req.body, 'panel') && !Object.prototype.hasOwnProperty.call(req.body, 'web')) {
      return res.status(400).json({ ok:false, msg:'Selecciona al menos los canales que deseas configurar' });
    }
    await ProductoModel.cambiarVentaTransferida(p.id, { panel, web });
    const activos = [panel ? 'panel administrativo' : '', web ? 'tienda web' : ''].filter(Boolean);
    res.json({ ok: true, panel, web, msg: activos.length ? `Venta habilitada en ${activos.join(' y ')}` : 'Venta bloqueada en panel y tienda web' });
  }),

  getImagenes: wrap(async (req, res) => {
    const p = await productoEnAlcance(req, req.params.id);
    if (p === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
    res.json({ ok: true, imagenes: await ProductoModel.getImagenes(p.id) });
  }),

  addImagen: wrap(async (req, res) => {
    if (!req.file?.webPath) return res.status(400).json({ ok: false, msg: 'Sin archivo válido' });
    const producto = await productoEnAlcance(req, req.params.id);
    if (producto === false) { try { fs.unlinkSync(req.file.path); } catch (_) {} return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' }); }
    if (!producto) { try { fs.unlinkSync(req.file.path); } catch (_) {} return res.status(404).json({ ok: false, msg: 'Producto no encontrado' }); }
    const actuales = await ProductoModel.getImagenes(producto.id);
    if (actuales.length >= 8) { try { fs.unlinkSync(req.file.path); } catch (_) {} return res.status(400).json({ ok: false, msg: 'Máximo 8 imágenes por producto' }); }
    const esPortada = !actuales.some(x => Number(x.es_portada) === 1);
    const id = await ProductoModel.addImagen(producto.id, req.file.webPath, esPortada);
    res.status(201).json({ ok: true, msg: 'Imagen subida', id, ruta: req.file.webPath });
  }),

  deleteImagen: wrap(async (req, res) => {
    const img = await ProductoModel.getImagenById(Number(req.params.imgId));
    if (!img || Number(img.producto_id) !== Number(req.params.id)) return res.status(404).json({ ok: false, msg: 'Imagen no encontrada' });
    const p = await productoEnAlcance(req, img.producto_id);
    if (p === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    ProductoModel.eliminarArchivo(img.ruta);
    await ProductoModel.deleteImagen(img.id);
    if (Number(img.es_portada) === 1) await ProductoModel.asignarPortadaSiguiente(img.producto_id);
    res.json({ ok: true, msg: 'Imagen eliminada' });
  }),

  setPortada: wrap(async (req, res) => {
    const p = await productoEnAlcance(req, req.params.id);
    if (p === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
    const img = await ProductoModel.getImagenById(Number(req.params.imgId));
    if (!img || Number(img.producto_id) !== Number(p.id)) return res.status(404).json({ ok: false, msg: 'Imagen no encontrada' });
    await ProductoModel.setPortada(p.id, img.id);
    res.json({ ok: true, msg: 'Portada actualizada' });
  }),

  getVolumenes: wrap(async (req, res) => {
    const p = await productoEnAlcance(req, req.params.id);
    if (p === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
    const volumenes = await ProductoModel.getVolumenes(p.id);
    if (!(await hasPermission(req, 'productos.ver_costo'))) volumenes.forEach(v => { delete v.precio_costo; delete v.margen_unitario; delete v.resultado; });
    res.json({ ok: true, volumenes });
  }),

  addVolumen: wrap(async (req, res) => {
    if (!esAdministradorDeProductos(req)) return res.status(403).json({ ok: false, msg: 'Solo un administrador puede modificar precios por volumen' });
    const productoId = Number(req.params.id);
    const cantidadDesde = Number(req.body.cantidad_desde);
    const precioUnit = Number(req.body.precio_unit);
    if (!Number.isInteger(cantidadDesde) || cantidadDesde < 2) return res.status(400).json({ ok: false, msg: 'La cantidad debe ser un entero de 2 o más' });
    if (!Number.isFinite(precioUnit) || precioUnit <= 0) return res.status(400).json({ ok: false, msg: 'El precio debe ser mayor a 0' });
    const prod = await productoEnAlcance(req, productoId);
    if (prod === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    if (!prod) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
    if (precioUnit >= Number(prod.precio_venta)) return res.status(400).json({ ok: false, msg: `El precio por volumen debe ser menor al precio normal de S/ ${Number(prod.precio_venta).toFixed(2)}` });
    const existentes = await ProductoModel.getVolumenes(productoId);
    if (existentes.some(v => Number(v.cantidad_desde) === cantidadDesde)) return res.status(409).json({ ok: false, msg: `Ya existe un escalón desde ${cantidadDesde} unidades` });
    const id = await ProductoModel.addVolumen(productoId, cantidadDesde, precioUnit);
    const margen = precioUnit - Number(prod.precio_costo || 0);
    res.status(201).json({
      ok: true,
      msg: 'Escalón agregado',
      id,
      resultado: margen < 0 ? 'perdida' : margen === 0 ? 'sin_margen' : 'ganancia',
      margen_unitario: margen,
      aviso: margen < 0 ? `Este precio genera una pérdida de S/ ${Math.abs(margen).toFixed(2)} por unidad.` : `Ganancia estimada: S/ ${margen.toFixed(2)} por unidad.`
    });
  }),

  deleteVolumen: wrap(async (req, res) => {
    if (!esAdministradorDeProductos(req)) return res.status(403).json({ ok: false, msg: 'Solo un administrador puede modificar precios por volumen' });
    const v = await ProductoModel.getVolumenById(Number(req.params.volId));
    if (!v || Number(v.producto_id) !== Number(req.params.id)) return res.status(404).json({ ok: false, msg: 'Escalón no encontrado' });
    const p = await productoEnAlcance(req, v.producto_id);
    if (p === false) return res.status(403).json({ ok: false, msg: 'Producto fuera de tu sucursal' });
    await ProductoModel.deleteVolumen(v.id);
    res.json({ ok: true, msg: 'Escalón eliminado' });
  })
};

module.exports = ProductoController;
