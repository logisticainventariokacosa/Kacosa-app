// js/reportes-inventario.js
// Submódulo "Reportes y Exportación SAP" (supervisor/coordinador).
// Genera el archivo TXT con formato MATERIAL|CONTEO_TOTAL para materiales
// "OK, sin contabilizar" (listos para subir a SAP), y deja constancia de
// cada generación en la tabla "reportes".

(function () {
  let perfil = null;
  let ultimoResultado = null;

  window.iniciarReportesInventario = function (cont, perfilRecibido) {
    perfil = perfilRecibido;
    const opcionesCentro = perfil.centros
      .map(c => `<option value="${c.centro}">${c.nombre_centro} (${c.centro})</option>`)
      .join('');

    cont.innerHTML = `
      <div class="search-card">
        <h2>Exportación SAP — Materiales OK sin contabilizar</h2>
        <p class="muted">Genera el archivo con formato <code>MATERIAL|CONTEO_TOTAL</code> para subir a SAP.</p>

        <div class="row filter-controls">
          <div class="filter-input-group">
            <label for="repCentro">Centro</label>
            <select id="repCentro" class="custom-select">${opcionesCentro}</select>
          </div>
          <div class="filter-input-group">
            <label for="repAlmacen">Almacén (opcional)</label>
            <select id="repAlmacen" class="custom-select">
              <option value="">Todos los almacenes del centro</option>
            </select>
          </div>
        </div>
        <div class="row filter-controls" style="margin-top:10px;">
          <div class="filter-input-group">
            <label for="repFechaInicial">Desde (opcional)</label>
            <input id="repFechaInicial" type="date" />
          </div>
          <div class="filter-input-group">
            <label for="repFechaFinal">Hasta (opcional)</label>
            <input id="repFechaFinal" type="date" />
          </div>
        </div>

        <div class="row" style="margin-top:14px;">
          <button id="btnGenerarReporte">Generar reporte</button>
        </div>
        <div id="repEstado" class="muted" style="margin-top:8px;"></div>
      </div>

      <div id="repResultado" style="margin-top:16px;"></div>
    `;

    document.getElementById('repCentro').addEventListener('change', cargarAlmacenes);
    document.getElementById('btnGenerarReporte').addEventListener('click', generarReporte);
    cargarAlmacenes();
  };

  async function cargarAlmacenes() {
    const centro = document.getElementById('repCentro').value;
    const select = document.getElementById('repAlmacen');
    select.innerHTML = '<option value="">Todos los almacenes del centro</option>';

    const resp = await window.callBridgeInventario('listarAlmacenes', { centro });
    if (resp.ok && resp.almacenes) {
      resp.almacenes.forEach(a => {
        select.insertAdjacentHTML('beforeend', `<option value="${a.codigo_almacen}">${a.tipo_almacen} (${a.codigo_almacen})</option>`);
      });
    }
  }

  async function generarReporte() {
    const estado = document.getElementById('repEstado');
    const resultado = document.getElementById('repResultado');
    estado.textContent = 'Generando...';
    resultado.innerHTML = '';

    const body = {
      centro: document.getElementById('repCentro').value,
      almacen: document.getElementById('repAlmacen').value || undefined,
      fecha_inicial: document.getElementById('repFechaInicial').value || undefined,
      fecha_final: document.getElementById('repFechaFinal').value || undefined
    };

    const resp = await window.callBridgeInventario('generarReporteExportacion', body);
    if (!resp.ok) {
      estado.textContent = resp.error;
      return;
    }

    ultimoResultado = resp.materiales;
    estado.textContent = `${resp.total_lineas} material(es) listo(s) para exportar.`;

    if (!resp.materiales.length) {
      resultado.innerHTML = '<p class="muted">No hay materiales "OK, sin contabilizar" con esos filtros.</p>';
      return;
    }

    resultado.innerHTML = `
      <div class="row" style="margin-bottom:12px;">
        <button id="btnDescargarTxt">Descargar TXT (formato SAP)</button>
      </div>
      <div class="table-container">
        <table class="inventory-table">
          <thead><tr><th>Material</th><th>Descripción</th><th>Conteo total</th></tr></thead>
          <tbody>
            ${resp.materiales.map(m => `<tr><td>${m.material}</td><td>${m.descripcion || ''}</td><td>${m.conteo_total}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('btnDescargarTxt').addEventListener('click', descargarTxt);
  }

  function descargarTxt() {
    if (!ultimoResultado || !ultimoResultado.length) return;
    const contenido = ultimoResultado.map(m => `${m.material}|${m.conteo_total}`).join('\r\n');
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exportacion_sap_' + document.getElementById('repCentro').value + '_' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  }
})();
