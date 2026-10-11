/*
 * Capa visual de la tienda: portada, catálogo, ficha de producto, carrito y
 * menú de cuenta. Sustituye las funciones de presentación de tienda-app.js;
 * la lógica de precios, checkout y sesión sigue viviendo allí.
 */
(function () {
  const money = value => `S/ ${Number(value || 0).toFixed(2)}`;
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BRANCH_ICONS = ['ti-flame', 'ti-droplet', 'ti-fish', 'ti-paw', 'ti-building-store', 'ti-package'];

  const base = {
    setQty: Tienda.setQty, delCart: Tienda.delCart, vaciarCarrito: Tienda.vaciarCarrito,
    afterLogin: Tienda.afterLogin, logout: Tienda.logout
  };

  // Una foto que no carga se reemplaza por el ícono de la marca.
  document.addEventListener('error', event => {
    const img = event.target;
    if (img?.tagName !== 'IMG' || !img.closest('.st-card-media, .st-pd-media, .st-ci-img')) return;
    const icon = document.createElement('i');
    icon.className = 'ti ti-paw st-noimg';
    img.replaceWith(icon);
  }, true);

  Object.assign(Tienda, {
    _items: {},
    _productos: [],
    _filtro: '',
    _verTodo: false,

    async init() {
      try { this.cart = JSON.parse(localStorage.getItem('mp_cart') || '[]'); } catch (_) { this.cart = []; }
      this.updateCartBadge();
      document.getElementById('foot-year').textContent = new Date().getFullYear();

      const header = document.getElementById('st-header');
      const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();

      await this.cargarConfig();
      this.cargarCategorias();
      await this.cargarProductos();
      await this.repriceCart({ silent: true });
      this.refrescarControles();
      await this.checkSession();

      let timer;
      document.getElementById('buscador').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => this.cargarProductos(), 350); });
      document.getElementById('btn-cart').onclick = () => this.abrirCarrito();
      document.getElementById('btn-user').onclick = event => { event.stopPropagation(); this.cliente ? this.menuUsuario() : this.abrirAuth(); };
      document.addEventListener('click', event => { if (!event.target.closest('#st-menu-host')) this.cerrarMenu(); });
      document.addEventListener('keydown', event => { if (event.key === 'Escape') { this.cerrarMenu(); this.cerrarModal(); this.cerrarTodo(); } });
    },

    // ── Configuración, franja superior y pie ──
    async cargarConfig() {
      try {
        const d = await (await fetch(`${API}/config`)).json();
        if (!d.ok) return;
        this.cfg = d;
        document.title = `${d.nombre} — Tienda`;
        document.getElementById('brand-name').textContent = d.nombre;
        document.getElementById('foot-nombre').textContent = d.nombre;
        document.getElementById('foot-desc').textContent = d.descripcion || '';
        if (d.logo) document.getElementById('brand-logo').innerHTML = `<img src="${this.esc(d.logo)}" alt="">`;

        const strip = [];
        const free = Number(d.delivery?.gratis_desde || 0);
        if (d.delivery_activo && this.usaZonasDelivery()) strip.push(`<span><i class="ti ti-truck-delivery"></i>${free > 0 ? `Envío gratis desde ${money(free)}` : 'Delivery a domicilio'}</span>`);
        if (d.recojo_activo) strip.push('<span><i class="ti ti-building-store"></i>Recojo en tienda sin costo</span>');
        if (d.horario) strip.push(`<span><i class="ti ti-clock"></i>${this.esc(d.horario)}</span>`);
        if (d.whatsapp) strip.push(`<span><i class="ti ti-brand-whatsapp"></i><a href="https://wa.me/${d.whatsapp.replace(/\D/g, '')}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a></span>`);
        const stripHost = document.getElementById('st-strip');
        stripHost.hidden = !strip.length;
        stripHost.firstElementChild.innerHTML = strip.join('');

        const contact = [];
        if (d.direccion) contact.push(`<li><i class="ti ti-map-pin"></i><span>${this.esc(d.direccion)}</span></li>`);
        if (d.horario) contact.push(`<li><i class="ti ti-clock"></i><span>${this.esc(d.horario)}</span></li>`);
        if (d.whatsapp) contact.push(`<li><i class="ti ti-brand-whatsapp"></i><a href="https://wa.me/${d.whatsapp.replace(/\D/g, '')}" target="_blank" rel="noopener">${this.esc(d.whatsapp)}</a></li>`);
        const contactHost = document.getElementById('foot-contacto');
        contactHost.innerHTML = contact.join('');
        contactHost.closest('div').hidden = !contact.length;
        const social = [];
        if (d.facebook) social.push(`<a href="${this.esc(d.facebook)}" target="_blank" rel="noopener" aria-label="Facebook"><i class="ti ti-brand-facebook"></i></a>`);
        if (d.instagram) social.push(`<a href="${this.esc(d.instagram)}" target="_blank" rel="noopener" aria-label="Instagram"><i class="ti ti-brand-instagram"></i></a>`);
        document.getElementById('foot-social').innerHTML = social.join('');

        this.renderSlider(d.sliders || []);
        this.renderCuentaPie();
        if (d.google_client_id) this.initGoogle(d.google_client_id);
      } catch (error) { console.error(error); }
    },

    // ── Portada ──
    renderSlider(sliders) {
      const slides = document.getElementById('slides');
      const dots = document.getElementById('slider-dots');
      const hero = document.getElementById('slider');
      this.slideCount = sliders.length;
      this.slideIndex = 0;
      if (!sliders.length) {
        hero.querySelectorAll('.st-hero-nav').forEach(node => { node.hidden = true; });
        dots.innerHTML = '';
        slides.innerHTML = `<div class="st-hero-brand">
          <div><h1>${this.esc(this.cfg?.nombre || 'Mundo Pet')}</h1>${this.cfg?.descripcion ? `<p>${this.esc(this.cfg.descripcion)}</p>` : ''}
            <button class="st-hero-cta" onclick="document.getElementById('st-home').scrollIntoView({behavior:'smooth',block:'start'})">Ver productos <i class="ti ti-arrow-down"></i></button></div>
          <div class="st-hero-art" aria-hidden="true"><i class="ti ti-paw"></i><i class="ti ti-bone"></i><i class="ti ti-paw"></i></div>
        </div>`;
        return;
      }
      slides.innerHTML = sliders.map((s, i) => `<div class="st-slide ${i === 0 ? 'on' : ''}"><img src="${this.esc(s.ruta)}" alt="${this.esc(s.nombre || '')}" ${i ? 'loading="lazy"' : ''}></div>`).join('');
      dots.innerHTML = sliders.length > 1 ? sliders.map((_, i) => `<button class="${i === 0 ? 'on' : ''}" aria-label="Imagen ${i + 1}" onclick="Tienda.goSlide(${i})"></button>`).join('') : '';
      hero.querySelectorAll('.st-hero-nav').forEach(node => { node.hidden = sliders.length < 2; });
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
      document.querySelectorAll('#slides .st-slide').forEach((node, i) => node.classList.toggle('on', i === index));
      document.querySelectorAll('#slider-dots button').forEach((node, i) => node.classList.toggle('on', i === index));
    },
    slideNext() { if (this.slideCount > 1) { this.goSlide((this.slideIndex + 1) % this.slideCount); this.startSlider(); } },
    slidePrev() { if (this.slideCount > 1) { this.goSlide((this.slideIndex - 1 + this.slideCount) % this.slideCount); this.startSlider(); } },

    // ── Filtros por sucursal ──
    cargarCategorias() {
      const bar = document.getElementById('cats-bar');
      const branches = this.cfg?.sucursales || [];
      if (branches.length < 2) { bar.parentElement.hidden = true; return; }
      bar.innerHTML = `<button class="st-chip on" data-suc=""><i class="ti ti-home"></i>Inicio</button>`
        + branches.map((b, i) => `<button class="st-chip" data-suc="${Number(b.id)}"><i class="ti ${BRANCH_ICONS[i % BRANCH_ICONS.length]}"></i>${this.esc(b.nombre)}</button>`).join('');
      bar.onclick = event => {
        const chip = event.target.closest('.st-chip');
        if (chip) this.filtrar(chip.dataset.suc);
      };
    },
    filtrar(sucursalId, { todo = false } = {}) {
      this._filtro = String(sucursalId || '');
      this._verTodo = todo;
      document.querySelectorAll('#cats-bar .st-chip').forEach(chip => chip.classList.toggle('on', chip.dataset.suc === this._filtro && !todo));
      this.pintarCatalogo();
      const top = document.getElementById(this._filtro || todo ? 'st-catalog' : 'st-home');
      window.scrollTo({ top: top.getBoundingClientRect().top + window.scrollY - 150, behavior: 'smooth' });
    },

    // ── Catálogo ──
    async cargarProductos() {
      const home = document.getElementById('st-home');
      if (!this._productos.length) home.innerHTML = `<div class="st-section"><div class="st-grid">${'<div class="st-skel"></div>'.repeat(8)}</div></div>`;
      const qs = new URLSearchParams();
      const buscar = document.getElementById('buscador').value.trim();
      const orden = document.getElementById('orden').value;
      if (buscar) qs.append('buscar', buscar);
      if (orden) qs.append('orden', orden);
      try {
        const d = await (await fetch(`${API}/productos?${qs}`)).json();
        this._productos = d.ok ? d.productos : [];
      } catch (_) {
        this._productos = [];
        this._error = true;
      }
      this._productos.forEach(p => {
        this._items[Number(p.id)] = {
          id: Number(p.id), nombre: p.nombre, precio: Number(p.precio_final), precio_normal: Number(p.precio_venta || p.precio_final),
          imagen: p.imagen || '', sucursal_id: Number(p.sucursal_id), sucursal_nombre: p.sucursal_nombre || '', stock: Number(p.stock_disponible || 0)
        };
      });
      this.pintarCatalogo();
    },
    pintarCatalogo() {
      const home = document.getElementById('st-home');
      const catalog = document.getElementById('st-catalog');
      const grid = document.getElementById('grid');
      const buscar = document.getElementById('buscador').value.trim();
      const orden = document.getElementById('orden').value;
      const all = this._productos;
      const list = this._filtro ? all.filter(p => String(p.sucursal_id) === this._filtro) : all;
      const branches = [...new Map(all.map(p => [Number(p.sucursal_id), p.sucursal_nombre || ''])).entries()];
      const enInicio = !buscar && !orden && !this._filtro && !this._verTodo && branches.length > 1;

      home.hidden = !enInicio;
      catalog.hidden = enInicio;
      if (enInicio) {
        const ofertas = all.filter(p => Number(p.precio_final) < Number(p.precio_venta));
        const rails = [];
        if (ofertas.length) rails.push(this.railHTML('Ofertas', '', ofertas, ''));
        branches.forEach(([id, nombre]) => rails.push(this.railHTML(nombre, '', all.filter(p => Number(p.sucursal_id) === id), `Tienda.filtrar(${id})`)));
        home.innerHTML = rails.join('') + `<div class="st-section" style="text-align:center"><button class="st-more" style="font-size:15px" onclick="Tienda.filtrar('',{todo:true})">Ver todo el catálogo <i class="ti ti-arrow-right"></i></button></div>`;
        this.activarCarruseles();
      } else {
        const branchName = this._filtro ? (branches.find(([id]) => String(id) === this._filtro)?.[1] || 'Productos') : '';
        document.getElementById('section-title').innerHTML = `${this.esc(buscar ? `Resultados para “${buscar}”` : branchName || 'Todos los productos')}<span>${list.length} ${list.length === 1 ? 'producto' : 'productos'}</span>`;
        grid.innerHTML = list.length
          ? list.map((p, i) => this.cardHTML(p, i)).join('')
          : `<div class="st-empty"><i class="ti ti-${this._error ? 'cloud-off' : 'search-off'}"></i><b>${this._error ? 'No pudimos cargar los productos' : 'No encontramos productos'}</b>${buscar ? 'Prueba con otra palabra.' : ''}</div>`;
      }
      this.revelar();
      this.refrescarControles();
    },
    railHTML(title, subtitle, products, action) {
      if (!products.length) return '';
      return `<section class="st-section st-reveal">
        <div class="st-section-head"><h2>${this.esc(title)}${subtitle ? `<small>${this.esc(subtitle)}</small>` : ''}</h2>${action ? `<button class="st-more" onclick="${action}">Ver todo <i class="ti ti-arrow-right"></i></button>` : ''}</div>
        <div class="st-rail-box">
          <button class="st-rail-btn prev" aria-label="Anterior" hidden><i class="ti ti-chevron-left"></i></button>
          <div class="st-rail">${products.slice(0, 14).map((p, i) => this.cardHTML(p, i)).join('')}</div>
          <button class="st-rail-btn next" aria-label="Siguiente"><i class="ti ti-chevron-right"></i></button>
        </div>
      </section>`;
    },
    activarCarruseles() {
      document.querySelectorAll('.st-rail-box').forEach(box => {
        const rail = box.querySelector('.st-rail');
        const prev = box.querySelector('.prev'), next = box.querySelector('.next');
        const sync = () => {
          prev.hidden = rail.scrollLeft < 8;
          next.hidden = rail.scrollLeft + rail.clientWidth > rail.scrollWidth - 8;
        };
        const step = dir => rail.scrollBy({ left: dir * rail.clientWidth * 0.85, behavior: 'smooth' });
        prev.onclick = () => step(-1);
        next.onclick = () => step(1);
        rail.addEventListener('scroll', sync, { passive: true });
        sync();
      });
    },
    cardHTML(p, index = 0) {
      const id = Number(p.id);
      const oferta = Number(p.precio_final) < Number(p.precio_venta);
      const pct = oferta ? Math.round(Number(p.descuento_aplicado) || ((Number(p.precio_venta) - Number(p.precio_final)) / Number(p.precio_venta)) * 100) : 0;
      const stock = Number(p.stock_disponible || 0);
      return `<article class="st-card st-reveal" style="--d:${Math.min(index, 8)}">
        <div class="st-card-media" onclick="Tienda.verProducto(${id})">
          ${oferta && pct > 0 ? `<span class="st-off">-${pct}%</span>` : ''}
          ${stock > 0 && stock <= 5 ? `<span class="st-low">${stock === 1 ? 'Queda 1' : `Quedan ${stock}`}</span>` : ''}
          ${p.imagen ? `<img src="${this.esc(p.imagen)}" alt="${this.esc(p.nombre)}" loading="lazy">` : '<i class="ti ti-paw st-noimg"></i>'}
        </div>
        <div class="st-card-body">
          ${p.marca ? `<div class="st-card-tag">${this.esc(p.marca)}</div>` : ''}
          <div class="st-card-name" onclick="Tienda.verProducto(${id})">${this.esc(p.nombre)}</div>
          <div class="st-card-foot">
            <div class="st-price"><b>${money(p.precio_final)}</b>${oferta ? `<s>${money(p.precio_venta)}</s>` : ''}</div>
            <div data-ctl="${id}"></div>
          </div>
        </div>
      </article>`;
    },
    // Botón "+" o contador según lo que ya hay en el carrito.
    refrescarControles() {
      document.querySelectorAll('[data-ctl]').forEach(host => {
        const id = Number(host.dataset.ctl);
        const item = this.cart.find(i => Number(i.id) === id);
        const key = item ? `q${item.cantidad}` : 'add';
        if (host.dataset.key === key) return;
        host.dataset.key = key;
        host.innerHTML = item
          ? `<div class="st-step"><button aria-label="Quitar uno" onclick="Tienda.changeQty(${id},-1)"><i class="ti ti-${Number(item.cantidad) === 1 ? 'trash' : 'minus'}"></i></button><span>${Number(item.cantidad)}</span><button aria-label="Agregar uno" onclick="Tienda.agregar(${id},1)"><i class="ti ti-plus"></i></button></div>`
          : `<button class="st-add" aria-label="Agregar al carrito" onclick="Tienda.agregar(${id},1,this)"><i class="ti ti-plus"></i></button>`;
      });
    },
    revelar() {
      const nodes = document.querySelectorAll('.st-reveal:not(.in)');
      if (reduceMotion() || !('IntersectionObserver' in window)) return nodes.forEach(node => node.classList.add('in'));
      this._io ||= new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('in'); this._io.unobserve(entry.target); }
      }), { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });
      nodes.forEach(node => this._io.observe(node));
    },

    // ── Agregar al carrito ──
    async agregar(id, cantidad = 1, origin = null) {
      const prod = this._items[Number(id)];
      if (!prod) return;
      const existing = this.cart.find(i => Number(i.id) === Number(id));
      const desired = (existing ? Number(existing.cantidad || 0) : 0) + Math.max(1, Number(cantidad) || 1);
      const target = existing || { ...prod, cantidad: 0 };
      if (Number(target.stock || 0) > 0 && desired > Number(target.stock)) return this.toast(`Solo hay ${Number(target.stock)} disponibles`, 'err');
      if (!(await this.quoteItem(target, desired))) return;
      if (!existing) this.cart.push(target);
      this.saveCart();
      this.renderCart();
      this.refrescarControles();
      this.volar(origin, prod);
      if (target.volumen_aplicado) this.toast(`Precio por cantidad: ${money(target.precio)} c/u`, 'ok');
    },
    // La foto del producto viaja hasta el ícono del carrito.
    volar(origin, prod) {
      const cart = document.getElementById('btn-cart');
      const source = origin?.closest?.('.st-card, .st-pd')?.querySelector('img');
      if (!source || reduceMotion()) return;
      const from = source.getBoundingClientRect(), to = cart.getBoundingClientRect();
      const ghost = document.createElement('img');
      ghost.src = prod.imagen; ghost.className = 'st-fly'; ghost.alt = '';
      Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
      document.body.appendChild(ghost);
      requestAnimationFrame(() => {
        ghost.style.transform = `translate(${to.left + to.width / 2 - from.left - 20}px, ${to.top + to.height / 2 - from.top - 20}px)`;
        ghost.style.width = '40px'; ghost.style.height = '40px'; ghost.style.opacity = '.2';
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
      badge.textContent = total;
      if (changed && total) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
    },

    // ── Ficha de producto ──
    async verProducto(id) {
      let d;
      try { d = await (await fetch(`${API}/productos/${Number(id)}`)).json(); } catch (_) { return this.toast('No pudimos abrir el producto', 'err'); }
      if (!d.ok) return this.toast(d.msg || 'Producto no disponible', 'err');
      const p = d.producto;
      const oferta = Number(p.precio_final) < Number(p.precio_venta);
      const pct = oferta ? Math.round(Number(p.descuento_aplicado) || 0) : 0;
      const stock = Number(p.stock_disponible || 0);
      const tiers = Array.isArray(d.volumenes) ? d.volumenes : [];
      this._items[Number(p.id)] = { id: Number(p.id), nombre: p.nombre, precio: Number(p.precio_final), precio_normal: Number(p.precio_venta || p.precio_final), imagen: p.imagen || '', sucursal_id: Number(p.sucursal_id), sucursal_nombre: p.sucursal_nombre || '', stock };
      this.showModal(`<div class="st-pd">
        <button class="st-pd-close" aria-label="Cerrar" onclick="Tienda.cerrarModal()"><i class="ti ti-x"></i></button>
        <div class="st-pd-media">${oferta && pct > 0 ? `<span class="st-off">-${pct}%</span>` : ''}${p.imagen ? `<img src="${this.esc(p.imagen)}" alt="${this.esc(p.nombre)}">` : '<i class="ti ti-paw st-noimg"></i>'}</div>
        <div class="st-pd-info">
          ${p.marca ? `<div class="st-card-tag">${this.esc(p.marca)}</div>` : ''}
          <h3>${this.esc(p.nombre)}</h3>
          <div class="st-pd-price"><b id="pd-unit">${money(p.precio_final)}</b>${oferta ? `<s>${money(p.precio_venta)}</s><em>Ahorras ${money(Number(p.precio_venta) - Number(p.precio_final))}</em>` : ''}</div>
          ${p.descripcion ? `<p class="st-pd-desc">${this.esc(p.descripcion)}</p>` : ''}
          <div class="st-pd-meta">
            ${p.sucursal_nombre ? `<span><i class="ti ti-building-store"></i>${this.esc(p.sucursal_nombre)}</span>` : ''}
            <span><i class="ti ti-package"></i>${stock > 5 ? 'Disponible' : stock === 1 ? 'Queda 1 unidad' : `Quedan ${stock} unidades`}</span>
          </div>
          ${tiers.length ? `<div class="st-tiers"><b><i class="ti ti-discount-2"></i>Mejor precio por cantidad</b>${tiers.map(t => `<div><span>Desde ${Number(t.cantidad_desde || t.cantidad_minima)} unidades</span><strong>${money(t.precio_unit)} c/u</strong></div>`).join('')}</div>` : ''}
          <div class="st-pd-buy">
            <div class="st-qty"><button aria-label="Menos" onclick="Tienda.pdQty(-1)"><i class="ti ti-minus"></i></button><input id="pd-qty" type="number" min="1" max="${Math.max(1, stock)}" value="1" aria-label="Cantidad" oninput="Tienda.pdQty(0)"><button aria-label="Más" onclick="Tienda.pdQty(1)"><i class="ti ti-plus"></i></button></div>
            <button class="st-buy" id="pd-add" onclick="Tienda.pdAgregar(${Number(p.id)},this)"><span><i class="ti ti-shopping-bag"></i>Agregar</span><b id="pd-total">${money(p.precio_final)}</b></button>
          </div>
        </div>
      </div>`, 'st-product');
      this._pd = { id: Number(p.id), base: Number(p.precio_final), tiers, stock };
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
      this.cerrarModal();
      this.abrirCarrito();
    },

    // ── Carrito ──
    renderCart() {
      const body = document.getElementById('cart-body');
      const foot = document.getElementById('cart-foot');
      const units = this.cart.reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
      document.getElementById('cart-count').textContent = units ? `(${units})` : '';
      if (!this.cart.length) {
        body.innerHTML = `<div class="st-cart-empty"><i class="ti ti-shopping-bag"></i><b>Tu carrito está vacío</b><span>Agrega productos para empezar tu pedido.</span></div>`;
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
          <div class="st-ci-img">${i.imagen ? `<img src="${this.esc(i.imagen)}" alt="">` : '<i class="ti ti-paw"></i>'}</div>
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
      const icon = btn.querySelector('i, img');
      if (icon) icon.outerHTML = this.cliente?.avatar ? `<img src="${this.esc(this.cliente.avatar)}" alt="">` : `<i class="ti ti-${this.cliente ? 'user-check' : 'user'}"></i>`;
      this.renderCuentaPie();
    },
    renderCuentaPie() {
      const host = document.getElementById('foot-cuenta');
      if (!host) return;
      host.innerHTML = this.cliente
        ? `<li><button onclick="Tienda.verPedidos()">Mis pedidos</button></li><li><button onclick="Tienda.logout()">Cerrar sesión</button></li>`
        : `<li><button onclick="Tienda.abrirAuth()">Iniciar sesión</button></li><li><button onclick="Tienda.abrirAuth();Tienda.switchAuth&&Tienda.switchAuth('reg')">Crear cuenta</button></li>`;
    },
    menuUsuario() {
      const host = document.getElementById('st-menu-host');
      if (host.firstChild) return this.cerrarMenu();
      host.innerHTML = `<div class="st-menu" role="menu">
        <div class="st-menu-head"><b>${this.esc(this.cliente.nombre || 'Mi cuenta')}</b><small>${this.esc(this.cliente.email || '')}</small></div>
        <button role="menuitem" onclick="Tienda.cerrarMenu();Tienda.verPedidos()"><i class="ti ti-package"></i>Mis pedidos</button>
        <button role="menuitem" onclick="Tienda.cerrarMenu();Tienda.abrirCarrito()"><i class="ti ti-shopping-bag"></i>Mi carrito</button>
        <button role="menuitem" class="out" onclick="Tienda.logout()"><i class="ti ti-logout"></i>Cerrar sesión</button>
      </div>`;
    },
    cerrarMenu() { const host = document.getElementById('st-menu-host'); if (host) host.innerHTML = ''; },
    afterLogin(cliente) { base.afterLogin.call(this, cliente); this.renderUser(); },
    async logout() { this.cerrarMenu(); await base.logout.call(this); this.cliente = this.cliente || null; this.renderUser(); }
  });
})();
