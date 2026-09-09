// js/resumen-directiva.js
// Dashboard ejecutivo de Abastecimiento: resumen de todas las tiendas en un
// solo vistazo. Solo visible para roles directiva/coordinador/admin (ver
// ROLES_ACCESO_RESUMEN_DIRECTIVA en auth.js — nav.js ya oculta el botón del
// menú para cualquier otro rol; aquí se repite la verificación por si
// alguien entra directo por URL/hash).
import { callBridge } from "./bridge.js";
import { TIENDAS, nombrePorId } from "./tiendas.js";
import { crearTablaPaginada } from "./tabla-utils.js";
import { ROLES_ACCESO_RESUMEN_DIRECTIVA } from "./auth.js";

let datosCache = null;    // { tiendas, topVentas } — respuesta de resumenAbastecimientoDirectiva
let alertasCache = null;  // { alertas, creadoEn, usuarioNombre } — respuesta de leerUltimaAlertaKacosa
let vistaConstruida = false;
let tablaVentas = null;
let ventasFiltroTienda = "";
let ventasFiltroTexto = "";

function rolActual() {
  return window.KACOSA?.usuario?.rolNormalizado
    || (window.KACOSA?.usuario?.rol || "").toString().trim().toLowerCase();
}

function usuarioTieneAcceso() {
  return ROLES_ACCESO_RESUMEN_DIRECTIVA.includes(rolActual());
}

async function render() {
  const cont = document.getElementById("resumen-directiva-contenido");
  if (!cont) return;

  if (!window.KACOSA?.usuario) {
    cont.innerHTML = `<p class="vista-sub">Cargando información del usuario...</p>`;
    return;
  }

  if (!usuarioTieneAcceso()) {
    cont.innerHTML = `
      <div class="card">
        <p class="vista-sub" style="margin:0">
          <i class="fa-solid fa-lock"></i> Tu rol no tiene acceso a este resumen.
        </p>
      </div>
    `;
    return;
  }

  if (vistaConstruida && datosCache) return; // ya está pintado con datos válidos

  vistaConstruida = true;
  cont.innerHTML = `<p class="vista-sub" style="margin-top:0">Cargando resumen de todas las tiendas...</p>`;

  try {
    const [respResumen, respAlertas] = await Promise.all([
      callBridge("resumenAbastecimientoDirectiva", {}),
      callBridge("leerUltimaAlertaKacosa", {}) // sin usuarioEmail: privilegiado, trae la última de cualquiera
    ]);

    if (!respResumen.ok) {
      cont.innerHTML = `
        <div class="card">
          <p class="vista-sub" style="margin:0">
            <i class="fa-solid fa-triangle-exclamation"></i> Error al cargar el resumen: ${respResumen.error}
          </p>
        </div>
      `;
      vistaConstruida = false;
      return;
    }

    datosCache = respResumen;
    alertasCache = respAlertas.ok ? respAlertas : { alertas: [], creadoEn: null, usuarioNombre: "" };

    pintarVista(cont);
  } catch (err) {
    cont.innerHTML = `
      <div class="card">
        <p class="vista-sub" style="margin:0">
          <i class="fa-solid fa-triangle-exclamation"></i> Error al cargar el resumen: ${err.message}
        </p>
      </div>
    `;
    vistaConstruida = false;
  }
}

function pintarVista(cont) {
  cont.innerHTML = `
    <div class="tiendas-resumen-grid" id="tiendas-resumen-grid"></div>

    <div class="card">
      <h3 style="display:flex; align-items:center; gap:10px">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; background:var(--ambar-claro); border-radius:8px; font-size:14px"><i class="fa-solid fa-layer-group"></i></span>
        Materiales Clase A / B — Última Alerta Kacosa
      </h3>
      <div id="alertas-ab-subtitulo"></div>
      <div id="tabla-alertas-ab-container" style="margin-top:14px"></div>
    </div>

    <div class="card">
      <h3 style="display:flex; align-items:center; gap:10px; margin-bottom:14px">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; background:var(--verde-claro); border-radius:8px; font-size:14px; color:var(--verde-kpi)"><i class="fa-solid fa-ranking-star"></i></span>
        Materiales más vendidos por tienda
      </h3>
      <div class="filtros-tabla">
        <div style="display:flex; align-items:center; gap:8px">
          <i class="fa-solid fa-store" style="color:var(--texto-claro); font-size:13px"></i>
          <select id="ventas-filtro-tienda">
            <option value="">Todas las tiendas (Top 10 global)</option>
            ${TIENDAS.map(t => `<option value="${t.id}">${t.nombre}</option>`).join("")}
          </select>
        </div>
        <div style="position:relative; display:inline-flex; align-items:center">
          <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; font-size:12px; color:var(--texto-claro); pointer-events:none"></i>
          <input type="text" id="ventas-filtro-texto" placeholder="Buscar por código o descripción..."
                 style="padding:8px 14px 8px 32px; min-width:230px">
        </div>
      </div>
      <div id="tabla-ventas-container"></div>
    </div>
  `;

  pintarTiendas(datosCache.tiendas || []);
  pintarAlertasSubtitulo();
  pintarTablaAlertasAB();
  pintarTablaVentas();

  document.getElementById("ventas-filtro-tienda").addEventListener("change", (e) => {
    ventasFiltroTienda = e.target.value;
    aplicarFiltroVentas();
  });
  document.getElementById("ventas-filtro-texto").addEventListener("input", (e) => {
    ventasFiltroTexto = e.target.value.toLowerCase().trim();
    aplicarFiltroVentas();
  });
}

function pintarAlertasSubtitulo() {
  const el = document.getElementById("alertas-ab-subtitulo");
  if (!el) return;
  const fecha = alertasCache.creadoEn ? new Date(alertasCache.creadoEn).toLocaleString("es-VE") : null;
  el.innerHTML = fecha
    ? `<p class="vista-sub" style="margin:6px 0 0">
         Último cálculo: <strong>${fecha}</strong>
         ${alertasCache.usuarioNombre ? ` — realizado por <strong>${alertasCache.usuarioNombre}</strong>` : ""}
       </p>`
    : `<p class="vista-sub" style="margin:6px 0 0">Todavía no hay ninguna Alerta Kacosa calculada.</p>`;
}

function pintarTiendas(tiendas) {
  const grid = document.getElementById("tiendas-resumen-grid");
  if (!grid) return;

  if (tiendas.length === 0) {
    grid.innerHTML = `<p class="vista-sub">No hay tiendas configuradas.</p>`;
    return;
  }

  grid.innerHTML = tiendas.map((t, idx) => {
    if (t.sinDatos) {
      return `
        <div class="tienda-resumen-card sin-datos">
          <div class="tienda-resumen-icono"><i class="fa-solid fa-store-slash"></i></div>
          <div class="tienda-resumen-nombre">${nombrePorId(t.tienda)}</div>
          <div class="tienda-resumen-fecha"><i class="fa-regular fa-calendar"></i> Sin análisis guardado</div>
          <div class="tienda-resumen-valor">—</div>
        </div>
      `;
    }
    return `
      <div class="tienda-resumen-card" data-idx="${idx}" role="button" tabindex="0">
        <div class="tienda-resumen-icono"><i class="fa-solid fa-store"></i></div>
        <div class="tienda-resumen-nombre">${nombrePorId(t.tienda)}</div>
        <div class="tienda-resumen-fecha"><i class="fa-regular fa-calendar"></i> ${t.fechaAnalisis || "—"}</div>
        <div class="tienda-resumen-valor">${t.totalMaterialesAPedir}</div>
        <div class="tienda-resumen-valor-label">Materiales a pedir</div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll(".tienda-resumen-card:not(.sin-datos)").forEach(card => {
    const abrir = () => abrirModalTienda(tiendas[Number(card.dataset.idx)]);
    card.addEventListener("click", abrir);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); }
    });
  });
}

function abrirModalTienda(t) {
  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed; inset:0; background:rgba(0,0,0,0.6); z-index:60;
    display:flex; align-items:center; justify-content:center; padding:20px;
    animation: fadeIn 0.2s ease;
  `;

  const mv = t.materialMayorVenta;

  modal.innerHTML = `
    <div style="background:var(--blanco); border-radius:var(--radio); max-width:520px; width:100%; max-height:90vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.3)">
      <h3 style="margin:0; color:var(--texto-titulo); display:flex; align-items:center; gap:10px">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; background:var(--azul-base); color:#fff; border-radius:8px; font-size:14px; flex-shrink:0"><i class="fa-solid fa-store"></i></span>
        ${nombrePorId(t.tienda)}
      </h3>
      <p style="font-size:12px; color:var(--texto-claro); margin:6px 0 0">Detalle del último análisis de Abastecimiento</p>

      <div class="modal-detalle-tienda-grid">
        <div class="modal-detalle-item">
          <div class="md-label"><i class="fa-regular fa-calendar"></i> Fecha último análisis</div>
          <div class="md-valor">${t.fechaAnalisis || "—"}</div>
        </div>
        <div class="modal-detalle-item">
          <div class="md-label"><i class="fa-solid fa-user"></i> Realizado por</div>
          <div class="md-valor" style="font-size:13px">${t.usuarioNombre || "—"}</div>
        </div>
        <div class="modal-detalle-item">
          <div class="md-label"><i class="fa-solid fa-box-open"></i> Total a pedir</div>
          <div class="md-valor" style="color:var(--verde-kpi)">${t.totalMaterialesAPedir}</div>
        </div>
        <div class="modal-detalle-item">
          <div class="md-label"><i class="fa-solid fa-triangle-exclamation"></i> Pendiente por stock Kacosa</div>
          <div class="md-valor" style="color:var(--rojo-alerta)">${t.totalPendienteStockKacosa}</div>
        </div>
        <div class="modal-detalle-item">
          <div class="md-label"><i class="fa-solid fa-circle-check"></i> No ameritaron pedido</div>
          <div class="md-valor" style="color:var(--ambar-oscuro)">${t.totalNoAmeritoPedido}</div>
        </div>
        <div class="modal-detalle-item">
          <div class="md-label"><i class="fa-solid fa-trophy"></i> Material con mayor venta</div>
          <div class="md-valor" style="font-size:13px; line-height:1.4">
            ${mv ? `
              ${mv.codigo}<br>
              <span style="font-weight:400; color:var(--texto-secundario); font-size:12px">${mv.descripcion}</span><br>
              <strong style="color:#8B6BAE">${Math.round(mv.totalVentas)} und.</strong>
            ` : "—"}
          </div>
        </div>
      </div>

      <button id="cerrar-modal-tienda" style="margin-top:6px; padding:10px 24px; background:var(--azul-base); color:#fff; border:none; border-radius:var(--radio-peq); cursor:pointer; width:100%; font-weight:600">Cerrar</button>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById("cerrar-modal-tienda").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

function pintarTablaAlertasAB() {
  const container = document.getElementById("tabla-alertas-ab-container");
  if (!container) return;

  const columnas = [
    { key: "codigo", label: "Código" },
    { key: "descripcion", label: "Descripción" },
    { key: "clase", label: "Clase" },
    { key: "umb", label: "UMB" },
    { key: "stockKacosa", label: "Stock Kacosa", numeric: true },
    { key: "proyeccionCompra", label: "Proyección compra", numeric: true },
    { key: "tipoTexto", label: "Alerta" }
  ];

  const alertasAB = (alertasCache.alertas || [])
    .filter(a => a.clase === "A" || a.clase === "B")
    .map(a => ({ ...a, tipoTexto: a.tipo === "SIN_STOCK" ? "Sin stock" : "Stock bajo" }));

  const { renderizar } = crearTablaPaginada(container, columnas, 20);
  renderizar(alertasAB);
}

function pintarTablaVentas() {
  const container = document.getElementById("tabla-ventas-container");
  if (!container) return;

  const columnas = [
    { key: "tiendaNombre", label: "Tienda" },
    { key: "codigo", label: "Código" },
    { key: "descripcion", label: "Descripción" },
    { key: "umv", label: "UMV" },
    { key: "totalVentas", label: "Total ventas", numeric: true },
    { key: "promedioVentasPeriodo", label: "Promedio ventas mensual", numeric: true }
  ];

  tablaVentas = crearTablaPaginada(container, columnas, 10);
  aplicarFiltroVentas();
}

function aplicarFiltroVentas() {
  if (!tablaVentas) return;

  let datos = (datosCache.topVentas || []).map(v => ({ ...v, tiendaNombre: nombrePorId(v.tienda) }));

  if (ventasFiltroTienda) {
    datos = datos.filter(v => v.tienda === ventasFiltroTienda);
  }
  if (ventasFiltroTexto) {
    datos = datos.filter(v =>
      String(v.codigo).toLowerCase().includes(ventasFiltroTexto) ||
      String(v.descripcion).toLowerCase().includes(ventasFiltroTexto)
    );
  }

  datos.sort((a, b) => b.totalVentas - a.totalVentas);

  // Sin ningún filtro activo se muestra solo el Top 10 global. En cuanto se
  // filtra por tienda o se busca un material, se muestran todas las
  // coincidencias (ya vienen acotadas al Top 30 de cada tienda desde el
  // servidor — ver resumenAbastecimientoDirectiva_ en el backend).
  if (!ventasFiltroTienda && !ventasFiltroTexto) {
    datos = datos.slice(0, 10);
  }

  tablaVentas.renderizar(datos);
}

// Si el usuario cambia de cuenta sin recargar la página, se limpia el caché
// para que la próxima vez que se entre a esta vista se reconstruya con los
// datos y permisos correctos (mismo patrón que dashboard.js).
document.addEventListener("kacosa:usuario-listo", () => {
  vistaConstruida = false;
  datosCache = null;
  alertasCache = null;
  if (document.getElementById("vista-resumen-directiva")?.classList.contains("activa")) {
    render();
  }
});

document.addEventListener("kacosa:vista-cambiada", (e) => {
  if (e.detail.vista === "vista-resumen-directiva") {
    render();
  }
});

if (document.querySelector("#vista-resumen-directiva.activa")) {
  render();
}
