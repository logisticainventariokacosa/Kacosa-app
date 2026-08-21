// js/deteccion-duplicados.js

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

// Colores conocidos: si dos descripciones mencionan colores DISTINTOS de esta
// lista, nunca se consideran duplicados (son SKUs distintos), sin importar
// qué tan parecido sea el resto del texto.
const COLORES_CONOCIDOS = [
  "BLANCO", "NEGRO", "GRIS", "AZUL", "ROJO", "VERDE", "AMARILLO",
  "MARRON", "BEIGE", "CREMA", "PLATA", "DORADO", "BRONCE", "MARFIL",
  "NARANJA", "MORADO", "VIOLETA"
];

/** Devuelve el primer color conocido mencionado en el texto normalizado, o null si no hay ninguno. */
function colorDetectado(textoNormalizado) {
  return COLORES_CONOCIDOS.find(c => textoNormalizado.includes(c)) || null;
}

// Reglas de palabra distintiva por categoría: aunque el resto de la descripción
// sea muy parecido, si UNA de las dos menciona la palabra clave y la otra no
// (dentro de la misma categoría/prefijo), son variantes distintas, no duplicados.
// Portado de las reglas que antes se le explicaban a Gemini en el prompt.
const REGLAS_PALABRA_DISTINTIVA = [
  { prefijo: "FILTRO SECADOR", palabra: "SOLD" }, // "Sold" = soldable
  { prefijo: "MOTOR VENT", palabra: "C PR" }       // "C/Pr" = con protector
];

/** true si, según las reglas de palabra distintiva, dos descripciones normalizadas de la
 *  misma categoría difieren en una característica que las distingue (no son duplicados). */
function difierenPorReglaEspecial(normA, normB) {
  return REGLAS_PALABRA_DISTINTIVA.some(regla => {
    if (!normA.startsWith(regla.prefijo) || !normB.startsWith(regla.prefijo)) return false;
    return normA.includes(regla.palabra) !== normB.includes(regla.palabra);
  });
}

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

        // Guardia de color: colores distintos = SKUs distintos.
        const colorI = colorDetectado(grupo[i].norm);
        const colorJ = colorDetectado(grupo[j].norm);
        if (colorI && colorJ && colorI !== colorJ) continue;

        // Guardia de palabra distintiva (ej. "Sold" en filtros secadores, "C/Pr" en
        // motores de ventilador): si una la menciona y la otra no, son variantes distintas.
        if (difierenPorReglaEspecial(grupo[i].norm, grupo[j].norm)) continue;

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

// NOTA: antes existía aquí confirmarConGemini(), que le pedía a Gemini
// confirmar los clusters candidatos. Se eliminó porque a veces la llamada al
// agente fallaba o no se ejecutaba, y el código lo trataba silenciosamente
// como "no hay duplicados" — dejando materiales sin fusionar sin avisar.
// Ahora los candidatos que arma detectarCandidatosLocal() se muestran
// directamente al usuario en la pantalla de revisión para que confirme
// manualmente cuáles fusionar (ver mostrarDuplicados() en nuevo-analisis.js).


/**
 * Fusiona en los datos de ventas y stock los grupos de duplicados que el
 * usuario confirmó. El código "canónico" de cada grupo se elige así: entre
 * los que tienen stock disponible en Kacosa, el de mayor venta neta; si
 * ninguno tiene stock en Kacosa, el de mayor venta neta de todo el grupo.
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

    // El canónico se elige así: entre los que SÍ tienen stock en Kacosa, el de
    // mayor venta neta; si ninguno tiene stock en Kacosa, entonces sí se usa el
    // de mayor venta neta de todo el grupo (comportamiento anterior).
    const conStockKacosa = presentes.filter(c => (stockKacosa[c]?.stockDisponible || 0) > 0);
    const candidatos = conStockKacosa.length > 0 ? conStockKacosa : presentes;
    const canonico = candidatos.reduce((mejor, c) =>
      ventasPorMaterial[c].ventaNetaUnidadVenta > ventasPorMaterial[mejor].ventaNetaUnidadVenta ? c : mejor
    , candidatos[0]);

    presentes.forEach(c => {
      if (c === canonico) return;

      ventasPorMaterial[canonico].ventaNetaUnidadVenta += ventasPorMaterial[c].ventaNetaUnidadVenta;
      ventasPorMaterial[canonico].ventaNetaUnidadBase += ventasPorMaterial[c].ventaNetaUnidadBase;
      delete ventasPorMaterial[c];

      if (stockTienda[c]) {
        stockTienda[canonico] = stockTienda[canonico] || { stockDisponible: 0, unidadBase: stockTienda[c].unidadBase };
        stockTienda[canonico].stockDisponible += stockTienda[c].stockDisponible;
        if (!stockTienda[canonico].unidadBase) stockTienda[canonico].unidadBase = stockTienda[c].unidadBase;
        delete stockTienda[c];
      }
      if (stockKacosa[c]) {
        stockKacosa[canonico] = stockKacosa[canonico] || { stockDisponible: 0, stockPorCentro: {}, unidadBase: stockKacosa[c].unidadBase };
        stockKacosa[canonico].stockDisponible += stockKacosa[c].stockDisponible;

        // Fusiona también el desglose por centro (Stock Kacosa 1000 / 3000) y
        // conserva la unidad base, para que las columnas nuevas no queden
        // desactualizadas tras fusionar duplicados.
        stockKacosa[canonico].stockPorCentro = stockKacosa[canonico].stockPorCentro || {};
        Object.entries(stockKacosa[c].stockPorCentro || {}).forEach(([centro, valor]) => {
          stockKacosa[canonico].stockPorCentro[centro] = (stockKacosa[canonico].stockPorCentro[centro] || 0) + valor;
        });
        if (!stockKacosa[canonico].unidadBase) stockKacosa[canonico].unidadBase = stockKacosa[c].unidadBase;

        delete stockKacosa[c];
      }
    });
  });

  return { ventasPorMaterial, stockTienda, stockKacosa };
}
