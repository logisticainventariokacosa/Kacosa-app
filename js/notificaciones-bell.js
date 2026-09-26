// js/notificaciones-bell.js
// Campanita de notificaciones en el header del SHELL principal (17-sep-2026,
// ampliada a gerentes el 19-sep-2026, y de nuevo el 21-sep-2026 para que el
// gerente vea AMBAS cosas: el resultado de sus propias solicitudes Y las
// solicitudes de otros gerentes que le llegan a su tienda para procesar).
// Vive fuera de modules/abastecimiento a propósito: el header propio de
// app.html está oculto siempre que el módulo corre embebido en el shell (ver
// css/app.css de Abastecimiento), así que el único header realmente visible
// es este.
//
// OJO — por qué este archivo tiene su PROPIO cliente de Supabase en vez de
// reusar modules/abastecimiento/js/supabase-client.js: ese archivo importa
// (indirectamente, vía auth.js/firebase-config.js del módulo) initializeApp()
// de Firebase SIN nombre — igual que ya hace este shell en su propio
// ./firebase-config.js. Firebase solo permite UNA app "[DEFAULT]" por página;
// importarlo aquí también haría crashear el shell entero con "Firebase App
// named '[DEFAULT]' already exists". Por eso este archivo solo importa `auth`
// (ya inicializado) y duplica el mínimo de lógica REST necesaria.
//
// Modos según el rol:
// - Abastecimiento: cuenta Notas de traslado PENDIENTES dirigidas a Kacosa
//   (las que van a otra tienda ya no son de Abastecimiento).
// - Directiva/Coordinador: cuenta Extra SAP pendientes (sin cambios).
// - Gerente: combina dos cosas — (a) sus PROPIAS solicitudes cuyo resultado
//   todavía no vio (columna resultado_visto — ver marcarResultadosComoVistos
//   en traslados.js), y (b) Notas de traslado PENDIENTES que otros gerentes
//   le mandaron a SU tienda (columna centro_solicitado, comparada contra las
//   tiendas que tiene asignadas).
// - Admin: ve de todo un poco (no filtra por tienda).
const ROLES_CON_CAMPANITA = ["gerente", "abastecimiento", "directiva", "coordinador", "admin"];
const ROLES_PROCESA_NOTA_TRASLADO = ["abastecimiento", "admin"];
const ROLES_PROCESA_EXTRA_SAP = ["directiva", "coordinador", "admin"];

const SUPABASE_URL = "https://nlrgneggfqhmwszzbydb.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_3w3-FLBmhA3NPqwXVdm3AQ_OxTGvPix";
const INTERVALO_MS = 5000; // 5s — igual que notificaciones-abastecimiento.js

let intervaloId = null;
let dropdownAbierto = false;
let totalAnterior = null; // null = todavía no se hizo la primera consulta (no sonar en esa)
let misTiendasCache = [];

async function obtenerSesionRaiz() {
  // Se importa dinámicamente (no en el top del archivo) para no forzar a que
  // TODAS las páginas que carguen este archivo paguen el peso de este SDK
  // si no hace falta — mismo `auth` ya inicializado en el shell.
  const { auth } = await import("./firebase-config.js");
  const { getIdToken } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  if (!auth.currentUser) throw new Error("Sin sesión");
  const token = await getIdToken(auth.currentUser, false);
  return { token, email: auth.currentUser.email };
}

async function consultarSupabase(token, query) {
  const resp = await fetch(SUPABASE_URL + "/rest/v1/" + query, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + token, Prefer: "count=exact" }
  });
  if (!resp.ok) throw new Error("Error Supabase (" + resp.status + ")");
  const contentRange = resp.headers.get("content-range") || ""; // ej. "0-5/13"
  const total = Number(contentRange.split("/")[1]) || 0;
  const filas = await resp.json();
  return { total, filas };
}

async function obtenerEstado(rol, token, email) {
  if (rol === "gerente") {
    const propiosQuery = `solicitudes_traslado?select=id,tipo_solicitud,estado,creado_en` +
      `&usuario_email=eq.${encodeURIComponent(email)}&resultado_visto=eq.false&order=creado_en.desc&limit=6`;

    const tiendas = misTiendasCache;
    const porProcesarPromesa = tiendas.length === 0
      ? Promise.resolve({ total: 0, filas: [] })
      : consultarSupabase(token,
          `solicitudes_traslado?select=id,tipo_solicitud,tienda_solicitante,usuario_nombre,prioridad,creado_en` +
          `&estado=eq.pendiente&tipo_solicitud=eq.nota_traslado&centro_solicitado=in.(${tiendas.map(t => `"${t}"`).join(",")})` +
          `&order=creado_en.desc&limit=6`
        );

    const [propios, porProcesar] = await Promise.all([consultarSupabase(token, propiosQuery), porProcesarPromesa]);
    return { total: propios.total + porProcesar.total, propios, porProcesar };
  }

  const tipos = [];
  if (ROLES_PROCESA_NOTA_TRASLADO.includes(rol)) tipos.push("nota_traslado");
  if (ROLES_PROCESA_EXTRA_SAP.includes(rol)) tipos.push("extra_sap");
  if (tipos.length === 0) return { total: 0, filas: [] };

  // Abastecimiento (rol no-admin que procesa nota_traslado) solo ve las que
  // van a Kacosa — las que van a otra tienda son de ese gerente, no suyas.
  let condicion;
  if (rol === "admin") {
    condicion = `tipo_solicitud=in.(${tipos.map(t => `"${t}"`).join(",")})`;
  } else if (tipos.includes("nota_traslado")) {
    condicion = `tipo_solicitud=eq.nota_traslado&centro_solicitado=eq.KACOSA`;
  } else {
    condicion = `tipo_solicitud=eq.extra_sap`;
  }

  return consultarSupabase(token,
    `solicitudes_traslado?select=id,tipo_solicitud,tienda_solicitante,usuario_nombre,prioridad,creado_en` +
    `&estado=eq.pendiente&${condicion}&order=creado_en.desc&limit=6`
  );
}

function nombreTipo(t) {
  return t === "extra_sap" ? "Extra SAP" : "Nota de traslado";
}
function nombreEstado(e) {
  return { aceptada: "Aceptada", rechazada: "Rechazada", procesada: "Procesada" }[e] || e;
}

function filaPropia(f) {
  return `
    <div class="campanita-item px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 text-left cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800" data-destino="traslados">
      <div class="text-[13px] font-semibold text-ink dark:text-white">${nombreTipo(f.tipo_solicitud)} · #${f.id} — ${nombreEstado(f.estado)}</div>
      <div class="text-[12px] text-slate-500 dark:text-slate-400">Revisa el estado en Solicitud de Traslado</div>
    </div>`;
}
function filaPorProcesar(f) {
  return `
    <div class="campanita-item px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 text-left cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800" data-destino="notificaciones">
      <div class="text-[13px] font-semibold text-ink dark:text-white">${nombreTipo(f.tipo_solicitud)} · #${f.id}</div>
      <div class="text-[12px] text-slate-500 dark:text-slate-400">${f.tienda_solicitante} — ${f.usuario_nombre || ""} (${f.prioridad})</div>
    </div>`;
}

function activarClicsItems(dropdown) {
  dropdown.querySelectorAll(".campanita-item").forEach(el => {
    el.addEventListener("click", () => {
      cerrarDropdown();
      const abrir = el.dataset.destino === "traslados" ? window.KACOSA_abrirSolicitudTraslado : window.KACOSA_abrirNotificaciones;
      if (abrir) abrir();
    });
  });
}

function pintar(rol, estado) {
  const badge = document.getElementById("campanita-badge");
  const dropdown = document.getElementById("campanita-dropdown");
  if (!badge || !dropdown) return;

  if (estado.total > 0) {
    badge.textContent = estado.total > 9 ? "9+" : String(estado.total);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  if (rol === "gerente") {
    if (estado.total === 0) {
      dropdown.innerHTML = `<div class="px-4 py-6 text-center text-sm text-slate-400">No tienes novedades.</div>`;
      return;
    }
    let html = `<div class="max-h-80 overflow-y-auto">`;
    if (estado.porProcesar.total > 0) {
      html += `<div class="px-4 pt-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Para procesar en tu tienda</div>`;
      html += estado.porProcesar.filas.map(filaPorProcesar).join("");
    }
    if (estado.propios.total > 0) {
      html += `<div class="px-4 pt-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Tus solicitudes</div>`;
      html += estado.propios.filas.map(filaPropia).join("");
    }
    html += `</div>`;
    dropdown.innerHTML = html;
    activarClicsItems(dropdown);
    return;
  }

  if (estado.total === 0) {
    dropdown.innerHTML = `<div class="px-4 py-6 text-center text-sm text-slate-400">No hay solicitudes pendientes.</div>`;
    return;
  }
  dropdown.innerHTML = `
    <div class="max-h-72 overflow-y-auto">${estado.filas.map(filaPorProcesar).join("")}</div>
    <button id="campanita-ver-todas" class="w-full text-center text-[13px] font-semibold text-kacosa-600 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800">
      Ver todas
    </button>
  `;
  const btnVerTodas = document.getElementById("campanita-ver-todas");
  if (btnVerTodas) {
    btnVerTodas.addEventListener("click", () => {
      cerrarDropdown();
      if (window.KACOSA_abrirNotificaciones) window.KACOSA_abrirNotificaciones();
    });
  }
}

function abrirDropdown() {
  const dropdown = document.getElementById("campanita-dropdown");
  if (!dropdown) return;
  dropdown.classList.remove("hidden");
  dropdownAbierto = true;
}
function cerrarDropdown() {
  const dropdown = document.getElementById("campanita-dropdown");
  if (!dropdown) return;
  dropdown.classList.add("hidden");
  dropdownAbierto = false;
}

/**
 * Pitido corto con Web Audio API (dos tonos) — no depende de ningún archivo
 * de audio. Los navegadores bloquean sonido sin interacción previa del
 * usuario; como esto se dispara mucho después de que la persona ya entró y
 * usó la app, normalmente no hay problema, pero por si acaso todo va en
 * try/catch y si falla simplemente no suena (la campanita visual sigue
 * funcionando igual).
 */
function reproducirSonidoNotificacion() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const ahora = ctx.currentTime;
    [[880, ahora], [1175, ahora + 0.12]].forEach(([freq, inicio]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, inicio);
      gain.gain.exponentialRampToValueAtTime(0.15, inicio + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(inicio);
      osc.stop(inicio + 0.2);
    });
    setTimeout(() => ctx.close(), 500);
  } catch (err) {
    // silencioso a propósito — el sonido es un extra, no algo crítico
  }
}

async function sincronizar(rol) {
  try {
    const { token, email } = await obtenerSesionRaiz();
    const estado = await obtenerEstado(rol, token, email);
    if (totalAnterior !== null && estado.total > totalAnterior) {
      reproducirSonidoNotificacion();
    }
    totalAnterior = estado.total;
    pintar(rol, estado);
  } catch (err) {
    console.error("No se pudo actualizar la campanita de notificaciones:", err);
  }
}

/**
 * @param {string} rol
 * @param {string[]} [tiendas] - tiendas asignadas al usuario (perfil.tiendas
 *   del Portal, ya lo tiene shell.js a mano) — solo se usa para rol gerente,
 *   para saber qué solicitudes de OTROS gerentes le tocan a su tienda.
 */
export function iniciarCampanitaNotificaciones(rol, tiendas) {
  const btn = document.getElementById("btn-campanita");
  if (!btn) return;

  misTiendasCache = (tiendas || []).filter(t => t && t !== "TODAS");

  if (!ROLES_CON_CAMPANITA.includes(rol)) {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");
  totalAnterior = null;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownAbierto ? cerrarDropdown() : abrirDropdown();
  });
  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("campanita-dropdown");
    if (dropdownAbierto && dropdown && !dropdown.contains(e.target) && e.target !== btn) cerrarDropdown();
  });

  sincronizar(rol);
  if (intervaloId) clearInterval(intervaloId);
  intervaloId = setInterval(() => sincronizar(rol), INTERVALO_MS);
}

export function detenerCampanitaNotificaciones() {
  if (intervaloId) { clearInterval(intervaloId); intervaloId = null; }
  cerrarDropdown();
  totalAnterior = null;
  misTiendasCache = [];
  const badge = document.getElementById("campanita-badge");
  if (badge) badge.classList.add("hidden");
}
