// services/SunatService.js
// Servicio que se comunica con MiAPI Cloud para facturación electrónica SUNAT

const MIAPI_TOKEN    = process.env.MIAPI_TOKEN || '';
const CLAVE_SECRETA  = process.env.SUNAT_CLAVE_SECRETA || '';
const BASE_URL       = 'https://miapi.cloud/apifact';

// Función interna: hace la llamada POST a MiAPI con auth
async function postMiAPI(endpoint, body) {
  const r = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MIAPI_TOKEN}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json'
    },
    body: JSON.stringify(body)
  });

  let json;
  try {
    json = await r.json();
  } catch (e) {
    throw new Error('Respuesta inválida de MiAPI (no es JSON)');
  }

  // Si MiAPI responde error HTTP
  if (!r.ok) {
    const msg = json?.message || json?.error || `Error MiAPI (HTTP ${r.status})`;
    throw new Error(msg);
  }

  return json;
}

const SunatService = {

  // ── PASO 1: Generar y firmar el XML del comprobante (factura/boleta) ──
  // datos = objeto con comprobante, cliente, items (ya mapeado)
  generarComprobante: async (datos) => {
    const body = { claveSecreta: CLAVE_SECRETA, ...datos };
    return postMiAPI('invoice/create', body);
  },

  // ── PASO 2: Enviar el comprobante ya generado a SUNAT ──
  // Solo necesita tipoDoc, serie, correlativo
  enviarSunat: async (tipoDoc, serie, correlativo) => {
    const body = {
      claveSecreta: CLAVE_SECRETA,
      comprobante: {
        tipoDoc:     String(tipoDoc),
        serie:       String(serie),
        correlativo: String(correlativo)
      }
    };
    return postMiAPI('invoice/send', body);
  },

  // ── Generar Nota de Crédito (07) o Débito (08) ──
  generarNota: async (datos) => {
    const body = { claveSecreta: CLAVE_SECRETA, ...datos };
    return postMiAPI('note/create', body);
  },

  // ── Comunicación de Bajas (RA - anular facturas) ──
  comunicarBaja: async (datos) => {
    const body = { claveSecreta: CLAVE_SECRETA, ...datos };
    return postMiAPI('voided/send', body);
  },

  // ── Resumen Diario de Boletas (RC) ──
  enviarResumen: async (datos) => {
    const body = { claveSecreta: CLAVE_SECRETA, ...datos };
    return postMiAPI('summary/send', body);
  }

};

module.exports = SunatService;