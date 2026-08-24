// js/nuevo-analisis.js
import { parsearMHT, aNumero } from "./mht-parser.js";
import { procesarVentas, adaptarFilasMovimientosDB, parsearFechaSAP } from "./ventas-parser.js";
import { cargarFactoresConversion } from "./factores-conversion.js";
import { cargarCodigosExcluidos } from "./exclusiones.js";
import { agruparStock, procesarNotasPendientes } from "./stock-parser.js";
import { cargarPaquetes } from "./paquetes.js";
import { cargarUbicaciones, obtenerUbicacion } from "./ubicaciones.js";
import { calcularAbastecimiento } from "./calculo-abastecimiento.js";
import { detectarCandidatosLocal, fusionarDuplicados } from "./deteccion-duplicados.js";
import { TIENDAS, nombrePorId, centrosDeTienda } from "./tiendas.js";
import { callBridge } from "./bridge.js";
import { crearTablaPaginada } from "./tabla-utils.js";
import { notificarExito } from "./notificaciones.js";
import { construirHojaEstilizada, construirHojaResumen } from "./excel-estilos.js";
import { leerXLSXGenerico, procesarPendientesSync, restarPendientesSync } from "./pendientes-sync-parser.js";

const CENTROS_KACOSA = ["1000", "3000"];

// Configuración de cada input de archivo (se usa al construir el formulario
// y también para limpiarlo por completo con "Limpiar datos").
const CONFIG_ARCHIVOS = [
  { id: 'na-ventas', nameId: 'file-name-ventas', statusId: 'file-status-ventas', wrapperId: 'file-wrapper-ventas', validId: 'validacion-ventas', tipo: 'ventas', opcional: false },
  { id: 'na-stock-tienda', nameId: 'file-name-stock-tienda', statusId: 'file-status-stock-tienda', wrapperId: 'file-wrapper-stock-tienda', validId: 'validacion-stock-tienda', tipo: 'stock', opcional: false },
  { id: 'na-stock-kacosa', nameId: 'file-name-stock-kacosa', statusId: 'file-status-stock-kacosa', wrapperId: 'file-wrapper-stock-kacosa', validId: 'validacion-stock-kacosa', tipo: 'stock', opcional: false },
  { id: 'na-notas-pendientes', nameId: 'file-name-notas-pendientes', statusId: 'file-status-notas-pendientes', wrapperId: 'file-wrapper-notas-pendientes', validId: 'validacion-notas-pendientes', tipo: 'notas', opcional: true },
  { id: 'na-pendientes-sync', nameId: 'file-name-pendientes-sync', statusId: 'file-status-pendientes-sync', wrapperId: 'file-wrapper-pendientes-sync', validId: null, tipo: null, opcional: true }
];

// IDs de todos los campos del formulario que deben bloquearse mientras se procesa
// un análisis (para evitar cargas o cambios a mitad de proceso).
const IDS_CAMPOS_FORMULARIO = [
  'na-tienda', 'na-ventas', 'na-stock-tienda', 'na-stock-kacosa',
  'na-notas-pendientes', 'na-pendientes-sync', 'na-periodo', 'na-meses-cantidad', 'na-margen',
  'na-meses-analisis'
];

// Límites del rango de historial de ventas que el usuario puede elegir para
// el análisis (independiente del "horizonte de abastecimiento").
const MESES_ANALISIS_MIN = 3;
const MESES_ANALISIS_MAX = 12;
const MESES_ANALISIS_DEFECTO = 3;

// Margen de días que se tolera si el archivo de ventas trae movimientos con
// fecha anterior a la última ya registrada (SAP puede sincronizar movimientos
// backdateados días después). Debe coincidir con MARGEN_DIAS_MOVIMIENTOS en Code.gs.
const MARGEN_DIAS_MOVIMIENTOS = 30;

// Almacenes permitidos para el archivo de "Stock de la tienda": solo
// almacenes de general y exhibición. Cualquier otro almacén en el archivo
// (ej. de otra tienda, o un almacén interno no relevante) hace que se
// rechace el archivo completo — ver validarAlmacenesArchivo().
const ALMACENES_PERMITIDOS_STOCK_TIENDA = [
  "1200", "1203", "1300", "1303", "1400", "1403", "1500", "1503",
  "1600", "1603", "1700", "1703", "1900", "1903",
  "11A0", "11A3", "12A0", "12A3", "19A0", "19A3",
  "2010", "2013", "2017", "2090", "2093",
  "1020", "1023", "1000", "3000", "1029", "3029", "1001", "3001"
];

// Almacenes permitidos para el archivo de "Stock de Kacosa".
const ALMACENES_PERMITIDOS_STOCK_KACOSA = ["1000", "1029", "3000", "3029"];

/** Bloquea o desbloquea todos los campos del formulario (archivos, período, margen, tienda). */
function bloquearFormulario(bloquear) {
  IDS_CAMPOS_FORMULARIO.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = bloquear;
  });
}

// ============================================================
//  SINCRONIZACIÓN CON SUPABASE (stock y movimientos)
// ============================================================
/** Convierte las filas crudas de stock (tienda + Kacosa) al formato que espera "guardarStock". */
function prepararFilasStock(filasStockTienda, filasStockKacosa) {
  return [...filasStockTienda, ...filasStockKacosa].map(f => ({
    material: String(f["Material"] || "").trim(),
    centro: String(f["Centro"] || "").trim(),
    almacen: String(f["Almacén"] || "").trim(),
    textoBreve: f["Texto breve de material"] || "",
    unidadMedidaBase: f["Unidad medida base"] || "",
    denominacionAlmacen: f["Denominación-almacén"] || "",
    libreUtilizacion: aNumero(f["Libre utilización"]),
    transTrasl: aNumero(f["Trans./Trasl."]),
    enControlCalidad: aNumero(f["En control calidad"]),
    bloqueado: aNumero(f["Bloqueado"]),
    devoluciones: aNumero(f["Devoluciones"])
  })).filter(f => f.material && f.centro);
}

/** Convierte las filas crudas del archivo de ventas al formato que espera "guardarMovimientos". */
function prepararFilasMovimientos(filasVentas) {
  return filasVentas.map(f => ({
    material: String(f["Material"] || "").trim(),
    textoBreve: f["Texto breve de material"] || "",
    centro: String(f["Centro"] || "").trim(),
    almacen: String(f["Almacén"] || "").trim(),
    claseMovimiento: String(f["Clase de movimiento"] || "").trim(),
    documentoMaterial: String(f["Documento material"] || "").trim(),
    fechaContabilizacion: String(f["Fe.contabilización"] || "").trim(),
    horaEntrada: String(f["Hora de entrada"] || "").trim(),
    cantidadUmEntrada: aNumero(f["Ctd.en UM entrada"]),
    unidadMedidaEntrada: f["Un.medida de entrada"] || "",
    cliente: f["Cliente"] || "",
    nombreUsuario: f["Nombre del usuario"] || "",
    textoCabDocumento: f["Texto cab.documento"] || ""
  })).filter(f => f.material && f.centro);
}

/**
 * Envía las filas crudas de stock (tienda + Kacosa) a la tabla "stock" de Supabase.
 * Se ejecuta en segundo plano: si falla, solo se registra en consola y no interrumpe el análisis.
 * (El stock siempre se reescribe completo — a diferencia de movimientos, no hay carga incremental aquí.)
 */
function sincronizarStock(filasStockTienda, filasStockKacosa) {
  const filasStock = prepararFilasStock(filasStockTienda, filasStockKacosa);
  if (filasStock.length > 0) {
    callBridge("guardarStock", { filas: filasStock }).catch(err =>
      console.error("No se pudo sincronizar el stock con Supabase:", err)
    );
  }
}

// ============================================================
//  FECHAS: helpers para el rango de movimientos registrados
// ============================================================
/** "2026-07-27" -> "27/07/2026" (para mostrarle la fecha al usuario). */
function formatearFechaISOaVE(fechaISO) {
  if (!fechaISO) return "";
  const [a, m, d] = fechaISO.split("-");
  if (!a || !m || !d) return fechaISO;
  return `${d}/${m}/${a}`;
}

/** Date -> "AAAA-MM-DD" (para mandarle fechas a Supabase). */
function formatearFechaISO(fecha) {
  const a = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${a}-${m}-${d}`;
}

/** "2026-07-27" -> Date (medianoche local). */
function fechaISOaDate(fechaISO) {
  const [a, m, d] = fechaISO.split("-").map(Number);
  return new Date(a, m - 1, d);
}

/** Devuelve una nueva Date con "dias" sumados (puede ser negativo). */
function sumarDias(fecha, dias) {
  const copia = new Date(fecha);
  copia.setDate(copia.getDate() + dias);
  return copia;
}

/** Devuelve una nueva Date con "meses" sumados (puede ser negativo). */
function sumarMeses(fecha, meses) {
  const copia = new Date(fecha);
  copia.setMonth(copia.getMonth() + meses);
  return copia;
}

/** Cantidad de meses (redondeados, mínimo 1) entre dos fechas. */
function mesesEntreFechas(fechaInicio, fechaFin) {
  const msPorDia = 24 * 60 * 60 * 1000;
  const dias = Math.round((fechaFin - fechaInicio) / msPorDia);
  return Math.max(1, Math.round(dias / 30));
}

/** Ajusta un número de meses a los límites permitidos para el análisis (3-12). */
function clampMesesAnalisis(meses) {
  if (meses < MESES_ANALISIS_MIN) return MESES_ANALISIS_MIN;
  if (meses > MESES_ANALISIS_MAX) return MESES_ANALISIS_MAX;
  return meses;
}

/**
 * Fecha máxima real encontrada en un conjunto de filas (según "Fe.contabilización").
 * Se usa para anclar el rango de "mesesAnalisis" a la última venta REAL disponible,
 * en vez de a la fecha del sistema (new Date()) — ver ejecutarAnalisis(). Si el
 * análisis se corre varios días después de la última venta cargada (porque no hay
 * ventas más recientes que subir todavía), anclar al reloj del sistema hace que la
 * ventana de fechas se "deslice" hacia adelante sin ganar nada al final, perdiendo
 * silenciosamente los días más viejos del rango y dando un Total_Ventas distinto
 * (más bajo) según qué día se corra el análisis, aunque los datos no cambien.
 */
function fechaMaximaEnFilas(filas) {
  let fechaMax = null;
  filas.forEach(f => {
    const fecha = parsearFechaSAP(f["Fe.contabilización"]);
    if (fecha && (!fechaMax || fecha > fechaMax)) fechaMax = fecha;
  });
  return fechaMax;
}

/**
 * Primera carga para una tienda (sin historial en Supabase todavía): sugiere
 * automáticamente cuántos meses de análisis usar, a partir del propio rango
 * de fechas que trae el archivo recién adjuntado (min a máx), dentro de los
 * límites permitidos (3-12). El usuario puede cambiarlo a mano después.
 */
function sugerirMesesAnalisisDesdeArchivo(filas) {
  let fechaMin = null, fechaMax = null;
  filas.forEach(f => {
    const fecha = parsearFechaSAP(f["Fe.contabilización"]);
    if (!fecha) return;
    if (!fechaMin || fecha < fechaMin) fechaMin = fecha;
    if (!fechaMax || fecha > fechaMax) fechaMax = fecha;
  });
  if (!fechaMin || !fechaMax) return;
  const mesesAnalisisEl = document.getElementById("na-meses-analisis");
  if (mesesAnalisisEl) {
    mesesAnalisisEl.value = clampMesesAnalisis(mesesEntreFechas(fechaMin, fechaMax));
  }
}

/**
 * Valida que el archivo de ventas recién adjuntado no traiga movimientos con
 * fecha demasiado antigua respecto a lo ya registrado en Supabase para la
 * tienda seleccionada. Se tolera un margen de MARGEN_DIAS_MOVIMIENTOS días
 * (SAP puede sincronizar movimientos backdateados días después del análisis
 * en que se subieron), pero más allá de eso el archivo se rechaza: probablemente
 * es el archivo equivocado (otro período, otra tienda).
 * @param {Array<Object>} filas - filas ya parseadas del .MHT (parsearMHT)
 * @returns {{valido: boolean, mensaje?: string, avisoDias?: string}}
 */
function validarFechasArchivoVentas(filas) {
  // Sin historial previo para esta tienda (primera carga): no hay nada contra
  // qué comparar la fecha mínima aceptable, pero sí se aprovecha el propio
  // archivo para sugerir automáticamente cuántos meses de análisis usar.
  if (!estado.ultimaFechaRegistrada) {
    sugerirMesesAnalisisDesdeArchivo(filas);
    return { valido: true };
  }

  let fechaMinEnArchivo = null;
  let filasSinFechaValida = 0;
  filas.forEach(f => {
    const fecha = parsearFechaSAP(f["Fe.contabilización"]);
    if (!fecha) { filasSinFechaValida++; return; }
    if (!fechaMinEnArchivo || fecha < fechaMinEnArchivo) fechaMinEnArchivo = fecha;
  });

  if (!fechaMinEnArchivo) {
    return {
      valido: false,
      mensaje: '<i class="fa-solid fa-triangle-exclamation"></i> No se encontró ninguna fecha válida en la columna "Fe.contabilización" del archivo.'
    };
  }

  const fechaUltima = fechaISOaDate(estado.ultimaFechaRegistrada);
  const fechaMinimaAceptable = sumarDias(fechaUltima, -MARGEN_DIAS_MOVIMIENTOS);

  if (fechaMinEnArchivo < fechaMinimaAceptable) {
    const fTxt = fechaMinEnArchivo.toLocaleDateString("es-VE");
    const fLimiteTxt = fechaMinimaAceptable.toLocaleDateString("es-VE");
    return {
      valido: false,
      mensaje: `<i class="fa-solid fa-triangle-exclamation"></i> El archivo trae movimientos desde el ${fTxt}, más de ${MARGEN_DIAS_MOVIMIENTOS} días antes de la última fecha registrada (${formatearFechaISOaVE(estado.ultimaFechaRegistrada)}). El límite aceptado es a partir del ${fLimiteTxt}. Verifica que sea el archivo correcto para esta tienda y período.`
    };
  }

  const avisoDias = fechaMinEnArchivo < fechaUltima
    ? ` Incluye días previos a la última fecha registrada (dentro del margen de ${MARGEN_DIAS_MOVIMIENTOS} días permitido para sincronizaciones tardías de SAP) — los que ya estén guardados no se duplicarán.`
    : "";

  return { valido: true, avisoDias };
}

/**
 * Consulta el rango de movimientos ya registrados en Supabase para la tienda
 * seleccionada y actualiza el mensaje informativo + el aviso de qué subir.
 * Se llama al renderizar el formulario y cada vez que cambia la tienda.
 */
async function actualizarRangoMovimientos() {
  const tiendaEl = document.getElementById("na-tienda");
  const rangoInfoEl = document.getElementById("na-rango-info");
  const rangoSubirEl = document.getElementById("na-rango-subir");
  if (!tiendaEl || !rangoInfoEl) return;

  const tienda = tiendaEl.value;
  const centros = centrosDeTienda(tienda);

  // Reset inmediato y optimista: apenas cambia la tienda, se limpia cualquier
  // mensaje de rango/validación de la tienda anterior (no se espera a que
  // termine la consulta a Supabase). Si había un archivo de ventas ya
  // adjuntado, se marca como "revalidando" y se bloquea temporalmente hasta
  // que se confirme el rango de la nueva tienda — evita que quede pegado un
  // aviso (o una validación "aprobada") que ya no corresponde.
  const validVentasEl = document.getElementById("validacion-ventas");
  const inputVentasInicial = document.getElementById("na-ventas");
  const hayArchivoVentas = inputVentasInicial && inputVentasInicial.files && inputVentasInicial.files[0];
  if (hayArchivoVentas && validVentasEl) {
    validVentasEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Revalidando el archivo para la nueva tienda...';
    validVentasEl.style.color = 'var(--texto-claro)';
    inputVentasInicial.dataset.valido = 'false';
  }

  // Revalida (si aplica) al final de esta función, sin importar por qué
  // camino se salió (sin tienda, error de red, sin datos, o con datos) —
  // así el aviso del archivo NUNCA se queda pegado con la tienda anterior.
  const revalidarAlFinal = async () => {
    if (hayArchivoVentas) {
      await validarArchivoAdjunto(inputVentasInicial, validVentasEl, "ventas");
    }
  };

  if (!tienda || centros.length === 0) {
    rangoInfoEl.innerHTML = "";
    if (rangoSubirEl) rangoSubirEl.textContent = "";
    estado.ultimaFechaRegistrada = null;
    await revalidarAlFinal();
    return;
  }

  rangoInfoEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Consultando movimientos ya registrados...';
  if (rangoSubirEl) rangoSubirEl.textContent = "";

  const resp = await callBridge("rangoMovimientos", { centros });
  // Si el usuario ya cambió de tienda mientras esta consulta estaba en vuelo,
  // descarta el resultado (la revalidación de esa tienda vieja ya no aplica;
  // la ejecución que sí corresponde a la tienda nueva se encargará de todo).
  if (document.getElementById("na-tienda")?.value !== tienda) return;

  const mesesAnalisisEl = document.getElementById("na-meses-analisis");

  if (!resp.ok) {
    rangoInfoEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> No se pudo consultar el rango de movimientos registrados: ' + (resp.error || "error desconocido");
    estado.ultimaFechaRegistrada = null;
    await revalidarAlFinal();
    return;
  }

  if (!resp.fechaMin || !resp.fechaMax) {
    rangoInfoEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> Aún no hay movimientos registrados para <strong>${nombrePorId(tienda)}</strong>. Sube el archivo completo del período que quieras analizar.`;
    if (rangoSubirEl) rangoSubirEl.textContent = "";
    estado.ultimaFechaRegistrada = null;
    // Sin historial: el valor de "meses de análisis" vuelve al mínimo por
    // defecto; si el usuario ya adjuntó un archivo, la revalidación de abajo
    // lo recalcula a partir del rango de fechas de ESE archivo.
    if (mesesAnalisisEl && !hayArchivoVentas) mesesAnalisisEl.value = MESES_ANALISIS_DEFECTO;
    await revalidarAlFinal();
    return;
  }

  const fMin = formatearFechaISOaVE(resp.fechaMin);
  const fMax = formatearFechaISOaVE(resp.fechaMax);
  rangoInfoEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> Para <strong>${nombrePorId(tienda)}</strong>, el rango de fechas de movimientos registrados es del <strong>${fMin}</strong> al <strong>${fMax}</strong>.`;
  if (rangoSubirEl) {
    const fechaLimite = formatearFechaISOaVE(formatearFechaISO(sumarDias(fechaISOaDate(resp.fechaMax), -MARGEN_DIAS_MOVIMIENTOS)));
    rangoSubirEl.textContent = `Sube los movimientos del ${fMax} al día actual (puedes subir un archivo con una antigüedad máxima de movimientos del ${fechaLimite})`;
  }
  estado.ultimaFechaRegistrada = resp.fechaMax;

  // Sugiere automáticamente cuántos meses de historial usar: la mayor
  // cantidad disponible entre la fecha más antigua registrada y hoy, dentro
  // de los límites permitidos (3-12). El usuario puede cambiarlo a mano después.
  if (mesesAnalisisEl) {
    const sugerido = clampMesesAnalisis(mesesEntreFechas(fechaISOaDate(resp.fechaMin), new Date()));
    mesesAnalisisEl.value = sugerido;
  }

  // Si ya había un archivo de ventas adjuntado (ej. el usuario cambió de tienda
  // después de subirlo), se re-valida contra el rango recién actualizado.
  await revalidarAlFinal();
}

// ============================================================
//  COLUMNAS REQUERIDAS PARA CADA TIPO DE ARCHIVO
// ============================================================
const COLUMNAS_VENTAS = [
  "Material", "Texto breve de material", "Centro", "Almacén", "Clase de movimiento",
  "Documento material", "Fe.contabilización", "Hora de entrada", "Ctd.en UM entrada",
  "Un.medida de entrada", "Cliente", "Nombre del usuario", "Texto cab.documento"
];

const COLUMNAS_STOCK = [
  "Material", "Texto breve de material", "Centro", "Almacén", "Unidad medida base",
  "Denominación-almacén", "Libre utilización", "Trans./Trasl.", "En control calidad",
  "Bloqueado", "Devoluciones"
];

const COLUMNAS_NOTAS_PENDIENTES = [
  "Material", "Texto breve", "Centro Receptor", "Entrega", "Fec. Entrega", "Cant Entrega"
];

// ============================================================
//  ESTADO PERSISTENTE
// ============================================================
function estadoInicial() {
  return {
    ventasProcesadas: null,
    stockTienda: null,
    stockKacosa: null,
    notasPendientes: null,
    clustersCandidatos: [],
    gruposCandidatos: [],
    tiendaSeleccionada: null,
    resultadoFinal: null,
    fechaAnalisis: null,
    grupos: null,
    sinRotacion: null,
    sugerencias: null,
    periodo: null,
    mesesCantidad: null,
    margenPct: null,
    mesesAnalisis: null,
    ultimaFechaRegistrada: null,
    analisisCompleto: null,
    analizando: false
  };
}
let estado = estadoInicial();

function tiendasDelUsuario() {
  return window.KACOSA?.tiendas || [];
}

// ============================================================
//  RENDER PRINCIPAL
// ============================================================
function render() {
  const cont = document.getElementById("nuevo-analisis-contenido");
  if (!cont) return;

  if (estado.analisisCompleto) {
    mostrarResultados(estado.analisisCompleto.resultado, estado.analisisCompleto.sugerencias);
    return;
  }

  const misTiendas = tiendasDelUsuario();
  const tieneVariasTiendas = misTiendas.includes("TODAS") || misTiendas.length > 1;
  const opcionesTienda = misTiendas.includes("TODAS")
    ? TIENDAS.map(t => `<option value="${t.id}">${t.nombre}</option>`).join("")
    : misTiendas.map(id => `<option value="${id}">${nombrePorId(id)}</option>`).join("");

  cont.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0; font-size:16px; color:var(--azul-base); display:flex; align-items:center; gap:10px">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; background:var(--ambar-claro); border-radius:8px; font-size:14px"><i class="fa-solid fa-file-lines"></i></span>
        Archivos y parámetros
      </h3>

      ${tieneVariasTiendas ? `
        <div class="form-row">
          <div>
            <label class="form-label" for="na-tienda">Tienda a analizar <span class="required">*</span></label>
            <select id="na-tienda" class="input-modern select-modern">
              ${opcionesTienda}
            </select>
          </div>
        </div>
      ` : `<input type="hidden" id="na-tienda" value="${misTiendas[0] || ''}">`}

      <!-- Rango de movimientos ya registrados (carga incremental) -->
      <div id="na-rango-info" class="estado-texto" style="margin-top:12px; font-size:12.5px; color:var(--texto-claro)"></div>

      <!-- Archivo de ventas -->
      <div style="margin-top:16px">
        <label class="form-label" for="na-ventas">Archivo de ventas <span class="required">*</span></label>
        <div class="file-input-wrapper" id="file-wrapper-ventas">
          <span class="file-icon"><i class="fa-solid fa-chart-column"></i></span>
          <div class="file-info">
            <div class="file-name" id="file-name-ventas">Seleccionar archivo</div>
            <div class="file-hint">.MHT de SAP · Ventas</div>
          </div>
          <span class="file-status empty" id="file-status-ventas">Pendiente</span>
          <input type="file" id="na-ventas" accept=".mht,.MHT">
        </div>
        <div id="na-rango-subir" style="font-size:12px; color:var(--ambar-oscuro); font-weight:600; margin-top:4px"></div>
        <div id="validacion-ventas" class="estado-texto" style="color:var(--verde-kpi); font-size:12px; margin-top:4px"></div>
      </div>

      <!-- Stock de la tienda -->
      <div style="margin-top:16px">
        <label class="form-label" for="na-stock-tienda">Stock de la tienda <span class="required">*</span></label>
        <div class="file-input-wrapper" id="file-wrapper-stock-tienda">
          <span class="file-icon"><i class="fa-solid fa-store"></i></span>
          <div class="file-info">
            <div class="file-name" id="file-name-stock-tienda">Seleccionar archivo</div>
            <div class="file-hint">.MHT de SAP · Stock tienda</div>
          </div>
          <span class="file-status empty" id="file-status-stock-tienda">Pendiente</span>
          <input type="file" id="na-stock-tienda" accept=".mht,.MHT">
        </div>
        <div id="validacion-stock-tienda" class="estado-texto" style="color:var(--verde-kpi); font-size:12px; margin-top:4px"></div>
      </div>

      <!-- Stock de Kacosa -->
      <div style="margin-top:16px">
        <label class="form-label" for="na-stock-kacosa">Stock de Kacosa <span class="required">*</span></label>
        <div class="file-input-wrapper" id="file-wrapper-stock-kacosa">
          <span class="file-icon"><i class="fa-solid fa-building"></i></span>
          <div class="file-info">
            <div class="file-name" id="file-name-stock-kacosa">Seleccionar archivo</div>
            <div class="file-hint">.MHT de SAP · Stock Kacosa</div>
          </div>
          <span class="file-status empty" id="file-status-stock-kacosa">Pendiente</span>
          <input type="file" id="na-stock-kacosa" accept=".mht,.MHT">
        </div>
        <div id="validacion-stock-kacosa" class="estado-texto" style="color:var(--verde-kpi); font-size:12px; margin-top:4px"></div>
      </div>

      <!-- Notas pendientes por despacho (opcional) -->
      <div style="margin-top:16px">
        <label class="form-label" for="na-notas-pendientes">Notas pendientes por despacho <span style="color:var(--texto-claro); font-weight:400">(opcional)</span></label>
        <div class="file-input-wrapper" id="file-wrapper-notas-pendientes">
          <span class="file-icon"><i class="fa-solid fa-file-invoice"></i></span>
          <div class="file-info">
            <div class="file-name" id="file-name-notas-pendientes">Seleccionar archivo</div>
            <div class="file-hint">.MHT de SAP · Notas pendientes por despacho</div>
          </div>
          <span class="file-status empty" id="file-status-notas-pendientes">Sin usar</span>
          <input type="file" id="na-notas-pendientes" accept=".mht,.MHT">
        </div>
        <div id="validacion-notas-pendientes" class="estado-texto" style="color:var(--verde-kpi); font-size:12px; margin-top:4px"></div>
      </div>

      <!-- Pendientes por sincronizar (opcional) -->
      <div style="margin-top:16px">
        <label class="form-label" for="na-pendientes-sync">Materiales pendientes por sincronizar <span style="color:var(--texto-claro); font-weight:400">(opcional)</span></label>
        <div class="file-input-wrapper" id="file-wrapper-pendientes-sync">
          <span class="file-icon"><i class="fa-solid fa-arrows-rotate"></i></span>
          <div class="file-info">
            <div class="file-name" id="file-name-pendientes-sync">Seleccionar archivo</div>
            <div class="file-hint">.xlsx propio · Columnas: Material, Cantidad_por_sincronizar</div>
          </div>
          <span class="file-status empty" id="file-status-pendientes-sync">Sin usar</span>
          <input type="file" id="na-pendientes-sync" accept=".xlsx,.xls">
        </div>
      </div>

      <!-- Rango de historial de ventas a usar para el análisis -->
      <div style="margin-top:16px">
        <label class="form-label" for="na-meses-analisis">
          Historial de ventas a usar para el análisis (meses)
        </label>
        <input type="number" id="na-meses-analisis" class="input-modern"
               min="${MESES_ANALISIS_MIN}" max="${MESES_ANALISIS_MAX}" value="${MESES_ANALISIS_DEFECTO}">
        <div style="font-size:11px; color:var(--texto-claro); margin-top:2px">
          Entre ${MESES_ANALISIS_MIN} y ${MESES_ANALISIS_MAX} meses. Se usa el histórico ya guardado en la base de datos
          (combinado con lo que subas ahora) para clasificar los materiales y calcular la venta promedio.
        </div>
      </div>

      <!-- Período -->
      <div class="form-row" style="margin-top:16px">
        <div>
          <label class="form-label" for="na-periodo">Horizonte de abastecimiento</label>
          <select id="na-periodo" class="input-modern select-modern">
            <option value="semana">Una semana</option>
            <option value="mes" selected>Un mes</option>
            <option value="meses">Varios meses</option>
          </select>
        </div>
        <div id="na-meses-wrap" style="display:none">
          <label class="form-label" for="na-meses-cantidad">Cantidad de meses</label>
          <input type="number" id="na-meses-cantidad" class="input-modern" min="1" max="24" value="2">
        </div>
      </div>

      <!-- Margen -->
      <div style="margin-top:16px">
        <label class="form-label">Margen de seguridad: <span id="na-margen-valor" style="color:var(--ambar-oscuro); font-weight:700">20%</span></label>
        <input type="range" id="na-margen" class="input-modern" min="10" max="100" step="5" value="20">
        <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--texto-claro); margin-top:2px">
          <span>10%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      <!-- Botón Analizar + Limpiar datos -->
      <div class="btn-group" style="margin-top:20px">
        <button id="btn-analizar" class="btn-primario" style="min-width:200px">
          <i class="fa-solid fa-bolt"></i> Analizar
        </button>
        <button id="btn-limpiar-analisis" class="btn-secundario" style="display:none; min-width:180px">
          <i class="fa-solid fa-broom"></i> Limpiar datos
        </button>
      </div>
      <p id="na-estado" class="estado-texto" style="margin-top:12px"></p>
    </div>

    <div id="na-duplicados"></div>
    <div id="na-resultados"></div>
  `;

  // ============================================================
  //  EVENTOS DE ARCHIVOS (CARGA + VALIDACIÓN DE COLUMNAS)
  // ============================================================
  const fileInputs = CONFIG_ARCHIVOS;

  fileInputs.forEach(({ id, nameId, statusId, wrapperId, validId, tipo }) => {
    const input = document.getElementById(id);
    const nameEl = document.getElementById(nameId);
    const statusEl = document.getElementById(statusId);
    const wrapper = document.getElementById(wrapperId);
    const validEl = validId ? document.getElementById(validId) : null;

    if (input) {
      input.addEventListener('change', async () => {
        if (input.files && input.files[0]) {
          nameEl.textContent = input.files[0].name;
          statusEl.innerHTML = '<i class="fa-solid fa-check"></i> Cargado';
          statusEl.className = 'file-status loaded';
          wrapper.classList.add('loaded');
          await validarArchivoAdjunto(input, validEl, tipo);
        } else {
          nameEl.textContent = 'Seleccionar archivo';
          statusEl.textContent = 'Pendiente';
          statusEl.className = 'file-status empty';
          wrapper.classList.remove('loaded');
          if (validEl) {
            validEl.innerHTML = '';
            input.dataset.valido = 'false';
          }
        }
      });

      if (wrapper) {
        wrapper.addEventListener('dragover', (e) => {
          e.preventDefault();
          wrapper.classList.add('dragover');
        });
        wrapper.addEventListener('dragleave', () => {
          wrapper.classList.remove('dragover');
        });
        wrapper.addEventListener('drop', (e) => {
          e.preventDefault();
          wrapper.classList.remove('dragover');
          if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            input.dispatchEvent(new Event('change'));
          }
        });
      }
    }
  });

  document.getElementById("na-periodo").addEventListener("change", (e) => {
    document.getElementById("na-meses-wrap").style.display = e.target.value === "meses" ? "block" : "none";
  });
  document.getElementById("na-margen").addEventListener("input", (e) => {
    document.getElementById("na-margen-valor").textContent = e.target.value + "%";
  });
  const mesesAnalisisEl = document.getElementById("na-meses-analisis");
  if (mesesAnalisisEl) {
    mesesAnalisisEl.addEventListener("change", () => {
      const valor = Number(mesesAnalisisEl.value);
      if (!valor || valor < MESES_ANALISIS_MIN) mesesAnalisisEl.value = MESES_ANALISIS_MIN;
      else if (valor > MESES_ANALISIS_MAX) mesesAnalisisEl.value = MESES_ANALISIS_MAX;
    });
  }
  document.getElementById("btn-analizar").addEventListener("click", ejecutarAnalisis);
  document.getElementById("btn-limpiar-analisis").addEventListener("click", limpiarAnalisis);

  // Rango de movimientos ya registrados: se consulta al mostrar el formulario
  // y cada vez que el usuario cambia de tienda (solo aplica si puede elegir).
  const tiendaSelectEl = document.getElementById("na-tienda");
  if (tiendaSelectEl && tiendaSelectEl.tagName === "SELECT") {
    tiendaSelectEl.addEventListener("change", actualizarRangoMovimientos);
  }
  actualizarRangoMovimientos();
}

// ============================================================
//  VALIDACIÓN DE COLUMNAS
// ============================================================
/**
 * Lee, parsea y valida (columnas + fechas para ventas) el archivo recién
 * adjuntado en un <input type="file">, y refleja el resultado en validEl +
 * input.dataset.valido. Reutilizable tanto al adjuntar el archivo como al
 * re-validar (ej. si cambia la tienda seleccionada y ya había un archivo
 * de ventas cargado).
 */
async function validarArchivoAdjunto(input, validEl, tipo) {
  if (!validEl || !tipo || !input.files || !input.files[0]) return;
  try {
    const texto = await input.files[0].text();
    const filas = parsearMHT(texto);
    let columnasRequeridas;
    if (tipo === 'ventas') columnasRequeridas = COLUMNAS_VENTAS;
    else if (tipo === 'stock') columnasRequeridas = COLUMNAS_STOCK;
    else if (tipo === 'notas') columnasRequeridas = COLUMNAS_NOTAS_PENDIENTES;
    else columnasRequeridas = [];

    const resultado = validarColumnasArchivo(filas, columnasRequeridas, tipo);
    let resultadoFinal = resultado;

    // Para los archivos de stock, si las columnas están bien, se valida además
    // que todos los almacenes presentes estén en la lista permitida
    // correspondiente (distinta para stock de tienda vs. stock de Kacosa,
    // aunque ambos comparten tipo:'stock' — se distinguen por el id del input).
    if (resultado.valido && tipo === 'stock') {
      const esStockKacosa = input.id === 'na-stock-kacosa';
      const almacenesPermitidos = esStockKacosa ? ALMACENES_PERMITIDOS_STOCK_KACOSA : ALMACENES_PERMITIDOS_STOCK_TIENDA;
      const nombreOrigen = esStockKacosa ? 'Kacosa' : 'la tienda';
      const resultadoAlmacenes = validarAlmacenesArchivo(filas, almacenesPermitidos, nombreOrigen);
      if (!resultadoAlmacenes.valido) {
        resultadoFinal = resultadoAlmacenes;
      }
    }

    // Para el archivo de ventas, si las columnas están bien, se valida además
    // que no traiga movimientos demasiado antiguos respecto a lo ya registrado
    // en Supabase para esta tienda (con margen de MARGEN_DIAS_MOVIMIENTOS días
    // — ver validarFechasArchivoVentas).
    if (resultado.valido && tipo === 'ventas') {
      const resultadoFechas = validarFechasArchivoVentas(filas);
      if (!resultadoFechas.valido) {
        resultadoFinal = resultadoFechas;
      } else if (resultadoFechas.avisoDias) {
        resultadoFinal = { valido: true, mensaje: resultado.mensaje + resultadoFechas.avisoDias };
      }
    }

    validEl.innerHTML = resultadoFinal.mensaje;
    validEl.style.color = resultadoFinal.valido ? 'var(--verde-kpi)' : 'var(--rojo-alerta)';
    input.dataset.valido = resultadoFinal.valido ? 'true' : 'false';
  } catch (err) {
    validEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error al leer el archivo: ' + err.message;
    validEl.style.color = 'var(--rojo-alerta)';
    input.dataset.valido = 'false';
  }
}

function validarColumnasArchivo(filas, columnasRequeridas, tipo) {
  if (filas.length === 0) {
    return { valido: false, mensaje: '<i class="fa-solid fa-triangle-exclamation"></i> El archivo está vacío o no tiene datos', faltantes: columnasRequeridas };
  }

  const columnasExistentes = Object.keys(filas[0]);
  const faltantes = columnasRequeridas.filter(col => !columnasExistentes.includes(col));

  if (faltantes.length === 0) {
    return { valido: true, mensaje: `<i class="fa-solid fa-circle-check"></i> Archivo válido: contiene todas las columnas requeridas (${columnasRequeridas.length})`, faltantes: [] };
  }

  const nombreTipo = tipo === 'ventas' ? 'ventas' : tipo === 'stock' ? 'stock' : 'notas pendientes';
  return {
    valido: false,
    mensaje: `<i class="fa-solid fa-triangle-exclamation"></i> El archivo de ${nombreTipo} no tiene las columnas correctas. Faltan: ${faltantes.join(', ')}`,
    faltantes: faltantes
  };
}

/**
 * Valida que el archivo de stock (tienda o Kacosa) solo traiga almacenes de
 * la lista permitida correspondiente. Si aparece cualquier otro almacén, se
 * rechaza el archivo completo (no se filtra en silencio, para que el usuario
 * se dé cuenta de que subió el archivo equivocado).
 * @param {Array<Object>} filas - filas ya parseadas del .MHT (parsearMHT)
 * @param {Array<string>} almacenesPermitidos
 * @param {string} nombreOrigen - "la tienda" | "Kacosa" (para el mensaje)
 */
function validarAlmacenesArchivo(filas, almacenesPermitidos, nombreOrigen) {
  const noPermitidos = new Set();
  filas.forEach(f => {
    const almacen = String(f["Almacén"] || "").trim();
    if (almacen && !almacenesPermitidos.includes(almacen)) noPermitidos.add(almacen);
  });

  if (noPermitidos.size === 0) return { valido: true };

  let mensajePermitidos;
  if (nombreOrigen === 'Kacosa') {
    mensajePermitidos = 'solo se admiten para el stock de Kacosa los almacenes 1000, 1029, 3000 y 3029.';
  } else {
    mensajePermitidos = `solo se admiten para el stock de ${nombreOrigen} los almacenes del general y exhibición.`;
  }

  return {
    valido: false,
    mensaje: `<i class="fa-solid fa-triangle-exclamation"></i> Tu archivo tiene stock de almacenes no permitidos, ${mensajePermitidos} Almacén(es) no permitido(s) encontrado(s): ${Array.from(noPermitidos).join(', ')}.`
  };
}

// ============================================================
//  VERIFICACIÓN DE ARCHIVOS VÁLIDOS
// ============================================================
function verificarArchivosValidos() {
  const archivos = [
    { id: 'na-ventas', nombre: 'ventas' },
    { id: 'na-stock-tienda', nombre: 'stock de tienda' },
    { id: 'na-stock-kacosa', nombre: 'stock de Kacosa' }
  ];

  for (const arch of archivos) {
    const input = document.getElementById(arch.id);
    if (!input || !input.files || input.files.length === 0) {
      return { ok: false, error: `Falta el archivo de ${arch.nombre}` };
    }
    if (input.dataset.valido !== 'true') {
      return { ok: false, error: `El archivo de ${arch.nombre} no es válido. Verifica que tenga las columnas correctas.` };
    }
  }
  return { ok: true };
}

// ============================================================
//  EJECUTAR ANÁLISIS (CON BLOQUEO DEL BOTÓN)
// ============================================================
/**
 * Limpia archivos, indicadores visuales, resultados y estado interno,
 * dejando el formulario listo para un análisis nuevo desde cero.
 * Se usa al hacer clic en "Limpiar datos" (solo visible tras completar un análisis).
 */
function limpiarAnalisis() {
  CONFIG_ARCHIVOS.forEach(({ id, nameId, statusId, wrapperId, validId, opcional }) => {
    const input = document.getElementById(id);
    const nameEl = document.getElementById(nameId);
    const statusEl = document.getElementById(statusId);
    const wrapper = document.getElementById(wrapperId);
    const validEl = validId ? document.getElementById(validId) : null;

    if (input) {
      input.value = "";
      delete input.dataset.valido;
    }
    if (nameEl) nameEl.textContent = "Seleccionar archivo";
    if (statusEl) {
      statusEl.textContent = opcional ? "Sin usar" : "Pendiente";
      statusEl.className = "file-status empty";
    }
    if (wrapper) wrapper.classList.remove("loaded");
    if (validEl) validEl.innerHTML = "";
  });

  // Restaura período y margen a sus valores por defecto
  const periodoEl = document.getElementById("na-periodo");
  if (periodoEl) periodoEl.value = "mes";
  const mesesWrap = document.getElementById("na-meses-wrap");
  if (mesesWrap) mesesWrap.style.display = "none";
  const mesesEl = document.getElementById("na-meses-cantidad");
  if (mesesEl) mesesEl.value = 2;
  const margenEl = document.getElementById("na-margen");
  if (margenEl) margenEl.value = 20;
  const margenValorEl = document.getElementById("na-margen-valor");
  if (margenValorEl) margenValorEl.textContent = "20%";
  const mesesAnalisisEl = document.getElementById("na-meses-analisis");
  if (mesesAnalisisEl) mesesAnalisisEl.value = MESES_ANALISIS_DEFECTO;

  // Limpia resultados, duplicados y mensajes en pantalla
  const duplicadosEl = document.getElementById("na-duplicados");
  if (duplicadosEl) duplicadosEl.innerHTML = "";
  const resultadosEl = document.getElementById("na-resultados");
  if (resultadosEl) resultadosEl.innerHTML = "";
  const estadoTexto = document.getElementById("na-estado");
  if (estadoTexto) estadoTexto.textContent = "";

  // Reinicia el estado interno para permitir un análisis nuevo
  estado.ventasProcesadas = null;
  estado.stockTienda = null;
  estado.stockKacosa = null;
  estado.notasPendientes = null;
  estado.clustersCandidatos = [];
  estado.gruposCandidatos = [];
  estado.resultadoFinal = null;
  estado.fechaAnalisis = null;
  estado.grupos = null;
  estado.sinRotacion = null;
  estado.sugerencias = null;
  estado.periodo = null;
  estado.mesesCantidad = null;
  estado.margenPct = null;
  estado.mesesAnalisis = null;
  estado.analisisCompleto = null;
  estado.analizando = false;
  // NOTA: estado.ultimaFechaRegistrada NO se limpia aquí — sigue siendo válida
  // (es información de la base de datos, no del formulario) y se refresca sola.

  // Reactiva el formulario y el botón Analizar; oculta "Limpiar datos"
  bloquearFormulario(false);
  const btnAnalizar = document.getElementById("btn-analizar");
  if (btnAnalizar) {
    btnAnalizar.disabled = false;
    btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
  }
  const btnLimpiar = document.getElementById("btn-limpiar-analisis");
  if (btnLimpiar) btnLimpiar.style.display = "none";

  // Refresca el rango de movimientos (puede haber cambiado tras el análisis
  // anterior, que ya guardó movimientos nuevos en Supabase).
  actualizarRangoMovimientos();
}

async function ejecutarAnalisis() {
  if (estado.analizando) {
    document.getElementById("na-estado").innerHTML = '<i class="fa-solid fa-hourglass-half"></i> Ya hay un análisis en progreso. Espera a que termine.';
    return;
  }

  const estadoTexto = document.getElementById("na-estado");
  document.getElementById("na-duplicados").innerHTML = "";
  document.getElementById("na-resultados").innerHTML = "";

  const tienda = document.getElementById("na-tienda").value;
  const archivoVentas = document.getElementById("na-ventas").files[0];
  const archivoStockTienda = document.getElementById("na-stock-tienda").files[0];
  const archivoStockKacosa = document.getElementById("na-stock-kacosa").files[0];
  const archivoNotasPendientes = document.getElementById("na-notas-pendientes").files[0];
  const periodo = document.getElementById("na-periodo").value;
  const mesesCantidad = Number(document.getElementById("na-meses-cantidad").value) || 1;
  const margenPct = Number(document.getElementById("na-margen").value);
  let mesesAnalisis = Number(document.getElementById("na-meses-analisis")?.value) || MESES_ANALISIS_DEFECTO;
  if (mesesAnalisis < MESES_ANALISIS_MIN) mesesAnalisis = MESES_ANALISIS_MIN;
  if (mesesAnalisis > MESES_ANALISIS_MAX) mesesAnalisis = MESES_ANALISIS_MAX;

  // Validar archivos antes de empezar
  const validacion = verificarArchivosValidos();
  if (!validacion.ok) {
    estadoTexto.textContent = validacion.error;
    return;
  }

  if (!tienda) {
    estadoTexto.textContent = "Selecciona una tienda.";
    return;
  }

  const centrosValidos = centrosDeTienda(tienda);
  if (centrosValidos.length === 0) {
    estadoTexto.textContent = "No se encontró el centro SAP para esa tienda.";
    return;
  }

  try {
    estado.analizando = true;
    const btnAnalizar = document.getElementById("btn-analizar");
    btnAnalizar.disabled = true;
    btnAnalizar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analizando...';
    bloquearFormulario(true);

    estadoTexto.textContent = "Leyendo archivo de ventas...";
    const filasVentas = parsearMHT(await archivoVentas.text());

    estadoTexto.textContent = "Leyendo stock de la tienda...";
    const filasStockTienda = parsearMHT(await archivoStockTienda.text());

    estadoTexto.textContent = "Leyendo stock de Kacosa...";
    const filasStockKacosa = parsearMHT(await archivoStockKacosa.text());

    estadoTexto.textContent = "Validando centros de los archivos...";
    const errorValidacion = validarCentros(filasVentas, filasStockTienda, filasStockKacosa, centrosValidos);
    if (errorValidacion) {
      estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + errorValidacion;
      btnAnalizar.disabled = false;
      btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
      bloquearFormulario(false);
      estado.analizando = false;
      return;
    }

    estadoTexto.textContent = "Agrupando stock por material...";
    const stockTienda = agruparStock(filasStockTienda, centrosValidos);
    const stockKacosa = agruparStock(filasStockKacosa, CENTROS_KACOSA);

    // Mapa código -> UMB (unidad de medida base), tomado del stock: Kacosa primero,
    // stock tienda como respaldo si el material no aparece ahí — mismo criterio que
    // se usa más adelante para mostrar la UMB de cada material (calculo-abastecimiento.js).
    // Se arma ANTES de procesar las ventas porque hace falta para convertir correctamente
    // cualquier unidad de venta (M, RO, KG, G, etc.) a la unidad base del material.
    const mapaUMBPorMaterial = {};
    Object.values(stockKacosa).forEach(m => { mapaUMBPorMaterial[m.codigo] = m.unidadBase; });
    Object.values(stockTienda).forEach(m => {
      if (!mapaUMBPorMaterial[m.codigo]) mapaUMBPorMaterial[m.codigo] = m.unidadBase;
    });

    await Promise.all([
      cargarFactoresConversion(), // trae desde Supabase los factores por material y por UMB
      cargarCodigosExcluidos()    // trae desde Supabase la lista de códigos a ignorar
    ]);

    // Alimenta la tabla de Stock en Supabase con los datos crudos recién subidos.
    // No bloquea el análisis si falla (siempre se reescribe completo, no es incremental).
    sincronizarStock(filasStockTienda, filasStockKacosa);

    // --- Carga incremental de movimientos (Supabase decide qué es realmente nuevo) ---
    estadoTexto.textContent = "Guardando los movimientos nuevos en la base de datos...";
    const filasMovimientosParaGuardar = prepararFilasMovimientos(filasVentas);
    if (filasMovimientosParaGuardar.length > 0) {
      const respMovimientos = await callBridge("guardarMovimientos", { filas: filasMovimientosParaGuardar });
      if (!respMovimientos.ok) {
        estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> No se pudieron guardar los movimientos: ' + respMovimientos.error;
        btnAnalizar.disabled = false;
        btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
        bloquearFormulario(false);
        estado.analizando = false;
        return;
      }
      estadoTexto.textContent = respMovimientos.mensaje || "Movimientos sincronizados.";
    }

    // --- Lee el histórico combinado (Supabase) para el rango de análisis elegido ---
    // Esto es lo que reemplaza al archivo recién subido como fuente de la clasificación
    // ABCD y del cálculo de "a pedir": ya no depende solo de lo que traiga el archivo
    // (que ahora puede ser apenas unos días), sino de los "mesesAnalisis" meses de
    // historial acumulados en la base de datos, que ya incluyen lo que se acaba de guardar.
    //
    // La ventana [fechaDesde, fechaHasta] se ancla a la fecha máxima REAL con datos
    // (el mayor entre lo ya registrado en Supabase antes de este análisis y lo que
    // trae el archivo recién subido) — NUNCA a new Date()/"hoy". Si se ancla al reloj
    // del sistema, cada día que pasa sin subir un archivo nuevo desplaza la ventana
    // hacia adelante sin ganar datos al final, y se pierden silenciosamente los días
    // más antiguos del rango: mismo archivo, mismos "mesesAnalisis", pero Total_Ventas
    // distinto (más bajo) solo porque cambió el día en que se corrió el análisis.
    estadoTexto.textContent = `Leyendo histórico de ventas (${mesesAnalisis} mes(es))...`;
    const fechaMaxArchivo = fechaMaximaEnFilas(filasVentas);
    const fechaMaxRegistrada = estado.ultimaFechaRegistrada ? fechaISOaDate(estado.ultimaFechaRegistrada) : null;
    const fechaAncla = [fechaMaxArchivo, fechaMaxRegistrada]
      .filter(Boolean)
      .reduce((max, f) => (!max || f > max ? f : max), null) || new Date();
    const fechaHasta = formatearFechaISO(fechaAncla);
    const fechaDesde = formatearFechaISO(sumarMeses(fechaAncla, -mesesAnalisis));
    const respHistorico = await callBridge("leerMovimientosRango", {
      centros: centrosValidos, fechaDesde, fechaHasta
    });
    if (!respHistorico.ok) {
      estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> No se pudo leer el histórico de movimientos: ' + respHistorico.error;
      btnAnalizar.disabled = false;
      btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
      bloquearFormulario(false);
      estado.analizando = false;
      return;
    }

    // Respaldo: si por algún motivo el histórico de Supabase viniera vacío (fallo raro
    // justo después de guardar, o base de datos recién migrada), se usa el archivo recién
    // subido para no dejar el análisis sin datos.
    const filasHistoricas = adaptarFilasMovimientosDB(respHistorico.filas);
    const filasParaProcesar = filasHistoricas.length > 0 ? filasHistoricas : filasVentas;
    const ventasProcesadas = procesarVentas(filasParaProcesar, mapaUMBPorMaterial);

    // Archivo opcional de notas pendientes por despacho
    let notasPendientes = null;
    if (archivoNotasPendientes) {
      estadoTexto.textContent = "Validando archivo de notas pendientes por despacho...";
      const filasNotas = parsearMHT(await archivoNotasPendientes.text());
      
      // Validar que el archivo de notas contenga el centro correcto
      const errorNotas = validarCentroNotasPendientes(filasNotas, centrosValidos);
      if (errorNotas) {
        estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + errorNotas;
        btnAnalizar.disabled = false;
        btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
        bloquearFormulario(false);
        estado.analizando = false;
        return;
      }
      
      estadoTexto.textContent = "Procesando notas pendientes por despacho...";
      notasPendientes = procesarNotasPendientes(filasNotas, centrosValidos);
      if (notasPendientes && Object.keys(notasPendientes).length > 0) {
        estadoTexto.textContent = `Se encontraron ${Object.keys(notasPendientes).length} material(es) con notas pendientes por despacho.`;
      } else {
        estadoTexto.textContent = "No se encontraron notas pendientes para esta tienda.";
      }
    }

    // Archivo opcional de pendientes por sincronizar
    const archivoPendientesSync = document.getElementById("na-pendientes-sync").files[0];
    if (archivoPendientesSync) {
      estadoTexto.textContent = "Aplicando pendientes por sincronizar...";
      const filasPendientes = await leerXLSXGenerico(archivoPendientesSync);
      const mapaPendientes = procesarPendientesSync(filasPendientes);
      const afectados = restarPendientesSync(stockTienda, mapaPendientes);
      if (afectados > 0) {
        estadoTexto.textContent = `Se ajustó el stock de ${afectados} material(es) por pendientes de sincronización.`;
      }
    }

    estadoTexto.textContent = "Cargando lista de paquetes...";
    await cargarPaquetes();

    estadoTexto.textContent = "Cargando ubicaciones de materiales en Kacosa...";
    await cargarUbicaciones();

    estadoTexto.textContent = "Buscando posibles códigos duplicados...";
    const materialesParaComparar = Object.values(ventasProcesadas.porMaterial)
      .map(m => ({ codigo: m.codigo, descripcion: m.descripcion }));
    const clusters = detectarCandidatosLocal(materialesParaComparar);

    // Los candidatos detectados localmente (similitud de texto + guardias de número,
    // color y palabra distintiva) se muestran directo al usuario para que confirme
    // manualmente cuáles fusionar — ya no se le pide confirmación a un agente de IA,
    // para no depender de que esa llamada esté disponible o funcione.
    const gruposCandidatos = clusters.map(cluster => cluster.map(m => m.codigo));

    estado = {
      ...estado,
      ventasProcesadas, stockTienda, stockKacosa,
      notasPendientes: notasPendientes || null,
      clustersCandidatos: clusters, gruposCandidatos,
      tiendaSeleccionada: tienda, periodo, mesesCantidad, margenPct, mesesAnalisis,
      fechaAnalisis: new Date().toLocaleDateString("es-VE"),
      analisisCompleto: null
    };

    if (gruposCandidatos.length > 0) {
      estadoTexto.textContent = `Se detectaron ${gruposCandidatos.length} posible(s) duplicado(s). Revísalos abajo.`;
      mostrarDuplicados(gruposCandidatos);
    } else {
      estadoTexto.textContent = "No se detectaron duplicados. Calculando...";
      await finalizarCalculo([]);
    }

  } catch (err) {
    estadoTexto.textContent = "Error: " + err.message;
    console.error(err);
    const btnAnalizar = document.getElementById("btn-analizar");
    btnAnalizar.disabled = false;
    btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
    bloquearFormulario(false);
    estado.analizando = false;
  }
}

/**
 * Valida que el archivo de notas pendientes por despacho contenga al menos un
 * centro receptor que coincida con los centros de la tienda seleccionada.
 */
function validarCentroNotasPendientes(filas, centrosValidos) {
  if (filas.length === 0) {
    return "El archivo de notas pendientes está vacío o no tiene datos.";
  }

  const centrosEnNotas = new Set();
  filas.forEach(f => {
    const centro = String(f["Centro Receptor"] || "").trim();
    if (centro) centrosEnNotas.add(centro);
  });

  if (centrosEnNotas.size === 0) {
    return "El archivo de notas pendientes no tiene datos de 'Centro Receptor' reconocibles.";
  }

  const centrosCoincidentes = [...centrosEnNotas].filter(c => centrosValidos.includes(c));
  if (centrosCoincidentes.length === 0) {
    return `El archivo de notas pendientes contiene el/los centro(s) ${[...centrosEnNotas].join(", ")}, pero la tienda seleccionada corresponde a ${centrosValidos.join(" o ")}. Verifica que subiste el archivo correcto.`;
  }

  return null;
}

// ============================================================
//  MOSTRAR DUPLICADOS
// ============================================================
function mostrarDuplicados(grupos) {
  const cont = document.getElementById("na-duplicados");
  const descripcionPorCodigo = {};
  Object.values(estado.ventasProcesadas.porMaterial).forEach(m => {
    descripcionPorCodigo[m.codigo] = m.descripcion;
  });

  cont.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0; font-size:15px; color:var(--azul-base)">Posibles duplicados detectados</h3>
      <p class="vista-sub">Marca los grupos que SÍ son el mismo material (se fusionará su rotación bajo un solo código).</p>
      ${grupos.map((grupo, idx) => `
        <label style="display:flex; align-items:flex-start; gap:10px; padding:10px 0; border-bottom:1px solid var(--borde); cursor:pointer">
          <input type="checkbox" class="chk-grupo-dup" data-idx="${idx}" checked style="margin-top:4px">
          <span style="font-size:13px">
            ${grupo.map(c => `<strong>${c}</strong> - ${descripcionPorCodigo[c] || ""}`).join("<br>")}
          </span>
        </label>
      `).join("")}
      <button id="btn-confirmar-duplicados" class="btn-primario" style="margin-top:16px; max-width:260px">
        Confirmar y calcular
      </button>
    </div>
  `;

  document.getElementById("btn-confirmar-duplicados").addEventListener("click", () => {
    const gruposConfirmados = [];
    document.querySelectorAll(".chk-grupo-dup:checked").forEach(chk => {
      gruposConfirmados.push(grupos[Number(chk.dataset.idx)]);
    });
    finalizarCalculo(gruposConfirmados);
  });

  // Aviso + scroll automático: el usuario puede no estar viendo esta parte de
  // la pantalla cuando termina el análisis, así que se le avisa explícitamente
  // y se lleva la vista hasta los grupos a confirmar.
  notificarExito(
    `Se ${grupos.length === 1 ? "detectó 1 posible duplicado" : `detectaron ${grupos.length} posibles duplicados`}. Revisa los grupos y confirma cuáles fusionar antes de continuar.`,
    { titulo: "Posibles duplicados detectados", icono: '<i class="fa-solid fa-triangle-exclamation"></i>', segundos: 6 }
  );
  cont.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ============================================================
//  FINALIZAR CÁLCULO
// ============================================================
async function finalizarCalculo(gruposConfirmados) {
  document.getElementById("na-duplicados").innerHTML = "";
  const estadoTexto = document.getElementById("na-estado");

  if (gruposConfirmados.length > 0) {
    fusionarDuplicados(
      estado.ventasProcesadas.porMaterial,
      estado.stockTienda,
      estado.stockKacosa,
      gruposConfirmados
    );
  }

  let resultado = calcularAbastecimiento({
    ventasProcesadas: estado.ventasProcesadas,
    stockTienda: estado.stockTienda,
    stockKacosa: estado.stockKacosa,
    periodo: estado.periodo,
    mesesCantidad: estado.mesesCantidad,
    margenPct: estado.margenPct
  });

  // Aplicar ajuste por notas pendientes por despacho
  if (estado.notasPendientes && Object.keys(estado.notasPendientes).length > 0) {
    estadoTexto.textContent = "Aplicando ajuste por notas pendientes por despacho...";
    resultado = resultado.map(m => {
      const nota = estado.notasPendientes[m.codigo];
      if (nota) {
        const cantidadPendiente = nota.cantidad || 0;
        // Restar del A_Pedir, sin bajar de 0
        const aPedirAjustado = Math.max(0, (m.aPedir || 0) - cantidadPendiente);
        return {
          ...m,
          aPedir: aPedirAjustado,
          porDespacho: cantidadPendiente,
          numeroDeNota: nota.numeroNota || '',
          fechaDeNota: nota.fechaNota || ''
        };
      }
      return {
        ...m,
        porDespacho: 0,
        numeroDeNota: '',
        fechaDeNota: ''
      };
    });
  } else {
    // Si no hay notas, agregar columnas vacías
    resultado = resultado.map(m => ({
      ...m,
      porDespacho: 0,
      numeroDeNota: '',
      fechaDeNota: ''
    }));
  }

  estadoTexto.textContent = "Revisando base de alta rotación...";
  const respAltaRotacion = await callBridge("leerAltaRotacion", {});
  const altaRotacion = respAltaRotacion.ok ? respAltaRotacion.materiales : [];

  const { resultadoConAnexos } = anexarAltaRotacionFaltante(
    resultado, estado.stockTienda, estado.stockKacosa, altaRotacion,
    resultado[0]?.periodoVentas || "", resultado[0]?.periodoAbastecimiento || "", resultado[0]?.rangoSeguridadUsado || "",
    resultado[0]?.rangoFechasTexto || "—"
  );
  resultado = resultadoConAnexos;

  resultado.forEach(m => {
    m.tienda = nombrePorId(estado.tiendaSeleccionada);
    m.fechaAnalisis = estado.fechaAnalisis;
  });

  const sugerencias = generarSugerencias(resultado, estado.stockTienda, estado.stockKacosa, altaRotacion);
  const sinRotacion = generarSinRotacion(estado.stockKacosa, estado.stockTienda, estado.ventasProcesadas);

  estado.resultadoFinal = resultado;
  estado.sugerencias = sugerencias;
  estado.sinRotacion = sinRotacion;

  const mesesUsadosRedondeado = Math.round(estado.ventasProcesadas.rangoFechas?.meses || 0);
  const semanasUsadasRedondeado = Math.round(estado.ventasProcesadas.rangoFechas?.semanas || 0);

  // Rango de fechas EXACTO de los movimientos que realmente se usaron para calcular
  // Total_Ventas (fechaMin/fechaMax reales de lo leído, ya recortado a mesesAnalisis) —
  // no la ventana solicitada a Supabase, sino lo que de verdad había en esos días.
  const rangoFechasTexto = resultado[0]?.rangoFechasTexto || "—";

  estado.analisisCompleto = {
    resultado: resultado,
    sugerencias: sugerencias,
    sinRotacion: sinRotacion,
    tienda: estado.tiendaSeleccionada,
    fechaAnalisis: estado.fechaAnalisis,
    periodo: estado.periodo,
    margenPct: estado.margenPct,
    mesesUsados: mesesUsadosRedondeado,
    semanasUsadas: semanasUsadasRedondeado,
    rangoFechasTexto
  };

  window.KACOSA.ultimoAnalisis = {
    tienda: estado.tiendaSeleccionada,
    fechaAnalisis: estado.fechaAnalisis,
    periodo: estado.periodo,
    margenPct: estado.margenPct,
    mesesUsados: mesesUsadosRedondeado,
    semanasUsadas: semanasUsadasRedondeado,
    rangoFechasTexto,
    materiales: resultado,
    sugerencias
  };

  // Se guarda ANTES de mostrar los resultados en pantalla. Si el guardado falla,
  // NO se muestran los resultados: se deja un botón para reintentar solo el
  // guardado (sin recalcular nada) hasta que quede guardado correctamente.
  async function intentarGuardarYMostrar() {
    estadoTexto.textContent = `Análisis completo — ${resultado.length} material(es) procesados. Guardando en la base de datos...`;
    const resultadosDiv = document.getElementById("na-resultados");
    if (resultadosDiv) resultadosDiv.innerHTML = "";

    const respGuardado = await callBridge("guardarAnalisis", {
      tienda: estado.tiendaSeleccionada,
      centro: centrosDeTienda(estado.tiendaSeleccionada).join(","),
      fechaAnalisis: estado.fechaAnalisis,
      materiales: estado.resultadoFinal,
      usuarioEmail: window.KACOSA?.usuario?.email || "",
      usuarioNombre: window.KACOSA?.usuario?.nombre || window.KACOSA?.usuario?.email || ""
    });

    if (!respGuardado.ok) {
      estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> No se pudo guardar el análisis: ' + respGuardado.error;
      if (resultadosDiv) {
        resultadosDiv.innerHTML = `
          <div class="card" style="text-align:center">
            <p class="vista-sub" style="color:var(--rojo-alerta); margin-top:0">
              <i class="fa-solid fa-triangle-exclamation"></i> No se pudo guardar el análisis en la base de datos.
              Los resultados no se muestran hasta que quede guardado correctamente.
            </p>
            <button id="btn-reintentar-guardado" class="btn-primario" style="margin-top:8px">
              <i class="fa-solid fa-arrows-rotate"></i> Reintentar guardar y generar
            </button>
          </div>
        `;
        document.getElementById("btn-reintentar-guardado").addEventListener("click", intentarGuardarYMostrar);
      }
      return; // se queda esperando a que el usuario reintente; el formulario sigue bloqueado
    }

    // Guardado con éxito: recién ahora se muestran los resultados
    estadoTexto.textContent = `Análisis completo — ${resultado.length} material(es) procesados. Período usado: ${mesesUsadosRedondeado} meses (${semanasUsadasRedondeado} semanas).`;
    mostrarResultados(resultado, sugerencias);

    const nombreAnalista = window.KACOSA?.usuario?.nombre || window.KACOSA?.usuario?.email || "";
    const estadoAcciones = document.getElementById("na-estado-acciones");
    if (estadoAcciones) {
      estadoAcciones.innerHTML = `<i class="fa-solid fa-circle-check"></i> Guardado correctamente${nombreAnalista ? ` por ${nombreAnalista}` : ""}. ${respGuardado.altaRotacionAgregados > 0 ? `(${respGuardado.altaRotacionAgregados} nuevo(s) en Alta Rotación)` : ""}`;
    }

    const totalAPedirNotif = estado.grupos?.pedido?.reduce((acc, m) => acc + (m.aPedir || 0), 0) || 0;

    // Aviso de posibles factores de conversión faltantes: materiales cuya unidad de
    // venta es distinta a su UMB y no tienen factor configurado (ni por material, ni
    // genérico por UMB) para convertirla — cae en factor=1 por defecto sin avisar,
    // lo que pudo haber inflado o distorsionado su "a pedir".
    const advertenciasFactor = estado.ventasProcesadas.advertenciasFactor || [];
    let mensajeNotif = `Se procesaron ${resultado.length} material(es) — ${totalAPedirNotif} unidades a pedir. El análisis quedó guardado correctamente.`;
    let iconoNotif = undefined;
    let segundosNotif = 5;

    // Agrupa por material (código): un mismo material puede aparecer varias veces
    // si se vendió con más de una unidad distinta a su UMB (ej. una vez en "M" y
    // otra en "PAQ") — se consolidan en una sola fila con todas sus unidades.
    let materialesConAdvertencia = [];
    if (advertenciasFactor.length > 0) {
      const porCodigo = new Map();
      advertenciasFactor.forEach(a => {
        if (!porCodigo.has(a.codigo)) {
          porCodigo.set(a.codigo, {
            codigo: a.codigo,
            descripcion: a.descripcion || "sin descripción",
            umb: a.umb || "",
            unidades: new Set()
          });
        }
        porCodigo.get(a.codigo).unidades.add(a.unidad);
      });
      materialesConAdvertencia = Array.from(porCodigo.values())
        .map(m => ({ ...m, unidades: Array.from(m.unidades) }))
        .sort((a, b) => a.codigo.localeCompare(b.codigo));

      // Se muestran TODOS (el modal ya tiene scroll interno) — un "y X más..." no
      // le sirve de nada al usuario, que necesita saber exactamente cuáles son.
      const listaHtml = materialesConAdvertencia
        .map(m => `${m.codigo} (${m.descripcion}) — vendido en ${m.unidades.map(u => `"${u}"`).join(", ")}, UMB "${m.umb}"`)
        .join("<br>");
      mensajeNotif += `<br><br><strong><i class="fa-solid fa-triangle-exclamation"></i> Revisa factores_conversion / factores_conversion_umb:</strong> ${materialesConAdvertencia.length} material(es) con unidad de venta distinta a su UMB, sin factor configurado para convertir:<br>${listaHtml}` +
        `<br><br><button type="button" id="btn-descargar-factores-faltantes" class="kn-boton-secundario"><i class="fa-solid fa-file-arrow-down"></i> Descargar en Excel</button>`;
      iconoNotif = '<i class="fa-solid fa-triangle-exclamation"></i>';
      segundosNotif = 12;
    }

    notificarExito(mensajeNotif, {
      titulo: "Análisis completado",
      icono: iconoNotif,
      segundos: segundosNotif,
      sinAutoCierre: materialesConAdvertencia.length > 0
    });

    if (materialesConAdvertencia.length > 0) {
      const btnDescargar = document.getElementById("btn-descargar-factores-faltantes");
      if (btnDescargar) {
        btnDescargar.addEventListener("click", () => descargarFactoresFaltantes(materialesConAdvertencia));
      }
    }

    document.dispatchEvent(new CustomEvent("kacosa:analisis-listo", { detail: window.KACOSA.ultimoAnalisis }));

    // No se reactiva el formulario: hay que evitar que el usuario vuelva a darle a
    // "Analizar" con los mismos archivos y duplique datos en Supabase. Se deja
    // visible el botón "Limpiar datos" para que pueda iniciar un análisis nuevo.
    const btnAnalizar = document.getElementById("btn-analizar");
    if (btnAnalizar) btnAnalizar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Análisis completado';
    const btnLimpiar = document.getElementById("btn-limpiar-analisis");
    if (btnLimpiar) btnLimpiar.style.display = "";
    estado.analizando = false;
  }

  await intentarGuardarYMostrar();
}

// ============================================================
//  MOSTRAR RESULTADOS
// ============================================================
function mostrarResultados(resultado, sugerencias) {
  const cont = document.getElementById("na-resultados");
  const grupos = clasificarEnCuatroGrupos(resultado, sugerencias);
  estado.grupos = grupos;

  const totalAPedir = grupos.pedido.reduce((acc, m) => acc + (m.aPedir || 0), 0);
  const porClase = { A: 0, B: 0, C: 0, D: 0 };
  resultado.forEach(m => {
    const clase = (m.clase || '').toUpperCase();
    if (porClase[clase] !== undefined) porClase[clase]++;
  });

  const infoPeriodo = window.KACOSA.ultimoAnalisis;
  const textoPeriodo = infoPeriodo
    ? `Período usado: ${infoPeriodo.mesesUsados ?? '?'} meses (${infoPeriodo.semanasUsadas ?? '?'} semanas) — movimientos del ${infoPeriodo.rangoFechasTexto ?? '—'}`
    : '';

  cont.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0; font-size:15px; color:var(--azul-base)">Resultado</h3>
      <p class="vista-sub" style="margin-top:-4px">${textoPeriodo}</p>
      <div class="kpi-grid">
        <div class="kpi-card verde">
          <div class="kpi-icono"><i class="fa-solid fa-box-open"></i></div>
          <div class="label">Materiales a pedir</div>
          <div class="valor">${grupos.pedido.length}</div>
        </div>
        <div class="kpi-card ambar">
          <div class="kpi-icono"><i class="fa-solid fa-cart-shopping"></i></div>
          <div class="label">Total unidades a pedir</div>
          <div class="valor">${totalAPedir}</div>
        </div>
        <div class="kpi-card rojo">
          <div class="kpi-icono"><i class="fa-solid fa-triangle-exclamation"></i></div>
          <div class="label">Pendiente por falta de stock</div>
          <div class="valor">${grupos.pendienteStock.length}</div>
        </div>
        <div class="kpi-card violeta">
          <div class="kpi-icono"><i class="fa-solid fa-layer-group"></i></div>
          <div class="label">Clase A / B / C / D</div>
          <div class="valor" style="font-size:18px">${porClase.A} / ${porClase.B} / ${porClase.C} / ${porClase.D}</div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:16px">
        <h3 style="margin:0; font-size:14px; color:var(--azul-base)">Materiales a pedir</h3>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <div style="position:relative; display:inline-flex; align-items:center">
            <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; font-size:12px; color:var(--texto-claro); pointer-events:none"></i>
            <input type="text" id="na-buscar" placeholder="Buscar por código o descripción..."
                   style="padding:8px 14px 8px 32px; border:1.5px solid var(--borde); border-radius:var(--radio-peq); font-size:13px; min-width:200px">
          </div>
        </div>
      </div>
      <div id="na-tabla-container"></div>

      <p class="vista-sub" style="margin-top:16px">
        EL archivo descargable incluye: (1) ${grupos.pedido.length} material(es) a pedir,
        (2) ${grupos.noPedido.length} que no ameritaron pedido,
        (3) ${grupos.pendienteStock.length} con pedido pendiente por falta de stock en Kacosa,
        (4) ${grupos.sugerencias.length} sugerencia(s),
        (5) ${(estado.sinRotacion || []).length} sin rotación en tienda.
      </p>

      <div class="btn-group">
        <button id="btn-descargar-excel" class="btn-primario"><i class="fa-solid fa-download"></i> Descargar Excel</button>
        <button id="btn-enviar-correo" class="btn-secundario"><i class="fa-solid fa-envelope"></i> Enviar por correo</button>
      </div>
      <p id="na-estado-acciones" class="estado-texto" style="margin-top:10px"></p>
    </div>
  `;

  const columnas = [
    { key: 'codigo', label: 'Código' },
    { key: 'descripcion', label: 'Descripción' },
    { key: 'umb', label: 'UMB' },
    { key: 'clase', label: 'Clase' },
    { key: 'totalVentas', label: 'Total ventas', numeric: true },
    { key: 'promedioVentasPeriodo', label: 'Promedio ventas periodo', numeric: true },
    { key: 'stockTienda', label: 'Stock tienda', numeric: true },
    { key: 'stockKacosa1000', label: 'Stock Kacosa 1000', numeric: true },
    { key: 'stockKacosa3000', label: 'Stock Kacosa 3000', numeric: true },
    { key: 'stockKacosa', label: 'Total Stock Kacosa', numeric: true },
    { key: 'ubicacionKacosa', label: 'Ubicación Kacosa' },
    { key: 'aPedir', label: 'A pedir', numeric: true },
    { key: 'porDespacho', label: 'Por despacho', numeric: true },
    { key: 'numeroDeNota', label: 'Número de nota' },
    { key: 'fechaDeNota', label: 'Fecha de nota' }
  ];

  const container = document.getElementById('na-tabla-container');
  const { renderizar } = crearTablaPaginada(container, columnas, 50);
  renderizar(grupos.pedido);

  document.getElementById('na-buscar').addEventListener('input', (e) => {
    const termino = e.target.value.toLowerCase().trim();
    if (!termino) {
      renderizar(grupos.pedido);
      return;
    }
    const filtrados = grupos.pedido.filter(m =>
      String(m.codigo).toLowerCase().includes(termino) ||
      String(m.descripcion).toLowerCase().includes(termino)
    );
    renderizar(filtrados);
  });

  document.getElementById("btn-descargar-excel").addEventListener("click", descargarExcelUnificado);
  document.getElementById("btn-enviar-correo").addEventListener("click", enviarCorreo);
}

// ============================================================
//  FUNCIONES AUXILIARES
// ============================================================
function validarCentros(filasVentas, filasStockTienda, filasStockKacosa, centrosValidos) {
  const extraerCentros = (filas) =>
    new Set(filas.map(f => String(f["Centro"] || "").trim()).filter(Boolean));

  const centrosVentas = extraerCentros(filasVentas);
  if (centrosVentas.size === 0) {
    return "El archivo de ventas no tiene datos de Centro reconocibles.";
  }
  const centrosVentasInvalidos = [...centrosVentas].filter(c => !centrosValidos.includes(c));
  if (centrosVentasInvalidos.length > 0 || centrosVentas.size > centrosValidos.length) {
    return `El archivo de ventas contiene el/los centro(s) ${[...centrosVentas].join(", ")}, pero la tienda seleccionada corresponde a ${centrosValidos.join(" o ")}. Verifica que subiste el archivo correcto.`;
  }

  const centrosStockTienda = extraerCentros(filasStockTienda);
  if (centrosStockTienda.size === 0) {
    return "El archivo de stock de la tienda no tiene datos de Centro reconocibles.";
  }
  const centrosStockInvalidos = [...centrosStockTienda].filter(c => !centrosValidos.includes(c));
  if (centrosStockInvalidos.length > 0 || centrosStockTienda.size > centrosValidos.length) {
    return `El archivo de stock de tienda contiene el/los centro(s) ${[...centrosStockTienda].join(", ")}, pero la tienda seleccionada corresponde a ${centrosValidos.join(" o ")}. Verifica que subiste el archivo correcto.`;
  }

  const centrosStockKacosa = extraerCentros(filasStockKacosa);
  if (centrosStockKacosa.size === 0) {
    return "El archivo de stock de Kacosa no tiene datos de Centro reconocibles.";
  }
  const centrosInvalidos = [...centrosStockKacosa].filter(c => !CENTROS_KACOSA.includes(c));
  if (centrosInvalidos.length > 0) {
    return `El archivo de stock de Kacosa contiene centro(s) que no pertenecen a Kacosa (${centrosInvalidos.join(", ")}). Kacosa solo puede ser 1000 y/o 3000.`;
  }

  return null;
}

function anexarAltaRotacionFaltante(resultado, stockTienda, stockKacosa, altaRotacion, periodoVentas, periodoAbastecimiento, rangoSeguridadUsado, rangoFechasTexto) {
  const codigosEnResultado = new Set(resultado.map(m => m.codigo));
  const anexados = [];

  altaRotacion.forEach(m => {
    const codigo = String(m.codigo);
    if (codigosEnResultado.has(codigo)) return;

    const infoKacosa = stockKacosa[codigo];
    const stockKacosaDisp = infoKacosa ? infoKacosa.stockDisponible : 0;
    if (stockKacosaDisp <= 0) return;

    const infoTienda = stockTienda[codigo];
    const stockTiendaDisp = infoTienda ? infoTienda.stockDisponible : 0;
    if (stockTiendaDisp > 0) return;

    const empaque = Number(m.empaque) || 1;
    const aPedir = Math.min(empaque, stockKacosaDisp);

    resultado.push({
      codigo,
      descripcion: m.descripcion,
      umb: infoKacosa?.unidadBase || infoTienda?.unidadBase || "UN",
      unidadVenta: "UN", // no vino en el archivo de ventas, no hay unidad de venta real que reportar
      materialesFusionados: "",
      clase: m.clase,
      totalVentas: 0,
      promedioVentasPeriodo: 0,
      stockTienda: stockTiendaDisp,
      stockKacosa1000: infoKacosa?.stockPorCentro?.["1000"] || 0,
      stockKacosa3000: infoKacosa?.stockPorCentro?.["3000"] || 0,
      stockKacosa: stockKacosaDisp,
      ubicacionKacosa: obtenerUbicacion(codigo),
      aPedir,
      aPedirIdeal: aPedir,
      pendiente: 0,
      empaque,
      periodoVentas,
      periodoAbastecimiento,
      rangoSeguridadUsado,
      rangoFechasTexto,
      porDespacho: 0,
      numeroDeNota: '',
      fechaDeNota: '',
      // Marca este material como "anexado": no vino en el archivo de ventas de
      // esta tienda, se agregó porque está en la base de alta rotación, tiene
      // stock en Kacosa y no tiene stock en la tienda. Sirve para resaltarlo
      // en rojo en el Excel y distinguirlo de los que sí tuvieron ventas.
      esAnexadoAltaRotacion: true
    });
    anexados.push(codigo);
  });

  return { resultadoConAnexos: resultado, anexados };
}

function generarSugerencias(resultado, stockTienda, stockKacosa, altaRotacion) {
  const codigosEnResultado = new Set(resultado.map(m => m.codigo));
  const codigosAltaRotacion = new Set(altaRotacion.map(m => String(m.codigo)));

  return Object.values(stockKacosa).filter(m => {
    if (m.stockDisponible <= 0) return false;
    if (codigosEnResultado.has(m.codigo)) return false;
    if (codigosAltaRotacion.has(m.codigo)) return false;
    const infoTienda = stockTienda[m.codigo];
    const stockTiendaDisp = infoTienda ? infoTienda.stockDisponible : 0;
    if (stockTiendaDisp > 0) return false;
    return true;
  }).map(m => ({
    codigo: m.codigo,
    descripcion: m.descripcion,
    unidadBase: m.unidadBase,
    stockKacosa: m.stockDisponible
  }));
}

function generarSinRotacion(stockKacosa, stockTienda, ventasProcesadas) {
  const codigosConMovimiento = new Set(Object.keys(ventasProcesadas.porMaterial));

  return Object.values(stockTienda).filter(m => {
    if (m.stockDisponible <= 0) return false;
    if (codigosConMovimiento.has(m.codigo)) return false;
    return true;
  }).map(m => {
    const infoKacosa = stockKacosa[m.codigo];
    return {
      codigo: m.codigo,
      descripcion: m.descripcion,
      unidadBase: m.unidadBase,
      stockTienda: m.stockDisponible,
      stockKacosa: infoKacosa ? infoKacosa.stockDisponible : 0
    };
  });
}

function clasificarEnCuatroGrupos(resultado, sugerencias) {
  const pedido = resultado.filter(m => (m.aPedir || 0) > 0);
  const noPedido = resultado.filter(m => (m.aPedirIdeal || 0) === 0);
  const pendienteStock = resultado.filter(m => (m.pendiente || 0) > 0);
  return { pedido, noPedido, pendienteStock, sugerencias };
}

// ============================================================
//  GUARDAR, ENVIAR Y DESCARGAR
// ============================================================
async function enviarCorreo() {
  const btn = document.getElementById("btn-enviar-correo");
  const estadoAcciones = document.getElementById("na-estado-acciones");

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
    }
    estadoAcciones.textContent = "Preparando el archivo...";

    const wb = construirWorkbookCompleto();
    const archivos = [{
      nombre: `Analisis_${estado.tiendaSeleccionada}_${estado.fechaAnalisis.replace(/\//g, "-")}.xlsx`,
      base64: XLSX.write(wb, { type: "base64", bookType: "xlsx" })
    }];

    const totalAPedir = estado.grupos.pedido.reduce((acc, m) => acc + (m.aPedir || 0), 0);

    estadoAcciones.textContent = "Enviando correo...";
    const resp = await callBridge("sendReport", {
      tipoReporte: "analisis",
      tienda: estado.tiendaSeleccionada,
      fechaAnalisis: estado.fechaAnalisis,
      resumen: {
        totalAPedir,
        valorEstimado: totalAPedir,
        quiebresKacosa: estado.grupos.pendienteStock.length
      },
      usuarioEmail: window.KACOSA?.usuario?.email || "",
      archivos
    });

    estadoAcciones.textContent = resp.ok ? resp.mensaje : "Error al enviar: " + resp.error;

    if (resp.ok) {
      notificarExito("El correo con el archivo Excel (Resumen + 5 pestañas) se envió correctamente al departamento de Abastecimiento.", { titulo: "Correo enviado" });
      if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Correo enviado con éxito';
    } else {
      notificarExito("No se pudo enviar el correo: " + resp.error, { titulo: "Error al enviar", icono: '<i class="fa-solid fa-triangle-exclamation"></i>', segundos: 6 });
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-envelope"></i> Enviar por correo';
      }
    }
  } catch (err) {
    console.error(err);
    estadoAcciones.textContent = "Error al enviar: " + err.message;
    notificarExito("No se pudo enviar el correo: " + err.message, { titulo: "Error al enviar", icono: '<i class="fa-solid fa-triangle-exclamation"></i>', segundos: 6 });
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-envelope"></i> Enviar por correo';
    }
  }
}

/**
 * Descarga en Excel la lista completa de materiales con advertencia de factor
 * de conversión faltante (vendidos en una unidad distinta a su UMB, sin factor
 * configurado). Columnas: Código, Descripción, Vendido en (todas las unidades
 * detectadas, separadas por coma), UMB.
 */
function descargarFactoresFaltantes(materialesConAdvertencia) {
  const datos = materialesConAdvertencia.map(m => ({
    "Código": m.codigo,
    "Descripción": m.descripcion,
    "Vendido en": m.unidades.join(", "),
    "UMB": m.umb
  }));
  const ws = XLSX.utils.json_to_sheet(datos);
  ws["!cols"] = [{ wch: 14 }, { wch: 45 }, { wch: 18 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Factores faltantes");
  const nombreTienda = (estado.tiendaSeleccionada || "tienda").toString().replace(/[^a-zA-Z0-9_-]/g, "_");
  const nombreFecha = (estado.fechaAnalisis || "").replace(/\//g, "-");
  XLSX.writeFile(wb, `Factores_conversion_faltantes_${nombreTienda}_${nombreFecha}.xlsx`);
}

function construirWorkbookCompleto() {
  const { pedido, noPedido, pendienteStock, sugerencias } = estado.grupos;
  const wb = XLSX.utils.book_new();

  const totalAPedir = pedido.reduce((acc, m) => acc + (m.aPedir || 0), 0);
  const porClase = { A: 0, B: 0, C: 0, D: 0 };
  [...pedido, ...noPedido, ...pendienteStock].forEach(m => {
    const clase = (m.clase || '').toUpperCase();
    if (porClase[clase] !== undefined) porClase[clase]++;
  });

  const wsResumen = construirHojaResumen(
    `Análisis de Abastecimiento — ${nombrePorId(estado.tiendaSeleccionada)}`,
    [
      { label: "Fecha de análisis", valor: estado.fechaAnalisis },
      { label: "Materiales a pedir", valor: pedido.length, color: "FF2F8F6E" },
      { label: "Total unidades a pedir", valor: totalAPedir, color: "FF1B2A41" },
      { label: "Pendiente por falta de stock", valor: pendienteStock.length, color: "FFC4432B" },
      { label: "No ameritaron pedido", valor: noPedido.length },
      { label: "Sugerencias adicionales", valor: sugerencias.length },
      { label: "Sin rotación en tienda", valor: (estado.sinRotacion || []).length },
      { label: "Clase A", valor: porClase.A, color: "FF2F8F6E" },
      { label: "Clase B", valor: porClase.B, color: "FF4A6FA5" },
      { label: "Clase C", valor: porClase.C, color: "FFE8A03D" },
      { label: "Clase D", valor: porClase.D, color: "FF6B7280" }
    ],
    [
      `Período de ventas analizado: ${pedido[0]?.periodoVentas || noPedido[0]?.periodoVentas || "—"}`,
      `Rango de fechas de movimientos: ${pedido[0]?.rangoFechasTexto || noPedido[0]?.rangoFechasTexto || pendienteStock[0]?.rangoFechasTexto || "—"}`,
      `Horizonte de abastecimiento: ${pedido[0]?.periodoAbastecimiento || "—"}`,
      `Rango de seguridad usado: ${pedido[0]?.rangoSeguridadUsado || "—"}`,
      `Analista: ${window.KACOSA?.usuario?.nombre || window.KACOSA?.usuario?.email || "—"}`,
      "Generado automáticamente por el sistema de Abastecimiento KACOSA."
    ]
  );
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  const columnasCompletas = [
    { key: 'codigo', label: 'Codigo', ancho: 14 },
    { key: 'descripcion', label: 'Descripcion', ancho: 38 },
    { key: 'unidadVenta', label: 'UMV', ancho: 10 },
    { key: 'materialesFusionados', label: 'Materiales_Fusionados', ancho: 22 },
    { key: 'clase', label: 'Clase', ancho: 8 },
    { key: 'totalVentas', label: 'Total_Ventas', ancho: 12 },
    { key: 'promedioVentasPeriodo', label: 'Promedio_Ventas_Periodo', ancho: 16 },
    { key: 'stockTienda', label: 'Stock_Tienda', ancho: 12 },
    { key: 'stockKacosa1000', label: 'Stock_Kacosa_1000', ancho: 14 },
    { key: 'stockKacosa3000', label: 'Stock_Kacosa_3000', ancho: 14 },
    { key: 'stockKacosa', label: 'Total_Stock_Kacosa', ancho: 14 },
    { key: 'ubicacionKacosa', label: 'Ubicacion_Kacosa', ancho: 16 },
    { key: 'umb', label: 'UMB', ancho: 10 },
    { key: 'aPedir', label: 'A_Pedir', ancho: 10 },
    { key: 'porDespacho', label: 'Por_Despacho', ancho: 12 },
    { key: 'numeroDeNota', label: 'Numero_De_Nota', ancho: 14 },
    { key: 'fechaDeNota', label: 'Fecha_De_Nota', ancho: 14 },
    { key: 'periodoVentas', label: 'Periodo_Ventas', ancho: 14 },
    { key: 'periodoAbastecimiento', label: 'Periodo_Abastecimiento', ancho: 16 },
    { key: 'rangoSeguridadUsado', label: 'Rango_Seguridad_Usado', ancho: 14 },
    { key: 'tienda', label: 'Tienda', ancho: 14 },
    { key: 'fechaAnalisis', label: 'Fecha_Analisis', ancho: 14 }
  ];

  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(pedido, columnasCompletas, {
    colorearPorClase: true,
    columnasDestacadas: [{ key: 'aPedir', color: 'FFC4432B' }]
  }), "A_Pedir");

  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(noPedido, columnasCompletas, {
    colorearPorClase: true
  }), "No_Amerito_Pedido");

  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(
    pendienteStock.map(m => ({ ...m, pendiente: (m.aPedirIdeal || 0) - (m.aPedir || 0) })),
    [
      { key: 'codigo', label: 'Codigo', ancho: 14 }, { key: 'descripcion', label: 'Descripcion', ancho: 38 },
      { key: 'unidadVenta', label: 'UMV', ancho: 10 },
      { key: 'materialesFusionados', label: 'Materiales_Fusionados', ancho: 22 },
      { key: 'clase', label: 'Clase', ancho: 8 },
      { key: 'totalVentas', label: 'Total_Ventas', ancho: 12 },
      { key: 'promedioVentasPeriodo', label: 'Promedio_Ventas_Periodo', ancho: 16 },
      { key: 'stockTienda', label: 'Stock_Tienda', ancho: 12 },
      { key: 'umb', label: 'UMB', ancho: 10 },
      { key: 'aPedirIdeal', label: 'A_Pedir_Ideal', ancho: 12 },
      { key: 'aPedir', label: 'A_Pedir_Real', ancho: 12 }, { key: 'pendiente', label: 'Pendiente', ancho: 12 },
      { key: 'stockKacosa1000', label: 'Stock_Kacosa_1000', ancho: 14 },
      { key: 'stockKacosa3000', label: 'Stock_Kacosa_3000', ancho: 14 },
      { key: 'stockKacosa', label: 'Total_Stock_Kacosa', ancho: 14 },
      { key: 'ubicacionKacosa', label: 'Ubicacion_Kacosa', ancho: 16 },
      { key: 'periodoAbastecimiento', label: 'Periodo_Abastecimiento', ancho: 16 },
      { key: 'tienda', label: 'Tienda', ancho: 14 },
      { key: 'rangoSeguridadUsado', label: 'Rango_Seguridad_Usado', ancho: 14 }
    ],
    {
      colorearPorClase: true,
      columnasDestacadas: [{ key: 'pendiente', color: 'FFC4432B' }]
    }
  ), "Pendiente_Stock_Kacosa");

  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(sugerencias, [
    { key: 'codigo', label: 'Codigo', ancho: 14 }, { key: 'descripcion', label: 'Descripcion', ancho: 38 },
    { key: 'stockKacosa', label: 'Stock_Kacosa', ancho: 12 }
  ]), "Sugerencias");

  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada((estado.sinRotacion || []), [
    { key: 'codigo', label: 'Codigo', ancho: 14 }, { key: 'descripcion', label: 'Descripcion', ancho: 38 },
    { key: 'stockTienda', label: 'Stock_Tienda', ancho: 12 }, { key: 'stockKacosa', label: 'Stock_Kacosa', ancho: 12 }
  ]), "Sin_Rotacion");

  return wb;
}

function descargarExcelUnificado() {
  const btn = document.getElementById("btn-descargar-excel");
  try {
    const base = `${estado.tiendaSeleccionada}_${estado.fechaAnalisis.replace(/\//g, "-")}`;
    XLSX.writeFile(construirWorkbookCompleto(), `Analisis_${base}.xlsx`);
    notificarExito("El archivo Excel con las 6 pestañas (Resumen + 5 reportes) se descargó correctamente.", { titulo: "Excel descargado" });
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Archivo descargado correctamente';
    }
  } catch (err) {
    console.error(err);
    notificarExito("No se pudo descargar el archivo: " + err.message, { titulo: "Error al descargar", icono: '<i class="fa-solid fa-triangle-exclamation"></i>', segundos: 6 });
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-download"></i> Descargar Excel';
    }
  }
}

document.addEventListener("kacosa:vista-cambiada", (e) => {
  if (e.detail.vista === "vista-nuevo-analisis") render();
});

// Si esta vista fue la que se mostró al cargar la página (por ejemplo, al
// entrar directo a "Nuevo Análisis" desde el menú del shell, vía hash), el
// evento "kacosa:vista-cambiada" puede dispararse ANTES de que nav.js termine
// de resolver la sesión y llenar window.KACOSA.tiendas (es una llamada async
// a Firebase/el portal). En ese caso render() se ejecuta con tiendas = [] y
// el selector de tienda sale vacío — sin opciones y sin valor por defecto,
// incluso para un admin.
//
// Además, "kacosa:usuario-listo" también se dispara al cambiar de cuenta SIN
// recargar la página (típico al probar varias cuentas seguidas en la misma
// pestaña). Sin resetear "estado" aquí, un análisis ya completado (o una
// tienda seleccionada) de la cuenta anterior se quedaba pegado en pantalla
// para la cuenta nueva. Por eso siempre se reinicia "estado" a limpio en
// cuanto el usuario/tiendas ya están listos, y se reconstruye el formulario
// si el usuario sigue en esta vista.
document.addEventListener("kacosa:usuario-listo", () => {
  estado = estadoInicial();
  const vista = document.getElementById("vista-nuevo-analisis");
  if (vista && vista.classList.contains("activa")) render();
});
