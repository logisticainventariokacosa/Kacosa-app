// js/bridge.js
// Punto único de comunicación con el Apps Script (Gemini, Sheets, Drive, Email).

// URL de tu implementación /exec del Apps Script
const BRIDGE_URL = "https://script.google.com/macros/s/AKfycbwrmKky2cumHSW0cePEnaDkteXpnAW2DV_ZuLtcBRl7wiATnzM_YO8jD-Wh_LeDqsP86g/exec";

// Debe coincidir EXACTAMENTE con la propiedad APP_TOKEN que pusiste en el Apps Script
const APP_TOKEN = "kacosa2026dr";

/**
 * Llama a una acción del bridge.
 * @param {string} action - nombre de la acción (ej. "guardarAnalisis")
 * @param {object} payload - datos adicionales para esa acción
 * @returns {Promise<object>} - respuesta parseada del bridge ({ ok, ...datos })
 */
export async function callBridge(action, payload = {}) {
  try {
    const resp = await fetch(BRIDGE_URL, {
      method: "POST",
      // "text/plain" evita el preflight OPTIONS, que Apps Script no maneja bien
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token: APP_TOKEN, ...payload })
    });

    if (!resp.ok) {
      return { ok: false, error: "Error de red: " + resp.status };
    }
    return await resp.json();
  } catch (err) {
    return { ok: false, error: "No se pudo conectar con el servidor: " + err.message };
  }
}

/** Convierte un archivo (File) a base64 puro (sin el prefijo data:...) */
export function archivoABase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
