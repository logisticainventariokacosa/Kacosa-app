// js/stock-parser.js
import { aNumero } from "./mht-parser.js";

/**
 * Agrupa las filas de un archivo de stock (tienda o Kacosa) por material,
 * sumando todos los almacenes de los centros indicados.
 *
 * Criterio de "disponible":
 *  - Stock TIENDA (comportamiento por defecto): Libre utilización + Trans./Trasl.
 *    + Devoluciones (En control calidad y Bloqueado NO cuentan, según la
 *    definición del negocio).
 *  - Stock KACOSA (pasando opciones.soloLibreUtilizacion = true): SOLO Libre
 *    utilización. Cambio pedido porque Trans./Trasl. y Devoluciones en el
 *    almacén central no son stock realmente disponible para despachar a las
 *    tiendas (ver conversación 28-ago-2026).
 *
 * @param {Array<Object>} filas - salida de parsearMHT()
 * @param {Array<string>} centrosFiltro - centros SAP a incluir (ej. ["1300"] o ["1000","3000"])
 * @param {Object} [opciones]
 * @param {boolean} [opciones.soloLibreUtilizacion] - si true, "disponible" = solo Libre utilización (usado para stock Kacosa)
 * @returns {Object} codigo -> { codigo, descripcion, unidadBase, stockDisponible, stockPorCentro }
 */
export function agruparStock(filas, centrosFiltro, opciones = {}) {
  const mapa = {};
  const soloLibreUtilizacion = !!opciones.soloLibreUtilizacion;

  filas.forEach(f => {
    const centro = String(f["Centro"] || "").trim();
    if (!centrosFiltro.includes(centro)) return;

    const codigo = String(f["Material"] || "").trim();
    if (!codigo) return;

    const libreUtilizacion = aNumero(f["Libre utilización"]);
    let disponible;
    if (soloLibreUtilizacion) {
      disponible = libreUtilizacion;
    } else {
      const transTrasl = aNumero(f["Trans./Trasl."]);
      const devoluciones = aNumero(f["Devoluciones"]);
      disponible = libreUtilizacion + transTrasl + devoluciones;
    }

    if (!mapa[codigo]) {
      mapa[codigo] = {
        codigo,
        descripcion: f["Texto breve de material"] || "",
        unidadBase: f["Unidad medida base"] || "UN",
        stockDisponible: 0,
        // NUEVO: desglose de stock por centro SAP, ej. { "1000": 5, "3000": 2 }.
        // Permite mostrar Stock Kacosa 1000 / Stock Kacosa 3000 por separado,
        // sin afectar el cálculo (que sigue usando la suma en stockDisponible).
        stockPorCentro: {}
      };
    }
    mapa[codigo].stockDisponible += disponible;
    mapa[codigo].stockPorCentro[centro] = (mapa[codigo].stockPorCentro[centro] || 0) + disponible;
  });

  return mapa;
}

/**
 * Procesa un archivo de notas pendientes por despacho. El archivo puede traer
 * varias filas del mismo material para distintos "Centro Receptor" (varias
 * tiendas a la vez). Cada nota se clasifica según a quién va dirigida:
 *
 *  - Notas hacia el centro de la tienda que se está analizando (centrosPropios):
 *    esa mercancía YA VIENE en camino hacia ESTA tienda, así que se resta de
 *    su "a pedir" (no tendría sentido volver a pedirla).
 *  - Notas hacia CUALQUIER OTRO centro: esa mercancía salió (o está por salir)
 *    del almacén Kacosa hacia otra tienda, así que ya no es stock disponible
 *    en Kacosa — se resta del stock Kacosa (ver restarNotasPendientesDeKacosa),
 *    afectando por igual el cálculo de todas las tiendas.
 *
 * En ambos casos se van concatenando TODOS los números/fechas de nota del
 * material (propios y de otros centros) para mostrarlos juntos en la columna
 * correspondiente — el usuario quiere ver cada nota que exista para ese
 * material, sin importar a qué centro vaya.
 *
 * @param {Array<Object>} filas - salida de parsearMHT()
 * @param {Array<string>} centrosPropios - centros de la tienda que se está analizando
 * @returns {Object} codigo -> { cantidadPropia, cantidadOtros, numeroNota, fechaNota }
 */
export function procesarNotasPendientes(filas, centrosPropios) {
  const mapa = {};

  filas.forEach(f => {
    const codigo = String(f["Material"] || "").trim();
    if (!codigo) return;

    const cantidad = aNumero(f["Cant Entrega"] || 0);
    if (cantidad <= 0) return;

    const centroReceptor = String(f["Centro Receptor"] || "").trim();
    const esPropio = centrosPropios.includes(centroReceptor);

    const numeroNota = String(f["Entrega"] || "").trim();
    let fechaNota = String(f["Fec. Entrega"] || "").trim();

    // Formatear la fecha si es un objeto Date o un string en formato ISO
    fechaNota = formatearFechaParaNota(fechaNota);

    if (!mapa[codigo]) {
      mapa[codigo] = { cantidadPropia: 0, cantidadOtros: 0, numeroNota: "", fechaNota: "" };
    }

    if (esPropio) {
      mapa[codigo].cantidadPropia += cantidad;
    } else {
      mapa[codigo].cantidadOtros += cantidad;
    }

    // Se van concatenando todos los números/fechas de nota distintos del
    // material (propios y de otros centros), para que la columna muestre
    // cada nota que compone el total, no solo la última.
    if (numeroNota && !mapa[codigo].numeroNota.includes(numeroNota)) {
      mapa[codigo].numeroNota = mapa[codigo].numeroNota 
        ? mapa[codigo].numeroNota + ", " + numeroNota 
        : numeroNota;
    }
    if (fechaNota && !mapa[codigo].fechaNota.includes(fechaNota)) {
      mapa[codigo].fechaNota = mapa[codigo].fechaNota 
        ? mapa[codigo].fechaNota + ", " + fechaNota 
        : fechaNota;
    }
  });

  return mapa;
}

/**
 * Resta del stock Kacosa disponible las cantidades pendientes por despacho
 * hacia OTROS centros (nota.cantidadOtros — NO la parte propia de la tienda
 * que se está analizando, esa se resta de su "a pedir" en otro punto del
 * flujo). Modifica stockKacosa "en sitio". Se hace ANTES de
 * calcularAbastecimiento, para que el "a pedir"/"pendiente" de cada tienda ya
 * se calcule contra el stock Kacosa REAL (descontando lo que ya está
 * comprometido hacia otras tiendas).
 *
 * Si el material no existía en el stock Kacosa (ej. ya se agotó y por eso se
 * está despachando lo último que quedaba), se crea con stock negativo — es
 * intencional: refleja que ya se comprometió más de lo que queda disponible.
 *
 * @param {Object} stockKacosa - objeto codigo -> {stockDisponible, unidadBase, stockPorCentro} (se modifica en sitio)
 * @param {Object} notasPendientesMap - salida de procesarNotasPendientes()
 * @returns {number} cantidad de materiales afectados
 */
export function restarNotasPendientesDeKacosa(stockKacosa, notasPendientesMap) {
  let afectados = 0;
  Object.entries(notasPendientesMap).forEach(([codigo, nota]) => {
    const cantidad = nota.cantidadOtros || 0;
    if (cantidad <= 0) return;
    afectados++;
    if (stockKacosa[codigo]) {
      stockKacosa[codigo].stockDisponible -= cantidad;
    } else {
      stockKacosa[codigo] = {
        codigo,
        descripcion: "",
        unidadBase: "UN",
        stockDisponible: -cantidad,
        stockPorCentro: {}
      };
    }
  });
  return afectados;
}

/**
 * Formatea una fecha para ser mostrada en formato DD/MM/AAAA.
 * Maneja objetos Date, strings ISO y strings ya formateados.
 */
function formatearFechaParaNota(fecha) {
  if (!fecha) return "";

  // Si es un objeto Date (aunque improbable, por si acaso)
  if (fecha instanceof Date && !isNaN(fecha)) {
    const d = fecha;
    return String(d.getDate()).padStart(2, '0') + '/' + 
           String(d.getMonth() + 1).padStart(2, '0') + '/' + 
           d.getFullYear();
  }

  // Si es un string que contiene una fecha ISO (YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss)
  const fechaStr = String(fecha);
  const matchISO = fechaStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (matchISO) {
    return matchISO[3] + '/' + matchISO[2] + '/' + matchISO[1];
  }

  // Si es un string que ya tiene formato DD/MM/AAAA o similar, lo dejamos igual
  // (pero intentamos normalizar si tiene barras invertidas)
  if (fechaStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    return fechaStr;
  }

  // Si es un número (timestamp de Excel o Unix), intentar convertirlo
  const num = Number(fecha);
  if (!isNaN(num) && num > 0) {
    // Si es un número de Excel (días desde 1900)
    if (num < 100000) {
      // Convertir número de Excel a fecha
      const excelEpoch = new Date(1899, 11, 30);
      const d = new Date(excelEpoch.getTime() + num * 86400000);
      if (!isNaN(d)) {
        return String(d.getDate()).padStart(2, '0') + '/' + 
               String(d.getMonth() + 1).padStart(2, '0') + '/' + 
               d.getFullYear();
      }
    } else {
      // Si es timestamp Unix (milisegundos)
      const d = new Date(num);
      if (!isNaN(d)) {
        return String(d.getDate()).padStart(2, '0') + '/' + 
               String(d.getMonth() + 1).padStart(2, '0') + '/' + 
               d.getFullYear();
      }
    }
  }

  // Si el string contiene una fecha con meses en inglés (ej. "Tue Jul 21 2026")
  const matchEng = fechaStr.match(/([A-Za-z]{3}) ([A-Za-z]{3}) (\d{1,2}) (\d{4})/);
  if (matchEng) {
    const meses = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
                    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
    const mes = meses[matchEng[2]] || matchEng[2];
    const dia = String(parseInt(matchEng[3])).padStart(2, '0');
    return dia + '/' + mes + '/' + matchEng[4];
  }

  // Si ya es un string con formato DD/MM/AAAA con barra invertida
  if (fechaStr.match(/^\d{2}\\\/\d{2}\\\/\d{4}$/)) {
    return fechaStr.replace(/\\\//g, '/');
  }

  // Si el string contiene una fecha con separadores diferentes
  const matchBarra = fechaStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (matchBarra) {
    return matchBarra[1] + '/' + matchBarra[2] + '/' + matchBarra[3];
  }

  // Último intento: si el string parece una fecha, intentar parsearla
  try {
    const d = new Date(fechaStr);
    if (!isNaN(d)) {
      return String(d.getDate()).padStart(2, '0') + '/' + 
             String(d.getMonth() + 1).padStart(2, '0') + '/' + 
             d.getFullYear();
    }
  } catch (_) {}

  // Si nada funciona, devolver el string original
  return fechaStr;
}
