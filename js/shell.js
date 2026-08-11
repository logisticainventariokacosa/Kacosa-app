 import { auth, db, googleProvider } from "./firebase-config.js";
import {
  signInWithPopup, signOut, onAuthStateChanged,
  signInWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =====================================================================
   ÁRBOL DE MÓDULOS TIPO SAP
   -----------------------------------------------------------------
   Cada submódulo carga, dentro de un <iframe>, la app original SIN
   modificar su lógica interna (solo se le añadió, en sus propios
   archivos, un pequeño parche aditivo para poder abrir directamente
   una sección/vista concreta vía hash — ver comentarios en cada JS).

   "roles": lista de roles (campo "rol" en la colección "usuarios")
   que pueden ver ese submódulo. Ajusta esta lista según las reglas
   de negocio reales de KACOSA; se tomó como base los roles que ya
   usaba cada app por separado.
   ===================================================================== */
const ROLES_INVENTARIO = ["admin", "supervisor", "directiva", "gerente"];
const ROLES_ABASTECIMIENTO = ["gerente", "supervisor", "abastecimiento", "compras", "admin", "directiva"];
const ROLES_DASHBOARD_INV = ["coordinador", "directiva", "admin"];

const MODULES = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "fa-gauge-high",
    submodules: [
      {
        id: "dashboard-inv",
        label: "Dashboard Inventario",
        icon: "fa-warehouse",
        src: "modules/dashboard-inv/index.html",
        roles: ROLES_DASHBOARD_INV
      },
      {
        id: "dashboard-aba",
        label: "Dashboard Abastecimiento",
        icon: "fa-truck-fast",
        src: "modules/abastecimiento/app.html#vista=vista-dashboard",
        roles: ROLES_ABASTECIMIENTO
      }
    ]
  },
  {
    id: "inventario",
    label: "Inventario",
    icon: "fa-boxes-stacked",
    submodules: [
      {
        id: "trazabilidad",
        label: "Trazabilidad",
        icon: "fa-route",
        src: "modules/inventario/index.html#section=reports",
        roles: ROLES_INVENTARIO
      },
      {
        id: "consultas",
        label: "Consultas",
        icon: "fa-magnifying-glass",
        src: "modules/inventario/index.html#section=home",
        roles: ROLES_INVENTARIO
      }
    ]
  },
  {
    id: "abastecimiento",
    label: "Abastecimiento",
    icon: "fa-truck-ramp-box",
    submodules: [
      {
        id: "nuevo-analisis",
        label: "Nuevo Análisis",
        icon: "fa-file-import",
        src: "modules/abastecimiento/app.html#vista=vista-nuevo-analisis",
        roles: ROLES_ABASTECIMIENTO
      },
      {
        id: "alertas-kacosa",
        label: "Alertas Kacosa",
        icon: "fa-triangle-exclamation",
        src: "modules/abastecimiento/app.html#vista=vista-alertas-kacosa",
        // "gerente" no ve Alertas Kacosa en la app original (solo roles con
        // visibilidad de TODAS las tiendas), se respeta la misma regla aquí.
        roles: ROLES_ABASTECIMIENTO.filter(r => r !== "gerente")
      }
    ]
  },
  {
    id: "reportes",
    label: "Reportes",
    icon: "fa-folder-open",
    // Al entrar a Reportes, lo primero que se ve es la noticia (submódulo Noticias)
    submodules: [
      {
        id: "noticias",
        label: "Noticias",
        icon: "fa-newspaper",
        src: "modules/inventario/index.html#section=news",
        roles: ROLES_INVENTARIO
      },
      {
        id: "imagenes",
        label: "Imágenes",
        icon: "fa-image",
        src: "modules/inventario/index.html#section=images",
        roles: ROLES_INVENTARIO
      },
      {
        id: "documentos",
        label: "Documentos",
        icon: "fa-file-lines",
        src: "modules/inventario/index.html#section=documents",
        roles: ROLES_INVENTARIO
      }
    ]
  }
];

// Módulo/submódulo con el que arranca cada rol al iniciar sesión.
// Ajusta libremente este mapa según cómo KACOSA quiera enrutar cada rol.
const HOME_POR_ROL = {
  gerente: "dashboard-aba",
  abastecimiento: "dashboard-aba",
  compras: "dashboard-aba",
  coordinador: "dashboard-inv",
  supervisor: "dashboard-inv",
  directiva: "dashboard-inv",
  admin: "dashboard-inv"
};
const HOME_POR_DEFECTO = "dashboard-inv";

/* ===================== Referencias DOM ===================== */
const loginScreen = document.getElementById("login-screen");
const changePasswordScreen = document.getElementById("change-password-screen");
const appScreen = document.getElementById("app-screen");
const loginStatus = document.getElementById("login-status");
const sidebarModules = document.getElementById("sidebar-modules");
const moduleFrame = document.getElementById("module-frame");
const moduleLoader = document.getElementById("module-loader");
const headerModuleLabel = document.getElementById("header-module-label");

let rolActual = null;
let submoduloActivoId = null;

/* ===================== LOGIN ===================== */
document.getElementById("btn-login").addEventListener("click", () => {
  loginStatus.classList.remove("text-kacosa-600");
  loginStatus.textContent = "Conectando…";
  signInWithPopup(auth, googleProvider).catch(err => {
    loginStatus.classList.add("text-kacosa-600");
    loginStatus.textContent = "No se pudo iniciar sesión (" + err.code + ")";
  });
});

document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));
document.getElementById("btn-sidebar-cerrar-sesion").addEventListener("click", () => signOut(auth));

document.querySelectorAll(".toggle-eye").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = document.getElementById(btn.dataset.target);
    const icon = btn.querySelector("i");
    const oculto = target.type === "password";
    target.type = oculto ? "text" : "password";
    icon.classList.toggle("fa-eye", !oculto);
    icon.classList.toggle("fa-eye-slash", oculto);
  });
});

const emailForm = document.getElementById("email-form");
emailForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email-input").value.trim();
  const pass = document.getElementById("password-input").value;
  loginStatus.classList.remove("text-kacosa-600");
  loginStatus.textContent = "Conectando…";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    loginStatus.classList.add("text-kacosa-600");
    loginStatus.textContent = mensajeError(err.code);
  }
});

function mensajeError(code) {
  const map = {
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/invalid-email": "El correo no es válido.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/missing-password": "Escribe tu contraseña.",
    "auth/too-many-requests": "Demasiados intentos. Espera unos minutos e inténtalo de nuevo."
  };
  return map[code] || ("No se pudo completar (" + code + ")");
}

/* ===================== Cambio de contraseña obligatorio ===================== */
const changePasswordForm = document.getElementById("change-password-form");
const changePasswordStatus = document.getElementById("change-password-status");
const ALFANUMERICO = /^[A-Za-z0-9]+$/;

changePasswordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = document.getElementById("new-password-input").value;
  const p2 = document.getElementById("confirm-password-input").value;
  changePasswordStatus.classList.remove("text-kacosa-600");

  if (!ALFANUMERICO.test(p1) || p1.length > 20) {
    changePasswordStatus.classList.add("text-kacosa-600");
    changePasswordStatus.textContent = "Debe ser alfanumérica (sin símbolos ni espacios) y de máximo 20 caracteres.";
    return;
  }
  if (p1 !== p2) {
    changePasswordStatus.classList.add("text-kacosa-600");
    changePasswordStatus.textContent = "Las contraseñas no coinciden.";
    return;
  }

  changePasswordStatus.textContent = "Verificando…";
  try {
    const cred = EmailAuthProvider.credential(auth.currentUser.email, p1);
    await reauthenticateWithCredential(auth.currentUser, cred);
    changePasswordStatus.classList.add("text-kacosa-600");
    changePasswordStatus.textContent = "La nueva contraseña no puede ser igual a la temporal. Elige una diferente.";
    return;
  } catch (err) {
    const codigosEsperados = ["auth/wrong-password", "auth/invalid-credential", "auth/user-mismatch"];
    if (!codigosEsperados.includes(err.code)) {
      changePasswordStatus.classList.add("text-kacosa-600");
      changePasswordStatus.textContent = "No se pudo validar la contraseña (" + err.code + "). Intenta de nuevo.";
      return;
    }
  }

  changePasswordStatus.textContent = "Guardando…";
  try {
    await updatePassword(auth.currentUser, p1);
    await updateDoc(doc(db, "usuarios", auth.currentUser.email), { passwordTemporal: false });
    location.reload();
  } catch (err) {
    changePasswordStatus.classList.add("text-kacosa-600");
    changePasswordStatus.textContent = "No se pudo actualizar (" + err.code + "). Vuelve a iniciar sesión e inténtalo de nuevo.";
  }
});

/* ===================== Sesión / control de acceso ===================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    mostrarPantalla("login");
    return;
  }

  loginStatus.textContent = "Verificando permisos…";

  let perfil = null;
  try {
    const snap = await getDoc(doc(db, "usuarios", user.email.toLowerCase()));
    if (snap.exists()) perfil = snap.data();
  } catch (e) {
    console.error(e);
  }

  if (!perfil) {
    loginStatus.classList.add("text-kacosa-600");
    loginStatus.textContent = "Tu cuenta (" + user.email + ") no tiene acceso configurado. Contacta al administrador.";
    return;
  }

  if (perfil.passwordTemporal === true) {
    mostrarPantalla("cambio-password");
    return;
  }

  rolActual = perfil.rol || "sin-rol";
  document.getElementById("user-name-label").textContent = perfil.nombre || user.email;
  document.getElementById("role-badge").textContent = rolActual;
  document.getElementById("sidebar-user-nombre").textContent = perfil.nombre || user.email;
  document.getElementById("sidebar-user-email").textContent = user.email;

  construirSidebar(rolActual);
  mostrarPantalla("app");

  const inicial = HOME_POR_ROL[rolActual] || HOME_POR_DEFECTO;
  abrirSubmodulo(inicial, { actualizarUrl: true });
});

function mostrarPantalla(cual) {
  loginScreen.classList.toggle("hidden", cual !== "login");
  loginScreen.classList.toggle("flex", cual === "login");
  changePasswordScreen.classList.toggle("hidden", cual !== "cambio-password");
  changePasswordScreen.classList.toggle("flex", cual === "cambio-password");
  appScreen.classList.toggle("hidden", cual !== "app");
}

/* ===================== Construcción del sidebar SAP ===================== */
function construirSidebar(rol) {
  sidebarModules.innerHTML = "";

  MODULES.forEach(mod => {
    const submodsVisibles = mod.submodules.filter(sm => !sm.roles || sm.roles.includes(rol) || rol === "admin");
    if (submodsVisibles.length === 0) return;

    const wrap = document.createElement("div");
    wrap.className = "sap-module";
    wrap.dataset.moduleId = mod.id;

    const btn = document.createElement("button");
    btn.className = "sap-module-btn";
    btn.innerHTML = `<i class="fa-solid ${mod.icon} mod-icon"></i><span>${mod.label}</span><i class="fa-solid fa-chevron-right chev"></i>`;
    btn.addEventListener("click", () => wrap.classList.toggle("abierto"));

    const subwrap = document.createElement("div");
    subwrap.className = "sap-submodules";

    submodsVisibles.forEach(sm => {
      const subBtn = document.createElement("button");
      subBtn.className = "sap-submodule-btn";
      subBtn.dataset.submoduleId = sm.id;
      subBtn.innerHTML = `<i class="fa-solid ${sm.icon}"></i><span>${sm.label}</span>`;
      subBtn.addEventListener("click", () => abrirSubmodulo(sm.id, { actualizarUrl: true }));
      subwrap.appendChild(subBtn);
    });

    wrap.appendChild(btn);
    wrap.appendChild(subwrap);
    sidebarModules.appendChild(wrap);
  });
}

/* ===================== Apertura de submódulos (iframe) ===================== */
function buscarSubmodulo(id) {
  for (const mod of MODULES) {
    const sm = mod.submodules.find(s => s.id === id);
    if (sm) return { mod, sm };
  }
  return null;
}

function abrirSubmodulo(id, { actualizarUrl = false } = {}) {
  const encontrado = buscarSubmodulo(id);
  if (!encontrado) return;
  const { mod, sm } = encontrado;

  submoduloActivoId = id;
  headerModuleLabel.textContent = mod.label + " · " + sm.label;

  document.querySelectorAll(".sap-submodule-btn").forEach(b => {
    b.classList.toggle("activo", b.dataset.submoduleId === id);
  });
  document.querySelectorAll(".sap-module").forEach(w => {
    w.classList.toggle("abierto", w.dataset.moduleId === mod.id);
  });

  // Si el nuevo submódulo apunta a la MISMA página que ya está cargada en el
  // iframe (solo cambia el hash, ej. entre vistas de Abastecimiento o
  // secciones de Inventario), el navegador no siempre dispara "load" — así
  // que ocultamos el loader de una vez en ese caso.
  const [baseNuevo] = sm.src.split("#");
  const srcActual = moduleFrame.getAttribute("src") || "";
  const [baseActual] = srcActual.split("#");
  const esMismaPagina = baseActual && baseNuevo === baseActual;

  moduleLoader.classList.toggle("oculto", esMismaPagina);
  moduleFrame.src = sm.src;

  if (actualizarUrl) {
    history.replaceState(null, "", "#" + id);
  }
  cerrarMenu();
}

moduleFrame.addEventListener("load", () => moduleLoader.classList.add("oculto"));

// Permite volver a un submódulo concreto al recargar la página (ej. #trazabilidad)
window.addEventListener("hashchange", () => {
  const id = location.hash.replace("#", "");
  if (id && buscarSubmodulo(id) && id !== submoduloActivoId) {
    abrirSubmodulo(id);
  }
});

/* ===================== Menú hamburguesa ===================== */
const btnHamburguesa = document.getElementById("btn-hamburguesa");
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay-sidebar");

function abrirMenu() {
  sidebar.classList.add("abierto");
  overlay.classList.add("visible");
  btnHamburguesa.classList.add("activo");
}
function cerrarMenu() {
  sidebar.classList.remove("abierto");
  overlay.classList.remove("visible");
  btnHamburguesa.classList.remove("activo");
}
btnHamburguesa.addEventListener("click", () => {
  sidebar.classList.contains("abierto") ? cerrarMenu() : abrirMenu();
});
overlay.addEventListener("click", cerrarMenu);

/* ===================== Ajuste dinámico de la altura del header ===================== */
function ajustarAlturaHeader() {
  const header = document.querySelector("#app-screen > div.sticky");
  if (header) document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px");
}
window.addEventListener("resize", ajustarAlturaHeader);
new MutationObserver(ajustarAlturaHeader).observe(appScreen, { attributes: true, attributeFilter: ["class"] });
ajustarAlturaHeader();

/* ===================== Reloj / año del footer ===================== */
document.getElementById("footer-year").textContent = new Date().getFullYear();
function tick() {
  const el = document.getElementById("footer-clock");
  if (el) el.textContent = new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });
}
tick();
setInterval(tick, 1000 * 30);
  
