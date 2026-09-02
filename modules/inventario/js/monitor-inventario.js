// js/monitor-inventario.js
// Submódulo "Monitor de Inventarios" (supervisor/coordinador).
// Todo pasa por el bridge (Apps Script) con el token maestro — es de bajo
// volumen comparado con la Captura Móvil, no necesita ir directo a Supabase.
//
// Vista en TABLA (no tarjetas) con paginación, porque en producción esto
// puede tener miles de registros — cargarlos todos de una vez o mostrarlos
// como tarjetas grandes no escala.

(function () {
  const TAMANO_PAGINA = 50;

  let perfil = null;
  let filasActuales = [];
  let paginaActual = 0;
  let hayMasPaginas = false;
  let analistasCache = {}; // centro -> [{id_analista, nombre, email}]

  window.iniciarMonitorInventario = async function (cont, perfilRecibido) {
    perfil = perfilRecibido;
    const opcionesCentro = ['<option value="">Todos mis centros</option>']
      .concat(perfil.centros.map(c => `<option value="${c.centro}">${c.nombre_centro} (${c.centro})</option>`))
      .join('');

    cont.innerHTML = `
      <style>
        .monitor-badge{font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:999px;text-transform:uppercase;white-space:nowrap;}
        .monitor-badge.falta{background:#fee2e2;color:#991b1b;}
        .monitor-badge.sobra{background:#fef3c7;color:#92400e;}
        .monitor-badge.ok{background:#dcfce7;color:#166534;}
        #monitorTabla td, #monitorTabla th{white-space:nowrap;}
        #monitorTabla .monitor-acciones{display:flex;gap:4px;flex-wrap:nowrap;}
        #monitorTabla .monitor-acciones button{padding:5px 8px;font-size:0.78rem;}
        #monitorTabla select.reasignar-select{font-size:0.8rem;padding:4px;}
        .monitor-paginacion{display:flex;justify-content:space-between;align-items:center;margin-top:10px;}
      </style>

      <div class="search-card">
        <h2>Monitor de Inventarios</h2>
        <div class="row filter-controls">
          <div class="filter-input-group">
            <label for="monCentro">Centro</label>
            <select id="monCentro" class="custom-select">${opcionesCentro}</select>
          </div>
          <div class="filter-input-group">
            <label for="monEstatus">Estatus diferencia</label>
            <select id="monEstatus" class="custom-select">
              <option value="">Todos</option>
              <option value="falta">Falta</option>
              <option value="sobra">Sobra</option>
              <option value="ok">OK</option>
            </select>
          </div>
          <div class="filter-input-group">
            <label for="monVerificado">Verificado</label>
            <select id="monVerificado" class="custom-select">
              <option value="">Todos</option>
              <option value="false">Pendientes</option>
              <option value="true">Verificados</option>
            </select>
          </div>
        </div>
        <div class="row" style="margin-top:12px;">
          <button id="btnMonitorFiltrar">Filtrar</button>
          <button class="alt" id="btnMonitorExportar">Exportar CSV (esta página)</button>
        </div>
      </div>

      <div id="monitorLista" style="margin-top:16px;"><p class="muted">Cargando...</p></div>
    `;

    document.getElementById('btnMonitorFiltrar').addEventListener('click', () => { paginaActual = 0; cargarConteos(); });
    document.getElementById('btnMonitorExportar').addEventListener('click', exportarCSV);

    paginaActual = 0;
    await cargarConteos();
  };

  function filtroActual() {
    return {
      centro: document.getElementById('monCentro').value || undefined,
      estatus_diferencia: document.getElementById('monEstatus').value || undefined,
      verificado: document.getElementById('monVerificado').value === '' ? undefined : document.getElementById('monVerificado').value === 'true',
      offset: paginaActual * TAMANO_PAGINA,
      limit: TAMANO_PAGINA
    };
  }

  async function cargarConteos() {
    const cont = document.getElementById('monitorLista');
    cont.innerHTML = '<p class="muted">Cargando...</p>';

    const resp = await window.callBridgeInventario('monitorConteos', filtroActual());
    if (!resp.ok) {
      cont.innerHTML = `<p class="muted">${resp.error}</p>`;
      return;
    }
    filasActuales = resp.conteos;
    // Pedimos un elemento de más para saber si hay siguiente página, sin
    // depender de un COUNT(*) aparte (más barato en Apps Script/Supabase).
    hayMasPaginas = filasActuales.length > TAMANO_PAGINA;
    if (hayMasPaginas) filasActuales = filasActuales.slice(0, TAMANO_PAGINA);

    if (!filasActuales.length) {
      cont.innerHTML = paginaActual === 0
        ? '<p class="muted">No hay registros con esos filtros.</p>'
        : '<p class="muted">No hay más registros.</p>';
      return;
    }

    cont.innerHTML = `
      <div class="table-container">
        <table class="inventory-table" id="monitorTabla">
          <thead>
            <tr>
              <th>Material</th>
              <th>Centro / Almacén</th>
              <th>Ubicación</th>
              <th>Conteo</th>
              <th>Sistema</th>
              <th>Diferencia</th>
              <th>Estatus</th>
              <th>Asignado</th>
              <th>Documento</th>
              <th>Verif.</th>
              <th>Prelim.</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${filasActuales.map(filaHtml).join('')}
          </tbody>
        </table>
      </div>
      <div class="monitor-paginacion">
        <button class="alt" id="btnPagAnterior" ${paginaActual === 0 ? 'disabled' : ''}>← Anterior</button>
        <span class="muted">Página ${paginaActual + 1}</span>
        <button class="alt" id="btnPagSiguiente" ${hayMasPaginas ? '' : 'disabled'}>Siguiente →</button>
      </div>
    `;

    document.getElementById('btnPagAnterior').addEventListener('click', () => { paginaActual--; cargarConteos(); });
    document.getElementById('btnPagSiguiente').addEventListener('click', () => { paginaActual++; cargarConteos(); });

    document.querySelectorAll('#monitorTabla button[data-accion]').forEach(btn => {
      btn.addEventListener('click', () => manejarAccion(btn));
    });
  }

  function filaHtml(f) {
    return `
      <tr data-id="${f.unique_id}">
        <td>${f.material}<br/><span class="muted" style="font-weight:400;">${f.descripcion_material || ''}</span></td>
        <td>${f.nombre_centro || f.centro}<br/>${f.almacen}</td>
        <td>${f.ubicacion_fisica || '—'}</td>
        <td>${f.conteo}</td>
        <td>${f.libre_utilizacion}</td>
        <td>${f.diferencia}</td>
        <td><span class="monitor-badge ${f.estatus_diferencia || ''}">${f.estatus_diferencia || '—'}</span></td>
        <td>${f.usuario_asignado || '—'}</td>
        <td>${f.documento}</td>
        <td>${f.verificado ? 'Sí' : 'No'}</td>
        <td>${f.preliminar ? 'Sí' : 'No'}</td>
        <td>
          <div class="monitor-acciones">
            <button class="alt" data-accion="verificar" data-id="${f.unique_id}">${f.verificado ? 'Desverif.' : 'Verificar'}</button>
            <button class="alt" data-accion="preliminar" data-id="${f.unique_id}">${f.preliminar ? 'Quitar prelim.' : 'Preliminar'}</button>
            <button class="alt" data-accion="reasignar" data-id="${f.unique_id}" data-centro="${f.centro}">Reasignar</button>
          </div>
        </td>
      </tr>
    `;
  }

  async function manejarAccion(btn) {
    const id = btn.dataset.id;
    const accion = btn.dataset.accion;
    const fila = filasActuales.find(f => String(f.unique_id) === id);
    if (!fila) return;

    if (accion === 'verificar') {
      await actualizar(id, { verificado: !fila.verificado });
    } else if (accion === 'preliminar') {
      await actualizar(id, { preliminar: !fila.preliminar });
    } else if (accion === 'reasignar') {
      await mostrarSelectorReasignacion(id, btn.dataset.centro);
    }
  }

  async function actualizar(unique_id, cambios) {
    const resp = await window.callBridgeInventario('actualizarConteoMonitor', Object.assign({ unique_id }, cambios));
    if (!resp.ok) {
      alert('No se pudo actualizar: ' + resp.error);
      return;
    }
    await cargarConteos();
  }

  /** Reemplaza la celda de acciones por un <select> con Nombre Apellido (no el email). */
  async function mostrarSelectorReasignacion(unique_id, centro) {
    const fila = document.querySelector('#monitorTabla tr[data-id="' + unique_id + '"]');
    const celda = fila.querySelector('td:last-child');
    celda.innerHTML = '<span class="muted">Cargando analistas...</span>';

    if (!analistasCache[centro]) {
      const resp = await window.callBridgeInventario('listarAnalistasDelCentro', { centro });
      if (!resp.ok) {
        celda.innerHTML = `<span class="muted">${resp.error}</span>`;
        return;
      }
      analistasCache[centro] = resp.analistas;
    }

    const analistas = analistasCache[centro];
    if (!analistas.length) {
      celda.innerHTML = '<span class="muted">Sin analistas en ese centro.</span>';
      return;
    }

    celda.innerHTML = `
      <div class="monitor-acciones">
        <select class="reasignar-select">
          ${analistas.map(a => `<option value="${a.email}">${a.nombre}</option>`).join('')}
        </select>
        <button data-confirmar="1">OK</button>
        <button class="alt" data-cancelar="1">X</button>
      </div>
    `;

    celda.querySelector('[data-confirmar]').addEventListener('click', async () => {
      const email = celda.querySelector('select').value;
      await actualizar(unique_id, { usuario_asignado: email });
    });
    celda.querySelector('[data-cancelar]').addEventListener('click', () => cargarConteos());
  }

  function exportarCSV() {
    if (!filasActuales.length) {
      alert('No hay datos para exportar con los filtros actuales.');
      return;
    }
    const columnas = ['material', 'descripcion_material', 'centro', 'almacen', 'ubicacion_fisica', 'conteo', 'libre_utilizacion', 'diferencia', 'estatus_diferencia', 'usuario_asignado', 'documento', 'verificado', 'preliminar', 'fecha_ultimo_conteo'];
    const encabezado = columnas.join(',');
    const filas = filasActuales.map(f => columnas.map(c => {
      const v = f[c] === null || f[c] === undefined ? '' : String(f[c]).replace(/"/g, '""');
      return `"${v}"`;
    }).join(','));
    const csv = [encabezado].concat(filas).join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'monitor_inventarios_pagina' + (paginaActual + 1) + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
})();
