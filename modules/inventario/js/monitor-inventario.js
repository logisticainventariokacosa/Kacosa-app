// js/monitor-inventario.js
// Vista de "todos los conteos" para supervisor/coordinador — es lo que
// ven al entrar a "Inventario Físico". Funciona como una ALV de SAP:
// se carga un lote de datos una sola vez, y ordenar/filtrar/paginar
// trabaja sobre lo ya cargado en memoria (sin volver a pedirle nada al
// servidor por cada clic).

(function () {
  const FILAS_POR_PAGINA = 50;

  const COLUMNAS = [
    { campo: 'material', label: 'Material', tipo: 'campo_libre', validacion: 'material' },
    { campo: 'descripcion_material', label: 'Descripción', tipo: 'campo_libre', validacion: 'descripcion' },
    { campo: 'centro', label: 'Centro', tipo: 'texto', render: f => `${f.nombre_centro || f.centro}` },
    { campo: 'almacen', label: 'Almacén', tipo: 'texto' },
    { campo: 'ubicacion_fisica', label: 'Ubicación', tipo: 'campo_libre', validacion: 'ubicacion' },
    { campo: 'conteo', label: 'Conteo', tipo: 'numero' },
    { campo: 'por_sincronizar', label: 'Por sincronizar', tipo: 'numero' },
    { campo: 'libre_utilizacion', label: 'Sistema', tipo: 'numero' },
    { campo: 'diferencia', label: 'Diferencia', tipo: 'numero' },
    { campo: 'estatus_diferencia', label: 'Estatus', tipo: 'texto', render: f => `<span class="monitor-badge ${f.estatus_diferencia || ''}">${f.estatus_diferencia || '—'}</span>` },
    { campo: 'usuario_asignado', label: 'Asignado', tipo: 'texto' },
    { campo: 'documento', label: 'Documento', tipo: 'texto' },
    { campo: 'verificado', label: 'Verif.', tipo: 'booleano', render: f => f.verificado ? 'Sí' : 'No' },
    { campo: 'preliminar', label: 'Prelim.', tipo: 'booleano', render: f => f.preliminar ? 'Sí' : 'No' },
    { campo: 'fecha_ultimo_conteo', label: 'Últ. actualización', tipo: 'fecha', render: f => window.formatearFechaHora(f.fecha_ultimo_conteo) }
  ];

  let perfil = null;
  let datosCompletos = [];  // todo lo que se cargó del servidor (una vez)
  let datosVista = [];      // datosCompletos, ya filtrado + ordenado
  let paginaActual = 0;
  let filtrosColumna = {};  // campo -> definición de filtro
  let ordenCampo = 'fecha_ultimo_conteo';
  let ordenDir = 'desc';
  let analistasCache = {};

  window.iniciarMonitorInventario = async function (cont, perfilRecibido) {
    perfil = perfilRecibido;
    filtrosColumna = {};
    ordenCampo = 'fecha_ultimo_conteo';
    ordenDir = 'desc';
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
        #monitorTabla td.celda-larga{white-space:normal;word-break:break-word;overflow-wrap:break-word;max-width:220px;min-width:140px;}
        #monitorTabla th{cursor:pointer;user-select:none;}
        #monitorTabla th .filtro-icono{margin-left:6px;cursor:pointer;}
        #monitorTabla th .filtro-activo{color:#dc2626;}
        #monitorTabla .monitor-acciones{display:flex;gap:4px;flex-wrap:nowrap;}
        #monitorTabla .monitor-acciones button{padding:5px 8px;font-size:0.78rem;}
        #monitorTabla select.reasignar-select{font-size:0.8rem;padding:4px;}
        .monitor-paginacion{display:flex;justify-content:space-between;align-items:center;margin-top:10px;}
        .modal-filtro-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px;}
        .modal-filtro-overlay .search-card{max-height:80vh;overflow-y:auto;}
        .modal-filtro-overlay label{display:block;margin-top:10px;font-size:0.85rem;}
        .lista-valores{max-height:220px;overflow-y:auto;border:1px solid rgba(100,116,139,0.25);border-radius:8px;padding:8px;margin-top:6px;}
        .lista-valores label{display:flex;align-items:center;gap:8px;margin:4px 0;font-weight:400;}
        .lista-valores input[type="checkbox"]{width:auto;}
      </style>

      <div class="search-card">
        <h2>Inventario Físico — todos los conteos</h2>
        <div class="row filter-controls">
          <div class="filter-input-group">
            <label for="monCentro">Centro</label>
            <select id="monCentro" class="custom-select">${opcionesCentro}</select>
          </div>
        </div>
        <div class="row" style="margin-top:12px;">
          <button id="btnMonitorCargar">Cargar</button>
          <button class="alt" id="btnMonitorLimpiarFiltros">Quitar filtros de columna</button>
          <button class="alt" id="btnMonitorExportar">Exportar CSV (filtrado)</button>
        </div>
        <p class="muted" style="margin-top:8px;font-size:0.82rem;">
          Toca el nombre de una columna para ordenar. Toca 🔎 para filtrarla — el filtro trabaja sobre lo que ya está cargado, como en SAP.
        </p>
        <div id="monEstadoCarga" class="muted" style="margin-top:6px;"></div>
      </div>

      <div id="monitorLista" style="margin-top:16px;"><p class="muted">Cargando...</p></div>
    `;

    document.getElementById('monCentro').addEventListener('change', cargarDatos);
    document.getElementById('btnMonitorCargar').addEventListener('click', cargarDatos);
    document.getElementById('btnMonitorLimpiarFiltros').addEventListener('click', () => { filtrosColumna = {}; paginaActual = 0; aplicarYRenderizar(); });
    document.getElementById('btnMonitorExportar').addEventListener('click', exportarCSV);

    await cargarDatos();
  };

  async function cargarDatos() {
    const cont = document.getElementById('monitorLista');
    const estadoCarga = document.getElementById('monEstadoCarga');
    cont.innerHTML = '<p class="muted">Cargando...</p>';
    estadoCarga.textContent = '';

    const resp = await window.callBridgeInventario('monitorConteos', {
      centro: document.getElementById('monCentro').value || undefined
    });
    if (!resp.ok) {
      cont.innerHTML = `<p class="muted">${resp.error}</p>`;
      return;
    }

    datosCompletos = resp.conteos;
    filtrosColumna = {};
    paginaActual = 0;
    estadoCarga.textContent = resp.truncado
      ? `Se cargaron los primeros ${resp.tope} registros (hay más — usa el filtro de centro/almacén para acotar).`
      : `${datosCompletos.length} registro(s) cargado(s).`;

    aplicarYRenderizar();
  }

  function valorEsBlanco(v) {
    return v === null || v === undefined || v === '';
  }

  function pasaFiltros(fila) {
    return COLUMNAS.every(col => {
      const filtro = filtrosColumna[col.campo];
      if (!filtro) return true;
      const valor = fila[col.campo];

      if (filtro.tipo === 'valores') {
        const blanco = valorEsBlanco(valor);
        if (blanco) return filtro.incluirBlancos;
        return filtro.incluidos.has(String(valor));
      }

      if (filtro.tipo === 'numero') {
        const blanco = valorEsBlanco(valor);
        if (filtro.operador === 'is_null') return blanco;
        if (filtro.operador === 'not_null') return !blanco;
        if (blanco) return false;
        const n = Number(valor), c = Number(filtro.valor);
        switch (filtro.operador) {
          case 'eq': return n === c;
          case 'neq': return n !== c;
          case 'gt': return n > c;
          case 'gte': return n >= c;
          case 'lt': return n < c;
          case 'lte': return n <= c;
          default: return true;
        }
      }

      if (filtro.tipo === 'fecha') {
        if (!valor) return false;
        const d = new Date(valor);
        if (filtro.valor && d < new Date(filtro.valor)) return false;
        if (filtro.valor2 && d > new Date(filtro.valor2 + 'T23:59:59')) return false;
        return true;
      }

      if (filtro.tipo === 'campo_libre') {
        const blanco = valorEsBlanco(valor);
        if (blanco) return false;
        return String(valor).toLowerCase().includes(filtro.valor.toLowerCase());
      }

      return true;
    });
  }

  function aplicarYRenderizar() {
    let vista = datosCompletos.filter(pasaFiltros);

    vista.sort((a, b) => {
      const va = a[ordenCampo], vb = b[ordenCampo];
      if (valorEsBlanco(va)) return 1;
      if (valorEsBlanco(vb)) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * (ordenDir === 'asc' ? 1 : -1);
      return String(va).localeCompare(String(vb)) * (ordenDir === 'asc' ? 1 : -1);
    });

    datosVista = vista;
    renderTabla();
  }

  function renderTabla() {
    const cont = document.getElementById('monitorLista');
    if (!datosVista.length) {
      cont.innerHTML = '<p class="muted">No hay registros con esos filtros.</p>';
      return;
    }

    const totalPaginas = Math.ceil(datosVista.length / FILAS_POR_PAGINA);
    if (paginaActual >= totalPaginas) paginaActual = totalPaginas - 1;
    const inicio = paginaActual * FILAS_POR_PAGINA;
    const filasPagina = datosVista.slice(inicio, inicio + FILAS_POR_PAGINA);

    cont.innerHTML = `
      <div class="table-container">
        <table class="inventory-table" id="monitorTabla">
          <thead>
            <tr>
              ${COLUMNAS.map(encabezadoHtml).join('')}
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${filasPagina.map(filaHtml).join('')}
          </tbody>
        </table>
      </div>
      <div class="monitor-paginacion">
        <button class="alt" id="btnPagAnterior" ${paginaActual === 0 ? 'disabled' : ''}>← Anterior</button>
        <span class="muted">Página ${paginaActual + 1} de ${totalPaginas} · ${datosVista.length} registro(s)</span>
        <button class="alt" id="btnPagSiguiente" ${paginaActual >= totalPaginas - 1 ? 'disabled' : ''}>Siguiente →</button>
      </div>
    `;

    document.getElementById('btnPagAnterior').addEventListener('click', () => { paginaActual--; renderTabla(); });
    document.getElementById('btnPagSiguiente').addEventListener('click', () => { paginaActual++; renderTabla(); });

    document.querySelectorAll('#monitorTabla th[data-ordenar]').forEach(th => {
      th.addEventListener('click', (e) => {
        if (e.target.closest('.filtro-icono')) return;
        const campo = th.dataset.ordenar;
        if (ordenCampo === campo) ordenDir = ordenDir === 'asc' ? 'desc' : 'asc';
        else { ordenCampo = campo; ordenDir = 'asc'; }
        paginaActual = 0;
        aplicarYRenderizar();
      });
    });
    document.querySelectorAll('#monitorTabla .filtro-icono').forEach(icono => {
      icono.addEventListener('click', (e) => {
        e.stopPropagation();
        const col = COLUMNAS.find(c => c.campo === icono.dataset.campo);
        abrirModalFiltro(col);
      });
    });
    document.querySelectorAll('#monitorTabla button[data-accion]').forEach(btn => {
      btn.addEventListener('click', () => manejarAccion(btn));
    });
  }

  function encabezadoHtml(col) {
    const flecha = ordenCampo === col.campo ? (ordenDir === 'asc' ? ' ▲' : ' ▼') : '';
    const filtroActivo = filtrosColumna[col.campo] ? 'filtro-activo' : '';
    return `<th data-ordenar="${col.campo}">${col.label}${flecha}
      <span class="filtro-icono ${filtroActivo}" data-campo="${col.campo}" title="Filtrar">🔎</span>
    </th>`;
  }

  const COLUMNAS_TEXTO_LARGO = new Set(['descripcion_material', 'ubicacion_fisica']);

  function filaHtml(f) {
    return `
      <tr data-id="${f.unique_id}">
        ${COLUMNAS.map(col => {
          const claseLarga = COLUMNAS_TEXTO_LARGO.has(col.campo) ? ' class="celda-larga"' : '';
          const valor = col.render ? col.render(f) : (valorEsBlanco(f[col.campo]) ? '—' : f[col.campo]);
          return `<td${claseLarga}>${valor}</td>`;
        }).join('')}
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

  // ---------------------------------------------------------------------
  // Modal de filtro — checklist de valores REALES ya cargados (texto /
  // booleano), o condición numérica / rango de fecha.
  // ---------------------------------------------------------------------
  function valoresDistintos(campo) {
    const set = new Set();
    let hayBlancos = false;
    datosCompletos.forEach(f => {
      const v = f[campo];
      if (valorEsBlanco(v)) hayBlancos = true;
      else set.add(String(v));
    });
    return { valores: Array.from(set).sort(), hayBlancos };
  }

  const VALIDACIONES_CAMPO_LIBRE = {
    material: { tipoInput: 'text', inputMode: 'numeric', pattern: '[0-9]*', maxlength: 15, minlength: 3, mensaje: 'El material solo admite números, entre 3 y 15 dígitos.', validar: v => /^[0-9]{3,15}$/.test(v) },
    descripcion: { tipoInput: 'text', maxlength: 100, mensaje: 'Máximo 100 caracteres.', validar: v => v.length > 0 && v.length <= 100 },
    ubicacion: { tipoInput: 'text', maxlength: 20, mensaje: 'Máximo 20 caracteres.', validar: v => v.length > 0 && v.length <= 20 }
  };

  function abrirModalFiltro(col) {
    const actual = filtrosColumna[col.campo];
    let cuerpoHtml = '';

    if (col.tipo === 'campo_libre') {
      const val = VALIDACIONES_CAMPO_LIBRE[col.validacion];
      cuerpoHtml = `
        <label>Contiene</label>
        <input id="modalValor" type="${val.tipoInput}" inputmode="${val.inputMode || ''}"
               maxlength="${val.maxlength}" value="${actual ? actual.valor || '' : ''}"
               placeholder="Escribe para buscar en ${col.label.toLowerCase()}..." />
        <p class="muted" style="font-size:0.78rem;margin-top:4px;">${val.mensaje}</p>
        <div id="modalErrorValidacion" style="color:#dc2626;font-size:0.8rem;margin-top:4px;"></div>
      `;
    } else if (col.tipo === 'texto' || col.tipo === 'booleano') {
      const { valores, hayBlancos } = valoresDistintos(col.campo);
      const incluidos = actual && actual.tipo === 'valores' ? actual.incluidos : new Set(valores);
      const incluirBlancos = actual && actual.tipo === 'valores' ? actual.incluirBlancos : true;

      cuerpoHtml = `
        <div class="row" style="margin-top:8px;">
          <button class="alt" id="btnSelTodos" type="button">Seleccionar todos</button>
          <button class="alt" id="btnSelNinguno" type="button">Ninguno</button>
        </div>
        <div class="lista-valores">
          ${hayBlancos ? `<label><input type="checkbox" value="__blanco__" ${incluirBlancos ? 'checked' : ''}/> <em>(en blanco)</em></label>` : ''}
          ${valores.map(v => `<label><input type="checkbox" value="${v}" ${incluidos.has(v) ? 'checked' : ''}/> ${v}</label>`).join('')}
        </div>
      `;
    } else if (col.tipo === 'numero') {
      cuerpoHtml = `
        <label>Condición</label>
        <select id="modalOperador" class="custom-select">
          <option value="eq" ${actual && actual.operador === 'eq' ? 'selected' : ''}>= Igual a</option>
          <option value="neq" ${actual && actual.operador === 'neq' ? 'selected' : ''}>≠ Distinto de</option>
          <option value="gt" ${actual && actual.operador === 'gt' ? 'selected' : ''}>&gt; Mayor que</option>
          <option value="gte" ${actual && actual.operador === 'gte' ? 'selected' : ''}>&gt;= Mayor o igual</option>
          <option value="lt" ${actual && actual.operador === 'lt' ? 'selected' : ''}>&lt; Menor que</option>
          <option value="lte" ${actual && actual.operador === 'lte' ? 'selected' : ''}>&lt;= Menor o igual</option>
          <option value="is_null" ${actual && actual.operador === 'is_null' ? 'selected' : ''}>Vacío</option>
          <option value="not_null" ${actual && actual.operador === 'not_null' ? 'selected' : ''}>No vacío</option>
        </select>
        <label>Valor</label>
        <input id="modalValor" type="number" step="0.001" value="${actual ? actual.valor || '' : ''}" />
      `;
    } else if (col.tipo === 'fecha') {
      cuerpoHtml = `
        <label>Desde</label>
        <input id="modalValor" type="date" value="${actual ? actual.valor || '' : ''}" />
        <label>Hasta</label>
        <input id="modalValor2" type="date" value="${actual ? actual.valor2 || '' : ''}" />
      `;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-filtro-overlay';
    overlay.innerHTML = `
      <div class="search-card" style="max-width:360px;width:100%;">
        <h3>Filtrar: ${col.label}</h3>
        ${cuerpoHtml}
        <div class="row" style="margin-top:16px;">
          <button id="modalAplicar">Aplicar</button>
          <button class="alt" id="modalLimpiar">Quitar filtro</button>
          <button class="alt" id="modalCerrar">Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    if (col.tipo === 'texto' || col.tipo === 'booleano') {
      overlay.querySelector('#btnSelTodos').addEventListener('click', () => {
        overlay.querySelectorAll('.lista-valores input[type="checkbox"]').forEach(cb => cb.checked = true);
      });
      overlay.querySelector('#btnSelNinguno').addEventListener('click', () => {
        overlay.querySelectorAll('.lista-valores input[type="checkbox"]').forEach(cb => cb.checked = false);
      });
    }

    overlay.querySelector('#modalCerrar').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#modalLimpiar').addEventListener('click', () => {
      delete filtrosColumna[col.campo];
      overlay.remove();
      paginaActual = 0;
      aplicarYRenderizar();
    });
    overlay.querySelector('#modalAplicar').addEventListener('click', () => {
      if (col.tipo === 'campo_libre') {
        const val = VALIDACIONES_CAMPO_LIBRE[col.validacion];
        const valor = overlay.querySelector('#modalValor').value.trim();
        if (!valor) {
          delete filtrosColumna[col.campo];
        } else if (!val.validar(valor)) {
          overlay.querySelector('#modalErrorValidacion').textContent = val.mensaje;
          return; // no cierra el modal hasta que sea válido
        } else {
          filtrosColumna[col.campo] = { tipo: 'campo_libre', valor };
        }
      } else if (col.tipo === 'texto' || col.tipo === 'booleano') {
        const casillas = Array.from(overlay.querySelectorAll('.lista-valores input[type="checkbox"]'));
        const incluirBlancos = casillas.some(cb => cb.value === '__blanco__' && cb.checked);
        const incluidos = new Set(casillas.filter(cb => cb.checked && cb.value !== '__blanco__').map(cb => cb.value));
        const totalValores = casillas.filter(cb => cb.value !== '__blanco__').length;
        const todoSeleccionado = incluidos.size === totalValores && incluirBlancos === (casillas.some(cb => cb.value === '__blanco__'));
        if (todoSeleccionado) {
          delete filtrosColumna[col.campo];
        } else {
          filtrosColumna[col.campo] = { tipo: 'valores', incluidos, incluirBlancos };
        }
      } else if (col.tipo === 'numero') {
        const operador = overlay.querySelector('#modalOperador').value;
        const valor = overlay.querySelector('#modalValor').value;
        if (operador !== 'is_null' && operador !== 'not_null' && valor === '') {
          delete filtrosColumna[col.campo];
        } else {
          filtrosColumna[col.campo] = { tipo: 'numero', operador, valor };
        }
      } else if (col.tipo === 'fecha') {
        const desde = overlay.querySelector('#modalValor').value;
        const hasta = overlay.querySelector('#modalValor2').value;
        if (!desde && !hasta) {
          delete filtrosColumna[col.campo];
        } else {
          filtrosColumna[col.campo] = { tipo: 'fecha', valor: desde, valor2: hasta };
        }
      }
      overlay.remove();
      paginaActual = 0;
      aplicarYRenderizar();
    });
  }

  async function manejarAccion(btn) {
    const id = btn.dataset.id;
    const accion = btn.dataset.accion;
    const fila = datosCompletos.find(f => String(f.unique_id) === id);
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
    // Actualiza el dato en memoria (sin recargar todo) para que se sienta instantáneo.
    const fila = datosCompletos.find(f => String(f.unique_id) === unique_id);
    if (fila) Object.assign(fila, cambios);
    aplicarYRenderizar();
  }

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
    celda.querySelector('[data-cancelar]').addEventListener('click', () => renderTabla());
  }

  function exportarCSV() {
    if (!datosVista.length) {
      alert('No hay datos para exportar con los filtros actuales.');
      return;
    }
    const columnas = COLUMNAS.map(c => c.campo);
    const encabezado = columnas.join(',');
    const filas = datosVista.map(f => columnas.map(c => {
      const v = valorEsBlanco(f[c]) ? '' : String(f[c]).replace(/"/g, '""');
      return `"${v}"`;
    }).join(','));
    const csv = [encabezado].concat(filas).join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventario_fisico_conteos_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
})();
