// js/chat.js
import { callBridge } from "./bridge.js";
import { nombrePorId } from "./tiendas.js";

let historial = []; // [{rol: "usuario"|"agente", texto}]
let abierto = false;

function construirUI() {
  const boton = document.createElement("button");
  boton.id = "chat-boton-flotante";
  boton.innerHTML = '<i class="fa-solid fa-robot"></i>';
  boton.title = "Hablar con el agente de abastecimiento";
  document.body.appendChild(boton);

  const panel = document.createElement("div");
  panel.id = "chat-panel";
  panel.className = "oculto";
  panel.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-info">
        <div class="chat-header-icono"><i class="fa-solid fa-robot"></i></div>
        <div>
          <div class="chat-titulo">Agente de Abastecimiento</div>
          <div class="chat-subtitulo" id="chat-contexto-info">Hola</div>
        </div>
      </div>
      <div class="chat-header-acciones">
        <button id="chat-manos-libres-toggle" title="Modo manos libres (conversación por voz)" style="display:none"><i class="fa-solid fa-headset"></i></button>
        <button id="chat-voz-toggle" title="Leer respuestas en voz alta"><i class="fa-solid fa-volume-xmark"></i></button>
        <button id="chat-cerrar" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div class="chat-mensajes" id="chat-mensajes">
      <div class="chat-msg chat-msg-agente">
        Hola, soy tu asistente de análisis de datos y abastecimiento. Genera o carga un análisis y pregúntame lo que necesites saber sobre los resultados.
      </div>
    </div>
    <form id="chat-form" class="chat-form">
      <button type="button" id="chat-mic-btn" title="Hablar" style="display:none"><i class="fa-solid fa-microphone"></i></button>
      <input type="text" id="chat-input" placeholder="Escribe tu pregunta..." autocomplete="off">
      <button type="submit"><i class="fa-solid fa-paper-plane"></i></button>
    </form>
  `;
  document.body.appendChild(panel);

  boton.addEventListener("click", () => alternarPanel(true));
  document.getElementById("chat-cerrar").addEventListener("click", () => alternarPanel(false));
  document.getElementById("chat-form").addEventListener("submit", enviarPregunta);

  inicializarVoz();
}

// ============================================================
//  VOZ: hablarle al agente (reconocimiento de voz) y que responda
//  hablado (texto a voz). Usa la Web Speech API del navegador,
//  no requiere backend ni configuración adicional.
// ============================================================
let vozActivada = localStorage.getItem("kacosa-chat-voz") === "1";
let modoManosLibres = localStorage.getItem("kacosa-chat-manos-libres") === "1";
let reconocimiento = null;
let escuchando = false;

function inicializarVoz() {
  // Dispara la carga de voces del navegador cuanto antes (en algunos navegadores
  // la lista llega vacía la primera vez y se completa un instante después).
  if (window.speechSynthesis) window.speechSynthesis.getVoices();

  // --- Texto a voz (leer las respuestas del agente) ---
  const btnVoz = document.getElementById("chat-voz-toggle");
  if (window.speechSynthesis && btnVoz) {
    actualizarIconoVoz();
    btnVoz.addEventListener("click", () => {
      vozActivada = !vozActivada;
      localStorage.setItem("kacosa-chat-voz", vozActivada ? "1" : "0");
      actualizarIconoVoz();
      if (!vozActivada) window.speechSynthesis.cancel();
    });
  } else if (btnVoz) {
    btnVoz.style.display = "none"; // el navegador no soporta síntesis de voz
  }

  // --- Reconocimiento de voz (hablarle al agente) ---
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btnMic = document.getElementById("chat-mic-btn");
  const btnManosLibres = document.getElementById("chat-manos-libres-toggle");

  if (SpeechRecognitionAPI && btnMic) {
    reconocimiento = new SpeechRecognitionAPI();
    reconocimiento.lang = "es-419";
    reconocimiento.continuous = false;
    reconocimiento.interimResults = false;

    reconocimiento.onstart = () => {
      escuchando = true;
      btnMic.classList.add("escuchando");
    };
    reconocimiento.onend = () => {
      escuchando = false;
      btnMic.classList.remove("escuchando");
    };
    reconocimiento.onerror = (e) => {
      escuchando = false;
      btnMic.classList.remove("escuchando");
      if (e.error !== "no-speech" && e.error !== "aborted") {
        console.error("Error de reconocimiento de voz:", e.error);
      }
    };
    reconocimiento.onresult = (e) => {
      const texto = e.results[0][0].transcript;
      const input = document.getElementById("chat-input");
      if (input && texto) {
        input.value = texto;
        document.getElementById("chat-form").requestSubmit();
      }
    };

    btnMic.style.display = "";
    btnMic.addEventListener("click", () => {
      if (escuchando) {
        reconocimiento.stop();
      } else {
        window.speechSynthesis?.cancel(); // no se solapa con una lectura en curso
        try { reconocimiento.start(); } catch (err) { /* ya estaba iniciado */ }
      }
    });

    // El modo manos libres solo tiene sentido si además hay micrófono disponible
    if (btnManosLibres) {
      btnManosLibres.style.display = "";
      actualizarIconoManosLibres();
      btnManosLibres.addEventListener("click", () => {
        modoManosLibres = !modoManosLibres;
        localStorage.setItem("kacosa-chat-manos-libres", modoManosLibres ? "1" : "0");
        actualizarIconoManosLibres();

        if (modoManosLibres) {
          // Manos libres implica escuchar las respuestas; se activa la voz si estaba apagada
          if (!vozActivada) {
            vozActivada = true;
            localStorage.setItem("kacosa-chat-voz", "1");
            actualizarIconoVoz();
          }
          // Arranca la conversación escuchando de inmediato
          if (!escuchando) {
            try { reconocimiento.start(); } catch (err) { /* ya estaba iniciado */ }
          }
        } else if (escuchando) {
          reconocimiento.stop();
        }
      });
    }
  }
}

function actualizarIconoVoz() {
  const btn = document.getElementById("chat-voz-toggle");
  if (!btn) return;
  btn.innerHTML = vozActivada ? '<i class="fa-solid fa-volume-high"></i>' : '<i class="fa-solid fa-volume-xmark"></i>';
  btn.classList.toggle("activo", vozActivada);
  btn.title = vozActivada ? "Dejar de leer respuestas en voz alta" : "Leer respuestas en voz alta";
}

function actualizarIconoManosLibres() {
  const btn = document.getElementById("chat-manos-libres-toggle");
  if (!btn) return;
  btn.classList.toggle("activo", modoManosLibres);
  btn.title = modoManosLibres ? "Desactivar modo manos libres" : "Activar modo manos libres (conversación por voz)";
}

/**
 * Elige, de entre las voces del navegador, la mejor opción en español:
 * prioriza variantes latinoamericanas sobre español de España, y prioriza
 * voces con indicios de ser masculinas en su nombre. La disponibilidad real
 * depende del dispositivo/navegador del usuario — esto elige la mejor opción
 * posible entre lo que el sistema ofrezca, no puede garantizar una voz exacta.
 */
function seleccionarMejorVoz_() {
  if (!window.speechSynthesis) return null;
  const voces = window.speechSynthesis.getVoices();
  if (!voces || voces.length === 0) return null;

  const voxEs = voces.filter(v => v.lang && v.lang.toLowerCase().startsWith("es"));
  if (voxEs.length === 0) return null;

  const indicadoresMasculino = /male|hombre|var[oó]n|jorge|diego|carlos|juan|miguel|pablo|andr[eé]s|enrique|ra[uú]l|fernando|antonio|reed/i;
  const indicadoresFemenino = /female|mujer|m[oó]nica|paulina|sabina|elvira|lucia|luc[íi]a|helena|conchita|paloma/i;

  const prioridadRegion = (lang) => {
    const l = lang.toLowerCase();
    if (l.includes("419")) return 3; // es-419: español latinoamericano genérico
    if (["mx", "us", "co", "ve", "ar", "cl", "pe", "ec", "do", "gt"].some(r => l.includes("-" + r))) return 2;
    if (l.startsWith("es")) return 1;
    return 0;
  };

  const puntuar = (v) => {
    let puntos = prioridadRegion(v.lang) * 10;
    if (indicadoresMasculino.test(v.name)) puntos += 50;
    if (indicadoresFemenino.test(v.name)) puntos -= 25;
    if (v.localService) puntos += 3; // suele sonar más natural y con menos latencia
    return puntos;
  };

  return voxEs.slice().sort((a, b) => puntuar(b) - puntuar(a))[0];
}

/**
 * Lee un texto en voz alta. Si no encuentra una voz masculina explícita entre
 * las disponibles, baja levemente el tono (pitch) para que suene más grave,
 * y usa un ritmo natural de conversación.
 * @param {string} texto
 * @param {Function} [alTerminar] callback que se ejecuta al terminar de hablar (para encadenar el modo manos libres)
 */
function hablar(texto, alTerminar) {
  if (!window.speechSynthesis || !texto) {
    if (alTerminar) alTerminar();
    return;
  }
  window.speechSynthesis.cancel(); // corta cualquier lectura anterior antes de empezar una nueva

  const utterance = new SpeechSynthesisUtterance(texto);
  const voz = seleccionarMejorVoz_();

  utterance.lang = voz ? voz.lang : "es-419";
  utterance.rate = 1.02;
  utterance.pitch = voz && /male|hombre|var[oó]n|jorge|diego|carlos|juan/i.test(voz.name) ? 0.95 : 0.85;
  if (voz) utterance.voice = voz;

  if (alTerminar) {
    utterance.onend = alTerminar;
    utterance.onerror = alTerminar;
  }
  window.speechSynthesis.speak(utterance);
}

function alternarPanel(mostrar) {
  abierto = mostrar;
  const panel = document.getElementById("chat-panel");
  panel.classList.toggle("oculto", !mostrar);
  actualizarContextoInfo();

  if (!mostrar) {
    window.speechSynthesis?.cancel();
    if (escuchando && reconocimiento) reconocimiento.stop();
  }
}

function actualizarContextoInfo() {
  const info = document.getElementById("chat-contexto-info");
  const usuario = window.KACOSA?.usuario;
  const nombreCompleto = usuario?.nombre || usuario?.displayName || usuario?.email || "";
  const primerNombre = nombreCompleto ? nombreCompleto.trim().split(" ")[0] : "";

  info.textContent = primerNombre ? `Hola, ${primerNombre}` : "Hola";
}

function agregarMensaje(texto, rol, archivo) {
  const cont = document.getElementById("chat-mensajes");
  const div = document.createElement("div");
  div.className = "chat-msg " + (rol === "agente" ? "chat-msg-agente" : "chat-msg-usuario");

  const textoEl = document.createElement("div");
  textoEl.className = "chat-msg-texto";
  textoEl.textContent = texto;
  div.appendChild(textoEl);

  if (rol === "agente" && (window.speechSynthesis || archivo)) {
    const acciones = document.createElement("div");
    acciones.className = "chat-msg-acciones";

    if (window.speechSynthesis) {
      const btnEscuchar = document.createElement("button");
      btnEscuchar.className = "chat-msg-escuchar";
      btnEscuchar.type = "button";
      btnEscuchar.title = "Escuchar esta respuesta";
      btnEscuchar.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
      btnEscuchar.addEventListener("click", () => hablar(texto));
      acciones.appendChild(btnEscuchar);
    }

    if (archivo) {
      const btnDescargar = document.createElement("button");
      btnDescargar.className = "chat-msg-descargar";
      btnDescargar.type = "button";
      const iconoFormato = archivo.mimeType.includes("pdf") ? "fa-file-pdf"
        : archivo.mimeType.includes("word") ? "fa-file-word"
        : "fa-file-excel";
      btnDescargar.innerHTML = `<i class="fa-solid ${iconoFormato}"></i> Descargar ${archivo.nombre}`;
      btnDescargar.addEventListener("click", () => descargarArchivoDelChat_(archivo));
      acciones.appendChild(btnDescargar);
    }

    div.appendChild(acciones);
  }

  cont.appendChild(div);
  cont.scrollTop = cont.scrollHeight;
}

/** Convierte el archivo base64 que devolvió el backend en una descarga real del navegador. */
function descargarArchivoDelChat_(archivo) {
  try {
    const bytes = atob(archivo.base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: archivo.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = archivo.nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    console.error("No se pudo descargar el archivo:", err);
  }
}

async function enviarPregunta(e) {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const pregunta = input.value.trim();
  if (!pregunta) return;

  agregarMensaje(pregunta, "usuario");
  historial.push({ rol: "usuario", texto: pregunta });
  input.value = "";

  const cont = document.getElementById("chat-mensajes");
  const cargando = document.createElement("div");
  cargando.className = "chat-msg chat-msg-agente chat-cargando";
  cargando.textContent = "Escribiendo...";
  cont.appendChild(cargando);
  cont.scrollTop = cont.scrollHeight;

  const analisis = window.KACOSA?.ultimoAnalisis;
  const alertasKacosa = window.KACOSA?.ultimasAlertasKacosa || [];
  const dashboardAnalisis = window.KACOSA?.ultimoDashboardAnalisis;
  const misTiendas = window.KACOSA?.tiendas || [];
  const tiendasUsuario = misTiendas.includes("TODAS")
    ? "TODAS (acceso administrativo a las 12 tiendas)"
    : misTiendas.map(id => nombrePorId(id)).join(", ");

  const contexto = { tiendasUsuario };

  // Contexto de "Nuevo Análisis" (si hay uno recién generado en esta sesión)
  if (analisis) {
    contexto.tienda = nombrePorId(analisis.tienda);
    contexto.fechaAnalisis = analisis.fechaAnalisis;
    contexto.periodo = analisis.periodo;
    contexto.margenPct = analisis.margenPct;
    contexto.resumen = {
      totalAPedir: analisis.materiales.reduce((acc, m) => acc + m.aPedir, 0),
      quiebresKacosa: analisis.materiales.filter(m => m.stockKacosa <= 0 && m.aPedir === 0).length
    };
    contexto.materiales = analisis.materiales;
  }

  // Contexto de "Alertas Kacosa" (si se ha corrido un análisis de stock Kacosa)
  if (alertasKacosa.length > 0) {
    contexto.alertasKacosa = alertasKacosa.slice(0, 250).map(a => ({
      codigo: a.codigo,
      descripcion: a.descripcion,
      clase: a.clase,
      stockKacosa: a.stockKacosa,
      totalAPedir: a.totalAPedir,
      proyeccionCompra: a.proyeccionCompra,
      tipo: a.tipo,
      periodoDeAbastecimiento: a.periodoDeAbastecimiento
    }));
    contexto.totalAlertasKacosa = alertasKacosa.length;
  }

  // Contexto del "Dashboard" (último análisis guardado en Sheets para la tienda vista)
  if (dashboardAnalisis) {
    contexto.dashboard = {
      tienda: nombrePorId(dashboardAnalisis.tienda),
      fechaAnalisis: dashboardAnalisis.fechaAnalisis,
      materiales: dashboardAnalisis.materiales
    };
  }

  const resp = await callBridge("chatConsulta", {
    pregunta,
    historial: historial.slice(-10), // últimos turnos para no crecer indefinidamente
    contexto
  });

  cargando.remove();

  const respuesta = resp.ok ? resp.respuesta : "No pude responder: " + resp.error;
  agregarMensaje(respuesta, "agente", resp.archivo || null);
  historial.push({ rol: "agente", texto: respuesta });

  const continuarEscuchando = () => {
    if (modoManosLibres && abierto && reconocimiento && !escuchando) {
      try { reconocimiento.start(); } catch (err) { /* ya estaba iniciado */ }
    }
  };

  if (vozActivada) {
    hablar(respuesta, continuarEscuchando);
  } else if (modoManosLibres) {
    setTimeout(continuarEscuchando, 400);
  }
}

document.addEventListener("kacosa:analisis-listo", actualizarContextoInfo);
document.addEventListener("kacosa:usuario-listo", actualizarContextoInfo);
document.addEventListener("DOMContentLoaded", construirUI);
// Por si el script carga después de DOMContentLoaded
if (document.readyState !== "loading") construirUI();
