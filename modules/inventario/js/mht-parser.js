// js/mht-parser.js
// Versión "script clásico" (sin import/export) del parser MHT que ya usa
// Abastecimiento (modules/abastecimiento/js/mht-parser.js) — se duplica
// aquí en vez de importarlo porque este módulo carga scripts clásicos,
// no ES modules. Misma lógica exacta, solo expuesta en window.
//
// SAP GUI exporta los archivos como MHTML (multipart/related) con una
// única tabla HTML adentro. Parsear eso con DOMParser nativo del
// navegador es mucho más rápido que descomprimir y parsear un .xlsx.

(function () {
  /**
   * Parsea un archivo .MHT y devuelve un array de objetos, uno por fila
   * de datos, usando la primera fila de la tabla como encabezados.
   * @param {string} textoArchivo - contenido completo del archivo .MHT (texto plano)
   * @returns {Array<Object>}
   */
  function parsearMHT(textoArchivo) {
    const inicioHtml = textoArchivo.indexOf("<html");
    if (inicioHtml === -1) {
      throw new Error("El archivo no contiene una tabla HTML reconocible (¿es un .MHT válido?)");
    }
    const finHtml = textoArchivo.indexOf("</html>", inicioHtml);
    const html = finHtml !== -1
      ? textoArchivo.slice(inicioHtml, finHtml + 7)
      : textoArchivo.slice(inicioHtml);

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const tabla = doc.querySelector("table");
    if (!tabla) {
      throw new Error("No se encontró ninguna tabla dentro del archivo.");
    }

    const filasHtml = Array.from(tabla.querySelectorAll("tr"));
    if (filasHtml.length < 2) return [];

    const valorCelda = (td) => {
      const texto = td.textContent.trim();
      if (texto !== "") return texto;
      if (td.hasAttribute("x:str")) return td.getAttribute("x:str");
      if (td.hasAttribute("x:num")) return td.getAttribute("x:num");
      return "";
    };

    const encabezados = Array.from(filasHtml[0].querySelectorAll("td, th"))
      .map(td => td.textContent.trim());

    const filas = [];
    for (let i = 1; i < filasHtml.length; i++) {
      const celdas = Array.from(filasHtml[i].querySelectorAll("td, th"));
      if (celdas.length === 0) continue;

      const fila = {};
      encabezados.forEach((nombreCol, idx) => {
        fila[nombreCol] = celdas[idx] ? valorCelda(celdas[idx]) : "";
      });
      filas.push(fila);
    }

    return filas;
  }

  window.parsearMHT = parsearMHT;
})();
