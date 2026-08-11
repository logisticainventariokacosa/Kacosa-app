// js/tabla-utils.js
// Utilidades para crear tablas con paginación, ordenamiento y búsqueda

export function crearTablaPaginada(container, columnas, itemsPorPagina = 50) {
  let datos = [];
  let paginaActual = 1;
  let totalPaginas = 0;
  let ordenActual = { columna: null, direccion: 'asc' };
  let datosFiltrados = [];

  function renderizar(datosEntrada) {
    datos = datosEntrada || [];
    datosFiltrados = [...datos];
    paginaActual = 1;
    renderizarTabla();
  }

  function renderizarTabla() {
    // Aplicar ordenamiento
    const datosOrdenados = ordenarDatos(datosFiltrados);
    
    totalPaginas = Math.max(1, Math.ceil(datosOrdenados.length / itemsPorPagina));
    if (paginaActual > totalPaginas) paginaActual = totalPaginas;
    
    const inicio = (paginaActual - 1) * itemsPorPagina;
    const fin = Math.min(inicio + itemsPorPagina, datosOrdenados.length);
    const paginaDatos = datosOrdenados.slice(inicio, fin);

    let html = `
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              ${columnas.map(col => `
                <th data-key="${col.key}" style="cursor:pointer; user-select:none" title="Clic para ordenar">
                  ${col.label}
                  ${ordenActual.columna === col.key ? (ordenActual.direccion === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
    `;

    if (paginaDatos.length === 0) {
      html += `<tr><td colspan="${columnas.length}" style="text-align:center; padding:30px; color:var(--texto-claro)">No hay datos para mostrar</td></tr>`;
    } else {
      paginaDatos.forEach(item => {
        html += `<tr>`;
        columnas.forEach(col => {
          let valor = item[col.key] !== undefined ? item[col.key] : '';
          // Formatear valores especiales
          if (col.key === 'clase') {
            valor = `<span class="clase-badge clase-${String(valor).toLowerCase()}">${valor}</span>`;
          } else if (col.numeric && typeof valor === 'number') {
            valor = Math.round(valor * 100) / 100;
          }
          html += `<td>${valor}</td>`;
        });
        html += `</tr>`;
      });
    }

    html += `
          </tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; flex-wrap:wrap; gap:10px">
        <span style="font-size:13px; color:var(--texto-secundario)">
          Mostrando ${datosOrdenados.length > 0 ? inicio + 1 : 0} - ${fin} de ${datosOrdenados.length} materiales
        </span>
        <div style="display:flex; gap:6px; flex-wrap:wrap">
          <button class="btn-pagina" data-pagina="1" ${paginaActual === 1 ? 'disabled' : ''} 
                  style="padding:6px 12px; border:1px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); cursor:pointer; ${paginaActual === 1 ? 'opacity:0.5;cursor:default' : ''}">
            ⟪
          </button>
          <button class="btn-pagina" data-pagina="${paginaActual - 1}" ${paginaActual <= 1 ? 'disabled' : ''}
                  style="padding:6px 12px; border:1px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); cursor:pointer; ${paginaActual <= 1 ? 'opacity:0.5;cursor:default' : ''}">
            ◀
          </button>
          <span style="padding:6px 14px; background:var(--azul-base); color:#fff; border-radius:var(--radio-peq); font-weight:600; font-size:13px">
            ${paginaActual} / ${totalPaginas}
          </span>
          <button class="btn-pagina" data-pagina="${paginaActual + 1}" ${paginaActual >= totalPaginas ? 'disabled' : ''}
                  style="padding:6px 12px; border:1px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); cursor:pointer; ${paginaActual >= totalPaginas ? 'opacity:0.5;cursor:default' : ''}">
            ▶
          </button>
          <button class="btn-pagina" data-pagina="${totalPaginas}" ${paginaActual === totalPaginas ? 'disabled' : ''}
                  style="padding:6px 12px; border:1px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); cursor:pointer; ${paginaActual === totalPaginas ? 'opacity:0.5;cursor:default' : ''}">
            ⟫
          </button>
        </div>
        <select id="filas-por-pagina" style="padding:4px 8px; border:1px solid var(--borde); border-radius:var(--radio-peq); font-size:12px">
          <option value="25">25</option>
          <option value="50" selected>50</option>
          <option value="100">100</option>
          <option value="200">200</option>
        </select>
      </div>
    `;

    container.innerHTML = html;

    // Eventos de paginación
    container.querySelectorAll('.btn-pagina').forEach(btn => {
      btn.addEventListener('click', () => {
        const pagina = parseInt(btn.dataset.pagina);
        if (!isNaN(pagina) && pagina !== paginaActual && pagina >= 1 && pagina <= totalPaginas) {
          paginaActual = pagina;
          renderizarTabla();
        }
      });
    });

    // Cambiar cantidad de items por página
    const selectFilas = container.querySelector('#filas-por-pagina');
    if (selectFilas) {
      selectFilas.value = itemsPorPagina;
      selectFilas.addEventListener('change', (e) => {
        itemsPorPagina = parseInt(e.target.value);
        paginaActual = 1;
        renderizarTabla();
      });
    }

    // Eventos de ordenamiento
    container.querySelectorAll('thead th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (ordenActual.columna === key) {
          ordenActual.direccion = ordenActual.direccion === 'asc' ? 'desc' : 'asc';
        } else {
          ordenActual.columna = key;
          ordenActual.direccion = 'asc';
        }
        renderizarTabla();
      });
    });
  }

  function ordenarDatos(datosArr) {
    if (!ordenActual.columna) return datosArr;
    
    const col = ordenActual.columna;
    const dir = ordenActual.direccion === 'asc' ? 1 : -1;
    
    return [...datosArr].sort((a, b) => {
      let valA = a[col];
      let valB = b[col];
      
      // Manejar valores nulos/undefined
      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';
      
      // Comparación numérica vs texto
      if (typeof valA === 'number' && typeof valB === 'number') {
        return (valA - valB) * dir;
      }
      
      // Para texto, incluyendo códigos que pueden ser numéricos como string
      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      return strA.localeCompare(strB, 'es', { numeric: true }) * dir;
    });
  }

  return { renderizar };
}
