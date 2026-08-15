// Configuración pública del cliente de Firebase (no es sensible, es del lado cliente)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---- Proyecto de DATOS: el de siempre, no cambia (análisis, tiendas, etc.) ----
const firebaseConfigDatos = {
  apiKey: "AIzaSyAaqehmbIh3uf6uNH2rDBD_58t5WW4sOyc",
  authDomain: "kacosa-abastecimiento.firebaseapp.com",
  projectId: "kacosa-abastecimiento",
  storageBucket: "kacosa-abastecimiento.firebasestorage.app",
  messagingSenderId: "1016290618839",
  appId: "1:1016290618839:web:1b0d8839a57560309f6f92"
};

// ---- Proyecto de LOGIN y AUTORIZACIÓN: compartido con el Portal KACOSA ----
const firebaseConfigAuth = {
  apiKey: "AIzaSyAeXFRdPZsEKX5vcTgGQ5hIOAlJyVv92kQ",
  authDomain: "portal-kacosa.firebaseapp.com",
  projectId: "portal-kacosa",
  storageBucket: "portal-kacosa.firebasestorage.app",
  messagingSenderId: "350653710617",
  appId: "1:350653710617:web:d29f757730e4515ec3c588"
};

// IMPORTANTE: la app de AUTH debe registrarse como la app por defecto (sin
// nombre), igual que en el portal (./js/firebase-config.js hace
// initializeApp(firebaseConfig) sin segundo argumento). Firebase persiste la
// sesión de usuario en el navegador usando una clave que incluye el NOMBRE
// de la app además del proyecto ("firebase:authUser:<apiKey>:<appName>").
// Antes esta app de auth se registraba con el nombre "auth", que es distinto
// al nombre por defecto "[DEFAULT]" que usa el portal — aunque ambas usan el
// mismo proyecto "portal-kacosa", la sesión quedaba guardada bajo una clave
// distinta a la que el módulo buscaba, así que nunca la encontraba y pedía
// login de nuevo aunque el usuario ya estuviera autenticado en el portal.
const appAuth  = initializeApp(firebaseConfigAuth);          // app por defecto, misma clave de sesión que el portal
const appDatos = initializeApp(firebaseConfigDatos, "datos");

export const auth = getAuth(appAuth);         // login compartido con el portal
export const db = getFirestore(appDatos);     // datos propios de esta app (sin cambios)
export const dbAuth = getFirestore(appAuth);  // colección "usuarios" del portal (rol/tienda)
export const googleProvider = new GoogleAuthProvider();
