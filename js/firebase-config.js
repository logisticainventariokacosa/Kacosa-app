// Configuración pública del cliente de Firebase (no es sensible, es del lado cliente).
// Es el MISMO proyecto "portal-kacosa" que ya usaban las 4 apps por separado para
// login y roles. Al vivir ahora todo bajo un solo dominio/repositorio, la sesión
// se comparte automáticamente entre el shell y los iframes de cada submódulo
// (misma sesión de Firebase Auth persistida en el mismo origen).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAeXFRdPZsEKX5vcTgGQ5hIOAlJyVv92kQ",
  authDomain: "portal-kacosa.firebaseapp.com",
  projectId: "portal-kacosa",
  storageBucket: "portal-kacosa.firebasestorage.app",
  messagingSenderId: "350653710617",
  appId: "1:350653710617:web:d29f757730e4515ec3c588"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Persistencia SOLO por sesión del navegador (no "recordar sesión" indefinido):
// si el usuario cierra la pestaña/app sin haber tocado "Cerrar sesión", la
// próxima vez que abra la app debe pedir login de nuevo. Con la persistencia
// por defecto de Firebase (LOCAL) la sesión sobrevive aunque se cierre el
// navegador por completo; con SESSION se limpia sola al cerrar la pestaña.
// OJO: esto aplica a partir del PRÓXIMO inicio de sesión — a alguien que ya
// esté logueado ahora mismo con la persistencia vieja no se le cierra la
// sesión de golpe, pero si cierra su pestaña y vuelve a entrar sí tendrá que
// loguearse de nuevo (Firebase ya habrá guardado la sesión con la nueva
// persistencia en su primer login posterior a este cambio).
setPersistence(auth, browserSessionPersistence).catch(err => {
  console.error("No se pudo configurar la persistencia de sesión (SESSION):", err);
});
