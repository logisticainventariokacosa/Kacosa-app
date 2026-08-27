// js/notificaciones.js
// Aviso de éxito reutilizable: aparece centrado, se cierra solo a los pocos
// segundos, o de inmediato si el usuario toca el botón "Aceptar" o cualquier
// parte fuera de la tarjeta.
//
// Para avisos largos que el usuario necesita leer con calma (ej. listas de
// materiales a revisar), se puede pasar autoCerrar:false: el modal ya no se
// cierra solo, el mensaje se vuelve scrolleable en vez de cortarse, y sigue
// siendo responsivo en cualquier pantalla. En ese caso el usuario lo cierra
// a mano, con "Aceptar" o tocando fuera de la tarjeta.

let temporizadorActivo = null;

/**
 * @param {string} mensaje - texto principal (admite HTML)
 * @param {Object} opciones
 *   - titulo: string (default "¡Listo!")
 *   - icono: string HTML del icono (default check de Font Awesome)
 *   - segundos: tiempo antes de auto-cerrar (default 4; se ignora si autoCerrar es false)
 *   - autoCerrar: boolean (default true) — si es false, el aviso no se cierra
 *     solo (no se muestra la barra de tiempo) y el mensaje se vuelve
 *     scrolleable si es muy largo, en vez de auto-cerrarse a los pocos segundos
 *   - descargar: { texto?: string, onClick: function } — si se pasa, agrega un
 *     botón adicional (ej. "Descargar Excel"); al hacer clic ejecuta onClick()
 *     y el modal NO se cierra, para que el usuario pueda seguir revisando la lista
 */
export function notificarExito(mensaje, opciones = {}) {
  cerrarNotificacion(); // por si había una abierta

  const titulo = opciones.titulo || "¡Listo!";
  const icono = opciones.icono || '<i class="fa-solid fa-circle-check"></i>';
  const autoCerrar = opciones.autoCerrar !== false;
  const segundos = opciones.segundos ?? 4;
  const descargar = opciones.descargar || null;

  const overlay = document.createElement("div");
  overlay.id = "kacosa-notificacion";
  overlay.innerHTML = `
    <div class="kn-tarjeta${!autoCerrar ? " kn-tarjeta-larga" : ""}">
      <div class="kn-icono">${icono}</div>
      <div class="kn-titulo">${titulo}</div>
      <div class="kn-mensaje">${mensaje}</div>
      ${autoCerrar ? `<div class="kn-barra-tiempo"><div class="kn-barra-relleno" style="animation-duration:${segundos}s"></div></div>` : ""}
      ${descargar ? `<button type="button" class="kn-boton kn-boton-secundario" id="kn-boton-descargar"><i class="fa-solid fa-file-excel"></i> ${descargar.texto || "Descargar Excel"}</button>` : ""}
      <button type="button" class="kn-boton">Aceptar</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Forzar reflow para que la animación de entrada se vea
  requestAnimationFrame(() => overlay.classList.add("visible"));

  // El botón de descarga tiene su propio manejador (con stopPropagation) para
  // que un clic ahí NUNCA cierre el modal, sin importar el resto de esta lógica.
  const btnDescargar = overlay.querySelector("#kn-boton-descargar");
  if (btnDescargar && descargar) {
    btnDescargar.addEventListener("click", (e) => {
      e.stopPropagation();
      descargar.onClick();
    });
  }

  overlay.addEventListener("click", (e) => {
    if (e.target.closest("#kn-boton-descargar")) return; // ya se maneja aparte
    const esFueraDeLaTarjeta = e.target === overlay;
    const esAceptar = e.target.closest(".kn-boton") && !e.target.closest("#kn-boton-descargar");
    if (esFueraDeLaTarjeta || esAceptar) {
      cerrarNotificacion();
    }
  });

  if (autoCerrar) {
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

/**
 * Modal de confirmación (Sí/Cancelar) reutilizable, con el mismo look que
 * notificarExito(). Devuelve una Promise<boolean>: true si el usuario confirma,
 * false si cancela o cierra el modal (con "Cancelar" o tocando afuera).
 *
 * @param {string} mensaje - texto principal (admite HTML)
 * @param {Object} opciones
 *   - titulo: string (default "Confirmar")
 *   - icono: string HTML del icono (default un signo de interrogación)
 *   - textoConfirmar: string (default "Sí, continuar")
 *   - textoCancelar: string (default "Cancelar")
 */
export function confirmarAccion(mensaje, opciones = {}) {
  return new Promise((resolve) => {
    const titulo = opciones.titulo || "Confirmar";
    const icono = opciones.icono || '<i class="fa-solid fa-circle-question"></i>';
    const textoConfirmar = opciones.textoConfirmar || "Sí, continuar";
    const textoCancelar = opciones.textoCancelar || "Cancelar";

    const overlay = document.createElement("div");
    overlay.id = "kacosa-confirmacion";
    overlay.innerHTML = `
      <div class="kn-tarjeta">
        <div class="kn-icono" style="color:var(--ambar-oscuro)">${icono}</div>
        <div class="kn-titulo">${titulo}</div>
        <div class="kn-mensaje">${mensaje}</div>
        <button type="button" class="kn-boton kn-boton-advertencia" id="kc-btn-confirmar">${textoConfirmar}</button>
        <button type="button" class="kn-boton kn-boton-cancelar" id="kc-btn-cancelar">${textoCancelar}</button>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("visible"));

    const cerrar = (resultado) => {
      overlay.classList.remove("visible");
      setTimeout(() => overlay.remove(), 200);
      resolve(resultado);
    };

    overlay.querySelector("#kc-btn-confirmar").addEventListener("click", (e) => {
      e.stopPropagation();
      cerrar(true);
    });
    overlay.querySelector("#kc-btn-cancelar").addEventListener("click", (e) => {
      e.stopPropagation();
      cerrar(false);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrar(false); // clic afuera = igual que cancelar
    });
  });
}
