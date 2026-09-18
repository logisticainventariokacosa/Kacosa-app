// js/notificaciones-abastecimiento.js
// Submódulo "Notificaciones" (17-sep-2026): bandeja donde Abastecimiento
// procesa solicitudes tipo "Nota de traslado" y Directiva/Coordinador procesa
// solicitudes tipo "Extra SAP". Acceso real (para ENTRAR al submódulo) via
// ROLES_ACCESO_NOTIFICACIONES en auth.js — mientras se prueba, solo "admin".
// Dentro, qué tipo de solicitud puede aceptar/rechazar cada quien es lógica
// de negocio real (ROLES_PROCESA_NOTA_TRASLADO / ROLES_PROCESA_EXTRA_SAP), no
// cambia con lo anterior.
import { supabaseSelectTodo, supabaseUpdate, supabaseSelect } from "./supabase-client.js?v=1";
import { nombrePorId } from "./tiendas.js?v=1";
import { crearTablaPaginada } from "./tabla-utils.js";
import { notificarExito, confirmarAccion } from "./notificaciones.js";
import { callBridge } from "./bridge.js";
import {
  ROLES_ACCESO_NOTIFICACIONES,
  ROLES_PROCESA_NOTA_TRASLADO,
  ROLES_PROCESA_EXTRA_SAP
} from "./auth.js";

let tablaNotificaciones = null;
let filtroEstado = "pendiente"; // 'pendiente' | 'aceptada' | 'historial' (rechazada+procesada)
let vistaConstruida = false;

function rolActual() {
  return window.KACOSA?.usuario?.rolNormalizado
    || (window.KACOSA?.usuario?.rol || "").toString().trim().toLowerCase();
}

function usuarioTieneAcceso() {
  return ROLES_ACCESO_NOTIFICACIONES.includes(rolActual());
}

/** Tipos de solicitud que este usuario puede PROCESAR (aceptar/rechazar/marcar procesada). */
function tiposQuePuedeProcesar() {
  const rol = rolActual();
  const tipos = [];
  if (ROLES_PROCESA_NOTA_TRASLADO.includes(rol)) tipos.push("nota_traslado");
  if (ROLES_PROCESA_EXTRA_SAP.includes(rol)) tipos.push("extra_sap");
  return tipos;
}

function render() {
  const cont = document.getElementById("notificaciones-contenido");
  if (!cont) return;

  if (!window.KACOSA?.usuario) {
    cont.innerHTML = `<p class="vista-sub">Cargando información del usuario...</p>`;
    return;
  }
  if (!usuarioTieneAcceso()) {
    cont.innerHTML = `
      <div class="card"><p class="vista-sub" style="margin:0"><i class="fa-solid fa-lock"></i> Tu rol no tiene acceso a este submódulo.</p></div>`;
    return;
  }

  const tipos = tiposQuePuedeProcesar();
  if (tipos.length === 0) {
    cont.innerHTML = `
      <div class="card"><p class="vista-sub" style="margin:0"><i class="fa-solid fa-lock"></i> Tu rol no tiene solicitudes que procesar aquí.</p></div>`;
    return;
  }

  if (!vistaConstruida) {
    vistaConstruida = true;
    cont.innerHTML = `
      <div class="tienda-selector">
        <span class="label"><i class="fa-solid fa-filter"></i> Mostrar</span>
        <select id="nt-filtro-estado">
          <option value="pendiente">Pendientes</option>
          <option value="aceptada">Aceptadas (en proceso)</option>
          <option value="historial">Historial (procesadas/rechazadas)</option>
        </select>
      </div>
      <div class="card">
        <div id="nt-tabla"></div>
      </div>
    `;
    document.getElementById("nt-filtro-estado").addEventListener("change", (e) => {
      filtroEstado = e.target.value;
      cargarSolicitudes();
    });
  }
  cargarSolicitudes();
}

async function cargarSolicitudes() {
  const cont = document.getElementById("nt-tabla");
  if (!cont) return;
  const tipos = tiposQuePuedeProcesar();
  const listaTipos = tipos.map(t => `"${t}"`).join(",");

  let filtroQuery;
  if (filtroEstado === "historial") {
    filtroQuery = `estado=in.("rechazada","procesada")`;
  } else {
    filtroQuery = `estado=eq.${filtroEstado}`;
  }

  try {
    const filas = await supabaseSelectTodo(
      "solicitudes_traslado",
      `select=*&tipo_solicitud=in.(${listaTipos})&${filtroQuery}&order=creado_en.desc&limit=500`
    );

    const columnas = [
      { key: "id", label: "#" },
      { key: "creado_en", label: "Fecha", render: r => new Date(r.creado_en).toLocaleString("es-VE") },
      { key: "tipo_solicitud", label: "Tipo", render: r => r.tipo_solicitud === "extra_sap" ? "Extra SAP" : "Nota de traslado" },
      { key: "tienda_solicitante", label: "Tienda", render: r => nombrePorId(r.tienda_solicitante) },
      { key: "usuario_nombre", label: "Solicitó" },
      { key: "prioridad", label: "Prioridad" },
      { key: "estado", label: "Estado", render: r => `<span class="estado-pill estado-${r.estado}">${etiquetaEstado(r.estado)}</span>` },
      { key: "acciones", label: "", render: () => `<button type="button" class="btn-secundario" style="padding:6px 10px; font-size:12px" data-fila-accion="ver">Ver / procesar</button>` }
    ];

    if (!tablaNotificaciones) {
      tablaNotificaciones = crearTablaPaginada(cont, columnas, 20, {
        claveFila: item => item.id,
        onAccionFila: (clave, item) => abrirModalSolicitud(item)
      });
    }
    tablaNotificaciones.renderizar(filas);
  } catch (err) {
    console.error(err);
    cont.innerHTML = `<p class="vista-sub">Error al cargar: ${err.message}</p>`;
  }
}

function etiquetaEstado(estado) {
  return { pendiente: "Pendiente", aceptada: "Aceptada", rechazada: "Rechazada", procesada: "Procesada" }[estado] || estado;
}

function abrirModalSolicitud(s) {
  const rol = rolActual();
  const puedeProcesarEsteTipo = tiposQuePuedeProcesar().includes(s.tipo_solicitud);

  const filasMat = (s.materiales || []).map(m => `
    <tr>
      <td>${m.codigo}</td><td>${m.descripcion}</td><td>${m.cantidad}</td><td>${m.unidad}</td>
      <td>${m.stockDisponible ?? "—"}</td>
      ${s.tipo_solicitud === "nota_traslado" ? `<td>${m.enNotasKacosa ?? 0}</td>` : ""}
    </tr>
  `).join("");

  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:60; display:flex; align-items:center; justify-content:center; padding:20px";
  modal.innerHTML = `
    <div style="background:var(--blanco); border-radius:var(--radio); max-width:640px; width:100%; max-height:90vh; overflow-y:auto; padding:24px">
      <h3 style="margin:0; color:var(--texto-titulo)">Solicitud #${s.id} · ${s.tipo_solicitud === "extra_sap" ? "Extra SAP" : "Nota de traslado"}</h3>
      <p class="vista-sub" style="margin-top:4px">
        <span class="estado-pill estado-${s.estado}">${etiquetaEstado(s.estado)}</span> · Prioridad ${s.prioridad}
      </p>
      <p style="font-size:13px; margin-top:10px; line-height:1.7">
        <strong>Solicitado por:</strong> ${s.usuario_nombre} (${nombrePorId(s.tienda_solicitante)})<br>
        <strong>Centro:</strong> ${nombrePorId(s.centro_solicitado || s.centro_destino || "")}<br>
        <strong>Motivo:</strong> ${s.motivo}${s.motivo_otro ? " — " + s.motivo_otro : ""}
      </p>
      ${s.numero_nota ? `<p style="font-size:13px"><strong>N° de nota:</strong> ${s.numero_nota}</p>` : ""}
      ${s.estado === "rechazada" && s.motivo_rechazo ? `<p style="font-size:13px; color:var(--rojo-alerta)"><strong>Motivo de rechazo:</strong> ${s.motivo_rechazo}</p>` : ""}

      <div class="table-responsive" style="margin-top:10px">
        <table>
          <thead><tr>
            <th>Código</th><th>Descripción</th><th>Cantidad</th><th>UMB</th><th>Disponible</th>
            ${s.tipo_solicitud === "nota_traslado" ? "<th>En notas Kacosa</th>" : ""}
          </tr></thead>
          <tbody>${filasMat}</tbody>
        </table>
      </div>

      <div id="nt-modal-error" style="color:var(--rojo-alerta); font-size:13px; margin-top:12px; display:none"></div>
      <div id="nt-modal-acciones" style="margin-top:18px"></div>

      <button type="button" id="nt-cerrar" class="btn-secundario" style="margin-top:10px; width:100%">Cerrar</button>
    </div>
  `;
  document.body.appendChild(modal);
  const cerrar = () => modal.remove();
  document.getElementById("nt-cerrar").addEventListener("click", cerrar);
  modal.addEventListener("click", (e) => { if (e.target === modal) cerrar(); });

  const accionesEl = document.getElementById("nt-modal-acciones");
  if (!puedeProcesarEsteTipo) {
    // Solo lectura (ej. admin viendo algo que también puede ver otro rol, o
    // el rol correcto pero la solicitud ya no está en un estado accionable).
  } else if (s.estado === "pendiente") {
    accionesEl.innerHTML = `
      <div class="btn-group">
        <button type="button" id="nt-btn-rechazar" class="btn-sutil-peligro">Rechazar</button>
        <button type="button" id="nt-btn-aceptar" class="btn-primario">Aceptar</button>
      </div>`;
    document.getElementById("nt-btn-aceptar").addEventListener("click", () => aceptarSolicitud(s, modal));
    document.getElementById("nt-btn-rechazar").addEventListener("click", () => rechazarSolicitud(s, modal));
  } else if (s.estado === "aceptada" && s.tipo_solicitud === "nota_traslado") {
    accionesEl.innerHTML = `
      <label class="form-label">N° de nota (para marcar como procesada)</label>
      <input type="text" id="nt-numero-nota" class="input-modern" placeholder="Número de nota" style="margin-bottom:10px">
      <button type="button" id="nt-btn-procesar" class="btn-primario" style="width:100%">Marcar como procesada</button>
    `;
    document.getElementById("nt-btn-procesar").addEventListener("click", () => marcarProcesada(s, modal));
  }
}

function mostrarErrorModal(msg) {
  const el = document.getElementById("nt-modal-error");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
}

async function aceptarSolicitud(s, modal) {
  const ok = await confirmarAccion(
    s.tipo_solicitud === "extra_sap"
      ? "Al aceptar se generará una clave de un solo uso para que el gerente descargue la Nota de Traslado. ¿Continuar?"
      : "¿Aceptar esta solicitud? El gerente verá que está en proceso.",
    { titulo: "Confirmar aceptación" }
  );
  if (!ok) return;

  try {
    let cambios = {
      estado: "aceptada",
      procesado_por_email: window.KACOSA.usuario.email,
      procesado_por_nombre: window.KACOSA.usuario.nombre || window.KACOSA.usuario.email,
      procesado_en: new Date().toISOString()
    };

    if (s.tipo_solicitud === "extra_sap") {
      cambios.clave_descarga = await generarClaveUnica();
      cambios.numero_nota = await generarNumeroNota();
    }

    const actualizado = await supabaseUpdate("solicitudes_traslado", `id=eq.${s.id}`, cambios);
    const fila = actualizado[0];

    await enviarAvisoResultado(fila, "aceptada");

    notificarExito(
      s.tipo_solicitud === "extra_sap"
        ? `Solicitud aceptada. Clave de descarga: <strong>${fila.clave_descarga}</strong> (ya se intentó notificar al gerente).`
        : "Solicitud aceptada. El equipo de Abastecimiento puede procesarla y luego marcarla como procesada.",
      { titulo: "Aceptada", autoCerrar: false }
    );
    modal.remove();
    cargarSolicitudes();
  } catch (err) {
    console.error(err);
    mostrarErrorModal("No se pudo aceptar: " + err.message);
  }
}

async function rechazarSolicitud(s, modal) {
  const motivo = prompt("Motivo del rechazo:");
  if (!motivo || !motivo.trim()) return;

  try {
    const actualizado = await supabaseUpdate("solicitudes_traslado", `id=eq.${s.id}`, {
      estado: "rechazada",
      motivo_rechazo: motivo.trim(),
      procesado_por_email: window.KACOSA.usuario.email,
      procesado_por_nombre: window.KACOSA.usuario.nombre || window.KACOSA.usuario.email,
      procesado_en: new Date().toISOString()
    });
    await enviarAvisoResultado(actualizado[0], "rechazada");
    notificarExito("Solicitud rechazada.", { titulo: "Rechazada" });
    modal.remove();
    cargarSolicitudes();
  } catch (err) {
    console.error(err);
    mostrarErrorModal("No se pudo rechazar: " + err.message);
  }
}

async function marcarProcesada(s, modal) {
  const input = document.getElementById("nt-numero-nota");
  const numero = input.value.trim();
  if (!numero) { mostrarErrorModal("Ingresa el número de nota."); return; }

  try {
    const actualizado = await supabaseUpdate("solicitudes_traslado", `id=eq.${s.id}`, {
      estado: "procesada",
      numero_nota: numero,
      procesado_por_email: window.KACOSA.usuario.email,
      procesado_por_nombre: window.KACOSA.usuario.nombre || window.KACOSA.usuario.email,
      procesado_en: new Date().toISOString()
    });
    await enviarAvisoResultado(actualizado[0], "procesada");
    notificarExito("Solicitud marcada como procesada.", { titulo: "Procesada" });
    modal.remove();
    cargarSolicitudes();
  } catch (err) {
    console.error(err);
    mostrarErrorModal("No se pudo guardar: " + err.message);
  }
}

/** Genera un código alfanumérico de 6 caracteres, reintentando si ya existe (columna sin índice único estricto, pero se valida antes de guardar). */
async function generarClaveUnica() {
  const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O/0/I/1 para evitar confusión al transcribir
  for (let intento = 0; intento < 10; intento++) {
    let clave = "";
    for (let i = 0; i < 6; i++) clave += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
    const existe = await supabaseSelect("solicitudes_traslado", `select=id&clave_descarga=eq.${clave}&limit=1`);
    if (!existe || existe.length === 0) return clave;
  }
  throw new Error("No se pudo generar una clave única, intenta de nuevo.");
}

/** Correlativo NT-YYYYMMDD-### del día, reintentando ante colisión (índice único en numero_nota). */
async function generarNumeroNota() {
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, "0");
  const dd = String(hoy.getDate()).padStart(2, "0");
  const prefijo = `NT-${yyyy}${mm}${dd}-`;

  const existentes = await supabaseSelect(
    "solicitudes_traslado",
    `select=numero_nota&numero_nota=like.${prefijo}*&order=numero_nota.desc&limit=1`
  );
  let siguiente = 1;
  if (existentes && existentes.length > 0) {
    const ultimo = existentes[0].numero_nota || "";
    const n = parseInt(ultimo.slice(prefijo.length), 10);
    if (!isNaN(n)) siguiente = n + 1;
  }
  return prefijo + String(siguiente).padStart(3, "0");
}

/**
 * Avisa al gerente que hizo la solicitud (acción "notificarResultadoSolicitud"
 * en Bridge.gs, agregada el 18-sep-2026). Best-effort: si Gmail falla, el
 * cambio de estado ya quedó guardado en Supabase, solo se pierde el correo.
 */
async function enviarAvisoResultado(solicitud, resultado) {
  if (!solicitud) return;
  try {
    const resp = await callBridge("notificarResultadoSolicitud", {
      solicitudId: solicitud.id,
      resultado, // 'aceptada' | 'rechazada' | 'procesada'
      destinatario: solicitud.usuario_email,
      tipoSolicitud: solicitud.tipo_solicitud,
      numeroNota: solicitud.numero_nota || null,
      claveDescarga: solicitud.clave_descarga || null,
      motivoRechazo: solicitud.motivo_rechazo || null
    });
    if (!resp || !resp.ok) {
      console.warn("No se pudo notificar al gerente por correo:", resp && resp.error);
    }
  } catch (err) {
    console.warn("No se pudo notificar al gerente:", err.message);
  }
}

document.addEventListener("kacosa:vista-cambiada", (e) => {
  if (e.detail.vista === "vista-notificaciones") render();
});
document.addEventListener("kacosa:usuario-listo", () => {
  if (document.querySelector("#vista-notificaciones.activa")) render();
});
if (document.querySelector("#vista-notificaciones.activa") && window.KACOSA?.usuario) {
  render();
}
