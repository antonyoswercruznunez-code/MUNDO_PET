const Router = {
  _rutas: {},
  _activo: null,
  _navegacionId: 0,

  registrar(rutas) { this._rutas = rutas; },

  async navegar(slug) {
    const contenido = document.getElementById('contenido');
    if (!contenido) return;
    if (this._activo === slug && !contenido.querySelector('.alert-danger')) return;
    const cargar = this._rutas[slug];
    if (!cargar) return;

    const navId = ++this._navegacionId;
    document.querySelectorAll('.nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.slug === slug));

    const titulo = document.querySelector('.nav-item.active .nav-text');
    const bread  = document.getElementById('breadcrumb-titulo');
    if (bread && titulo) bread.textContent = titulo.textContent;

    contenido.innerHTML = `
      <div class="loading-center">
        <div class="spinner spinner-lg"></div>
        <span>Cargando...</span>
      </div>`;

    try {
      await cargar();
      if (navId !== this._navegacionId) return;
      this._activo = slug;
    } catch(e) {
      if (navId !== this._navegacionId) return;
      this._activo = null;
      console.error(`[MODULO:${slug}]`, e);
      const detalle = String(e?.message || 'Error desconocido')
        .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      contenido.innerHTML = `
        <div class="alert alert-danger" style="margin:20px;display:block">
          <div><i class="ti ti-alert-circle"></i> <b>No se pudo abrir ${slug}.</b></div>
          <div style="margin-top:7px;font-size:13px">${detalle}</div>
          <button type="button" id="router-retry" class="btn btn-danger btn-sm" style="margin-top:12px">Reintentar</button>
        </div>`;
      document.getElementById('router-retry')?.addEventListener('click', () => this.navegar(slug));
    }
    if (history.state?.slug !== slug) history.pushState({ slug }, '', '/dashboard');
  }
};

window.addEventListener('popstate', event => {
  const slug = event.state?.slug || 'dashboard';
  Router.navegar(slug);
});
