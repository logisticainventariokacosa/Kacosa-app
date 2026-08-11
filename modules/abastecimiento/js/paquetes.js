// js/paquetes.js
// Carga la lista de paquetes/empaque (cuántas unidades trae cada caja/paquete
// por material) una sola vez y la deja en caché en memoria. Antes venía de un
// archivo estático (data/paquetes.json); ahora se administra directamente en
// Supabase (tabla "paquetes", Table Editor) sin tocar código ni redesplegar.
import { callBridge } from "./bridge.js";

let cachePaquetes = null;
let cargaEnCurso = null;

export async function cargarPaquetes() {
  if (cachePaquetes) return cachePaquetes;
  if (cargaEnCurso) return cargaEnCurso;

  cargaEnCurso = (async () => {
    try {
      const resp = await callBridge("leerPaquetes", {});
      const mapa = {};
      if (resp.ok) {
        (resp.paquetes || []).forEach(p => {
          mapa[String(p.material)] = { umb: p.umb, empaque: p.empaque, descripcion: p.descripcion };
        });
      } else {
        console.error("No se pudo cargar la lista de paquetes:", resp.error);
      }
      cachePaquetes = mapa;
      return mapa;
    } catch (err) {
      console.error("Error al cargar paquetes:", err);
      cachePaquetes = {}; // caché vacía: obtenerEmpaque() usará 1 para todo
      return cachePaquetes;
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
