// js/nuevo-analisis.js
import { parsearMHT, aNumero } from "./mht-parser.js";
import { procesarVentas, calcularRangoFechasVentas } from "./ventas-parser.js";
import { cargarFactoresConversion } from "./factores-conversion.js";
import { cargarCodigosExcluidos } from "./exclusiones.js";
import { agruparStock, procesarNotasPendientes, restarNotasPendientesDeKacosa } from "./stock-parser.js";
import { cargarPaquetes } from "./paquetes.js";
import { cargarUbicaciones, obtenerUbicacion } from "./ubicaciones.js";
import { calcularAbastecimiento } from "./calculo-abastecimiento.js";
import { detectarCandidatosLocal, fusionarDuplicados } from "./deteccion-duplicados.js";
import { TIENDAS, nombrePorId, centrosDeTienda } from "./tiendas.js";
import { callBridge } from "./bridge.js";
import { crearTablaPaginada } from "./tabla-utils.js";
import { notificarExito, confirmarAccion } from "./notificaciones.js";
import { construirHojaEstilizada, construirHojaResumen } from "./excel-estilos.js";
import { procesarPendientesSync, restarPendientesSync } from "./pendientes-sync-parser.js";

const CENTROS_KACOSA = ["1000", "3000"];

// Filas ya parseadas de los archivos de stock (tienda/Kacosa), guardadas para
// poder re-validar Centro/Almacén sin releer el archivo si el usuario cambia
// la tienda DESPUÉS de haber subido los archivos.
const cacheFilasStock = {};

// Configuración de cada input de archivo (se usa al construir el formulario
// y también para limpiarlo por completo con "Limpiar datos").
const CONFIG_ARCHIVOS = [
  { id: 'na-ventas', nameId: 'file-name-ventas', statusId: 'file-status-ventas', wrapperId: 'file-wrapper-ventas', validId: 'validacion-ventas', clearId: 'file-clear-ventas', tipo: 'ventas', opcional: false },
  { id: 'na-stock-tienda', nameId: 'file-name-stock-tienda', statusId: 'file-status-stock-tienda', wrapperId: 'file-wrapper-stock-tienda', validId: 'validacion-stock-tienda', clearId: 'file-clear-stock-tienda', tipo: 'stock', opcional: false },
  { id: 'na-stock-kacosa', nameId: 'file-name-stock-kacosa', statusId: 'file-status-stock-kacosa', wrapperId: 'file-wrapper-stock-kacosa', validId: 'validacion-stock-kacosa', clearId: 'file-clear-stock-kacosa', tipo: 'stock', opcional: false },
  { id: 'na-notas-pendientes', nameId: 'file-name-notas-pendientes', statusId: 'file-status-notas-pendientes', wrapperId: 'file-wrapper-notas-pendientes', validId: 'validacion-notas-pendientes', clearId: 'file-clear-notas-pendientes', tipo: 'notas', opcional: false },
  { id: 'na-pendientes-sync', nameId: 'file-name-pendientes-sync', statusId: 'file-status-pendientes-sync', wrapperId: 'file-wrapper-pendientes-sync', validId: 'validacion-pendientes-sync', clearId: 'file-clear-pendientes-sync', tipo: 'pendientes-sync', opcional: true }
];

// IDs de todos los campos del formulario que deben bloquearse mientras se procesa
// un análisis (para evitar cargas o cambios a mitad de proceso).
const IDS_CAMPOS_FORMULARIO = [
  'na-tienda', 'na-ventas', 'na-stock-tienda', 'na-stock-kacosa',
  'na-notas-pendientes', 'na-pendientes-sync', 'na-periodo', 'na-meses-cantidad', 'na-margen'
];

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
/**
 * Envía las filas crudas de stock (tienda + Kacosa) y de movimientos (archivo de ventas)
 * a las tablas "stock" y "movimientos" de Supabase, vía el bridge (Apps Script).
 * Se ejecuta en segundo plano: si falla, solo se registra en consola y no interrumpe el análisis.
 */
function sincronizarStockYMovimientos(filasVentas, filasStockTienda, filasStockKacosa) {
  const filasStock = [...filasStockTienda, ...filasStockKacosa].map(f => ({
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

  const filasMovimientos = filasVentas.map(f => ({
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

  if (filasStock.length > 0) {
    callBridge("guardarStock", { filas: filasStock }).catch(err =>
      console.error("No se pudo sincronizar el stock con Supabase:", err)
    );
  }
  if (filasMovimientos.length > 0) {
    callBridge("guardarMovimientos", { filas: filasMovimientos }).catch(err =>
      console.error("No se pudo sincronizar los movimientos con Supabase:", err)
    );
  }
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

// El de pendientes por sincronizar ahora se descarga directo de SAP como
// .MHT (igual que ventas/stock/notas), no se arma más a mano en Excel. Debe
// contener AL MENOS estas columnas (pueden venir más, no pasa nada — a
// diferencia del viejo formato .xlsx que exigía columnas exactas).
const COLUMNAS_PENDIENTES_SYNC = [
  "Fec. Fact/Dev", "Tienda", "Almacen", "Caja", "Nro. Fact./Dev.", "F. Fiscal",
  "Nro. Posicion", "Material", "Lote", "Cantidad", "Un.medida venta",
  "Nro. Doc. FI", "Nro. Doc. MM", "Cl. Mov.", "Icono", "Observación"
];

// ============================================================
//  ALMACENES PERMITIDOS (columna "Almacén" de los archivos de stock)
// ============================================================
// Dentro de cada Centro SAP, el almacén puede ser el "general" (stock normal)
// o el de "exhibición" (vitrina/showroom) — a veces hay un tercero. Van
// atados al Centro: el archivo de stock de una tienda solo puede traer los
// almacenes DE ESA tienda, no los de cualquier otra (antes se validaba contra
// una lista global de todas las tiendas juntas, lo que dejaba colar, por
// ejemplo, el stock de Kacosa como si fuera el de una tienda cualquiera).
const ALMACENES_POR_CENTRO = {
  "1200": ["1200", "1203"],
  "1300": ["1300", "1303"],
  "1400": ["1400", "1403"],
  "1500": ["1500", "1503"],
  "1600": ["1600", "1603"],
  "1700": ["1700", "1703"],
  "1900": ["1900", "1903"],
  "11A0": ["11A0", "11A3"],
  "12A0": ["12A0", "12A3"],
  "19A0": ["19A0", "19A3"],
  "2010": ["2010", "2013", "2017"],
  "2090": ["2090", "2093"],
  "1020": ["1020", "1023"],
  // Kacosa (casa matriz): 1000/1029 = general, 1001 = exhibición (centro 1000);
  // 3000/3029 = general, 3001 = exhibición (centro 3000).
  "1000": ["1000", "1029", "1001"],
  "3000": ["3000", "3029", "3001"]
};

/** Une los almacenes permitidos de una lista de centros (una tienda puede tener más de uno, ej. Kacosa). */
function almacenesPermitidosParaCentros(centros) {
  const set = new Set();
  centros.forEach(c => (ALMACENES_POR_CENTRO[c] || []).forEach(a => set.add(a)));
  return [...set];
}

/**
 * Revisa que la columna "Almacén" de los archivos de stock (tienda y Kacosa)
 * solo contenga los códigos que corresponden a los centros de la tienda
 * seleccionada (y, para el stock de Kacosa, a los centros 1000/3000).
 * Devuelve un mensaje de error (string) si encuentra alguno no permitido, o
 * null si todo está bien.
 * @param {string[]} centrosTienda - centros de la tienda seleccionada (centrosDeTienda(tienda))
 */
function validarAlmacenes(filasStockTienda, filasStockKacosa, centrosTienda) {
  const almacenesTiendaPermitidos = almacenesPermitidosParaCentros(centrosTienda);
  const almacenesKacosaPermitidos = almacenesPermitidosParaCentros(CENTROS_KACOSA);

  const tieneAlmacenNoPermitido = (filas, permitidos) =>
    filas.some(f => {
      const almacen = String(f["Almacén"] || "").trim();
      return almacen !== "" && !permitidos.includes(almacen);
    });

  if (tieneAlmacenNoPermitido(filasStockTienda, almacenesTiendaPermitidos)) {
    return `Tu archivo tiene stock de almacenes no permitidos, solo se admiten para el stock de la tienda los almacenes del general y exhibición (${almacenesTiendaPermitidos.join(", ")})`;
  }
  if (tieneAlmacenNoPermitido(filasStockKacosa, almacenesKacosaPermitidos)) {
    return `Tu archivo tiene stock de almacenes no permitidos, solo se admiten para el stock de Kacosa los almacenes ${almacenesKacosaPermitidos.join(", ")}`;
  }
  return null;
}

/** Centros de la tienda actualmente seleccionada en el formulario (o [] si aún no se ha elegido). */
function obtenerCentrosTiendaSeleccionada() {
  const tiendaEl = document.getElementById("na-tienda");
  return tiendaEl && tiendaEl.value ? centrosDeTienda(tiendaEl.value) : [];
}

/**
 * Validación INMEDIATA de un archivo de stock recién cargado (antes de hacer
 * clic en "Analizar"): revisa que su Centro y sus Almacenes correspondan a la
 * tienda seleccionada (o a Kacosa, si esArchivoDeKacosa=true). Devuelve:
 *   - null: todavía no se puede validar (no se ha elegido tienda)
 *   - { valido:false, mensaje }: el archivo no corresponde, con el motivo
 *   - { valido:true }: todo en orden
 * Esto es un chequeo adicional a favor de la experiencia del usuario — la
 * validación real y definitiva sigue ocurriendo también al analizar
 * (validarCentros / validarAlmacenes), como red de seguridad.
 */
function validarCentroYAlmacenStock(filas, esArchivoDeKacosa) {
  const centrosPermitidos = esArchivoDeKacosa ? CENTROS_KACOSA : obtenerCentrosTiendaSeleccionada();
  if (centrosPermitidos.length === 0) return null; // aún no hay tienda elegida

  const centrosEnArchivo = new Set(filas.map(f => String(f["Centro"] || "").trim()).filter(Boolean));
  if (centrosEnArchivo.size === 0) {
    return { valido: false, mensaje: '<i class="fa-solid fa-triangle-exclamation"></i> El archivo no tiene datos de Centro reconocibles.' };
  }

  const centrosInvalidos = [...centrosEnArchivo].filter(c => !centrosPermitidos.includes(c));
  if (centrosInvalidos.length > 0) {
    const nombreDestino = esArchivoDeKacosa ? "Kacosa" : "la tienda seleccionada";
    return {
      valido: false,
      mensaje: `<i class="fa-solid fa-triangle-exclamation"></i> Este archivo es del centro ${[...centrosEnArchivo].join(", ")}, pero no corresponde a ${nombreDestino} (${centrosPermitidos.join(" o ")}). Verifica que subiste el archivo correcto.`
    };
  }

  const almacenesPermitidos = almacenesPermitidosParaCentros(centrosPermitidos);
  const almacenesInvalidos = new Set();
  filas.forEach(f => {
    const almacen = String(f["Almacén"] || "").trim();
    if (almacen && !almacenesPermitidos.includes(almacen)) almacenesInvalidos.add(almacen);
  });
  if (almacenesInvalidos.size > 0) {
    const mensajeBase = esArchivoDeKacosa
      ? `Tu archivo tiene stock de almacenes no permitidos, solo se admiten para el stock de Kacosa los almacenes ${almacenesPermitidos.join(", ")}`
      : `Tu archivo tiene stock de almacenes no permitidos, solo se admiten para el stock de la tienda los almacenes del general y exhibición (${almacenesPermitidos.join(", ")})`;
    return { valido: false, mensaje: '<i class="fa-solid fa-triangle-exclamation"></i> ' + mensajeBase };
  }

  return { valido: true };
}

// ============================================================
//  RANGO DE FECHAS PERMITIDO PARA EL ARCHIVO DE VENTAS
// ============================================================
const MESES_VENTAS_MINIMO = 3;
const MESES_VENTAS_MAXIMO = 12;

/** Formatea una fecha JS como DD/MM/AAAA para mostrarla en mensajes de validación. */
function formatearFechaCorta(fecha) {
  if (!fecha) return "";
  return String(fecha.getDate()).padStart(2, "0") + "/" +
         String(fecha.getMonth() + 1).padStart(2, "0") + "/" +
         fecha.getFullYear();
}

/**
 * Revisa que el archivo de ventas cubra entre MESES_VENTAS_MINIMO y
 * MESES_VENTAS_MAXIMO meses de historial (según las fechas de contabilización
 * de sus filas). Devuelve un mensaje de error (string) si el rango es muy
 * corto o muy largo, o null si está dentro de lo permitido.
 */
function validarRangoVentas(filasVentas) {
  const { inicio, fin, meses } = calcularRangoFechasVentas(filasVentas);

  if (!inicio || !fin) {
    return "No se pudieron leer fechas válidas en el archivo de ventas (columna Fe.contabilización).";
  }

  const rangoTexto = `del ${formatearFechaCorta(inicio)} al ${formatearFechaCorta(fin)}`;

  if (meses < MESES_VENTAS_MINIMO) {
    return `Tu archivo de ventas cubre muy poco tiempo (${rangoTexto}, ≈${redondearUnDecimal(meses)} mes(es)). Se necesita un mínimo de ${MESES_VENTAS_MINIMO} meses de historial para que el análisis sea confiable.`;
  }
  if (meses > MESES_VENTAS_MAXIMO) {
    return `Tu archivo de ventas cubre demasiado tiempo (${rangoTexto}, ≈${redondearUnDecimal(meses)} meses). Se admite un máximo de ${MESES_VENTAS_MAXIMO} meses de historial por análisis.`;
  }
  return null;
}

function redondearUnDecimal(n) {
  return Math.round(n * 10) / 10;
}

// ============================================================
//  ESTADO PERSISTENTE
// ============================================================
function estadoInicial() {
  return {
    ventasProcesadas: null,
    stockTienda: null,
    stockKacosa: null,
    notasPendientes: null,
    pendientesSync: null,
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
    analisisCompleto: null,
    analizando: false,
    // Contador que se incrementa cada vez que arranca un análisis nuevo o se
    // cancela uno en curso. ejecutarAnalisis() guarda su propio número al
    // empezar y lo compara contra este después de cada espera asíncrona: si
    // ya no coincide (el usuario le dio a "Detener"/"Cancelar"), se corta en
    // seco sin seguir tocando la pantalla que el botón ya dejó lista.
    analisisId: 0,
    // Códigos que el usuario decidió excluir manualmente del pedido en la
    // pantalla de resultados (con el botón de "quitar" fila por fila). Solo
    // afecta lo que se descarga/envía por correo — el análisis guardado en la
    // base de datos no cambia. Se reinicia con cada análisis nuevo.
    excluidos: new Set()
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

      <div class="estado-texto" style="display:flex; align-items:flex-start; gap:8px; margin-top:10px; padding:10px 12px; background:var(--ambar-claro); border-radius:8px; color:var(--ambar-oscuro); font-size:12.5px; line-height:1.5">
        <i class="fa-solid fa-circle-info" style="margin-top:2px; flex-shrink:0"></i>
        <span>El archivo de ventas debe cubrir <strong>entre 3 y 12 meses</strong> de historial. Si el rango es menor o mayor a eso, no se podrá completar el análisis.</span>
      </div>

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
          <button type="button" class="file-clear-btn" id="file-clear-ventas" title="Quitar archivo" style="display:none"><i class="fa-solid fa-xmark"></i></button>
          <input type="file" id="na-ventas" accept=".mht,.MHT">
        </div>
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
          <button type="button" class="file-clear-btn" id="file-clear-stock-tienda" title="Quitar archivo" style="display:none"><i class="fa-solid fa-xmark"></i></button>
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
          <button type="button" class="file-clear-btn" id="file-clear-stock-kacosa" title="Quitar archivo" style="display:none"><i class="fa-solid fa-xmark"></i></button>
          <input type="file" id="na-stock-kacosa" accept=".mht,.MHT">
        </div>
        <div id="validacion-stock-kacosa" class="estado-texto" style="color:var(--verde-kpi); font-size:12px; margin-top:4px"></div>
      </div>

      <!-- Notas pendientes por despacho (obligatorio) -->
      <div style="margin-top:16px">
        <label class="form-label" for="na-notas-pendientes">Notas pendientes por despacho <span class="required">*</span></label>
        <div class="file-input-wrapper" id="file-wrapper-notas-pendientes">
          <span class="file-icon"><i class="fa-solid fa-file-invoice"></i></span>
          <div class="file-info">
            <div class="file-name" id="file-name-notas-pendientes">Seleccionar archivo</div>
            <div class="file-hint">.MHT de SAP · Notas pendientes por despacho</div>
          </div>
          <span class="file-status empty" id="file-status-notas-pendientes">Sin usar</span>
          <button type="button" class="file-clear-btn" id="file-clear-notas-pendientes" title="Quitar archivo" style="display:none"><i class="fa-solid fa-xmark"></i></button>
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
            <div class="file-hint">.MHT de SAP · Materiales pendientes por sincronizar</div>
          </div>
          <span class="file-status empty" id="file-status-pendientes-sync">Sin usar</span>
          <button type="button" class="file-clear-btn" id="file-clear-pendientes-sync" title="Quitar archivo" style="display:none"><i class="fa-solid fa-xmark"></i></button>
          <input type="file" id="na-pendientes-sync" accept=".mht,.MHT">
        </div>
        <div id="validacion-pendientes-sync" class="estado-texto" style="color:var(--verde-kpi); font-size:12px; margin-top:4px"></div>
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

      <!-- Botón Analizar + Detener + Limpiar datos -->
      <div class="btn-group" style="margin-top:20px">
        <button id="btn-analizar" class="btn-primario" style="min-width:200px">
          <i class="fa-solid fa-bolt"></i> Analizar
        </button>
        <button id="btn-detener-analisis" class="btn-sutil-peligro" style="display:none; min-width:140px">
          <i class="fa-solid fa-circle-stop"></i> Detener
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

  fileInputs.forEach(({ id, nameId, statusId, wrapperId, validId, clearId, tipo, opcional }) => {
    const input = document.getElementById(id);
    const nameEl = document.getElementById(nameId);
    const statusEl = document.getElementById(statusId);
    const wrapper = document.getElementById(wrapperId);
    const validEl = validId ? document.getElementById(validId) : null;
    const clearBtn = clearId ? document.getElementById(clearId) : null;
    const textoVacio = opcional ? 'Sin usar' : 'Pendiente';

    /** Deja el recuadro como si nunca se hubiera elegido un archivo. */
    const vaciarRecuadro = () => {
      input.value = '';
      nameEl.textContent = 'Seleccionar archivo';
      statusEl.textContent = textoVacio;
      statusEl.className = 'file-status empty';
      wrapper.classList.remove('loaded');
      if (validEl) {
        validEl.innerHTML = '';
        input.dataset.valido = 'false';
      }
      if (clearBtn) clearBtn.style.display = 'none';
      delete cacheFilasStock[id];
    };

    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // no debe abrir el selector de archivos del wrapper
        vaciarRecuadro();
        actualizarBotonAnalizar();
      });
    }

    if (input) {
      input.addEventListener('change', async () => {
        if (input.files && input.files[0]) {
          nameEl.textContent = input.files[0].name;
          statusEl.innerHTML = '<i class="fa-solid fa-check"></i> Cargado';
          statusEl.className = 'file-status loaded';
          wrapper.classList.add('loaded');
          if (clearBtn) clearBtn.style.display = 'flex';

          if (validEl && tipo) {
            try {
              const filas = parsearMHT(await input.files[0].text());

              if (tipo === 'stock') cacheFilasStock[id] = filas;

              let columnasRequeridas;
              if (tipo === 'ventas') columnasRequeridas = COLUMNAS_VENTAS;
              else if (tipo === 'stock') columnasRequeridas = COLUMNAS_STOCK;
              else if (tipo === 'notas') columnasRequeridas = COLUMNAS_NOTAS_PENDIENTES;
              else if (tipo === 'pendientes-sync') columnasRequeridas = COLUMNAS_PENDIENTES_SYNC;
              else columnasRequeridas = [];
              let resultado = validarColumnasArchivo(filas, columnasRequeridas, tipo);

              let mensajeFinal = resultado.mensaje;
              let validoFinal = resultado.valido;

              // Si las columnas están OK y es un archivo de stock, se valida también
              // de inmediato que el Centro/Almacén correspondan a la tienda elegida
              // (o a Kacosa), en vez de esperar hasta el clic en "Analizar".
              if (validoFinal && (id === 'na-stock-tienda' || id === 'na-stock-kacosa')) {
                const chequeo = validarCentroYAlmacenStock(filas, id === 'na-stock-kacosa');
                if (chequeo && !chequeo.valido) {
                  mensajeFinal = chequeo.mensaje;
                  validoFinal = false;
                }
              }

              validEl.innerHTML = mensajeFinal;
              validEl.style.color = validoFinal ? 'var(--verde-kpi)' : 'var(--rojo-alerta)';
              input.dataset.valido = validoFinal ? 'true' : 'false';
            } catch (err) {
              validEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error al leer el archivo: ' + err.message;
              validEl.style.color = 'var(--rojo-alerta)';
              input.dataset.valido = 'false';
            }
          }
        } else {
          vaciarRecuadro();
        }
        actualizarBotonAnalizar();
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

  // Si el usuario cambia de tienda DESPUÉS de haber subido el stock de la
  // tienda, hay que re-validar ese archivo contra la nueva tienda (el stock
  // de Kacosa no depende de la tienda, así que no hace falta re-chequearlo).
  const tiendaEl = document.getElementById("na-tienda");
  if (tiendaEl && tiendaEl.tagName === "SELECT") {
    tiendaEl.addEventListener("change", () => {
      const filas = cacheFilasStock["na-stock-tienda"];
      const validEl = document.getElementById("validacion-stock-tienda");
      const inputStockTienda = document.getElementById("na-stock-tienda");
      if (!filas || !validEl || !inputStockTienda) return;

      const chequeo = validarCentroYAlmacenStock(filas, false);
      if (chequeo && !chequeo.valido) {
        validEl.innerHTML = chequeo.mensaje;
        validEl.style.color = 'var(--rojo-alerta)';
        inputStockTienda.dataset.valido = 'false';
      } else {
        validEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Archivo válido: contiene todas las columnas requeridas (${COLUMNAS_STOCK.length})`;
        validEl.style.color = 'var(--verde-kpi)';
        inputStockTienda.dataset.valido = 'true';
      }
      actualizarBotonAnalizar();
    });
  }

  actualizarBotonAnalizar(); // estado inicial: sin archivos cargados, debe empezar deshabilitado

  document.getElementById("btn-analizar").addEventListener("click", ejecutarAnalisis);
  document.getElementById("btn-limpiar-analisis").addEventListener("click", limpiarAnalisis);
  document.getElementById("btn-detener-analisis").addEventListener("click", detenerAnalisisEnCurso);
}

// ============================================================
//  VALIDACIÓN DE COLUMNAS
// ============================================================
function validarColumnasArchivo(filas, columnasRequeridas, tipo) {
  if (filas.length === 0) {
    return { valido: false, mensaje: '<i class="fa-solid fa-triangle-exclamation"></i> El archivo está vacío o no tiene datos', faltantes: columnasRequeridas };
  }

  const columnasExistentes = Object.keys(filas[0]);
  const faltantes = columnasRequeridas.filter(col => !columnasExistentes.includes(col));

  if (faltantes.length === 0) {
    return { valido: true, mensaje: `<i class="fa-solid fa-circle-check"></i> Archivo válido: contiene todas las columnas requeridas (${columnasRequeridas.length})`, faltantes: [] };
  }

  const nombreTipo = tipo === 'ventas' ? 'ventas' : tipo === 'stock' ? 'stock' : tipo === 'notas' ? 'notas pendientes' : 'materiales pendientes por sincronizar';
  return {
    valido: false,
    mensaje: `<i class="fa-solid fa-triangle-exclamation"></i> El archivo de ${nombreTipo} no tiene las columnas correctas. Faltan: ${faltantes.join(', ')}`,
    faltantes: faltantes
  };
}

// ============================================================
//  VERIFICACIÓN DE ARCHIVOS VÁLIDOS
// ============================================================
function verificarArchivosValidos() {
  const requeridos = [
    { id: 'na-ventas', nombre: 'ventas' },
    { id: 'na-stock-tienda', nombre: 'stock de tienda' },
    { id: 'na-stock-kacosa', nombre: 'stock de Kacosa' },
    { id: 'na-notas-pendientes', nombre: 'notas pendientes por despacho' }
  ];
  const opcionales = [
    { id: 'na-pendientes-sync', nombre: 'materiales pendientes por sincronizar' }
  ];

  for (const arch of requeridos) {
    const input = document.getElementById(arch.id);
    if (!input || !input.files || input.files.length === 0) {
      return { ok: false, error: `Falta el archivo de ${arch.nombre}` };
    }
    if (input.dataset.valido !== 'true') {
      return { ok: false, error: `El archivo de ${arch.nombre} no es válido. Verifica que tenga las columnas correctas.` };
    }
  }

  // Los opcionales solo se exigen válidos SI el usuario cargó algo en ellos;
  // si no se usaron, no bloquean el análisis.
  for (const arch of opcionales) {
    const input = document.getElementById(arch.id);
    if (input && input.files && input.files.length > 0 && input.dataset.valido !== 'true') {
      return { ok: false, error: `El archivo de ${arch.nombre} no es válido. Verifica que tenga las columnas correctas.` };
    }
  }

  return { ok: true };
}

/**
 * Habilita o deshabilita el botón "Analizar" según si, en este momento, todos
 * los archivos cargados (obligatorios + opcionales que se hayan usado) son
 * válidos. Se llama cada vez que cambia algo relevante: se sube/quita un
 * archivo, o cambia la tienda seleccionada. No toca el botón mientras ya hay
 * un análisis en curso (eso lo maneja ejecutarAnalisis por su cuenta).
 */
function actualizarBotonAnalizar() {
  if (estado.analizando) return;
  const btnAnalizar = document.getElementById("btn-analizar");
  if (!btnAnalizar) return;
  btnAnalizar.disabled = !verificarArchivosValidos().ok;
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
  CONFIG_ARCHIVOS.forEach(({ id, nameId, statusId, wrapperId, validId, clearId, opcional }) => {
    const input = document.getElementById(id);
    const nameEl = document.getElementById(nameId);
    const statusEl = document.getElementById(statusId);
    const wrapper = document.getElementById(wrapperId);
    const validEl = validId ? document.getElementById(validId) : null;
    const clearBtn = clearId ? document.getElementById(clearId) : null;

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
    if (clearBtn) clearBtn.style.display = "none";
    delete cacheFilasStock[id];
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
  estado.pendientesSync = null;
  estado.clustersCandidatos = [];
  estado.gruposCandidatos = [];
  estado.resultadoFinal = null;
  estado.fechaAnalisis = null;
  estado.grupos = null;
  estado.excluidos = new Set();
  estado.sinRotacion = null;
  estado.sugerencias = null;
  estado.periodo = null;
  estado.mesesCantidad = null;
  estado.margenPct = null;
  estado.analisisCompleto = null;
  estado.analizando = false;

  // Reactiva el formulario y el botón Analizar; oculta "Limpiar datos"
  bloquearFormulario(false);
  const btnAnalizar = document.getElementById("btn-analizar");
  if (btnAnalizar) {
    btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
  }
  actualizarBotonAnalizar(); // debe quedar deshabilitado: ya no hay archivos cargados
  const btnLimpiar = document.getElementById("btn-limpiar-analisis");
  if (btnLimpiar) btnLimpiar.style.display = "none";
}

/**
 * Detiene un análisis en curso o descarta la revisión de duplicados sin
 * confirmar ninguno, dejando el formulario exactamente como estaba antes de
 * pulsar "Analizar": los mismos archivos siguen cargados (y válidos), el
 * mismo período/margen elegidos, y nada quedó calculado ni guardado.
 *
 * La usa tanto el botón "Detener" (visible mientras se leen/validan los
 * archivos) como el botón "Cancelar" que aparece junto a "Confirmar y
 * calcular" (visible mientras se revisan los duplicados detectados). A
 * partir de que arranca el guardado en la base de datos (dentro de
 * finalizarCalculo/intentarGuardarYMostrar) ya no hay botón de cancelar: ese
 * tramo no ofrece ninguno de los dos.
 */
function detenerAnalisisEnCurso() {
  // Invalida cualquier tramo de ejecutarAnalisis que siga pendiente en un
  // await: al retomar, comparará su número contra este y saldrá sin tocar
  // la pantalla que este botón ya dejó lista.
  estado.analisisId = (estado.analisisId || 0) + 1;

  estado.ventasProcesadas = null;
  estado.stockTienda = null;
  estado.stockKacosa = null;
  estado.notasPendientes = null;
  estado.pendientesSync = null;
  estado.clustersCandidatos = [];
  estado.gruposCandidatos = [];
  estado.resultadoFinal = null;
  estado.fechaAnalisis = null;
  estado.grupos = null;
  estado.excluidos = new Set();
  estado.sinRotacion = null;
  estado.sugerencias = null;
  estado.analisisCompleto = null;
  estado.analizando = false;

  const duplicadosEl = document.getElementById("na-duplicados");
  if (duplicadosEl) duplicadosEl.innerHTML = "";
  const resultadosEl = document.getElementById("na-resultados");
  if (resultadosEl) resultadosEl.innerHTML = "";

  bloquearFormulario(false);

  const btnAnalizar = document.getElementById("btn-analizar");
  if (btnAnalizar) btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
  actualizarBotonAnalizar(); // vuelve a habilitarlo si los archivos cargados siguen siendo válidos

  const btnDetener = document.getElementById("btn-detener-analisis");
  if (btnDetener) btnDetener.style.display = "none";

  const estadoTexto = document.getElementById("na-estado");
  if (estadoTexto) {
    estadoTexto.innerHTML = '<i class="fa-solid fa-circle-stop"></i> Análisis detenido. Los archivos cargados se conservan; ajusta lo que necesites y vuelve a pulsar "Analizar".';
  }
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

  const MARGEN_UMBRAL_CONFIRMACION = 30;
  if (margenPct > MARGEN_UMBRAL_CONFIRMACION) {
    const btnAnalizarPrevio = document.getElementById("btn-analizar");
    if (btnAnalizarPrevio) btnAnalizarPrevio.disabled = true; // evita doble clic mientras decide
    const continuar = await confirmarAccion(
      `Elegiste un margen de seguridad de <strong>${margenPct}%</strong>, por encima del ${MARGEN_UMBRAL_CONFIRMACION}% habitual. Un margen tan alto puede inflar bastante las cantidades a pedir.<br><br>¿Quieres continuar de todas formas?`,
      {
        titulo: "Margen de seguridad alto",
        icono: '<i class="fa-solid fa-triangle-exclamation"></i>',
        textoConfirmar: `Sí, usar ${margenPct}%`,
        textoCancelar: "Cancelar y ajustar"
      }
    );
    if (!continuar) {
      estadoTexto.textContent = "Análisis cancelado. Ajusta el margen de seguridad si lo deseas.";
      actualizarBotonAnalizar();
      return;
    }
  }

  // Número de este análisis: se compara contra estado.analisisId después de
  // cada espera asíncrona para detectar si el usuario pulsó "Detener" o
  // "Cancelar" mientras tanto y, de ser así, cortar en seco sin seguir
  // tocando la pantalla (que esos botones ya dejaron lista).
  const miAnalisisId = ++estado.analisisId;
  const fueCancelado = () => estado.analisisId !== miAnalisisId;

  try {
    estado.analizando = true;
    const btnAnalizar = document.getElementById("btn-analizar");
    btnAnalizar.disabled = true;
    btnAnalizar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analizando...';
    bloquearFormulario(true);
    const btnDetener = document.getElementById("btn-detener-analisis");
    if (btnDetener) { btnDetener.style.display = ""; btnDetener.disabled = false; }

    estadoTexto.textContent = "Leyendo archivo de ventas...";
    const filasVentas = parsearMHT(await archivoVentas.text());
    if (fueCancelado()) return;

    estadoTexto.textContent = "Validando el rango de fechas del archivo de ventas...";
    const errorRangoVentas = validarRangoVentas(filasVentas);
    if (errorRangoVentas) {
      estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + errorRangoVentas;
      btnAnalizar.disabled = false;
      btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
      bloquearFormulario(false);
      estado.analizando = false;
      if (btnDetener) btnDetener.style.display = "none";
      return;
    }

    estadoTexto.textContent = "Leyendo stock de la tienda...";
    const filasStockTienda = parsearMHT(await archivoStockTienda.text());
    if (fueCancelado()) return;

    estadoTexto.textContent = "Leyendo stock de Kacosa...";
    const filasStockKacosa = parsearMHT(await archivoStockKacosa.text());
    if (fueCancelado()) return;

    estadoTexto.textContent = "Validando centros de los archivos...";
    const errorValidacion = validarCentros(filasVentas, filasStockTienda, filasStockKacosa, centrosValidos);
    if (errorValidacion) {
      estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + errorValidacion;
      btnAnalizar.disabled = false;
      btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
      bloquearFormulario(false);
      estado.analizando = false;
      if (btnDetener) btnDetener.style.display = "none";
      return;
    }

    estadoTexto.textContent = "Validando almacenes de los archivos de stock...";
    const errorAlmacenes = validarAlmacenes(filasStockTienda, filasStockKacosa, centrosValidos);
    if (errorAlmacenes) {
      estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + errorAlmacenes;
      btnAnalizar.disabled = false;
      btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
      bloquearFormulario(false);
      estado.analizando = false;
      if (btnDetener) btnDetener.style.display = "none";
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
    if (fueCancelado()) return;
    const ventasProcesadas = procesarVentas(filasVentas, mapaUMBPorMaterial);

    // Alimenta las tablas de Stock y Movimientos en Supabase con los datos crudos
    // de los archivos que se acaban de subir. No bloquea el análisis si falla.
    sincronizarStockYMovimientos(filasVentas, filasStockTienda, filasStockKacosa);

    // Archivo de notas pendientes por despacho (obligatorio — verificarArchivosValidos()
    // ya garantizó arriba que está presente y es válido antes de llegar acá).
    let notasPendientes = null;
    if (archivoNotasPendientes) {
      estadoTexto.textContent = "Validando archivo de notas pendientes por despacho...";
      const filasNotas = parsearMHT(await archivoNotasPendientes.text());
      if (fueCancelado()) return;
      
      // Validar que el archivo de notas contenga el centro correcto
      const errorNotas = validarCentroNotasPendientes(filasNotas, centrosValidos);
      if (errorNotas) {
        estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + errorNotas;
        btnAnalizar.disabled = false;
        btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
        bloquearFormulario(false);
        estado.analizando = false;
        if (btnDetener) btnDetener.style.display = "none";
        return;
      }
      
      estadoTexto.textContent = "Procesando notas pendientes por despacho...";
      notasPendientes = procesarNotasPendientes(filasNotas, centrosValidos);
      if (notasPendientes && Object.keys(notasPendientes).length > 0) {
        // Las notas hacia OTROS centros ya comprometieron ese stock: se resta
        // de stockKacosa ANTES de calcularAbastecimiento para que el cálculo
        // de todas las tiendas use el stock Kacosa real. Las notas hacia la
        // tienda que se está analizando (cantidadPropia) NO se tocan acá —
        // esas se restan del "a pedir" más adelante, en finalizarCalculo().
        const afectadosKacosa = restarNotasPendientesDeKacosa(stockKacosa, notasPendientes);
        estadoTexto.textContent = `Se encontraron ${Object.keys(notasPendientes).length} material(es) con notas pendientes por despacho` +
          (afectadosKacosa > 0 ? ` (${afectadosKacosa} descontado(s) del stock Kacosa por ir hacia otros centros).` : ".");
      } else {
        estadoTexto.textContent = "No se encontraron notas pendientes para esta tienda.";
      }
    }

    // Archivo opcional de pendientes por sincronizar
    const archivoPendientesSync = document.getElementById("na-pendientes-sync").files[0];
    let pendientesSync = null;
    if (archivoPendientesSync) {
      estadoTexto.textContent = "Validando archivo de materiales pendientes por sincronizar...";
      const filasPendientes = parsearMHT(await archivoPendientesSync.text());
      if (fueCancelado()) return;

      // Validar que el archivo solo traiga el centro/tienda que se está analizando
      const errorPendientesSync = validarCentroPendientesSync(filasPendientes, centrosValidos);
      if (errorPendientesSync) {
        estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + errorPendientesSync;
        btnAnalizar.disabled = false;
        btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
        bloquearFormulario(false);
        estado.analizando = false;
        if (btnDetener) btnDetener.style.display = "none";
        return;
      }

      estadoTexto.textContent = "Aplicando pendientes por sincronizar...";
      const mapaPendientes = procesarPendientesSync(filasPendientes, centrosValidos);
      pendientesSync = mapaPendientes;
      const afectados = restarPendientesSync(stockTienda, mapaPendientes);
      if (afectados > 0) {
        estadoTexto.textContent = `Se ajustó el stock de ${afectados} material(es) por pendientes de sincronización.`;
      }
    }

    estadoTexto.textContent = "Cargando lista de paquetes...";
    await cargarPaquetes();
    if (fueCancelado()) return;

    estadoTexto.textContent = "Cargando ubicaciones de materiales en Kacosa...";
    await cargarUbicaciones();
    if (fueCancelado()) return;

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
      pendientesSync: pendientesSync || null,
      clustersCandidatos: clusters, gruposCandidatos,
      tiendaSeleccionada: tienda, periodo, mesesCantidad, margenPct,
      fechaAnalisis: new Date().toLocaleDateString("es-VE"),
      analisisCompleto: null
    };

    // A partir de aquí ya no se puede cancelar: si hay duplicados, la revisión
    // tiene su propio botón "Cancelar" (junto a "Confirmar y calcular"); si no
    // los hay, se entra directo a finalizarCalculo(), que ya no ofrece forma
    // de detenerse porque desemboca en el guardado en la base de datos.
    if (btnDetener) btnDetener.style.display = "none";

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
    const btnDetenerErr = document.getElementById("btn-detener-analisis");
    if (btnDetenerErr) btnDetenerErr.style.display = "none";
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

/**
 * Valida que el archivo de materiales pendientes por sincronizar contenga
 * ÚNICAMENTE el centro/tienda que se está analizando. A diferencia de las
 * notas pendientes (que sí pueden traer varios centros mezclados y solo
 * importan las propias), este archivo debe corresponder por completo a una
 * sola tienda: si trae aunque sea un centro distinto, se rechaza el archivo
 * entero en vez de solo ignorar esas filas.
 */
function validarCentroPendientesSync(filas, centrosValidos) {
  if (filas.length === 0) {
    return "El archivo de materiales pendientes por sincronizar está vacío o no tiene datos.";
  }

  const centrosEnArchivo = new Set();
  filas.forEach(f => {
    const centro = String(f["Tienda"] || "").trim();
    if (centro) centrosEnArchivo.add(centro);
  });

  if (centrosEnArchivo.size === 0) {
    return "El archivo de materiales pendientes por sincronizar no tiene datos de 'Tienda' reconocibles.";
  }

  const centrosNoCoincidentes = [...centrosEnArchivo].filter(c => !centrosValidos.includes(c));
  if (centrosNoCoincidentes.length > 0) {
    return `El archivo de materiales pendientes por sincronizar contiene el/los centro(s) ${centrosNoCoincidentes.join(", ")}, que no corresponde(n) a la tienda seleccionada (${centrosValidos.join(" o ")}). Verifica que subiste el archivo correcto para esta tienda.`;
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
      <div class="btn-group" style="margin-top:16px">
        <button id="btn-confirmar-duplicados" class="btn-primario" style="max-width:260px">
          Confirmar y calcular
        </button>
        <button id="btn-cancelar-duplicados" class="btn-sutil-peligro" style="min-width:140px">
          <i class="fa-solid fa-circle-stop"></i> Cancelar
        </button>
      </div>
    </div>
  `;

  document.getElementById("btn-confirmar-duplicados").addEventListener("click", () => {
    const gruposConfirmados = [];
    document.querySelectorAll(".chk-grupo-dup:checked").forEach(chk => {
      gruposConfirmados.push(grupos[Number(chk.dataset.idx)]);
    });
    // A partir de este clic ya no se puede cancelar: arranca el cálculo final
    // y el guardado en la base de datos.
    finalizarCalculo(gruposConfirmados);
  });

  document.getElementById("btn-cancelar-duplicados").addEventListener("click", detenerAnalisisEnCurso);

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
        // Solo la parte de la nota dirigida a ESTA tienda (cantidadPropia) se
        // resta del "a pedir": esa mercancía ya viene en camino. La parte hacia
        // otros centros (cantidadOtros) ya se descontó del stock Kacosa arriba.
        const cantidadPendiente = nota.cantidadPropia || 0;
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
    resultado[0]?.periodoVentas || "", resultado[0]?.periodoAbastecimiento || "", resultado[0]?.rangoSeguridadUsado || ""
  );
  resultado = resultadoConAnexos;

  resultado.forEach(m => {
    m.tienda = nombrePorId(estado.tiendaSeleccionada);
    m.fechaAnalisis = estado.fechaAnalisis;
    // EN NOTAS KACOSA: total que se restó del stock Kacosa para este material
    // por estar en notas pendientes hacia OTROS centros (cantidadOtros).
    const notaInfo = estado.notasPendientes ? estado.notasPendientes[m.codigo] : null;
    m.enNotasKacosa = notaInfo ? (notaInfo.cantidadOtros || 0) : 0;
    // POR SINCRONIZAR: total que se restó del stock de esta tienda por
    // materiales pendientes por sincronizar.
    m.porSincronizar = estado.pendientesSync ? (estado.pendientesSync[m.codigo] || 0) : 0;
  });

  const sugerencias = generarSugerencias(resultado, estado.stockTienda, estado.stockKacosa, altaRotacion);
  const sinRotacion = generarSinRotacion(estado.stockKacosa, estado.stockTienda, estado.ventasProcesadas);

  estado.resultadoFinal = resultado;
  estado.sugerencias = sugerencias;
  estado.sinRotacion = sinRotacion;

  const mesesUsadosRedondeado = Math.round(estado.ventasProcesadas.rangoFechas?.meses || 0);
  const semanasUsadasRedondeado = Math.round(estado.ventasProcesadas.rangoFechas?.semanas || 0);

  estado.analisisCompleto = {
    resultado: resultado,
    sugerencias: sugerencias,
    sinRotacion: sinRotacion,
    tienda: estado.tiendaSeleccionada,
    fechaAnalisis: estado.fechaAnalisis,
    periodo: estado.periodo,
    margenPct: estado.margenPct,
    mesesUsados: mesesUsadosRedondeado,
    semanasUsadas: semanasUsadasRedondeado
  };

  window.KACOSA.ultimoAnalisis = {
    tienda: estado.tiendaSeleccionada,
    fechaAnalisis: estado.fechaAnalisis,
    periodo: estado.periodo,
    margenPct: estado.margenPct,
    mesesUsados: mesesUsadosRedondeado,
    semanasUsadas: semanasUsadasRedondeado,
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
    let opcionesExtra = { segundos: 5 };

    if (advertenciasFactor.length > 0) {
      const vistos = new Set();
      const unicos = advertenciasFactor.filter(a => {
        const clave = `${a.codigo}|${a.unidad}`;
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
      });
      // Se listan TODOS (no solo los primeros N): el aviso ya no se cierra solo
      // y el mensaje es scrolleable, así que no hace falta truncar ni recortar
      // con "y N más...".
      const listaHtml = unicos
        .map(a => `${a.codigo} (${a.descripcion || "sin descripción"}) — vendido en "${a.unidad}", UMB "${a.umb}"`)
        .join("<br>");
      mensajeNotif += `<br><br><strong><i class="fa-solid fa-triangle-exclamation"></i> Revisa factores_conversion / factores_conversion_umb:</strong> ${unicos.length} material(es) con unidad de venta distinta a su UMB, sin factor configurado para convertir:<br>${listaHtml}`;
      iconoNotif = '<i class="fa-solid fa-triangle-exclamation"></i>';
      // Este aviso no se cierra solo (el usuario necesita revisar la lista con
      // calma) y ofrece descargar el detalle completo en Excel.
      opcionesExtra = {
        autoCerrar: false,
        descargar: {
          texto: "Descargar Excel",
          onClick: () => descargarAdvertenciasFactorExcel(unicos, estado.fechaAnalisis)
        }
      };

      // Le avisa al administrador por correo (no bloquea el modal: si el envío
      // falla o tarda, el usuario igual ve el aviso en pantalla de inmediato).
      callBridge("enviarAdvertenciasFactor", {
        tienda: nombrePorId(estado.tiendaSeleccionada) || estado.tiendaSeleccionada,
        fechaAnalisis: estado.fechaAnalisis,
        materiales: unicos
      }).catch(err => console.error("No se pudo enviar el correo de advertencias de factor:", err));
    }

    notificarExito(mensajeNotif, { titulo: "Análisis completado", icono: iconoNotif, ...opcionesExtra });

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

/**
 * Descarga en un .xlsx la lista completa de materiales con unidad de venta
 * distinta a su UMB y sin factor de conversión configurado (el aviso que
 * muestra finalizarCalculo() al terminar el análisis). Columnas: Material,
 * Descripcion, Unidad_Venta, UMB.
 * @param {Array<{codigo, descripcion, unidad, umb}>} unicos
 * @param {string} fechaAnalisis - para nombrar el archivo, ej. "24/08/2026"
 */
function descargarAdvertenciasFactorExcel(unicos, fechaAnalisis) {
  const filas = unicos.map(a => ({
    material: a.codigo,
    descripcion: a.descripcion || "",
    unidad_venta: a.unidad,
    umb: a.umb
  }));
  const columnas = [
    { key: "material", label: "Material", ancho: 16 },
    { key: "descripcion", label: "Descripcion", ancho: 42 },
    { key: "unidad_venta", label: "Unidad_Venta", ancho: 14 },
    { key: "umb", label: "UMB", ancho: 10 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(filas, columnas), "Sin factor conversion");

  const base = (fechaAnalisis || "").replace(/\//g, "-") || "analisis";
  XLSX.writeFile(wb, `Materiales_sin_factor_conversion_${base}.xlsx`);
}

// ============================================================
//  MOSTRAR RESULTADOS
// ============================================================
/** Lista de "pedido" sin los materiales que el usuario excluyó manualmente en pantalla. */
function obtenerPedidoActivo() {
  const excluidos = estado.excluidos || new Set();
  return (estado.grupos?.pedido || []).filter(m => !excluidos.has(m.codigo));
}

function mostrarResultados(resultado, sugerencias) {
  const cont = document.getElementById("na-resultados");
  const grupos = clasificarEnCuatroGrupos(resultado, sugerencias);
  estado.grupos = grupos;
  estado.excluidos = new Set(); // análisis nuevo: nadie excluido todavía

  const totalAPedir = grupos.pedido.reduce((acc, m) => acc + (m.aPedir || 0), 0);
  const porClase = { A: 0, B: 0, C: 0, D: 0 };
  resultado.forEach(m => {
    const clase = (m.clase || '').toUpperCase();
    if (porClase[clase] !== undefined) porClase[clase]++;
  });

  const infoPeriodo = window.KACOSA.ultimoAnalisis;
  const textoPeriodo = infoPeriodo
    ? `Período usado: ${infoPeriodo.mesesUsados ?? '?'} meses (${infoPeriodo.semanasUsadas ?? '?'} semanas)`
    : '';

  cont.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0; font-size:15px; color:var(--azul-base)">Resultado</h3>
      <p class="vista-sub" style="margin-top:-4px">${textoPeriodo}</p>
      <div class="kpi-grid">
        <div class="kpi-card verde">
          <div class="kpi-icono"><i class="fa-solid fa-box-open"></i></div>
          <div class="label">Materiales a pedir</div>
          <div class="valor" id="kpi-materiales-a-pedir">${grupos.pedido.length}</div>
        </div>
        <div class="kpi-card ambar">
          <div class="kpi-icono"><i class="fa-solid fa-cart-shopping"></i></div>
          <div class="label">Total unidades a pedir</div>
          <div class="valor" id="kpi-total-unidades">${totalAPedir}</div>
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
      <p class="vista-sub" id="na-excluidos-aviso" style="display:none; margin-top:-8px; margin-bottom:10px; color:var(--ambar-oscuro)">
        <i class="fa-solid fa-circle-info"></i> <span id="na-excluidos-texto"></span>
      </p>
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

  const centroAnalizado = centrosDeTienda(estado.tiendaSeleccionada).join("/");

  const columnas = [
    { key: 'codigo', label: 'Código' },
    { key: 'descripcion', label: 'Descripción' },
    { key: 'umb', label: 'UMB' },
    { key: 'clase', label: 'Clase' },
    { key: 'totalVentas', label: 'Total ventas', numeric: true },
    { key: 'promedioVentasPeriodo', label: 'Promedio ventas periodo', numeric: true },
    { key: 'stockTienda', label: 'Stock tienda', numeric: true },
    { key: 'porSincronizar', label: 'Por sincronizar', numeric: true },
    { key: 'stockKacosa1000', label: 'Stock Kacosa 1000', numeric: true },
    { key: 'stockKacosa3000', label: 'Stock Kacosa 3000', numeric: true },
    { key: 'stockKacosa', label: 'Total Stock Kacosa', numeric: true },
    { key: 'ubicacionKacosa', label: 'Ubicación Kacosa' },
    { key: 'aPedir', label: 'A pedir', numeric: true },
    { key: 'porDespacho', label: `Por despacho a ${centroAnalizado}`, numeric: true },
    { key: 'enNotasKacosa', label: 'En notas Kacosa', numeric: true },
    { key: 'numeroDeNota', label: 'Número de nota' },
    { key: 'fechaDeNota', label: 'Fecha de nota' },
    {
      key: 'accionExcluir',
      label: '',
      render: (item) => {
        const excluido = estado.excluidos.has(item.codigo);
        return excluido
          ? `<button type="button" class="btn-fila-restaurar" data-fila-accion="restaurar" title="Volver a incluir este material en el pedido"><i class="fa-solid fa-rotate-left"></i> Deshacer</button>`
          : `<button type="button" class="btn-fila-excluir" data-fila-accion="excluir" title="Quitar del pedido (no se incluirá en el correo ni en el Excel)"><i class="fa-solid fa-ban"></i></button>`;
      }
    }
  ];

  const container = document.getElementById('na-tabla-container');
  const tabla = crearTablaPaginada(container, columnas, 50, {
    claveFila: (item) => item.codigo,
    filaClaseFn: (item) => estado.excluidos.has(item.codigo) ? 'fila-excluida' : '',
    onAccionFila: (clave, item, accion) => {
      if (accion === 'excluir') estado.excluidos.add(item.codigo);
      else if (accion === 'restaurar') estado.excluidos.delete(item.codigo);
      actualizarKpisPedido();
      // refrescar() reconstruye el <tbody> por dentro; sin esto, el navegador
      // a veces recalcula el scroll de la página y "salta" a otra posición
      // aunque la tabla no cambió de tamaño. Se guarda la posición justo
      // antes y se restaura justo después, en el mismo tick.
      const scrollY = window.scrollY;
      tabla.refrescar();
      window.scrollTo(window.scrollX, scrollY);
    }
  });
  const { renderizar } = tabla;
  renderizar(grupos.pedido);

  function actualizarKpisPedido() {
    const activos = obtenerPedidoActivo();
    const totalActivo = activos.reduce((acc, m) => acc + (m.aPedir || 0), 0);
    const kpiMateriales = document.getElementById('kpi-materiales-a-pedir');
    const kpiTotal = document.getElementById('kpi-total-unidades');
    if (kpiMateriales) kpiMateriales.textContent = activos.length;
    if (kpiTotal) kpiTotal.textContent = totalActivo;

    const cantidadExcluidos = estado.excluidos.size;
    const aviso = document.getElementById('na-excluidos-aviso');
    const avisoTexto = document.getElementById('na-excluidos-texto');
    if (aviso && avisoTexto) {
      if (cantidadExcluidos > 0) {
        avisoTexto.textContent = `${cantidadExcluidos} material(es) excluido(s) manualmente: no se incluirán en el correo ni en el Excel a descargar.`;
        aviso.style.display = 'flex';
      } else {
        aviso.style.display = 'none';
      }
    }
  }

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

function anexarAltaRotacionFaltante(resultado, stockTienda, stockKacosa, altaRotacion, periodoVentas, periodoAbastecimiento, rangoSeguridadUsado) {
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
      porSincronizar: estado.pendientesSync ? (estado.pendientesSync[m.codigo] || 0) : 0,
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

    // Para el correo, "Total de materiales a pedir" debe ser la CANTIDAD de
    // códigos distintos que dieron a pedir (SKUs), no la suma de piezas/unidades
    // de todos ellos — por eso aquí se usa .length y no un reduce sumando aPedir.
    const totalMaterialesAPedir = obtenerPedidoActivo().length;

    estadoAcciones.textContent = "Enviando correo...";
    const resp = await callBridge("sendReport", {
      tipoReporte: "analisis",
      tienda: estado.tiendaSeleccionada,
      fechaAnalisis: estado.fechaAnalisis,
      resumen: {
        totalAPedir: totalMaterialesAPedir,
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

function construirWorkbookCompleto() {
  const pedido = obtenerPedidoActivo();
  const { noPedido, pendienteStock, sugerencias } = estado.grupos;
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
      `Horizonte de abastecimiento: ${pedido[0]?.periodoAbastecimiento || "—"}`,
      `Rango de seguridad usado: ${pedido[0]?.rangoSeguridadUsado || "—"}`,
      `Analista: ${window.KACOSA?.usuario?.nombre || window.KACOSA?.usuario?.email || "—"}`,
      "Generado automáticamente por el sistema de Abastecimiento KACOSA."
    ]
  );
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  const centroAnalizado = centrosDeTienda(estado.tiendaSeleccionada).join("_");
  const labelPorDespacho = `Por_Despacho_A_${centroAnalizado}`;

  const columnasCompletas = [
    { key: 'codigo', label: 'Codigo', ancho: 14 },
    { key: 'descripcion', label: 'Descripcion', ancho: 38 },
    { key: 'unidadVenta', label: 'UMV', ancho: 10 },
    { key: 'materialesFusionados', label: 'Materiales_Fusionados', ancho: 22 },
    { key: 'clase', label: 'Clase', ancho: 8 },
    { key: 'totalVentas', label: 'Total_Ventas', ancho: 12 },
    { key: 'promedioVentasPeriodo', label: 'Promedio_Ventas_Periodo', ancho: 16 },
    { key: 'stockTienda', label: 'Stock_Tienda', ancho: 12 },
    { key: 'porSincronizar', label: 'Por_Sincronizar', ancho: 14 },
    { key: 'stockKacosa1000', label: 'Stock_Kacosa_1000', ancho: 14 },
    { key: 'stockKacosa3000', label: 'Stock_Kacosa_3000', ancho: 14 },
    { key: 'stockKacosa', label: 'Total_Stock_Kacosa', ancho: 14 },
    { key: 'ubicacionKacosa', label: 'Ubicacion_Kacosa', ancho: 16 },
    { key: 'umb', label: 'UMB', ancho: 10 },
    { key: 'aPedir', label: 'A_Pedir', ancho: 10 },
    { key: 'porDespacho', label: labelPorDespacho, ancho: 16 },
    { key: 'enNotasKacosa', label: 'En_Notas_Kacosa', ancho: 14 },
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
      { key: 'porSincronizar', label: 'Por_Sincronizar', ancho: 14 },
      { key: 'umb', label: 'UMB', ancho: 10 },
      { key: 'aPedirIdeal', label: 'A_Pedir_Ideal', ancho: 12 },
      { key: 'aPedir', label: 'A_Pedir_Real', ancho: 12 }, { key: 'pendiente', label: 'Pendiente', ancho: 12 },
      { key: 'stockKacosa1000', label: 'Stock_Kacosa_1000', ancho: 14 },
      { key: 'stockKacosa3000', label: 'Stock_Kacosa_3000', ancho: 14 },
      { key: 'stockKacosa', label: 'Total_Stock_Kacosa', ancho: 14 },
      { key: 'ubicacionKacosa', label: 'Ubicacion_Kacosa', ancho: 16 },
      { key: 'porDespacho', label: labelPorDespacho, ancho: 16 },
      { key: 'enNotasKacosa', label: 'En_Notas_Kacosa', ancho: 14 },
      { key: 'numeroDeNota', label: 'Numero_De_Nota', ancho: 14 },
      { key: 'fechaDeNota', label: 'Fecha_De_Nota', ancho: 14 },
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
    { key: 'stockTienda', label: 'Stock_Tienda', ancho: 12 }, { key: 'porSincronizar', label: 'Por_Sincronizar', ancho: 14 },
    { key: 'stockKacosa', label: 'Stock_Kacosa', ancho: 12 }
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
