// Configuración pública del cliente de Firebase (no es sensible, es del lado cliente).
// Es el MISMO proyecto "portal-kacosa" que ya usaban las 4 apps por separado para
// login y roles. Al vivir ahora todo bajo un solo dominio/repositorio, la sesión
// se comparte automáticamente entre el shell y los iframes de cada submódulo
// (misma sesión de Firebase Auth persistida en el mismo origen).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
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
