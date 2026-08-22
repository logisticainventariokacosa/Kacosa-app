// js/exclusiones.js
// Códigos que deben IGNORARSE en Nuevo Análisis, Alertas Kacosa y Alta Rotación.
// Viven en Supabase (tabla "codigos_excluidos"), no hardcodeados en el código —
// así se pueden agregar/quitar códigos sin tocar ni redesplegar archivos, y el
// frontend y el backend (Code.gs) siempre ven exactamente la misma lista (antes
// estaban duplicadas a mano en dos archivos distintos y se desincronizaron).
import { callBridge } from "./bridge.js";

let cache = null;
let cargaEnCurso = null;

/**
 * Carga (o recarga) la lista de códigos excluidos desde Supabase y la deja en
 * caché en memoria para el resto de la sesión. Llamarla ANTES de cualquier
 * flujo que use esCodigoExcluido() (Nuevo Análisis, Alertas Kacosa), ya que
 * esCodigoExcluido() es síncrona y necesita la caché ya cargada.
 */
export async function cargarCodigosExcluidos() {
  if (cargaEnCurso) return cargaEnCurso;

  cargaEnCurso = (async () => {
    try {
      const resp = await callBridge("leerCodigosExcluidos", {});
      cache = new Set((resp.ok ? resp.codigos : []).map(c => String(c).trim()));
      if (!resp.ok) {
        console.error("No se pudieron cargar los códigos excluidos:", resp.error);
      }
    } catch (err) {
      console.error("Error al cargar códigos excluidos:", err);
      cache = new Set(); // fallo silencioso: no excluye nada en vez de romper el análisis
    } finally {
      cargaEnCurso = null;
    }
  })();

  return cargaEnCurso;
}

/**
 * Indica si un código de material debe ser ignorado en cálculos y listados.
 * Requiere haber llamado (y esperado) cargarCodigosExcluidos() antes.
 * @param {string|number} codigo
 * @returns {boolean}
 */
export function esCodigoExcluido(codigo) {
  if (!cache) {
    console.error("esCodigoExcluido() se llamó antes de cargarCodigosExcluidos() — no se excluyó ningún código para esta llamada.");
    return false;
  }
  return cache.has(String(codigo).trim());
}
