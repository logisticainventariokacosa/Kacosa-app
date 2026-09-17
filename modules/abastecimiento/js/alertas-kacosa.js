// js/alertas-kacosa.js
import { callBridge } from "./bridge.js";
import { supabaseSelect, supabaseSelectTodo, supabaseInsert, supabaseDelete } from "./supabase-client.js?v=1";
import { cargarAltaRotacion } from "./alta-rotacion.js?v=3";
import { obtenerStockDesdeSupabase } from "./stock-parser.js?v=1";
import { crearTablaPaginada } from "./tabla-utils.js";
import { nombrePorId, TIENDAS, almacenesPermitidosParaCentros } from "./tiendas.js?v=1";
import { obtenerInfoPaquete, cargarPaquetes } from "./paquetes.js?v=1";
import { notificarExito } from "./notificaciones.js";
import { construirHojaEstilizada, construirHojaResumen } from "./excel-estilos.js";
import { ROLES_CON_ACCESO_A_ALERTAS_DE_OTROS } from "./auth.js";

// Centros permitidos según la categoría de tienda seleccionada: Kacosa/Tiendas
// leen de Casa Matriz (1000/3000); Ferretools tiene su propio almacén (1020).
const CENTROS_KACOSA = ["1000", "3000"];
const CENTRO_FERRETOOLS = ["1020"];

/** Nombre del almacén surtidor para las etiquetas en pantalla ("Stock Kacosa" / "Stock Ferretools/Kacosa"). */
function nombreAlmacenPorCategoria(categoria) {
  return categoria === "Ferretools" ? "Ferretools/Kacosa" : "Kacosa";
}

let ultimasAlertas = [];
let periodoSeleccionado = 1;
let categoriaTiendaSeleccionada = "Tiendas"; // 'Ferretools' | 'Kacosa' | 'Tiendas' — categoría del formulario "Analizar stock"
let categoriaUltimaAlertaMostrada = "Tiendas"; // 'Ferretools' | 'Kacosa' | 'Tiendas' — categoría elegida en el selector "Ver último análisis de"
let categoriaAlertaMostrada = "Tiendas"; // categoría de las alertas actualmente EN PANTALLA (se sincroniza con categoriaUltimaAlertaMostrada al cargar, o con la del análisis recién calculado)
let mapaEmpaques = {};

function render() {
  const cont = document.getElementById("alertas-kacosa-contenido");
  if (!cont) return;

  cont.innerHTML = `
    <div class="tienda-selector">
      <span class="label"><i class="fa-solid fa-clock-rotate-left"></i> Ver último análisis de</span>
      <select id="alertas-ultima-categoria">
        <option value="Tiendas">Tiendas</option>
        <option value="Ferretools">Ferretools</option>
        <option value="Kacosa">Kacosa</option>
      </select>
    </div>
    <div class="card">
      <h3 style="margin-top:0; font-size:15px; color:var(--azul-base); display:flex; align-items:center; gap:10px">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; background:var(--ambar-claro); border-radius:8px; font-size:14px"><i class="fa-solid fa-triangle-exclamation"></i></span>
        Analizar stock de Kacosa
      </h3>
      <p style="color:var(--texto-secundario); font-size:12px; margin:4px 0 0">
        El stock se lee directo de la base de datos según la categoría elegida abajo (Kacosa/Tiendas: centros 1000 y 3000 · Ferretools: centro 1020 + 1000/3000 combinados) — ya no hace falta subir ningún archivo.
      </p>

      <div style="margin-top:16px">
        <label class="form-label">Tienda a analizar <span class="required">*</span></label>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center">
          <button class="btn-categoria-tienda" data-categoria="Ferretools" style="padding:8px 20px; border:2px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); color:var(--texto-principal); cursor:pointer; font-weight:600">Ferretools</button>
          <button class="btn-categoria-tienda" data-categoria="Kacosa" style="padding:8px 20px; border:2px solid var(--borde); border-radius:var(--radio-peq); background:var(--blanco); color:var(--texto-principal); cursor:pointer; font-weight:600">Kacosa</button>
          <button class="btn-categoria-tienda activo" data-categoria="Tiendas" style="padding:8px 20px; border:2px solid var(--azul-base); border-radius:var(--radio-peq); background:var(--azul-base); color:#fff; cursor:pointer; font-weight:600">Tiendas</button>
        </div>
        <p style="color:var(--texto-secundario); font-size:12px; margin:6px 0 0">
          Ignora en el cálculo los materiales de alta rotación que pertenecen a las otras 2 categorías.
        </p>
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
        <button id="btn-analizar-kacosa" class="btn-primario" style="min-width:200px">
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

  categoriaTiendaSeleccionada = "Tiendas";
  categoriaUltimaAlertaMostrada = "Tiendas";

  document.querySelectorAll('.btn-categoria-tienda').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.btn-categoria-tienda').forEach(b => {
        b.classList.remove('activo');
        b.style.background = 'var(--blanco)';
        b.style.color = 'var(--texto-principal)';
        b.style.borderColor = 'var(--borde)';
      });
      this.classList.add('activo');
      this.style.background = 'var(--azul-base)';
      this.style.color = '#fff';
      this.style.borderColor = 'var(--azul-base)';
      categoriaTiendaSeleccionada = this.dataset.categoria;
    });
  });

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

  const selectorUltimaCategoria = document.getElementById("alertas-ultima-categoria");
  if (selectorUltimaCategoria) {
    selectorUltimaCategoria.value = categoriaUltimaAlertaMostrada;
    selectorUltimaCategoria.addEventListener("change", (e) => {
      categoriaUltimaAlertaMostrada = e.target.value;
      cargarUltimaAlertaGuardada(categoriaUltimaAlertaMostrada);
    });
  }

  esperarUsuarioListo().then(() => cargarUltimaAlertaGuardada(categoriaUltimaAlertaMostrada));
}

/**
 * Resuelve en cuanto window.KACOSA.usuario ya está poblado (nav.js lo llena
 * dentro de su onAuthStateChanged y luego dispara "kacosa:usuario-listo").
 *
 * Por qué hace falta (13-sep-2026): cuando esta vista es la vista inicial
 * (ej. el shell abre app.html directo en "#vista=vista-alertas-kacosa", o el
 * usuario recarga/"sincroniza" la página estando en esta vista), nav.js
 * dispara "kacosa:vista-cambiada" en el evento "load" de la ventana — pero
 * la restauración de sesión de Firebase (onAuthStateChanged) es asíncrona y
 * puede no haber terminado todavía en ese momento. Sin esta espera,
 * cargarUltimaAlertaGuardada() llamaba a Supabase sin sesión: la petición
 * fallaba (o corría con window.KACOSA.usuario aún vacío, calculando mal el
 * privilegio del rol) y el error solo quedaba en consola — el usuario veía
 * la vista vacía y sin ningún aviso. Al navegar normalmente desde otra vista
 * ya cargada, window.KACOSA.usuario ya está listo, así que esto resuelve al
 * instante y no cambia el comportamiento anterior en ese caso.
 */
function esperarUsuarioListo() {
  return new Promise((resolve) => {
    if (window.KACOSA?.usuario) { resolve(); return; }
    document.addEventListener("kacosa:usuario-listo", () => resolve(), { once: true });
  });
}

/**
 * Al entrar al módulo (o al cambiar el selector "Ver último análisis de"),
 * muestra automáticamente el último cálculo de Alertas Kacosa guardado en
 * Supabase (tabla "alertas_kacosa") para la categoría elegida, sin necesidad
 * de subir un archivo.
 * @param {string} categoria - 'Ferretools' | 'Kacosa' | 'Tiendas'
 */
async function cargarUltimaAlertaGuardada(categoria) {
  const estado = document.getElementById("estado-alertas");
  const resultado = document.getElementById("resultado-alertas");
  try {
    // Roles admin/coordinador/directiva ven la última alerta de esa categoría
    // sin importar quién la haya generado. Cualquier otro rol solo ve la
    // última que él mismo generó para esa categoría (aunque otro usuario haya
    // calculado una más reciente).
    const rolNormalizado = window.KACOSA?.usuario?.rolNormalizado
      || (window.KACOSA?.usuario?.rol || "").toString().trim().toLowerCase();
    const esPrivilegiado = ROLES_CON_ACCESO_A_ALERTAS_DE_OTROS.includes(rolNormalizado);

    let filtro = "select=creado_en,periodo_meses,categoria_tienda,alertas,usuario_email,usuario_nombre";
    if (categoria) {
      filtro += "&categoria_tienda=eq." + encodeURIComponent(categoria);
    }
    if (!esPrivilegiado && window.KACOSA?.usuario?.email) {
      filtro += "&usuario_email=eq." + encodeURIComponent(window.KACOSA.usuario.email);
    }
    filtro += "&order=creado_en.desc&limit=1";

    const filas = await supabaseSelect("alertas_kacosa", filtro);
    if (!filas || filas.length === 0) {
      // Sin análisis guardado para esta categoría todavía: limpia cualquier
      // resultado de la categoría anterior que hubiera quedado en pantalla.
      if (resultado) resultado.innerHTML = "";
      if (estado) {
        estado.innerHTML = `<i class="fa-regular fa-circle-question"></i> Todavía no hay ningún análisis guardado para "${categoria}".`;
      }
      return;
    }
    const fila = filas[0];

    mostrarAlertas(fila.alertas || [], fila.categoria_tienda);

    if (estado) {
      const fecha = fila.creado_en ? new Date(fila.creado_en).toLocaleString("es-VE") : "";
      const categoriaTxt = fila.categoria_tienda ? ` — tienda: ${fila.categoria_tienda}` : "";
      const usuarioTxt = fila.usuario_nombre ? ` — realizado por ${fila.usuario_nombre}` : "";
      estado.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Mostrando el último análisis guardado${fecha ? " (" + fecha + ")" : ""}${categoriaTxt}${usuarioTxt}. Sube un archivo nuevo para recalcular.`;
    }
  } catch (err) {
    console.error("No se pudo cargar el último dashboard de Alertas Kacosa:", err);
    if (estado) {
      estado.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> No se pudo cargar el último análisis guardado (${err.message}). Vuelve a intentarlo.`;
    }
  }
}

/** Ya no hay input de archivo que (des)bloquear — solo los botones de período. */
function bloquearFormularioKacosa(bloquear) {
  document.querySelectorAll(".btn-periodo").forEach(btn => { btn.disabled = bloquear; });
  const personalizado = document.getElementById("periodo-personalizado");
  if (personalizado) personalizado.disabled = bloquear;
}

/** Limpia el archivo cargado y los resultados, dejando el módulo listo para un análisis nuevo. */
function limpiarAlertasKacosa() {
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

  // Restablece la tienda a analizar a "Tiendas" por defecto
  document.querySelectorAll(".btn-categoria-tienda").forEach(b => {
    const esTiendas = b.dataset.categoria === "Tiendas";
    b.classList.toggle("activo", esTiendas);
    b.style.background = esTiendas ? "var(--azul-base)" : "var(--blanco)";
    b.style.color = esTiendas ? "#fff" : "var(--texto-principal)";
    b.style.borderColor = esTiendas ? "var(--azul-base)" : "var(--borde)";
  });
  categoriaTiendaSeleccionada = "Tiendas";

  const resultado = document.getElementById("resultado-alertas");
  if (resultado) resultado.innerHTML = "";
  const estado = document.getElementById("estado-alertas");
  if (estado) estado.textContent = "";

  bloquearFormularioKacosa(false);

  const btnAnalizar = document.getElementById("btn-analizar-kacosa");
  if (btnAnalizar) {
    btnAnalizar.disabled = false; // ya no requiere ningún archivo
    btnAnalizar.innerHTML = '<i class="fa-solid fa-chart-column"></i> Analizar stock';
  }
  const btnLimpiar = document.getElementById("btn-limpiar-kacosa");
  if (btnLimpiar) btnLimpiar.style.display = "none";
}

async function procesarArchivo() {
  const estado = document.getElementById("estado-alertas");
  const resultado = document.getElementById("resultado-alertas");
  if (resultado) resultado.innerHTML = "";

  try {
    const btnAnalizar = document.getElementById("btn-analizar-kacosa");
    if (btnAnalizar) {
      btnAnalizar.disabled = true;
      btnAnalizar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analizando...';
    }
    bloquearFormularioKacosa(true);
    const nombreAlmacen = nombreAlmacenPorCategoria(categoriaTiendaSeleccionada);
    if (estado) estado.textContent = `Leyendo stock de ${nombreAlmacen} desde Supabase...`;

    // (11-sep-2026) El stock ya no se sube como archivo — se lee directo de
    // la tabla "stock", igual que en Nuevo Análisis. (16-sep-2026) Ferretools
    // tiene su propio almacén (centro 1020), separado de Casa Matriz Kacosa
    // (1000/3000). Ajuste del mismo día: varios materiales de alta rotación
    // categoría Ferretools SÍ pueden tener stock en Kacosa además del propio,
    // así que para Ferretools se suma el stock de AMBOS orígenes (1020 +
    // 1000/3000) para ser más precisos; Kacosa/Tiendas siguen leyendo solo
    // 1000/3000 como siempre.
    const centrosStock = categoriaTiendaSeleccionada === "Ferretools"
      ? [...CENTRO_FERRETOOLS, ...CENTROS_KACOSA]
      : CENTROS_KACOSA;
    const stockPorMaterial = Object.values(
      await obtenerStockDesdeSupabase(centrosStock, almacenesPermitidosParaCentros(centrosStock))
    );

    if (estado) estado.textContent = "Cruzando contra Alta Rotación y los últimos análisis de las tiendas...";
    const alertas = await calcularAlertasKacosa(
      stockPorMaterial,
      periodoSeleccionado,
      categoriaTiendaSeleccionada,
      mapaEmpaques,
      window.KACOSA?.usuario?.email || "",
      window.KACOSA?.usuario?.nombre || window.KACOSA?.usuario?.email || ""
    );

    if (estado) estado.textContent = `Listo — ${alertas.length} alerta(s) encontrada(s).`;
    mostrarAlertas(alertas, categoriaTiendaSeleccionada);

    // Mantiene el selector "Ver último análisis de" en sintonía con lo que se
    // acaba de calcular y guardar, para que no quede mostrando una categoría
    // distinta a la que el usuario ve en pantalla.
    categoriaUltimaAlertaMostrada = categoriaTiendaSeleccionada;
    const selectorUltimaCategoria = document.getElementById("alertas-ultima-categoria");
    if (selectorUltimaCategoria) selectorUltimaCategoria.value = categoriaUltimaAlertaMostrada;

    // No se reactiva el formulario: evita volver a procesar el mismo archivo y
    // duplicar el cálculo guardado en Supabase. "Limpiar datos" permite reiniciar.
    if (btnAnalizar) {
      btnAnalizar.innerHTML = '<i class="fa-solid fa-circle-check"></i> Análisis completado';
    }
    const btnLimpiar = document.getElementById("btn-limpiar-kacosa");
    if (btnLimpiar) btnLimpiar.style.display = "";

  } catch (err) {
    const estado = document.getElementById("estado-alertas");
    if (estado) estado.textContent = "Error al calcular las alertas: " + err.message;
    const btnAnalizar = document.getElementById("btn-analizar-kacosa");
    if (btnAnalizar) {
      btnAnalizar.disabled = false;
      btnAnalizar.innerHTML = '<i class="fa-solid fa-chart-column"></i> Analizar stock';
    }
    bloquearFormularioKacosa(false);
  }
}

/**
 * Calcula las Alertas Kacosa cruzando el stock subido, Alta Rotación y el
 * "pendiente" del último análisis de cada tienda — replica exactamente la
 * lógica que antes vivía en calcularAlertasKacosa_() (Apps Script), ahora
 * corriendo en el navegador y hablando directo con Supabase. Al final borra
 * la alerta anterior de este usuario y guarda la nueva (mismo comportamiento:
 * solo se conserva la última por usuario).
 */
async function calcularAlertasKacosa(stockKacosa, periodoMeses, categoriaTienda, mapaEmpaquesParam, usuarioEmail, usuarioNombre) {
  const mapaStock = {};
  (stockKacosa || []).forEach(m => { mapaStock[String(m.codigo)] = m; });

  const altaRotacion = await cargarAltaRotacion(categoriaTienda);

  // Trae el ÚLTIMO análisis guardado de cada tienda (una consulta por tienda)
  // y suma "pendiente" por material — igual que el backend original.
  const totalesAPedir = {};
  const detallePorTienda = {};

  for (const t of TIENDAS) {
    const idTienda = t.id;
    const ultimo = await supabaseSelect(
      "analisis",
      `tienda=eq.${encodeURIComponent(idTienda)}&select=run_id&order=creado_en.desc&limit=1`
    );
    if (!ultimo || ultimo.length === 0) continue;
    const runId = ultimo[0].run_id;

    const filas = await supabaseSelectTodo("analisis", `run_id=eq.${encodeURIComponent(runId)}&select=codigo,pendiente`);
    filas.forEach(f => {
      const codigo = f.codigo;
      const pendiente = Number(f.pendiente) || 0;
      totalesAPedir[codigo] = (totalesAPedir[codigo] || 0) + pendiente;
      if (!detallePorTienda[codigo]) detallePorTienda[codigo] = {};
      detallePorTienda[codigo][idTienda] = (detallePorTienda[codigo][idTienda] || 0) + pendiente;
    });
  }

  const mapaEmpaques = mapaEmpaquesParam || {};
  const alertas = [];

  altaRotacion.forEach(m => {
    const codigo = String(m.codigo);
    const stockInfo = mapaStock[codigo];
    const stockDisponible = stockInfo ? Number(stockInfo.stockDisponible) || 0 : 0;
    const totalAPedir = totalesAPedir[codigo] || 0;

    const umb = (stockInfo && stockInfo.unidadBase) || (mapaEmpaques[codigo] && mapaEmpaques[codigo].umb) || "UN";
    const empaque = Number(mapaEmpaques[codigo]?.empaque) || 1;
    const proyeccionBruta = totalAPedir * periodoMeses;
    const proyeccionCompra = empaque > 1 ? Math.ceil(proyeccionBruta / empaque) * empaque : Math.ceil(proyeccionBruta);

    let tipo = null;
    if (stockDisponible <= 0) {
      tipo = "SIN_STOCK";
    } else if (proyeccionCompra > stockDisponible) {
      tipo = "STOCK_BAJO";
    }

    if (tipo) {
      const distribucion = {};
      const detalle = detallePorTienda[codigo] || {};
      let totalDistribuido = 0;
      const tiendasConPedido = Object.keys(detalle).filter(t => detalle[t] > 0);

      if (tiendasConPedido.length > 0) {
        const proporciones = {};
        tiendasConPedido.forEach(t => { proporciones[t] = detalle[t] / totalAPedir; });

        tiendasConPedido.forEach(t => {
          let cantidad = Math.round(proyeccionCompra * proporciones[t]);
          if (empaque > 1) cantidad = Math.ceil(cantidad / empaque) * empaque;
          distribucion[t] = cantidad;
          totalDistribuido += cantidad;
        });

        if (totalDistribuido !== proyeccionCompra && tiendasConPedido.length > 0) {
          const diferencia = proyeccionCompra - totalDistribuido;
          const tiendaMayor = tiendasConPedido.reduce((a, b) => (proporciones[a] || 0) > (proporciones[b] || 0) ? a : b);
          distribucion[tiendaMayor] = (distribucion[tiendaMayor] || 0) + diferencia;
        }
      }

      alertas.push({
        codigo,
        descripcion: m.descripcion,
        umb,
        clase: m.clase,
        stockKacosa: stockDisponible,
        totalAPedir,
        proyeccionCompra,
        empaque,
        distribucionPorTienda: distribucion,
        tipo,
        periodoDeAbastecimiento: `${periodoMeses} mes(es)`
      });
    }
  });

  const ordenClase = { A: 0, B: 1, C: 2, D: 3 };
  alertas.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === "SIN_STOCK" ? -1 : 1;
    return (ordenClase[a.clase] ?? 9) - (ordenClase[b.clase] ?? 9);
  });

  // Solo se conserva la ÚLTIMA alerta calculada por usuario: se borra la
  // anterior de ESE MISMO usuario antes de guardar la nueva (no toca las de
  // otros usuarios).
  if (usuarioEmail) {
    await supabaseDelete("alertas_kacosa", `usuario_email=eq.${encodeURIComponent(usuarioEmail)}`);
  }

  await supabaseInsert("alertas_kacosa", [{
    creado_en: new Date().toISOString(),
    periodo_meses: periodoMeses,
    categoria_tienda: categoriaTienda || null,
    usuario_email: usuarioEmail,
    usuario_nombre: usuarioNombre,
    alertas
  }]);

  return alertas;
}

function mostrarAlertas(alertas, categoria) {
  ultimasAlertas = alertas;
  categoriaAlertaMostrada = categoria || categoriaTiendaSeleccionada;
  const nombreAlmacen = nombreAlmacenPorCategoria(categoriaAlertaMostrada);

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
    umb: a.umb || 'UN', // red de seguridad para alertas guardadas antes de este cambio
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
          <div class="label">Sin stock en ${nombreAlmacen}</div>
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
      { key: 'umb', label: 'UMB' },
      { key: 'clase', label: 'Clase' },
      { key: 'stockKacosa', label: `Stock ${nombreAlmacen}`, numeric: true },
      { key: 'totalAPedir', label: 'A pedir (todas)', numeric: true },
      { key: 'proyeccionCompra', label: 'Proyección compra', numeric: true },
      { key: 'empaque', label: 'Empaque', numeric: true },
      { key: 'periodoDeAbastecimiento', label: 'Periodo de abastecimiento' },
      { key: 'tipo', label: 'Alerta' },
      {
        key: 'accionDistribucion',
        label: '',
        render: (item) => (item.distribucion && Object.keys(item.distribucion).length > 0)
          ? `<button data-fila-accion="ver-distribucion" style="padding:4px 12px; border:none; border-radius:4px; background:var(--azul-base); color:#fff; cursor:pointer; font-size:11px"><i class="fa-solid fa-chart-column"></i> Ver distribución</button>`
          : ''
      }
    ];

    const container = document.getElementById('alertas-tabla-container');
    if (container) {
      // El botón "Ver distribución" se dibuja como parte de la fila (columna
      // 'accionDistribucion' de arriba, vía render()) y su clic se maneja con
      // onAccionFila, que crearTablaPaginada vuelve a conectar en cada
      // renderizarTabla() — así el botón sobrevive a ordenar, filtrar y
      // paginar (antes se inyectaba una sola vez con un setTimeout por
      // índice de fila, y desaparecía en cuanto la tabla se reconstruía).
      const { renderizar } = crearTablaPaginada(container, columnas, 50, {
        onAccionFila: (clave, item, accion) => {
          if (accion === 'ver-distribucion') {
            mostrarDistribucion({ ...item, distribucionPorTienda: item.distribucion });
          }
        }
      });
      
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
  }
}

function mostrarDistribucion(alerta) {
  const distribucion = alerta.distribucionPorTienda || {};
  const total = Object.values(distribucion).reduce((a, b) => a + b, 0);
  const maximo = Math.max(...Object.values(distribucion), 1);

  // En modo oscuro, --azul-base (navy de marca) NO se redefine (ver overrides
  // en app.html: se usa tal cual como fondo de botones), así que un texto con
  // color:var(--azul-base) queda casi invisible sobre el fondo oscuro del
  // modal (var(--blanco) en oscuro es #1a1d23). Por eso título y total usan
  // var(--texto-titulo), que SÍ está pensada para adaptarse a ambos temas
  // (mismo patrón que .modal-titulo en app.html). Igual, la primera barra
  // (#1B2A41) es un navy casi idéntico al fondo oscuro del modal y se perdía
  // por completo — se usa una paleta distinta para modo oscuro.
  const esOscuro = document.documentElement.classList.contains('kacosa-dark');
  const coloresBarras = esOscuro
    ? ['#5B7FBD', '#E8A03D', '#3EB08A', '#6E93D4', '#E0685A', '#A387CC', '#4FB3D9']
    : ['#1B2A41', '#E8A03D', '#2F8F6E', '#4A6FA5', '#C4432B', '#8B6BAE', '#2596BE'];

  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; inset:0; background:rgba(0,0,0,0.6); z-index:60;
    display:flex; align-items:center; justify-content:center; padding:20px;
    animation: fadeIn 0.2s ease;
  `;

  const filasOrdenadas = Object.entries(distribucion).sort((a, b) => b[1] - a[1]);

  modal.innerHTML = `
    <div style="background:var(--blanco); border-radius:var(--radio); max-width:520px; width:100%; max-height:90vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.3)">
      <h3 style="margin:0 0 12px; color:var(--texto-titulo)"><i class="fa-solid fa-chart-column"></i> Distribución sugerida por tienda</h3>
      <p style="font-size:13px; color:var(--texto-secundario); margin-bottom:18px">
        <strong>${alerta.codigo}</strong> — ${alerta.descripcion}<br>
        Total a distribuir: <strong style="color:var(--texto-titulo)">${alerta.proyeccionCompra}</strong> ${alerta.umb || 'unidades'} (empaque de ${alerta.empaque})
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
      <div style="display:flex; justify-content:space-between; padding:12px 0 0; margin-top:14px; font-weight:700; border-top:2px solid var(--borde-focus); color:var(--texto-principal)">
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
  const nombreAlmacen = nombreAlmacenPorCategoria(categoriaAlertaMostrada);
  const filas = alertas.map(a => ({
    codigo: a.codigo,
    descripcion: a.descripcion,
    umb: a.umb || 'UN', // red de seguridad para alertas guardadas antes de este cambio
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
      { label: `Sin stock en ${nombreAlmacen}`, valor: sinStock, color: "FFC4432B" },
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
    { key: 'umb', label: 'UMB', ancho: 10 },
    { key: 'clase', label: 'Clase', ancho: 8 },
    { key: 'stockKacosa', label: `Stock ${nombreAlmacen}`, ancho: 12 },
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
      usuarioNombre: window.KACOSA?.usuario?.nombre || window.KACOSA?.usuario?.email || "",
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
