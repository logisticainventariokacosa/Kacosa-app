// js/bridge.js
// Punto único de comunicación con el Apps Script (Gemini, Sheets, Drive, Email).
import { auth } from "./firebase-config.js";
import { getIdToken } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// URL de tu implementación /exec del Apps Script
const BRIDGE_URL = "https://script.google.com/macros/s/AKfycbw6A3DVq4zgEp0ekfOFawtjzw0rFogHMjcs95x4bHLyxOOWmqyChiJNI0rpdPpiV0fQ/exec";

// FASE DE TRANSICIÓN: este token fijo se mantiene por ahora como respaldo
// mientras se confirma que la verificación por idToken de Firebase funciona
// bien en producción (ver verificarAutorizacion_ en Code.gs). Una vez
// confirmado, se debe quitar esta constante y dejar de mandar "token" —
// TODO(seguridad): eliminar APP_TOKEN cuando se complete la fase 2.
const APP_TOKEN = "kacosa2026dr";

/**
 * Llama a una acción del bridge.
 * @param {string} action - nombre de la acción (ej. "guardarAnalisis")
 * @param {object} payload - datos adicionales para esa acción
 * @returns {Promise<object>} - respuesta parseada del bridge ({ ok, ...datos })
 */
export async function callBridge(action, payload = {}) {
  try {
    // Manda el idToken del usuario logueado (Firebase) además del token fijo
    // viejo. El backend intenta validar el idToken primero; si por lo que sea
    // no puede (red, token vencido en el momento exacto, etc.), cae de vuelta
    // al token fijo automáticamente — así este cambio nunca corta el flujo
    // existente, solo se suma una verificación más fuerte por encima.
    let idToken = null;
    if (auth.currentUser) {
      try {
        idToken = await getIdToken(auth.currentUser);
      } catch (err) {
        console.error("No se pudo obtener el idToken de Firebase (se seguirá usando el token de respaldo):", err);
      }
    }

    const resp = await fetch(BRIDGE_URL, {
      method: "POST",
      // "text/plain" evita el preflight OPTIONS, que Apps Script no maneja bien
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token: APP_TOKEN, idToken, ...payload })
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
