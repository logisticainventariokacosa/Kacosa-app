// js/pendientes-sync-parser.js
// Materiales pendientes por sincronizar: igual que ventas/stock/notas, este
// archivo se descarga directo de SAP como .MHT — ya NO se arma a mano en
// Excel. La validación de que contenga todas las columnas de la exportación
// real de SAP vive en nuevo-analisis.js (ver COLUMNAS_PENDIENTES_SYNC y
// validarColumnasArchivo()); la validación de que el centro/tienda del
// archivo corresponda a la tienda que se está analizando vive ahí también
// (ver validarCentroPendientesSync()).
import { aNumero } from "./mht-parser.js";

/**
 * Toma las filas ya parseadas del .MHT (parsearMHT) y devuelve un mapa
 * codigo -> cantidad pendiente por sincronizar, sumando el total por
 * material (un mismo código puede repetirse en varias filas — una por cada
 * factura/entrega pendiente de sincronizar).
 *
 * Solo se consideran las filas cuya columna "Tienda" coincide con el centro
 * que se está analizando. En la práctica el archivo ya debería venir
 * filtrado a un solo centro (se valida ANTES de llegar acá, ver
 * validarCentroPendientesSync en nuevo-analisis.js, que bloquea el archivo
 * completo si trae un centro distinto al de la tienda seleccionada); este
 * filtro es una segunda capa de seguridad por si la función se llama sin
 * pasar por esa validación.
 *
 * @param {Array<Object>} filas - salida de parsearMHT()
 * @param {Array<string>} centrosValidos - centros de la tienda que se está analizando
 * @returns {Object} codigo -> cantidad pendiente por sincronizar
 */
export function procesarPendientesSync(filas, centrosValidos) {
  const mapa = {};
  filas.forEach(f => {
    const tienda = String(f["Tienda"] ?? "").trim();
    if (!centrosValidos.includes(tienda)) return;

    const codigo = String(f["Material"] ?? "").trim();
    if (!codigo) return;

    const cantidad = aNumero(f["Cantidad"]);
    if (cantidad === 0) return;

    mapa[codigo] = (mapa[codigo] || 0) + cantidad;
  });
  return mapa;
}

/**
 * Resta las cantidades pendientes por sincronizar al stock de la tienda,
 * modificando stockTienda "en sitio". Si el material no existía en el stock
 * de la tienda (ej. ya se vendió todo), se crea con stock negativo — esto es
 * intencional: refleja que en realidad ya se debe MÁS de lo que el sistema muestra.
 * Devuelve la cantidad de materiales afectados (para mostrar en pantalla).
 */
export function restarPendientesSync(stockTienda, pendientesMap) {
  let afectados = 0;
  Object.entries(pendientesMap).forEach(([codigo, cantidad]) => {
    afectados++;
    if (stockTienda[codigo]) {
      stockTienda[codigo].stockDisponible -= cantidad;
    } else {
      stockTienda[codigo] = {
        codigo,
        descripcion: "",
        unidadBase: "UN",
        stockDisponible: -cantidad
      };
    }
  });
  return afectados;
}
