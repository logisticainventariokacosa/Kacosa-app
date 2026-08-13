// js/tema-classic.js — Kacosa App
// Aplica el tema claro/oscuro elegido en el shell principal. Como todo vive
// bajo el mismo dominio, localStorage se comparte automáticamente; este
// script solo lee esa preferencia al cargar y se queda escuchando cambios
// en vivo (evento "storage", se dispara solo en OTROS documentos del mismo
// origen — o sea, cuando el shell cambia el tema desde afuera).
(function () {
  var CLAVE_TEMA = "kacosa-theme";

  function aplicar(tema) {
    document.documentElement.classList.toggle("kacosa-dark", tema === "dark");
  }

  aplicar(localStorage.getItem(CLAVE_TEMA) === "dark" ? "dark" : "light");

  window.addEventListener("storage", function (e) {
    if (e.key === CLAVE_TEMA) aplicar(e.newValue === "dark" ? "dark" : "light");
  });

  // Respaldo por si el navegador no propaga bien "storage" a este iframe
  window.addEventListener("message", function (e) {
    if (e.data && e.data.tipo === "kacosa-tema") aplicar(e.data.tema);
  });
})();
