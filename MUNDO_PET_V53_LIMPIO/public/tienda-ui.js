/*
 * Capa visual de la tienda: portada, listados, página de producto, menú,
 * carrito y cuenta. Sustituye las funciones de presentación de tienda-app.js;
 * la lógica de precios, checkout y sesión sigue viviendo allí.
 *
 * Direcciones limpias (se pueden compartir y funciona "atrás"):
 *   /tienda                    portada
 *   /tienda/ofertas            productos con descuento
 *   /tienda/mas-vendidos       ranking de ventas
 *   /tienda/todos              catálogo completo
 *   /tienda/sucursal/ID        productos de un local
 *   /tienda/buscar/texto       resultados de búsqueda
 *   /tienda/producto/ID        página del producto
 */
(function () {
  const money = value => `S/ ${Number(value || 0).toFixed(2)}`;
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BRANCH_ICONS = ['ti-flame', 'ti-droplet', 'ti-fish', 'ti-paw', 'ti-building-store', 'ti-package'];

  const base = {
    setQty: Tienda.setQty, delCart: Tienda.delCart, vaciarCarrito: Tienda.vaciarCarrito,
    afterLogin: Tienda.afterLogin, logout: Tienda.logout, cerrarTodo: Tienda.cerrarTodo
  };

  // Una foto que no carga se reemplaza por el ícono de la marca.
  document.addEventListener('error', event => {
    const img = event.target;
    if (img?.tagName !== 'IMG' || !img.closest('.rc-card-media, .rc-pd-media, .rc-pd-thumbs, .st-ci-img, .rc-sg-img, .rc-branch-ico')) return;
    const icon = document.createElement('i');
    icon.className = 'ti ti-paw rc-noimg';
    img.replaceWith(icon);
  }, true);

  const pct = p => {
    const normal = Number(p.precio_venta || 0), final = Number(p.precio_final || 0);
    if (!(normal > 0 && final < normal)) return 0;
    return Math.round(Number(p.descuento_aplicado) || ((normal - final) / normal) * 100);
  };
  const isOut = p => Number(p.stock_disponible || 0) <= 0;

  Object.assign(Tienda, {
    _items: {},
    _productos: [],

    async init() {
      try { this.cart = JSON.parse(localStorage.getItem('mp_cart') || '[]'); } catch (_) { this.cart = []; }
      this.updateCartBadge();
      document.getElementById('foot-year').textContent = new Date().getFullYear();

      const header = document.getElementById('st-header');
      const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 4);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();

      await this.cargarConfig();
      await this.cargarProductos();
      await this.repriceCart({ silent: true });
      await this.checkSession();
      this.route();
      window.addEventListener('popstate', () => this.route());
      // Los enlaces internos cambian de vista sin recargar la página.
      document.addEventListener('click', event => {
        const link = event.target.closest('a[href^="/tienda"]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || link.target === '_blank') return;
        event.preventDefault();
        this.go(link.getAttribute('href'));
      });

      document.getElementById('brand').onclick = event => { event.preventDefault(); this.go('/tienda'); };
      document.getElementById('search-form').onsubmit = event => {
        event.preventDefault();
        const text = document.getElementById('buscador').value.trim();
        this.ocultarSugerencias();
        this.go(text ? `/tienda/buscar/${encodeURIComponent(text)}` : '/tienda/todos');
      };
      let timer;
      const input = document.getElementById('buscador');
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => this.sugerir(input.value), 160); });
      input.addEventListener('focus', () => { if (input.value.trim()) this.sugerir(input.value); });
      document.getElementById('orden').onchange = () => this.route();
      document.getElementById('btn-cart').onclick = () => this.abrirCarrito();
      document.getElementById('btn-menu').onclick = () => this.abrirMenu();
      document.getElementById('btn-user').onclick = event => { event.stopPropagation(); this.cliente ? this.menuUsuario() : this.abrirAuth(); };
      document.addEventListener('click', event => {
        if (!event.target.closest('#st-menu-host')) this.cerrarMenu();
        if (!event.target.closest('#search-form')) this.ocultarSugerencias();
      });
      document.addEventListener('keydown', event => { if (event.key === 'Escape') { this.cerrarMenu(); this.cerrarModal(); this.cerrarTodo(); this.ocultarSugerencias(); } });
    },

    // La barra de direcciones se queda siempre en /tienda (como el panel en
    // /dashboard). La vista actual vive en el historial del navegador, así
    // el botón "atrás" sigue funcionando entre vistas.
    go(path) {
      if (this.currentPath() !== path) history.pushState({ vista: path }, '', '/tienda');
      this.route();
    },
    currentPath() { return history.state?.vista || '/tienda'; },

    // ── Configuración, franja verde y pie ──
    async cargarConfig() {
      try {
        const d = await (await fetch(`${API}/config`)).json();
        if (!d.ok) return;
        this.cfg = d;
        document.title = `${d.nombre} — Tienda`;
        document.getElementById('brand-name').textContent = d.nombre;
        document.getElementById('foot-nombre').textContent = d.nombre;
        document.getElementById('foot-desc').textContent = d.descripcion || '';
        if (d.logo) {
          document.getElementById('brand-logo').innerHTML = `<img src="${this.esc(d.logo)}" alt="">`;
          document.getElementById('foot-logo').innerHTML = `<img src="${this.esc(d.logo)}" alt="">`;
        }

        // Franja verde: mensajes que rotan.
        const notes = [];
        const free = Number(d.delivery?.gratis_desde || 0);
        if (d.delivery_activo && this.usaZonasDelivery()) notes.push(`<i class="ti ti-truck-delivery"></i>${free > 0 ? `Envío gratis en compras desde ${money(free)}` : 'Delivery a domicilio'}`);
        if (d.recojo_activo) notes.push('<i class="ti ti-building-store"></i>Recoge tu pedido en tienda sin costo');
        if (d.horario) notes.push(`<i class="ti ti-clock"></i>${this.esc(d.horario)}`);
        if (!notes.length) notes.push(this.esc(d.descripcion || `Bienvenido a ${d.nombre}`));
        const strip = document.getElementById('st-strip').firstElementChild;
        strip.innerHTML = notes.map((n, i) => `<span class="${i === 0 ? 'on' : ''}">${n}</span>`).join('');
        clearInterval(this._noteTimer);
        if (notes.length > 1 && !reduceMotion()) {
          let k = 0;
          this._noteTimer = setInterval(() => {
            const items = strip.children; items[k].classList.remove('on'); k = (k + 1) % items.length; items[k].classList.add('on');
          }, 4200);
        }

        const contact = [];
        if (d.whatsapp) contact.push(`<li><i class="ti ti-phone"></i><a href="https://wa.me/${d.whatsapp.replace(/\D/g, '')}" target="_blank" rel="noopener">${this.esc(d.whatsapp)}</a></li>`);
        if (d.email) contact.push(`<li><i class="ti ti-mail"></i><a href="mailto:${this.esc(d.email)}">${this.esc(d.email)}</a></li>`);
        if (d.direccion) contact.push(`<li><i class="ti ti-map-pin"></i><span>${this.esc(d.direccion)}</span></li>`);
        if (d.horario) contact.push(`<li><i class="ti ti-clock"></i><span>${this.esc(d.horario)}</span></li>`);
        const contactHost = document.getElementById('foot-contacto');
        contactHost.innerHTML = contact.join('');
        contactHost.closest('div').hidden = !contact.length;
        const social = [];
        if (d.facebook) social.push(`<a href="${this.esc(d.facebook)}" target="_blank" rel="noopener" aria-label="Facebook"><i class="ti ti-brand-facebook"></i></a>`);
        if (d.instagram) social.push(`<a href="${this.esc(d.instagram)}" target="_blank" rel="noopener" aria-label="Instagram"><i class="ti ti-brand-instagram"></i></a>`);
        if (d.whatsapp) social.push(`<a href="https://wa.me/${d.whatsapp.replace(/\D/g, '')}" target="_blank" rel="noopener" aria-label="WhatsApp"><i class="ti ti-brand-whatsapp"></i></a>`);
        document.getElementById('foot-social').innerHTML = social.join('');
        document.getElementById('foot-social-col').hidden = !social.length;

        this.renderSlider(d.sliders || []);
        this.renderCuentaPie();
        if (d.google_client_id) this.initGoogle(d.google_client_id);
      } catch (error) { console.error(error); }
    },

    // ── Banner principal ──
    renderSlider(sliders) {
      const slides = document.getElementById('slides');
      const dots = document.getElementById('slider-dots');
      const hero = document.getElementById('slider');
      this.slideCount = sliders.length;
      this.slideIndex = 0;
      hero.classList.toggle('is-brand', !sliders.length);
      if (!sliders.length) {
        hero.querySelectorAll('.rc-hero-nav').forEach(node => { node.hidden = true; });
        dots.innerHTML = '';
        slides.innerHTML = `<div class="rc-hero-brand"><div class="rc-wrap">
            <div class="rc-hero-copy">
              <h1>${this.esc(this.cfg?.nombre || 'Mundo Pet')}</h1>
              ${this.cfg?.descripcion ? `<p>${this.esc(this.cfg.descripcion)}</p>` : ''}
              <div class="rc-hero-ctas"><a class="rc-btn light" href="/tienda/todos">Ver productos <i class="ti ti-arrow-right"></i></a><a class="rc-btn ghost" href="/tienda/ofertas">Ofertas</a></div>
            </div>
            <i class="ti ti-paw rc-hero-mark" aria-hidden="true"></i>
          </div></div>`;
        return;
      }
      slides.innerHTML = sliders.map((s, i) => `<div class="rc-slide ${i === 0 ? 'on' : ''}"><img src="${this.esc(s.ruta)}" alt="${this.esc(s.nombre || '')}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}></div>`).join('');
      dots.innerHTML = sliders.length > 1 ? sliders.map((_, i) => `<button class="${i === 0 ? 'on' : ''}" aria-label="Imagen ${i + 1}" onclick="Tienda.goSlide(${i})"></button>`).join('') : '';
      hero.querySelectorAll('.rc-hero-nav').forEach(node => { node.hidden = sliders.length < 2; });
      hero.onmouseenter = () => clearInterval(this.slideTimer);
      hero.onmouseleave = () => this.startSlider();
      let startX = null;
      hero.ontouchstart = event => { startX = event.touches[0].clientX; };
      hero.ontouchend = event => {
        if (startX === null) return;
        const dx = event.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 40) dx < 0 ? this.slideNext() : this.slidePrev();
        startX = null;
      };
      this.startSlider();
    },
    startSlider() {
      clearInterval(this.slideTimer);
      if (this.slideCount > 1 && !reduceMotion()) this.slideTimer = setInterval(() => this.goSlide((this.slideIndex + 1) % this.slideCount), 5500);
    },
    goSlide(index) {
      this.slideIndex = index;
      document.querySelectorAll('#slides .rc-slide').forEach((node, i) => node.classList.toggle('on', i === index));
      document.querySelectorAll('#slider-dots button').forEach((node, i) => node.classList.toggle('on', i === index));
    },
    slideNext() { if (this.slideCount > 1) { this.goSlide((this.slideIndex + 1) % this.slideCount); this.startSlider(); } },
    slidePrev() { if (this.slideCount > 1) { this.goSlide((this.slideIndex - 1 + this.slideCount) % this.slideCount); this.startSlider(); } },

    // ── Datos ──
    async cargarProductos() {
      try {
        const d = await (await fetch(`${API}/productos`)).json();
        this._productos = d.ok ? d.productos : [];
        this._error = !d.ok;
      } catch (_) {
        this._productos = [];
        this._error = true;
      }
      this._productos.forEach(p => this.recordar(p));
      this._branches = [...new Map(this._productos.map(p => [Number(p.sucursal_id), p.sucursal_nombre || 'Productos'])).entries()];
      this.renderMenu();
    },
    recordar(p) {
      this._items[Number(p.id)] = {
        id: Number(p.id), nombre: p.nombre, precio: Number(p.precio_final), precio_normal: Number(p.precio_venta || p.precio_final),
        imagen: p.imagen || '', sucursal_id: Number(p.sucursal_id), sucursal_nombre: p.sucursal_nombre || '', stock: Number(p.stock_disponible || 0)
      };
    },
    ofertas() { return this._productos.filter(p => pct(p) > 0); },
    masVendidos() {
      const sold = this._productos.filter(p => Number(p.vendidos) > 0).sort((a, b) => Number(isOut(a)) - Number(isOut(b)) || b.vendidos - a.vendidos);
      return sold.length >= 4 ? sold : [...sold, ...this._productos.filter(p => !(Number(p.vendidos) > 0) && !isOut(p))];
    },

    // ── Navegación ──
    route() {
      // Un enlace antiguo (/tienda#/producto/7 o /tienda/producto/7) abre esa
      // vista y la dirección vuelve a quedar en /tienda.
      if (!history.state?.vista) {
        const legacy = location.hash.startsWith('#/') ? location.hash.slice(1) : location.pathname.replace(/^\/(tienda|web)/, '');
        history.replaceState({ vista: `/tienda${legacy && legacy !== '/' ? legacy.replace(/\/+$/, '') : ''}` }, '', '/tienda');
      } else if (location.pathname !== '/tienda' || location.hash) {
        history.replaceState(history.state, '', '/tienda');
      }
      const parts = this.currentPath().replace(/^\/tienda\/?/, '').split('/');
      const view = parts[0] || '', arg = parts.slice(1).join('/');
      const show = id => ['view-home', 'view-list', 'view-detail'].forEach(v => { document.getElementById(v).hidden = v !== id; });
      const key = `${view}/${arg}`;
      const changed = this._route !== key;
      this._route = key;
      this.cerrarTodo();
      if (view !== 'producto' && this.cfg?.nombre) document.title = `${this.cfg.nombre} — Tienda`;
      if (view === 'producto') { show('view-detail'); this.verProducto(Number(arg)); }
      else if (['ofertas', 'mas-vendidos', 'todos', 'sucursal', 'buscar'].includes(view)) { show('view-list'); this.renderLista(view, decodeURIComponent(arg)); }
      else { show('view-home'); this.renderHome(); }
      if (changed) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
      document.querySelectorAll('#menu-body a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === this.currentPath()));
    },

    // ── Portada ──
    renderHome() {
      const home = document.getElementById('st-home');
      if (this._error) { home.innerHTML = this.vacio('cloud-off', 'No pudimos cargar los productos', 'Revisa tu conexión y vuelve a intentarlo.'); return; }
      if (!this._productos.length) { home.innerHTML = this.vacio('package-off', 'Pronto tendremos productos', ''); return; }
      const sections = [];
      const top = this.masVendidos();
      if (top.length) sections.push(this.railHTML({ title: 'Los más vendidos', products: top, link: '/tienda/mas-vendidos', linkText: 'Ver todos' }));
      const deals = this.ofertas();
      if (deals.length) sections.push(this.railHTML({ title: 'Ofertas de la semana', products: deals, link: '/tienda/ofertas', linkText: 'Descuentos', hot: true }));
      if (this._branches.length > 1) sections.push(this.branchesHTML());
      this._branches.forEach(([id, nombre]) => sections.push(this.railHTML({ title: nombre, products: this._productos.filter(p => Number(p.sucursal_id) === id), link: `/tienda/sucursal/${id}`, linkText: 'Ver todos' })));
      home.innerHTML = sections.join('');
      this.activarCarruseles();
      this.revelar();
      this.refrescarControles();
    },
    branchesHTML() {
      return `<section class="rc-section rc-reveal"><div class="rc-section-head"><h2 class="rc-title">Compra por tienda</h2></div>
        <div class="rc-branches">${this._branches.map(([id, nombre], i) => {
          const list = this._productos.filter(p => Number(p.sucursal_id) === id);
          const img = list.find(p => p.imagen)?.imagen;
          return `<a class="rc-branch" href="/tienda/sucursal/${id}">
            <span class="rc-branch-ico">${img ? `<img src="${this.esc(img)}" alt="" loading="lazy">` : `<i class="ti ${BRANCH_ICONS[i % BRANCH_ICONS.length]}"></i>`}</span>
            <span><b>${this.esc(nombre)}</b><small>${list.length} ${list.length === 1 ? 'producto' : 'productos'}</small></span>
            <i class="ti ti-chevron-right"></i></a>`;
        }).join('')}</div></section>`;
    },
    railHTML({ title, products, link, linkText, hot = false }) {
      if (!products.length) return '';
      return `<section class="rc-section rc-reveal">
        <div class="rc-section-head"><h2 class="rc-title">${this.esc(title)}</h2>
          ${link ? `<a class="${hot ? 'rc-hot' : 'rc-more'}" href="${link}">${hot ? '<i class="ti ti-flame"></i>' : ''}${this.esc(linkText)}${hot ? '' : ' <i class="ti ti-arrow-right"></i>'}</a>` : ''}</div>
        <div class="rc-rail-box">
          <button class="rc-rail-btn prev" aria-label="Anterior" hidden><i class="ti ti-chevron-left"></i></button>
          <div class="rc-rail">${products.slice(0, 16).map((p, i) => this.cardHTML(p, i)).join('')}</div>
          <button class="rc-rail-btn next" aria-label="Siguiente"><i class="ti ti-chevron-right"></i></button>
        </div>
      </section>`;
    },
    activarCarruseles(scope = document) {
      scope.querySelectorAll('.rc-rail-box').forEach(box => {
        const rail = box.querySelector('.rc-rail');
        const prev = box.querySelector('.prev'), next = box.querySelector('.next');
        const sync = () => {
          prev.hidden = rail.scrollLeft < 8;
          next.hidden = rail.scrollLeft + rail.clientWidth > rail.scrollWidth - 8;
        };
        const step = dir => rail.scrollBy({ left: dir * rail.clientWidth * 0.9, behavior: 'smooth' });
        prev.onclick = () => step(-1);
        next.onclick = () => step(1);
        rail.addEventListener('scroll', sync, { passive: true });
        requestAnimationFrame(sync);
      });
    },

    // ── Listados ──
    renderLista(view, arg) {
      const orden = document.getElementById('orden').value;
      let list = this._productos, title = 'Todos los productos', crumb = 'Productos';
      if (view === 'ofertas') { list = this.ofertas(); title = 'Ofertas de la semana'; crumb = 'Ofertas'; }
      if (view === 'mas-vendidos') { list = this.masVendidos(); title = 'Los más vendidos'; crumb = 'Más vendidos'; }
      if (view === 'sucursal') {
        list = this._productos.filter(p => String(p.sucursal_id) === String(arg));
        title = this._branches.find(([id]) => String(id) === String(arg))?.[1] || 'Productos';
        crumb = title;
      }
      if (view === 'buscar') {
        const q = arg.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        list = this._productos.filter(p => [p.nombre, p.marca, p.descripcion, p.sucursal_nombre].some(t => norm(t).includes(q)));
        title = `Resultados para “${arg}”`; crumb = 'Búsqueda';
        document.getElementById('buscador').value = arg;
      }
      const sorters = {
        mas_vendidos: (a, b) => b.vendidos - a.vendidos,
        precio_asc: (a, b) => a.precio_final - b.precio_final,
        precio_desc: (a, b) => b.precio_final - a.precio_final,
        nombre: (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')
      };
      list = [...list].sort((a, b) => Number(isOut(a)) - Number(isOut(b)) || (sorters[orden] ? sorters[orden](a, b) : 0));
      document.getElementById('list-crumbs').innerHTML = `<a href="/tienda">Inicio</a><i class="ti ti-chevron-right"></i><span>${this.esc(crumb)}</span>`;
      document.getElementById('section-title').textContent = title;
      document.getElementById('list-count').textContent = `${list.length} ${list.length === 1 ? 'producto' : 'productos'}`;
      const chips = [['/tienda/todos', 'Todos'], ['/tienda/ofertas', 'Ofertas'], ['/tienda/mas-vendidos', 'Más vendidos'], ...this._branches.map(([id, n]) => [`/tienda/sucursal/${id}`, n])];
      document.getElementById('list-chips').innerHTML = chips.map(([href, label]) => `<a class="rc-chip ${this.currentPath() === href ? 'on' : ''}" href="${href}">${this.esc(label)}</a>`).join('');
      document.getElementById('grid').innerHTML = list.length
        ? list.map((p, i) => this.cardHTML(p, i)).join('')
        : this.vacio(view === 'buscar' ? 'search-off' : 'package-off', view === 'buscar' ? 'No encontramos productos' : 'No hay productos aquí', view === 'buscar' ? 'Prueba con otra palabra o revisa la ortografía.' : '');
      this.revelar();
      this.refrescarControles();
    },
    vacio(icon, title, text) {
      return `<div class="rc-empty"><i class="ti ti-${icon}"></i><b>${this.esc(title)}</b>${text ? `<span>${this.esc(text)}</span>` : ''}<a class="rc-btn" href="/tienda/todos">Ver todos los productos</a></div>`;
    },

    // ── Buscador con sugerencias ──
    sugerir(text) {
      const box = document.getElementById('suggest');
      const q = String(text || '').trim().toLowerCase();
      if (q.length < 2) return this.ocultarSugerencias();
      const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const nq = norm(q);
      const hits = this._productos.filter(p => norm(p.nombre).includes(nq) || norm(p.marca).includes(nq)).slice(0, 6);
      box.innerHTML = hits.length
        ? hits.map(p => `<a href="/tienda/producto/${Number(p.id)}" role="option"><span class="rc-sg-img">${p.imagen ? `<img src="${this.esc(p.imagen)}" alt="">` : '<i class="ti ti-paw"></i>'}</span><span class="rc-sg-name">${this.esc(p.nombre)}<small>${this.esc(p.sucursal_nombre || '')}</small></span><b>${money(p.precio_final)}</b></a>`).join('')
          + `<button type="submit" class="rc-sg-all">Ver todos los resultados <i class="ti ti-arrow-right"></i></button>`
        : `<div class="rc-sg-none">Sin coincidencias para “${this.esc(text.trim())}”</div>`;
      box.hidden = false;
      box.querySelectorAll('a').forEach(a => a.addEventListener('click', () => this.ocultarSugerencias()));
    },
    ocultarSugerencias() { const box = document.getElementById('suggest'); if (box) box.hidden = true; },

    // ── Tarjeta ──
    cardHTML(p, index = 0) {
      const id = Number(p.id);
      const off = pct(p);
      const stock = Number(p.stock_disponible || 0);
      const out = stock <= 0;
      const sub = [p.marca, p.unidad && p.unidad !== 'unidad' ? p.unidad : ''].filter(Boolean).join(' · ') || p.sucursal_nombre || '';
      return `<article class="rc-card rc-reveal${out ? ' is-out' : ''}" style="--d:${Math.min(index, 10)}">
        <a class="rc-card-media" href="/tienda/producto/${id}" aria-label="${this.esc(p.nombre)}">
          ${off > 0 ? `<span class="rc-off">-${off}%</span>` : ''}
          ${p.imagen ? `<img src="${this.esc(p.imagen)}" alt="" loading="lazy">` : '<i class="ti ti-paw rc-noimg"></i>'}
        </a>
        <div class="rc-card-body">
          <a class="rc-card-name" href="/tienda/producto/${id}">${this.esc(p.nombre)}</a>
          ${sub ? `<div class="rc-card-sub">${this.esc(sub)}</div>` : ''}
          <div class="rc-price">${off > 0 ? `<s>${money(p.precio_venta)}</s>` : ''}<b>${money(p.precio_final)}</b></div>
          <div class="rc-stock">${out ? '<span class="rc-tag-out">Agotado</span>' : stock <= 5 ? `<span class="rc-tag-low">${stock === 1 ? 'Última unidad' : `Últimas ${stock} unidades`}</span>` : `<span><i class="ti ti-package"></i>Stock: ${stock}</span>`}</div>
          <div class="rc-card-cta" data-ctl="${id}" data-out="${out ? 1 : 0}"></div>
        </div>
      </article>`;
    },
    // Botón "Agregar" o contador según lo que ya hay en el carrito.
    refrescarControles() {
      document.querySelectorAll('[data-ctl]').forEach(host => {
        const id = Number(host.dataset.ctl);
        const item = this.cart.find(i => Number(i.id) === id);
        const out = host.dataset.out === '1';
        const key = out ? 'out' : item ? `q${item.cantidad}` : 'add';
        if (host.dataset.key === key) return;
        host.dataset.key = key;
        host.innerHTML = out
          ? '<button class="rc-add" disabled>Agotado</button>'
          : item
            ? `<div class="rc-step"><button aria-label="Quitar uno" onclick="Tienda.changeQty(${id},-1)"><i class="ti ti-${Number(item.cantidad) === 1 ? 'trash' : 'minus'}"></i></button><span>${Number(item.cantidad)} en carrito</span><button aria-label="Agregar uno" onclick="Tienda.agregar(${id},1)"><i class="ti ti-plus"></i></button></div>`
            : `<button class="rc-add" onclick="Tienda.agregar(${id},1,this)"><i class="ti ti-shopping-cart-plus"></i>Agregar</button>`;
      });
    },
    revelar() {
      const nodes = document.querySelectorAll('.rc-reveal:not(.in)');
      if (reduceMotion() || !('IntersectionObserver' in window)) return nodes.forEach(node => node.classList.add('in'));
      this._io ||= new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('in'); this._io.unobserve(entry.target); }
      }), { rootMargin: '0px 0px -30px 0px', threshold: 0.04 });
      nodes.forEach(node => this._io.observe(node));
    },

    // ── Agregar al carrito ──
    async agregar(id, cantidad = 1, origin = null) {
      const prod = this._items[Number(id)];
      if (!prod) return;
      if (Number(prod.stock || 0) <= 0) return this.toast('Producto agotado', 'err');
      const existing = this.cart.find(i => Number(i.id) === Number(id));
      const desired = (existing ? Number(existing.cantidad || 0) : 0) + Math.max(1, Number(cantidad) || 1);
      const target = existing || { ...prod, cantidad: 0 };
      if (Number(target.stock || 0) > 0 && desired > Number(target.stock)) return this.toast(`Solo hay ${Number(target.stock)} disponibles`, 'err');
      if (origin) origin.disabled = true;
      const ok = await this.quoteItem(target, desired);
      if (origin) origin.disabled = false;
      if (!ok) return;
      if (!existing) this.cart.push(target);
      this.saveCart();
      this.renderCart();
      this.refrescarControles();
      this.volar(origin, prod);
      this.toast(`${prod.nombre} agregado`, 'ok');
    },
    // La foto del producto viaja hasta el carrito.
    volar(origin, prod) {
      const cart = document.getElementById('btn-cart');
      const source = origin?.closest?.('.rc-card, .rc-pd')?.querySelector('.rc-card-media img, .rc-pd-main img');
      if (!source || reduceMotion()) return;
      const from = source.getBoundingClientRect(), to = cart.getBoundingClientRect();
      const ghost = document.createElement('img');
      ghost.src = prod.imagen; ghost.className = 'rc-fly'; ghost.alt = '';
      Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
      document.body.appendChild(ghost);
      requestAnimationFrame(() => {
        ghost.style.transform = `translate(${to.left + to.width / 2 - from.left - 18}px, ${to.top + to.height / 2 - from.top - 18}px)`;
        ghost.style.width = '36px'; ghost.style.height = '36px'; ghost.style.opacity = '.15';
      });
      setTimeout(() => ghost.remove(), 800);
    },
    async setQty(id, value) { await base.setQty.call(this, id, value); this.refrescarControles(); },
    delCart(id) { base.delCart.call(this, id); this.refrescarControles(); },
    vaciarCarrito(confirmado = false) { base.vaciarCarrito.call(this, confirmado); if (confirmado) this.refrescarControles(); },
    updateCartBadge() {
      const total = this.cart.reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
      const badge = document.getElementById('cart-badge');
      const changed = badge.textContent !== String(total);
      badge.style.display = total ? 'flex' : 'none';
      badge.textContent = total > 99 ? '99+' : total;
      if (changed && total) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
    },

    // ── Página de producto ──
    async verProducto(id) {
      const host = document.getElementById('view-detail');
      if (document.getElementById('view-detail').hidden) { this.go(`/tienda/producto/${Number(id)}`); return; }
      host.innerHTML = '<div class="rc-pd-loading"><div class="rc-skel-img"></div><div class="rc-skel-lines"><i></i><i></i><i></i></div></div>';
      let d;
      try { d = await (await fetch(`${API}/productos/${Number(id)}`)).json(); } catch (_) { d = { ok: false }; }
      if (!d.ok) { host.innerHTML = this.vacio('package-off', 'Producto no disponible', 'Puede que ya no esté a la venta.'); return; }
      const p = d.producto;
      const off = pct(p);
      const stock = Number(p.stock_disponible || 0);
      const out = stock <= 0;
      const tiers = Array.isArray(d.volumenes) ? d.volumenes : [];
      const images = (d.imagenes || []).map(i => i.ruta).filter(Boolean);
      this.recordar(p);
      document.title = `${p.nombre} — ${this.cfg?.nombre || 'Tienda'}`;
      const related = this._productos.filter(x => Number(x.sucursal_id) === Number(p.sucursal_id) && Number(x.id) !== Number(p.id));
      host.innerHTML = `
        <nav class="rc-crumbs" aria-label="Ruta"><a href="/tienda">Inicio</a><i class="ti ti-chevron-right"></i><a href="/tienda/sucursal/${Number(p.sucursal_id)}">${this.esc(p.sucursal_nombre || 'Productos')}</a><i class="ti ti-chevron-right"></i><span>${this.esc(p.nombre)}</span></nav>
        <article class="rc-pd">
          <div class="rc-pd-media">
            <div class="rc-pd-main">${off > 0 ? `<span class="rc-off big">-${off}%</span>` : ''}${images[0] ? `<img src="${this.esc(images[0])}" alt="${this.esc(p.nombre)}" id="pd-img">` : '<i class="ti ti-paw rc-noimg"></i>'}</div>
            ${images.length > 1 ? `<div class="rc-pd-thumbs">${images.map((src, i) => `<button class="${i === 0 ? 'on' : ''}" onclick="Tienda.pdFoto(${i})" aria-label="Foto ${i + 1}"><img src="${this.esc(src)}" alt=""></button>`).join('')}</div>` : ''}
          </div>
          <div class="rc-pd-info">
            ${p.marca ? `<div class="rc-pd-brand">${this.esc(p.marca)}</div>` : ''}
            <h1>${this.esc(p.nombre)}</h1>
            <div class="rc-pd-badges">${out ? '<span class="rc-badge-out">Agotado</span>' : '<span class="rc-badge-ok"><i class="ti ti-circle-check"></i>Disponible</span>'}${off > 0 ? `<span class="rc-badge-off">Ahorras ${money(Number(p.precio_venta) - Number(p.precio_final))}</span>` : ''}</div>
            <div class="rc-pd-price">${off > 0 ? `<s>${money(p.precio_venta)}</s>` : ''}<b id="pd-unit">${money(p.precio_final)}</b>${p.unidad ? `<small>/ ${this.esc(p.unidad)}</small>` : ''}</div>
            <ul class="rc-pd-facts">
              <li><i class="ti ti-package"></i>${out ? 'Sin unidades disponibles' : `${stock} ${stock === 1 ? 'unidad disponible' : 'unidades disponibles'}`}</li>
              ${p.sucursal_nombre ? `<li><i class="ti ti-building-store"></i>Lo despacha ${this.esc(p.sucursal_nombre)}</li>` : ''}
            </ul>
            ${tiers.length ? `<div class="rc-tiers"><b><i class="ti ti-discount-2"></i>Mejor precio por cantidad</b>${tiers.map(t => `<div><span>Desde ${Number(t.cantidad_desde || t.cantidad_minima)} unidades</span><strong>${money(t.precio_unit)} c/u</strong></div>`).join('')}</div>` : ''}
            ${out ? '<button class="rc-buy" disabled><i class="ti ti-circle-x"></i>Agotado</button>' : `
            <div class="rc-pd-buy">
              <div class="rc-qty"><button aria-label="Menos" onclick="Tienda.pdQty(-1)"><i class="ti ti-minus"></i></button><input id="pd-qty" type="number" min="1" max="${Math.max(1, stock)}" value="1" aria-label="Cantidad" oninput="Tienda.pdQty(0)"><button aria-label="Más" onclick="Tienda.pdQty(1)"><i class="ti ti-plus"></i></button></div>
              <button class="rc-buy" onclick="Tienda.pdAgregar(${Number(p.id)},this)"><i class="ti ti-shopping-cart-plus"></i>Agregar al carrito<span id="pd-total">${money(p.precio_final)}</span></button>
            </div>`}
            ${p.descripcion ? `<div class="rc-pd-desc"><h2>Descripción</h2><p>${this.esc(p.descripcion)}</p></div>` : ''}
          </div>
        </article>
        ${related.length ? this.railHTML({ title: 'También te puede interesar', products: related, link: `/tienda/sucursal/${Number(p.sucursal_id)}`, linkText: 'Ver todos' }) : ''}`;
      this._pd = { id: Number(p.id), base: Number(p.precio_final), tiers, stock, images };
      this.activarCarruseles(host);
      this.revelar();
      this.refrescarControles();
    },
    pdFoto(index) {
      const img = document.getElementById('pd-img');
      if (!img || !this._pd?.images[index]) return;
      img.src = this._pd.images[index];
      document.querySelectorAll('.rc-pd-thumbs button').forEach((b, i) => b.classList.toggle('on', i === index));
    },
    pdQty(delta) {
      const input = document.getElementById('pd-qty');
      if (!input || !this._pd) return;
      const qty = Math.max(1, Math.min(Math.max(1, this._pd.stock), Math.floor(Number(input.value || 1)) + delta));
      if (delta !== 0 || Number(input.value) > this._pd.stock) input.value = qty;
      const tier = [...this._pd.tiers].sort((a, b) => Number(b.cantidad_desde || b.cantidad_minima) - Number(a.cantidad_desde || a.cantidad_minima)).find(t => qty >= Number(t.cantidad_desde || t.cantidad_minima));
      const unit = tier ? Math.min(this._pd.base, Number(tier.precio_unit)) : this._pd.base;
      document.getElementById('pd-unit').textContent = money(unit);
      document.getElementById('pd-total').textContent = money(unit * qty);
    },
    async pdAgregar(id, button) {
      const qty = Math.max(1, Math.floor(Number(document.getElementById('pd-qty')?.value || 1)));
      await this.agregar(id, qty, button);
    },

    // ── Menú lateral ──
    renderMenu() {
      const body = document.getElementById('menu-body');
      if (!body) return;
      body.innerHTML = `
        <div class="rc-menu-group"><small>Comprar</small>
          <a href="/tienda"><i class="ti ti-home"></i>Inicio</a>
          <a href="/tienda/ofertas"><i class="ti ti-discount-2"></i>Ofertas</a>
          <a href="/tienda/mas-vendidos"><i class="ti ti-trending-up"></i>Más vendidos</a>
          <a href="/tienda/todos"><i class="ti ti-layout-grid"></i>Todos los productos</a>
        </div>
        ${this._branches.length ? `<div class="rc-menu-group"><small>Tiendas</small>${this._branches.map(([id, nombre], i) => `<a href="/tienda/sucursal/${id}"><i class="ti ${BRANCH_ICONS[i % BRANCH_ICONS.length]}"></i>${this.esc(nombre)}</a>`).join('')}</div>` : ''}
        <div class="rc-menu-group" id="menu-account"></div>`;
      body.querySelectorAll('a').forEach(a => a.addEventListener('click', () => this.cerrarTodo()));
      this.renderMenuCuenta();
    },
    renderMenuCuenta() {
      const host = document.getElementById('menu-account');
      if (!host) return;
      host.innerHTML = `<small>Mi cuenta</small>` + (this.cliente
        ? `<button onclick="Tienda.cerrarTodo();Tienda.verPedidos()"><i class="ti ti-package"></i>Mis pedidos</button><button onclick="Tienda.cerrarTodo();Tienda.logout()"><i class="ti ti-logout"></i>Cerrar sesión</button>`
        : `<button onclick="Tienda.cerrarTodo();Tienda.abrirAuth()"><i class="ti ti-login"></i>Iniciar sesión</button><button onclick="Tienda.cerrarTodo();Tienda.abrirAuth();Tienda.switchAuth&&Tienda.switchAuth('reg')"><i class="ti ti-user-plus"></i>Crear cuenta</button>`);
    },
    abrirMenu() {
      document.getElementById('menu-drawer').classList.add('show');
      document.getElementById('menu-drawer').setAttribute('aria-hidden', 'false');
      document.getElementById('overlay').classList.add('show');
    },
    cerrarTodo() {
      base.cerrarTodo.call(this);
      const menu = document.getElementById('menu-drawer');
      if (menu) { menu.classList.remove('show'); menu.setAttribute('aria-hidden', 'true'); }
    },

    // ── Carrito ──
    renderCart() {
      const body = document.getElementById('cart-body');
      const foot = document.getElementById('cart-foot');
      const units = this.cart.reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
      document.getElementById('cart-count').textContent = units ? `(${units})` : '';
      if (!this.cart.length) {
        body.innerHTML = `<div class="st-cart-empty"><i class="ti ti-shopping-cart"></i><b>Tu carrito está vacío</b><span>Agrega productos para empezar tu pedido.</span><button class="rc-btn" onclick="Tienda.cerrarTodo();Tienda.go('/tienda/todos')">Ver productos</button></div>`;
        foot.innerHTML = '';
        foot.hidden = true;
        return;
      }
      foot.hidden = false;
      const total = this.cartTotal();
      const normal = this.cart.reduce((sum, i) => sum + Math.max(Number(i.precio_normal || 0), Number(i.precio || 0)) * Number(i.cantidad || 0), 0);
      const saving = Math.max(0, normal - total);
      const free = Number(this.cfg?.delivery?.gratis_desde || 0);
      const ship = free > 0 && this.cfg?.delivery_activo && this.usaZonasDelivery()
        ? `<div class="st-ship">${total >= free ? '<b>¡Tienes envío gratis!</b>' : `Te faltan <b>${money(free - total)}</b> para el envío gratis`}<div class="st-ship-bar"><i style="--w:${Math.min(100, total / free * 100).toFixed(1)}%"></i></div></div>` : '';
      body.innerHTML = ship + this.cart.map(i => {
        const line = Number(i.precio) * Number(i.cantidad);
        const lineNormal = Math.max(Number(i.precio_normal || 0), Number(i.precio)) * Number(i.cantidad);
        return `<div class="st-ci">
          <a class="st-ci-img" href="/tienda/producto/${Number(i.id)}" onclick="Tienda.cerrarTodo()">${i.imagen ? `<img src="${this.esc(i.imagen)}" alt="">` : '<i class="ti ti-paw"></i>'}</a>
          <div>
            <div class="st-ci-name">${this.esc(i.nombre)}</div>
            <div class="st-ci-sub">${money(i.precio)} c/u${i.volumen_aplicado ? ` · <em>precio por ${Number(i.volumen_aplicado.cantidad_minima)}+</em>` : ''}</div>
            <div class="st-ci-step"><button aria-label="Quitar uno" onclick="Tienda.changeQty(${Number(i.id)},-1)"><i class="ti ti-${Number(i.cantidad) === 1 ? 'trash' : 'minus'}"></i></button><input type="number" min="1" max="${Math.min(10000, Number(i.stock || 10000))}" value="${Number(i.cantidad)}" aria-label="Cantidad" onchange="Tienda.setQty(${Number(i.id)},this.value)" onkeydown="if(event.key==='Enter')this.blur()"><button aria-label="Agregar uno" onclick="Tienda.changeQty(${Number(i.id)},1)"><i class="ti ti-plus"></i></button></div>
          </div>
          <div class="st-ci-total">${money(line)}${lineNormal > line + 0.004 ? `<s>${money(lineNormal)}</s>` : ''}</div>
        </div>`;
      }).join('');
      foot.innerHTML = `<div class="st-sum">
          ${saving > 0.004 ? `<div><span>Productos</span><span>${money(normal)}</span></div><div class="save"><span>Descuentos</span><span>− ${money(saving)}</span></div>` : ''}
          <div class="total"><span>Subtotal</span><span>${money(total)}</span></div>
        </div>
        <button class="st-checkout" onclick="Tienda.irCheckout()">Continuar con la compra <i class="ti ti-arrow-right"></i></button>
        <button class="st-clear" onclick="Tienda.vaciarCarrito()">Vaciar carrito</button>`;
    },

    // ── Cuenta ──
    renderUser() {
      const label = document.getElementById('user-label');
      const btn = document.getElementById('btn-user');
      const first = this.cliente ? String(this.cliente.nombre || '').trim().split(/\s+/)[0] : '';
      label.textContent = this.cliente ? (first || 'Mi cuenta') : 'Ingresar';
      btn.classList.toggle('in', !!this.cliente);
      const icon = btn.querySelector('i, img');
      if (icon) icon.outerHTML = this.cliente?.avatar ? `<img src="${this.esc(this.cliente.avatar)}" alt="">` : `<i class="ti ti-${this.cliente ? 'user-check' : 'user'}"></i>`;
      this.renderCuentaPie();
      this.renderMenuCuenta();
    },
    renderCuentaPie() {
      const host = document.getElementById('foot-cuenta');
      if (!host) return;
      host.innerHTML = this.cliente
        ? `<li><button onclick="Tienda.verPedidos()">Mis pedidos</button></li><li><button onclick="Tienda.abrirCarrito()">Mi carrito</button></li><li><button onclick="Tienda.logout()">Cerrar sesión</button></li>`
        : `<li><button onclick="Tienda.abrirAuth()">Iniciar sesión</button></li><li><button onclick="Tienda.abrirAuth();Tienda.switchAuth&&Tienda.switchAuth('reg')">Crear cuenta</button></li><li><button onclick="Tienda.abrirCarrito()">Mi carrito</button></li>`;
    },
    menuUsuario() {
      const host = document.getElementById('st-menu-host');
      if (host.firstChild) return this.cerrarMenu();
      host.innerHTML = `<div class="st-menu" role="menu">
        <div class="st-menu-head"><b>${this.esc(this.cliente.nombre || 'Mi cuenta')}</b><small>${this.esc(this.cliente.email || '')}</small></div>
        <button role="menuitem" onclick="Tienda.cerrarMenu();Tienda.verPedidos()"><i class="ti ti-package"></i>Mis pedidos</button>
        <button role="menuitem" onclick="Tienda.cerrarMenu();Tienda.abrirCarrito()"><i class="ti ti-shopping-cart"></i>Mi carrito</button>
        <button role="menuitem" class="out" onclick="Tienda.logout()"><i class="ti ti-logout"></i>Cerrar sesión</button>
      </div>`;
    },
    cerrarMenu() { const host = document.getElementById('st-menu-host'); if (host) host.innerHTML = ''; },
    afterLogin(cliente) { base.afterLogin.call(this, cliente); this.renderUser(); },
    async logout() { this.cerrarMenu(); await base.logout.call(this); this.cliente = this.cliente || null; this.renderUser(); }
  });
})();
