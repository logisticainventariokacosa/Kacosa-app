// js/alertas-kacosa.js
import { parsearMHT, aNumero } from "./mht-parser.js";
import { callBridge } from "./bridge.js";
import { crearTablaPaginada } from "./tabla-utils.js";
import { nombrePorId, TIENDAS } from "./tiendas.js";
import { obtenerInfoPaquete, cargarPaquetes } from "./paquetes.js";
import { notificarExito } from "./notificaciones.js";
import { construirHojaEstilizada, construirHojaResumen } from "./excel-estilos.js";
import { esCodigoExcluido } from "./exclusiones.js";

// Columnas requeridas para el archivo de stock
const COLUMNAS_STOCK = [
  "Material", "Texto breve de material", "Centro", "Almacén", "Unidad medida base",
  "Denominación-almacén", "Libre utilización", "Trans./Trasl.", "En control calidad",
  "Bloqueado", "Devoluciones"
];

// Centros permitidos para Kacosa
const CENTROS_KACOSA = ["1000", "3000"];

let ultimasAlertas = [];
let periodoSeleccionado = 1;
let mapaEmpaques = {};
let archivoValido = false;
let filasCache = null;

function render() {
  const cont = document.getElementById("alertas-kacosa-contenido");
  if (!cont) return;

  cont.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0; font-size:15px; color:var(--azul-base); display:flex; align-items:center; gap:10px">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; background:var(--ambar-claro); border-radius:8px; font-size:14px"><i class="fa-solid fa-triangle-exclamation"></i></span>
        Analizar stock de Kacosa
      </h3>

      <div style="margin-top:4px">
        <label class="form-label" for="input-stock-kacosa">Archivo de stock de Kacosa <span class="required">*</span></label>
        <div class="file-input-wrapper" id="file-wrapper-kacosa">
          <span class="file-icon"><i class="fa-solid fa-building"></i></span>
          <div class="file-info">
            <div class="file-name" id="file-name-kacosa">Seleccionar archivo</div>
            <div class="file-hint">.MHT de SAP · Stock Kacosa</div>
          </div>
          <span class="file-status empty" id="file-status-kacosa">Pendiente</span>
          <input type="file" id="input-stock-kacosa" accept=".mht,.MHT">
        </div>
        <div id="validacion-stock-kacosa-alertas" class="estado-texto" style="color:var(--verde-kpi); font-size:12px; margin-top:4px"></div>
      </div>

      <div style="margin-top:16px">
        <label class="form-label">Período de abastecimiento</label>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center">
          <button class="btn-periodo activo" data-meses="1" style="padding:8px 20px; border:2px solid var(--borde); border-radius:var(--radio-peq); background:var(--azul-base); color:#fff; cursor:pointer; font-weight:600">1 Mes</button>
          <button class="btn-periodo" data-meses="2" style="padding:8px 20px; border:2px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); color:var(--texto-principal); cursor:pointer; font-weight:600">2 Meses</button>
          <button class="btn-periodo" data-meses="3" style="padding:8px 20px; border:2px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); color:var(--texto-principal); cursor:pointer; font-weight:600">3 Meses</button>
          <div id="periodo-personalizado-wrap" style="display:flex; align-items:center; gap:8px; padding:7px 16px; border:2px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); transition:border-color 0.15s, background 0.15s">
            <input type="number" id="periodo-personalizado" inputmode="numeric" min="1" max="12" step="1" placeholder="Otro"
              style="width:34px; border:none; outline:none; font-weight:600; font-size:14px; color:var(--texto-principal); background:transparent; text-align:center; padding:0" />
            <span style="font-size:13px; color:var(--texto-secundario); font-weight:600">mes(es)</span>
          </div>
        </div>
        <p id="periodo-personalizado-error" style="color:var(--rojo-alerta); font-size:12px; margin:6px 0 0; display:none">
          <i class="fa-solid fa-triangle-exclamation"></i> Ingresa un número entero entre 1 y 12.
        </p>
      </div>

      <div class="btn-group" style="margin-top:16px">
        <button id="btn-analizar-kacosa" class="btn-primario" style="min-width:200px" disabled>
          <i class="fa-solid fa-chart-column"></i> Analizar stock
        </button>
        <button id="btn-limpiar-kacosa" class="btn-secundario" style="display:none; min-width:160px">
          <i class="fa-solid fa-broom"></i> Limpiar datos
        </button>
      </div>
      <p id="estado-alertas" class="estado-texto" style="margin-top:12px"></p>
    </div>
    <div id="resultado-alertas"></div>
  `;

  archivoValido = false;
  filasCache = null;

  document.querySelectorAll('.btn-periodo').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.btn-periodo').forEach(b => {
        b.classList.remove('activo');
        b.style.background = 'var(--blanco)';
        b.style.color = 'var(--texto-principal)';
        b.style.borderColor = 'var(--borde)';
      });
      this.classList.add('activo');
      this.style.background = 'var(--azul-base)';
      this.style.color = '#fff';
      this.style.borderColor = 'var(--azul-base)';
      periodoSeleccionado = parseInt(this.dataset.meses);

      // Si el usuario había escrito un período personalizado, se limpia al elegir un preset
      const inputPersonalizado = document.getElementById('periodo-personalizado');
      const wrapPersonalizado = document.getElementById('periodo-personalizado-wrap');
      const errorPersonalizado = document.getElementById('periodo-personalizado-error');
      if (inputPersonalizado) inputPersonalizado.value = '';
      if (wrapPersonalizado) {
        wrapPersonalizado.style.borderColor = 'var(--borde)';
        wrapPersonalizado.style.background = 'var(--blanco)';
      }
      if (errorPersonalizado) errorPersonalizado.style.display = 'none';
    });
  });

  // Campo de período personalizado: solo enteros del 1 al 12
  const inputPersonalizado = document.getElementById('periodo-personalizado');
  const wrapPersonalizado = document.getElementById('periodo-personalizado-wrap');
  const errorPersonalizado = document.getElementById('periodo-personalizado-error');
  if (inputPersonalizado) {
    inputPersonalizado.addEventListener('input', function() {
      // Solo dígitos, sin decimales ni signos, máximo 2 caracteres (el tope es 12)
      const limpio = this.value.replace(/\D/g, '').slice(0, 2);
      if (this.value !== limpio) this.value = limpio;

      if (errorPersonalizado) errorPersonalizado.style.display = 'none';
      if (wrapPersonalizado) wrapPersonalizado.style.borderColor = 'var(--borde)';

      if (limpio === '') return; // el usuario está borrando, no se toca la selección todavía

      let n = parseInt(limpio, 10);
      if (n > 12) {
        n = 12;
        this.value = '12';
      }
      if (n < 1) return; // "0" solo: esperar a que termine de escribir o corrija al salir del campo

      // Se activa como selección: desmarca los botones preestablecidos
      document.querySelectorAll('.btn-periodo').forEach(b => {
        b.classList.remove('activo');
        b.style.background = 'var(--blanco)';
        b.style.color = 'var(--texto-principal)';
        b.style.borderColor = 'var(--borde)';
      });
      if (wrapPersonalizado) {
        wrapPersonalizado.style.borderColor = 'var(--azul-base)';
        wrapPersonalizado.style.background = '#E8F0FE';
      }
      periodoSeleccionado = n;
    });

    inputPersonalizado.addEventListener('blur', function() {
      if (this.value === '' || parseInt(this.value, 10) < 1) {
        this.value = '';
        if (wrapPersonalizado) {
          wrapPersonalizado.style.borderColor = 'var(--borde)';
          wrapPersonalizado.style.background = 'var(--blanco)';
        }
        if (errorPersonalizado) errorPersonalizado.style.display = this.dataset.tocado ? 'block' : 'none';
        // Si no quedó ningún preset activo, vuelve a "1 Mes" por defecto
        if (!document.querySelector('.btn-periodo.activo')) {
          const btn1 = document.querySelector('.btn-periodo[data-meses="1"]');
          if (btn1) btn1.click();
        }
      }
    });

    inputPersonalizado.addEventListener('focus', function() {
      this.dataset.tocado = '1';
    });
  }

  setupFileInput();

  cargarPaquetes().then(pkg => {
    mapaEmpaques = pkg || {};
  });

  const btnAnalizar = document.getElementById("btn-analizar-kacosa");
  if (btnAnalizar) {
    btnAnalizar.addEventListener("click", procesarArchivo);
  }
  const btnLimpiar = document.getElementById("btn-limpiar-kacosa");
  if (btnLimpiar) {
    btnLimpiar.addEventListener("click", limpiarAlertasKacosa);
  }

  cargarUltimaAlertaGuardada();
}

/**
 * Al entrar al módulo, muestra automáticamente el último cálculo de Alertas Kacosa
 * guardado en Supabase (tabla "alertas_kacosa"), sin necesidad de subir un archivo.
 */
async function cargarUltimaAlertaGuardada() {
  const estado = document.getElementById("estado-alertas");
  try {
    const resp = await callBridge("leerUltimaAlertaKacosa", {});
    if (!resp.ok || !resp.alertas || resp.alertas.length === 0) return;

    mostrarAlertas(resp.alertas);

    if (estado) {
      const fecha = resp.creadoEn ? new Date(resp.creadoEn).toLocaleString("es-VE") : "";
      estado.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Mostrando el último análisis guardado${fecha ? " (" + fecha + ")" : ""}. Sube un archivo nuevo para recalcular.`;
    }
  } catch (err) {
    console.error("No se pudo cargar el último dashboard de Alertas Kacosa:", err);
  }
}

function setupFileInput() {
  const input = document.getElementById("input-stock-kacosa");
  const nameEl = document.getElementById("file-name-kacosa");
  const statusEl = document.getElementById("file-status-kacosa");
  const wrapper = document.getElementById("file-wrapper-kacosa");
  const validEl = document.getElementById("validacion-stock-kacosa-alertas");
  const btnAnalizar = document.getElementById("btn-analizar-kacosa");

  if (!input) return;

  input.removeEventListener('change', handleFileChange);
  input.addEventListener('change', handleFileChange);

  if (wrapper) {
    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      wrapper.classList.add('dragover');
    });
    wrapper.addEventListener('dragleave', () => {
      wrapper.classList.remove('dragover');
    });
    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      wrapper.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  async function handleFileChange(e) {
    const input = e.target;
    archivoValido = false;
    filasCache = null;
    if (btnAnalizar) btnAnalizar.disabled = true;

    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (nameEl) nameEl.textContent = file.name;
      if (statusEl) {
        statusEl.innerHTML = '<i class="fa-solid fa-check"></i> Cargado';
        statusEl.className = 'file-status loaded';
      }
      if (wrapper) wrapper.classList.add('loaded');

      try {
        const texto = await file.text();
        const filas = parsearMHT(texto);
        const resultado = validarArchivoStock(filas);
        
        if (validEl) {
          validEl.innerHTML = resultado.mensaje;
          validEl.style.color = resultado.valido ? 'var(--verde-kpi)' : 'var(--rojo-alerta)';
        }
        
        if (resultado.valido) {
          archivoValido = true;
          filasCache = filas;
          if (btnAnalizar) btnAnalizar.disabled = false;
        } else {
          archivoValido = false;
          filasCache = null;
          if (btnAnalizar) btnAnalizar.disabled = true;
        }
      } catch (err) {
        if (validEl) {
          validEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error al leer el archivo: ' + err.message;
          validEl.style.color = 'var(--rojo-alerta)';
        }
        archivoValido = false;
        filasCache = null;
        if (btnAnalizar) btnAnalizar.disabled = true;
      }
    } else {
      if (nameEl) nameEl.textContent = 'Seleccionar archivo';
      if (statusEl) {
        statusEl.textContent = 'Pendiente';
        statusEl.className = 'file-status empty';
      }
      if (wrapper) wrapper.classList.remove('loaded');
      if (validEl) validEl.innerHTML = '';
      archivoValido = false;
      filasCache = null;
      if (btnAnalizar) btnAnalizar.disabled = true;
    }
  }
}

function validarArchivoStock(filas) {
  if (filas.length === 0) {
    return { valido: false, mensaje: '<i class="fa-solid fa-triangle-exclamation"></i> El archivo está vacío o no tiene datos' };
  }

  const columnasExistentes = Object.keys(filas[0]);
  const faltantes = COLUMNAS_STOCK.filter(col => !columnasExistentes.includes(col));

  if (faltantes.length > 0) {
    return { 
      valido: false, 
      mensaje: `<i class="fa-solid fa-triangle-exclamation"></i> El archivo no tiene las columnas correctas. Faltan: ${faltantes.join(', ')}`
    };
  }

  const centros = new Set();
  filas.forEach(f => {
    const centro = String(f["Centro"] || "").trim();
    if (centro) centros.add(centro);
  });

  const centrosInvalidos = [...centros].filter(c => !CENTROS_KACOSA.includes(c));
  
  if (centrosInvalidos.length > 0) {
    return {
      valido: false,
      mensaje: `<i class="fa-solid fa-triangle-exclamation"></i> El archivo contiene centro(s) que no pertenecen a Kacosa (${centrosInvalidos.join(", ")}). Kacosa solo puede ser 1000 y/o 3000.`
    };
  }

  if (centros.size === 0) {
    return { valido: false, mensaje: '<i class="fa-solid fa-triangle-exclamation"></i> El archivo no tiene datos de Centro reconocibles.' };
  }

  return { 
    valido: true, 
    mensaje: `<i class="fa-solid fa-circle-check"></i> Archivo válido: contiene todas las columnas requeridas y solo centros Kacosa (${[...centros].join(", ")})`
  };
}

/** Bloquea o desbloquea el input de archivo y los botones de período mientras se procesa. */
function bloquearFormularioKacosa(bloquear) {
  const input = document.getElementById("input-stock-kacosa");
  if (input) input.disabled = bloquear;
  document.querySelectorAll(".btn-periodo").forEach(btn => { btn.disabled = bloquear; });
  const personalizado = document.getElementById("periodo-personalizado");
  if (personalizado) personalizado.disabled = bloquear;
}

/** Limpia el archivo cargado y los resultados, dejando el módulo listo para un análisis nuevo. */
function limpiarAlertasKacosa() {
  const input = document.getElementById("input-stock-kacosa");
  const nameEl = document.getElementById("file-name-kacosa");
  const statusEl = document.getElementById("file-status-kacosa");
  const wrapper = document.getElementById("file-wrapper-kacosa");
  const validEl = document.getElementById("validacion-stock-kacosa-alertas");

  if (input) input.value = "";
  if (nameEl) nameEl.textContent = "Seleccionar archivo";
  if (statusEl) {
    statusEl.textContent = "Pendiente";
    statusEl.className = "file-status empty";
  }
  if (wrapper) wrapper.classList.remove("loaded");
  if (validEl) validEl.innerHTML = "";

  archivoValido = false;
  filasCache = null;

  // Restablece el período de abastecimiento a "1 Mes" por defecto
  const inputPersonalizado = document.getElementById("periodo-personalizado");
  const wrapPersonalizado = document.getElementById("periodo-personalizado-wrap");
  const errorPersonalizado = document.getElementById("periodo-personalizado-error");
  if (inputPersonalizado) { inputPersonalizado.value = ""; delete inputPersonalizado.dataset.tocado; }
  if (wrapPersonalizado) {
    wrapPersonalizado.style.borderColor = "var(--borde)";
    wrapPersonalizado.style.background = "var(--blanco)";
  }
  if (errorPersonalizado) errorPersonalizado.style.display = "none";
  document.querySelectorAll(".btn-periodo").forEach(b => {
    const esUno = b.dataset.meses === "1";
    b.classList.toggle("activo", esUno);
    b.style.background = esUno ? "var(--azul-base)" : "var(--blanco)";
    b.style.color = esUno ? "#fff" : "var(--texto-principal)";
    b.style.borderColor = esUno ? "var(--azul-base)" : "var(--borde)";
  });
  periodoSeleccionado = 1;

  const resultado = document.getElementById("resultado-alertas");
  if (resultado) resultado.innerHTML = "";
  const estado = document.getElementById("estado-alertas");
  if (estado) estado.textContent = "";

  bloquearFormularioKacosa(false);

  const btnAnalizar = document.getElementById("btn-analizar-kacosa");
  if (btnAnalizar) {
    btnAnalizar.disabled = true; // vuelve a requerir un archivo válido
    btnAnalizar.innerHTML = '<i class="fa-solid fa-chart-column"></i> Analizar stock';
  }
  const btnLimpiar = document.getElementById("btn-limpiar-kacosa");
  if (btnLimpiar) btnLimpiar.style.display = "none";
}

async function procesarArchivo() {
  const estado = document.getElementById("estado-alertas");
  const resultado = document.getElementById("resultado-alertas");
  if (resultado) resultado.innerHTML = "";

  if (!archivoValido || !filasCache) {
    if (estado) estado.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> El archivo no es válido. Verifica que tenga las columnas correctas y solo centros 1000/3000.';
    return;
  }

  try {
    const btnAnalizar = document.getElementById("btn-analizar-kacosa");
    if (btnAnalizar) {
      btnAnalizar.disabled = true;
      btnAnalizar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analizando...';
    }
    bloquearFormularioKacosa(true);
    if (estado) estado.textContent = "Procesando archivo...";

    const filas = filasCache;

    if (estado) estado.textContent = "Agrupando stock por material...";
    const stockPorMaterial = agruparStockKacosa(filas);

    if (estado) estado.textContent = "Cruzando contra Alta Rotación y los últimos análisis de las tiendas...";
    const resp = await callBridge("alertasKacosa", { 
      stockKacosa: stockPorMaterial,
      periodoMeses: periodoSeleccionado,
      mapaEmpaques: mapaEmpaques
    });

    if (!resp.ok) {
      if (estado) estado.textContent = "Error: " + resp.error;
      if (btnAnalizar) {
        btnAnalizar.disabled = false;
        btnAnalizar.innerHTML = '<i class="fa-solid fa-chart-column"></i> Analizar stock';
      }
      bloquearFormularioKacosa(false);
      return;
    }

    if (estado) estado.textContent = `Listo — ${resp.alertas.length} alerta(s) encontrada(s).`;
    mostrarAlertas(resp.alertas);

    // No se reactiva el formulario: evita volver a procesar el mismo archivo y
    // duplicar el cálculo guardado en Supabase. "Limpiar datos" permite reiniciar.
    if (btnAnalizar) {
      btnAnalizar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Análisis completado';
    }
    const btnLimpiar = document.getElementById("btn-limpiar-kacosa");
    if (btnLimpiar) btnLimpiar.style.display = "";

  } catch (err) {
    const estado = document.getElementById("estado-alertas");
    if (estado) estado.textContent = "Error al procesar el archivo: " + err.message;
    const btnAnalizar = document.getElementById("btn-analizar-kacosa");
    if (btnAnalizar) {
      btnAnalizar.disabled = false;
      btnAnalizar.innerHTML = '<i class="fa-solid fa-chart-column"></i> Analizar stock';
    }
    bloquearFormularioKacosa(false);
  }
}

function agruparStockKacosa(filas) {
  const mapa = {};

  filas.forEach(f => {
    const centro = String(f["Centro"] || "").trim();
    if (!CENTROS_KACOSA.includes(centro)) return;

    const codigo = String(f["Material"] || "").trim();
    if (!codigo) return;
    if (esCodigoExcluido(codigo)) return; // código en lista de exclusión: se ignora por completo

    const libreUtilizacion = aNumero(f["Libre utilización"]);
    const transTrasl = aNumero(f["Trans./Trasl."]);
    const devoluciones = aNumero(f["Devoluciones"]);
    const disponible = libreUtilizacion + transTrasl + devoluciones;

    if (!mapa[codigo]) {
      mapa[codigo] = {
        codigo: codigo,
        descripcion: f["Texto breve de material"] || "",
        stockDisponible: 0
      };
    }
    mapa[codigo].stockDisponible += disponible;
  });

  return Object.values(mapa);
}

function mostrarAlertas(alertas) {
  ultimasAlertas = alertas;

  // Se exponen las alertas globalmente para que el chat con Gemini
  // pueda usarlas como contexto adicional (ver js/chat.js).
  window.KACOSA = window.KACOSA || {};
  window.KACOSA.ultimasAlertasKacosa = alertas;
  window.KACOSA.periodoAlertasKacosa = periodoSeleccionado;

  const resultado = document.getElementById("resultado-alertas");

  if (alertas.length === 0) {
    if (resultado) resultado.innerHTML = `<div class="card"><p class="vista-sub" style="margin:0">No hay alertas — todo el stock de alta rotación está cubierto. <i class="fa-solid fa-circle-check"></i></p></div>`;
    return;
  }

  const sinStock = alertas.filter(a => a.tipo === "SIN_STOCK");
  const stockBajo = alertas.filter(a => a.tipo === "STOCK_BAJO");

  // Total de códigos y de piezas que forman la solicitud de compras completa
  const totalCodigosSolicitud = alertas.length;
  const totalPiezasSolicitud = alertas.reduce((acc, a) => acc + (Number(a.proyeccionCompra) || 0), 0);

  // Asegurar que periodoDeAbastecimiento tenga el valor seleccionado
  const datosTabla = alertas.map(a => ({
    codigo: a.codigo,
    descripcion: a.descripcion,
    clase: a.clase,
    stockKacosa: a.stockKacosa,
    totalAPedir: a.totalAPedir,
    proyeccionCompra: a.proyeccionCompra,
    empaque: a.empaque,
    periodoDeAbastecimiento: a.periodoDeAbastecimiento || `${periodoSeleccionado} mes(es)`,
    tipo: a.tipo,
    distribucion: a.distribucionPorTienda || {}
  }));

  if (resultado) {
    resultado.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card rojo">
          <div class="kpi-icono"><i class="fa-solid fa-triangle-exclamation"></i></div>
          <div class="label">Sin stock en Kacosa</div>
          <div class="valor">${sinStock.length}</div>
        </div>
        <div class="kpi-card ambar">
          <div class="kpi-icono"><i class="fa-solid fa-boxes-stacked"></i></div>
          <div class="label">Stock insuficiente</div>
          <div class="valor">${stockBajo.length}</div>
        </div>
        <div class="kpi-card violeta">
          <div class="kpi-icono"><i class="fa-solid fa-barcode"></i></div>
          <div class="label">Total códigos por solicitud de compras</div>
          <div class="valor">${totalCodigosSolicitud}</div>
        </div>
        <div class="kpi-card azul" style="background: linear-gradient(135deg, var(--blanco) 55%, #E8F0FE 130%);">
          <div class="kpi-icono" style="background: linear-gradient(135deg, #4A6FA5, #2A4A7A); box-shadow: 0 4px 12px rgba(42, 74, 122, 0.35); color:#fff;">
            <i class="fa-solid fa-cubes"></i>
          </div>
          <div class="label">Total piezas por solicitud de compra</div>
          <div class="valor">${totalPiezasSolicitud}</div>
        </div>
      </div>
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:16px">
          <h3 style="margin:0; font-size:14px; color:var(--azul-base)">Lista de alertas</h3>
          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <div style="position:relative; display:inline-flex; align-items:center">
              <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; font-size:12px; color:var(--texto-claro); pointer-events:none"></i>
              <input type="text" id="alertas-buscar" placeholder="Buscar por código o descripción..." 
                     style="padding:8px 14px 8px 32px; border:1.5px solid var(--borde); border-radius:var(--radio-peq); font-size:13px; min-width:200px">
            </div>
            <button id="btn-descargar-alertas" class="btn-primario" style="padding:8px 16px; font-size:12px; margin:0">
              <i class="fa-solid fa-download"></i> Descargar Excel
            </button>
            <button id="btn-enviar-correo-alertas" class="btn-secundario" style="padding:8px 16px; font-size:12px; margin:0">
              <i class="fa-solid fa-envelope"></i> Enviar por correo
            </button>
          </div>
        </div>
        <div id="alertas-tabla-container"></div>
      </div>
    `;

    const columnas = [
      { key: 'codigo', label: 'Código' },
      { key: 'descripcion', label: 'Descripción' },
      { key: 'clase', label: 'Clase' },
      { key: 'stockKacosa', label: 'Stock Kacosa', numeric: true },
      { key: 'totalAPedir', label: 'A pedir (todas)', numeric: true },
      { key: 'proyeccionCompra', label: 'Proyección compra', numeric: true },
      { key: 'empaque', label: 'Empaque', numeric: true },
      { key: 'periodoDeAbastecimiento', label: 'Periodo de abastecimiento' },
      { key: 'tipo', label: 'Alerta' }
    ];

    const container = document.getElementById('alertas-tabla-container');
    if (container) {
      const { renderizar } = crearTablaPaginada(container, columnas, 50);
      
      // Guardar referencia para el filtro
      let renderizarTabla = renderizar;
      
      // Renderizar inicial
      renderizarTabla(datosTabla);

      // Configurar búsqueda
      const buscar = document.getElementById('alertas-buscar');
      if (buscar) {
        buscar.addEventListener('input', (e) => {
          const termino = e.target.value.toLowerCase().trim();
          let datosFiltrados;
          
          if (!termino) {
            datosFiltrados = datosTabla;
          } else {
            datosFiltrados = datosTabla.filter(m => 
              String(m.codigo).toLowerCase().includes(termino) || 
              String(m.descripcion).toLowerCase().includes(termino)
            );
          }
          
          // Re-renderizar la tabla con los datos filtrados
          renderizarTabla(datosFiltrados);
        });
      }
    }

    const descargar = document.getElementById('btn-descargar-alertas');
    if (descargar) {
      descargar.addEventListener('click', () => descargarAlertasExcel(alertas));
    }

    const enviarCorreoBtn = document.getElementById('btn-enviar-correo-alertas');
    if (enviarCorreoBtn) {
      enviarCorreoBtn.addEventListener('click', () => enviarCorreoAlertas(alertas));
    }

    setTimeout(() => {
      document.querySelectorAll('#alertas-tabla-container tbody tr').forEach((row, index) => {
        const alerta = alertas[index];
        if (alerta && Object.keys(alerta.distribucionPorTienda || {}).length > 0) {
          const td = row.querySelector('td:last-child');
          if (td) {
            const btn = document.createElement('button');
            btn.innerHTML = '<i class="fa-solid fa-chart-column"></i> Ver distribución';
            btn.style.cssText = 'padding:4px 12px; border:none; border-radius:4px; background:var(--azul-base); color:#fff; cursor:pointer; font-size:11px';
            btn.addEventListener('click', () => mostrarDistribucion(alerta));
            td.appendChild(btn);
          }
        }
      });
    }, 100);
  }
}

function mostrarDistribucion(alerta) {
  const distribucion = alerta.distribucionPorTienda || {};
  const total = Object.values(distribucion).reduce((a, b) => a + b, 0);
  const maximo = Math.max(...Object.values(distribucion), 1);

  const coloresBarras = ['#1B2A41', '#E8A03D', '#2F8F6E', '#4A6FA5', '#C4432B', '#8B6BAE', '#2596BE'];

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; inset:0; background:rgba(0,0,0,0.6); z-index:60;
    display:flex; align-items:center; justify-content:center; padding:20px;
    animation: fadeIn 0.2s ease;
  `;

  const filasOrdenadas = Object.entries(distribucion).sort((a, b) => b[1] - a[1]);

  modal.innerHTML = `
    <div style="background:var(--blanco); border-radius:var(--radio); max-width:520px; width:100%; max-height:90vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.3)">
      <h3 style="margin:0 0 12px; color:var(--azul-base)"><i class="fa-solid fa-chart-column"></i> Distribución sugerida por tienda</h3>
      <p style="font-size:13px; color:var(--texto-secundario); margin-bottom:18px">
        <strong>${alerta.codigo}</strong> — ${alerta.descripcion}<br>
        Total a distribuir: <strong style="color:var(--azul-base)">${alerta.proyeccionCompra}</strong> unidades (empaque de ${alerta.empaque})
      </p>
      <div style="display:flex; flex-direction:column; gap:12px">
        ${filasOrdenadas.map(([tienda, cantidad], idx) => {
          const pct = total > 0 ? Math.round((cantidad / total) * 100) : 0;
          const anchoBarra = Math.max(4, Math.round((cantidad / maximo) * 100));
          const color = coloresBarras[idx % coloresBarras.length];
          return `
            <div>
              <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px">
                <span style="font-weight:600">${nombrePorId(tienda)}</span>
                <span><strong>${cantidad}</strong> <span style="color:var(--texto-claro); font-size:11px">(${pct}%)</span></span>
              </div>
              <div style="background:var(--fondo); border-radius:6px; height:14px; overflow:hidden">
                <div style="width:${anchoBarra}%; height:100%; background:${color}; border-radius:6px; transition:width .3s"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div style="display:flex; justify-content:space-between; padding:12px 0 0; margin-top:14px; font-weight:700; border-top:2px solid var(--azul-base)">
        <span>TOTAL</span>
        <span>${total}</span>
      </div>
      <button id="cerrar-modal-dist" style="margin-top:16px; padding:10px 24px; background:var(--azul-base); color:#fff; border:none; border-radius:var(--radio-peq); cursor:pointer; width:100%; font-weight:600">Cerrar</button>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById('cerrar-modal-dist').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

/** Construye el workbook de Excel de Alertas Kacosa (Resumen + detalle). Se reutiliza para descargar y para enviar por correo. */
function construirWorkbookAlertas_(alertas) {
  const filas = alertas.map(a => ({
    codigo: a.codigo,
    descripcion: a.descripcion,
    clase: a.clase,
    stockKacosa: a.stockKacosa,
    totalAPedir: a.totalAPedir,
    proyeccionCompra: a.proyeccionCompra,
    empaque: a.empaque,
    periodoDeAbastecimiento: a.periodoDeAbastecimiento || `${periodoSeleccionado} mes(es)`,
    tipo: a.tipo,
    alertaTexto: a.tipo === "SIN_STOCK" ? "Sin stock" : "Stock bajo",
    distribucion: Object.entries(a.distribucionPorTienda || {})
      .map(([t, c]) => `${nombrePorId(t)}: ${c}`)
      .join("; ")
  }));

  const sinStock = filas.filter(f => f.tipo === "SIN_STOCK").length;
  const stockBajo = filas.filter(f => f.tipo === "STOCK_BAJO").length;
  const totalProyeccion = filas.reduce((acc, f) => acc + (Number(f.proyeccionCompra) || 0), 0);

  const wb = XLSX.utils.book_new();

  const wsResumen = construirHojaResumen(
    "Alertas Kacosa — Materiales de Alta Rotación",
    [
      { label: "Total de alertas", valor: filas.length, color: "FF1B2A41" },
      { label: "Sin stock en Kacosa", valor: sinStock, color: "FFC4432B" },
      { label: "Stock insuficiente", valor: stockBajo, color: "FFE8A03D" },
      { label: "Proyección de compra total", valor: totalProyeccion, color: "FF2F8F6E" }
    ],
    [
      `Periodo de abastecimiento proyectado: ${filas[0]?.periodoDeAbastecimiento || `${periodoSeleccionado} mes(es)`}`,
      `Generado el ${new Date().toLocaleDateString("es-VE")}.`,
      "Sistema de Abastecimiento KACOSA."
    ]
  );
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  const wsAlertas = construirHojaEstilizada(filas, [
    { key: 'codigo', label: 'Código', ancho: 14 },
    { key: 'descripcion', label: 'Descripción', ancho: 36 },
    { key: 'clase', label: 'Clase', ancho: 8 },
    { key: 'stockKacosa', label: 'Stock Kacosa', ancho: 12 },
    { key: 'totalAPedir', label: 'A Pedir (todas)', ancho: 14 },
    { key: 'proyeccionCompra', label: 'Proyección Compra', ancho: 16 },
    { key: 'empaque', label: 'Empaque', ancho: 10 },
    { key: 'periodoDeAbastecimiento', label: 'Periodo_De_Abastecimiento', ancho: 20 },
    { key: 'alertaTexto', label: 'Alerta', ancho: 12 },
    { key: 'distribucion', label: 'Distribución por Tienda', ancho: 50 }
  ], {
    colorearPorAlerta: true,
    columnasDestacadas: [{ key: 'proyeccionCompra', color: 'FFC4432B' }]
  });
  XLSX.utils.book_append_sheet(wb, wsAlertas, "Alertas_Kacosa");

  return { wb, filas, sinStock, stockBajo, totalProyeccion };
}

function descargarAlertasExcel(alertas) {
  const btn = document.getElementById("btn-descargar-alertas");
  try {
    const { wb, filas } = construirWorkbookAlertas_(alertas);

    const fecha = new Date().toLocaleDateString("es-VE").replace(/\//g, "-");
    XLSX.writeFile(wb, `Alertas_Kacosa_${fecha}.xlsx`);
    notificarExito(`Se descargó el Excel con ${filas.length} alerta(s) y proyección de compra por tienda.`, { titulo: "Excel descargado" });
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Archivo descargado correctamente';
    }
  } catch (err) {
    console.error(err);
    notificarExito("No se pudo descargar el archivo: " + err.message, { titulo: "Error al descargar", icono: '<i class="fa-solid fa-triangle-exclamation"></i>', segundos: 6 });
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-download"></i> Descargar Excel';
    }
  }
}

/**
 * Envía por correo el Excel de Alertas Kacosa.
 * Va a compras.nacionales@kacosa.com, además de los destinatarios registrados
 * en el Apps Script y el correo del usuario de la sesión actual.
 */
async function enviarCorreoAlertas(alertas) {
  const btn = document.getElementById("btn-enviar-correo-alertas");
  const estado = document.getElementById("estado-alertas");

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
    }
    if (estado) estado.textContent = "Preparando el archivo...";

    const { wb, filas, sinStock, stockBajo, totalProyeccion } = construirWorkbookAlertas_(alertas);

    const fecha = new Date().toLocaleDateString("es-VE").replace(/\//g, "-");
    const archivos = [{
      nombre: `Alertas_Kacosa_${fecha}.xlsx`,
      base64: XLSX.write(wb, { type: "base64", bookType: "xlsx" })
    }];

    if (estado) estado.textContent = "Enviando correo...";

    const resp = await callBridge("sendReport", {
      tipoReporte: "alertasKacosa",
      fechaReporte: new Date().toLocaleDateString("es-VE"),
      periodoDeAbastecimiento: filas[0]?.periodoDeAbastecimiento || `${periodoSeleccionado} mes(es)`,
      resumen: {
        totalAlertas: filas.length,
        sinStock,
        stockBajo,
        totalProyeccion
      },
      destinatariosAdicionales: ["compras.nacionales@kacosa.com", "compras.internacionales@kacosa.com"],
      usuarioEmail: window.KACOSA?.usuario?.email || "",
      archivos
    });

    if (estado) estado.textContent = resp.ok ? resp.mensaje : "Error al enviar: " + resp.error;

    if (resp.ok) {
      notificarExito("El correo con las Alertas Kacosa se envió correctamente a Compras Nacionales.", { titulo: "Correo enviado" });
      if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Correo enviado con éxito';
    } else {
      notificarExito("No se pudo enviar el correo: " + resp.error, { titulo: "Error al enviar", icono: '<i class="fa-solid fa-triangle-exclamation"></i>', segundos: 6 });
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-envelope"></i> Enviar por correo';
      }
    }
  } catch (err) {
    console.error(err);
    if (estado) estado.textContent = "Error al enviar: " + err.message;
    notificarExito("No se pudo enviar el correo: " + err.message, { titulo: "Error al enviar", icono: '<i class="fa-solid fa-triangle-exclamation"></i>', segundos: 6 });
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-envelope"></i> Enviar por correo';
    }
  }
}

document.addEventListener("kacosa:vista-cambiada", (e) => {
  if (e.detail.vista === "vista-alertas-kacosa") {
    render();
  }
});

if (document.querySelector("#vista-alertas-kacosa.activa")) {
  render();
}
