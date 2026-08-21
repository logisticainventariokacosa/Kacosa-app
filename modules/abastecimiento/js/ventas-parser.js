// js/ventas-parser.js
import { aNumero } from "./mht-parser.js";
import { obtenerFactor, tieneFactor } from "./factores-conversion.js";
import { esCodigoExcluido } from "./exclusiones.js";

// Clases de movimiento relevantes según SAP
const CLASES_VENTA = ["909", "601"];        // salidas por venta (negativas)
const CLASES_DEVOLUCION = ["910", "653", "651"]; // entradas por devolución (positivas)
const CLASES_RELEVANTES = [...CLASES_VENTA, ...CLASES_DEVOLUCION];

/**
 * Procesa las filas ya parseadas del archivo de ventas (salida de parsearMHT).
 * @param {Array<Object>} filas
 * @param {Object} [mapaUMBPorMaterial] - código -> UMB (unidad de medida base),
 *   tomado del stock Kacosa/tienda ANTES de llamar esta función. Se usa para
 *   resolver el factor de conversión genérico por UMB (ver factores-conversion.js)
 *   cuando no hay un factor específico configurado para ese material.
 * @returns {{ porMaterial: Object, rangoFechas: {inicio:Date, fin:Date, semanas:number, meses:number} }}
 */
export function procesarVentas(filas, mapaUMBPorMaterial = {}) {
  const porMaterial = {}; // codigo -> { descripcion, unidades: { unidad: sumaSigned }, unidadMasUsada }
  let fechaMin = null;
  let fechaMax = null;

  filas.forEach(f => {
    // Rango de fechas se calcula sobre TODO el archivo, sin importar la clase de movimiento
    const fecha = parsearFechaSAP(f["Fe.contabilización"]);
    if (fecha) {
      if (!fechaMin || fecha < fechaMin) fechaMin = fecha;
      if (!fechaMax || fecha > fechaMax) fechaMax = fecha;
    }

    const clase = String(f["Clase de movimiento"] || "").trim();
    if (!CLASES_RELEVANTES.includes(clase)) return; // ignora otros tipos de movimiento

    const codigo = String(f["Material"] || "").trim();
    if (!codigo) return;
    if (esCodigoExcluido(codigo)) return; // código en lista de exclusión: se ignora por completo

    const cantidad = aNumero(f["Ctd.en UM entrada"]);
    const unidad = String(f["Un.medida de entrada"] || "UN").trim();

    if (!porMaterial[codigo]) {
      porMaterial[codigo] = {
        codigo,
        descripcion: f["Texto breve de material"] || "",
        unidades: {}, // unidad -> suma signed de cantidades
        conteoFilasPorUnidad: {}
      };
    }
    const m = porMaterial[codigo];
    m.unidades[unidad] = (m.unidades[unidad] || 0) + cantidad;
    m.conteoFilasPorUnidad[unidad] = (m.conteoFilasPorUnidad[unidad] || 0) + 1;
  });

  // Calcula, por material: venta neta en unidad de venta (para clasificación ABCD)
  // y venta neta convertida a unidad base (para el cálculo del "a pedir")
  const resultado = {};
  // Alerta silenciosa: materiales cuya unidad de venta es DISTINTA a su UMB (unidad
  // de medida base, tomada del stock) y a los que les falta el factor de conversión
  // correspondiente — ni específico por material, ni genérico por UMB — en Supabase.
  // Si la unidad de venta coincide con la UMB, factor=1 por defecto es correcto (no
  // hace falta convertir) — por eso solo se marca cuando de verdad difieren y no hay
  // forma de convertir, que es el escenario donde un factor faltante distorsiona el
  // cálculo del "a pedir".
  const advertenciasFactor = [];

  Object.values(porMaterial).forEach(m => {
    // Unidad "principal" = la que más filas tuvo (normalmente solo hay una).
    // Es la unidad en la que se reporta el Total_Ventas y en la que se clasifica
    // el material (A/B/C/D).
    const unidadPrincipal = Object.keys(m.conteoFilasPorUnidad)
      .sort((a, b) => m.conteoFilasPorUnidad[b] - m.conteoFilasPorUnidad[a])[0];

    // --- CÁLCULO CORREGIDO ---
    // 1. Venta neta en unidad BASE:
    //    Se convierte CADA grupo de ventas por unidad usando su factor.
    const umbMaterial = mapaUMBPorMaterial[m.codigo];
    const unidadesDelMaterial = Object.keys(m.unidades);
    let ventaNetaUnidadBase = 0;
    unidadesDelMaterial.forEach(unidad => {
      const sumaSigned = m.unidades[unidad];
      // Obtiene el factor de conversión de 'unidad' a la UMB del material
      const factor = obtenerFactor(m.codigo, unidad, umbMaterial);
      // Si no hay factor definido y la unidad es diferente a la UMB, se registra la advertencia
      const difiereDeLaUMB = umbMaterial && unidad !== umbMaterial;
      if (difiereDeLaUMB && !tieneFactor(m.codigo, unidad, umbMaterial)) {
        advertenciasFactor.push({ codigo: m.codigo, descripcion: m.descripcion, unidad, umb: umbMaterial });
      }
      // El factor se aplica para convertir a la unidad base. Si el factor es 1 (porque no existe
      // o porque unidad === UMB), la conversión es directa.
      ventaNetaUnidadBase += sumaSigned / factor;
    });
    ventaNetaUnidadBase = Math.abs(ventaNetaUnidadBase);

    // 2. Venta neta en unidad de VENTA (Total_Ventas / clasificación ABCD):
    //    Se calcula DIRECTAMENTE en la unidad de venta principal (sin pasar por UMB).
    //    Esto resuelve el problema donde la venta en "M" se sumaba a la venta en "UN" sin convertir.
    const unidadesVenta = Object.keys(m.unidades);
    let ventaNetaUnidadVenta = 0;
    unidadesVenta.forEach(unidad => {
      const sumaSigned = m.unidades[unidad];
      // Si la unidad de venta es la misma que la principal, se suma directamente.
      // Si hay ventas en otras unidades, se convierten a la unidad principal.
      if (unidad === unidadPrincipal) {
        ventaNetaUnidadVenta += sumaSigned;
      } else {
        // Para convertir de 'unidad' a 'unidadPrincipal', se usa el factor inverso:
        // factor = (cantidad en unidadPrincipal) / (cantidad en unidad)
        // O más fácil: convertir 'unidad' a UMB (usando factorUMB_unidad) y luego a 'unidadPrincipal'
        // usando el factor de 'unidadPrincipal' a UMB.
        // Factor de 'unidad' a UMB: factorUMB_unidad
        // Factor de 'unidadPrincipal' a UMB: factorUMB_principal
        // cantidad_en_unidadPrincipal = cantidad_en_unidad * (factorUMB_unidad / factorUMB_principal)
        const factorUnidad = obtenerFactor(m.codigo, unidad, umbMaterial);
        const factorPrincipal = obtenerFactor(m.codigo, unidadPrincipal, umbMaterial);
        if (factorPrincipal !== 0) {
          ventaNetaUnidadVenta += sumaSigned * (factorUnidad / factorPrincipal);
        } else {
          // Fallback: si no se puede convertir, se suma como está (esto no debería pasar)
          ventaNetaUnidadVenta += sumaSigned;
        }
      }
    });
    ventaNetaUnidadVenta = Math.abs(ventaNetaUnidadVenta);

    resultado[m.codigo] = {
      codigo: m.codigo,
      descripcion: m.descripcion,
      unidadVenta: unidadPrincipal || "UN",
      ventaNetaUnidadVenta: redondear(ventaNetaUnidadVenta),
      ventaNetaUnidadBase: redondear(ventaNetaUnidadBase)
    };
  });

  const diasTotales = fechaMin && fechaMax ? Math.max(1, diasEntre(fechaMin, fechaMax)) : 7;
  const semanas = diasTotales / 7;
  const meses = diasTotales / 30.44;

  return {
    porMaterial: resultado,
    rangoFechas: { inicio: fechaMin, fin: fechaMax, semanas, meses },
    advertenciasFactor
  };
}

/** SAP suele exportar la fecha como DD.MM.AAAA o similar; intentamos varios formatos comunes. */
function parsearFechaSAP(valor) {
  if (!valor) return null;
  const texto = String(valor).trim();

  // Formato DD.MM.AAAA
  let m = texto.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  // Formato AAAA-MM-DD (x:num a veces trae este formato)
  m = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // Formato DD/MM/AAAA
  m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  const fechaGenerica = new Date(texto);
  return isNaN(fechaGenerica) ? null : fechaGenerica;
}

function diasEntre(a, b) {
  return Math.abs((b - a) / (1000 * 60 * 60 * 24));
}

function redondear(n) {
  return Math.round(n * 100) / 100;
}
