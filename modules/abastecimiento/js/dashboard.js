// js/dashboard.js
import { callBridge } from "./bridge.js";
import { TIENDAS, nombrePorId } from "./tiendas.js";
import { crearTablaPaginada } from "./tabla-utils.js";
import { notificarExito } from "./notificaciones.js";
import { construirHojaEstilizada, construirHojaResumen } from "./excel-estilos.js";
import { ROLES_CON_ACCESO_A_TODAS_LAS_TIENDAS } from "./auth.js";

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

  // Roles privilegiados (ver ROLES_CON_ACCESO_A_TODAS_LAS_TIENDAS en auth.js) ven el
  // último análisis de la tienda sin importar quién lo haya hecho. Cualquier otro rol
  // (ej. "gerente") solo debe ver el último análisis que ÉL MISMO guardó para su
  // tienda — aunque otro usuario haya hecho uno más reciente para esa misma tienda.
  const rolNormalizado = window.KACOSA?.usuario?.rolNormalizado
    || (window.KACOSA?.usuario?.rol || "").toString().trim().toLowerCase();
  const esPrivilegiado = ROLES_CON_ACCESO_A_TODAS_LAS_TIENDAS.includes(rolNormalizado);
  const filtroUsuario = esPrivilegiado ? {} : { usuarioEmail: window.KACOSA?.usuario?.email || "" };

  const resp = await callBridge("leerAnalisis", { tienda: tiendaSeleccionada, ...filtroUsuario });

  if (!resp.ok) {
    resultadoDiv.innerHTML = `<p class="vista-sub">Error al cargar: ${resp.error}</p>`;
    return;
  }

  if (!resp.materiales || resp.materiales.length === 0) {
    resultadoDiv.innerHTML = `
      <div class="card">
        <p class="vista-sub" style="margin:0">
          ${esPrivilegiado
            ? `Todavía no hay ningún análisis guardado para <strong>${nombrePorId(tiendaSeleccionada)}</strong>.`
            : `Todavía no has generado ningún análisis para <strong>${nombrePorId(tiendaSeleccionada)}</strong> con tu usuario.`}
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
      umb: String(m.umb || 'UN'),
      clase: String(m.clase || ''),
      totalVentas: Number(m.totalVentas) || 0,
      promedioVentasPeriodo: Number(m.promedioVentasPeriodo) || 0,
      stockTienda: stockTienda,
      stockKacosa1000: Number(m.stockKacosa1000) || 0,
      stockKacosa3000: Number(m.stockKacosa3000) || 0,
      stockKacosa: stockKacosa,
      ubicacionKacosa: String(m.ubicacionKacosa || ''),
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
    usuarioNombre: resp.usuarioNombre || "",
    usuarioEmail: resp.usuarioEmail || "",
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
    <p class="vista-sub" style="margin-top:0">
      Último análisis: <strong>${analisis.fechaAnalisis || "—"}</strong>
      ${analisis.usuarioNombre ? ` — realizado por <strong>${analisis.usuarioNombre}</strong>` : ""}
    </p>
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
    { key: 'umb', label: 'UMB' },
    { key: 'clase', label: 'Clase' },
    { key: 'totalVentas', label: 'Total ventas', numeric: true },
    { key: 'promedioVentasPeriodo', label: 'Promedio ventas periodo', numeric: true },
    { key: 'stockTienda', label: 'Stock tienda', numeric: true },
    { key: 'stockKacosa1000', label: 'Stock Kacosa 1000', numeric: true },
    { key: 'stockKacosa3000', label: 'Stock Kacosa 3000', numeric: true },
    { key: 'stockKacosa', label: 'Total Stock Kacosa', numeric: true },
    { key: 'ubicacionKacosa', label: 'Ubicación Kacosa' },
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
      umb: String(m.umb || 'UN'),
      aPedir: aPedir,
      stockKacosa1000: Number(m.stockKacosa1000) || 0,
      stockKacosa3000: Number(m.stockKacosa3000) || 0,
      stockKacosa: stockKacosa,
      ubicacionKacosa: String(m.ubicacionKacosa || ''),
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
      `Analista: ${analisis.usuarioNombre || "—"}`,
      "Generado desde el Dashboard del sistema de Abastecimiento KACOSA."
    ]
  );
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  const columnasCompletas = [
    { key: 'codigo', label: 'Codigo', ancho: 14 },
    { key: 'descripcion', label: 'Descripcion', ancho: 38 },
    { key: 'unidadVenta', label: 'UMV', ancho: 10 },
    { key: 'materialesFusionados', label: 'Materiales_Fusionados', ancho: 22 },
    { key: 'clase', label: 'Clase', ancho: 8 },
    { key: 'totalVentas', label: 'Total_Ventas', ancho: 12 },
    { key: 'promedioVentasPeriodo', label: 'Promedio_Ventas_Periodo', ancho: 16 },
    { key: 'stockTienda', label: 'Stock_Tienda', ancho: 12 },
    { key: 'stockKacosa1000', label: 'Stock_Kacosa_1000', ancho: 14 },
    { key: 'stockKacosa3000', label: 'Stock_Kacosa_3000', ancho: 14 },
    { key: 'stockKacosa', label: 'Total_Stock_Kacosa', ancho: 14 },
    { key: 'ubicacionKacosa', label: 'Ubicacion_Kacosa', ancho: 16 },
    { key: 'umb', label: 'UMB', ancho: 10 },
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

  // Pendiente_Stock_Kacosa necesita su propio desglose (A_Pedir_Ideal / A_Pedir_Real /
  // Pendiente), no el mismo "A_Pedir" genérico de las otras hojas — igual que en el
  // Excel de Nuevo Análisis.
  const columnasPendienteStock = [
    { key: 'codigo', label: 'Codigo', ancho: 14 },
    { key: 'descripcion', label: 'Descripcion', ancho: 38 },
    { key: 'unidadVenta', label: 'UMV', ancho: 10 },
    { key: 'materialesFusionados', label: 'Materiales_Fusionados', ancho: 22 },
    { key: 'clase', label: 'Clase', ancho: 8 },
    { key: 'totalVentas', label: 'Total_Ventas', ancho: 12 },
    { key: 'promedioVentasPeriodo', label: 'Promedio_Ventas_Periodo', ancho: 16 },
    { key: 'stockTienda', label: 'Stock_Tienda', ancho: 12 },
    { key: 'umb', label: 'UMB', ancho: 10 },
    { key: 'aPedirIdeal', label: 'A_Pedir_Ideal', ancho: 12 },
    { key: 'aPedir', label: 'A_Pedir_Real', ancho: 12 },
    { key: 'pendiente', label: 'Pendiente', ancho: 12 },
    { key: 'stockKacosa1000', label: 'Stock_Kacosa_1000', ancho: 14 },
    { key: 'stockKacosa3000', label: 'Stock_Kacosa_3000', ancho: 14 },
    { key: 'stockKacosa', label: 'Total_Stock_Kacosa', ancho: 14 },
    { key: 'ubicacionKacosa', label: 'Ubicacion_Kacosa', ancho: 16 },
    { key: 'periodoAbastecimiento', label: 'Periodo_Abastecimiento', ancho: 16 },
    { key: 'tienda', label: 'Tienda', ancho: 14 },
    { key: 'rangoSeguridadUsado', label: 'Rango_Seguridad_Usado', ancho: 14 }
  ];

  XLSX.utils.book_append_sheet(wb, construirHojaEstilizada(pendienteStock, columnasPendienteStock, {
    colorearPorClase: true,
    columnasDestacadas: [{ key: 'pendiente', color: 'FFC4432B' }]
  }), "Pendiente_Stock_Kacosa");

  XLSX.writeFile(wb, `Dashboard_${base}.xlsx`);
  notificarExito("El archivo Excel del Dashboard se descargó correctamente.", { titulo: "Excel descargado" });
}

// Cuando se confirma la sesión del usuario (login, o cambio de cuenta sin
// recargar la página — típico al probar varias cuentas en la misma pestaña),
// forzamos una reconstrucción completa del dashboard: sin este reseteo,
// "vistaConstruida" quedaba en true desde una cuenta anterior y el selector
// de tienda (y la tienda seleccionada) se quedaban pegados a esos datos
// viejos, ignorando las tiendas reales de la nueva cuenta.
document.addEventListener("kacosa:usuario-listo", () => {
  vistaConstruida = false;
  tiendaSeleccionada = null;
  analisisCache = null;
  render();
});
document.addEventListener("kacosa:vista-cambiada", (e) => {
  if (e.detail.vista === "vista-dashboard") {
    if (window.KACOSA?.ultimoAnalisis) {
      analisisCache = {
        tienda: window.KACOSA.ultimoAnalisis.tienda,
        fechaAnalisis: window.KACOSA.ultimoAnalisis.fechaAnalisis,
        usuarioNombre: window.KACOSA?.usuario?.nombre || window.KACOSA?.usuario?.email || "",
        usuarioEmail: window.KACOSA?.usuario?.email || "",
        materiales: window.KACOSA.ultimoAnalisis.materiales
      };
    }
    render();
  }
});
