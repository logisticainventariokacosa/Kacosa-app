// js/notificaciones-abastecimiento.js
// Submódulo "Notificaciones" (17-sep-2026, ajustes 18-sep-2026): bandeja donde
// Abastecimiento procesa solicitudes tipo "Nota de traslado" y Directiva/
// Coordinador procesa solicitudes tipo "Extra SAP". Acceso real (para ENTRAR
// al submódulo) via ROLES_ACCESO_NOTIFICACIONES en auth.js — mientras se
// prueba, solo "admin". Dentro, qué tipo de solicitud puede aceptar/rechazar
// cada quien es lógica de negocio real (ROLES_PROCESA_NOTA_TRASLADO /
// ROLES_PROCESA_EXTRA_SAP), no cambia con lo anterior.
import { supabaseSelectTodo, supabaseUpdate, supabaseSelect } from "./supabase-client.js?v=1";
import { nombrePorId, TIENDAS, CENTROS_KACOSA } from "./tiendas.js?v=1";
import { crearTablaPaginada } from "./tabla-utils.js";
import { notificarExito, confirmarAccion } from "./notificaciones.js";
import { callBridge } from "./bridge.js";
import {
  ROLES_ACCESO_NOTIFICACIONES,
  ROLES_PROCESA_NOTA_TRASLADO,
  ROLES_PROCESA_EXTRA_SAP
} from "./auth.js";

const DURACION_CLAVE_MS = 5 * 60 * 1000; // 5 minutos
const INTERVALO_SYNC_MS = 5000; // 5s (19-sep-2026, antes 15s) — la bandeja se refresca sola mientras está activa

let tablaNotificaciones = null;
let filtroEstado = "pendiente"; // 'pendiente' | 'aceptada' | 'historial' (rechazada+procesada)
let vistaConstruida = false;
let intervaloSync = null;

function rolActual() {
  return window.KACOSA?.usuario?.rolNormalizado
    || (window.KACOSA?.usuario?.rol || "").toString().trim().toLowerCase();
}

function usuarioTieneAcceso() {
  return ROLES_ACCESO_NOTIFICACIONES.includes(rolActual());
}

function vistaEstaActiva() {
  return !!document.querySelector("#vista-notificaciones.activa");
}

/**
 * Tipos de solicitud que este usuario puede llegar a PROCESAR aquí (nivel
 * "grueso", para saber si vale la pena mostrarle el submódulo). El permiso
 * real por solicitud puntual lo decide puedeProcesarSolicitud() más abajo,
 * porque desde el 21-sep-2026 depende también de a qué centro se le pidió
 * (una Nota de traslado a otra tienda la procesa el gerente de esa tienda,
 * no Abastecimiento — solo las que van a Kacosa siguen siendo de
 * Abastecimiento).
 */
function tiposQuePuedeProcesar() {
  const rol = rolActual();
  if (rol === "admin") return ["nota_traslado", "extra_sap"];
  if (rol === "gerente") return ["nota_traslado"];
  const tipos = [];
  if (ROLES_PROCESA_NOTA_TRASLADO.includes(rol)) tipos.push("nota_traslado");
  if (ROLES_PROCESA_EXTRA_SAP.includes(rol)) tipos.push("extra_sap");
  return tipos;
}

/** IDs de tienda asignados al usuario actual (para el caso gerente). */
function misTiendasIds() {
  return (window.KACOSA?.tiendas || []).filter(t => t && t !== "TODAS");
}

/**
 * ¿Puede ESTE usuario aceptar/rechazar/procesar ESTA solicitud puntual?
 * (21-sep-2026) Nota de traslado a Kacosa → Abastecimiento; Nota de
 * traslado a otra tienda (incluye Ferretools) → el/los gerente(s) de esa
 * tienda; Extra SAP → Directiva/Coordinador, sin cambios.
 */
function puedeProcesarSolicitud(s) {
  const rol = rolActual();
  if (rol === "admin") return true;
  if (s.tipo_solicitud === "extra_sap") return ROLES_PROCESA_EXTRA_SAP.includes(rol);
  if (s.centro_solicitado === "KACOSA") return ROLES_PROCESA_NOTA_TRASLADO.includes(rol);
  if (rol === "gerente") return misTiendasIds().includes(s.centro_solicitado);
  return false;
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
    tablaNotificaciones = null; // ver el mismo comentario en traslados.js: evita apuntar a un nodo ya destruido
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
  iniciarSyncAutomatico();
}

async function cargarSolicitudes() {
  const cont = document.getElementById("nt-tabla");
  if (!cont) return;
  const rol = rolActual();

  let filtroQuery;
  if (filtroEstado === "historial") {
    filtroQuery = `estado=in.("rechazada","procesada")`;
  } else {
    filtroQuery = `estado=eq.${filtroEstado}`;
  }

  // (21-sep-2026) El "ámbito" de qué solicitudes trae la consulta ya no es
  // solo por tipo — Abastecimiento solo ve Nota de traslado CUANDO el
  // centro solicitado es Kacosa; las que van a otra tienda son del gerente
  // de esa tienda, no de Abastecimiento. Admin sigue viendo todo.
  let condicionAmbito;
  if (rol === "admin") {
    condicionAmbito = "";
  } else if (rol === "gerente") {
    const tiendas = misTiendasIds();
    if (tiendas.length === 0) {
      cont.innerHTML = `<p class="vista-sub">No tienes ninguna tienda asignada.</p>`;
      return;
    }
    const listaTiendas = tiendas.map(t => `"${t}"`).join(",");
    condicionAmbito = `&tipo_solicitud=eq.nota_traslado&centro_solicitado=in.(${listaTiendas})`;
  } else {
    const procesaNota = ROLES_PROCESA_NOTA_TRASLADO.includes(rol);
    const procesaExtraSap = ROLES_PROCESA_EXTRA_SAP.includes(rol);
    if (procesaNota && procesaExtraSap) {
      condicionAmbito = `&or=(and(tipo_solicitud.eq.nota_traslado,centro_solicitado.eq.KACOSA),tipo_solicitud.eq.extra_sap)`;
    } else if (procesaNota) {
      condicionAmbito = `&tipo_solicitud=eq.nota_traslado&centro_solicitado=eq.KACOSA`;
    } else if (procesaExtraSap) {
      condicionAmbito = `&tipo_solicitud=eq.extra_sap`;
    } else {
      cont.innerHTML = `<p class="vista-sub">Tu rol no tiene solicitudes que procesar aquí.</p>`;
      return;
    }
  }

  try {
    const filas = await supabaseSelectTodo(
      "solicitudes_traslado",
      `select=*&${filtroQuery}${condicionAmbito}&order=creado_en.desc&limit=500`
    );

    const columnas = [
      { key: "id", label: "#" },
      { key: "creado_en", label: "Fecha", render: r => new Date(r.creado_en).toLocaleString("es-VE") },
      { key: "fecha_procesado", label: "Fecha de procesado", render: r => r.fecha_procesado ? new Date(r.fecha_procesado).toLocaleString("es-VE") : "—" },
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

/** Código(s) SAP de un centro/tienda — Kacosa son 2 centros (1000/3000) a la vez. Mismo helper que en traslados.js. */
function codigoCentroTexto(idCentro) {
  if (idCentro === "KACOSA") return CENTROS_KACOSA.join("/");
  const t = TIENDAS.find(x => x.id === idCentro);
  return (t && t.centro) || idCentro || "";
}

function abrirModalSolicitud(s) {
  const puedeProcesarEsteTipo = puedeProcesarSolicitud(s);
  // Solo Abastecimiento, revisando una Nota de traslado ya aceptada (para
  // marcarla procesada), puede editar las cantidades línea por línea — ver
  // marcarProcesada() para el pedido de motivo cuando algo cambió.
  const modoEdicion = puedeProcesarEsteTipo && s.estado === "aceptada" && s.tipo_solicitud === "nota_traslado";

  const filasMat = (s.materiales || []).map((m, idx) => {
    if (m.sinCodigoSap || !m.codigo) {
      const celdaCantidad = modoEdicion
        ? `<input type="text" inputmode="decimal" class="input-modern nt-cant-edit" data-idx="${idx}" data-original="${m.cantidad}" value="${m.cantidad}" style="width:80px">`
        : m.cantidad;
      return `<tr><td colspan="2"><em>Sin código SAP:</em> ${m.descripcion}</td><td>${celdaCantidad}</td><td>${m.unidad || "N/A"}</td><td>—</td><td>—</td>${s.tipo_solicitud === "nota_traslado" ? "<td>—</td>" : ""}</tr>`;
    }
    const celdaCantidad = modoEdicion
      ? `<input type="text" inputmode="decimal" class="input-modern nt-cant-edit" data-idx="${idx}" data-original="${m.cantidad}" value="${m.cantidad}" style="width:80px">`
      : m.cantidad;
    return `
    <tr>
      <td>${m.codigo}</td><td>${m.descripcion}</td><td>${celdaCantidad}</td><td>${m.unidad}</td>
      <td>${m.stockCentroSolicitante ?? "—"}</td>
      <td>${m.stockCentroSolicitado ?? "—"}</td>
      ${s.tipo_solicitud === "nota_traslado" ? `<td>${m.enNotasKacosa ?? 0}</td>` : ""}
    </tr>
  `;
  }).join("");

  const codigosDisponibles = (s.materiales || []).filter(m => m.codigo).map(m => m.codigo);

  const etqSolicitante = `Disp. (${codigoCentroTexto(s.tienda_solicitante)})`;
  const etqSolicitado = `Disp. (${codigoCentroTexto(s.centro_solicitado || s.centro_destino)})`;

  const estadoClave = estadoClaveTexto(s);
  const bloqueClave = s.clave_descarga ? `
    <div class="card" style="margin-top:10px; background:var(--fondo)">
      <p style="font-size:12px; color:var(--texto-secundario); margin:0 0 6px 0">Código de descarga generado</p>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
        <span class="codigo-chip">${s.clave_descarga}</span>
        <button type="button" class="btn-secundario btn-copiar-clave" data-copiar="${s.clave_descarga}" style="padding:6px 12px; font-size:12px"><i class="fa-solid fa-copy"></i> Copiar</button>
        <span style="font-size:12px; color:${estadoClave.vencido ? "var(--rojo-alerta)" : "var(--texto-secundario)"}">${estadoClave.texto}</span>
      </div>
      ${puedeProcesarEsteTipo && !s.clave_usada ? `<button type="button" id="nt-btn-regenerar" class="btn-secundario" style="margin-top:10px; width:100%"><i class="fa-solid fa-rotate"></i> Generar un código nuevo</button>` : ""}
    </div>
  ` : "";

  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:60; display:flex; align-items:center; justify-content:center; padding:20px";
  modal.innerHTML = `
    <div style="background:var(--blanco); border-radius:var(--radio); max-width:680px; width:100%; max-height:90vh; overflow-y:auto; padding:24px">
      <h3 style="margin:0; color:var(--texto-titulo)">Solicitud #${s.id} · ${s.tipo_solicitud === "extra_sap" ? "Extra SAP" : "Nota de traslado"}</h3>
      <p class="vista-sub" style="margin-top:4px">
        <span class="estado-pill estado-${s.estado}">${etiquetaEstado(s.estado)}</span> · Prioridad ${s.prioridad}
      </p>
      <p style="font-size:13px; margin-top:10px; line-height:1.7">
        <strong>Solicitado por:</strong> ${s.usuario_nombre} (${s.usuario_email || ""}) — ${nombrePorId(s.tienda_solicitante)}<br>
        <strong>${s.tipo_solicitud === "extra_sap" ? "Centro destino" : "Centro solicitado"}:</strong> ${nombrePorId(s.centro_solicitado || s.centro_destino || "")}<br>
        <strong>Motivo:</strong> ${s.motivo}${s.motivo_otro ? " — " + s.motivo_otro : ""}
      </p>
      ${s.numero_nota ? `<p style="font-size:13px"><strong>N° de nota:</strong> ${s.numero_nota} <button type="button" class="btn-secundario btn-copiar-clave" data-copiar="${s.numero_nota}" style="padding:2px 8px; font-size:11px; margin-left:6px; vertical-align:middle"><i class="fa-solid fa-copy"></i></button></p>` : ""}
      ${s.estado === "rechazada" && s.motivo_rechazo ? `<p style="font-size:13px; color:var(--rojo-alerta)"><strong>Motivo de rechazo:</strong> ${s.motivo_rechazo}</p>` : ""}
      ${s.motivo_edicion ? `<p style="font-size:13px; color:var(--ambar-oscuro)"><strong>Motivo de la edición de cantidades:</strong> ${s.motivo_edicion}</p>` : ""}
      ${s.procesado_por_nombre ? `<p style="font-size:13px; color:var(--texto-secundario)"><strong>Procesado por:</strong> ${s.procesado_por_nombre} (${s.procesado_por_email || ""})</p>` : ""}
      ${bloqueClave}

      ${codigosDisponibles.length > 0 ? `
        <button type="button" class="btn-secundario btn-copiar-clave" data-copiar="${codigosDisponibles.join('\n')}" style="margin-top:10px; font-size:12px; padding:6px 12px"><i class="fa-solid fa-copy"></i> Copiar todos los códigos</button>
      ` : ""}

      <div class="table-responsive" style="margin-top:10px">
        <table>
          <thead><tr>
            <th>Código</th><th>Descripción</th><th>Cantidad</th><th>UMB</th><th>${etqSolicitante}</th><th>${etqSolicitado}</th>
            ${s.tipo_solicitud === "nota_traslado" ? "<th>En notas Kacosa</th>" : ""}
          </tr></thead>
          <tbody>${filasMat}</tbody>
        </table>
      </div>
      ${modoEdicion ? `<p style="font-size:11.5px; color:var(--texto-claro); margin-top:6px">Puedes ajustar cantidades (incluso a 0) si el stock cambió. Se te pedirá un motivo antes de guardar.</p>` : ""}

      <div id="nt-modal-error" style="color:var(--rojo-alerta); font-size:13px; margin-top:12px; display:none"></div>
      <div id="nt-modal-acciones" style="margin-top:18px"></div>

      <button type="button" id="nt-cerrar" class="btn-secundario" style="margin-top:10px; width:100%">Cerrar</button>
    </div>
  `;
  document.body.appendChild(modal);
  const cerrar = () => modal.remove();
  document.getElementById("nt-cerrar").addEventListener("click", cerrar);
  modal.addEventListener("click", (e) => { if (e.target === modal) cerrar(); });
  activarBotonesCopiar(modal);

  const btnRegenerar = document.getElementById("nt-btn-regenerar");
  if (btnRegenerar) btnRegenerar.addEventListener("click", () => regenerarClave(s, modal));

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
    const btnAceptar = document.getElementById("nt-btn-aceptar");
    const btnRechazar = document.getElementById("nt-btn-rechazar");
    btnAceptar.addEventListener("click", () => {
      // Se deshabilitan los DOS botones de inmediato (antes del diálogo de
      // confirmación) para que un doble clic no pueda disparar dos veces el
      // "Aceptar" y generar dos códigos distintos para la misma solicitud.
      btnAceptar.disabled = true;
      btnRechazar.disabled = true;
      aceptarSolicitud(s, modal, () => { btnAceptar.disabled = false; btnRechazar.disabled = false; });
    });
    btnRechazar.addEventListener("click", () => {
      btnAceptar.disabled = true;
      btnRechazar.disabled = true;
      rechazarSolicitud(s, modal, () => { btnAceptar.disabled = false; btnRechazar.disabled = false; });
    });
  } else if (modoEdicion) {
    accionesEl.innerHTML = `
      <label class="form-label">N° de nota (para marcar como procesada)</label>
      <input type="text" id="nt-numero-nota" class="input-modern" placeholder="Número de nota" style="margin-bottom:10px">
      <button type="button" id="nt-btn-procesar" class="btn-primario" style="width:100%">Marcar como procesada</button>
      <button type="button" id="nt-btn-cancelar-solicitud" class="btn-sutil-peligro" style="width:100%; margin-top:10px">Cancelar solicitud</button>
    `;
    document.getElementById("nt-btn-procesar").addEventListener("click", () => marcarProcesada(s, modal));
    document.getElementById("nt-btn-cancelar-solicitud").addEventListener("click", () => cancelarSolicitudAceptada(s, modal));
  }
}

function mostrarErrorModal(msg) {
  const el = document.getElementById("nt-modal-error");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
}

/**
 * Traduce errores técnicos de Supabase a algo que tenga sentido leer. Por
 * ahora solo cubre el caso del número de nota repetido (20-sep-2026);
 * devuelve null si no reconoce el error, para que cada quien use su propio
 * mensaje genérico de respaldo.
 */
function mensajeErrorAmigable(err) {
  const texto = (err && err.message) || String(err);
  if (texto.includes("23505") && texto.includes("uq_solicitudes_traslado_numero_nota")) {
    return "El número de nota que intentas registrar ya existe en la base de datos. Por favor revisa y verifica que sea el número de nota correcto.";
  }
  return null;
}

/**
 * Modal de texto con el estilo de la página, para reemplazar prompt()
 * (19-sep-2026 — el diálogo nativo del navegador no tenía nada que ver con
 * el resto de la app). Devuelve el texto ingresado, o null si se canceló o
 * se dejó vacío.
 */
function pedirTexto({ titulo, mensaje, placeholder = "", obligatorio = true }) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:80; display:flex; align-items:center; justify-content:center; padding:20px";
    modal.innerHTML = `
      <div style="background:var(--blanco); border-radius:var(--radio); max-width:420px; width:100%; padding:24px">
        <h3 style="margin:0; color:var(--texto-titulo)">${titulo}</h3>
        ${mensaje ? `<p class="vista-sub" style="margin-top:6px">${mensaje}</p>` : ""}
        <textarea id="pt-input" class="input-modern" rows="3" style="margin-top:10px; resize:vertical" placeholder="${placeholder}"></textarea>
        <div id="pt-error" style="color:var(--rojo-alerta); font-size:12px; margin-top:6px; display:none">Este campo es obligatorio.</div>
        <div class="btn-group" style="margin-top:16px">
          <button type="button" id="pt-cancelar" class="btn-secundario">Cancelar</button>
          <button type="button" id="pt-aceptar" class="btn-primario">Aceptar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const input = document.getElementById("pt-input");
    input.focus();

    const cerrar = (valor) => { modal.remove(); resolve(valor); };
    document.getElementById("pt-cancelar").addEventListener("click", () => cerrar(null));
    modal.addEventListener("click", (e) => { if (e.target === modal) cerrar(null); });
    document.getElementById("pt-aceptar").addEventListener("click", () => {
      const texto = input.value.trim();
      if (obligatorio && !texto) {
        document.getElementById("pt-error").style.display = "block";
        return;
      }
      cerrar(texto);
    });
  });
}

async function aceptarSolicitud(s, modal, reactivarBotones) {
  const ok = await confirmarAccion(
    s.tipo_solicitud === "extra_sap"
      ? "Al aceptar se generará una clave de un solo uso (vence en 5 minutos) para que el gerente descargue la Nota de Traslado, y la solicitud pasará directo a \"Procesada\". ¿Continuar?"
      : "¿Aceptar esta solicitud? El gerente verá que está en proceso.",
    { titulo: "Confirmar aceptación" }
  );
  if (!ok) { reactivarBotones(); return; }

  try {
    let cambios = {
      estado: "aceptada",
      resultado_visto: false,
      procesado_por_email: window.KACOSA.usuario.email,
      procesado_por_nombre: window.KACOSA.usuario.nombre || window.KACOSA.usuario.email,
      procesado_en: new Date().toISOString()
    };
    if (s.tipo_solicitud === "extra_sap") {
      // Extra SAP no tiene un paso manual de "marcar procesada" aparte (eso
      // es solo para nota_traslado, donde Abastecimiento anota el número de
      // nota después) — aceptar y generar el código YA es el paso final,
      // así que pasa directo a "procesada" (19-sep-2026, antes se quedaba
      // en "aceptada" esperando algo que nunca llegaba).
      cambios.estado = "procesada";
      cambios.fecha_procesado = new Date().toISOString(); // aquí SÍ es el paso final — ver nota_traslado más abajo, que no lo pone hasta marcarProcesada()
      cambios.clave_descarga = await generarClaveUnica();
      cambios.clave_generada_en = new Date().toISOString();
      cambios.numero_nota = await generarNumeroNota();
    }

    // Reclamo atómico: el UPDATE solo afecta la fila si TODAVÍA está
    // "pendiente". Si dos clics (o dos usuarios) llegan aquí casi a la vez,
    // el segundo simplemente no encuentra ninguna fila que actualizar (ya no
    // está pendiente) — así nunca se generan dos códigos para la misma
    // solicitud, sin necesidad de un lock del lado del servidor.
    const actualizado = await supabaseUpdate("solicitudes_traslado", `id=eq.${s.id}&estado=eq.pendiente`, cambios);
    if (!actualizado || actualizado.length === 0) {
      mostrarErrorModal("Esta solicitud ya fue procesada (por ti o por otra persona) — se refrescó la lista.");
      cargarSolicitudes();
      return;
    }
    const fila = actualizado[0];

    // No se espera la respuesta del correo (puede tardar varios segundos en
    // Apps Script) — el cambio de estado ya quedó guardado, así que se avisa
    // en segundo plano. enviarAvisoResultado ya tiene su propio try/catch.
    enviarAvisoResultado(fila, fila.estado);

    if (s.tipo_solicitud === "extra_sap") {
      mostrarCodigoGenerado(fila.clave_descarga);
    } else {
      notificarExito("Solicitud aceptada. El equipo de Abastecimiento puede procesarla y luego marcarla como procesada.", { titulo: "Aceptada" });
    }
    modal.remove();
    cargarSolicitudes();
  } catch (err) {
    console.error(err);
    mostrarErrorModal(mensajeErrorAmigable(err) || "No se pudo aceptar: " + err.message);
    reactivarBotones();
  }
}

/** Modal grande con el código recién generado y un botón de copiar (18-sep-2026). */
function mostrarCodigoGenerado(clave) {
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:70; display:flex; align-items:center; justify-content:center; padding:20px";
  modal.innerHTML = `
    <div style="background:var(--blanco); border-radius:var(--radio); max-width:380px; width:100%; padding:24px; text-align:center">
      <i class="fa-solid fa-circle-check" style="font-size:32px; color:var(--verde-kpi)"></i>
      <h3 style="margin:10px 0 4px 0; color:var(--texto-titulo)">Solicitud aceptada</h3>
      <p class="vista-sub" style="margin-bottom:14px">Código de descarga (un solo uso, vence en 5 minutos):</p>
      <div style="margin-bottom:14px"><span class="codigo-chip codigo-chip-grande">${clave}</span></div>
      <button type="button" class="btn-secundario btn-copiar-clave" data-copiar="${clave}" style="width:100%; margin-bottom:10px"><i class="fa-solid fa-copy"></i> Copiar código</button>
      <button type="button" id="nt-cerrar-codigo" class="btn-primario" style="width:100%">Listo</button>
    </div>
  `;
  document.body.appendChild(modal);
  activarBotonesCopiar(modal);
  document.getElementById("nt-cerrar-codigo").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

async function regenerarClave(s, modal) {
  const ok = await confirmarAccion("Se invalidará el código anterior y se generará uno nuevo, válido por 5 minutos. ¿Continuar?", { titulo: "Generar código nuevo" });
  if (!ok) return;
  try {
    const nuevaClave = await generarClaveUnica();
    const actualizado = await supabaseUpdate(
      "solicitudes_traslado",
      `id=eq.${s.id}&estado=eq.procesada&clave_usada=eq.false`,
      { clave_descarga: nuevaClave, clave_generada_en: new Date().toISOString() }
    );
    if (!actualizado || actualizado.length === 0) {
      mostrarErrorModal("No se pudo regenerar (puede que el código ya se haya usado).");
      return;
    }
    enviarAvisoResultado(actualizado[0], "procesada");
    modal.remove();
    mostrarCodigoGenerado(nuevaClave);
    cargarSolicitudes();
  } catch (err) {
    console.error(err);
    mostrarErrorModal("No se pudo regenerar: " + err.message);
  }
}

async function rechazarSolicitud(s, modal, reactivarBotones) {
  const motivo = await pedirTexto({ titulo: "Motivo del rechazo", placeholder: "Explica por qué se rechaza..." });
  if (!motivo) { reactivarBotones(); return; }

  try {
    const actualizado = await supabaseUpdate("solicitudes_traslado", `id=eq.${s.id}&estado=eq.pendiente`, {
      estado: "rechazada",
      resultado_visto: false,
      motivo_rechazo: motivo,
      fecha_procesado: new Date().toISOString(),
      procesado_por_email: window.KACOSA.usuario.email,
      procesado_por_nombre: window.KACOSA.usuario.nombre || window.KACOSA.usuario.email,
      procesado_en: new Date().toISOString()
    });
    if (!actualizado || actualizado.length === 0) {
      mostrarErrorModal("Esta solicitud ya fue procesada — se refrescó la lista.");
      cargarSolicitudes();
      return;
    }
    enviarAvisoResultado(actualizado[0], "rechazada");
    notificarExito("Solicitud rechazada.", { titulo: "Rechazada" });
    modal.remove();
    cargarSolicitudes();
  } catch (err) {
    console.error(err);
    mostrarErrorModal("No se pudo rechazar: " + err.message);
    reactivarBotones();
  }
}

/**
 * Cancela una solicitud de Nota de traslado que YA se había aceptado (por
 * ejemplo, si al ir a procesarla resulta que ya no se puede ceder nada de lo
 * pedido). Funciona igual que un rechazo, pero partiendo de "aceptada" en
 * vez de "pendiente" (19-sep-2026).
 */
async function cancelarSolicitudAceptada(s, modal) {
  const motivo = await pedirTexto({
    titulo: "Cancelar solicitud",
    mensaje: "Esto la deja como rechazada — úsalo si ya no se puede procesar nada de lo pedido.",
    placeholder: "Motivo de la cancelación..."
  });
  if (!motivo) return;

  try {
    const actualizado = await supabaseUpdate("solicitudes_traslado", `id=eq.${s.id}&estado=eq.aceptada`, {
      estado: "rechazada",
      resultado_visto: false,
      motivo_rechazo: motivo,
      fecha_procesado: new Date().toISOString(),
      procesado_por_email: window.KACOSA.usuario.email,
      procesado_por_nombre: window.KACOSA.usuario.nombre || window.KACOSA.usuario.email,
      procesado_en: new Date().toISOString()
    });
    if (!actualizado || actualizado.length === 0) {
      mostrarErrorModal("Esta solicitud ya fue actualizada por otra persona — se refrescó la lista.");
      cargarSolicitudes();
      return;
    }
    enviarAvisoResultado(actualizado[0], "rechazada");
    notificarExito("Solicitud cancelada.", { titulo: "Cancelada" });
    modal.remove();
    cargarSolicitudes();
  } catch (err) {
    console.error(err);
    mostrarErrorModal("No se pudo cancelar: " + err.message);
  }
}

const CANTIDAD_REGEX_NT = /^\d{1,5}(\.\d{1,3})?$/; // hasta 5 enteros, 3 decimales — igual que en traslados.js, incluye el 0

async function marcarProcesada(s, modal) {
  const input = document.getElementById("nt-numero-nota");
  const btn = document.getElementById("nt-btn-procesar");
  const numero = input.value.trim();
  if (!numero) { mostrarErrorModal("Ingresa el número de nota."); return; }

  // Cantidades editadas (si el usuario las tocó) — se valida formato y se
  // detecta si algo realmente cambió respecto al valor original.
  const materialesActualizados = (s.materiales || []).map(m => ({ ...m }));
  let huboCambios = false;
  const inputsCantidad = modal.querySelectorAll(".nt-cant-edit");
  for (const inp of inputsCantidad) {
    const idx = Number(inp.dataset.idx);
    const valor = inp.value.trim();
    if (!CANTIDAD_REGEX_NT.test(valor)) {
      mostrarErrorModal(`La cantidad de "${materialesActualizados[idx]?.codigo || materialesActualizados[idx]?.descripcion}" no es válida (hasta 5 enteros y 3 decimales, puede ser 0).`);
      return;
    }
    const nuevoValor = Number(valor);
    if (nuevoValor !== Number(inp.dataset.original)) huboCambios = true;
    materialesActualizados[idx].cantidad = nuevoValor;
  }

  let motivoEdicion = null;
  if (huboCambios) {
    motivoEdicion = await pedirTexto({
      titulo: "Motivo de la modificación",
      mensaje: "Cambiaste una o más cantidades respecto a lo solicitado. Explica por qué (ej. cambio de stock disponible).",
      placeholder: "Motivo..."
    });
    if (!motivoEdicion) return; // canceló — no se guarda nada
  }

  input.disabled = true;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
  try {
    const cambios = {
      estado: "procesada",
      resultado_visto: false,
      numero_nota: numero,
      fecha_procesado: new Date().toISOString(),
      procesado_por_email: window.KACOSA.usuario.email,
      procesado_por_nombre: window.KACOSA.usuario.nombre || window.KACOSA.usuario.email,
      procesado_en: new Date().toISOString()
    };
    if (huboCambios) {
      cambios.materiales = materialesActualizados;
      cambios.motivo_edicion = motivoEdicion;
    }
    const actualizado = await supabaseUpdate("solicitudes_traslado", `id=eq.${s.id}&estado=eq.aceptada`, cambios);
    if (!actualizado || actualizado.length === 0) {
      mostrarErrorModal("Esta solicitud ya fue actualizada por otra persona — se refrescó la lista.");
      cargarSolicitudes();
      return;
    }
    enviarAvisoResultado(actualizado[0], "procesada");
    notificarExito("Solicitud marcada como procesada.", { titulo: "Procesada" });
    modal.remove();
    cargarSolicitudes();
  } catch (err) {
    console.error(err);
    mostrarErrorModal(mensajeErrorAmigable(err) || "No se pudo guardar: " + err.message);
    input.disabled = false;
    btn.disabled = false;
    btn.textContent = "Marcar como procesada";
  }
}

/** Genera un código alfanumérico de 6 caracteres, reintentando si ya existe. */
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
 * en Bridge.gs). Best-effort: si Gmail falla, el cambio de estado ya quedó
 * guardado en Supabase, solo se pierde el correo. Se llama SIN await desde
 * los flujos de aceptar/rechazar/procesar para no demorar la respuesta al
 * usuario con el tiempo de Apps Script.
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
      motivoRechazo: solicitud.motivo_rechazo || null,
      motivoEdicion: solicitud.motivo_edicion || null,
      procesadoPorNombre: solicitud.procesado_por_nombre || null,
      procesadoPorEmail: solicitud.procesado_por_email || null
    });
    if (!resp || !resp.ok) {
      console.warn("No se pudo notificar al gerente por correo:", resp && resp.error);
    }
  } catch (err) {
    console.warn("No se pudo notificar al gerente:", err.message);
  }
}

/* =========================================================
 *  AUTO-SINCRONIZACIÓN (18-sep-2026) — mismo patrón que
 *  resumen-directiva.js / traslados.js: mientras la vista está
 *  activa, se refresca sola cada INTERVALO_SYNC_MS para que las
 *  solicitudes nuevas aparezcan sin recargar la página.
 * ========================================================= */
function iniciarSyncAutomatico() {
  if (intervaloSync) return;
  intervaloSync = setInterval(() => {
    if (document.hidden || !vistaEstaActiva()) return;
    cargarSolicitudes();
  }, INTERVALO_SYNC_MS);
}
function detenerSyncAutomatico() {
  if (intervaloSync) { clearInterval(intervaloSync); intervaloSync = null; }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && vistaEstaActiva() && vistaConstruida) cargarSolicitudes();
});

document.addEventListener("kacosa:vista-cambiada", (e) => {
  if (e.detail.vista === "vista-notificaciones") render();
  else detenerSyncAutomatico();
});
document.addEventListener("kacosa:usuario-listo", () => {
  vistaConstruida = false;
  detenerSyncAutomatico();
  if (vistaEstaActiva()) render();
});
if (document.querySelector("#vista-notificaciones.activa") && window.KACOSA?.usuario) {
  render();
}
