// js/monitor-inventario.js
// Submódulo "Monitor de Inventarios" (supervisor/coordinador).
// Todo pasa por el bridge (Apps Script) con el token maestro — es de bajo
// volumen comparado con la Captura Móvil, no necesita ir directo a Supabase.

(function () {
  let perfil = null;
  let filasActuales = [];

  window.iniciarMonitorInventario = async function (cont, perfilRecibido) {
    perfil = perfilRecibido;
    const opcionesCentro = ['<option value="">Todos mis centros</option>']
      .concat(perfil.centros.map(c => `<option value="${c.centro}">${c.nombre_centro} (${c.centro})</option>`))
      .join('');

    cont.innerHTML = `
      <style>
        .monitor-card{border:1px solid rgba(100,116,139,0.25);border-radius:12px;padding:14px 16px;margin-bottom:12px;background:var(--card-bg);}
        .monitor-card .monitor-top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;}
        .monitor-card .monitor-meta{margin-top:6px;font-size:0.88rem;}
        .monitor-card .monitor-acciones{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
        .monitor-card .monitor-acciones button{padding:7px 12px;font-size:0.85rem;}
        .monitor-badge{font-size:0.75rem;font-weight:600;padding:2px 9px;border-radius:999px;text-transform:uppercase;}
        .monitor-badge.falta{background:#fee2e2;color:#991b1b;}
        .monitor-badge.sobra{background:#fef3c7;color:#92400e;}
        .monitor-badge.ok{background:#dcfce7;color:#166534;}
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
          <button class="alt" id="btnMonitorExportar">Exportar CSV</button>
        </div>
      </div>

      <div id="monitorLista" style="margin-top:16px;"><p class="muted">Cargando...</p></div>
    `;

    document.getElementById('btnMonitorFiltrar').addEventListener('click', cargarConteos);
    document.getElementById('btnMonitorExportar').addEventListener('click', exportarCSV);

    await cargarConteos();
  };

  async function cargarConteos() {
    const cont = document.getElementById('monitorLista');
    cont.innerHTML = '<p class="muted">Cargando...</p>';

    const filtro = {
      centro: document.getElementById('monCentro').value || undefined,
      estatus_diferencia: document.getElementById('monEstatus').value || undefined,
      verificado: document.getElementById('monVerificado').value === '' ? undefined : document.getElementById('monVerificado').value === 'true'
    };

    const resp = await window.callBridgeInventario('monitorConteos', filtro);
    if (!resp.ok) {
      cont.innerHTML = `<p class="muted">${resp.error}</p>`;
      return;
    }
    filasActuales = resp.conteos;

    if (!filasActuales.length) {
      cont.innerHTML = '<p class="muted">No hay registros con esos filtros.</p>';
      return;
    }

    cont.innerHTML = filasActuales.map(f => `
      <div class="monitor-card" data-id="${f.unique_id}">
        <div class="monitor-top">
          <strong>${f.material} — ${f.descripcion_material || 'Sin descripción'}</strong>
          <span class="monitor-badge ${f.estatus_diferencia || ''}">${f.estatus_diferencia || '—'}</span>
        </div>
        <div class="monitor-meta muted">
          ${f.nombre_centro || f.centro} · Almacén ${f.almacen} · Ubicación: ${f.ubicacion_fisica || '—'}<br/>
          Conteo: ${f.conteo} · Sistema: ${f.libre_utilizacion} · Diferencia: ${f.diferencia}<br/>
          Asignado a: ${f.usuario_asignado || '—'} · Documento: ${f.documento} ·
          Verificado: ${f.verificado ? 'Sí' : 'No'} · Preliminar: ${f.preliminar ? 'Sí' : 'No'}
        </div>
        <div class="monitor-acciones">
          <button class="alt" data-accion="verificar" data-id="${f.unique_id}">${f.verificado ? 'Quitar verificado' : 'Marcar verificado'}</button>
          <button class="alt" data-accion="preliminar" data-id="${f.unique_id}">${f.preliminar ? 'Quitar preliminar' : 'Marcar preliminar'}</button>
          <button class="alt" data-accion="reasignar" data-id="${f.unique_id}" data-centro="${f.centro}">Reasignar</button>
        </div>
      </div>
    `).join('');

    cont.querySelectorAll('button[data-accion]').forEach(btn => {
      btn.addEventListener('click', () => manejarAccion(btn));
    });
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
      await abrirReasignacion(id, btn.dataset.centro);
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

  async function abrirReasignacion(unique_id, centro) {
    const resp = await window.callBridgeInventario('listarAnalistasDelCentro', { centro });
    if (!resp.ok || !resp.analistas.length) {
      alert('No hay analistas asignados a ese centro.');
      return;
    }
    const opciones = resp.analistas.map(a => `${a.nombre} <${a.email}>`).join('\n');
    const seleccion = prompt('Escribe el email del analista al que quieres reasignar este registro:\n\n' + opciones);
    if (!seleccion) return;
    const encontrado = resp.analistas.find(a => a.email.toLowerCase() === seleccion.trim().toLowerCase());
    if (!encontrado) {
      alert('Ese email no está en la lista de analistas de ese centro.');
      return;
    }
    await actualizar(unique_id, { usuario_asignado: encontrado.email });
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
    a.download = 'monitor_inventarios_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
})();
