// js/paquetes.js
// Carga la lista de paquetes/empaque (cuántas unidades trae cada caja/paquete
// por material) una sola vez y la deja en caché en memoria. Antes venía de un
// archivo estático (data/paquetes.json); ahora se administra directamente en
// Supabase (tabla "paquetes", Table Editor) sin tocar código ni redesplegar.
import { supabaseSelectTodo } from "./supabase-client.js";

let cachePaquetes = null;
let cargaEnCurso = null;

/**
 * Carga (o recarga) la lista de paquetes/empaque desde Supabase.
 *
 * IMPORTANTE: si falla la carga, esta función LANZA un error en vez de seguir
 * con una lista vacía. Un fallo silencioso aquí hacía que obtenerEmpaque()
 * devolviera 1 para TODOS los materiales (como si ninguno viniera en caja/
 * paquete), lo que afecta directamente el redondeo del "a pedir" — mismo
 * problema de fondo que tenía cargarFactoresConversion().
 */
export async function cargarPaquetes() {
  if (cachePaquetes) return cachePaquetes;
  if (cargaEnCurso) return cargaEnCurso;

  cargaEnCurso = (async () => {
    try {
      const filas = await supabaseSelectTodo("paquetes", "select=material,umb,empaque,descripcion", 1000);
      const mapa = {};
      filas.forEach(p => {
        mapa[String(p.material)] = { umb: p.umb || "", empaque: Number(p.empaque) || 1, descripcion: p.descripcion || "" };
      });
      cachePaquetes = mapa;
      return mapa;
    } catch (err) {
      cachePaquetes = null;
      throw err;
    } finally {
      cargaEnCurso = null;
    }
  })();

  return cargaEnCurso;
}

/** Devuelve la cantidad de unidades por paquete/caja para un material. 1 si no está en la lista. */
export function obtenerEmpaque(codigo) {
  if (!cachePaquetes) return 1;
  const info = cachePaquetes[String(codigo)];
  return info ? Number(info.empaque) || 1 : 1;
}

/** Devuelve { umb, empaque, descripcion } o null si el material no está en la lista. */
export function obtenerInfoPaquete(codigo) {
  if (!cachePaquetes) return null;
  return cachePaquetes[String(codigo)] || null;
}
