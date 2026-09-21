// js/traslados.js
// Submódulo "Solicitud de Traslado" (17-sep-2026, ajustes 18 y 19-sep-2026).
// Acceso real controlado por ROLES_ACCESO_SOLICITUD_TRASLADO en auth.js —
// mientras se prueba, solo "admin" (nav.js ya oculta el botón del menú para
// cualquier otro rol; aquí se repite la verificación por si alguien entra
// directo por URL/hash, mismo patrón que resumen-directiva.js).
//
// Flujo "Con código SAP" (por defecto): cuaderno de línea de códigos +
// cantidad → al presionar "Solicitar" se consulta stock de AMBOS centros (el
// solicitante/emisor y el solicitado/receptor) + en_notas_kacosa → tabla de
// confirmación editable (bloqueada si alguna cantidad supera lo disponible
// en el centro de origen) → enviar.
// Flujo "Sin código SAP" (19-sep-2026): líneas de Descripción libre (20-100
// caracteres) + cantidad, SIN consulta de stock — se confirma con un diálogo
// simple y se envía directo.
// Mientras hay una consulta o una confirmación pendiente, el botón
// "Solicitar" queda bloqueado hasta que se cancele o se envíe esa solicitud.
import { supabaseSelect, supabaseSelectTodo, supabaseInsert, supabaseUpdate } from "./supabase-client.js?v=1";
import { obtenerStockDesdeSupabase } from "./stock-parser.js?v=1";
import { TIENDAS, nombrePorId, almacenesPermitidosParaCentros, CENTROS_KACOSA } from "./tiendas.js?v=1";
import { crearTablaPaginada } from "./tabla-utils.js";
import { notificarExito, confirmarAccion } from "./notificaciones.js";
import { callBridge } from "./bridge.js";
import { ROLES_ACCESO_SOLICITUD_TRASLADO } from "./auth.js";
import { descargarNotaDeTraslado } from "./pdf-nota-traslado.js?v=2";

const MOTIVOS = ["Venta puntual", "Complemento de stock", "Otro"];
const DURACION_CLAVE_MS = 5 * 60 * 1000; // 5 minutos, igual que en notificaciones-abastecimiento.js
const INTERVALO_SYNC_MS = 15000; // 15s — "Mis solicitudes" se refresca sola mientras la vista está activa
const CANTIDAD_REGEX = /^\d{1,5}(\.\d{1,3})?$/; // hasta 5 dígitos enteros, hasta 3 decimales
const CODIGO_REGEX = /^\d{3,10}$/; // solo números, 3 a 10 dígitos
const DESCRIPCION_MIN = 20, DESCRIPCION_MAX = 100;

let lineas = [ nuevaLinea() ]; // [{codigo, cantidad, descripcion}]
let tipoActual = "nota_traslado"; // 'nota_traslado' | 'extra_sap'
let modoMaterial = "con_codigo"; // 'con_codigo' | 'sin_codigo'
let tiendaEmisoraSeleccionada = null; // solo aplica si el usuario ve "TODAS"
let confirmacion = null; // {materiales:[...], ...datosFormulario} mientras se revisa antes de enviar
let tablaMisSolicitudes = null;
let vistaConstruida = false;
let intervaloSync = null;

function nuevaLinea() {
  return { codigo: "", cantidad: "", descripcion: "" };
}

function rolActual() {
  return window.KACOSA?.usuario?.rolNormalizado
    || (window.KACOSA?.usuario?.rol || "").toString().trim().toLowerCase();
}

function usuarioTieneAcceso() {
  return ROLES_ACCESO_SOLICITUD_TRASLADO.includes(rolActual());
}

function vistaEstaActiva() {
  return !!document.querySelector("#vista-traslados.activa");
}

/** Tienda(s) que el usuario puede usar como "tienda solicitante" (su propia tienda, la emisora). */
function tiendasDisponiblesParaSolicitar() {
  const veTodas = window.KACOSA?.usuario?.veTodasLasTiendas || (window.KACOSA?.tiendas || []).includes("TODAS");
  if (veTodas) return TIENDAS.map(t => t.id);
  return (window.KACOSA?.tiendas || []).filter(Boolean);
}

function tiendaEmisoraActual() {
  const disponibles = tiendasDisponiblesParaSolicitar();
  if (disponibles.length === 1) return disponibles[0];
  return tiendaEmisoraSeleccionada || disponibles[0] || null;
}

/** "Tienda de procedencia" en Extra SAP (es quien envía), "Tienda solicitante" en Nota de traslado (es quien pide). */
function etiquetaTiendaEmisora() {
  return tipoActual === "extra_sap" ? "Tienda de procedencia" : "Tienda solicitante";
}

function render() {
  const cont = document.getElementById("traslados-contenido");
  if (!cont) return;

  if (!window.KACOSA?.usuario) {
    cont.innerHTML = `<p class="vista-sub">Cargando información del usuario...</p>`;
    return;
  }

  if (!usuarioTieneAcceso()) {
    cont.innerHTML = `
      <div class="card">
        <p class="vista-sub" style="margin:0"><i class="fa-solid fa-lock"></i> Tu rol no tiene acceso a este submódulo.</p>
      </div>`;
    return;
  }

  if (vistaConstruida) {
    cargarMisSolicitudes();
    iniciarSyncAutomatico();
    return;
  }
  vistaConstruida = true;
  // El HTML de #traslados-contenido se va a reconstruir por completo (pasa
  // tras el primer render Y otra vez después de cada envío exitoso), lo que
  // destruye el <div id="st-tabla-mis-solicitudes"> anterior. Si no se
  // limpia esta referencia, cargarMisSolicitudes() sigue actualizando la
  // tabla VIEJA (ya fuera del DOM) en vez de la nueva — por eso "Mis
  // solicitudes" no se refrescaba al volver a la vista tras enviar.
  tablaMisSolicitudes = null;

  const disponibles = tiendasDisponiblesParaSolicitar();
  const necesitaSelectorTienda = disponibles.length > 1;

  cont.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0; font-size:15px; color:var(--azul-base); display:flex; align-items:center; gap:10px">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; background:var(--ambar-claro); border-radius:8px; font-size:14px"><i class="fa-solid fa-dolly"></i></span>
        Nueva solicitud de traslado
      </h3>

      ${necesitaSelectorTienda ? `
        <div style="margin-top:14px">
          <label class="form-label" id="st-label-tienda-emisora">${etiquetaTiendaEmisora()} <span class="required">*</span></label>
          <select id="st-tienda-emisora" class="input-modern select-modern">
            ${disponibles.map(id => `<option value="${id}">${nombrePorId(id)}</option>`).join("")}
          </select>
        </div>
      ` : `
        <p class="vista-sub" style="margin-top:6px" id="st-label-tienda-emisora">${etiquetaTiendaEmisora()}: <strong>${nombrePorId(disponibles[0] || "")}</strong></p>
      `}

      <div style="margin-top:16px">
        <label class="form-label">Tipo de solicitud <span class="required">*</span></label>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button type="button" class="btn-tipo-solicitud ${tipoActual === "nota_traslado" ? "activo" : ""}" data-tipo="nota_traslado">Nota de traslado</button>
          <button type="button" class="btn-tipo-solicitud ${tipoActual === "extra_sap" ? "activo" : ""}" data-tipo="extra_sap">Extra SAP</button>
        </div>
      </div>

      <div style="margin-top:16px">
        <label class="form-label" id="st-label-centro">
          ${tipoActual === "extra_sap" ? "Centro de destino" : "Centro del que se solicita"} <span class="required">*</span>
        </label>
        <select id="st-centro" class="input-modern select-modern"></select>
        <p class="form-hint" id="st-hint-centro" style="margin-top:4px"></p>
      </div>

      <div class="form-row" style="margin-top:16px">
        <div>
          <label class="form-label">Motivo <span class="required">*</span></label>
          <select id="st-motivo" class="input-modern select-modern">
            ${MOTIVOS.map(m => `<option value="${m}">${m}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="form-label">Prioridad <span class="required">*</span></label>
          <select id="st-prioridad" class="input-modern select-modern">
            <option value="Urgente">Urgente</option>
            <option value="Regular" selected>Regular</option>
          </select>
        </div>
      </div>
      <div id="st-motivo-otro-wrap" style="margin-top:12px; display:none">
        <label class="form-label">Especifica el motivo</label>
        <input type="text" id="st-motivo-otro" class="input-modern" maxlength="200" placeholder="Motivo...">
      </div>

      <div style="margin-top:20px">
        <label class="form-label">Materiales <span class="required">*</span></label>
        <div id="st-modo-material-wrap" style="display:${tipoActual === "extra_sap" ? "flex" : "none"}; gap:10px; flex-wrap:wrap; margin-bottom:10px">
          <button type="button" class="btn-tipo-solicitud ${modoMaterial === "con_codigo" ? "activo" : ""}" data-modo="con_codigo">Con código SAP</button>
          <button type="button" class="btn-tipo-solicitud ${modoMaterial === "sin_codigo" ? "activo" : ""}" data-modo="sin_codigo">Sin código SAP</button>
        </div>
        <div id="st-lineas"></div>
        <button type="button" id="st-agregar-linea" class="btn-secundario" style="margin-top:8px"><i class="fa-solid fa-plus"></i> Agregar ${modoMaterial === "con_codigo" ? "código" : "material"}</button>
      </div>

      <div id="st-error" style="color:var(--rojo-alerta); font-size:13px; margin-top:12px; display:none"></div>

      <button type="button" id="st-buscar" class="btn-primario" style="margin-top:18px; width:100%">
        <i class="fa-solid fa-magnifying-glass"></i> Solicitar
      </button>
    </div>

    <div id="st-confirmacion-wrap"></div>

    <div class="card" style="margin-top:24px">
      <h3 style="margin-top:0; font-size:15px; color:var(--azul-base)"><i class="fa-solid fa-list"></i> Mis solicitudes</h3>
      <div id="st-tabla-mis-solicitudes"></div>
    </div>
  `;

  pintarLineas();
  actualizarCentroDestino();

  const selTienda = document.getElementById("st-tienda-emisora");
  if (selTienda) {
    selTienda.value = tiendaEmisoraActual() || "";
    selTienda.addEventListener("change", () => {
      tiendaEmisoraSeleccionada = selTienda.value;
      actualizarCentroDestino();
    });
  }

  cont.querySelectorAll(".btn-tipo-solicitud[data-tipo]").forEach(btn => {
    btn.addEventListener("click", () => {
      tipoActual = btn.dataset.tipo;
      cont.querySelectorAll(".btn-tipo-solicitud[data-tipo]").forEach(b => b.classList.toggle("activo", b === btn));
      document.getElementById("st-label-centro").innerHTML =
        `${tipoActual === "extra_sap" ? "Centro de destino" : "Centro del que se solicita"} <span class="required">*</span>`;
      actualizarCentroDestino();

      const labelTienda = document.getElementById("st-label-tienda-emisora");
      if (labelTienda) {
        labelTienda.innerHTML = necesitaSelectorTienda
          ? `${etiquetaTiendaEmisora()} <span class="required">*</span>`
          : `${etiquetaTiendaEmisora()}: <strong>${nombrePorId(disponibles[0] || "")}</strong>`;
      }

      // El toggle "Con/Sin código SAP" solo tiene sentido para Extra SAP —
      // en Nota de traslado siempre se pide con código SAP.
      const wrapModo = document.getElementById("st-modo-material-wrap");
      if (tipoActual === "extra_sap") {
        wrapModo.style.display = "flex";
      } else {
        wrapModo.style.display = "none";
        if (modoMaterial !== "con_codigo") {
          modoMaterial = "con_codigo";
          lineas = [nuevaLinea()];
          cont.querySelectorAll(".btn-tipo-solicitud[data-modo]").forEach(b => b.classList.toggle("activo", b.dataset.modo === "con_codigo"));
          document.getElementById("st-agregar-linea").innerHTML = '<i class="fa-solid fa-plus"></i> Agregar código';
          pintarLineas();
        }
      }
    });
  });

  cont.querySelectorAll(".btn-tipo-solicitud[data-modo]").forEach(btn => {
    btn.addEventListener("click", () => {
      modoMaterial = btn.dataset.modo;
      cont.querySelectorAll(".btn-tipo-solicitud[data-modo]").forEach(b => b.classList.toggle("activo", b === btn));
      lineas = [nuevaLinea()];
      document.getElementById("st-agregar-linea").innerHTML =
        `<i class="fa-solid fa-plus"></i> Agregar ${modoMaterial === "con_codigo" ? "código" : "material"}`;
      pintarLineas();
    });
  });

  document.getElementById("st-motivo").addEventListener("change", (e) => {
    document.getElementById("st-motivo-otro-wrap").style.display = e.target.value === "Otro" ? "block" : "none";
  });

  document.getElementById("st-agregar-linea").addEventListener("click", () => {
    lineas.push(nuevaLinea());
    pintarLineas();
  });

  document.getElementById("st-buscar").addEventListener("click", () => {
    if (modoMaterial === "sin_codigo") manejarSolicitudSinCodigo();
    else buscarDisponibilidad();
  });

  cargarMisSolicitudes();
  iniciarSyncAutomatico();
}

/** Llena el <select> de centro según el tipo de solicitud y la tienda solicitante elegida. */
function actualizarCentroDestino() {
  const sel = document.getElementById("st-centro");
  const hint = document.getElementById("st-hint-centro");
  if (!sel) return;
  const emisora = tiendaEmisoraActual();

  const opciones = TIENDAS.filter(t => t.id !== emisora).map(t => ({ id: t.id, nombre: t.nombre }));
  sel.innerHTML = opciones.map(o => `<option value="${o.id}">${o.nombre}</option>`).join("");

  if (hint) {
    hint.textContent = tipoActual === "extra_sap"
      ? "La mercancía sale de tu tienda hacia el centro que elijas aquí."
      : "Se mostrará la disponibilidad de tu tienda y de este centro.";
  }
}

function pintarLineas() {
  const cont = document.getElementById("st-lineas");
  if (!cont) return;

  if (modoMaterial === "con_codigo") {
    cont.innerHTML = lineas.map((l, idx) => `
      <div class="st-linea" data-idx="${idx}" style="display:flex; gap:8px; margin-bottom:8px; align-items:center">
        <input type="text" inputmode="numeric" class="input-modern st-linea-codigo" placeholder="Código (solo números, 3-10 dígitos)" maxlength="10" value="${(l.codigo || "").replace(/"/g, "&quot;")}" style="flex:2">
        <input type="text" inputmode="decimal" class="input-modern st-linea-cantidad" placeholder="Cantidad" value="${l.cantidad}" style="flex:1">
        ${lineas.length > 1 ? `<button type="button" class="btn-sutil-peligro st-linea-quitar" title="Quitar"><i class="fa-solid fa-trash"></i></button>` : ""}
      </div>
    `).join("");

    cont.querySelectorAll(".st-linea-codigo").forEach(inp => {
      inp.addEventListener("input", (e) => {
        e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
        const idx = Number(e.target.closest(".st-linea").dataset.idx);
        lineas[idx].codigo = e.target.value;
      });
    });
  } else {
    cont.innerHTML = lineas.map((l, idx) => `
      <div class="st-linea" data-idx="${idx}" style="display:flex; gap:8px; margin-bottom:8px; align-items:flex-start">
        <div style="flex:2">
          <input type="text" class="input-modern st-linea-descripcion" placeholder="Descripción del material (20 a 100 caracteres)" maxlength="${DESCRIPCION_MAX}" value="${(l.descripcion || "").replace(/"/g, "&quot;")}">
          <div class="st-linea-contador" style="font-size:11px; color:var(--texto-claro); margin-top:2px">${(l.descripcion || "").length}/${DESCRIPCION_MAX} (mínimo ${DESCRIPCION_MIN})</div>
        </div>
        <input type="text" inputmode="decimal" class="input-modern st-linea-cantidad" placeholder="Cantidad" value="${l.cantidad}" style="flex:1">
        ${lineas.length > 1 ? `<button type="button" class="btn-sutil-peligro st-linea-quitar" title="Quitar"><i class="fa-solid fa-trash"></i></button>` : ""}
      </div>
    `).join("");

    cont.querySelectorAll(".st-linea-descripcion").forEach(inp => {
      inp.addEventListener("input", (e) => {
        const idx = Number(e.target.closest(".st-linea").dataset.idx);
        lineas[idx].descripcion = e.target.value;
        e.target.closest(".st-linea").querySelector(".st-linea-contador").textContent =
          `${e.target.value.length}/${DESCRIPCION_MAX} (mínimo ${DESCRIPCION_MIN})`;
      });
    });
  }

  cont.querySelectorAll(".st-linea-cantidad").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.closest(".st-linea").dataset.idx);
      lineas[idx].cantidad = e.target.value;
    });
  });
  cont.querySelectorAll(".st-linea-quitar").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.closest(".st-linea").dataset.idx);
      lineas.splice(idx, 1);
      pintarLineas();
    });
  });
}

function mostrarErrorFormulario(msg) {
  const el = document.getElementById("st-error");
  if (!el) return;
  if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
  el.style.display = "block";
  el.textContent = msg;
}

/**
 * Habilita/deshabilita TODOS los campos del formulario principal (tienda,
 * tipo, centro, motivo, prioridad, líneas de materiales, botón Solicitar).
 * Se usa mientras se consulta disponibilidad Y mientras hay una confirmación
 * pendiente sin cancelar/enviar — para que no se pueda editar nada ni
 * empezar una segunda consulta encima de la que está en curso.
 */
function bloquearFormularioPrincipal(bloquear) {
  const cont = document.getElementById("traslados-contenido");
  if (!cont) return;
  const primeraTarjeta = cont.querySelector(".card");
  if (!primeraTarjeta) return;
  primeraTarjeta.querySelectorAll("input, select, button").forEach(el => { el.disabled = bloquear; });
}

/** Igual que arriba pero para la tabla de confirmación (cantidades, quitar, cancelar, enviar). */
function bloquearConfirmacion(bloquear) {
  const wrap = document.getElementById("st-confirmacion-wrap");
  if (!wrap) return;
  wrap.querySelectorAll("input, button").forEach(el => { el.disabled = bloquear; });
}

/** Devuelve los centros/almacenes SAP a consultar en `stock` según el centro elegido (Kacosa/Ferretools/tienda). */
function centrosYAlmacenesParaConsulta(idCentroSeleccionado) {
  if (idCentroSeleccionado === "KACOSA") {
    return { centros: CENTROS_KACOSA, almacenes: almacenesPermitidosParaCentros(CENTROS_KACOSA) };
  }
  const tienda = TIENDAS.find(t => t.id === idCentroSeleccionado);
  const centros = tienda ? (tienda.centros || [tienda.centro]) : [];
  return { centros, almacenes: almacenesPermitidosParaCentros(centros) };
}

function validarLineasComunes(requiereCodigo) {
  if (requiereCodigo) {
    const lineasValidas = lineas
      .map(l => ({ codigo: (l.codigo || "").trim(), cantidad: (l.cantidad || "").toString().trim() }))
      .filter(l => l.codigo);
    if (lineasValidas.length === 0) return { error: "Ingresa al menos un código." };
    const codigoInvalido = lineasValidas.find(l => !CODIGO_REGEX.test(l.codigo));
    if (codigoInvalido) return { error: `El código "${codigoInvalido.codigo}" debe tener solo números, entre 3 y 10 dígitos.` };
    const cantidadInvalida = lineasValidas.find(l => !CANTIDAD_REGEX.test(l.cantidad));
    if (cantidadInvalida) return { error: `La cantidad del código ${cantidadInvalida.codigo} debe ser numérica, hasta 5 dígitos enteros y 3 decimales.` };
    const codigosUnicos = new Set(lineasValidas.map(l => l.codigo));
    if (codigosUnicos.size !== lineasValidas.length) return { error: "Hay códigos repetidos en la lista." };
    return { ok: true, lineas: lineasValidas.map(l => ({ codigo: l.codigo, cantidad: Number(l.cantidad) })) };
  }

  const lineasValidas = lineas
    .map(l => ({ descripcion: (l.descripcion || "").trim(), cantidad: (l.cantidad || "").toString().trim() }))
    .filter(l => l.descripcion || l.cantidad);
  if (lineasValidas.length === 0) return { error: "Ingresa al menos un material." };
  const descripcionInvalida = lineasValidas.find(l => l.descripcion.length < DESCRIPCION_MIN || l.descripcion.length > DESCRIPCION_MAX);
  if (descripcionInvalida) return { error: `Cada descripción debe tener entre ${DESCRIPCION_MIN} y ${DESCRIPCION_MAX} caracteres ("${descripcionInvalida.descripcion.slice(0, 30)}..." tiene ${descripcionInvalida.descripcion.length}).` };
  const cantidadInvalida = lineasValidas.find(l => !CANTIDAD_REGEX.test(l.cantidad));
  if (cantidadInvalida) return { error: `La cantidad de "${cantidadInvalida.descripcion.slice(0, 30)}..." debe ser numérica, hasta 5 dígitos enteros y 3 decimales.` };
  return { ok: true, lineas: lineasValidas.map(l => ({ descripcion: l.descripcion, cantidad: Number(l.cantidad) })) };
}

function validarCabeceraComun() {
  const emisora = tiendaEmisoraActual();
  if (!emisora) return { error: "Selecciona la tienda solicitante." };
  const idCentroSel = document.getElementById("st-centro").value;
  const motivo = document.getElementById("st-motivo").value;
  const motivoOtro = document.getElementById("st-motivo-otro").value.trim();
  const prioridad = document.getElementById("st-prioridad").value;
  if (motivo === "Otro" && !motivoOtro) return { error: "Especifica el motivo." };
  return { ok: true, emisora, idCentroSel, motivo, motivoOtro, prioridad };
}

async function buscarDisponibilidad() {
  mostrarErrorFormulario(null);

  const cabecera = validarCabeceraComun();
  if (cabecera.error) { mostrarErrorFormulario(cabecera.error); return; }
  const { emisora, idCentroSel, motivo, motivoOtro, prioridad } = cabecera;

  const lineasChk = validarLineasComunes(true);
  if (lineasChk.error) { mostrarErrorFormulario(lineasChk.error); return; }
  const lineasValidas = lineasChk.lineas;
  const codigosUnicos = lineasValidas.map(l => l.codigo);

  const btn = document.getElementById("st-buscar");
  bloquearFormularioPrincipal(true);
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Consultando...';

  try {
    // Siempre se consultan AMBOS centros: el de la tienda solicitante (la
    // que emite, en los dos tipos de solicitud) y el centro elegido en el
    // formulario (el "solicitado" en nota_traslado, o el "destino/receptor"
    // en extra_sap) — así la persona que revisa ve disponibilidad de los dos
    // lados sin tener que adivinar.
    const { centros: centrosA, almacenes: almacenesA } = centrosYAlmacenesParaConsulta(emisora);
    const { centros: centrosB, almacenes: almacenesB } = centrosYAlmacenesParaConsulta(idCentroSel);
    const [stockSolicitante, stockSolicitado] = await Promise.all([
      // Solo columna libre_utilización, sumada por cada almacén permitido
      // del centro (general + exhibición — ver ALMACENES_POR_CENTRO en
      // tiendas.js), SIN sumar trans_trasl/devoluciones — para "cuánto hay
      // realmente disponible para ceder ahora mismo" esas dos columnas no
      // cuentan (pueden traer valores que compensan/reducen el número real,
      // como confirmó Derwin el 20-sep-2026 con un caso donde sumarlas
      // convertía un disponible real de 330 en solo 1).
      obtenerStockDesdeSupabase(centrosA, almacenesA, { soloLibreUtilizacion: true }),
      obtenerStockDesdeSupabase(centrosB, almacenesB, { soloLibreUtilizacion: true })
    ]);

    // en_notas_kacosa: solo tiene sentido cuando se está pidiendo A Kacosa
    let notasKacosaPorCodigo = {};
    if (tipoActual === "nota_traslado" && idCentroSel === "KACOSA") {
      notasKacosaPorCodigo = await obtenerEnNotasKacosaHoy(emisora, codigosUnicos);
    }

    const materiales = [];
    const codigosNoEncontrados = [];
    for (const l of lineasValidas) {
      const infoA = stockSolicitante[l.codigo];
      const infoB = stockSolicitado[l.codigo];
      let descripcion = (infoA && infoA.descripcion) || (infoB && infoB.descripcion) || "";
      let unidad = (infoA && infoA.unidadBase) || (infoB && infoB.unidadBase) || "UN";

      if (!infoA && !infoB) {
        const filas = await supabaseSelect("UBICACIONES", `material=eq.${encodeURIComponent(l.codigo)}&select=descripcion&limit=1`);
        if (!filas || filas.length === 0) { codigosNoEncontrados.push(l.codigo); continue; }
        descripcion = filas[0].descripcion || "";
      }

      materiales.push({
        codigo: l.codigo,
        descripcion,
        unidad,
        cantidad: l.cantidad,
        stockCentroSolicitante: Math.round(((infoA && infoA.stockDisponible) || 0) * 100) / 100,
        stockCentroSolicitado: Math.round(((infoB && infoB.stockDisponible) || 0) * 100) / 100,
        enNotasKacosa: notasKacosaPorCodigo[l.codigo] || 0
      });
    }

    if (codigosNoEncontrados.length > 0) {
      mostrarErrorFormulario("Código(s) no encontrado(s): " + codigosNoEncontrados.join(", "));
      return;
    }

    confirmacion = {
      tienda_solicitante: emisora,
      tipo_solicitud: tipoActual,
      centro_solicitado: tipoActual === "nota_traslado" ? idCentroSel : null,
      centro_destino: tipoActual === "extra_sap" ? idCentroSel : null,
      motivo, motivo_otro: motivo === "Otro" ? motivoOtro : null,
      prioridad,
      materiales
    };
    pintarConfirmacion();
    // Lleva la vista al resultado — en móvil, el formulario suele ocupar
    // toda la pantalla y el usuario no ve que ya apareció la tabla si no
    // hace scroll manual (20-sep-2026).
    const wrapConfirmacion = document.getElementById("st-confirmacion-wrap");
    if (wrapConfirmacion) wrapConfirmacion.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    mostrarErrorFormulario("Error al consultar: " + err.message);
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Solicitar';
    // Si quedó una confirmación pendiente, el formulario se mantiene
    // bloqueado hasta que se cancele o se envíe (ver pintarConfirmacion /
    // enviarSolicitud). Si hubo error o no se llegó a confirmación, se
    // desbloquea para que el usuario pueda corregir.
    if (!confirmacion) bloquearFormularioPrincipal(false);
  }
}

async function obtenerEnNotasKacosaHoy(tienda, codigos) {
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const listaCodigos = codigos.map(c => `"${c}"`).join(",");
  const filas = await supabaseSelectTodo(
    "analisis",
    `select=codigo,en_notas_kacosa,creado_en&tienda=eq.${encodeURIComponent(tienda)}&codigo=in.(${listaCodigos})&creado_en=gte.${inicioHoy.toISOString()}&order=creado_en.desc`
  );
  const mapa = {};
  filas.forEach(f => {
    if (mapa[f.codigo] === undefined) mapa[f.codigo] = Number(f.en_notas_kacosa) || 0;
  });
  return mapa;
}

/** Etiquetas de las 2 columnas de disponible, según el tipo de solicitud. */
/** Código(s) SAP de un centro/tienda, para mostrar en los encabezados de disponibilidad. Kacosa son 2 centros (1000/3000) a la vez. */
function codigoCentroTexto(idCentro) {
  if (idCentro === "KACOSA") return CENTROS_KACOSA.join("/");
  const t = TIENDAS.find(x => x.id === idCentro);
  return (t && t.centro) || idCentro || "";
}

/** Etiquetas de las 2 columnas de disponible, mostrando el código SAP real de cada centro. */
function etiquetasDisponible(idSolicitante, idSolicitado) {
  const codSolicitante = codigoCentroTexto(idSolicitante);
  const codSolicitado = codigoCentroTexto(idSolicitado);
  return { solicitante: `Disponible (${codSolicitante})`, solicitado: `Disponible (${codSolicitado})` };
}

/** ¿Contra cuál de las 2 columnas se valida "no pedir más de lo disponible"? */
function fuenteDeValidacion() {
  // nota_traslado: el material sale del centro SOLICITADO hacia la tienda.
  // extra_sap: el material sale de la propia tienda (solicitante/emisor).
  return tipoActual === "extra_sap" ? "stockCentroSolicitante" : "stockCentroSolicitado";
}

function pintarConfirmacion() {
  const wrap = document.getElementById("st-confirmacion-wrap");
  if (!wrap || !confirmacion) return;
  const etiquetas = etiquetasDisponible(confirmacion.tienda_solicitante, confirmacion.centro_solicitado || confirmacion.centro_destino);

  const filasHtml = confirmacion.materiales.map((m, idx) => `
    <tr data-idx="${idx}">
      <td>${m.codigo}</td>
      <td>${m.descripcion}</td>
      <td>${m.unidad}</td>
      <td>${m.stockCentroSolicitante}</td>
      <td>${m.stockCentroSolicitado}</td>
      ${confirmacion.tipo_solicitud === "nota_traslado" && confirmacion.centro_solicitado === "KACOSA"
        ? `<td>${m.enNotasKacosa}</td>` : ""}
      <td>
        <input type="text" inputmode="decimal" class="input-modern conf-cantidad" style="width:90px" value="${m.cantidad}">
        <div class="conf-cantidad-error" style="display:none; color:var(--rojo-alerta); font-size:11px; margin-top:3px">Cantidad inválida</div>
      </td>
      <td><button type="button" class="btn-sutil-peligro conf-quitar" title="Quitar de la solicitud"><i class="fa-solid fa-trash"></i></button></td>
    </tr>
  `).join("");

  const muestraNotasKacosa = confirmacion.tipo_solicitud === "nota_traslado" && confirmacion.centro_solicitado === "KACOSA";

  wrap.innerHTML = `
    <div class="card" style="margin-top:20px; border:2px solid var(--azul-base)">
      <h3 style="margin-top:0; font-size:15px; color:var(--azul-base)"><i class="fa-solid fa-clipboard-check"></i> Confirmar solicitud</h3>
      <p class="vista-sub" style="margin-top:-4px">Revisa la disponibilidad antes de enviar. Puedes ajustar o quitar líneas.</p>
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th>Código</th><th>Descripción</th><th>UMB</th>
              <th>${etiquetas.solicitante}</th><th>${etiquetas.solicitado}</th>
              ${muestraNotasKacosa ? "<th>En notas Kacosa</th>" : ""}
              <th>Cantidad a pedir</th><th></th>
            </tr>
          </thead>
          <tbody>${filasHtml}</tbody>
        </table>
      </div>
      <div id="st-confirmacion-error" style="color:var(--rojo-alerta); font-size:13px; margin-top:10px; display:none">
        Hay líneas con una cantidad inválida o mayor a lo disponible. Ajústalas o quítalas para poder enviar.
      </div>
      <div class="btn-group" style="margin-top:16px">
        <button type="button" id="st-cancelar-confirmacion" class="btn-secundario">Cancelar</button>
        <button type="button" id="st-enviar" class="btn-primario">Enviar solicitud</button>
      </div>
    </div>
  `;

  wrap.querySelectorAll(".conf-cantidad").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.closest("tr").dataset.idx);
      confirmacion.materiales[idx].cantidad = e.target.value;
      validarConfirmacion();
    });
  });
  wrap.querySelectorAll(".conf-quitar").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.closest("tr").dataset.idx);
      confirmacion.materiales.splice(idx, 1);
      if (confirmacion.materiales.length === 0) { confirmacion = null; wrap.innerHTML = ""; bloquearFormularioPrincipal(false); return; }
      pintarConfirmacion();
    });
  });

  document.getElementById("st-cancelar-confirmacion").addEventListener("click", () => {
    confirmacion = null;
    wrap.innerHTML = "";
    bloquearFormularioPrincipal(false);
  });
  document.getElementById("st-enviar").addEventListener("click", () => enviarSolicitud(document.getElementById("st-enviar")));

  validarConfirmacion();
}

/**
 * Marca en rojo las líneas con cantidad inválida (formato, o mayor a lo
 * disponible en el centro de origen) y deshabilita "Enviar solicitud"
 * mientras exista al menos una. Se llama al pintar la tabla y cada vez que
 * el usuario edita una cantidad.
 */
function validarConfirmacion() {
  const wrap = document.getElementById("st-confirmacion-wrap");
  const btnEnviar = document.getElementById("st-enviar");
  const avisoGeneral = document.getElementById("st-confirmacion-error");
  if (!wrap || !confirmacion) return;
  const campoFuente = fuenteDeValidacion();

  let hayInvalidas = false;
  wrap.querySelectorAll("tr[data-idx]").forEach(fila => {
    const idx = Number(fila.dataset.idx);
    const m = confirmacion.materiales[idx];
    const cantidadStr = (m.cantidad || "").toString();
    const formatoValido = CANTIDAD_REGEX.test(cantidadStr);
    const cantidadNum = Number(cantidadStr);
    const invalida = !formatoValido || cantidadNum > m[campoFuente];
    const inputCantidad = fila.querySelector(".conf-cantidad");
    const avisoFila = fila.querySelector(".conf-cantidad-error");
    fila.style.background = invalida ? "var(--rojo-claro)" : "";
    if (inputCantidad) inputCantidad.style.borderColor = invalida ? "var(--rojo-alerta)" : "";
    if (avisoFila) {
      avisoFila.textContent = !formatoValido ? "Máx. 5 enteros y 3 decimales" : "Supera lo disponible";
      avisoFila.style.display = invalida ? "block" : "none";
    }
    if (invalida) hayInvalidas = true;
  });

  if (btnEnviar) btnEnviar.disabled = hayInvalidas;
  if (avisoGeneral) avisoGeneral.style.display = hayInvalidas ? "block" : "none";
}

/** Flujo "Sin código SAP": sin stock, confirmación simple, envío directo. */
async function manejarSolicitudSinCodigo() {
  mostrarErrorFormulario(null);

  const cabecera = validarCabeceraComun();
  if (cabecera.error) { mostrarErrorFormulario(cabecera.error); return; }
  const { emisora, idCentroSel, motivo, motivoOtro, prioridad } = cabecera;

  const lineasChk = validarLineasComunes(false);
  if (lineasChk.error) { mostrarErrorFormulario(lineasChk.error); return; }

  const materiales = lineasChk.lineas.map(l => ({
    codigo: null,
    descripcion: l.descripcion,
    unidad: "N/A",
    cantidad: l.cantidad,
    sinCodigoSap: true
  }));

  const resumen = materiales.map(m => `• ${m.descripcion} (${m.cantidad})`).join("\n");
  const ok = await confirmarAccion(
    `Vas a enviar una solicitud SIN código SAP con ${materiales.length} material(es):\n\n${resumen}\n\nNo se valida contra el stock del sistema. ¿Confirmas el envío?`,
    { titulo: "Confirmar solicitud" }
  );
  if (!ok) return;

  confirmacion = {
    tienda_solicitante: emisora,
    tipo_solicitud: tipoActual,
    centro_solicitado: tipoActual === "nota_traslado" ? idCentroSel : null,
    centro_destino: tipoActual === "extra_sap" ? idCentroSel : null,
    motivo, motivo_otro: motivo === "Otro" ? motivoOtro : null,
    prioridad,
    materiales
  };
  bloquearFormularioPrincipal(true);
  await enviarSolicitud(document.getElementById("st-buscar"));
}

async function enviarSolicitud(btnEl) {
  if (!confirmacion) return;
  bloquearConfirmacion(true);
  if (btnEl) btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

  try {
    const usuario = window.KACOSA.usuario;
    const fila = {
      tipo_solicitud: confirmacion.tipo_solicitud,
      estado: "pendiente",
      prioridad: confirmacion.prioridad,
      motivo: confirmacion.motivo,
      motivo_otro: confirmacion.motivo_otro,
      tienda_solicitante: confirmacion.tienda_solicitante,
      centro_solicitado: confirmacion.centro_solicitado,
      centro_destino: confirmacion.centro_destino,
      materiales: confirmacion.materiales,
      usuario_email: usuario.email,
      usuario_nombre: usuario.nombre || usuario.email
    };

    const insertado = await supabaseInsert("solicitudes_traslado", [fila]);
    const solicitud = insertado && insertado[0];

    // No se espera la respuesta del correo (Apps Script puede tardar varios
    // segundos) — la solicitud ya quedó guardada, el aviso se manda en
    // segundo plano. enviarAvisoCorreo ya tiene su propio try/catch.
    enviarAvisoCorreo(solicitud);

    notificarExito(
      confirmacion.tipo_solicitud === "extra_sap"
        ? "Tu solicitud Extra SAP fue enviada a Directiva/Coordinador para su aprobación."
        : "Tu solicitud de traslado fue enviada al equipo de Abastecimiento.",
      { titulo: "Solicitud enviada" }
    );

    confirmacion = null;
    lineas = [nuevaLinea()];
    vistaConstruida = false;
    render(); // reconstruye todo el formulario ya desbloqueado
  } catch (err) {
    console.error(err);
    notificarExito("No se pudo enviar la solicitud: " + err.message, {
      titulo: "Error", icono: '<i class="fa-solid fa-triangle-exclamation"></i>', segundos: 6
    });
    bloquearConfirmacion(false);
    bloquearFormularioPrincipal(false);
    if (btnEl) btnEl.innerHTML = btnEl.id === "st-buscar" ? '<i class="fa-solid fa-magnifying-glass"></i> Solicitar' : "Enviar solicitud";
  }
}

/**
 * Avisa por correo vía Apps Script (acción "notificarSolicitudTraslado" en
 * Bridge.gs). Best-effort a propósito: si Gmail falla o equipo_notificaciones
 * está vacío, la solicitud YA quedó guardada en Supabase, así que solo se
 * avisa por consola en vez de romper el flujo de "Enviar solicitud".
 */
async function enviarAvisoCorreo(solicitud) {
  if (!solicitud) return;
  try {
    const destinatarios = await obtenerCorreosEquipo(
      solicitud.tipo_solicitud === "extra_sap" ? ["directiva", "coordinador"] : ["abastecimiento"]
    );
    console.log("[Abastecimiento] Aviso de nueva solicitud #" + solicitud.id + " — destinatarios resueltos:", destinatarios);
    const resp = await callBridge("notificarSolicitudTraslado", {
      solicitudId: solicitud.id,
      tipoSolicitud: solicitud.tipo_solicitud,
      tiendaSolicitante: nombrePorId(solicitud.tienda_solicitante),
      usuarioNombre: solicitud.usuario_nombre,
      usuarioEmail: solicitud.usuario_email,
      prioridad: solicitud.prioridad,
      materiales: solicitud.materiales,
      destinatarios
    });
    if (!resp || !resp.ok) {
      console.warn("No se pudo enviar el aviso por correo:", resp && resp.error);
    }
  } catch (err) {
    console.warn("No se pudo enviar el aviso por correo:", err.message);
  }
}

/**
 * Lee los correos activos de equipo_notificaciones para los roles pedidos.
 * 19-sep-2026: el filtro de rol se hace en JS (no en la consulta) y sin
 * importar mayúsculas/minúsculas — si nunca llegaban los avisos de nuevas
 * solicitudes, lo más probable es que la tabla esté vacía o que el texto del
 * rol no calzara exacto (ej. "Abastecimiento" vs "abastecimiento"); esto
 * elimina esa segunda causa. Revisa la consola del navegador: si el arreglo
 * de destinatarios sale vacío, hay que revisar/llenar esa tabla en Supabase.
 */
async function obtenerCorreosEquipo(roles) {
  try {
    const filas = await supabaseSelect("equipo_notificaciones", `select=email,rol&activo=eq.true`);
    const rolesBuscados = roles.map(r => r.toLowerCase());
    return (filas || [])
      .filter(f => rolesBuscados.includes((f.rol || "").toLowerCase().trim()))
      .map(f => f.email);
  } catch (err) {
    console.warn("No se pudieron leer los correos del equipo:", err.message);
    return [];
  }
}

async function cargarMisSolicitudes() {
  const cont = document.getElementById("st-tabla-mis-solicitudes");
  if (!cont) return;
  const usuario = window.KACOSA?.usuario;
  if (!usuario) return;

  try {
    const filas = await supabaseSelectTodo(
      "solicitudes_traslado",
      `select=*&usuario_email=eq.${encodeURIComponent(usuario.email)}&order=creado_en.desc&limit=500`
    );

    marcarResultadosComoVistos(filas); // sin await: no debe demorar el pintado de la tabla

    const columnas = [
      { key: "id", label: "#" },
      { key: "creado_en", label: "Fecha", render: r => new Date(r.creado_en).toLocaleString("es-VE") },
      { key: "tipo_solicitud", label: "Tipo", render: r => r.tipo_solicitud === "extra_sap" ? "Extra SAP" : "Nota de traslado" },
      { key: "centro", label: "Centro", render: r => nombrePorId(r.centro_solicitado || r.centro_destino || "") },
      { key: "prioridad", label: "Prioridad" },
      { key: "estado", label: "Estado", render: r => `<span class="estado-pill estado-${r.estado}">${etiquetaEstado(r.estado)}</span>` },
      { key: "acciones", label: "", render: r => htmlAccionesFila(r) }
    ];

    if (!tablaMisSolicitudes) {
      tablaMisSolicitudes = crearTablaPaginada(cont, columnas, 20, {
        claveFila: (item) => item.id,
        onAccionFila: (clave, item, accion) => {
          if (accion === "ver") abrirModalDetalleSolicitud(item);
          if (accion === "descargar") abrirModalDescarga(item);
        }
      });
    }
    tablaMisSolicitudes.renderizar(filas);
  } catch (err) {
    console.error(err);
    cont.innerHTML = `<p class="vista-sub">Error al cargar tus solicitudes: ${err.message}</p>`;
  }
}

function etiquetaEstado(estado) {
  return { pendiente: "Pendiente", aceptada: "Aceptada", rechazada: "Rechazada", procesada: "Procesada" }[estado] || estado;
}

/**
 * Al gerente le llega la campanita cuando alguna de sus solicitudes cambia
 * de estado (ver notificaciones-bell.js). En cuanto entra aquí y las ve en
 * la tabla, se marcan como vistas para que la campanita deje de contarlas —
 * sin await a propósito, no debe demorar el pintado de "Mis solicitudes".
 */
async function marcarResultadosComoVistos(filas) {
  const idsSinVer = (filas || []).filter(f => f.resultado_visto === false).map(f => f.id);
  if (idsSinVer.length === 0) return;
  try {
    await supabaseUpdate("solicitudes_traslado", `id=in.(${idsSinVer.join(",")})`, { resultado_visto: true });
  } catch (err) {
    console.warn("No se pudo marcar como vistos los resultados:", err.message);
  }
}

function htmlAccionesFila(r) {
  let html = `<button type="button" class="btn-secundario" style="padding:6px 10px; font-size:12px" data-fila-accion="ver">Ver</button>`;
  if (r.tipo_solicitud === "extra_sap" && r.estado === "procesada" && !r.clave_usada) {
    html += ` <button type="button" class="btn-primario" style="padding:6px 10px; font-size:12px" data-fila-accion="descargar"><i class="fa-solid fa-file-pdf"></i> Descargar Nota</button>`;
  }
  return html;
}

/** ms restantes de vigencia del código (negativo/0 = ya expiró). Null si no aplica. */
function msRestantesClave(s) {
  if (!s.clave_descarga || !s.clave_generada_en) return null;
  return new Date(s.clave_generada_en).getTime() + DURACION_CLAVE_MS - Date.now();
}
function formatearRestante(ms) {
  const seg = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(seg / 60) + ":" + String(seg % 60).padStart(2, "0");
}
function estadoClaveTexto(s) {
  if (!s.clave_descarga) return null;
  if (s.clave_usada) return { texto: "Ya fue utilizado", vencido: true };
  const restante = msRestantesClave(s);
  if (restante === null) return { texto: "Vigente", vencido: false };
  if (restante <= 0) return { texto: "Expiró (duraba 5 min)", vencido: true };
  return { texto: "Vence en " + formatearRestante(restante), vencido: false };
}

// El código va en una "ficha" de colores fijos (no depende de las variables
// de tema claro/oscuro) para que siempre se pueda leer, sin importar el
// tema activo — ver .codigo-chip en app.css.
function htmlBloqueClave(s) {
  if (!s.clave_descarga || s.tipo_solicitud !== "extra_sap") return "";
  const estado = estadoClaveTexto(s);
  return `
    <div class="card" style="margin-top:10px; background:var(--fondo)">
      <p style="font-size:12px; color:var(--texto-secundario); margin:0 0 6px 0">Código de descarga</p>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
        <span class="codigo-chip">${s.clave_descarga}</span>
        <button type="button" class="btn-secundario btn-copiar-clave" data-copiar="${s.clave_descarga}" style="padding:6px 12px; font-size:12px"><i class="fa-solid fa-copy"></i> Copiar</button>
        <span style="font-size:12px; color:${estado.vencido ? "var(--rojo-alerta)" : "var(--texto-secundario)"}">${estado.texto}</span>
      </div>
    </div>
  `;
}

function activarBotonesCopiar(contenedor) {
  contenedor.querySelectorAll(".btn-copiar-clave").forEach(btn => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.copiar).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copiado';
        setTimeout(() => { btn.innerHTML = original; }, 1500);
      });
    });
  });
}

function filaMaterialDetalle(m) {
  if (m.sinCodigoSap || !m.codigo) {
    return `<tr><td colspan="2"><em>Sin código SAP:</em> ${m.descripcion}</td><td>${m.cantidad}</td><td>${m.unidad || "N/A"}</td></tr>`;
  }
  return `<tr><td>${m.codigo}</td><td>${m.descripcion}</td><td>${m.cantidad}</td><td>${m.unidad}</td></tr>`;
}

function abrirModalDetalleSolicitud(s) {
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:60; display:flex; align-items:center; justify-content:center; padding:20px";
  const filasMat = (s.materiales || []).map(filaMaterialDetalle).join("");
  modal.innerHTML = `
    <div style="background:var(--blanco); border-radius:var(--radio); max-width:600px; width:100%; max-height:90vh; overflow-y:auto; padding:24px">
      <h3 style="margin:0; color:var(--texto-titulo)">Solicitud #${s.id}</h3>
      <p class="vista-sub" style="margin-top:4px">
        ${s.tipo_solicitud === "extra_sap" ? "Extra SAP" : "Nota de traslado"} ·
        ${etiquetaEstado(s.estado)} · Prioridad ${s.prioridad}
      </p>
      <p style="font-size:13px; margin-top:10px">
        <strong>${s.tipo_solicitud === "extra_sap" ? "Centro solicitante" : "Centro solicitado"}:</strong> ${nombrePorId(s.centro_solicitado || s.centro_destino || "")}<br>
        <strong>Motivo:</strong> ${s.motivo}${s.motivo_otro ? " — " + s.motivo_otro : ""}
      </p>
      ${s.estado === "rechazada" && s.motivo_rechazo ? `<p style="font-size:13px; color:var(--rojo-alerta)"><strong>Motivo de rechazo:</strong> ${s.motivo_rechazo}</p>` : ""}
      ${s.motivo_edicion ? `<p style="font-size:13px; color:var(--ambar-oscuro)"><strong>Motivo de la edición de cantidades:</strong> ${s.motivo_edicion}</p>` : ""}
      ${s.numero_nota ? `<p style="font-size:13px"><strong>N° de nota:</strong> ${s.numero_nota} <button type="button" class="btn-secundario btn-copiar-clave" data-copiar="${s.numero_nota}" style="padding:2px 8px; font-size:11px; margin-left:6px; vertical-align:middle"><i class="fa-solid fa-copy"></i></button></p>` : ""}
      ${s.procesado_por_nombre ? `<p style="font-size:13px; color:var(--texto-secundario)"><strong>Procesado por:</strong> ${s.procesado_por_nombre} (${s.procesado_por_email || ""})</p>` : ""}
      ${htmlBloqueClave(s)}
      <div class="table-responsive" style="margin-top:10px">
        <table><thead><tr><th>Código</th><th>Descripción</th><th>Cantidad</th><th>UMB</th></tr></thead>
        <tbody>${filasMat}</tbody></table>
      </div>
      <button type="button" id="st-cerrar-detalle" class="btn-primario" style="margin-top:16px; width:100%">Cerrar</button>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById("st-cerrar-detalle").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  activarBotonesCopiar(modal);
}

function abrirModalDescarga(s) {
  const restante = msRestantesClave(s);
  if (restante !== null && restante <= 0) {
    notificarExito("El código expiró (duran 5 minutos desde que se genera). Pide a Directiva/Coordinador que te generen uno nuevo desde el detalle de la solicitud.", {
      titulo: "Código expirado", icono: '<i class="fa-solid fa-clock"></i>', segundos: 6
    });
    return;
  }

  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:60; display:flex; align-items:center; justify-content:center; padding:20px";
  modal.innerHTML = `
    <div style="background:var(--blanco); border-radius:var(--radio); max-width:420px; width:100%; padding:24px">
      <h3 style="margin:0; color:var(--texto-titulo)"><i class="fa-solid fa-key"></i> Código de descarga</h3>
      <p class="vista-sub" style="margin-top:6px">Ingresa el código de 6 caracteres que recibiste al aprobarse la solicitud. Solo se puede usar una vez y vence 5 minutos después de generarse.</p>
      <input type="text" id="st-clave-input" class="input-modern" maxlength="6" style="text-transform:uppercase; letter-spacing:3px; text-align:center; font-size:18px; margin-top:10px" placeholder="XXXXXX">
      <div id="st-clave-error" style="color:var(--rojo-alerta); font-size:13px; margin-top:8px; display:none"></div>
      <div class="btn-group" style="margin-top:16px">
        <button type="button" id="st-clave-cancelar" class="btn-secundario">Cancelar</button>
        <button type="button" id="st-clave-confirmar" class="btn-primario">Descargar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const cerrar = () => modal.remove();
  document.getElementById("st-clave-cancelar").addEventListener("click", cerrar);
  modal.addEventListener("click", (e) => { if (e.target === modal) cerrar(); });

  document.getElementById("st-clave-confirmar").addEventListener("click", async () => {
    const input = document.getElementById("st-clave-input");
    const errorEl = document.getElementById("st-clave-error");
    const codigo = input.value.trim().toUpperCase();
    errorEl.style.display = "none";
    if (codigo.length !== 6) { errorEl.textContent = "El código debe tener 6 caracteres."; errorEl.style.display = "block"; return; }

    const btn = document.getElementById("st-clave-confirmar");
    modal.querySelectorAll("input, button").forEach(el => { el.disabled = true; });
    btn.textContent = "Verificando...";
    try {
      const limiteVigencia = new Date(Date.now() - DURACION_CLAVE_MS).toISOString();
      const actualizado = await supabaseUpdate(
        "solicitudes_traslado",
        `id=eq.${s.id}&clave_descarga=eq.${encodeURIComponent(codigo)}&clave_usada=eq.false&estado=eq.procesada&clave_generada_en=gte.${limiteVigencia}`,
        { clave_usada: true, clave_usada_en: new Date().toISOString() }
      );
      if (!actualizado || actualizado.length === 0) {
        errorEl.textContent = await diagnosticarFalloClave(s.id, codigo);
        errorEl.style.display = "block";
        modal.querySelectorAll("input, button").forEach(el => { el.disabled = false; });
        btn.textContent = "Descargar";
        return;
      }
      await descargarNotaDeTraslado(actualizado[0]);
      cerrar();
      cargarMisSolicitudes();
    } catch (err) {
      errorEl.textContent = "Error: " + err.message;
      errorEl.style.display = "block";
      modal.querySelectorAll("input, button").forEach(el => { el.disabled = false; });
      btn.textContent = "Descargar";
    }
  });
}

/** Tras un intento fallido de canje, consulta (solo lectura) la fila real para dar un mensaje específico. */
async function diagnosticarFalloClave(id, codigoIngresado) {
  try {
    const filas = await supabaseSelect("solicitudes_traslado", `id=eq.${id}&select=clave_descarga,clave_usada,clave_generada_en,estado`);
    const actual = filas && filas[0];
    if (!actual) return "No se encontró la solicitud.";
    if (actual.estado !== "procesada") return "Esta solicitud ya no está disponible para descarga.";
    if (actual.clave_usada) return "Este código ya fue utilizado.";
    if (actual.clave_generada_en && (Date.now() - new Date(actual.clave_generada_en).getTime()) > DURACION_CLAVE_MS) {
      return "El código expiró (duran 5 minutos). Pide que te generen uno nuevo.";
    }
    if (actual.clave_descarga !== codigoIngresado) return "Código incorrecto.";
    return "No se pudo validar el código, intenta de nuevo.";
  } catch (err) {
    return "Código incorrecto o ya utilizado.";
  }
}

/* =========================================================
 *  AUTO-SINCRONIZACIÓN de "Mis solicitudes"
 *  Mismo patrón que resumen-directiva.js: mientras la vista está
 *  activa, se refresca sola cada INTERVALO_SYNC_MS para que el
 *  gerente vea el cambio de estado sin tener que recargar.
 * ========================================================= */
function iniciarSyncAutomatico() {
  if (intervaloSync) return;
  intervaloSync = setInterval(() => {
    if (document.hidden || !vistaEstaActiva()) return;
    cargarMisSolicitudes();
  }, INTERVALO_SYNC_MS);
}
function detenerSyncAutomatico() {
  if (intervaloSync) { clearInterval(intervaloSync); intervaloSync = null; }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && vistaEstaActiva() && vistaConstruida) cargarMisSolicitudes();
});

document.addEventListener("kacosa:vista-cambiada", (e) => {
  if (e.detail.vista === "vista-traslados") render();
  else detenerSyncAutomatico();
});
document.addEventListener("kacosa:usuario-listo", () => {
  vistaConstruida = false;
  detenerSyncAutomatico();
  if (vistaEstaActiva()) render();
});
if (document.querySelector("#vista-traslados.activa") && window.KACOSA?.usuario) {
  render();
}
