// js/dashboard.js
import { callBridge } from "./bridge.js";
import { TIENDAS, nombrePorId } from "./tiendas.js";
import { crearTablaPaginada } from "./tabla-utils.js";
import { notificarExito } from "./notificaciones.js";
import { construirHojaEstilizada, construirHojaResumen } from "./excel-estilos.js";

let tiendaSeleccionada = null;
let materialesCache = [];
let analisisCache = null;
let vistaConstruida = false;

function tiendasDelUsuario() {
  return window.KACOSA?.tiendas || [];
}

async function render() {
  if (vistaConstruida) return;
  const cont = document.getElementById("dashboard-contenido");
  if (!cont) return;

  const misTiendas = tiendasDelUsuario();
  if (misTiendas.length === 0) {
    cont.innerHTML = `<p class="vista-sub">Cargando información del usuario...</p>`;
    return;
  }
  vistaConstruida = true;

  const tieneVariasTiendas = misTiendas.includes("TODAS") || misTiendas.length > 1;
  if (!tiendaSeleccionada) {
    tiendaSeleccionada = misTiendas.includes("TODAS") ? TIENDAS[0].id : misTiendas[0];
  }

  const opcionesTienda = misTiendas.includes("TODAS")
    ? TIENDAS.map(t => `<option value="${t.id}" ${t.id === tiendaSeleccionada ? "selected" : ""}>${t.nombre}</option>`).join("")
    : misTiendas.map(id => `<option value="${id}" ${id === tiendaSeleccionada ? "selected" : ""}>${nombrePorId(id)}</option>`).join("");

  cont.innerHTML = `
    ${tieneVariasTiendas ? `
      <div class="tienda-selector">
        <span class="label"><i class="fa-solid fa-store"></i> Tienda</span>
        <select id="dash-tienda">
          ${opcionesTienda}
        </select>
        <span style="font-size:12px; color:var(--texto-claro); margin-left:auto;">
          Último análisis
        </span>
      </div>
    ` : ""}
    <div id="dash-resultado"><p class="vista-sub">Cargando último análisis...</p></div>
  `;

  if (tieneVariasTiendas) {
    document.getElementById("dash-tienda").addEventListener("change", (e) => {
      tiendaSeleccionada = e.target.value;
      cargarAnalisis();
    });
  }

  cargarAnalisis();
}

async function cargarAnalisis() {
  const resultadoDiv = document.getElementById("dash-resultado");
  resultadoDiv.innerHTML = `<p class="vista-sub">Cargando último análisis de ${nombrePorId(tiendaSeleccionada)}...</p>`;

  if (analisisCache && analisisCache.tienda === tiendaSeleccionada) {
    mostrarDashboard(analisisCache);
    return;
  }

  const resp = await callBridge("leerAnalisis", { tienda: tiendaSeleccionada });

  if (!resp.ok) {
    resultadoDiv.innerHTML = `<p class="vista-sub">Error al cargar: ${resp.error}</p>`;
    return;
  }

  if (!resp.materiales || resp.materiales.length === 0) {
    resultadoDiv.innerHTML = `
      <div class="card">
        <p class="vista-sub" style="margin:0">
          Todavía no hay ningún análisis guardado para <strong>${nombrePorId(tiendaSeleccionada)}</strong>.
          Ve a "Nuevo Análisis" para generar el primero.
        </p>
      </div>
    `;
    return;
  }

  // Convertir valores numéricos
  const materiales = resp.materiales.map(m => {
    const aPedir = Number(m.aPedir) || 0;
    const stockKacosa = Number(m.stockKacosa) || 0;
    const stockTienda = Number(m.stockTienda) || 0;
    const porDespacho = Number(m.porDespacho) || 0;
    return {
      ...m,
      codigo: String(m.codigo || ''),
      descripcion: String(m.descripcion || ''),
      clase: String(m.clase || ''),
      totalVentas: Number(m.totalVentas) || 0,
      promedioVentasPeriodo: Number(m.promedioVentasPeriodo) || 0,
      stockTienda: stockTienda,
      stockKacosa: stockKacosa,
      aPedir: aPedir,
      aPedirIdeal: Number(m.aPedirIdeal) || 0,
      pendiente: Number(m.pendiente) || 0,
      porDespacho: porDespacho,
      numeroDeNota: String(m.numeroDeNota || ''),
      fechaDeNota: String(m.fechaDeNota || ''),
      empaque: Number(m.empaque) || 1,
      periodoVentas: String(m.periodoVentas || ''),
      periodoAbastecimiento: String(m.periodoAbastecimiento || ''),
      rangoSeguridadUsado: String(m.rangoSeguridadUsado || ''),
      tienda: String(m.tienda || '')
    };
  });

  analisisCache = {
    tienda: tiendaSeleccionada,
    fechaAnalisis: resp.fechaAnalisis || "Sin fecha",
    materiales: materiales
  };
  
  mostrarDashboard(analisisCache);
}

function mostrarDashboard(analisis) {
  const resultadoDiv = document.getElementById("dash-resultado");
  materialesCache = analisis.materiales;

  window.KACOSA = window.KACOSA || {};
  window.KACOSA.ultimoDashboardAnalisis = analisis;
  
  const totalMaterialesAPedir = materialesCache.filter(m => m.aPedir > 0).length;
  
  // Material con mayor venta
  let materialMayorVenta = null;
  let maxVentas = 0;
  materialesCache.forEach(m => {
    if (m.totalVentas > maxVentas) {
      maxVentas = m.totalVentas;
      materialMayorVenta = m;
    }
  });

  // Total de materiales con ventas (= con movimientos, ya que el archivo de ventas es el de movimientos)
  const totalMaterialesConVentas = materialesCache.filter(m => m.totalVentas > 0).length;

  // Materiales que no necesitaron pedido en este análisis (igual que en el Excel
  // original: se basa en aPedirIdeal, la necesidad ANTES de limitarla por el
  // stock de Kacosa, no en aPedir que ya viene recortado).
  const totalMaterialesNoAmeritoPedido = materialesCache.filter(m => m.aPedirIdeal === 0).length;

  // Materiales pendientes por falta de stock suficiente en Kacosa (coincide
  // exactamente con la pestaña "Pendiente_Stock_Kacosa" del análisis original)
  const totalSinStockSuficienteKacosa = materialesCache.filter(m => (m.pendiente || 0) > 0).length;

  const porClase = { A: 0, B: 0, C: 0, D: 0 };
  materialesCache.forEach(m => { 
    const clase = (m.clase || '').toUpperCase();
    if (porClase[clase] !== undefined) porClase[clase]++; 
  });

  resultadoDiv.innerHTML = `
    <p class="vista-sub" style="margin-top:0">Último análisis: <strong>${analisis.fechaAnalisis || "—"}</strong></p>
    <div class="kpi-grid">
      <!-- Tarjeta 1: Materiales con ventas (AZUL) -->
      <div class="kpi-card azul" style="background: linear-gradient(135deg, var(--blanco) 55%, #E8F0FE 130%);">
        <div class="kpi-icono" style="background: linear-gradient(135deg, #4A6FA5, #2A4A7A); box-shadow: 0 4px 12px rgba(42, 74, 122, 0.35); color:#fff;">
           <i class="fa-solid fa-coins"></i>
        </div>
        <div class="label">Materiales con ventas</div>
        <div class="valor">${totalMaterialesConVentas}</div>
      </div>
      <!-- Tarjeta 2: Clase A/B/C/D -->
      <div class="kpi-card violeta">
        <div class="kpi-icono"><i class="fa-solid fa-layer-group"></i></div>
        <div class="label">Clase A / B / C / D</div>
        <div class="valor" style="font-size:18px">${porClase.A} / ${porClase.B} / ${porClase.C} / ${porClase.D}</div>
      </div>
      <!-- Tarjeta 3: Materiales a pedir -->
      <div class="kpi-card verde">
        <div class="kpi-icono"><i class="fa-solid fa-box-open"></i></div>
        <div class="label">Materiales a pedir</div>
        <div class="valor">${totalMaterialesAPedir}</div>
      </div>
      <!-- Tarjeta 4: Materiales que no ameritó pedido (AMBAR) -->
      <div class="kpi-card ambar">
        <div class="kpi-icono"><i class="fa-solid fa-circle-check"></i></div>
        <div class="label">Materiales que no ameritó pedido</div>
        <div class="valor">${totalMaterialesNoAmeritoPedido}</div>
      </div>
      <!-- Tarjeta 5: Sin stock suficiente en Kacosa (ROJA) -->
      <div class="kpi-card rojo">
        <div class="kpi-icono"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="label">Materiales sin stock suficiente en Kacosa</div>
        <div class="valor">${totalSinStockSuficienteKacosa}</div>
      </div>
      <!-- Tarjeta 6: Material con mayor venta (PÚRPURA, ÚLTIMA) -->
      <div class="kpi-card purpura" style="background: linear-gradient(135deg, var(--blanco) 55%, #F0E6F6 130%);">
        <div class="kpi-icono" style="background: linear-gradient(135deg, #8B6BAE, #6B4A8A); box-shadow: 0 4px 12px rgba(107, 74, 138, 0.35); color:#fff;">
          <i class="fa-solid fa-trophy"></i>
        </div>
        <div class="label">Material con mayor venta</div>
        <div class="valor" style="font-size:16px; line-height:1.3; margin-top:2px;">
          ${materialMayorVenta ? `
            <span style="display:block; font-size:13px; font-weight:600; color:var(--azul-base);">
              ${materialMayorVenta.codigo}
            </span>
            <span style="display:block; font-size:12px; font-weight:400; color:var(--texto-secundario);">
              ${materialMayorVenta.descripcion.substring(0, 25)}${materialMayorVenta.descripcion.length > 25 ? '...' : ''}
            </span>
            <span style="display:block; font-size:18px; font-weight:700; color:#6B4A8A; margin-top:4px;">
              ${Math.round(maxVentas)} und.
            </span>
          ` : '—'}
        </div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:16px">
        <h3 style="margin:0; font-size:14px; color:var(--azul-base)">Materiales a pedir (${totalMaterialesAPedir})</h3>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <div style="position:relative; display:inline-flex; align-items:center">
            <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; font-size:12px; color:var(--texto-claro); pointer-events:none"></i>
            <input type="text" id="dash-buscar" placeholder="Buscar por código o descripción..." 
                   style="padding:8px 14px 8px 32px; border:1.5px solid var(--borde); border-radius:var(--radio-peq); font-size:13px; min-width:200px">
          </div>
          <button id="dash-descargar" class="btn-primario" style="padding:8px 16px; font-size:12px; margin:0">
            <i class="fa-solid fa-download"></i> Descargar Excel
          </button>
        </div>
      </div>
      <div id="dash-tabla-container"></div>
    </div>
  `;

  const columnas = [
    { key: 'codigo', label: 'Código' },
    { key: 'descripcion', label: 'Descripción' },
    { key: 'clase', label: 'Clase' },
    { key: 'totalVentas', label: 'Total ventas', numeric: true },
    { key: 'promedioVentasPeriodo', label: 'Promedio ventas periodo', numeric: true },
    { key: 'stockTienda', label: 'Stock tienda', numeric: true },
    { key: 'stockKacosa', label: 'Stock Kacosa', numeric: true },
    { key: 'aPedir', label: 'A pedir', numeric: true },
    { key: 'porDespacho', label: 'Por despacho', numeric: true },
    { key: 'numeroDeNota', label: 'Número de nota' },
    { key: 'fechaDeNota', label: 'Fecha de nota' }
  ];

  const container = document.getElementById('dash-tabla-container');
  const { renderizar } = crearTablaPaginada(container, columnas, 50);
  renderizar(materialesCache);

  document.getElementById('dash-buscar').addEventListener('input', (e) => {
    const termino = e.target.value.toLowerCase().trim();
    if (!termino) {
      renderizar(materialesCache);
      return;
    }
    const filtrados = materialesCache.filter(m => 
      String(m.codigo).toLowerCase().includes(termino) || 
      String(m.descripcion).toLowerCase().includes(termino)
    );
    renderizar(filtrados);
  });

  document.getElementById('dash-descargar').addEventListener('click', () => {
    descargarExcelDashboard(materialesCache, analisis);
  });
}

function descargarExcelDashboard(materialesOriginal, analisis) {
  if (!materialesOriginal || materialesOriginal.length === 0) {
    alert("No hay materiales para descargar.");
    return;
  }

  const materiales = materialesOriginal.map(m => {
    const aPedir = Number(m.aPedir) || 0;
    const stockKacosa = Number(m.stockKacosa) || 0;
    const porDespacho = Number(m.porDespacho) || 0;
    return {
      ...m,
      aPedir: aPedir,
      stockKacosa: stockKacosa,
      porDespacho: porDespacho,
      numeroDeNota: String(m.numeroDeNota || ''),
      fechaDeNota: String(m.fechaDeNota || ''),
      fechaAnalisis: analisis.fechaAnalisis || ''
    };
  });

  const base = `${analisis.tienda}_${analisis.fechaAnalisis?.replace(/\//g, "-") || "sin_fecha"}`;

  const pedido = materiales.filter(m => m.aPedir > 0);
  const noPedido = materiales.filter(m => (m.aPedirIdeal || 0) === 0);
  const pendienteStock = materiales.filter(m => (m.pendiente || 0) > 0);

  const totalMaterialesAPedir = pedido.length;
  const totalUnidadesAPedir = pedido.reduce((acc, m) => acc + m.aPedir, 0);
  const porClase = { A: 0, B: 0, C: 0, D: 0 };
  materiales.forEach(m => { 
    const clase = (m.clase || '').toUpperCase();
    if (porClase[clase] !== undefined) porClase[clase]++; 
  });

  const wb = XLSX.utils.book_new();

  const wsResumen = construirHojaResumen(
    `Dashboard — ${nombrePorId(analisis.tienda)}`,
    [
      { label: "Fecha de análisis", valor: analisis.fechaAnalisis || "—" },
      { label: "Materiales a pedir", valor: totalMaterialesAPedir, color: "FF2F8F6E" },
      { label: "Unidades a pedir", valor: totalUnidadesAPedir, color: "FF1B2A41" },
      { label: "Pendiente por falta de stock", valor: pendienteStock.length, color: "FFC4432B" },
      { label: "Clase A", valor: porClase.A, color: "FF2F8F6E" },
      { label: "Clase B", valor: porClase.B, color: "FF4A6FA5" },
      { label: "Clase C", valor: porClase.C, color: "FFE8A03D" },
      { label: "Clase D", valor: porClase.D, color: "FF6B7280" }
    ],
    [
      `Período de ventas analizado: ${materiales[0]?.periodoVentas || "—"}`,
      `Horizonte de abastecimiento: ${materiales[0]?.periodoAbastecimiento || "—"}`,
      `Rango de seguridad usado: ${materiales[0]?.rangoSeguridadUsado || "—"}`,
      "Generado desde el Dashboard del sistema de Abastecimiento KACOSA."
    ]
  );
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  const columnasCompletas = [
    { key: 'codigo', label: 'Codigo', ancho: 14 },
    { key: 'descripcion', label: 'Descripcion', ancho: 38 },
    { key: 'clase', label: 'Clase', ancho: 8 },
    { key: 'totalVentas', label: 'Total_Ventas', ancho: 12 },
    { key: 'promedioVentasPeriodo', label: 'Promedio_Ventas_Periodo', ancho: 16 },
    { key: 'stockTienda', label: 'Stock_Tienda', ancho: 12 },
    { key: 'stockKacosa', label: 'Stock_Kacosa', ancho: 12 },
    { key: 'aPedir', label: 'A_Pedir', ancho: 10 },
    { key: 'porDespacho', label: 'Por_Despacho', ancho: 12 },
    { key: 'numeroDeNota', label: 'Numero_De_Nota', ancho: 14 },
    { key: 'fechaDeNota', label: 'Fecha_De_Nota', ancho: 14 },
    { key: 'periodoVentas', label: 'Periodo_Ventas', ancho: 14 },
    { key: 'periodoAbastecimiento', label: 'Periodo_Abastecimiento', ancho: 16 },
    { key: 'rangoSeguridadUsado', label: 'Rango_Seguridad_Usado', ancho: 14 },
    { key: 'tienda', label: 'Tienda', ancho: 14 },
    { key: 'fechaAnalisis', label: 'Fecha_Analisis', ancho: 14 }
  ];

  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(pedido, columnasCompletas, {
    colorearPorClase: true,
    columnasDestacadas: [{ key: 'aPedir', color: 'FFC4432B' }]
  }), "A_Pedir");

  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(noPedido, columnasCompletas, {
    colorearPorClase: true
  }), "No_Amerito_Pedido");

  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(pendienteStock, columnasCompletas, {
    colorearPorClase: true
  }), "Pendiente_Stock_Kacosa");

  XLSX.writeFile(wb, `Dashboard_${base}.xlsx`);
  notificarExito("El archivo Excel del Dashboard se descargó correctamente.", { titulo: "Excel descargado" });
}

document.addEventListener("kacosa:usuario-listo", render);
document.addEventListener("kacosa:vista-cambiada", (e) => {
  if (e.detail.vista === "vista-dashboard") {
    if (window.KACOSA?.ultimoAnalisis) {
      analisisCache = {
        tienda: window.KACOSA.ultimoAnalisis.tienda,
        fechaAnalisis: window.KACOSA.ultimoAnalisis.fechaAnalisis,
        materiales: window.KACOSA.ultimoAnalisis.materiales
      };
    }
    render();
  }
});
