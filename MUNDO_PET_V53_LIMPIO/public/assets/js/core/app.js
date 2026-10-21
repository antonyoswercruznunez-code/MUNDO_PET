const LEGACY_ASSET_VERSION = '?v=52.0.0';
const _modulos = new Set();

const SessionLock = {
  locked: false,
  lockMinutes: 20,
  lastActivity: Date.now(),
  dirty: false,
  warningShown: false,
  channel: null,
  _ensureOverlay() {
    if (document.getElementById('session-lock-overlay')) return;
    const el = document.createElement('div');
    el.id = 'session-lock-overlay';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,.96);backdrop-filter:blur(15px);align-items:center;justify-content:center;padding:20px';
    el.innerHTML = `<form id="session-unlock-form" style="width:min(430px,100%);background:#fff;border-radius:18px;padding:30px;box-shadow:0 25px 80px rgba(0,0,0,.45);text-align:center;color:#0f172a">
      <div style="width:64px;height:64px;border-radius:18px;background:#dcfce7;color:#15803d;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px"><i class="ti ti-lock"></i></div>
      <h2 style="margin:0 0 7px">Sesión bloqueada</h2>
      <p style="color:#64748b;margin:0 0 20px">Por seguridad, vuelve a escribir tu contraseña para continuar.</p>
      <label for="session-unlock-password" style="display:block;text-align:left;font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">CONTRASEÑA</label>
      <input id="session-unlock-password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;outline:none">
      <div id="session-unlock-error" style="min-height:20px;color:#dc2626;font-size:13px;margin:8px 0"></div>
      <button id="session-unlock-btn" type="submit" style="width:100%;border:0;border-radius:10px;padding:12px;background:#16a34a;color:#fff;font-weight:800;cursor:pointer">Desbloquear</button>
      <button id="session-exit-btn" type="button" style="width:100%;border:0;background:transparent;color:#64748b;padding:12px;cursor:pointer">Cerrar sesión</button>
    </form>`;
    document.body.appendChild(el);
    const input = el.querySelector('#session-unlock-password');
    el.querySelector('#session-unlock-form').addEventListener('submit', e => { e.preventDefault(); this.unlock(); });
    el.querySelector('#session-exit-btn').addEventListener('click', () => this.logout());

  },
  init({ locked = false, lockMinutes = 20 } = {}) {
    this.lockMinutes = Number(lockMinutes) || 20;
    this.lastActivity = Date.now();
    this._ensureOverlay();
    try {
      this.channel = new BroadcastChannel('sv-session-lock');
      this.channel.onmessage = e => { if (e.data === 'lock') this.show(false); if (e.data === 'unlock') this.hide(false); };
    } catch (_) {}
    ['pointerdown','keydown','touchstart','wheel'].forEach(evt => document.addEventListener(evt, () => this.markActivity(), { passive:true }));
    window.addEventListener('storage', e => { if (e.key === 'sv-session-lock') e.newValue === 'locked' ? this.show(false) : this.hide(false); });
    setInterval(() => this.tick(), 15000);
    if (locked) this.show();
  },
  markActivity() {
    if (this.locked) return;
    this.lastActivity = Date.now();
    this.dirty = true;
    this.warningShown = false;
  },
  async tick() {
    if (this.locked) return;
    const idleMs = Date.now() - this.lastActivity;
    const lockMs = this.lockMinutes * 60000;
    if (idleMs >= lockMs) { this.show(); return; }
    if (idleMs >= Math.max(60000, lockMs - 5*60000) && !this.warningShown) {
      this.warningShown = true;
      if (window.Swal) Swal.fire({toast:true,position:'top-end',timer:5000,showConfirmButton:false,icon:'warning',title:'La sesión se bloqueará pronto por inactividad'});
    }
    if (this.dirty) {
      this.dirty = false;
      const res = await fetch('/api/auth/activity', { method:'POST', credentials:'include', headers:{'X-CSRF-Token':window._csrfToken || ''} });
      if (res.status === 423) this.show();
      if (res.status === 401) window.location.href='/login';
    }
  },
  show(broadcast = true) {
    this.locked = true;
    this._ensureOverlay();
    const el = document.getElementById('session-lock-overlay');
    el.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('session-unlock-password')?.focus(), 80);
    if (broadcast) { try { this.channel?.postMessage('lock'); localStorage.setItem('sv-session-lock','locked'); } catch(_){} }
  },
  hide(broadcast = true) {
    this.locked = false;
    this.lastActivity = Date.now();
    this.dirty = false;
    this.warningShown = false;
    const el = document.getElementById('session-lock-overlay');
    if (el) el.style.display = 'none';
    document.body.style.overflow = '';
    const input = document.getElementById('session-unlock-password'); if (input) input.value='';
    const err = document.getElementById('session-unlock-error'); if(err) err.textContent='';
    if (broadcast) { try { this.channel?.postMessage('unlock'); localStorage.setItem('sv-session-lock','unlocked'); } catch(_){} }
  },
  async unlock() {
    const password = document.getElementById('session-unlock-password')?.value || '';
    const btn = document.getElementById('session-unlock-btn');
    const err = document.getElementById('session-unlock-error');
    if (!password) { err.textContent='Ingresa tu contraseña'; return; }
    btn.disabled=true; btn.textContent='Verificando...'; err.textContent='';
    try {
      const r = await fetch('/api/auth/unlock',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':window._csrfToken||''},body:JSON.stringify({password})});
      const d = await r.json().catch(()=>({}));
      if (!d.ok) { err.textContent=d.msg||'No se pudo desbloquear'; return; }
      this.hide();
    } finally { btn.disabled=false; btn.textContent='Desbloquear'; }
  },
  async logout() {
    await fetch('/api/auth/logout',{method:'POST',credentials:'include',headers:{'X-CSRF-Token':window._csrfToken||''}}).catch(()=>null);
    window.location.href='/login';
  }
};
window.SessionLock = SessionLock;


function cargarModulo(ruta, initFn) {
  return new Promise((resolve, reject) => {
    const ejecutarInit = () => {
      const fn = window[initFn];
      if (typeof fn !== 'function') {
        reject(new Error(`El módulo cargó, pero no existe ${initFn}().`));
        return;
      }
      try {
        Promise.resolve(fn()).then(resolve).catch(reject);
      } catch (error) {
        reject(error);
      }
    };

    if (_modulos.has(ruta)) {
      ejecutarInit();
      return;
    }

    const anterior = document.querySelector(`script[data-modulo="${ruta}"]`);
    if (anterior) anterior.remove();

    const s = document.createElement('script');
    s.src = ruta + '?v=52.0.0&build=52';
    s.async = true;
    s.dataset.modulo = ruta;
    s.onload = () => {
      _modulos.add(ruta);
      ejecutarInit();
    };
    s.onerror = () => {
      s.remove();
      reject(new Error(`No se pudo descargar ${ruta}. Revisa que el archivo exista y que el servidor esté activo.`));
    };
    document.body.appendChild(s);
  });
}

// bdSlug  = slug en la BD (lo que devuelve /api/auth/session)
// navSlug = slug que usa Router.navegar() y cargarModulo()
// Cuando son iguales, navSlug repite bdSlug.
const GRUPOS = [
  {
    solo: true,
    items: [
      { bdSlug: 'dashboard',        navSlug: 'dashboard',      icono: 'ti-layout-dashboard', nombre: 'Dashboard' }
    ]
  },
  {
    titulo: 'Ventas & Cotizaciones',
    items: [
      { bdSlug: 'ventas',           navSlug: 'ventas',         icono: 'ti-shopping-cart',  nombre: 'Ventas'             },
      { bdSlug: 'cotizaciones',     navSlug: 'cotizaciones',   icono: 'ti-file-text',      nombre: 'Cotizaciones'       },
      { bdSlug: 'verificacion-pagos', navSlug: 'pagos',        icono: 'ti-credit-card',    nombre: 'Verificación Pagos' },
      { bdSlug: 'comprobantes',     navSlug: 'comprobantes',   icono: 'ti-receipt',        nombre: 'Comprobantes'       },
    ]
  },
  {
    titulo: 'Caja',
    items: [
      // Vendedor: inicia su turno desde aquí. Solo abre una caja disponible.
      { bdSlug: 'apertura-caja', navSlug: 'apertura-caja', icono: 'ti-lock-open', nombre: 'Apertura de caja' },
      // Cajas conserva el control e historial. El vendedor ve solo su propia sesión;
      // los administradores ven quién está operando y el historial de su alcance.
      { bdSlug: 'cajas', navSlug: 'cajas', icono: 'ti-cash', nombre: 'Cajas' },
    ]
  },
  {
    titulo: 'Almacén',
    items: [
      { bdSlug: 'productos',        navSlug: 'productos',      icono: 'ti-package',        nombre: 'Productos'      },
      { bdSlug: 'inventario',       navSlug: 'inventario',     icono: 'ti-clipboard-list', nombre: 'Inventario'     },
    ]
  },
  {
    titulo: 'Cliente',
    items: [
      { bdSlug: 'clientes',         navSlug: 'clientes',       icono: 'ti-user-circle',    nombre: 'Clientes'  },
    ]
  },
  {
    titulo: 'Distribución',
    items: [
      { bdSlug: 'logistica',        navSlug: 'logistica',      icono: 'ti-truck-delivery', nombre: 'Logística y Reparto' },
    ]
  },
  {
    titulo: 'Reportes',
    items: [
      { bdSlug: 'reportes',         navSlug: 'reportes',       icono: 'ti-chart-bar',      nombre: 'Reportes'  },
      { bdSlug: 'rentabilidad',     navSlug: 'rentabilidad',   icono: 'ti-chart-pie-2',    nombre: 'Rentabilidad' },
    ]
  },
  {
    titulo: 'Tienda Web',
    items: [
      { bdSlug: 'gestion-tienda',   navSlug: 'tienda',         icono: 'ti-building-store',           nombre: 'Gestión Tienda'   },
      { bdSlug: 'recojo',           navSlug: 'recojo',         icono: 'ti-map-pin',                  nombre: 'Recojo en Tienda' },
      { bdSlug: 'temporadas',       navSlug: 'temporadas',     icono: 'ti-gift',                     nombre: 'Temporadas'       },
    ]
  },
  {
    titulo: 'Relación con clientes',
    items: [
    ]
  },
  {
    titulo: 'Administración',
    items: [
      { bdSlug: 'usuarios',         navSlug: 'usuarios',       icono: 'ti-users',          nombre: 'Usuarios'      },
      { bdSlug: 'perfiles',         navSlug: 'perfiles',       icono: 'ti-shield',         nombre: 'Perfiles'      },
      { bdSlug: 'config',           navSlug: 'config',         icono: 'ti-settings',       nombre: 'Configuración' },
    ]
  },
];

function perfilActual() {
  return String(window._usuario?.perfil_nombre || '').trim().toLocaleLowerCase('es-PE');
}

function esVendedorActual() {
  const perfil = perfilActual();
  return perfil === 'vendedor' || perfil.startsWith('vendedor ');
}

function esAdministradorActual() {
  const perfil = perfilActual();
  return perfil === 'administrador' || perfil.startsWith('administrador ');
}

function construirSidebar(opciones) {
  const nav = document.getElementById('sidebar-nav');
  const permitido = new Set((opciones || []).map(o => o.slug));
  if (permitido.has('caja')) permitido.add('cajas');
  if (permitido.has('apertura_caja')) permitido.add('apertura-caja');
  nav.innerHTML = '';
  let primerModulo = null;

  GRUPOS.forEach(grupo => {
    const visibles = grupo.items.filter(it => permitido.has(it.bdSlug));
    if (!visibles.length) return;
    if (!grupo.solo && grupo.titulo) {
      const div = document.createElement('div');
      div.className = 'nav-group-title';
      div.innerHTML = `<span>${grupo.titulo}</span>`;
      nav.appendChild(div);
    }
    visibles.forEach(op => {
      if (!primerModulo) primerModulo = op.navSlug;
      const a = document.createElement('a');
      a.className = 'nav-item';
      a.dataset.slug = op.navSlug;
      a.href = '#';
      a.innerHTML = `<i class="nav-icon ti ${op.icono}"></i><span class="nav-text">${op.nombre}</span>`;
      a.addEventListener('click', e => { e.preventDefault(); Router.navegar(op.navSlug); });
      nav.appendChild(a);
    });
  });
  return primerModulo;
}

document.addEventListener('DOMContentLoaded', async () => {
  const res  = await fetch('/api/auth/session', { credentials: 'include' });
  const data = await res.json();
  if (!data.ok) { window.location.href = '/login'; return; }

  const { usuario, opciones, permisos = [], csrfToken, locked, lockMinutes } = data;
  window._usuario  = usuario;
  window._esGlobal = !!usuario.es_global;
  window._permisos = new Set(permisos);
  // Compatibilidad visual: "_esAdmin" significa usuario con permisos de gestión,
  // no un nombre de perfil fijo. El backend sigue validando cada acción.
  window._esAdmin  = window._esGlobal
    || window._permisos.has('usuarios.gestionar')
    || window._permisos.has('perfiles.gestionar')
    || window._permisos.has('config.gestionar');
  window._csrfToken = csrfToken;

  document.getElementById('topbar-avatar').textContent = (usuario.nombre || 'A')[0].toUpperCase();
  document.getElementById('topbar-nombre').textContent = usuario.nombre;
  window.MPTracking?.init();
  document.getElementById('topbar-perfil').textContent = usuario.perfil_nombre;

  try {
    const ld = await fetch('/api/publico/logo').then(r => r.json());
    const bi = document.getElementById('brand-icon');
    if (ld.ok && ld.ruta && bi) bi.innerHTML = `<img src="${ld.ruta}" alt="logo">`;
  } catch(e) {}

  const primerModuloPermitido = construirSidebar(opciones);

  const sidebar = document.getElementById('sidebar');
  const topbar  = document.getElementById('topbar');
  const main    = document.getElementById('main');

  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    topbar.classList.toggle('expanded');
    main.classList.toggle('expanded');
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    const conf = await Swal.fire({
      title: '¿Cerrar sesión?', icon: 'question',
      showCancelButton: true, confirmButtonText: 'Sí, salir', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0EA5E9', background: '#0B1E2D', color: '#e2e8f0'
    });
    if (!conf.isConfirmed) return;
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: {'X-CSRF-Token': window._csrfToken || ''} });
    window.location.href = '/login';
  });

  Router.registrar({
    'dashboard':      () => cargarModulo('/assets/js/pages/dashboard.js',      'init_dashboard'),
    'usuarios':       () => cargarModulo('/assets/js/pages/usuarios.js',       'init_usuarios'),
    'perfiles':       () => cargarModulo('/assets/js/pages/perfiles.js',       'init_perfiles'),
    'productos':      () => cargarModulo('/assets/js/pages/productos.js',      'init_productos'),
    'clientes':       () => cargarModulo('/assets/js/pages/clientes.js',       'init_clientes'),
    'inventario':     () => cargarModulo('/assets/js/pages/inventario.js',     'init_inventario'),
    'ventas':         () => cargarModulo('/assets/js/pages/ventas.js',         'init_ventas'),
    'cotizaciones':   () => cargarModulo('/assets/js/pages/cotizaciones.js',   'init_cotizaciones'),
    'pagos':          () => cargarModulo('/assets/js/pages/pagos.js',          'init_pagos'),
    'comprobantes':   () => cargarModulo('/assets/js/pages/comprobantes.js',   'init_comprobantes'),
    'apertura-caja': () => cargarModulo('/assets/js/pages/apertura-caja.js',  'init_apertura_caja'),
    'cajas':          () => cargarModulo('/assets/js/pages/cajas.js',          'init_cajas'),
    'tienda':         () => cargarModulo('/assets/js/pages/tienda.js',         'init_tienda'),
    'recojo':         () => cargarModulo('/assets/js/pages/recojo.js',         'init_recojo'),
    'temporadas':     () => cargarModulo('/assets/js/pages/temporadas.js',     'init_temporadas'),
    'config':         () => cargarModulo('/assets/js/pages/config.js',         'init_config'),
    'reportes':       () => cargarModulo('/assets/js/pages/reportes.js',       'init_reportes'),
    'rentabilidad':  () => cargarModulo('/assets/js/pages/rentabilidad.js',  'init_rentabilidad'),
    'logistica':      () => cargarModulo('/assets/js/pages/logistica.js',      'init_logistica'),
    
  });

  SessionLock.init({ locked, lockMinutes });
  await Router.navegar(primerModuloPermitido || 'ventas');
});