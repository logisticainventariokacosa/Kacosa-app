// js/inventario-fisico.js
// Submódulo "Inventario Físico".
// Analista -> Captura Móvil (ver captura-movil.js).
// Supervisor/coordinador -> vista de TODOS los conteos a los que tiene
// acceso (ver monitor-inventario.js). Abrir/pausar/cerrar inventarios y
// Reportes SAP se movieron al submódulo separado "Control de Inventarios"
// (ver control-inventarios.js).

(function () {
  function iniciar() {
    const link = document.querySelector('.nav a[data-section="fisico"]');
    if (!link) return; // el nav todavía no tiene el tab (falta agregarlo en index.html)
    link.addEventListener('click', cargarPantalla);
  }

  async function cargarPantalla() {
    const cont = document.getElementById('fisico-contenido');
    if (!cont) return;
    cont.innerHTML = '<p class="muted">Cargando...</p>';

    const resp = await window.callBridgeInventario('perfilInventario', {});
    if (!resp.ok) {
      cont.innerHTML = `<p class="muted">${resp.error}</p>`;
      return;
    }

    if (resp.rol === 'analista') {
      if (typeof window.iniciarCapturaMovil === 'function') {
        await window.iniciarCapturaMovil(cont, resp);
      } else {
        cont.innerHTML = '<p class="muted">La Captura Móvil todavía no está disponible.</p>';
      }
      return;
    }

    // supervisor / coordinador: ven todos los conteos a los que tienen acceso.
    if (typeof window.iniciarMonitorInventario === 'function') {
      await window.iniciarMonitorInventario(cont, resp);
    } else {
      cont.innerHTML = '<p class="muted">Esta vista todavía no está disponible.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
