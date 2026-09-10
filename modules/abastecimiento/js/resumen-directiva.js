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

// Cada cuántos milisegundos se refresca solo (en segundo plano, sin
// interrumpir al usuario) mientras esta vista está activa.
const INTERVALO_SYNC_MS = 120000; // 2 minutos

// Paleta profesional: una pareja de tonos (barra + icono) por tienda, en el
// mismo orden que TIENDAS (tiendas.js). Si algún día se agrega una tienda de
// más, el índice se recicla con "% paletaTiendas.length" (ver pintarTiendas).
const PALETA_TIENDAS = [
  ["#14243B", "#24405F"], // Azul marino (marca)
  ["#0D9488", "#0F766E"], // Teal
  ["#4F46E5", "#4338CA"], // Índigo
  ["#D97706", "#B45309"], // Ámbar
  ["#059669", "#047857"], // Esmeralda
  ["#7C3AED", "#6D28D9"], // Violeta
  ["#C2540A", "#9A4208"], // Terracota
  ["#0891B2", "#0E7490"], // Cian
  ["#BE185D", "#9D174D"], // Vino
  ["#475569", "#334155"], // Grafito azulado
  ["#65A30D", "#4D7C0F"], // Verde oliva
  ["#2563EB", "#1D4ED8"], // Azul acero
  ["#86198F", "#701A75"], // Púrpura ciruela
  ["#92400E", "#78350F"]  // Bronce
];

let datosCache = null;    // { tiendas, topVentas } — respuesta de resumenAbastecimientoDirectiva
let alertasCache = null;  // { alertas, creadoEn, usuarioNombre } — respuesta de leerUltimaAlertaKacosa
let vistaConstruida = false;
let tablaVentas = null;
let ventasFiltroTienda = "";
let ventasFiltroTexto = "";
let intervaloSync = null;
let sincronizando = false;

function rolActual() {
  return window.KACOSA?.usuario?.rolNormalizado
    || (window.KACOSA?.usuario?.rol || "").toString().trim().toLowerCase();
}

function usuarioTieneAcceso() {
  return ROLES_ACCESO_RESUMEN_DIRECTIVA.includes(rolActual());
}

function vistaEstaActiva() {
  return document.getElementById("vista-resumen-directiva")?.classList.contains("activa") || false;
}

async function render() {
  const cont = document.getElementById("resumen-directiva-contenido");
  if (!cont) return;

  if (!window.KACOSA?.usuario) {
    cont.innerHTML = `<p class="vista-sub">Cargando información del usuario...</p>`;
    return;
  }

  if (!usuarioTieneAcceso()) {
    detenerSyncAutomatico();
    cont.innerHTML = `
      <div class="card">
        <p class="vista-sub" style="margin:0">
          <i class="fa-solid fa-lock"></i> Tu rol no tiene acceso a este resumen.
        </p>
      </div>
    `;
    return;
  }

  if (vistaConstruida && datosCache) {
    iniciarSyncAutomatico(); // por si se volvió a esta vista y el intervalo se había detenido
    return;
  }

  vistaConstruida = true;
  cont.innerHTML = `<p class="vista-sub" style="margin-top:0">Cargando resumen de todas las tiendas...</p>`;

  const ok = await cargarDatos();
  if (!ok) {
    vistaConstruida = false;
    return;
  }

  pintarVista(cont);
  iniciarSyncAutomatico();
}

/** Trae los datos frescos del bridge y actualiza el caché. Devuelve true si salió bien. */
async function cargarDatos() {
  const cont = document.getElementById("resumen-directiva-contenido");
  try {
    const [respResumen, respAlertas] = await Promise.all([
      callBridge("resumenAbastecimientoDirectiva", {}),
      callBridge("leerUltimaAlertaKacosa", {}) // sin usuarioEmail: privilegiado, trae la última de cualquiera
    ]);

    if (!respResumen.ok) {
      if (cont) {
        cont.innerHTML = `
          <div class="card">
            <p class="vista-sub" style="margin:0">
              <i class="fa-solid fa-triangle-exclamation"></i> Error al cargar el resumen: ${respResumen.error}
            </p>
          </div>
        `;
      }
      return false;
    }

    datosCache = respResumen;
    alertasCache = respAlertas.ok ? respAlertas : { alertas: [], creadoEn: null, usuarioNombre: "" };
    return true;
  } catch (err) {
    if (cont) {
      cont.innerHTML = `
        <div class="card">
          <p class="vista-sub" style="margin:0">
            <i class="fa-solid fa-triangle-exclamation"></i> Error al cargar el resumen: ${err.message}
          </p>
        </div>
      `;
    }
    return false;
  }
}

function pintarVista(cont) {
  cont.innerHTML = `
    <div style="display:flex; justify-content:flex-end; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap">
      <span id="resumen-directiva-sync-estado" style="font-size:12px; color:var(--texto-claro); display:flex; align-items:center; gap:6px"></span>
      <button id="btn-resumen-directiva-refrescar" type="button"
        style="padding:6px 14px; border:1px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); color:var(--texto-secundario); font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; transition:var(--transicion)">
        <i class="fa-solid fa-arrows-rotate"></i> Actualizar ahora
      </button>
    </div>

    <div class="tiendas-resumen-grid" id="tiendas-resumen-grid"></div>

    <div class="card">
      <h3 style="display:flex; align-items:center; gap:10px; margin-bottom:14px">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; background:rgba(139, 107, 174, 0.18); border-radius:8px; font-size:14px; color:#8B6BAE"><i class="fa-solid fa-trophy"></i></span>
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

    <div class="card">
      <h3 style="display:flex; align-items:center; gap:10px">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; background:var(--ambar-claro); border-radius:8px; font-size:14px"><i class="fa-solid fa-layer-group"></i></span>
        Materiales Clase A / B — Última Alerta Kacosa
      </h3>
      <div id="alertas-ab-subtitulo"></div>
      <div id="tabla-alertas-ab-container" style="margin-top:14px"></div>
    </div>
  `;

  pintarTablaVentas(); // crea la tabla de ventas (una sola vez; luego solo se re-filtra/repinta)
  refrescarContenido();

  document.getElementById("ventas-filtro-tienda").addEventListener("change", (e) => {
    ventasFiltroTienda = e.target.value;
    aplicarFiltroVentas();
  });
  document.getElementById("ventas-filtro-texto").addEventListener("input", (e) => {
    ventasFiltroTexto = e.target.value.toLowerCase().trim();
    aplicarFiltroVentas();
  });
  document.getElementById("btn-resumen-directiva-refrescar").addEventListener("click", () => sincronizar(true));
}

/** Repinta solo el CONTENIDO con lo que haya en caché (no reconstruye el shell ni los filtros). */
function refrescarContenido() {
  pintarTiendas(datosCache.tiendas || []);
  pintarAlertasSubtitulo();
  pintarTablaAlertasAB();
  aplicarFiltroVentas();
  pintarEstadoSync();
}

function pintarEstadoSync() {
  const el = document.getElementById("resumen-directiva-sync-estado");
  if (!el) return;
  const hora = new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  el.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--verde-kpi)"></i> Sincronizado — ${hora}`;
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
    const [c1, c2] = PALETA_TIENDAS[idx % PALETA_TIENDAS.length];
    return `
      <div class="tienda-resumen-card" data-idx="${idx}" role="button" tabindex="0" style="--tc-1:${c1}; --tc-2:${c2}">
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
}

function aplicarFiltroVentas() {
  if (!tablaVentas || !datosCache) return;

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

/* =========================================================
 *  AUTO-SINCRONIZACIÓN
 *  Mientras esta vista está activa, se refresca sola cada
 *  INTERVALO_SYNC_MS en segundo plano (sin loaders ni resetear
 *  lo que el usuario esté filtrando/buscando), para reflejar
 *  nuevos análisis o Alertas Kacosa guardados por otros
 *  usuarios sin que la directiva tenga que recargar la página.
 * ========================================================= */
async function sincronizar(manual = false) {
  if (sincronizando) return;
  if (!vistaEstaActiva() || !usuarioTieneAcceso()) return;

  sincronizando = true;
  const btn = document.getElementById("btn-resumen-directiva-refrescar");
  const icono = btn?.querySelector("i");
  if (manual && icono) icono.classList.add("fa-spin");

  const ok = await cargarDatos();
  if (ok) refrescarContenido();

  if (manual && icono) icono.classList.remove("fa-spin");
  sincronizando = false;
}

function iniciarSyncAutomatico() {
  if (intervaloSync) return; // ya está corriendo
  intervaloSync = setInterval(() => {
    // Si la pestaña del navegador está en segundo plano, se salta este ciclo
    // (se pondrá al día solo al volver, ver el listener de "visibilitychange").
    if (document.hidden) return;
    sincronizar(false);
  }, INTERVALO_SYNC_MS);
}

function detenerSyncAutomatico() {
  if (intervaloSync) {
    clearInterval(intervaloSync);
    intervaloSync = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && vistaEstaActiva() && vistaConstruida) {
    sincronizar(false);
  }
});

// Si el usuario cambia de cuenta sin recargar la página, se limpia el caché
// para que la próxima vez que se entre a esta vista se reconstruya con los
// datos y permisos correctos (mismo patrón que dashboard.js).
document.addEventListener("kacosa:usuario-listo", () => {
  vistaConstruida = false;
  datosCache = null;
  alertasCache = null;
  detenerSyncAutomatico();
  if (vistaEstaActiva()) {
    render();
  }
});

document.addEventListener("kacosa:vista-cambiada", (e) => {
  if (e.detail.vista === "vista-resumen-directiva") {
    render();
  } else {
    detenerSyncAutomatico(); // no seguir consultando el bridge si la directiva está en otra vista
  }
});

if (document.querySelector("#vista-resumen-directiva.activa")) {
  render();
}
