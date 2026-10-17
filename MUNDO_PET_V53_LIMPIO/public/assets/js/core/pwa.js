/*
 * MPApp — instalación como aplicación (panel y tienda).
 *
 * Registra el service worker y muestra el botón "Instalar app" cuando el
 * navegador lo permite. En iPhone no hay botón automático: se indica cómo
 * agregarla a la pantalla de inicio.
 */
(function () {
  let deferred = null;
  const buttons = new Set();
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  function sync() {
    const show = !standalone() && (!!deferred || isIos());
    buttons.forEach(button => { button.hidden = !show; });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferred = event;
    sync();
  });
  window.addEventListener('appinstalled', () => { deferred = null; sync(); });

  async function install() {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      sync();
      return;
    }
    if (isIos()) {
      const text = 'En Safari toca el botón Compartir (el cuadrado con la flecha hacia arriba) y luego "Agregar a pantalla de inicio".';
      if (window.Swal) Swal.fire({ icon: 'info', title: 'Instalar en iPhone', text, confirmButtonText: 'Entendido' });
      else alert(text);
    }
  }

  // Convierte un botón existente en el botón de instalar.
  function bind(button) {
    if (!button) return;
    buttons.add(button);
    button.addEventListener('click', install);
    sync();
  }

  window.MPApp = { bind, install, standalone };
})();
