'use strict';

const MODULES = [
  { slug:'dashboard', nombre:'Dashboard', icono:'ti-layout-dashboard', ruta:'/dashboard', orden:10 },
  { slug:'usuarios', nombre:'Usuarios', icono:'ti-users', ruta:'/usuarios', orden:20 },
  { slug:'perfiles', nombre:'Perfiles', icono:'ti-shield', ruta:'/perfiles', orden:30 },
  { slug:'productos', nombre:'Productos', icono:'ti-package', ruta:'/productos', orden:40 },
  { slug:'inventario', nombre:'Inventario', icono:'ti-clipboard-list', ruta:'/inventario', orden:50 },
  { slug:'ventas', nombre:'Ventas', icono:'ti-shopping-cart', ruta:'/ventas', orden:60 },
  { slug:'clientes', nombre:'Clientes', icono:'ti-user-circle', ruta:'/clientes', orden:70 },
  { slug:'verificacion-pagos', nombre:'Verificación de pagos', icono:'ti-credit-card', ruta:'/pagos', orden:80 },
  { slug:'apertura-caja', nombre:'Apertura de caja', icono:'ti-lock-open', ruta:'/apertura-caja', orden:90 },
  { slug:'cajas', nombre:'Cajas', icono:'ti-cash', ruta:'/cajas', orden:95 },
  { slug:'reportes', nombre:'Reportes financieros', icono:'ti-chart-bar', ruta:'/reportes', orden:100 },
  { slug:'config', nombre:'Gestión de empresa', icono:'ti-settings', ruta:'/config', orden:110 },
  { slug:'cotizaciones', nombre:'Cotizaciones', icono:'ti-file-text', ruta:'/cotizaciones', orden:120 },
  { slug:'recojo', nombre:'Recojo en tienda', icono:'ti-map-pin', ruta:'/recojo', orden:130 },
  { slug:'temporadas', nombre:'Temporadas', icono:'ti-gift', ruta:'/temporadas', orden:140 },
  { slug:'comprobantes', nombre:'Comprobantes', icono:'ti-receipt', ruta:'/comprobantes', orden:150 },
  { slug:'gestion-tienda', nombre:'Gestión Tienda', icono:'ti-building-store', ruta:'/tienda', orden:160 },
  { slug:'logistica', nombre:'Logística y reparto', icono:'ti-truck-delivery', ruta:'/logistica', orden:170 },
  { slug:'rentabilidad', nombre:'Rentabilidad', icono:'ti-chart-pie-2', ruta:'/rentabilidad', orden:180 }
];

const ALIASES = Object.freeze({
  apertura_caja: 'apertura-caja',
  caja: 'cajas',
  recojo_tienda: 'recojo',
  'recojo-en-tienda': 'recojo',
  gestion_tienda: 'gestion-tienda',
  verificacion_pagos: 'verificacion-pagos'
});

const MAP = new Map(MODULES.map(module => [module.slug, module]));
const HIDDEN_SLUGS = new Set(['presentaciones']);

function normalizeSlug(value) {
  const raw = String(value || '').trim().toLowerCase();
  return ALIASES[raw] || raw;
}

function normalizeOption(row = {}) {
  const slug = normalizeSlug(row.slug);
  const canonical = MAP.get(slug);
  return {
    ...row,
    slug,
    nombre: row.nombre || canonical?.nombre || slug,
    icono: row.icono || canonical?.icono || 'ti-circle',
    ruta: row.ruta || canonical?.ruta || `/${slug}`,
    orden: Number(row.orden ?? canonical?.orden ?? 999)
  };
}

function dedupeOptions(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const option = normalizeOption(row);
    if (!option.slug || HIDDEN_SLUGS.has(option.slug)) continue;
    const previous = map.get(option.slug);
    if (!previous || Number(option.id || 0) > 0) map.set(option.slug, option);
  }
  return [...map.values()].sort((a, b) => Number(a.orden) - Number(b.orden));
}

function globalOptions(rows = []) {
  const existing = dedupeOptions(rows);
  const map = new Map(existing.map(row => [row.slug, row]));
  for (const module of MODULES) {
    if (!map.has(module.slug)) map.set(module.slug, { ...module });
  }
  return [...map.values()].sort((a, b) => Number(a.orden) - Number(b.orden));
}

module.exports = { MODULES, ALIASES, normalizeSlug, normalizeOption, dedupeOptions, globalOptions };
