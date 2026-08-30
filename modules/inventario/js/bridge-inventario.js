// js/bridge-inventario.js
// Igual que modules/abastecimiento/js/bridge.js, pero como script clásico
// (sin import/export) porque este módulo carga Firebase con el SDK
// "compat" (ver script.js: firebase.initializeApp / firebase.auth()),
// no con el SDK modular. Expone window.callBridgeInventario.

(function () {
  // Misma URL /exec que usa Abastecimiento — es el mismo backend para toda la app.
  const BRIDGE_URL = "https://script.google.com/macros/s/AKfycbw6A3DVq4zgEp0ekfOFawtjzw0rFogHMjcs95x4bHLyxOOWmqyChiJNI0rpdPpiV0fQ/exec";

  async function callBridgeInventario(action, payload = {}) {
    try {
      const user = firebase.auth().currentUser;
      if (!user) {
        return { ok: false, error: "No hay sesión activa. Vuelve a iniciar sesión." };
      }

      let idToken;
      try {
        idToken = await user.getIdToken();
      } catch (err) {
        return { ok: false, error: "No se pudo verificar tu sesión: " + err.message };
      }

      const resp = await fetch(BRIDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, idToken, ...payload })
      });

      if (!resp.ok) {
        return { ok: false, error: "Error de red: " + resp.status };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: "No se pudo conectar con el servidor: " + err.message };
    }
  }

  window.callBridgeInventario = callBridgeInventario;
})();
