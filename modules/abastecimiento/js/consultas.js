// js/consultas.js
// Submódulo "Consultas": permite filtrar los análisis guardados (tabla
// "analisis" en Supabase) por centro(s), material(es) y rango de fecha —
// al estilo de una consulta transaccional de SAP — y ver los resultados en
// detalle o resumidos (sumados) por material.
//
// OJO — LIMITACIÓN IMPORTANTE que hay que tener presente: guardarAnalisis_()
// en el backend borra el análisis anterior de cada combinación usuario+tienda
// antes de guardar uno nuevo (solo se conserva el ÚLTIMO por usuario y
// tienda). Esta consulta por lo tanto NO es un histórico completo de todo lo
// que se ha analizado alguna vez — solo encuentra lo que siga existiendo como
// "último análisis guardado" de alguien a la fecha de la consulta.
import { callBridge } from "./bridge.js";
import { crearTablaPaginada } from "./tabla-utils.js";
import { TIENDAS, centrosDeTienda } from "./tiendas.js";
import { construirHojaEstilizada } from "./excel-estilos.js";
import { notificarExito } from "./notificaciones.js";

let ultimoResultado = [];   // detalle tal cual vino del servidor (con el filtro aplicado)
let vistaActual = "detalle"; // 'detalle' | 'resumen'  (solo aplica cuando modoConsulta === 'general')
let modoConsulta = "general"; // 'general' | 'a_pedir' | 'pendiente'

const ETIQUETAS_MODO = {
  a_pedir: "A pedir",
  pendiente: "Pendiente"
};

function render() {
  const cont = document.getElementById("consultas-contenido");
  if (!cont) return;

  const checkboxesTiendas = TIENDAS.map(t => `
    <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; padding:4px 0; cursor:pointer">
      <input type="checkbox" class="chk-tienda-consulta" value="${t.id}">
      ${t.nombre}
    </label>
  `).join("");

  cont.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0; font-size:15px; color:var(--texto-titulo)">Filtros</h3>
      <p class="vista-sub" style="margin-top:-4px">Especifica al menos un filtro (tienda/centro, material, o rango de fecha) antes de consultar.</p>

      <div style="display:grid; grid-template-columns:1fr; gap:18px; margin-top:10px">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center">
            <label class="form-label" style="margin-bottom:0">Tienda(s) / Centro(s)</label>
            <button type="button" id="btn-toggle-todas-tiendas" style="background:none; border:none; color:var(--texto-titulo); font-size:12px; font-weight:600; cursor:pointer; text-decoration:underline">Marcar/desmarcar todas</button>
          </div>
          <div id="lista-tiendas-consulta" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(160px,1fr)); gap:2px; max-height:180px; overflow-y:auto; border:1.5px solid var(--borde); border-radius:var(--radio-peq); padding:10px; margin-top:6px">
            ${checkboxesTiendas}
          </div>
        </div>

        <div>
          <label class="form-label" for="consulta-materiales">Material(es) / Descripción</label>
          <textarea id="consulta-materiales" class="input-modern" rows="2"
            placeholder="Códigos exactos y/o palabras a buscar en la descripción, separados por coma o salto de línea. Ej: 1000000163, capacitor, condensador, minerales. Déjalo vacío para no filtrar."
            style="resize:vertical; font-family:inherit"></textarea>
          <p class="vista-sub" style="margin:4px 0 0 0; font-size:11.5px">Los números se buscan como código exacto; el resto se busca dentro de la descripción (sin importar mayúsculas). Se trae todo lo que coincida con cualquiera de los términos.</p>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px">
          <div>
            <label class="form-label" for="consulta-fecha-desde">Fecha desde</label>
            <input type="date" id="consulta-fecha-desde" class="input-modern">
          </div>
          <div>
            <label class="form-label" for="consulta-fecha-hasta">Fecha hasta</label>
            <input type="date" id="consulta-fecha-hasta" class="input-modern">
          </div>
        </div>

        <div>
          <label class="form-label">¿Qué quieres consultar?</label>
          <div style="display:flex; flex-wrap:wrap; gap:16px; margin-top:4px">
            <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer">
              <input type="radio" name="modo-consulta" value="general" checked> General (todas las columnas, detalle + resumen)
            </label>
            <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer">
              <input type="radio" name="modo-consulta" value="a_pedir"> Total "A pedir" por material
            </label>
            <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer">
              <input type="radio" name="modo-consulta" value="pendiente"> Total "Pendiente" por material
            </label>
          </div>
          <p class="vista-sub" style="margin:4px 0 0 0; font-size:11.5px">Las dos últimas opciones traen un solo renglón por material (sin repetir código), ya sumado entre todas las tiendas/filtros elegidos.</p>
        </div>
      </div>

      <div class="btn-group" style="margin-top:18px">
        <button id="btn-consultar" class="btn-primario"><i class="fa-solid fa-magnifying-glass"></i> Consultar</button>
        <button id="btn-limpiar-consulta" class="btn-secundario"><i class="fa-solid fa-broom"></i> Limpiar filtros</button>
      </div>
      <p id="consulta-estado" class="estado-texto" style="margin-top:10px"></p>
    </div>

    <div id="consulta-resultados"></div>
  `;

  document.getElementById("btn-toggle-todas-tiendas").addEventListener("click", () => {
    const checks = cont.querySelectorAll(".chk-tienda-consulta");
    const algunaSinMarcar = [...checks].some(c => !c.checked);
    checks.forEach(c => { c.checked = algunaSinMarcar; });
  });

  document.getElementById("btn-consultar").addEventListener("click", ejecutarConsulta);
  document.getElementById("btn-limpiar-consulta").addEventListener("click", () => render());
}

async function ejecutarConsulta() {
  const estadoTexto = document.getElementById("consulta-estado");
  const btnConsultar = document.getElementById("btn-consultar");

  const centrosSeleccionados = [...document.querySelectorAll(".chk-tienda-consulta:checked")]
    .flatMap(chk => centrosDeTienda(chk.value));

  const materiales = (document.getElementById("consulta-materiales").value || "")
    .split(/[,;\n]+/)
    .map(m => m.trim())
    .filter(Boolean);

  const fechaDesde = document.getElementById("consulta-fecha-desde").value || null;
  const fechaHasta = document.getElementById("consulta-fecha-hasta").value || null;

  if (centrosSeleccionados.length === 0 && materiales.length === 0 && !fechaDesde && !fechaHasta) {
    estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Especifica al menos un filtro: tienda/centro, material, o rango de fecha.';
    estadoTexto.style.color = 'var(--rojo-alerta)';
    return;
  }

  btnConsultar.disabled = true;
  btnConsultar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Consultando...';
  estadoTexto.textContent = "";
  document.getElementById("consulta-resultados").innerHTML = "";

  try {
    const resp = await callBridge("consultarAnalisis", {
      centros: [...new Set(centrosSeleccionados)],
      materiales,
      fechaDesde,
      fechaHasta
    });

    if (!resp.ok) {
      estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + (resp.error || "No se pudo consultar.");
      estadoTexto.style.color = 'var(--rojo-alerta)';
      return;
    }

    ultimoResultado = dedupUltimoPorTiendaYMaterial(resp.materiales || []);
    modoConsulta = (document.querySelector('input[name="modo-consulta"]:checked') || {}).value || "general";
    vistaActual = "detalle";
    estadoTexto.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${ultimoResultado.length} fila(s) encontrada(s).`;
    estadoTexto.style.color = 'var(--verde-kpi)';
    mostrarResultadosConsulta();
  } catch (err) {
    estadoTexto.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error: ' + err.message;
    estadoTexto.style.color = 'var(--rojo-alerta)';
  } finally {
    btnConsultar.disabled = false;
    btnConsultar.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Consultar';
  }
}

/**
 * Se queda con UN SOLO renglón por combinación tienda+material: el más
 * reciente según creadoEn. Es indispensable antes de sumar nada, porque
 * guardarAnalisis_() en el backend solo borra el análisis anterior de la
 * MISMA combinación usuario+tienda — si dos usuarios distintos analizaron la
 * misma tienda (cada uno con su propia cuenta), ambos análisis conviven en la
 * tabla al mismo tiempo. Sin este filtro, un material terminaría sumado dos
 * (o más) veces para la misma tienda.
 */
function dedupUltimoPorTiendaYMaterial(materiales) {
  const mapa = new Map();
  materiales.forEach(m => {
    const clave = `${m.tienda}||${m.codigo}`;
    const existente = mapa.get(clave);
    if (!existente || new Date(m.creadoEn) > new Date(existente.creadoEn)) {
      mapa.set(clave, m);
    }
  });
  return [...mapa.values()];
}

/** Agrupa el detalle por material, sumando las columnas numéricas (igual que "totales por material" en SAP). */
function agruparPorMaterial(materiales) {
  const mapa = {};
  materiales.forEach(m => {
    if (!mapa[m.codigo]) {
      mapa[m.codigo] = {
        codigo: m.codigo,
        descripcion: m.descripcion,
        umb: m.umb,
        tiendas: new Set(),
        totalVentas: 0,
        aPedir: 0,
        stockTienda: 0,
        stockKacosa: 0,
        pendiente: 0,
        porDespacho: 0
      };
    }
    const g = mapa[m.codigo];
    g.tiendas.add(m.tienda);
    g.totalVentas += m.totalVentas;
    g.aPedir += m.aPedir;
    g.stockTienda += m.stockTienda;
    g.stockKacosa += m.stockKacosa;
    g.pendiente += m.pendiente;
    g.porDespacho += m.porDespacho;
  });
  return Object.values(mapa).map(g => ({ ...g, cantidadTiendas: g.tiendas.size }));
}

/**
 * Totaliza el detalle por material ÚNICO (sin repetir código), sumando SOLO
 * el campo pedido ('aPedir' o 'pendiente') entre todas las tiendas/filas que
 * hayan quedado dentro de los filtros aplicados. Para el modo "A_Pedir" /
 * "Pendiente" de Consultas: material, descripción, UMB y el total de ese campo.
 * Solo devuelve materiales cuyo total sea MAYOR A 0 (no tiene sentido listar
 * algo cuyo total a pedir/pendiente terminó en 0 o menos).
 */
function totalizarPorMaterial(materiales, campo) {
  const mapa = {};
  materiales.forEach(m => {
    if (!mapa[m.codigo]) {
      mapa[m.codigo] = { codigo: m.codigo, descripcion: m.descripcion, umb: m.umb, clase: m.clase || '', total: 0 };
    }
    mapa[m.codigo].total += m[campo] || 0;
  });
  return Object.values(mapa).filter(m => m.total > 0);
}

function mostrarResultadosConsulta() {
  const cont = document.getElementById("consulta-resultados");
  if (!cont) return;

  if (ultimoResultado.length === 0) {
    cont.innerHTML = `<div class="card"><p class="vista-sub" style="margin:0">No se encontraron análisis guardados con esos filtros.</p></div>`;
    return;
  }

  if (modoConsulta === "a_pedir" || modoConsulta === "pendiente") {
    mostrarResultadosPorMetrica();
    return;
  }

  const totalGeneralVentas = ultimoResultado.reduce((a, m) => a + m.totalVentas, 0);
  const totalGeneralAPedir = ultimoResultado.reduce((a, m) => a + m.aPedir, 0);
  const materialesUnicos = new Set(ultimoResultado.map(m => m.codigo)).size;
  const tiendasUnicas = new Set(ultimoResultado.map(m => m.tienda)).size;

  cont.innerHTML = `
    <div class="card">
      <div class="kpi-grid">
        <div class="kpi-card verde">
          <div class="kpi-icono"><i class="fa-solid fa-list-check"></i></div>
          <div class="label">Filas encontradas</div>
          <div class="valor">${ultimoResultado.length}</div>
        </div>
        <div class="kpi-card ambar">
          <div class="kpi-icono"><i class="fa-solid fa-cart-shopping"></i></div>
          <div class="label">Total "A pedir" (suma)</div>
          <div class="valor">${totalGeneralAPedir}</div>
        </div>
        <div class="kpi-card violeta">
          <div class="kpi-icono"><i class="fa-solid fa-chart-line"></i></div>
          <div class="label">Total ventas (suma)</div>
          <div class="valor">${Math.round(totalGeneralVentas * 100) / 100}</div>
        </div>
        <div class="kpi-card rojo">
          <div class="kpi-icono"><i class="fa-solid fa-boxes-stacked"></i></div>
          <div class="label">Materiales / Tiendas distintos</div>
          <div class="valor" style="font-size:18px">${materialesUnicos} / ${tiendasUnicas}</div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px">
        <div style="display:flex; gap:8px">
          <button type="button" class="btn-vista-consulta" data-vista="detalle" style="padding:8px 16px; border:2px solid var(--azul-base); border-radius:var(--radio-peq); background:var(--azul-base); color:#fff; cursor:pointer; font-weight:600; font-size:13px">Detalle</button>
          <button type="button" class="btn-vista-consulta" data-vista="resumen" style="padding:8px 16px; border:2px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); color:var(--texto-principal); cursor:pointer; font-weight:600; font-size:13px">Resumen por material</button>
        </div>
        <button id="btn-descargar-consulta" class="btn-secundario"><i class="fa-solid fa-download"></i> Descargar Excel</button>
      </div>

      <div id="consulta-tabla-container"></div>
      <p class="vista-sub" style="margin-top:10px"><i class="fa-solid fa-circle-info"></i> Esta consulta solo trae el ÚLTIMO análisis guardado por cada tienda/usuario — no es un histórico completo de todo lo que se ha analizado.</p>
    </div>
  `;

  cont.querySelectorAll(".btn-vista-consulta").forEach(btn => {
    btn.addEventListener("click", () => {
      vistaActual = btn.dataset.vista;
      cont.querySelectorAll(".btn-vista-consulta").forEach(b => {
        const activo = b === btn;
        b.style.background = activo ? "var(--azul-base)" : "var(--blanco)";
        b.style.color = activo ? "#fff" : "var(--texto-principal)";
        b.style.borderColor = activo ? "var(--azul-base)" : "var(--borde)";
      });
      renderizarTablaConsulta();
    });
  });

  document.getElementById("btn-descargar-consulta").addEventListener("click", descargarConsultaExcel);

  renderizarTablaConsulta();
}

/** Vista enfocada para los modos "A_Pedir" / "Pendiente": un solo renglón por material, ya totalizado. */
function mostrarResultadosPorMetrica() {
  const cont = document.getElementById("consulta-resultados");
  const campo = modoConsulta; // 'a_pedir' | 'pendiente' -> se traduce a la key del objeto más abajo
  const campoJs = campo === "a_pedir" ? "aPedir" : "pendiente";
  const etiqueta = ETIQUETAS_MODO[campo];

  const totalizado = totalizarPorMaterial(ultimoResultado, campoJs)
    .sort((a, b) => b.total - a.total);

  const totalGeneral = totalizado.reduce((a, m) => a + m.total, 0);
  const materialesUnicos = totalizado.length;

  cont.innerHTML = `
    <div class="card">
      <div class="kpi-grid">
        <div class="kpi-card verde">
          <div class="kpi-icono"><i class="fa-solid fa-boxes-stacked"></i></div>
          <div class="label">Materiales únicos</div>
          <div class="valor">${materialesUnicos}</div>
        </div>
        <div class="kpi-card ambar">
          <div class="kpi-icono"><i class="fa-solid fa-cart-shopping"></i></div>
          <div class="label">Total "${etiqueta}" (suma de todas las tiendas/filtros)</div>
          <div class="valor">${totalGeneral}</div>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; margin-bottom:14px">
        <button id="btn-descargar-consulta" class="btn-secundario"><i class="fa-solid fa-download"></i> Descargar Excel</button>
      </div>

      <div id="consulta-tabla-container"></div>
      <p class="vista-sub" style="margin-top:10px"><i class="fa-solid fa-circle-info"></i> Un renglón por material (sin repetir código), ya sumado entre las tiendas/filtros elegidos. Esta consulta solo trae el ÚLTIMO análisis guardado por cada tienda/usuario.</p>
    </div>
  `;

  const columnas = [
    { key: 'codigo', label: 'Código' },
    { key: 'descripcion', label: 'Descripción' },
    { key: 'umb', label: 'UMB' },
    { key: 'clase', label: 'Clase' },
    { key: 'total', label: etiqueta, numeric: true }
  ];
  const container = document.getElementById('consulta-tabla-container');
  const { renderizar } = crearTablaPaginada(container, columnas, 50);
  renderizar(totalizado);

  document.getElementById("btn-descargar-consulta").addEventListener("click", descargarConsultaExcel);
}

function renderizarTablaConsulta() {
  const container = document.getElementById("consulta-tabla-container");
  if (!container) return;

  if (vistaActual === "resumen") {
    const columnas = [
      { key: 'codigo', label: 'Código' },
      { key: 'descripcion', label: 'Descripción' },
      { key: 'umb', label: 'UMB' },
      { key: 'cantidadTiendas', label: 'N° tiendas', numeric: true },
      { key: 'totalVentas', label: 'Total ventas (suma)', numeric: true },
      { key: 'aPedir', label: 'A pedir (suma)', numeric: true },
      { key: 'stockTienda', label: 'Stock tienda (suma)', numeric: true },
      { key: 'stockKacosa', label: 'Stock Kacosa (suma)', numeric: true },
      { key: 'pendiente', label: 'Pendiente (suma)', numeric: true },
      { key: 'porDespacho', label: 'Por despacho (suma)', numeric: true }
    ];
    const { renderizar } = crearTablaPaginada(container, columnas, 50);
    renderizar(agruparPorMaterial(ultimoResultado));
  } else {
    const columnas = [
      { key: 'tienda', label: 'Tienda' },
      { key: 'centro', label: 'Centro' },
      { key: 'codigo', label: 'Código' },
      { key: 'descripcion', label: 'Descripción' },
      { key: 'umb', label: 'UMB' },
      { key: 'clase', label: 'Clase' },
      { key: 'totalVentas', label: 'Total ventas', numeric: true },
      { key: 'stockTienda', label: 'Stock tienda', numeric: true },
      { key: 'stockKacosa', label: 'Stock Kacosa', numeric: true },
      { key: 'aPedir', label: 'A pedir', numeric: true },
      { key: 'pendiente', label: 'Pendiente', numeric: true },
      { key: 'porDespacho', label: 'Por despacho', numeric: true },
      { key: 'fechaAnalisis', label: 'Fecha análisis' },
      { key: 'usuarioNombre', label: 'Generado por' }
    ];
    const { renderizar } = crearTablaPaginada(container, columnas, 50);
    renderizar(ultimoResultado);
  }
}

function descargarConsultaExcel() {
  const wb = XLSX.utils.book_new();

  if (modoConsulta === "a_pedir" || modoConsulta === "pendiente") {
    const campoJs = modoConsulta === "a_pedir" ? "aPedir" : "pendiente";
    const etiqueta = ETIQUETAS_MODO[modoConsulta];
    const totalizado = totalizarPorMaterial(ultimoResultado, campoJs).sort((a, b) => b.total - a.total);

    const columnas = [
      { key: 'codigo', label: 'Material', ancho: 14 },
      { key: 'descripcion', label: 'Descripcion', ancho: 42 },
      { key: 'umb', label: 'UMB', ancho: 8 },
      { key: 'clase', label: 'Clase', ancho: 8 },
      { key: 'total', label: etiqueta.replace(/\s+/g, '_'), ancho: 14 }
    ];
    XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(totalizado, columnas), `Total ${etiqueta}`.slice(0, 31));

    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Consulta_${etiqueta.replace(/\s+/g, '_')}_${fecha}.xlsx`);
    notificarExito(`El Excel con el total de "${etiqueta}" por material se descargó correctamente.`, { titulo: "Descarga lista" });
    return;
  }

  const columnasDetalle = [
    { key: 'tienda', label: 'Tienda', ancho: 16 },
    { key: 'centro', label: 'Centro', ancho: 10 },
    { key: 'codigo', label: 'Codigo', ancho: 14 },
    { key: 'descripcion', label: 'Descripcion', ancho: 40 },
    { key: 'umb', label: 'UMB', ancho: 8 },
    { key: 'clase', label: 'Clase', ancho: 8 },
    { key: 'totalVentas', label: 'Total_Ventas', ancho: 14 },
    { key: 'stockTienda', label: 'Stock_Tienda', ancho: 14 },
    { key: 'stockKacosa', label: 'Stock_Kacosa', ancho: 14 },
    { key: 'aPedir', label: 'A_Pedir', ancho: 12 },
    { key: 'pendiente', label: 'Pendiente', ancho: 12 },
    { key: 'porDespacho', label: 'Por_Despacho', ancho: 14 },
    { key: 'fechaAnalisis', label: 'Fecha_Analisis', ancho: 16 },
    { key: 'usuarioNombre', label: 'Generado_Por', ancho: 20 }
  ];
  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(ultimoResultado, columnasDetalle), "Detalle");

  const columnasResumen = [
    { key: 'codigo', label: 'Codigo', ancho: 14 },
    { key: 'descripcion', label: 'Descripcion', ancho: 40 },
    { key: 'umb', label: 'UMB', ancho: 8 },
    { key: 'cantidadTiendas', label: 'N_Tiendas', ancho: 12 },
    { key: 'totalVentas', label: 'Total_Ventas_Suma', ancho: 16 },
    { key: 'aPedir', label: 'A_Pedir_Suma', ancho: 14 },
    { key: 'stockTienda', label: 'Stock_Tienda_Suma', ancho: 16 },
    { key: 'stockKacosa', label: 'Stock_Kacosa_Suma', ancho: 16 },
    { key: 'pendiente', label: 'Pendiente_Suma', ancho: 14 },
    { key: 'porDespacho', label: 'Por_Despacho_Suma', ancho: 16 }
  ];
  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(agruparPorMaterial(ultimoResultado), columnasResumen), "Resumen por material");

  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Consulta_Analisis_${fecha}.xlsx`);
  notificarExito("El Excel con las pestañas Detalle y Resumen por material se descargó correctamente.", { titulo: "Descarga lista" });
}

document.addEventListener("kacosa:vista-cambiada", (e) => {
  if (e.detail.vista === "vista-consultas") render();
});
