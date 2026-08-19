// js/ubicaciones.js
// Ubicación física en Kacosa por material. Vive en Supabase (tabla "UBICACIONES",
// columna "Material" para relacionar) y se administra ahí directamente — agregar
// o editar una ubicación no requiere tocar código ni volver a desplegar.
//
// NOTA: requiere una acción nueva en el Apps Script (bridge), "leerUbicaciones",
// análoga a "leerFactoresConversion" / "leerPaquetes", que lea la tabla
// "UBICACIONES" de Supabase y devuelva { ok: true, ubicaciones: [{ material, ubicacion }, ...] }.
// Mientras esa acción no exista en el bridge, esta carga simplemente falla en
// silencio (se registra en consola) y obtenerUbicacion() devuelve "" para todo,
// sin romper el análisis.
import { callBridge } from "./bridge.js";

let cache = null; // Map material -> ubicación, una vez cargada desde Supabase
let cargaEnCurso = null;

/**
 * Carga (o recarga) las ubicaciones desde Supabase y las deja en caché en
 * memoria para el resto de la sesión. Llamarla antes de calcular el
 * abastecimiento. Si falla la carga, la caché queda vacía y obtenerUbicacion()
 * simplemente devuelve "" para todo, en vez de romper el análisis.
 */
export async function cargarUbicaciones() {
  if (cargaEnCurso) return cargaEnCurso; // evita cargas duplicadas en paralelo

  cargaEnCurso = (async () => {
    try {
      const resp = await callBridge("leerUbicaciones", {});
      const mapa = new Map();
      if (resp.ok) {
        (resp.ubicaciones || []).forEach(u => {
          const material = String(u.material ?? u.Material ?? "").trim();
          const ubicacion = u.ubicacion ?? u.Ubicacion ?? u["Ubicación"] ?? "";
          if (material) mapa.set(material, ubicacion);
        });
      } else {
        console.error("No se pudieron cargar las ubicaciones:", resp.error);
      }
      cache = mapa;
    } catch (err) {
      console.error("Error al cargar ubicaciones:", err);
      cache = new Map(); // caché vacía: obtenerUbicacion() devuelve "" para todo
    } finally {
      cargaEnCurso = null;
    }
  })();

  return cargaEnCurso;
}

/** Devuelve la ubicación Kacosa de un material. "" si no está mapeado o aún no se cargó la caché. */
export function obtenerUbicacion(codigoMaterial) {
  if (!cache) return ""; // aún no se llamó a cargarUbicaciones()
  return cache.get(String(codigoMaterial)) || "";
}
