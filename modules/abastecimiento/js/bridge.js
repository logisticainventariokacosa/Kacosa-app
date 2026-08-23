// js/bridge.js
// Punto único de comunicación con el Apps Script (Gemini, Sheets, Drive, Email).
import { auth } from "./firebase-config.js";
import { getIdToken } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// URL de tu implementación /exec del Apps Script
const BRIDGE_URL = "https://script.google.com/macros/s/AKfycbw6A3DVq4zgEp0ekfOFawtjzw0rFogHMjcs95x4bHLyxOOWmqyChiJNI0rpdPpiV0fQ/exec";

/**
 * Llama a una acción del bridge. Cada petición se autoriza con el idToken de
 * Firebase del usuario logueado (verificado por Google del lado del backend,
 * ver verificarAutorizacion_ en Code.gs). Ya no se manda ningún token fijo —
 * se retiró tras confirmar en producción, con 4 usuarios y 6 sesiones
 * distintas, que el idToken funciona de forma consistente (22-ago-2026).
 * @param {string} action - nombre de la acción (ej. "guardarAnalisis")
 * @param {object} payload - datos adicionales para esa acción
 * @returns {Promise<object>} - respuesta parseada del bridge ({ ok, ...datos })
 */
export async function callBridge(action, payload = {}) {
  try {
    if (!auth.currentUser) {
      return { ok: false, error: "No hay sesión activa. Vuelve a iniciar sesión." };
    }

    let idToken;
    try {
      idToken = await getIdToken(auth.currentUser);
    } catch (err) {
      return { ok: false, error: "No se pudo verificar tu sesión: " + err.message };
    }

    const resp = await fetch(BRIDGE_URL, {
      method: "POST",
      // "text/plain" evita el preflight OPTIONS, que Apps Script no maneja bien
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, idToken, ...payload })
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
