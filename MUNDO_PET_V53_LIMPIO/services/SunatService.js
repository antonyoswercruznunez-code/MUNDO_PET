// services/SunatService.js
// Servicio que se comunica con MiAPI Cloud para facturación electrónica SUNAT

const MIAPI_TOKEN    = process.env.MIAPI_TOKEN || '';
const CLAVE_SECRETA  = process.env.SUNAT_CLAVE_SECRETA || '';
// MIAPI_URL puede traer una ruta (p. ej. /v1 para consultas de DNI/RUC); la
// facturación siempre vive en /apifact del mismo servidor.
function miapiOrigin() {
  try { return new URL(process.env.MIAPI_URL || 'https://miapi.cloud').origin; }
  catch (_) { return 'https://miapi.cloud'; }
}
const BASE_URL       = `${miapiOrigin()}/apifact`;

// MiAPI a veces antepone avisos de su servidor al JSON. Se rescata el objeto
// "respuesta" para no dar por fallida una operación que sí se realizó.
function parseMiAPI(text) {
  try { return JSON.parse(text); } catch (_) { /* se intenta rescatar abajo */ }
  const match = String(text).match(/\{\s*"respuesta"[\s\S]*\}\s*$/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) { /* sin JSON válido */ } }
  return null;
}

// Función interna: hace la llamada POST a MiAPI con auth
async function postMiAPI(endpoint, body) {
  if (!MIAPI_TOKEN || !CLAVE_SECRETA)
    throw new Error('Falta configurar MIAPI_TOKEN o SUNAT_CLAVE_SECRETA en el archivo .env');
  let r;
  try {
    r = await fetch(`${BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MIAPI_TOKEN}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json'
      },
      body: JSON.stringify(body),
      // Sin límite, una caída de MiAPI dejaría la emisión colgada indefinidamente.
      signal: AbortSignal.timeout(45000)
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'MiAPI no respondió a tiempo' : 'No se pudo conectar con MiAPI');
  }

  const json = parseMiAPI(await r.text());
  if (!json) throw new Error('Respuesta inválida de MiAPI (no es JSON)');

  const respuesta = json.respuesta || json;
  // Si SUNAT respondió con un código (aceptado, observado o rechazado), eso lo
  // interpreta quien llama. Sin código, un HTTP de error o success distinto
  // de true es un fallo de comunicación y se puede reintentar.
  const tieneCodigoSunat = respuesta.code !== undefined && respuesta.code !== null && String(respuesta.code).trim() !== '';
  if (!tieneCodigoSunat && (!r.ok || (respuesta.success !== undefined && respuesta.success !== true))) {
    throw new Error(respuesta.mensaje || json.message || json.error || `Error MiAPI (HTTP ${r.status})`);
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