// js/deteccion-duplicados.js
import { callBridge } from "./bridge.js";

/** Normaliza texto para comparar: mayúsculas, sin acentos, sin espacios repetidos. */
function normalizar(texto) {
  return String(texto || "")
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrae todos los números de un texto, en orden, unidos como firma (ej. "370-440V CBB65-R" -> "370|440|65"). */
function firmaNumerica(texto) {
  const numeros = String(texto).match(/\d+([.,]\d+)?/g) || [];
  return numeros.join("|");
}

/** Similitud por coeficiente de Dice sobre bigramas de caracteres (rápido y suficiente para descripciones cortas). */
function similitud(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramas = (str) => {
    const s = new Set();
    for (let i = 0; i < str.length - 1; i++) s.add(str.slice(i, i + 2));
    return s;
  };

  const setA = bigramas(a);
  const setB = bigramas(b);
  let interseccion = 0;
  setA.forEach(bg => { if (setB.has(bg)) interseccion++; });

  return (2 * interseccion) / (setA.size + setB.size);
}

const UMBRAL_SIMILITUD = 0.75;

/**
 * Detecta grupos de materiales candidatos a ser duplicados, comparando solo
 * dentro de "cubetas" (mismo primer palabra normalizada) para que sea rápido
 * incluso con cientos de materiales.
 * @param {Array<{codigo, descripcion}>} materiales
 * @returns {Array<Array<{codigo, descripcion}>>} clusters con 2+ materiales candidatos
 */
export function detectarCandidatosLocal(materiales) {
  const normalizados = materiales.map(m => ({
    ...m,
    norm: normalizar(m.descripcion),
    firma: firmaNumerica(m.descripcion)
  }));

  // Cubetas por primera palabra para no comparar todo contra todo
  const cubetas = {};
  normalizados.forEach(m => {
    const primeraPalabra = m.norm.split(" ")[0] || "";
    if (!cubetas[primeraPalabra]) cubetas[primeraPalabra] = [];
    cubetas[primeraPalabra].push(m);
  });

  // Union-Find para agrupar candidatos transitivamente
  const padre = {};
  const encontrar = (x) => (padre[x] === x || !padre[x] ? (padre[x] = padre[x] || x) : (padre[x] = encontrar(padre[x])));
  const unir = (x, y) => { const rx = encontrar(x), ry = encontrar(y); if (rx !== ry) padre[rx] = ry; };

  materiales.forEach(m => { padre[m.codigo] = m.codigo; });

  Object.values(cubetas).forEach(grupo => {
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        if (grupo[i].codigo === grupo[j].codigo) continue;
        // Guardia numérica: si los números de la descripción difieren (ej. "40mfd" vs "50mfd",
        // o "110V" vs "220V"), NUNCA se consideran duplicados, sin importar qué tan parecido
        // sea el resto del texto. Esto evita fusionar variantes distintas de un mismo producto.
        if (grupo[i].firma !== grupo[j].firma) continue;
        if (similitud(grupo[i].norm, grupo[j].norm) >= UMBRAL_SIMILITUD) {
          unir(grupo[i].codigo, grupo[j].codigo);
        }
      }
    }
  });

  const clusters = {};
  materiales.forEach(m => {
    const raiz = encontrar(m.codigo);
    if (!clusters[raiz]) clusters[raiz] = [];
    clusters[raiz].push(m);
  });

  return Object.values(clusters).filter(c => c.length > 1);
}

/**
 * Toma los clusters candidatos (ya filtrados localmente) y le pide a Gemini
 * que confirme cuáles realmente son el mismo producto, con alta confianza.
 * @param {Array<Array<{codigo, descripcion}>>} clusters
 * @returns {Promise<{ok:boolean, grupos:Array<Array<string>>, razonamiento:string}>}
 */
export async function confirmarConGemini(clusters) {
  if (clusters.length === 0) {
    return { ok: true, grupos: [], razonamiento: "No se detectaron candidatos locales." };
  }

  // Aplanamos y limitamos para no exceder un prompt razonable
  const materialesPlanos = clusters.flat().slice(0, 300)
    .map(m => ({ codigo: m.codigo, descripcion: m.descripcion }));

  return await callBridge("resolveDuplicates", { materiales: materialesPlanos });
}

/**
 * Fusiona en los datos de ventas y stock los grupos de duplicados que el
 * usuario confirmó. El código "canónico" de cada grupo es el que tuvo mayor
 * venta (para conservar el nombre/descr. más relevante).
 *
 * @param {Object} ventasPorMaterial - objeto codigo -> {ventaNetaUnidadVenta, ventaNetaUnidadBase, ...}
 * @param {Object} stockTienda - objeto codigo -> {stockDisponible, ...}
 * @param {Object} stockKacosa - objeto codigo -> {stockDisponible, ...}
 * @param {Array<Array<string>>} gruposConfirmados - array de arrays de códigos confirmados como duplicados
 */
export function fusionarDuplicados(ventasPorMaterial, stockTienda, stockKacosa, gruposConfirmados) {
  gruposConfirmados.forEach(codigos => {
    const presentes = codigos.filter(c => ventasPorMaterial[c]);
    if (presentes.length < 2) return;

    // El canónico es el de mayor venta neta (unidad de venta)
    const canonico = presentes.reduce((mejor, c) =>
      ventasPorMaterial[c].ventaNetaUnidadVenta > ventasPorMaterial[mejor].ventaNetaUnidadVenta ? c : mejor
    , presentes[0]);

    presentes.forEach(c => {
      if (c === canonico) return;

      ventasPorMaterial[canonico].ventaNetaUnidadVenta += ventasPorMaterial[c].ventaNetaUnidadVenta;
      ventasPorMaterial[canonico].ventaNetaUnidadBase += ventasPorMaterial[c].ventaNetaUnidadBase;
      delete ventasPorMaterial[c];

      if (stockTienda[c]) {
        stockTienda[canonico] = stockTienda[canonico] || { stockDisponible: 0 };
        stockTienda[canonico].stockDisponible += stockTienda[c].stockDisponible;
        delete stockTienda[c];
      }
      if (stockKacosa[c]) {
        stockKacosa[canonico] = stockKacosa[canonico] || { stockDisponible: 0 };
        stockKacosa[canonico].stockDisponible += stockKacosa[c].stockDisponible;
        delete stockKacosa[c];
      }
    });
  });

  return { ventasPorMaterial, stockTienda, stockKacosa };
}
