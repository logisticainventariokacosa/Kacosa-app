// js/nuevo-analisis.js
import { parsearMHT, aNumero } from "./mht-parser.js";
import { procesarVentas } from "./ventas-parser.js";
import { cargarFactoresConversion } from "./factores-conversion.js";
import { agruparStock, procesarNotasPendientes } from "./stock-parser.js";
import { cargarPaquetes } from "./paquetes.js";
import { calcularAbastecimiento } from "./calculo-abastecimiento.js";
import { detectarCandidatosLocal, confirmarConGemini, fusionarDuplicados } from "./deteccion-duplicados.js";
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

// ============================================================
//  ESTADO PERSISTENTE
// ============================================================
let estado = {
  ventasProcesadas: null,
  stockTienda: null,
  stockKacosa: null,
  notasPendientes: null,
  clustersCandidatos: [],
  gruposGemini: [],
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
  analizando: false
};

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
        <label class="form-label">Margen de seguridad: <span id="na-margen-valor" style="color:var(--ambar-oscuro); font-weight:700">30%</span></label>
        <input type="range" id="na-margen" class="input-modern" min="10" max="100" step="5" value="30">
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

          if (validEl && tipo) {
            try {
              const texto = await input.files[0].text();
              const filas = parsearMHT(texto);
              let columnasRequeridas;
              if (tipo === 'ventas') columnasRequeridas = COLUMNAS_VENTAS;
              else if (tipo === 'stock') columnasRequeridas = COLUMNAS_STOCK;
              else if (tipo === 'notas') columnasRequeridas = COLUMNAS_NOTAS_PENDIENTES;
              else columnasRequeridas = [];
              
              const resultado = validarColumnasArchivo(filas, columnasRequeridas, tipo);
              validEl.innerHTML = resultado.mensaje;
              validEl.style.color = resultado.valido ? 'var(--verde-kpi)' : 'var(--rojo-alerta)';
              input.dataset.valido = resultado.valido ? 'true' : 'false';
            } catch (err) {
              validEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error al leer el archivo: ' + err.message;
              validEl.style.color = 'var(--rojo-alerta)';
              input.dataset.valido = 'false';
            }
          }
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
  document.getElementById("btn-analizar").addEventListener("click", ejecutarAnalisis);
  document.getElementById("btn-limpiar-analisis").addEventListener("click", limpiarAnalisis);
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

  const nombreTipo = tipo === 'ventas' ? 'ventas' : tipo === 'stock' ? 'stock' : 'notas pendientes';
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
  if (margenEl) margenEl.value = 30;
  const margenValorEl = document.getElementById("na-margen-valor");
  if (margenValorEl) margenValorEl.textContent = "30%";

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
  estado.gruposGemini = [];
  estado.resultadoFinal = null;
  estado.fechaAnalisis = null;
  estado.grupos = null;
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
    btnAnalizar.disabled = false;
    btnAnalizar.innerHTML = '<i class="fa-solid fa-bolt"></i> Analizar';
  }
  const btnLimpiar = document.getElementById("btn-limpiar-analisis");
  if (btnLimpiar) btnLimpiar.style.display = "none";
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

    await cargarFactoresConversion(); // trae desde Supabase el contenido de empaque/caja por material
    const ventasProcesadas = procesarVentas(filasVentas);
    const stockTienda = agruparStock(filasStockTienda, centrosValidos);
    const stockKacosa = agruparStock(filasStockKacosa, CENTROS_KACOSA);

    // Alimenta las tablas de Stock y Movimientos en Supabase con los datos crudos
    // de los archivos que se acaban de subir. No bloquea el análisis si falla.
    sincronizarStockYMovimientos(filasVentas, filasStockTienda, filasStockKacosa);

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

    estadoTexto.textContent = "Buscando posibles códigos duplicados...";
    const materialesParaComparar = Object.values(ventasProcesadas.porMaterial)
      .map(m => ({ codigo: m.codigo, descripcion: m.descripcion }));
    const clusters = detectarCandidatosLocal(materialesParaComparar);

    let gruposGemini = [];
    if (clusters.length > 0) {
      estadoTexto.textContent = `Confirmando ${clusters.length} grupo(s) candidato(s) con el agente...`;
      const respGemini = await confirmarConGemini(clusters);
      if (respGemini.ok) gruposGemini = respGemini.grupos;
    }

    estado = {
      ...estado,
      ventasProcesadas, stockTienda, stockKacosa,
      notasPendientes: notasPendientes || null,
      clustersCandidatos: clusters, gruposGemini,
      tiendaSeleccionada: tienda, periodo, mesesCantidad, margenPct,
      fechaAnalisis: new Date().toLocaleDateString("es-VE"),
      analisisCompleto: null
    };

    if (gruposGemini.length > 0) {
      estadoTexto.textContent = `Se detectaron ${gruposGemini.length} posible(s) duplicado(s). Revísalos abajo.`;
      mostrarDuplicados(gruposGemini);
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
    resultado[0]?.periodoVentas || "", resultado[0]?.periodoAbastecimiento || "", resultado[0]?.rangoSeguridadUsado || ""
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
      materiales: estado.resultadoFinal
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

    const estadoAcciones = document.getElementById("na-estado-acciones");
    if (estadoAcciones) {
      estadoAcciones.innerHTML = `<i class="fa-solid fa-circle-check"></i> Guardado correctamente. ${respGuardado.altaRotacionAgregados > 0 ? `(${respGuardado.altaRotacionAgregados} nuevo(s) en Alta Rotación)` : ""}`;
    }

    const totalAPedirNotif = estado.grupos?.pedido?.reduce((acc, m) => acc + (m.aPedir || 0), 0) || 0;
    notificarExito(
      `Se procesaron ${resultado.length} material(es) — ${totalAPedirNotif} unidades a pedir. El análisis quedó guardado correctamente.`,
      { titulo: "Análisis completado" }
    );

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
    { key: 'clase', label: 'Clase' },
    { key: 'totalVentas', label: 'Total ventas', numeric: true },
    { key: 'promedioVentasPeriodo', label: 'Promedio ventas periodo', numeric: true },
    { key: 'stockTienda', label: 'Stock tienda', numeric: true },
    { key: 'stockKacosa', label: 'Stock Kacosa', numeric: true },
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
      clase: m.clase,
      totalVentas: 0,
      promedioVentasPeriodo: 0,
      stockTienda: stockTiendaDisp,
      stockKacosa: stockKacosaDisp,
      aPedir,
      aPedirIdeal: aPedir,
      pendiente: 0,
      empaque,
      periodoVentas,
      periodoAbastecimiento,
      rangoSeguridadUsado,
      porDespacho: 0,
      numeroDeNota: '',
      fechaDeNota: ''
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
      `Horizonte de abastecimiento: ${pedido[0]?.periodoAbastecimiento || "—"}`,
      `Rango de seguridad usado: ${pedido[0]?.rangoSeguridadUsado || "—"}`,
      "Generado automáticamente por el sistema de Abastecimiento KACOSA."
    ]
  );
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  const columnasCompletas = [
    { key: 'codigo', label: 'Codigo', ancho: 14 },
    { key: 'descripcion', label: 'Descripcion', ancho: 38 },
    { key: 'clase', label: 'Clase', ancho: 8 },
    { key: 'totalVentas', label: 'Total_Ventas', ancho: 12 },
    { key: 'promedioVentasPeriodo', label: 'Promedio_Ventas_Periodo', ancho: 16 },
    { key: 'stockTienda', label: 'Stock_Tienda', ancho: 12 },
    { key: 'stockKacosa', label: 'Stock_Kacosa', ancho: 12 },
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
      { key: 'clase', label: 'Clase', ancho: 8 }, { key: 'aPedirIdeal', label: 'A_Pedir_Ideal', ancho: 12 },
      { key: 'aPedir', label: 'A_Pedir_Real', ancho: 12 }, { key: 'pendiente', label: 'Pendiente', ancho: 12 },
      { key: 'stockKacosa', label: 'Stock_Kacosa', ancho: 12 },
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
