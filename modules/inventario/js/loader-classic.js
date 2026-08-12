// js/loader-classic.js — Kacosa App
// Versión sin "export" del loader de Abastecimiento (css/loader.css), para
// poder usarse aquí como script clásico. Se muestra de inmediato al cargar
// la página (para tapar el parpadeo del loader anterior/estado de sesión) y
// se oculta solo cuando #globalLoader (el loader propio de esta app) recibe
// la clase "hidden", que es la señal de que la app ya terminó de iniciar.
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
        '<div class="loader-mensaje" id="kacosa-loader-mensaje">Cargando…</div>' +
      '</div>';
    document.body.appendChild(div);
  }

  function ocultarKacosaLoader() {
    var loader = document.getElementById("kacosa-loader");
    if (loader) loader.classList.add("oculto");
  }

  construirLoaderSiNoExiste();

  // Vigila el loader original de la app (#globalLoader): en cuanto se marca
  // "hidden" (la app ya cargó todo), ocultamos también el nuestro.
  function vigilar() {
    var original = document.getElementById("globalLoader");
    if (!original) { setTimeout(vigilar, 100); return; }
    if (original.classList.contains("hidden")) { ocultarKacosaLoader(); return; }
    new MutationObserver(function () {
      if (original.classList.contains("hidden")) ocultarKacosaLoader();
    }).observe(original, { attributes: true, attributeFilter: ["class"] });
  }
  vigilar();

  // Salvaguarda: si algo falla y nunca se oculta, no lo dejamos bloqueado.
  setTimeout(ocultarKacosaLoader, 12000);
})();
