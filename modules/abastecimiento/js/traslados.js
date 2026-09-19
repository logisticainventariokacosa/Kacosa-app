// js/traslados.js
// Submódulo "Solicitud de Traslado" (17-sep-2026, ajustes 18-sep-2026). Acceso
// real controlado por ROLES_ACCESO_SOLICITUD_TRASLADO en auth.js — mientras se
// prueba, solo "admin" (nav.js ya oculta el botón del menú para cualquier otro
// rol; aquí se repite la verificación por si alguien entra directo por
// URL/hash, mismo patrón que resumen-directiva.js).
//
// Flujo: el usuario arma un "cuaderno de línea" de códigos + cantidad, elige
// tipo de solicitud (Nota de traslado | Extra SAP), el centro correspondiente,
// motivo y prioridad. Al presionar "Solicitar" se consulta stock/en_notas_kacosa
// de cada código y se muestra una tabla de confirmación donde puede ajustar o
// quitar líneas antes de enviar (bloqueada si alguna cantidad supera lo
// disponible). Al enviar se guarda en Supabase (solicitudes_traslado) y se
// avisa por correo (callBridge, ya integrado en Bridge.gs) sin esperar la
// respuesta, para no demorar la confirmación al usuario.
import { supabaseSelect, supabaseSelectTodo, supabaseInsert, supabaseUpdate } from "./supabase-client.js?v=1";
import { obtenerStockDesdeSupabase } from "./stock-parser.js?v=1";
import { TIENDAS, nombrePorId, almacenesPermitidosParaCentros, CENTROS_KACOSA } from "./tiendas.js?v=1";
import { crearTablaPaginada } from "./tabla-utils.js";
import { notificarExito, confirmarAccion } from "./notificaciones.js";
import { callBridge } from "./bridge.js";
import { ROLES_ACCESO_SOLICITUD_TRASLADO } from "./auth.js";
import { descargarNotaDeTraslado } from "./pdf-nota-traslado.js?v=1";

const MOTIVOS = ["Venta puntual", "Complemento de stock", "Otro"];
const DURACION_CLAVE_MS = 5 * 60 * 1000; // 5 minutos, igual que en notificaciones-abastecimiento.js
const INTERVALO_SYNC_MS = 15000; // 15s — "Mis solicitudes" se refresca sola mientras la vista está activa

let lineas = [ nuevaLinea() ]; // [{codigo, cantidad}]
let tipoActual = "nota_traslado"; // 'nota_traslado' | 'extra_sap'
let tiendaEmisoraSeleccionada = null; // solo aplica si el usuario ve "TODAS"
let confirmacion = null; // {materiales:[...], ...datosFormulario} mientras se revisa antes de enviar
let tablaMisSolicitudes = null;
let vistaConstruida = false;
let intervaloSync = null;

function nuevaLinea() {
  return { codigo: "", cantidad: "" };
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
          <label class="form-label">Tienda solicitante <span class="required">*</span></label>
          <select id="st-tienda-emisora" class="input-modern select-modern">
            ${disponibles.map(id => `<option value="${id}">${nombrePorId(id)}</option>`).join("")}
          </select>
        </div>
      ` : `
        <p class="vista-sub" style="margin-top:6px">Tienda solicitante: <strong>${nombrePorId(disponibles[0] || "")}</strong></p>
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
        <div id="st-lineas"></div>
        <button type="button" id="st-agregar-linea" class="btn-secundario" style="margin-top:8px"><i class="fa-solid fa-plus"></i> Agregar código</button>
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

  cont.querySelectorAll(".btn-tipo-solicitud").forEach(btn => {
    btn.addEventListener("click", () => {
      tipoActual = btn.dataset.tipo;
      cont.querySelectorAll(".btn-tipo-solicitud").forEach(b => b.classList.toggle("activo", b === btn));
      document.getElementById("st-label-centro").innerHTML =
        `${tipoActual === "extra_sap" ? "Centro de destino" : "Centro del que se solicita"} <span class="required">*</span>`;
      actualizarCentroDestino();
    });
  });

  document.getElementById("st-motivo").addEventListener("change", (e) => {
    document.getElementById("st-motivo-otro-wrap").style.display = e.target.value === "Otro" ? "block" : "none";
  });

  document.getElementById("st-agregar-linea").addEventListener("click", () => {
    lineas.push(nuevaLinea());
    pintarLineas();
  });

  document.getElementById("st-buscar").addEventListener("click", buscarDisponibilidad);

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
      : "Se mostrará la disponibilidad (libre utilización) de este centro.";
  }
}

function pintarLineas() {
  const cont = document.getElementById("st-lineas");
  if (!cont) return;
  cont.innerHTML = lineas.map((l, idx) => `
    <div class="st-linea" data-idx="${idx}" style="display:flex; gap:8px; margin-bottom:8px; align-items:center">
      <input type="text" class="input-modern st-linea-codigo" placeholder="Código" value="${(l.codigo || "").replace(/"/g, "&quot;")}" style="flex:2">
      <input type="number" min="0.01" step="0.01" class="input-modern st-linea-cantidad" placeholder="Cantidad" value="${l.cantidad}" style="flex:1">
      ${lineas.length > 1 ? `<button type="button" class="btn-sutil-peligro st-linea-quitar" title="Quitar"><i class="fa-solid fa-trash"></i></button>` : ""}
    </div>
  `).join("");

  cont.querySelectorAll(".st-linea-codigo").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.closest(".st-linea").dataset.idx);
      lineas[idx].codigo = e.target.value.trim();
    });
  });
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
 * tipo, centro, motivo, prioridad, líneas de materiales) mientras se está
 * consultando disponibilidad — para que el usuario no pueda seguir editando
 * y desincronizar lo que ve de lo que realmente se está consultando.
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

async function buscarDisponibilidad() {
  mostrarErrorFormulario(null);

  const emisora = tiendaEmisoraActual();
  if (!emisora) { mostrarErrorFormulario("Selecciona la tienda solicitante."); return; }

  const idCentroSel = document.getElementById("st-centro").value;
  const motivo = document.getElementById("st-motivo").value;
  const motivoOtro = document.getElementById("st-motivo-otro").value.trim();
  const prioridad = document.getElementById("st-prioridad").value;

  if (motivo === "Otro" && !motivoOtro) {
    mostrarErrorFormulario("Especifica el motivo.");
    return;
  }

  const lineasValidas = lineas
    .map(l => ({ codigo: (l.codigo || "").trim(), cantidad: Number(l.cantidad) }))
    .filter(l => l.codigo);

  if (lineasValidas.length === 0) {
    mostrarErrorFormulario("Ingresa al menos un código.");
    return;
  }
  const conCantidadInvalida = lineasValidas.find(l => !(l.cantidad > 0));
  if (conCantidadInvalida) {
    mostrarErrorFormulario(`El código ${conCantidadInvalida.codigo} necesita una cantidad válida (mayor a 0).`);
    return;
  }
  const codigosUnicos = new Set(lineasValidas.map(l => l.codigo));
  if (codigosUnicos.size !== lineasValidas.length) {
    mostrarErrorFormulario("Hay códigos repetidos en la lista.");
    return;
  }

  const btn = document.getElementById("st-buscar");
  bloquearFormularioPrincipal(true);
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Consultando...';

  try {
    // Para "extra_sap" el stock a validar es el de la PROPIA tienda solicitante
    // (la mercancía sale de ahí). Para "nota_traslado" es el del centro elegido
    // (de donde se está pidiendo). Ver nota en el mensaje final de la respuesta
    // por si esta interpretación necesita ajuste.
    const idCentroConsulta = tipoActual === "extra_sap" ? emisora : idCentroSel;
    const { centros, almacenes } = centrosYAlmacenesParaConsulta(idCentroConsulta);
    const stockMap = await obtenerStockDesdeSupabase(centros, almacenes, { soloLibreUtilizacion: true });

    // en_notas_kacosa: solo tiene sentido cuando se está pidiendo A Kacosa
    let notasKacosaPorCodigo = {};
    if (tipoActual === "nota_traslado" && idCentroSel === "KACOSA") {
      notasKacosaPorCodigo = await obtenerEnNotasKacosaHoy(emisora, [...codigosUnicos]);
    }

    const materiales = [];
    const codigosNoEncontrados = [];
    for (const l of lineasValidas) {
      let info = stockMap[l.codigo];
      if (!info) {
        // No tiene stock en ese centro — se busca solo la descripción en UBICACIONES
        // para confirmar que el código existe y mostrar algo legible.
        const filas = await supabaseSelect("UBICACIONES", `material=eq.${encodeURIComponent(l.codigo)}&select=descripcion&limit=1`);
        if (!filas || filas.length === 0) {
          codigosNoEncontrados.push(l.codigo);
          continue;
        }
        info = { descripcion: filas[0].descripcion || "", unidadBase: "UN", stockDisponible: 0 };
      }
      materiales.push({
        codigo: l.codigo,
        descripcion: info.descripcion || "",
        unidad: info.unidadBase || "UN",
        cantidad: l.cantidad,
        stockDisponible: Math.round((info.stockDisponible || 0) * 100) / 100,
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
  } catch (err) {
    console.error(err);
    mostrarErrorFormulario("Error al consultar: " + err.message);
  } finally {
    bloquearFormularioPrincipal(false);
    btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Solicitar';
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

function pintarConfirmacion() {
  const wrap = document.getElementById("st-confirmacion-wrap");
  if (!wrap || !confirmacion) return;

  const filasHtml = confirmacion.materiales.map((m, idx) => `
    <tr data-idx="${idx}">
      <td>${m.codigo}</td>
      <td>${m.descripcion}</td>
      <td>${m.unidad}</td>
      <td class="conf-disponible">${m.stockDisponible}</td>
      ${confirmacion.tipo_solicitud === "nota_traslado" && confirmacion.centro_solicitado === "KACOSA"
        ? `<td>${m.enNotasKacosa}</td>` : ""}
      <td>
        <input type="number" min="0.01" step="0.01" class="input-modern conf-cantidad" style="width:90px" value="${m.cantidad}">
        <div class="conf-cantidad-error" style="display:none; color:var(--rojo-alerta); font-size:11px; margin-top:3px">Supera lo disponible</div>
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
              <th>Código</th><th>Descripción</th><th>UMB</th><th>Disponible</th>
              ${muestraNotasKacosa ? "<th>En notas Kacosa</th>" : ""}
              <th>Cantidad a pedir</th><th></th>
            </tr>
          </thead>
          <tbody>${filasHtml}</tbody>
        </table>
      </div>
      <div id="st-confirmacion-error" style="color:var(--rojo-alerta); font-size:13px; margin-top:10px; display:none">
        Hay líneas con cantidad mayor a lo disponible. Ajústalas o quítalas para poder enviar.
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
      confirmacion.materiales[idx].cantidad = Number(e.target.value);
      validarConfirmacion();
    });
  });
  wrap.querySelectorAll(".conf-quitar").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.closest("tr").dataset.idx);
      confirmacion.materiales.splice(idx, 1);
      if (confirmacion.materiales.length === 0) { confirmacion = null; wrap.innerHTML = ""; return; }
      pintarConfirmacion();
    });
  });

  document.getElementById("st-cancelar-confirmacion").addEventListener("click", () => {
    confirmacion = null;
    wrap.innerHTML = "";
  });
  document.getElementById("st-enviar").addEventListener("click", enviarSolicitud);

  validarConfirmacion();
}

/**
 * Marca en rojo las líneas donde "Cantidad a pedir" > "Disponible" y
 * deshabilita "Enviar solicitud" mientras exista al menos una. Se llama al
 * pintar la tabla y cada vez que el usuario edita una cantidad.
 */
function validarConfirmacion() {
  const wrap = document.getElementById("st-confirmacion-wrap");
  const btnEnviar = document.getElementById("st-enviar");
  const avisoGeneral = document.getElementById("st-confirmacion-error");
  if (!wrap || !confirmacion) return;

  let hayInvalidas = false;
  wrap.querySelectorAll("tr[data-idx]").forEach(fila => {
    const idx = Number(fila.dataset.idx);
    const m = confirmacion.materiales[idx];
    const invalida = !(m.cantidad > 0) || m.cantidad > m.stockDisponible;
    const inputCantidad = fila.querySelector(".conf-cantidad");
    const avisoFila = fila.querySelector(".conf-cantidad-error");
    fila.style.background = invalida ? "var(--rojo-claro)" : "";
    if (inputCantidad) inputCantidad.style.borderColor = invalida ? "var(--rojo-alerta)" : "";
    if (avisoFila) avisoFila.style.display = invalida ? "block" : "none";
    if (invalida) hayInvalidas = true;
  });

  if (btnEnviar) btnEnviar.disabled = hayInvalidas;
  if (avisoGeneral) avisoGeneral.style.display = hayInvalidas ? "block" : "none";
}

async function enviarSolicitud() {
  if (!confirmacion) return;
  const btn = document.getElementById("st-enviar");
  bloquearConfirmacion(true);
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

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
    // segundos) — la solicitud ya quedó guardada, así que el aviso por correo
    // se manda en segundo plano y no retrasa la confirmación al usuario.
    // enviarAvisoCorreo ya tiene su propio try/catch, por eso es seguro no
    // hacerle await aquí (no genera una promesa rechazada sin capturar).
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
    render();
  } catch (err) {
    console.error(err);
    notificarExito("No se pudo enviar la solicitud: " + err.message, {
      titulo: "Error", icono: '<i class="fa-solid fa-triangle-exclamation"></i>', segundos: 6
    });
    bloquearConfirmacion(false);
    if (btn) btn.innerHTML = "Enviar solicitud";
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
    const resp = await callBridge("notificarSolicitudTraslado", {
      solicitudId: solicitud.id,
      tipoSolicitud: solicitud.tipo_solicitud,
      tiendaSolicitante: nombrePorId(solicitud.tienda_solicitante),
      usuarioNombre: solicitud.usuario_nombre,
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

async function obtenerCorreosEquipo(roles) {
  try {
    const listaRoles = roles.map(r => `"${r}"`).join(",");
    const filas = await supabaseSelect("equipo_notificaciones", `select=email&activo=eq.true&rol=in.(${listaRoles})`);
    return (filas || []).map(f => f.email);
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

function htmlAccionesFila(r) {
  let html = `<button type="button" class="btn-secundario" style="padding:6px 10px; font-size:12px" data-fila-accion="ver">Ver</button>`;
  if (r.tipo_solicitud === "extra_sap" && r.estado === "aceptada" && !r.clave_usada) {
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

/** Texto + estado del código de descarga de una solicitud, para mostrar en los modales. */
function estadoClaveTexto(s) {
  if (!s.clave_descarga) return null;
  if (s.clave_usada) return { texto: "Ya fue utilizado", clase: "vencido" };
  const restante = msRestantesClave(s);
  if (restante === null) return { texto: "Vigente", clase: "" };
  if (restante <= 0) return { texto: "Expiró (duraba 5 min)", clase: "vencido" };
  return { texto: "Vence en " + formatearRestante(restante), clase: "" };
}

function htmlBloqueClave(s) {
  if (!s.clave_descarga || s.tipo_solicitud !== "extra_sap") return "";
  const estado = estadoClaveTexto(s);
  return `
    <div class="card" style="margin-top:10px; background:var(--fondo)">
      <p style="font-size:12px; color:var(--texto-secundario); margin:0 0 6px 0">Código de descarga</p>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
        <span style="font-size:20px; font-weight:800; letter-spacing:3px; color:var(--azul-base)">${s.clave_descarga}</span>
        <button type="button" class="btn-secundario btn-copiar-clave" data-copiar="${s.clave_descarga}" style="padding:6px 12px; font-size:12px"><i class="fa-solid fa-copy"></i> Copiar</button>
        <span style="font-size:12px; color:${estado.clase === "vencido" ? "var(--rojo-alerta)" : "var(--texto-secundario)"}">${estado.texto}</span>
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

function abrirModalDetalleSolicitud(s) {
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:60; display:flex; align-items:center; justify-content:center; padding:20px";
  const filasMat = (s.materiales || []).map(m => `
    <tr><td>${m.codigo}</td><td>${m.descripcion}</td><td>${m.cantidad}</td><td>${m.unidad}</td></tr>
  `).join("");
  modal.innerHTML = `
    <div style="background:var(--blanco); border-radius:var(--radio); max-width:600px; width:100%; max-height:90vh; overflow-y:auto; padding:24px">
      <h3 style="margin:0; color:var(--texto-titulo)">Solicitud #${s.id}</h3>
      <p class="vista-sub" style="margin-top:4px">
        ${s.tipo_solicitud === "extra_sap" ? "Extra SAP" : "Nota de traslado"} ·
        ${etiquetaEstado(s.estado)} · Prioridad ${s.prioridad}
      </p>
      <p style="font-size:13px; margin-top:10px">
        <strong>Centro:</strong> ${nombrePorId(s.centro_solicitado || s.centro_destino || "")}<br>
        <strong>Motivo:</strong> ${s.motivo}${s.motivo_otro ? " — " + s.motivo_otro : ""}
      </p>
      ${s.estado === "rechazada" && s.motivo_rechazo ? `<p style="font-size:13px; color:var(--rojo-alerta)"><strong>Motivo de rechazo:</strong> ${s.motivo_rechazo}</p>` : ""}
      ${s.numero_nota ? `<p style="font-size:13px"><strong>N° de nota:</strong> ${s.numero_nota}</p>` : ""}
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
      // Reclamo atómico: solo tiene éxito si clave_usada seguía en false, la
      // clave coincide, la solicitud sigue aceptada Y no pasaron los 5
      // minutos — PostgREST solo actualiza (y devuelve) la fila si el filtro
      // completo hace match, así que dos intentos simultáneos con el mismo
      // código nunca pueden "ganar" los dos, y nada se guarda ante un intento
      // con código equivocado (el UPDATE simplemente no afecta ninguna fila).
      const actualizado = await supabaseUpdate(
        "solicitudes_traslado",
        `id=eq.${s.id}&clave_descarga=eq.${encodeURIComponent(codigo)}&clave_usada=eq.false&estado=eq.aceptada&clave_generada_en=gte.${limiteVigencia}`,
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
    if (actual.estado !== "aceptada") return "Esta solicitud ya no está disponible para descarga.";
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
 *  AUTO-SINCRONIZACIÓN de "Mis solicitudes" (18-sep-2026)
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
