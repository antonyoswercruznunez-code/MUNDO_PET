const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const { auth, authAllowLocked, unlock, activity } = require('../middleware/auth');
const { requirePermission, requireAny } = require('../middleware/permisos');
const upload = require('../middleware/upload');
const { authWeb } = require('../middleware/authWeb');

const Auth = require('../controllers/AuthController');
const Usuario = require('../controllers/UsuarioController');
const Perfil = require('../controllers/PerfilController');
const Cliente = require('../controllers/ClienteController');
const Producto = require('../controllers/ProductoController');
const Inventario = require('../controllers/InventarioController');
const Venta = require('../controllers/VentaController');
const Config = require('../controllers/ConfigController');
const Cotizacion = require('../controllers/CotizacionController');
const Caja = require('../controllers/CajaController');
const Sucursal = require('../controllers/SucursalController');
const Pdf = require('../controllers/PdfController');
const Dashboard = require('../controllers/DashboardController');
const Reporte = require('../controllers/ReporteController');
const Rentabilidad = require('../controllers/RentabilidadController');
const Tienda = require('../controllers/TiendaController');
const TiendaAuth = require('../controllers/TiendaAuthController');
const PedidoWeb = require('../controllers/PedidoWebController');
const Comprobante = require('../controllers/ComprobanteController');
const Recojo = require('../controllers/RecojoController');
const Temporada = require('../controllers/TemporadaController');
const Logistica = require('../controllers/LogisticaController');
const NotaCredito = require('../controllers/NotaCreditoController');
const Ubicacion = require('../controllers/UbicacionController');

const loginLimiter = rateLimit({ windowMs: 15*60*1000, limit: 12, standardHeaders:'draft-7', legacyHeaders:false, message:{ok:false,msg:'Demasiados intentos. Espera unos minutos.'} });
const resetLimiter = rateLimit({ windowMs: 15*60*1000, limit: 6, standardHeaders:'draft-7', legacyHeaders:false, message:{ok:false,msg:'Demasiadas solicitudes. Espera unos minutos.'} });
const unlockLimiter = rateLimit({ windowMs: 10*60*1000, limit: 10, standardHeaders:'draft-7', legacyHeaders:false, message:{ok:false,msg:'Demasiados intentos de desbloqueo. Espera unos minutos.'} });
const uploadLimiter = rateLimit({ windowMs: 10*60*1000, limit: 30, standardHeaders:'draft-7', legacyHeaders:false, message:{ok:false,msg:'Límite de cargas alcanzado.'} });

// Público y autenticación de empleados
router.get('/publico/logo', Config.getLogoActivo);
router.post('/auth/login', loginLimiter, Auth.login);
router.post('/auth/forgot', resetLimiter, Auth.forgot);
router.post('/auth/reset-password', resetLimiter, Auth.resetPassword);
router.get('/auth/session', authAllowLocked, Auth.session);
router.post('/auth/unlock', unlockLimiter, authAllowLocked, unlock);
router.post('/auth/activity', auth, activity);
router.post('/auth/logout', authAllowLocked, Auth.logout);

// Ecommerce público
router.get('/tienda/config', Tienda.config);
router.post('/tienda/delivery-cotizar', Tienda.cotizarDelivery);
router.get('/tienda/productos', Tienda.productos);
router.get('/tienda/productos/:id/precio', Tienda.precioProducto);
router.get('/tienda/productos/:id', Tienda.producto);
router.post('/tienda/auth/registro', loginLimiter, TiendaAuth.registro);
router.post('/tienda/auth/login', loginLimiter, TiendaAuth.login);
router.post('/tienda/auth/google', loginLimiter, TiendaAuth.google);
router.get('/tienda/auth/session', TiendaAuth.session);
router.post('/tienda/auth/logout', TiendaAuth.logout);
router.get('/tienda/documento', authWeb, Tienda.consultarDocumento);
router.post('/tienda/pedidos', authWeb, Tienda.crearPedido);
router.get('/tienda/mis-pedidos', authWeb, Tienda.misPedidos);
router.get('/tienda/mis-pedidos/:id', authWeb, Tienda.miPedido);
router.post('/tienda/mis-pedidos/:id/voucher', authWeb, uploadLimiter, ...upload.voucher, Tienda.subirVoucher);
router.get('/tienda/recojo-horarios', authWeb, Tienda.recojoHorarios);
router.get('/tienda/direcciones', authWeb, Tienda.listarDirecciones);
router.post('/tienda/direcciones', authWeb, Tienda.crearDireccion);
router.delete('/tienda/direcciones/:id', authWeb, Tienda.eliminarDireccion);

// Dashboard
router.get('/dashboard/resumen', auth, requirePermission('dashboard.ver'), Dashboard.resumen);

// Usuarios y perfiles
router.get('/usuarios', auth, requirePermission('usuarios.ver'), Usuario.list);
router.post('/usuarios', auth, requirePermission('usuarios.gestionar'), Usuario.create);
router.put('/usuarios/:id', auth, requirePermission('usuarios.gestionar'), Usuario.update);
router.delete('/usuarios/:id', auth, requirePermission('usuarios.gestionar'), Usuario.remove);
router.patch('/usuarios/:id/estado', auth, requirePermission('usuarios.gestionar'), Usuario.toggleEstado);
router.get('/perfiles', auth, requirePermission('perfiles.ver'), Perfil.list);
router.post('/perfiles', auth, requirePermission('perfiles.gestionar'), Perfil.create);
router.put('/perfiles/:id', auth, requirePermission('perfiles.gestionar'), Perfil.update);
router.delete('/perfiles/:id', auth, requirePermission('perfiles.gestionar'), Perfil.remove);
router.post('/perfiles/:id/opciones', auth, requirePermission('perfiles.gestionar'), Perfil.assignOpciones);
router.put('/perfiles/:id/permisos-accion', auth, requirePermission('perfiles.gestionar'), Perfil.assignActionPermissions);
router.patch('/perfiles/:id/estado', auth, requirePermission('perfiles.gestionar'), Perfil.toggleEstado);

// Clientes
router.get('/clientes', auth, requirePermission('clientes.ver'), Cliente.list);
router.get('/clientes/consultar', auth, requirePermission('clientes.ver'), Cliente.consultar);
router.post('/clientes', auth, requirePermission('clientes.gestionar'), Cliente.crear);
router.put('/clientes/:id', auth, requirePermission('clientes.gestionar'), Cliente.editar);
router.delete('/clientes/:id', auth, requirePermission('clientes.gestionar'), Cliente.eliminar);

// Productos / inventario
router.get('/productos', auth, requirePermission('productos.ver'), Producto.list);
router.get('/productos/:id', auth, requirePermission('productos.ver'), Producto.getOne);
router.post('/productos', auth, requirePermission('productos.crear'), Producto.create);
router.put('/productos/:id', auth, requirePermission('productos.editar'), Producto.update);
router.delete('/productos/:id', auth, requirePermission('productos.eliminar'), Producto.remove);
router.patch('/productos/:id/estado', auth, requirePermission('productos.editar'), Producto.toggleEstado);
router.patch('/productos/:id/venta-transferida', auth, requireAny('inventario.ajustar','inventario.transferir'), Producto.toggleVentaTransferida);
router.get('/productos/:id/imagenes', auth, requirePermission('productos.ver'), Producto.getImagenes);
router.post('/productos/:id/imagenes', auth, requirePermission('productos.imagenes'), uploadLimiter, ...upload.producto, Producto.addImagen);
router.delete('/productos/:id/imagenes/:imgId', auth, requirePermission('productos.imagenes'), Producto.deleteImagen);
router.patch('/productos/:id/imagenes/:imgId/portada', auth, requirePermission('productos.imagenes'), Producto.setPortada);
router.get('/productos/:id/volumenes', auth, requirePermission('productos.ver'), Producto.getVolumenes);
router.post('/productos/:id/volumenes', auth, requirePermission('productos.volumen'), Producto.addVolumen);
router.delete('/productos/:id/volumenes/:volId', auth, requirePermission('productos.volumen'), Producto.deleteVolumen);
router.get('/inventario', auth, requirePermission('inventario.ver'), Inventario.stock);
router.get('/inventario/:productoId/movimientos', auth, requirePermission('inventario.ver'), Inventario.movimientos);
router.post('/inventario/reponer', auth, requirePermission('inventario.mover'), Inventario.reponer);
router.post('/inventario/ajuste', auth, requirePermission('inventario.ajustar'), Inventario.ajuste);
router.get('/inventario-transferencias', auth, requirePermission('inventario.transferir'), Inventario.transferencias);
router.get('/inventario-transferencias/candidatos', auth, requirePermission('inventario.transferir'), Inventario.candidatosTransferencia);
router.post('/inventario-transferencias', auth, requirePermission('inventario.transferir'), Inventario.crearTransferencia);
router.patch('/inventario-transferencias/:id/recibir', auth, requirePermission('inventario.transferir'), Inventario.recibirTransferencia);
router.patch('/inventario-transferencias/:id/cancelar', auth, requirePermission('inventario.transferir'), Inventario.cancelarTransferencia);

// Ventas / comprobantes
router.get('/ventas', auth, requirePermission('ventas.ver'), Venta.list);
router.post('/ventas', auth, requirePermission('ventas.crear'), Venta.create);
router.get('/ventas/:id', auth, requirePermission('ventas.ver'), Venta.getOne);
router.get('/ventas/:id/historial', auth, requirePermission('ventas.ver'), Venta.historial);
router.get('/ventas/:id/archivos', auth, requirePermission('ventas.ver'), Venta.archivos);
router.patch('/ventas/:id/anular', auth, requirePermission('ventas.anular'), Venta.anular);
router.put('/ventas/:id/cliente', auth, requirePermission('ventas.crear'), Venta.actualizarCliente);
router.post('/ventas/:id/emitir', auth, requirePermission('ventas.emitir'), Venta.emitir);
router.post('/ventas/:id/nota-credito', auth, requirePermission('ventas.anular'), requirePermission('ventas.emitir'), Venta.notaCredito);
router.post('/ventas/:id/reintentar-envio', auth, requirePermission('ventas.emitir'), Venta.reintentarEnvio);
router.post('/ventas/:id/enviar-correo', auth, requirePermission('ventas.emitir'), Venta.enviarCorreo);
router.get('/ventas/:id/pdf', auth, requirePermission('ventas.ver'), Pdf.ventaPDF);
router.get('/comprobantes', auth, requirePermission('comprobantes.ver'), Comprobante.list);
router.get('/notas-credito', auth, requireAny('comprobantes.ver','ventas.ver'), NotaCredito.list);
router.post('/notas-credito/:id/enviar-correo', auth, requirePermission('ventas.emitir'), NotaCredito.enviarCorreo);

// Pedidos y pagos web
router.get('/pedidos-web', auth, requirePermission('pedidos_web.ver'), PedidoWeb.list);
router.get('/pedidos-web/:id', auth, requirePermission('pedidos_web.ver'), PedidoWeb.detail);
router.post('/pedidos-web/:id/voucher-admin', auth, requireAny('pedidos_web.aprobar_sucursal','pedidos_web.aprobar_multisucursal'), uploadLimiter, ...upload.voucher, PedidoWeb.uploadAdminVoucher);
router.get('/pedidos-web/:id/voucher', auth, requirePermission('pedidos_web.ver'), PedidoWeb.voucher);
router.patch('/pedidos-web/:id/observar', auth, requireAny('pedidos_web.aprobar_sucursal','pedidos_web.aprobar_multisucursal'), PedidoWeb.observe);
router.patch('/pedidos-web/:id/rechazar', auth, requireAny('pedidos_web.aprobar_sucursal','pedidos_web.aprobar_multisucursal'), PedidoWeb.reject);
router.patch('/pedidos-web/:id/aprobar', auth, requireAny('pedidos_web.aprobar_sucursal','pedidos_web.aprobar_multisucursal'), PedidoWeb.approve);
router.post('/pedidos-web/:id/reenviar-correo', auth, requireAny('pedidos_web.aprobar_sucursal','pedidos_web.aprobar_multisucursal'), PedidoWeb.resendMail);
// Alias para el módulo antiguo
router.get('/pagos', auth, requirePermission('pedidos_web.ver'), PedidoWeb.list);

// Configuración / catálogo
router.get('/config', auth, requireAny('config.ver','tienda.gestionar'), Config.get);
router.post('/config', auth, requirePermission('config.gestionar'), Config.save);
router.post('/config/medios-pago', auth, requirePermission('tienda.gestionar'), Config.savePaymentMethods);
router.get('/config/delivery-zonas', auth, requirePermission('tienda.gestionar'), Config.deliveryZonas);
router.post('/config/delivery-zonas', auth, requirePermission('tienda.gestionar'), Config.saveDeliveryZona);
router.put('/config/delivery-zonas/:id', auth, requirePermission('tienda.gestionar'), Config.saveDeliveryZona);
router.delete('/config/delivery-zonas/:id', auth, requirePermission('tienda.gestionar'), Config.deleteDeliveryZona);
router.post('/config/delivery-ajustes', auth, requirePermission('tienda.gestionar'), Config.saveDeliveryAjustes);
router.post('/config/delivery-cotizar', auth, requirePermission('tienda.gestionar'), Config.cotizarDeliveryZona);
router.post('/config/logo', auth, requirePermission('tienda.gestionar'), uploadLimiter, ...upload.logo, Config.uploadLogo);
router.post('/config/slider', auth, requirePermission('tienda.gestionar'), uploadLimiter, ...upload.slider, Config.uploadSlider);
router.patch('/config/slider/:id/estado', auth, requirePermission('tienda.gestionar'), Config.toggleSlider);
router.patch('/config/slider/:id/orden', auth, requirePermission('tienda.gestionar'), Config.reorderSlider);
router.delete('/config/slider/:id', auth, requirePermission('tienda.gestionar'), Config.deleteSlider);
router.post('/config/logo/:id/activar', auth, requirePermission('tienda.gestionar'), Config.activarLogo);
router.delete('/config/logo/:id', auth, requirePermission('tienda.gestionar'), Config.deleteLogo);
router.post('/config/qr', auth, requirePermission('config.gestionar'), uploadLimiter, ...upload.qr, Config.uploadQR);
router.post('/config/metodo-pago-imagen', auth, requirePermission('tienda.gestionar'), uploadLimiter, ...upload.payment, Config.uploadPaymentImage);
router.delete('/config/metodo-pago-imagen/:tipo', auth, requirePermission('tienda.gestionar'), Config.deletePaymentImage);
router.post('/config/probar-correo', auth, requirePermission('config.gestionar'), Config.probarCorreo);
router.post('/config/probar-miapi', auth, requirePermission('config.gestionar'), Config.probarMiapi);

// Temporadas y descuentos
router.get('/temporadas', auth, requirePermission('tienda.gestionar'), Temporada.list);
router.post('/temporadas', auth, requirePermission('tienda.gestionar'), Temporada.create);
router.put('/temporadas/:id', auth, requirePermission('tienda.gestionar'), Temporada.update);
router.delete('/temporadas/:id', auth, requirePermission('tienda.gestionar'), Temporada.remove);
router.post('/temporadas/:id/descuentos', auth, requirePermission('tienda.gestionar'), Temporada.addDiscount);
router.delete('/temporadas/:id/descuentos/:descuentoId', auth, requirePermission('tienda.gestionar'), Temporada.removeDiscount);

// Preparación, delivery y recojo por sucursal
router.get('/recojo', auth, requireAny('pedidos_web.preparar','pedidos_web.entregar'), Recojo.list);
router.get('/recojo/:id', auth, requireAny('pedidos_web.preparar','pedidos_web.entregar'), Recojo.detail);
router.patch('/recojo/:id/estado', auth, requirePermission('pedidos_web.preparar'), Recojo.updateStatus);
router.post('/recojo/verificar-codigo', auth, requirePermission('pedidos_web.entregar'), Recojo.verifyCode);
router.post('/recojo/entregar', auth, requirePermission('pedidos_web.entregar'), Recojo.deliverPickup);
router.patch('/recojo/:id/reprogramar', auth, requirePermission('pedidos_web.preparar'), Recojo.reprogramar);
router.get('/recojo-horarios', auth, requirePermission('recojo.configurar'), Recojo.horarios);
router.post('/recojo-horarios', auth, requirePermission('recojo.configurar'), Recojo.createHorario);
router.post('/recojo-horarios/semana', auth, requirePermission('recojo.configurar'), Recojo.createSemana);
router.put('/recojo-horarios/:id', auth, requirePermission('recojo.configurar'), Recojo.updateHorario);
router.delete('/recojo-horarios/:id', auth, requirePermission('recojo.configurar'), Recojo.deleteHorario);


// Logística de reparto, camiones y entregas
router.get('/logistica/resumen', auth, requirePermission('logistica.ver'), Logistica.resumen);
router.get('/logistica/repartidores', auth, requirePermission('logistica.ver'), Logistica.repartidores);
router.post('/logistica/repartidores', auth, requirePermission('logistica.gestionar'), Logistica.guardarRepartidor);
router.put('/logistica/repartidores/:id', auth, requirePermission('logistica.gestionar'), Logistica.guardarRepartidor);
router.get('/logistica/vehiculos', auth, requirePermission('logistica.ver'), Logistica.vehiculos);
router.post('/logistica/vehiculos', auth, requirePermission('logistica.gestionar'), Logistica.guardarVehiculo);
router.put('/logistica/vehiculos/:id', auth, requirePermission('logistica.gestionar'), Logistica.guardarVehiculo);
router.get('/logistica/rutas', auth, requirePermission('logistica.ver'), Logistica.rutas);
router.get('/logistica/rutas/:id', auth, requirePermission('logistica.ver'), Logistica.ruta);
router.post('/logistica/rutas', auth, requirePermission('logistica.gestionar'), Logistica.crearRuta);
router.get('/logistica/candidatos', auth, requirePermission('logistica.ver'), Logistica.candidatos);
router.post('/logistica/rutas/:id/pedidos', auth, requirePermission('logistica.gestionar'), Logistica.asignar);
router.patch('/logistica/rutas/:id/estado', auth, requirePermission('logistica.operar'), Logistica.estadoRuta);
router.patch('/logistica/rutas/:id/pedidos/:detalleId/estado', auth, requirePermission('logistica.operar'), Logistica.estadoEntrega);
router.post('/logistica/rutas/:id/pedidos/:detalleId/evidencias', auth, requirePermission('logistica.operar'), uploadLimiter, ...upload.evidencia, Logistica.subirEvidencia);
router.get('/logistica/evidencias/:evidenciaId', auth, requirePermission('logistica.ver'), Logistica.verEvidencia);
router.delete('/logistica/evidencias/:evidenciaId', auth, requirePermission('logistica.gestionar'), Logistica.retirarEvidencia);
router.get('/logistica/reporte', auth, requirePermission('reportes.ver'), Logistica.reporte);
router.post('/logistica/ubicacion', auth, requirePermission('logistica.operar'), Ubicacion.registrar);
router.get('/logistica/ubicaciones', auth, requirePermission('logistica.gestionar'), Ubicacion.enVivo);
router.get('/logistica/ubicaciones/:usuarioId/recorrido', auth, requirePermission('logistica.gestionar'), Ubicacion.recorrido);

// Cotizaciones
router.get('/cotizaciones', auth, requirePermission('cotizaciones.ver'), Cotizacion.list);
router.get('/cotizaciones/vigentes', auth, requirePermission('cotizaciones.ver'), Cotizacion.vigentes);
router.get('/cotizaciones/:id', auth, requirePermission('cotizaciones.ver'), Cotizacion.getOne);
router.post('/cotizaciones', auth, requirePermission('cotizaciones.gestionar'), Cotizacion.create);
router.put('/cotizaciones/:id', auth, requirePermission('cotizaciones.gestionar'), Cotizacion.update);
router.post('/cotizaciones/:id/enviar', auth, requirePermission('cotizaciones.gestionar'), Cotizacion.enviarCorreo);
router.delete('/cotizaciones/:id', auth, requirePermission('cotizaciones.gestionar'), Cotizacion.eliminar);
router.get('/cotizaciones/:id/pdf', auth, requirePermission('cotizaciones.ver'), Pdf.cotizacionPDF);
router.get('/sucursales', auth, Sucursal.list);
router.put('/sucursales/:id', auth, requirePermission('config.gestionar'), Sucursal.update);

// Caja
router.get('/caja/actual', auth, requirePermission('caja.ver'), Caja.actual);
router.get('/caja/disponibles', auth, requirePermission('caja.ver'), Caja.disponibles);
router.get('/caja/abiertas', auth, requirePermission('caja.supervisar'), Caja.abiertas);
router.get('/caja/fisicas', auth, requirePermission('caja.supervisar'), Caja.fisicas);
router.put('/caja/fisicas/:id', auth, requirePermission('caja.supervisar'), Caja.actualizarFisica);
router.get('/caja/digital', auth, requirePermission('caja.supervisar'), Caja.digital);
router.get('/caja/web', auth, requirePermission('caja.supervisar'), Caja.web);
router.patch('/caja/digital/:id/conciliar', auth, requirePermission('caja.supervisar'), Caja.conciliarPago);
router.get('/caja', auth, requirePermission('caja.ver'), Caja.list);
router.post('/caja/abrir', auth, requirePermission('caja.operar'), Caja.abrir);
router.post('/caja/movimiento', auth, requirePermission('caja.operar'), Caja.movimiento);
router.post('/caja/cerrar', auth, requirePermission('caja.operar'), Caja.cerrar);
router.patch('/caja/:id/conciliar', auth, requirePermission('caja.supervisar'), Caja.conciliar);
router.get('/caja/:id/informe', auth, requirePermission('caja.ver'), Caja.informe);
router.get('/caja/:id', auth, requirePermission('caja.ver'), Caja.getOne);

// Reportes
router.get('/reportes/ventas', auth, requirePermission('reportes.ver'), Reporte.ventas);
router.get('/reportes/productos', auth, requirePermission('reportes.ver'), Reporte.productos);
router.get('/reportes/clientes', auth, requirePermission('reportes.ver'), Reporte.clientes);
router.get('/reportes/finanzas', auth, requirePermission('reportes.ver_finanzas'), Reporte.finanzas);
router.get('/reportes/cotizaciones', auth, requirePermission('reportes.ver'), Reporte.cotizaciones);
router.get('/reportes/logistica', auth, requirePermission('reportes.ver'), Reporte.logistica);
router.get('/reportes/inventario', auth, requirePermission('reportes.ver'), Reporte.inventario);
router.get('/reportes/comprobantes', auth, requirePermission('reportes.ver'), Reporte.comprobantes);
router.post('/reportes/exportar-pdf', auth, requirePermission('reportes.ver'), Reporte.exportarPdf);
router.get('/rentabilidad/resumen', auth, requirePermission('rentabilidad.ver'), Rentabilidad.resumen);


module.exports = router;
