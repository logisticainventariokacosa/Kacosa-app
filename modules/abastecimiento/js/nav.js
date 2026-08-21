// js/nav.js
import { auth } from "./firebase-config.js?v=2";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { protegerPagina, cerrarSesion, obtenerPerfilPortal, ROLES_PERMITIDOS_ABASTECIMIENTO, ROLES_CON_ACCESO_A_TODAS_LAS_TIENDAS } from "./auth.js";
import { nombrePorId } from "./tiendas.js";
import { mostrarLoader, ocultarLoader } from "./loader.js";

mostrarLoader("Verificando sesión...");

// Estado global simple de la app (accesible desde otros módulos vía window.KACOSA)
window.KACOSA = {
  usuario: null,
  tiendas: [],       // array de IDs de tienda que puede ver el usuario, o ["TODAS"]
  tiendaActiva: null  // tienda actualmente seleccionada en el dashboard
};

protegerPagina();

// Espera a que se confirme la sesión para cargar el perfil del usuario (rol y tienda)
onAuthStateChanged(auth, async (user) => {
  if (!user) return; // protegerPagina() ya se encarga de redirigir al login

  const perfil = await obtenerPerfilPortal(user.email);
  const rol = perfil?.rol || null;
  const nombre = perfil?.nombre || user.displayName || user.email || "";

  // GERENTE ve solo su(s) tienda(s) asignada(s). Los demás roles permitidos
  // (definidos explícitamente aquí) ven todas. Se normaliza (minúsculas +
  // sin espacios) para que un rol guardado en el portal como "Gerente" o
  // "gerente " (con espacio) no caiga por error en "ve todas las tiendas".
  //
  // IMPORTANTE — fail-closed, no fail-open: antes, cualquier rol que NO
  // fuera exactamente "gerente" caía en el `else` y recibía ["TODAS"]. Eso
  // incluía casos de error real (falla al leer el perfil en Firestore,
  // condición de carrera, rol mal escrito o vacío): un gerente cuyo perfil
  // no cargara bien terminaba viendo el selector completo de tiendas en vez
  // de ninguna. Ahora solo los roles listados explícitamente en
  // ROLES_CON_ACCESO_A_TODAS_LAS_TIENDAS reciben ["TODAS"]; cualquier otro
  // caso (incluyendo perfil nulo o rol desconocido) no ve ninguna tienda.
  const rolNormalizado = (rol || "").toString().trim().toLowerCase();
  const esGerente = rolNormalizado === "gerente";
  const veTodasLasTiendas = ROLES_CON_ACCESO_A_TODAS_LAS_TIENDAS.includes(rolNormalizado);
  // El campo en Firestore es "tiendas" (array), no "tienda" (string) — un
  // gerente puede tener una o varias tiendas asignadas en ese array.
  const tiendasAsignadas = Array.isArray(perfil?.tiendas)
    ? perfil.tiendas.map(t => (t || "").toString().trim()).filter(Boolean)
    : [];
  const tiendas = veTodasLasTiendas
    ? ["TODAS"]
    : (esGerente ? tiendasAsignadas : []);

  if (!perfil) {
    console.warn("No se pudo cargar el perfil de " + user.email + " desde Firestore (usuarios/" + user.email.toLowerCase() + "). Se le está mostrando sin acceso a ninguna tienda por seguridad.");
  } else if (!esGerente && !veTodasLasTiendas) {
    console.warn("El usuario " + user.email + " tiene un rol no reconocido ('" + rol + "'). Se le está mostrando sin acceso a ninguna tienda por seguridad.");
  }

  window.KACOSA.usuario = {
    email: user.email,
    nombre: nombre,
    displayName: nombre,
    rol: rol,
    rolNormalizado: rolNormalizado,
    veTodasLasTiendas: veTodasLasTiendas,
    ...user
  };

  window.KACOSA.tiendas = tiendas;
  window.KACOSA.tiendaActiva = tiendas.includes("TODAS") ? null : tiendas[0] || null;

  // Actualizar información del usuario en el sidebar
  actualizarUsuarioSidebar();

  // "Alertas Kacosa" es solo para perfiles con acceso a TODAS las tiendas
  // (es decir, todos los roles permitidos excepto "gerente")
  const btnAlertas = document.querySelector('[data-vista="vista-alertas-kacosa"]');
  if (btnAlertas && !tiendas.includes("TODAS")) {
    btnAlertas.style.display = "none";
  }

  // Aviso si un gerente no tiene tienda asignada (no debería pasar, pero evita confusión)
  if (esGerente && tiendas.length === 0) {
    console.warn("El usuario " + user.email + " es gerente pero no tiene 'tiendas' asignadas en el portal.");
  }

  // Actualizar modal de usuario
  const nombreEl = document.getElementById("user-modal-nombre");
  const correoEl = document.getElementById("user-modal-correo");
  if (nombreEl) nombreEl.textContent = nombre;
  if (correoEl) correoEl.textContent = user.email;

  document.dispatchEvent(new CustomEvent("kacosa:usuario-listo"));
  ocultarLoader();

  // Avisa al shell (portal) que este módulo ya terminó de verificar sesión
  // y permisos y está listo para verse, para que oculte su "Cargando
  // módulo…" justo en este momento en vez de antes (ver js/shell.js). Si
  // esta página no está dentro de un iframe (ej. se abrió directamente),
  // window.parent === window y este mensaje simplemente no llega a nadie.
  if (window.parent !== window) {
    window.parent.postMessage({ source: "kacosa-module", type: "listo" }, "*");
  }
});

function actualizarUsuarioSidebar() {
  const u = window.KACOSA?.usuario;
  const nombreEl = document.getElementById("sidebar-user-nombre");
  const emailEl = document.getElementById("sidebar-user-email");
  
  if (nombreEl) nombreEl.textContent = u?.nombre || u?.displayName || u?.email || "Usuario";
  if (emailEl) emailEl.textContent = u?.email || "";
}

// --- Menú hamburguesa: abre y cierra con el mismo botón, o tocando fuera ---
const btnHamburguesa = document.getElementById("btn-hamburguesa");
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay-sidebar");

function abrirMenu() {
  sidebar.classList.add("abierto");
  overlay.classList.add("visible");
  if (btnHamburguesa) btnHamburguesa.classList.add("activo");
}
function cerrarMenu() {
  sidebar.classList.remove("abierto");
  overlay.classList.remove("visible");
  if (btnHamburguesa) btnHamburguesa.classList.remove("activo");
}
function alternarMenu() {
  if (sidebar.classList.contains("abierto")) cerrarMenu(); else abrirMenu();
}

if (btnHamburguesa) btnHamburguesa.addEventListener("click", alternarMenu);
if (overlay) overlay.addEventListener("click", cerrarMenu);

// --- Modal de cuenta de usuario (avatar en el header) ---
const btnUserAvatar = document.getElementById("btn-user-avatar");
const overlayUserModal = document.getElementById("overlay-user-modal");
const btnUserCancelar = document.getElementById("btn-user-cancelar");
const btnUserCerrarSesion = document.getElementById("btn-user-cerrar-sesion");

function abrirModalUsuario() {
  const u = window.KACOSA?.usuario;
  const nombreEl = document.getElementById("user-modal-nombre");
  const correoEl = document.getElementById("user-modal-correo");
  if (nombreEl) nombreEl.textContent = (u?.nombre || u?.displayName || u?.email || "Usuario");
  if (correoEl) correoEl.textContent = u?.email || "";
  if (overlayUserModal) overlayUserModal.classList.add("visible");
}
function cerrarModalUsuario() {
  if (overlayUserModal) overlayUserModal.classList.remove("visible");
}

if (btnUserAvatar) btnUserAvatar.addEventListener("click", abrirModalUsuario);
if (btnUserCancelar) btnUserCancelar.addEventListener("click", cerrarModalUsuario);
if (overlayUserModal) {
  overlayUserModal.addEventListener("click", (e) => {
    if (e.target === overlayUserModal) cerrarModalUsuario();
  });
}

// --- Cerrar sesión desde el sidebar y desde el modal ---
document.getElementById("btn-sidebar-cerrar-sesion")?.addEventListener("click", cerrarSesion);
if (btnUserCerrarSesion) btnUserCerrarSesion.addEventListener("click", cerrarSesion);

// --- Cambio de vista ---
const botonesNav = document.querySelectorAll("[data-vista]");
const vistas = document.querySelectorAll(".vista");

function mostrarVista(idVista) {
  vistas.forEach(v => v.classList.toggle("activa", v.id === idVista));
  botonesNav.forEach(b => b.classList.toggle("activo", b.dataset.vista === idVista));
  cerrarMenu();
  document.dispatchEvent(new CustomEvent("kacosa:vista-cambiada", { detail: { vista: idVista } }));
}

botonesNav.forEach(btn => {
  btn.addEventListener("click", () => mostrarVista(btn.dataset.vista));
});

// Vista inicial
// ---------------------------------------------------------------------
// PARCHE ADITIVO — Kacosa App (portal unificado): permite que el shell
// enlace directamente a una vista específica vía "#vista=vista-alertas-kacosa"
// al incrustar esta app dentro de un iframe por submódulo. Si no viene
// hash, se comporta exactamente igual que antes (vista-dashboard).
// ---------------------------------------------------------------------
function vistaInicialDesdeHash() {
  const match = location.hash.match(/vista=([a-z0-9-]+)/i);
  return (match && document.getElementById(match[1])) ? match[1] : "vista-dashboard";
}
// Importante: se espera al evento "load" de la ventana (todos los scripts
// de módulo ya cargados y con sus listeners de "kacosa:vista-cambiada"
// registrados) antes de disparar la vista inicial. Si se hace antes, vistas
// como Nuevo Análisis o Alertas Kacosa se quedan en "Cargando módulo..."
// para siempre, porque el evento que les avisa que deben dibujarse ya pasó
// cuando ellos recién estaban registrando su escucha.
window.addEventListener("load", () => mostrarVista(vistaInicialDesdeHash()));

// Si el shell cambia el hash de esta misma página (ej. de "Dashboard
// Abastecimiento" a "Nuevo Análisis", ambos son este mismo app.html), el
// navegador no siempre recarga el iframe — solo dispara "hashchange".
// Este listener asegura que la vista cambie igual en ese caso.
window.addEventListener("hashchange", () => mostrarVista(vistaInicialDesdeHash()));
