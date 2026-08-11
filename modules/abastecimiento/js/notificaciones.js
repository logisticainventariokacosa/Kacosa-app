// js/notificaciones.js
// Aviso de éxito reutilizable: aparece centrado, se cierra solo a los pocos
// segundos, o de inmediato si el usuario toca el botón "Aceptar" o cualquier
// parte fuera de la tarjeta.

let temporizadorActivo = null;

/**
 * @param {string} mensaje - texto principal
 * @param {Object} opciones
 *   - titulo: string (default "¡Listo!")
 *   - icono: string HTML del icono (default check de Font Awesome)
 *   - segundos: tiempo antes de auto-cerrar (default 4)
 */
export function notificarExito(mensaje, opciones = {}) {
  cerrarNotificacion(); // por si había una abierta

  const titulo = opciones.titulo || "¡Listo!";
  const icono = opciones.icono || '<i class="fa-solid fa-circle-check"></i>';
  const segundos = opciones.segundos ?? 4;

  const overlay = document.createElement("div");
  overlay.id = "kacosa-notificacion";
  overlay.innerHTML = `
    <div class="kn-tarjeta">
      <div class="kn-icono">${icono}</div>
      <div class="kn-titulo">${titulo}</div>
      <div class="kn-mensaje">${mensaje}</div>
      <div class="kn-barra-tiempo"><div class="kn-barra-relleno" style="animation-duration:${segundos}s"></div></div>
      <button class="kn-boton">Aceptar</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Forzar reflow para que la animación de entrada se vea
  requestAnimationFrame(() => overlay.classList.add("visible"));

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.classList.contains("kn-boton")) {
      cerrarNotificacion();
    }
  });

  temporizadorActivo = setTimeout(cerrarNotificacion, segundos * 1000);
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
