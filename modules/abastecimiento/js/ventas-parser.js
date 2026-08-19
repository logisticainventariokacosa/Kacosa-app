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
 * @returns {{ porMaterial: Object, rangoFechas: {inicio:Date, fin:Date, semanas:number, meses:number} }}
 */
export function procesarVentas(filas) {
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
  // Alerta silenciosa: materiales que se vendieron en MÁS DE UNA unidad distinta y a
  // los que les falta el factor de conversión de alguna de esas unidades en Supabase.
  // Si un material solo se vende en una unidad, factor=1 por defecto es correcto (esa
  // unidad ES la base) — por eso solo se marca cuando hay mezcla de unidades, que es
  // el escenario donde un factor faltante realmente distorsiona el cálculo.
  const advertenciasFactor = [];

  Object.values(porMaterial).forEach(m => {
    // Unidad "principal" = la que más filas tuvo (normalmente solo hay una)
    const unidadPrincipal = Object.keys(m.conteoFilasPorUnidad)
      .sort((a, b) => m.conteoFilasPorUnidad[b] - m.conteoFilasPorUnidad[a])[0];

    // Venta neta total en unidad de venta (suma de TODAS las unidades registradas, sin convertir)
    const sumaSignedTotal = Object.values(m.unidades).reduce((acc, v) => acc + v, 0);
    const ventaNetaUnidadVenta = Math.abs(sumaSignedTotal);

    // Venta neta convertida a unidad base: se convierte cada grupo (unidad) por su propio factor
    const unidadesDelMaterial = Object.keys(m.unidades);
    let ventaNetaUnidadBase = 0;
    unidadesDelMaterial.forEach(unidad => {
      const sumaSigned = m.unidades[unidad];
      const factor = obtenerFactor(m.codigo, unidad);
      ventaNetaUnidadBase += sumaSigned / factor;

      if (unidadesDelMaterial.length > 1 && !tieneFactor(m.codigo, unidad)) {
        advertenciasFactor.push({ codigo: m.codigo, descripcion: m.descripcion, unidad });
      }
    });
    ventaNetaUnidadBase = Math.abs(ventaNetaUnidadBase);

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
