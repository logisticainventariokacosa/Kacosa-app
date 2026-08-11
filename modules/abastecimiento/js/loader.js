// js/loader.js
// Loader de pantalla completa reutilizable, usado durante el login (incluida
// la transición de Google, que toma unos segundos) y al cargar app.html
// mientras se valida la sesión y se obtienen las tiendas del usuario.

function construirLoaderSiNoExiste() {
  if (document.getElementById("kacosa-loader")) return;

  const div = document.createElement("div");
  div.id = "kacosa-loader";
  div.className = "oculto";
  div.innerHTML = `
    <div class="loader-caja">
      <div class="loader-marca">
        <div class="loader-barra"></div>
        <div class="loader-titulo">KACOSA</div>
      </div>
      <div class="loader-spinner"></div>
      <div class="loader-mensaje" id="kacosa-loader-mensaje">Cargando...</div>
    </div>
  `;
  document.body.appendChild(div);
}

/** Muestra el loader de pantalla completa con un mensaje opcional. */
export function mostrarLoader(mensaje) {
  construirLoaderSiNoExiste();
  const loader = document.getElementById("kacosa-loader");
  const msg = document.getElementById("kacosa-loader-mensaje");
  if (msg && mensaje) msg.textContent = mensaje;
  loader.classList.remove("oculto");
}

/** Oculta el loader con una transición suave. */
export function ocultarLoader() {
  const loader = document.getElementById("kacosa-loader");
  if (loader) loader.classList.add("oculto");
}

// Se muestra automáticamente apenas carga el script, para cubrir cualquier
// parpadeo inicial mientras el resto de la página/autenticación resuelve.
construirLoaderSiNoExiste();
