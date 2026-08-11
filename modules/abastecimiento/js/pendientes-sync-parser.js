// js/pendientes-sync-parser.js
// Este archivo lo arma manualmente el usuario en Excel real (.xlsx), a diferencia
// de los otros que son exportaciones .MHT de SAP. Por eso se lee con SheetJS
// directamente. Columnas relevantes: "Material" y "Cantidad_por_sincronizar"
// (puede tener otras columnas de más, se ignoran).

/** Lee un archivo .xlsx real y devuelve un array de objetos usando la primera fila como encabezados. */
export async function leerXLSXGenerico(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const primeraHoja = wb.SheetNames[0];
  const ws = wb.Sheets[primeraHoja];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

/**
 * Toma las filas ya leídas y devuelve un mapa codigo -> cantidad pendiente por sincronizar
 * (sumando si un material aparece en más de una fila).
 */
export function procesarPendientesSync(filas) {
  const mapa = {};
  filas.forEach(f => {
    const codigo = String(f["Material"] ?? "").trim();
    if (!codigo) return;
    const cantidad = Number(f["Cantidad_por_sincronizar"]) || 0;
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
