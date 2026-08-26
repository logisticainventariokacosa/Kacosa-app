// js/factores-conversion.js
// Factores de conversión de unidad de venta a unidad base (UMB), para poder
// calcular el "a pedir" siempre en la UMB del material.
//
// Hay DOS tablas en Supabase, consultadas en este orden de prioridad:
//
//  1) "factores_conversion" (material + unidad_venta -> factor): para casos
//     donde el contenido del empaque/caja varía POR CÓDIGO aunque la UMB sea
//     la misma (ej. Khaledflex: todos con UMB "UN", pero cada código trae una
//     cantidad distinta por caja/CAR).
//
//  2) "factores_conversion_umb" (umb + unidad_venta -> factor): genérica, para
//     casos donde la conversión es siempre la misma sin importar el material,
//     solo depende de la UMB (ej. cualquier material con UMB "RO6" convierte
//     igual desde "M"; cualquiera con UMB "BO3" convierte igual desde "KG"/"G").
//     Se usa como respaldo cuando no hay un factor específico por material.
//
// Si no se encuentra en ninguna de las dos, se usa 1 (sin conversión).
import { callBridge } from "./bridge.js";

let cache = null;    // Map "codigo|UNIDAD" -> factor (por material)
let cacheUMB = null; // Map "UMB|UNIDAD" -> factor (genérico por UMB)
let cargaEnCurso = null;

/**
 * Normaliza una unidad de medida para compararla o usarla como llave de caché:
 * sin espacios sobrantes y en mayúsculas. Evita falsos positivos en la
 * detección de "unidad distinta a la UMB" cuando en realidad es la MISMA
 * unidad pero escrita distinto entre el archivo de ventas, el de stock, o lo
 * cargado en Supabase (ej. "Un" vs "UN ", "un" vs "UN").
 */
function normalizarUnidad(u) {
  return String(u || "").trim().toUpperCase();
}
export { normalizarUnidad };

/**
 * Carga (o recarga) ambas tablas de factores de conversión desde Supabase y las
 * deja en caché en memoria para el resto de la sesión. Llamarla antes de procesar
 * un archivo de ventas/movimientos. Si falla la carga, la caché queda vacía y
 * obtenerFactor() simplemente usa 1 (sin conversión) para todo, en vez de romper
 * el análisis.
 */
export async function cargarFactoresConversion() {
  if (cargaEnCurso) return cargaEnCurso; // evita cargas duplicadas en paralelo

  cargaEnCurso = (async () => {
    try {
      const [respMaterial, respUMB] = await Promise.all([
        callBridge("leerFactoresConversion", {}),
        callBridge("leerFactoresConversionUMB", {})
      ]);

      const mapa = new Map();
      if (respMaterial.ok) {
        (respMaterial.factores || []).forEach(f => {
          mapa.set(`${f.material}|${normalizarUnidad(f.unidadVenta)}`, Number(f.factor) || 1);
        });
      } else {
        console.error("No se pudieron cargar los factores de conversión por material:", respMaterial.error);
      }
      cache = mapa;

      const mapaUMB = new Map();
      if (respUMB.ok) {
        (respUMB.factoresUMB || []).forEach(f => {
          mapaUMB.set(`${normalizarUnidad(f.umb)}|${normalizarUnidad(f.unidadVenta)}`, Number(f.factor) || 1);
        });
      } else {
        console.error("No se pudieron cargar los factores de conversión por UMB:", respUMB.error);
      }
      cacheUMB = mapaUMB;
    } catch (err) {
      console.error("Error al cargar factores de conversión:", err);
      cache = new Map();    // caché vacía: obtenerFactor() usará 1 para todo
      cacheUMB = new Map();
    } finally {
      cargaEnCurso = null;
    }
  })();

  return cargaEnCurso;
}

/**
 * Devuelve el factor de conversión de una unidad de venta a la unidad base de
 * un material. Busca primero el factor específico por material; si no existe,
 * busca el genérico por UMB (si se pasó la UMB del material); si tampoco existe,
 * devuelve 1 (sin conversión) o si aún no se cargó la caché.
 *
 * @param {string} codigoMaterial
 * @param {string} unidadVenta - unidad en que se registró la venta/movimiento
 * @param {string} [umbMaterial] - UMB del material (tomada del stock Kacosa/tienda);
 *   si no se pasa, se omite el paso 2 (fallback genérico por UMB)
 */
export function obtenerFactor(codigoMaterial, unidadVenta, umbMaterial) {
  const unidad = normalizarUnidad(unidadVenta);
  if (cache && cache.has(`${codigoMaterial}|${unidad}`)) {
    return cache.get(`${codigoMaterial}|${unidad}`);
  }
  if (umbMaterial && cacheUMB && cacheUMB.has(`${normalizarUnidad(umbMaterial)}|${unidad}`)) {
    return cacheUMB.get(`${normalizarUnidad(umbMaterial)}|${unidad}`);
  }
  return 1;
}

/**
 * Indica si existe una fila EXPLÍCITA (por material o por UMB genérica) para esa
 * combinación de unidad de venta (a diferencia de obtenerFactor, que siempre
 * devuelve un número usable). Sirve para distinguir "no necesita conversión"
 * (unidad de venta = UMB, factor 1 real) de "falta configurar el factor" (cayó
 * en el 1 por defecto sin que nadie lo sepa).
 */
export function tieneFactor(codigoMaterial, unidadVenta, umbMaterial) {
  const unidad = normalizarUnidad(unidadVenta);
  if (cache && cache.has(`${codigoMaterial}|${unidad}`)) return true;
  if (umbMaterial && cacheUMB && cacheUMB.has(`${normalizarUnidad(umbMaterial)}|${unidad}`)) return true;
  return false;
}
