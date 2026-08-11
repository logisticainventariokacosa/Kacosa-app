// js/factores-conversion.js
// Factores de conversión (contenido del empaque/caja) por material y unidad de venta.
// Antes era un diccionario fijo escrito en este archivo; ahora vive en Supabase
// (tabla "factores_conversion") y se administra ahí directamente — agregar o
// editar un material ya no requiere tocar código ni volver a desplegar.
import { callBridge } from "./bridge.js";

let cache = null; // Map "codigo|unidad" -> factor, una vez cargada desde Supabase
let cargaEnCurso = null;

/**
 * Carga (o recarga) los factores de conversión desde Supabase y los deja en caché
 * en memoria para el resto de la sesión. Llamarla antes de procesar un archivo de
 * ventas/movimientos. Si falla la carga, la caché queda vacía y obtenerFactor()
 * simplemente usa 1 (sin conversión) para todo, en vez de romper el análisis.
 */
export async function cargarFactoresConversion() {
  if (cargaEnCurso) return cargaEnCurso; // evita cargas duplicadas en paralelo

  cargaEnCurso = (async () => {
    try {
      const resp = await callBridge("leerFactoresConversion", {});
      const mapa = new Map();
      if (resp.ok) {
        (resp.factores || []).forEach(f => {
          mapa.set(`${f.material}|${f.unidadVenta}`, Number(f.factor) || 1);
        });
      } else {
        console.error("No se pudieron cargar los factores de conversión:", resp.error);
      }
      cache = mapa;
    } catch (err) {
      console.error("Error al cargar factores de conversión:", err);
      cache = new Map(); // caché vacía: obtenerFactor() usará 1 para todo
    } finally {
      cargaEnCurso = null;
    }
  })();

  return cargaEnCurso;
}

/** Devuelve el factor de conversión para un material+unidad de venta. 1 si no está mapeado o aún no se cargó la caché. */
export function obtenerFactor(codigoMaterial, unidadVenta) {
  if (!cache) return 1; // aún no se llamó a cargarFactoresConversion()
  return cache.get(`${codigoMaterial}|${unidadVenta}`) || 1;
}
