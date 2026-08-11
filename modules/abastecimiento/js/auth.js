import { auth, dbAuth, googleProvider } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { mostrarLoader, ocultarLoader } from "./loader.js";

// Roles que tienen acceso a ESTA app (Análisis de Abastecimiento)
export const ROLES_PERMITIDOS_ABASTECIMIENTO = [
  "gerente", "supervisor", "abastecimiento", "compras", "admin", "directiva"
];

// Busca el perfil del usuario en la colección "usuarios" del Portal KACOSA
export async function obtenerPerfilPortal(email) {
  try {
    const ref = doc(dbAuth, "usuarios", email.toLowerCase());
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error("Error obteniendo perfil del portal:", e);
    return null;
  }
}

// Un correo está autorizado para esta app si existe en el portal Y su rol está en la lista permitida
async function correoAutorizado(email) {
  const perfil = await obtenerPerfilPortal(email);
  return !!(perfil && ROLES_PERMITIDOS_ABASTECIMIENTO.includes(perfil.rol));
}

function mostrarError(msg) {
  const el = document.getElementById("mensaje-error");
  if (el) { el.textContent = msg; el.style.display = "block"; }
}

async function validarYRedirigir(user) {
  mostrarLoader("Verificando acceso...");
  const autorizado = await correoAutorizado(user.email);
  if (!autorizado) {
    // No se cierra sesión: es compartida con el portal y las demás apps de KACOSA.
    ocultarLoader();
    mostrarError("Tu cuenta no tiene acceso a este módulo. Contacta al administrador.");
    return;
  }
  mostrarLoader("Entrando...");
  window.location.href = "app.html";
}

// --- Si ya hay sesión activa (ej. viniendo del portal), entra directo sin mostrar el login ---
const formLogin = document.getElementById("form-login");
if (formLogin) {
  mostrarLoader("Verificando sesión...");
  onAuthStateChanged(auth, (user) => {
    if (user) {
      validarYRedirigir(user);
    } else {
      ocultarLoader();
    }
  });
}

// --- Login con correo/contraseña ---
if (formLogin) {
  formLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const pass = document.getElementById("login-password").value;
    mostrarLoader("Iniciando sesión...");
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await validarYRedirigir(cred.user);
    } catch (err) {
      ocultarLoader();
      mostrarError("Correo o contraseña incorrectos.");
    }
  });
}

// --- Login con Google (POPUP - más confiable que redirect) ---
const btnGoogle = document.getElementById("btn-google");
if (btnGoogle) {
  btnGoogle.addEventListener("click", async () => {
    mostrarLoader("Conectando con Google...");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await validarYRedirigir(result.user);
    } catch (err) {
      ocultarLoader();
      if (err.code === "auth/popup-closed-by-user") {
        mostrarError("Cerraste la ventana de Google. Inténtalo de nuevo.");
      } else {
        mostrarError("Google - " + err.code + ": " + err.message);
      }
    }
  });
}

// --- Protección de app.html ---
export function protegerPagina() {
  let yaRedirigido = false;

  const irAlLogin = () => {
    if (yaRedirigido) return;
    yaRedirigido = true;
    window.location.href = "index.html";
  };

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const autorizado = await correoAutorizado(user.email);
      if (!autorizado) {
        // No se cierra sesión: es compartida con el portal y las demás apps.
        irAlLogin();
      } else {
        const nombreEl = document.getElementById("usuario-actual");
        if (nombreEl) nombreEl.textContent = user.email;
      }
      return;
    }

    // Si no hay usuario y estamos en app.html, redirigir al login
    if (window.location.pathname.includes("app.html")) {
      setTimeout(() => {
        if (!auth.currentUser) irAlLogin();
      }, 500);
    }
  });
}

export function cerrarSesion() {
  signOut(auth).then(() => window.location.href = "index.html");
}
