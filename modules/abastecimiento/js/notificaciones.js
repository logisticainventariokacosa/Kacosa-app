// js/notificaciones.js
// Aviso de éxito reutilizable: aparece centrado. Por defecto se cierra solo a
// los pocos segundos, o de inmediato si el usuario toca "Aceptar", la X, o
// cualquier parte fuera de la tarjeta. Cuando el mensaje trae información
// importante que el usuario debe poder leer con calma (ej. advertencias de
// factores de conversión), se puede pasar sinAutoCierre:true para que NO se
// cierre solo — el usuario decide cuándo cerrarla.

let temporizadorActivo = null;

/**
 * @param {string} mensaje - texto principal (admite HTML)
 * @param {Object} opciones
 *   - titulo: string (default "¡Listo!")
 *   - icono: string HTML del icono (default check de Font Awesome)
 *   - segundos: tiempo antes de auto-cerrar (default 4, ignorado si sinAutoCierre)
 *   - sinAutoCierre: boolean (default false) - si es true, no se cierra sola;
 *     el usuario debe cerrarla con la X, "Aceptar", o clic fuera de la tarjeta.
 */
export function notificarExito(mensaje, opciones = {}) {
  cerrarNotificacion(); // por si había una abierta

  const titulo = opciones.titulo || "¡Listo!";
  const icono = opciones.icono || '<i class="fa-solid fa-circle-check"></i>';
  const segundos = opciones.segundos ?? 4;
  const sinAutoCierre = !!opciones.sinAutoCierre;

  const overlay = document.createElement("div");
  overlay.id = "kacosa-notificacion";
  overlay.innerHTML = `
    <div class="kn-tarjeta">
      <button class="kn-cerrar" type="button" aria-label="Cerrar" title="Cerrar"><i class="fa-solid fa-xmark"></i></button>
      <div class="kn-icono">${icono}</div>
      <div class="kn-titulo">${titulo}</div>
      <div class="kn-mensaje">${mensaje}</div>
      ${sinAutoCierre ? "" : `<div class="kn-barra-tiempo"><div class="kn-barra-relleno" style="animation-duration:${segundos}s"></div></div>`}
      <button class="kn-boton">Aceptar</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Forzar reflow para que la animación de entrada se vea
  requestAnimationFrame(() => overlay.classList.add("visible"));

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".kn-boton") || e.target.closest(".kn-cerrar")) {
      cerrarNotificacion();
    }
  });

  if (!sinAutoCierre) {
    temporizadorActivo = setTimeout(cerrarNotificacion, segundos * 1000);
  }
}

export function cerrarNotificacion() {
  const existente = document.getElementById("kacosa-notificacion");
  if (existente) {
    existente.classList.remove("visible");
    setTimeout(() => existente.remove(), 200);
  }
  if (temporizadorActivo) {
    clearTimeout(temporizadorActivo);
    temporizadorActivo = null;
  }
}
