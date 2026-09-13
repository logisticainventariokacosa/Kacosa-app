// js/alta-rotacion.js
// Lee la tabla "alta_rotacion" de Supabase directo (antes vía Apps Script,
// acción "leerAltaRotacion"). Se usa desde Nuevo Análisis (sin filtro de
// categoría) y desde Alertas Kacosa (filtrando por categoría de tienda).
import { supabaseSelectTodo } from "./supabase-client.js";
import { esCodigoExcluido, cargarCodigosExcluidos } from "./exclusiones.js";

/**
 * @param {Array<string>} [categoriasExcluir] - categorías ('Ferretools'|'Kacosa'|'Tiendas')
 *   cuyos materiales NO se deben incluir. Los materiales sin categoría asignada
 *   (columna "tienda" vacía en alta_rotacion) nunca se excluyen.
 * @returns {Promise<Array<{codigo,descripcion,clase,empaque,tienda}>>}
 */
export async function cargarAltaRotacion(categoriasExcluir) {
  await cargarCodigosExcluidos();
  const filas = await supabaseSelectTodo("alta_rotacion", "select=codigo,descripcion,clase,empaque,tienda");

  let materiales = filas
    .map(f => ({ codigo: f.codigo, descripcion: f.descripcion || "", clase: f.clase || "", empaque: f.empaque || 1, tienda: f.tienda || "" }))
    .filter(m => !esCodigoExcluido(m.codigo)); // por si quedaron códigos que se excluyeron después

  if (categoriasExcluir && categoriasExcluir.length > 0) {
    materiales = materiales.filter(m => !m.tienda || !categoriasExcluir.includes(m.tienda));
  }

  return materiales;
}
