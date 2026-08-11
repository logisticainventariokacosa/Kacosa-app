// js/exclusiones.js
// Lista central de códigos que deben IGNORARSE en:
//   - Nuevo Análisis (cálculo de "a pedir", clasificación ABCD, etc.)
//   - Alertas Kacosa (cruce contra Alta Rotación)
//   - Inserción en el listado de Alta Rotación
//
// Para agregar más códigos en el futuro, simplemente añade la línea
// correspondiente al arreglo de abajo (como texto, entre comillas).

export const CODIGOS_EXCLUIDOS = [
  "759",
  "441",
  "480",
  "1000023512",
  "3000000013",
  "449",
  "3000000439",
  "715"
];

const SET_EXCLUIDOS = new Set(CODIGOS_EXCLUIDOS.map(c => String(c).trim()));

/**
 * Indica si un código de material debe ser ignorado en cálculos y listados.
 * @param {string|number} codigo
 * @returns {boolean}
 */
export function esCodigoExcluido(codigo) {
  return SET_EXCLUIDOS.has(String(codigo).trim());
}
