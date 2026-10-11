/*
 * MPTracking — "Compartir ubicación" para quien reparte.
 *
 * El botón aparece en la barra superior de los usuarios que operan rutas.
 * Mientras esté activo y el panel abierto, el navegador envía la posición
 * cada minuto (o antes si la persona se movió bastante). Se apaga con el
 * mismo botón y nunca se activa solo.
 */
(function () {
  const KEY = 'mp_compartir_ubicacion';
  const EVERY_MS = 60000, MOVED_M = 80;
  let watchId = null, lastSent = 0, lastPoint = null, button = null;

  const meters = (a, b) => (window.MPMap ? MPMap.distanceKm(a, b) * 1000 : 0);
  const stored = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };
  const store = on => { try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch (_) { /* sin almacenamiento */ } };

  function paint(state, title) {
    if (!button) return;
    button.dataset.state = state;
    button.title = title;
    button.querySelector('span').textContent = state === 'on' ? 'Ubicación activa' : state === 'error' ? 'Sin ubicación' : 'Compartir ubicación';
  }

  async function send(position) {
    const point = { lat: position.coords.latitude, lng: position.coords.longitude };
    const due = Date.now() - lastSent >= EVERY_MS;
    const moved = lastPoint && meters(lastPoint, point) >= MOVED_M && Date.now() - lastSent >= 20000;
    if (lastPoint && !due && !moved) return;
    lastSent = Date.now(); lastPoint = point;
    const res = await Http.post('/logistica/ubicacion', { ...point, precision: position.coords.accuracy });
    paint(res?.ok ? 'on' : 'error', res?.ok ? 'Tu ubicación se está compartiendo. Toca para detener.' : 'No se pudo enviar la ubicación');
  }

  function start(interactive) {
    if (!navigator.geolocation) {
      if (interactive) Swal.fire({ icon: 'error', title: 'Este navegador no permite compartir la ubicación' });
      return;
    }
    stop(false);
    store(true);
    paint('on', 'Obteniendo tu ubicación…');
    watchId = navigator.geolocation.watchPosition(send, error => {
      paint('error', 'No se pudo obtener la ubicación');
      if (error.code === error.PERMISSION_DENIED) {
        stop(true);
        if (interactive) Swal.fire({ icon: 'warning', title: 'Permiso de ubicación bloqueado', text: 'Actívalo en el candado de la barra de direcciones y vuelve a intentarlo.' });
      }
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }

  function stop(forget) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; lastPoint = null; lastSent = 0;
    if (forget) store(false);
    paint('off', 'Comparte tu ubicación con el supervisor mientras repartes');
  }

  function init() {
    const puede = window._permisos?.has('logistica.operar') || window._esGlobal;
    const host = document.querySelector('.topbar-right');
    if (!puede || !host || document.getElementById('btn-ubicacion')) return;
    button = document.createElement('button');
    button.id = 'btn-ubicacion'; button.type = 'button';
    button.innerHTML = '<i class="ti ti-current-location"></i><span>Compartir ubicación</span>';
    host.prepend(button);
    paint('off', 'Comparte tu ubicación con el supervisor mientras repartes');
    button.addEventListener('click', async () => {
      if (watchId !== null) return stop(true);
      const ok = await Swal.fire({
        icon: 'question', title: '¿Compartir tu ubicación?',
        text: 'Tu supervisor verá dónde estás mientras tengas el panel abierto. Puedes detenerlo cuando quieras.',
        showCancelButton: true, confirmButtonText: 'Compartir', cancelButtonText: 'Ahora no'
      });
      if (ok.isConfirmed) start(true);
    });
    if (stored()) start(false);
  }

  window.MPTracking = { init, stop };
})();
