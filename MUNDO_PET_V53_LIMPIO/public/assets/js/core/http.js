const Http = {
  _headers(json = false) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (window._csrfToken) h['X-CSRF-Token'] = window._csrfToken;
    return h;
  },
  async get(url) {
    return this._request('/api' + url, { credentials: 'include' });
  },
  async post(url, body = {}) {
    return this._request('/api' + url, {
      method: 'POST', headers: this._headers(true), body: JSON.stringify(body), credentials: 'include'
    });
  },
  async postForm(url, formData) {
    return this._request('/api' + url, {
      method: 'POST', headers: this._headers(false), body: formData, credentials: 'include'
    });
  },
  async put(url, body = {}) {
    return this._request('/api' + url, {
      method: 'PUT', headers: this._headers(true), body: JSON.stringify(body), credentials: 'include'
    });
  },
  async patch(url, body = {}) {
    return this._request('/api' + url, {
      method: 'PATCH', headers: this._headers(true), body: JSON.stringify(body), credentials: 'include'
    });
  },
  async delete(url, body = null) {
    const options = { method: 'DELETE', headers: this._headers(!!body), credentials: 'include' };
    if (body) options.body = JSON.stringify(body);
    return this._request('/api' + url, options);
  },
  async _request(url, options, retried = false) {
    let res;

    try {
      res = await fetch(url, options);
    } catch (_) {
      return { ok: false, msg: 'No se pudo conectar con el servidor' };
    }

    if (res.status === 401) {
      const data = await res.json().catch(() => ({ ok:false, msg:'No autorizado' }));
      // Un 401 también puede significar PIN, contraseña o credencial de una
      // operación incorrecta. Solo cerrar la pantalla cuando el backend
      // confirme que la sesión realmente terminó o quedó inválida.
      if (['UNAUTHORIZED','SESSION_INVALID','SESSION_EXPIRED'].includes(String(data?.code || ''))) {
        window.location.href = '/login';
        return null;
      }
      return data;
    }

    if (res.status === 423) {
      const data = await res.json().catch(() => ({ ok:false, msg:'Sesión bloqueada' }));
      if (window.SessionLock) window.SessionLock.show();
      return data;
    }

    if (res.status === 204) return { ok: true };

    const data = await res.json().catch(() => ({
      ok: false,
      msg: 'Respuesta inválida del servidor'
    }));

    // Si el token quedó desfasado, obtener uno nuevo y repetir una sola vez.
    // Antes se actualizaba el token, pero el primer clic siempre fallaba.
    if (data?.code === 'CSRF_INVALID' && !retried) {
      const sessionData = await fetch('/api/auth/session', {
        credentials: 'include',
        cache: 'no-store'
      }).then(r => r.json()).catch(() => null);

      if (sessionData?.csrfToken) {
        window._csrfToken = sessionData.csrfToken;
        const headers = new Headers(options.headers || {});
        headers.set('X-CSRF-Token', window._csrfToken);

        return this._request(url, {
          ...options,
          headers
        }, true);
      }
    }

    return data;
  },
  async _handle(res) {
    // Conservado por compatibilidad con código antiguo.
    if (res.status === 204) return { ok: true };
    return res.json().catch(() => ({ ok:false, msg:'Respuesta inválida del servidor' }));
  }
};
