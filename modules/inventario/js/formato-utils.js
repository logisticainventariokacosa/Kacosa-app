// js/formato-utils.js
// Utilidades compartidas por todo el submódulo de Toma Física de Inventarios.
// Cárgalo ANTES de bridge-inventario.js / captura-movil.js / etc.

(function () {
  window.formatearFechaHora = function (fechaIso) {
    if (!fechaIso) return '—';
    const d = new Date(fechaIso);
    if (isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
})();
