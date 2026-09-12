// js/ubicaciones.js
// Ubicación física en Kacosa por material. Vive en Supabase (tabla "UBICACIONES",
// columna "Material" para relacionar) y se administra ahí directamente — agregar
// o editar una ubicación no requiere tocar código ni volver a desplegar.
//
// NOTA: requiere una acción nueva en el Apps Script (bridge), "leerUbicaciones",
// análoga a "leerFactoresConversion" / "leerPaquetes", que lea la tabla
// "UBICACIONES" de Supabase y devuelva { ok: true, ubicaciones: [{ material, ubicacion }, ...] }.
//
// (11-sep-2026) Antes, si esta llamada fallaba (timeout, arranque en frío de
// Apps Script, etc.) se daba por vencida al primer intento y quedaba en
// silencio total: el caché quedaba vacío y obtenerUbicacion() devolvía ""
// para todo el análisis, sin que nadie se enterara — eso explicaba que a
// veces las ubicaciones cargaran y otras veces no. Ahora reintenta un par de
// veces antes de rendirse, y expone huboErrorUbicaciones() para que quien
// llame pueda avisarle al usuario si de verdad no se pudo cargar.
import { callBridge } from "./bridge.js";

let cache = null; // Map material -> ubicación, una vez cargada desde Supabase
let cargaEnCurso = null;
let ultimaCargaFallo = false;

const INTENTOS_MAXIMOS = 3;
const ESPERA_ENTRE_INTENTOS_MS = 800;

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Carga (o recarga) las ubicaciones desde Supabase y las deja en caché en
 * memoria para el resto de la sesión. Llamarla antes de calcular el
 * abastecimiento. Reintenta hasta INTENTOS_MAXIMOS veces si falla antes de
 * rendirse; si aun así falla, la caché queda vacía y obtenerUbicacion()
 * devuelve "" para todo, en vez de romper el análisis — pero
 * huboErrorUbicaciones() devolverá true para que se pueda avisar.
 */
export async function cargarUbicaciones() {
  if (cargaEnCurso) return cargaEnCurso; // evita cargas duplicadas en paralelo

  cargaEnCurso = (async () => {
    let ultimoError = null;
    for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
      try {
        const resp = await callBridge("leerUbicaciones", {});
        if (!resp.ok) throw new Error(resp.error || "Respuesta sin ok:true");

        const mapa = new Map();
        (resp.ubicaciones || []).forEach(u => {
          const material = String(u.material ?? u.Material ?? "").trim();
          const ubicacion = u.ubicacion ?? u.Ubicacion ?? u["Ubicación"] ?? "";
          if (material) mapa.set(material, ubicacion);
        });
        cache = mapa;
        ultimaCargaFallo = false;
        cargaEnCurso = null;
        return;
      } catch (err) {
        ultimoError = err;
        console.warn(`Intento ${intento}/${INTENTOS_MAXIMOS} de cargar ubicaciones falló:`, err);
        if (intento < INTENTOS_MAXIMOS) await esperar(ESPERA_ENTRE_INTENTOS_MS * intento);
      }
    }
    console.error("No se pudieron cargar las ubicaciones tras " + INTENTOS_MAXIMOS + " intentos:", ultimoError);
    cache = new Map(); // caché vacía: obtenerUbicacion() devuelve "" para todo
    ultimaCargaFallo = true;
    cargaEnCurso = null;
  })();

  return cargaEnCurso;
}

/** true si el último cargarUbicaciones() terminó fallando tras todos los reintentos. */
export function huboErrorUbicaciones() {
  return ultimaCargaFallo;
}

/** Devuelve la ubicación Kacosa de un material. "" si no está mapeado o aún no se cargó la caché. */
export function obtenerUbicacion(codigoMaterial) {
  if (!cache) return ""; // aún no se llamó a cargarUbicaciones()
  return cache.get(String(codigoMaterial)) || "";
}
