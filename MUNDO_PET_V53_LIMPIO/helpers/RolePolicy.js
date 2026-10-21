'use strict';

const ALL_GLOBAL = '*';

const ROLE_PERMISSIONS = {
  administrador: [
    'dashboard.ver',
    'ventas.ver','ventas.crear','ventas.anular','ventas.emitir',
    'cotizaciones.ver','cotizaciones.gestionar',
    'clientes.ver','clientes.gestionar',
    'comprobantes.ver',
    'productos.ver','productos.editar','productos.imagenes','productos.volumen',
    'inventario.ver','inventario.mover','inventario.ajustar','inventario.transferir',
    'caja.ver','caja.operar','caja.supervisar',
    'pedidos_web.ver','pedidos_web.aprobar_sucursal','pedidos_web.preparar','pedidos_web.entregar',
    'recojo.configurar',
    'logistica.ver','logistica.gestionar','logistica.operar',
    'reportes.ver','reportes.exportar',
    'usuarios.ver','usuarios.gestionar'
  ],
  vendedor: [
    'ventas.ver','ventas.crear',
    'cotizaciones.ver','cotizaciones.gestionar',
    'clientes.ver','clientes.gestionar',
    'productos.ver','inventario.ver',
    'caja.ver','caja.operar'
  ],
  cajero: [
    'ventas.ver','ventas.crear',
    'clientes.ver','productos.ver',
    'caja.ver','caja.operar'
  ],
  almacenero: [
    'productos.ver','inventario.ver','inventario.mover','inventario.ajustar',
    'logistica.ver','logistica.operar'
  ],
  supervisor: [
    'dashboard.ver','ventas.ver','cotizaciones.ver','clientes.ver','productos.ver','inventario.ver',
    'caja.ver','caja.supervisar','pedidos_web.ver','logistica.ver','reportes.ver'
  ],
  repartidor: [
    'logistica.ver','logistica.operar','pedidos_web.ver','pedidos_web.entregar'
  ]
};

const PERMISSION_MODULE = {
  dashboard: 'dashboard', ventas: 'ventas', cotizaciones: 'cotizaciones', clientes: 'clientes',
  comprobantes: 'comprobantes', productos: 'productos',
  inventario: 'inventario', caja: 'cajas', 'pedidos_web': 'verificacion-pagos',
  recojo: 'recojo', logistica: 'logistica', reportes: 'reportes', rentabilidad: 'rentabilidad',
  usuarios: 'usuarios', perfiles: 'perfiles', config: 'config', tienda: 'gestion-tienda'
};

const GLOBAL_ONLY_PREFIXES = ['perfiles.','config.','tienda.','rentabilidad.'];
const GLOBAL_ONLY_EXACT = new Set([
  'dashboard.ver_global','dashboard.ver_costos','dashboard.ver_finanzas',
  'reportes.ver_costos','reportes.ver_finanzas','inventario.transferir',
  'productos.crear','productos.ver_costo','pedidos_web.aprobar_multisucursal'
]);

function normalizeRole(name) {
  return String(name || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function moduleForPermission(slug) {
  return PERMISSION_MODULE[String(slug || '').split('.')[0]] || null;
}

function isGlobalOnly(slug) {
  return GLOBAL_ONLY_EXACT.has(slug) || GLOBAL_ONLY_PREFIXES.some(p => String(slug).startsWith(p));
}

function safePermissions({ isGlobal, roleName, visibleModules = [], allPermissions = [] }) {
  if (isGlobal) return allPermissions.slice();
  const role = normalizeRole(roleName);
  const key = Object.keys(ROLE_PERMISSIONS).find(k => role === k || role.startsWith(k + ' '));
  const baseline = new Set(key ? ROLE_PERMISSIONS[key] : []);
  const visible = new Set((visibleModules || []).map(String));
  if (visible.has('caja')) visible.add('cajas');

  return [...baseline].filter(slug => {
    if (isGlobalOnly(slug)) return false;
    const module = moduleForPermission(slug);
    if (module === 'cajas') return visible.has('cajas') || visible.has('apertura-caja');
    return !module || visible.has(module);
  });
}

module.exports = { ALL_GLOBAL, safePermissions, normalizeRole, moduleForPermission, isGlobalOnly };
