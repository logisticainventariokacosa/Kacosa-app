// loader-classic.js — Kacosa App
// Versión sin "export" del loader de Abastecimiento (loader.css). Se muestra
// de inmediato (tapa el parpadeo de la pantalla de login mientras Firebase
// resuelve la sesión) y se oculta solo cuando #mainApp queda visible.
(function () {
  function construirLoaderSiNoExiste() {
    if (document.getElementById("kacosa-loader")) return;
    var div = document.createElement("div");
    div.id = "kacosa-loader";
    div.innerHTML =
      '<div class="loader-caja">' +
        '<div class="loader-marca">' +
          '<div class="loader-barra"></div>' +
          '<div class="loader-titulo">KACOSA</div>' +
        '</div>' +
        '<div class="loader-spinner"></div>' +
        '<div class="loader-mensaje" id="kacosa-loader-mensaje">Verificando acceso…</div>' +
      '</div>';
    document.body.appendChild(div);
  }

  function ocultarKacosaLoader() {
    var loader = document.getElementById("kacosa-loader");
    if (loader) {
      // Importante: el shell (portal) oculta su propio "Cargando módulo…" de
      // forma INSTANTÁNEA (sin transición) en cuanto recibe el aviso "listo"
      // más abajo. Si este loader interno se ocultara con el fundido normal
      // de loader.css (0.35s de opacity/visibility), quedaría expuesto solo
      // él durante esa fracción de segundo — un "segundo loader" parpadeando
      // justo después de que desaparece el del shell. Para evitarlo,
      // desactivamos la transición antes de ocultarlo, así ambos loaders
      // desaparecen en el mismo instante.
      loader.style.transition = "none";
      loader.classList.add("oculto");
    }

    // Avisa al shell (portal) que este módulo ya terminó de verificar
    // acceso y ya está mostrando #mainApp, para que oculte su propio
    // "Cargando módulo…" justo en este momento (ver js/shell.js) en vez de
    // antes, cuando este loader interno todavía se veía como un segundo
    // loader tras el del shell. Si esta página no está dentro de un
    // iframe, el mensaje simplemente no llega a nadie.
    if (window.parent !== window) {
      window.parent.postMessage({ source: "kacosa-module", type: "listo" }, "*");
    }
  }

  construirLoaderSiNoExiste();

  // Vigila #mainApp: en cuanto pase a visible (display:block), ocultamos el loader.
  function vigilar() {
    var mainApp = document.getElementById("mainApp");
    if (!mainApp) { setTimeout(vigilar, 100); return; }
    if (mainApp.style.display === "block") { ocultarKacosaLoader(); return; }
    new MutationObserver(function () {
      if (mainApp.style.display === "block") ocultarKacosaLoader();
    }).observe(mainApp, { attributes: true, attributeFilter: ["style"] });
  }
  vigilar();

  // Salvaguarda: si algo falla y nunca se oculta, no lo dejamos bloqueado.
  setTimeout(ocultarKacosaLoader, 12000);
})();
