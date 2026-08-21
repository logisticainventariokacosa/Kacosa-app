// js/calculo-abastecimiento.js
import { obtenerEmpaque } from "./paquetes.js";
import { obtenerUbicacion } from "./ubicaciones.js";

/**
 * Clasifica un material según su tasa de venta (en unidad de venta, NO base),
 * normalizada a semana o mes.
 * @param {number} tasa - ventaNetaUnidadVenta / semanas  ó  / meses
 * @param {"semanal"|"mensual"} modo
 */
export function clasificar(tasa, modo) {
  if (modo === "semanal") {
    if (tasa >= 7) return "A";
    if (tasa >= 3) return "B";
    if (tasa >= 1) return "C";
    return "D";
  }
  // modo mensual
  if (tasa >= 30) return "A";
  if (tasa >= 15) return "B";
  if (tasa >= 1) return "C";
  return "D";
}

/**
 * Calcula el "a pedir" completo para todos los materiales que tuvieron venta.
 *
 * @param {Object} params
 * @param {Object} params.ventasProcesadas - salida de procesarVentas() (js/ventas-parser.js)
 * @param {Object} params.stockTienda - salida de agruparStock() para la tienda
 * @param {Object} params.stockKacosa - salida de agruparStock() para Kacosa (centros 1000+3000)
 * @param {"semana"|"mes"|"meses"} params.periodo - horizonte de abastecimiento elegido por el usuario
 * @param {number} params.mesesCantidad - solo si periodo === "meses" (ej. 3)
 * @param {number} params.margenPct - 10 a 100
 * @returns {Array<Object>} lista de materiales con su análisis completo
 */
export function calcularAbastecimiento({ ventasProcesadas, stockTienda, stockKacosa, periodo, mesesCantidad, margenPct }) {
  const { porMaterial, rangoFechas } = ventasProcesadas;
  const modoClasificacion = periodo === "semana" ? "semanal" : "mensual";

  // Periodo_Ventas: redondeado a número ENTERO (sin decimales), en la unidad correspondiente
  const periodoVentas = modoClasificacion === "semanal"
    ? `${Math.round(rangoFechas.semanas)} semana(s)`
    : `${Math.round(rangoFechas.meses)} mes(es)`;

  // Periodo_Abastecimiento: para cuánto alcanza el "a pedir" (lo que eligió el usuario)
  const periodoAbastecimiento = periodo === "semana"
    ? "1 semana"
    : periodo === "mes"
    ? "1 mes"
    : `${mesesCantidad || 1} mes(es)`;

  const rangoSeguridadUsado = `${margenPct || 0} %`;

  const resultado = [];

  Object.values(porMaterial).forEach(v => {
    // --- Clasificación ABCD (con unidad de venta, no la base) — usa el valor SIN redondear ---
    const tasaClasificacion = modoClasificacion === "semanal"
      ? v.ventaNetaUnidadVenta / rangoFechas.semanas
      : v.ventaNetaUnidadVenta / rangoFechas.meses;
    const clase = clasificar(tasaClasificacion, modoClasificacion);

    // --- Demanda promedio por periodo (en unidad BASE) ---
    const tasaBaseSemanal = v.ventaNetaUnidadBase / rangoFechas.semanas;
    const tasaBaseMensual = v.ventaNetaUnidadBase / rangoFechas.meses;

    let demandaPeriodo;
    if (periodo === "semana") demandaPeriodo = tasaBaseSemanal;
    else if (periodo === "mes") demandaPeriodo = tasaBaseMensual;
    else demandaPeriodo = tasaBaseMensual * (mesesCantidad || 1); // "meses" custom

    // --- Margen de seguridad ---
    const demandaConMargen = demandaPeriodo * (1 + (margenPct || 0) / 100);

    // --- Resta el stock disponible en tienda (sin tope de Kacosa todavía) ---
    const infoTienda = stockTienda[v.codigo];
    const stockTiendaDisp = infoTienda ? infoTienda.stockDisponible : 0;
    const aPedirBruto = Math.max(0, demandaConMargen - stockTiendaDisp);

    const empaque = obtenerEmpaque(v.codigo);
    const infoKacosa = stockKacosa[v.codigo];
    const stockKacosaDisp = infoKacosa ? infoKacosa.stockDisponible : 0;

    // --- Desglose de stock Kacosa por centro (solo para mostrar; el cálculo sigue usando la suma) ---
    const stockKacosa1000 = infoKacosa?.stockPorCentro?.["1000"] || 0;
    const stockKacosa3000 = infoKacosa?.stockPorCentro?.["3000"] || 0;
    // UMB (unidad de medida base): se extrae del archivo de stock Kacosa; si el
    // material no aparece ahí, se usa el de stock tienda como respaldo; si tampoco
    // está ahí, se usa "UN" por defecto en vez de dejarlo vacío.
    const umb = infoKacosa?.unidadBase || infoTienda?.unidadBase || "UN";
    const ubicacionKacosa = obtenerUbicacion(v.codigo);

    // --- "Ideal": lo que se pediría si Kacosa tuviera stock ilimitado ---
    const aPedirIdealEnteros = Math.ceil(aPedirBruto);
    const aPedirIdeal = (empaque > 1 && aPedirIdealEnteros > 0)
      ? Math.ceil(aPedirIdealEnteros / empaque) * empaque
      : aPedirIdealEnteros;

    // --- Tope real por stock disponible en Kacosa ---
    const aPedirTopado = Math.min(aPedirBruto, stockKacosaDisp);
    const aPedirEnteros = Math.ceil(aPedirTopado);

    let aPedirFinal = aPedirEnteros;
    if (empaque > 1 && aPedirEnteros > 0) {
      const candidatoRedondeado = Math.ceil(aPedirEnteros / empaque) * empaque;
      aPedirFinal = candidatoRedondeado <= stockKacosaDisp ? candidatoRedondeado : aPedirEnteros;
    }

    const pendiente = Math.max(0, aPedirIdeal - aPedirFinal);

    resultado.push({
      codigo: v.codigo,
      descripcion: v.descripcion,
      unidadVenta: v.unidadVenta || "UN", // <-- NUEVA: unidad de medida en ventas
      umb: umb,
      clase,
      totalVentas: Math.round(v.ventaNetaUnidadVenta * 100) / 100,
      promedioVentasPeriodo: Math.round(tasaClasificacion * 100) / 100,
      stockTienda: stockTiendaDisp,
      stockKacosa1000,
      stockKacosa3000,
      stockKacosa: stockKacosaDisp,
      ubicacionKacosa,
      aPedir: aPedirFinal,
      aPedirIdeal,
      pendiente,
      empaque,
      periodoVentas,
      periodoAbastecimiento,
      rangoSeguridadUsado,
      materiales_fusionados: v.materiales_fusionados || [] // <-- NUEVA: códigos fusionados
    });
  });

  return resultado;
}
