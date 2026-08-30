// js/inventario-fisico.js
// Submódulo "Apertura / Control de Inventario" (Toma Física de Inventarios).
// Solo visible/útil para supervisor y coordinador (el analista no gestiona
// inventarios, solo cuenta — ver Fase 2b: Captura Móvil).

(function () {
  let perfilActual = null; // { rol, centros: [{centro, nombre_centro}] }

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
    perfilActual = resp;

    if (resp.rol === 'analista') {
      cont.innerHTML = '<p class="muted">Este submódulo es solo para supervisores y coordinadores. Usa "Captura Móvil" para registrar tus conteos.</p>';
      return;
    }

    render(cont);
    await refrescarListado();
  }

  function render(cont) {
    const opcionesCentro = perfilActual.centros
      .map(c => `<option value="${c.centro}">${c.nombre_centro} (${c.centro})</option>`)
      .join('');

    cont.innerHTML = `
      <div class="search-card">
        <h2>Abrir nuevo inventario</h2>
        <div class="row filter-controls">
          <div class="filter-input-group">
            <label for="fisicoCentro">Centro</label>
            <select id="fisicoCentro" class="custom-select">${opcionesCentro}</select>
          </div>
          <div class="filter-input-group">
            <label for="fisicoAlmacen">Almacén</label>
            <select id="fisicoAlmacen" class="custom-select">
              <option value="">Cargando...</option>
            </select>
          </div>
        </div>
        <input id="fisicoComentarios" placeholder="Comentarios (opcional)" style="margin-top:10px;" />
        <div class="row" style="margin-top:14px;">
          <button id="btnAbrirInventario">Abrir inventario</button>
        </div>
        <div id="fisicoAbrirStatus" class="muted" style="margin-top:8px;"></div>
      </div>

      <h3 style="margin-top:30px;margin-bottom:15px">Inventarios</h3>
      <div class="table-container">
        <table class="inventory-table" id="tablaInventarios">
          <thead>
            <tr>
              <th>Centro</th>
              <th>Almacén</th>
              <th>Estado</th>
              <th>Días transcurridos</th>
              <th>Apertura</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;

    document.getElementById('fisicoCentro').addEventListener('change', cargarAlmacenesDelCentro);
    document.getElementById('btnAbrirInventario').addEventListener('click', abrirInventario);

    cargarAlmacenesDelCentro();
  }

  async function cargarAlmacenesDelCentro() {
    const centro = document.getElementById('fisicoCentro').value;
    const select = document.getElementById('fisicoAlmacen');
    select.innerHTML = '<option value="">Cargando...</option>';

    // Reutiliza la tabla maestro_almacenes vía una consulta directa: como es
    // de solo lectura y de bajo volumen, se pide al bridge un listado simple.
    const resp = await window.callBridgeInventario('listarAlmacenes', { centro });
    if (!resp.ok || !resp.almacenes || !resp.almacenes.length) {
      select.innerHTML = '<option value="">Sin almacenes registrados</option>';
      return;
    }
    select.innerHTML = resp.almacenes
      .map(a => `<option value="${a.codigo_almacen}">${a.tipo_almacen} (${a.codigo_almacen})</option>`)
      .join('');
  }

  async function abrirInventario() {
    const centro = document.getElementById('fisicoCentro').value;
    const almacen = document.getElementById('fisicoAlmacen').value;
    const comentarios = document.getElementById('fisicoComentarios').value.trim();
    const status = document.getElementById('fisicoAbrirStatus');

    if (!centro || !almacen) {
      status.textContent = 'Selecciona centro y almacén.';
      return;
    }

    status.textContent = 'Abriendo...';
    const resp = await window.callBridgeInventario('abrirInventario', { centro, almacen, comentarios });
    status.textContent = resp.ok ? 'Inventario abierto correctamente.' : resp.error;
    if (resp.ok) {
      document.getElementById('fisicoComentarios').value = '';
      await refrescarListado();
    }
  }

  async function refrescarListado() {
    const tbody = document.querySelector('#tablaInventarios tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Cargando...</td></tr>';

    const resp = await window.callBridgeInventario('listarInventarios', {});
    if (!resp.ok) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">${resp.error}</td></tr>`;
      return;
    }
    if (!resp.inventarios.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No hay inventarios registrados todavía.</td></tr>';
      return;
    }

    tbody.innerHTML = resp.inventarios.map(inv => `
      <tr>
        <td>${inv.nombre_centro || inv.centro}</td>
        <td>${inv.almacen}</td>
        <td>${inv.estado}</td>
        <td>${inv.dias_transcurridos}</td>
        <td>${new Date(inv.fecha_apertura).toLocaleDateString('es-VE')}</td>
        <td>${botonesAccion(inv)}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('button[data-accion]').forEach(btn => {
      btn.addEventListener('click', () => cambiarEstado(btn.dataset.id, btn.dataset.accion));
    });
  }

  function botonesAccion(inv) {
    if (inv.estado === 'abierto') {
      return `
        <button class="alt" data-accion="pausado" data-id="${inv.id_inventario}">Pausar</button>
        <button class="alt" data-accion="cerrado" data-id="${inv.id_inventario}">Cerrar</button>
      `;
    }
    if (inv.estado === 'pausado') {
      return `
        <button class="alt" data-accion="abierto" data-id="${inv.id_inventario}">Reanudar</button>
        <button class="alt" data-accion="cerrado" data-id="${inv.id_inventario}">Cerrar</button>
      `;
    }
    return '—';
  }

  async function cambiarEstado(idInventario, nuevoEstado) {
    const etiquetas = { pausado: 'pausar', cerrado: 'cerrar', abierto: 'reanudar' };
    if (nuevoEstado === 'cerrado' && !confirm('¿Cerrar este inventario? No se podrá editar el conteo después.')) {
      return;
    }
    const resp = await window.callBridgeInventario('cambiarEstadoInventario', {
      id_inventario: idInventario,
      nuevo_estado: nuevoEstado
    });
    if (!resp.ok) {
      alert('No se pudo ' + etiquetas[nuevoEstado] + ': ' + resp.error);
      return;
    }
    await refrescarListado();
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
