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
      if (typeof window.iniciarCapturaMovil === 'function') {
        await window.iniciarCapturaMovil(cont, perfilActual);
      } else {
        cont.innerHTML = '<p class="muted">La Captura Móvil todavía no está disponible.</p>';
      }
      return;
    }

    renderConSubpestanas(cont);
  }

  function renderConSubpestanas(cont) {
    cont.innerHTML = `
      <div class="row" style="gap:8px;margin-bottom:16px;">
        <button id="tabApertura">Apertura / Control</button>
        <button class="alt" id="tabMonitor">Monitor</button>
        <button class="alt" id="tabReportes">Reportes SAP</button>
      </div>
      <div id="fisicoSub"></div>
    `;
    const sub = document.getElementById('fisicoSub');

    function marcarActiva(idActivo) {
      ['tabApertura', 'tabMonitor', 'tabReportes'].forEach(id => {
        document.getElementById(id).className = id === idActivo ? '' : 'alt';
      });
    }

    document.getElementById('tabApertura').addEventListener('click', () => {
      marcarActiva('tabApertura');
      render(sub);
      refrescarListado();
    });
    document.getElementById('tabMonitor').addEventListener('click', () => {
      marcarActiva('tabMonitor');
      if (typeof window.iniciarMonitorInventario === 'function') {
        window.iniciarMonitorInventario(sub, perfilActual);
      } else {
        sub.innerHTML = '<p class="muted">El Monitor todavía no está disponible.</p>';
      }
    });
    document.getElementById('tabReportes').addEventListener('click', () => {
      marcarActiva('tabReportes');
      if (typeof window.iniciarReportesInventario === 'function') {
        window.iniciarReportesInventario(sub, perfilActual);
      } else {
        sub.innerHTML = '<p class="muted">Los Reportes todavía no están disponibles.</p>';
      }
    });

    // Vista inicial: Apertura / Control.
    render(sub);
    refrescarListado();
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
      <style>
        .fisico-inv-card{border:1px solid rgba(100,116,139,0.25);border-radius:12px;padding:14px 16px;margin-bottom:12px;background:var(--card-bg);}
        .fisico-inv-card .fisico-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}
        .fisico-inv-card .fisico-titulo{font-weight:600;}
        .fisico-badge{font-size:0.78rem;font-weight:600;padding:3px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;}
        .fisico-badge.abierto{background:#dcfce7;color:#166534;}
        .fisico-badge.pausado{background:#fef3c7;color:#92400e;}
        .fisico-badge.cerrado{background:#e2e8f0;color:#334155;}
        .fisico-badge.cancelado{background:#fee2e2;color:#991b1b;}
        html.kacosa-dark .fisico-badge.abierto{background:#14532d;color:#bbf7d0;}
        html.kacosa-dark .fisico-badge.pausado{background:#78350f;color:#fde68a;}
        html.kacosa-dark .fisico-badge.cerrado{background:#334155;color:#e2e8f0;}
        html.kacosa-dark .fisico-badge.cancelado{background:#7f1d1d;color:#fecaca;}
        .fisico-inv-card .fisico-meta{margin-top:6px;font-size:0.9rem;}
        .fisico-inv-card .fisico-acciones{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
        .fisico-inv-card .fisico-acciones button{padding:8px 14px;font-size:0.9rem;}
      </style>
      <div id="listaInventarios"></div>
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
    const cont = document.getElementById('listaInventarios');
    if (!cont) return;
    cont.innerHTML = '<p class="muted">Cargando...</p>';

    const resp = await window.callBridgeInventario('listarInventarios', {});
    if (!resp.ok) {
      cont.innerHTML = `<p class="muted">${resp.error}</p>`;
      return;
    }
    if (!resp.inventarios.length) {
      cont.innerHTML = '<p class="muted">No hay inventarios registrados todavía.</p>';
      return;
    }

    cont.innerHTML = resp.inventarios.map(inv => `
      <div class="fisico-inv-card">
        <div class="fisico-top">
          <span class="fisico-titulo">${inv.nombre_centro || inv.centro} · Almacén ${inv.almacen}</span>
          <span class="fisico-badge ${inv.estado}">${inv.estado}</span>
        </div>
        <div class="fisico-meta muted">
          Apertura: ${new Date(inv.fecha_apertura).toLocaleDateString('es-VE')} ·
          Días transcurridos: ${inv.dias_transcurridos}
        </div>
        <div class="fisico-acciones">${botonesAccion(inv)}</div>
      </div>
    `).join('');

    cont.querySelectorAll('button[data-accion]').forEach(btn => {
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
        <button data-accion="abierto" data-id="${inv.id_inventario}">Reanudar</button>
        <button class="alt" data-accion="cerrado" data-id="${inv.id_inventario}">Cerrar</button>
      `;
    }
    return '<span class="muted">Sin acciones disponibles</span>';
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
