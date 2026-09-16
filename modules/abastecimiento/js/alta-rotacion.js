// js/alta-rotacion.js
// Lee y alimenta la tabla "alta_rotacion" de Supabase directo (antes vía
// Apps Script, acciones "leerAltaRotacion" y la actualización automática
// dentro de "guardarAnalisis"). Se usa desde Nuevo Análisis (leer sin
// filtro + alimentar tras guardar) y desde Alertas Kacosa (leer filtrando
// por categoría de tienda).
import { supabaseSelectTodo, supabaseInsert } from "./supabase-client.js?v=1";
import { esCodigoExcluido, cargarCodigosExcluidos } from "./exclusiones.js?v=1";
import { categoriaDeTienda } from "./tiendas.js?v=1";

// Categorías de tienda usadas para clasificar Alta Rotación y Alertas Kacosa
const CATEGORIAS_TIENDA = ["Ferretools", "Kacosa", "Tiendas"];

/**
 * @param {string} [categoriaTienda] - categoría seleccionada ('Ferretools'|'Kacosa'|'Tiendas').
 *   Sin valor (o vacío): no filtra, trae TODO — así lo usa Nuevo Análisis.
 *   'Ferretools' | 'Kacosa': cada una tiene su propio almacén surtidor
 *   (Ferretools: centro 1020 · Kacosa: centros 1000/3000), separado del
 *   resto, así que se incluyen SOLO los materiales insertados con esa
 *   categoría exacta — se excluye todo lo demás, INCLUYENDO los materiales
 *   sin categoría asignada.
 *   'Tiendas': se excluyen Ferretools y Kacosa, pero los materiales sin
 *   categoría asignada (columna "tienda" vacía en alta_rotacion) se
 *   conservan siempre — comportamiento histórico, sin cambios.
 * @returns {Promise<Array<{codigo,descripcion,clase,empaque,tienda}>>}
 */
export async function cargarAltaRotacion(categoriaTienda) {
  await cargarCodigosExcluidos();
  const filas = await supabaseSelectTodo("alta_rotacion", "select=codigo,descripcion,clase,empaque,tienda");

  let materiales = filas
    .map(f => ({ codigo: f.codigo, descripcion: f.descripcion || "", clase: f.clase || "", empaque: f.empaque || 1, tienda: f.tienda || "" }))
    .filter(m => !esCodigoExcluido(m.codigo)); // por si quedaron códigos que se excluyeron después

  if (categoriaTienda === "Ferretools" || categoriaTienda === "Kacosa") {
    materiales = materiales.filter(m => m.tienda === categoriaTienda);
  } else if (categoriaTienda) {
    const categoriasExcluir = CATEGORIAS_TIENDA.filter(c => c !== categoriaTienda);
    materiales = materiales.filter(m => !m.tienda || !categoriasExcluir.includes(m.tienda));
  }

  return materiales;
}

/**
 * Alimenta Alta Rotación con los materiales Clase A/B de un análisis recién
 * guardado que todavía no estén ahí — replica exactamente
 * actualizarAltaRotacion_() (Apps Script). Se llama después de guardar el
 * análisis, nunca antes.
 * @param {Array} materiales - los mismos materiales que se acaban de guardar en "analisis"
 * @param {string} tienda - id de la tienda (para calcular su categoría)
 * @returns {Promise<{agregados: number}>}
 */
export async function actualizarAltaRotacion(materiales, tienda) {
  const categoria = categoriaDeTienda(tienda);

  const existentes = await supabaseSelectTodo("alta_rotacion", "select=codigo");
  const existentesSet = new Set(existentes.map(r => String(r.codigo)));

  await cargarCodigosExcluidos();
  const candidatosAB = materiales.filter(m =>
    (m.clase === "A" || m.clase === "B") &&
    !existentesSet.has(String(m.codigo)) &&
    !esCodigoExcluido(m.codigo)
  );

  const yaAgregadosEnEsteLote = new Set();
  const filas = [];
  candidatosAB.forEach(m => {
    const codigo = String(m.codigo).trim();
    if (!yaAgregadosEnEsteLote.has(codigo)) {
      yaAgregadosEnEsteLote.add(codigo);
      filas.push({
        codigo,
        descripcion: String(m.descripcion || ""),
        clase: String(m.clase || ""),
        empaque: Number(m.empaque) || 1,
        tienda: categoria
      });
    }
  });

  if (filas.length > 0) await supabaseInsert("alta_rotacion", filas);

  return { agregados: filas.length };
}
