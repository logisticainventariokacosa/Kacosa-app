// js/notificaciones-bell.js
// Campanita de notificaciones en el header del SHELL principal (17-sep-2026).
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
// Abierto a producción el 19-sep-2026 — debe quedar igual a
// ROLES_ACCESO_NOTIFICACIONES en modules/abastecimiento/js/auth.js.
const ROLES_CON_CAMPANITA = ["abastecimiento", "directiva", "coordinador", "admin"];
const ROLES_PROCESA_NOTA_TRASLADO = ["abastecimiento", "admin"];
const ROLES_PROCESA_EXTRA_SAP = ["directiva", "coordinador", "admin"];

const SUPABASE_URL = "https://nlrgneggfqhmwszzbydb.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_3w3-FLBmhA3NPqwXVdm3AQ_OxTGvPix";
const INTERVALO_MS = 5000; // 5s (19-sep-2026, antes 1 min) — igual que notificaciones-abastecimiento.js, para que el contador no se quede atrás

let intervaloId = null;
let dropdownAbierto = false;

function tiposQuePuedeVer(rol) {
  const tipos = [];
  if (ROLES_PROCESA_NOTA_TRASLADO.includes(rol)) tipos.push("nota_traslado");
  if (ROLES_PROCESA_EXTRA_SAP.includes(rol)) tipos.push("extra_sap");
  return tipos;
}

async function obtenerIdTokenRaiz() {
  // Se importa dinámicamente (no en el top del archivo) para no forzar a que
  // TODAS las páginas que carguen este archivo paguen el peso de este SDK
  // si no hace falta — mismo `auth` ya inicializado en el shell.
  const { auth } = await import("./firebase-config.js");
  const { getIdToken } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  if (!auth.currentUser) throw new Error("Sin sesión");
  return getIdToken(auth.currentUser, false);
}

async function obtenerPendientes(rol) {
  const tipos = tiposQuePuedeVer(rol);
  if (tipos.length === 0) return { total: 0, filas: [] };

  const token = await obtenerIdTokenRaiz();
  const listaTipos = tipos.map(t => `"${t}"`).join(",");
  const query = `solicitudes_traslado?select=id,tipo_solicitud,tienda_solicitante,usuario_nombre,prioridad,creado_en&estado=eq.pendiente&tipo_solicitud=in.(${listaTipos})&order=creado_en.desc&limit=6`;

  const resp = await fetch(SUPABASE_URL + "/rest/v1/" + query, {
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: "Bearer " + token,
      Prefer: "count=exact"
    }
  });
  if (!resp.ok) throw new Error("Error Supabase (" + resp.status + ")");

  const contentRange = resp.headers.get("content-range") || ""; // ej. "0-5/13"
  const total = Number(contentRange.split("/")[1]) || 0;
  const filas = await resp.json();
  return { total, filas };
}

function nombreTipo(t) {
  return t === "extra_sap" ? "Extra SAP" : "Nota de traslado";
}

function pintar(estado) {
  const badge = document.getElementById("campanita-badge");
  const dropdown = document.getElementById("campanita-dropdown");
  if (!badge || !dropdown) return;

  if (estado.total > 0) {
    badge.textContent = estado.total > 9 ? "9+" : String(estado.total);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  if (estado.total === 0) {
    dropdown.innerHTML = `<div class="px-4 py-6 text-center text-sm text-slate-400">No hay solicitudes pendientes.</div>`;
    return;
  }

  const filasHtml = estado.filas.map(f => `
    <div class="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 text-left">
      <div class="text-[13px] font-semibold text-ink dark:text-white">${nombreTipo(f.tipo_solicitud)} · #${f.id}</div>
      <div class="text-[12px] text-slate-500 dark:text-slate-400">${f.tienda_solicitante} — ${f.usuario_nombre || ""} (${f.prioridad})</div>
    </div>
  `).join("");

  dropdown.innerHTML = `
    <div class="max-h-72 overflow-y-auto">${filasHtml}</div>
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

async function sincronizar(rol) {
  try {
    const estado = await obtenerPendientes(rol);
    pintar(estado);
  } catch (err) {
    console.error("No se pudo actualizar la campanita de notificaciones:", err);
  }
}

export function iniciarCampanitaNotificaciones(rol) {
  const btn = document.getElementById("btn-campanita");
  if (!btn) return;

  if (!ROLES_CON_CAMPANITA.includes(rol)) {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");

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
  const badge = document.getElementById("campanita-badge");
  if (badge) badge.classList.add("hidden");
}
