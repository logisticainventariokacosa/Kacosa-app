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
    if (loader) loader.classList.add("oculto");
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
