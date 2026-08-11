// js/stock-parser.js
import { aNumero } from "./mht-parser.js";

/**
 * Agrupa las filas de un archivo de stock (tienda o Kacosa) por material,
 * sumando todos los almacenes de los centros indicados.
 * Disponible = Libre utilización + Trans./Trasl. + Devoluciones
 * (En control calidad y Bloqueado NO cuentan, según la definición del negocio).
 *
 * @param {Array<Object>} filas - salida de parsearMHT()
 * @param {Array<string>} centrosFiltro - centros SAP a incluir (ej. ["1300"] o ["1000","3000"])
 * @returns {Object} codigo -> { codigo, descripcion, unidadBase, stockDisponible }
 */
export function agruparStock(filas, centrosFiltro) {
  const mapa = {};

  filas.forEach(f => {
    const centro = String(f["Centro"] || "").trim();
    if (!centrosFiltro.includes(centro)) return;

    const codigo = String(f["Material"] || "").trim();
    if (!codigo) return;

    const libreUtilizacion = aNumero(f["Libre utilización"]);
    const transTrasl = aNumero(f["Trans./Trasl."]);
    const devoluciones = aNumero(f["Devoluciones"]);
    const disponible = libreUtilizacion + transTrasl + devoluciones;

    if (!mapa[codigo]) {
      mapa[codigo] = {
        codigo,
        descripcion: f["Texto breve de material"] || "",
        unidadBase: f["Unidad medida base"] || "UN",
        stockDisponible: 0
      };
    }
    mapa[codigo].stockDisponible += disponible;
  });

  return mapa;
}

/**
 * Procesa un archivo de notas pendientes por despacho y devuelve un mapa
 * codigo -> { cantidad, numeroNota, fechaNota } para los materiales
 * cuyo Centro receptor coincida con los centros de la tienda.
 *
 * @param {Array<Object>} filas - salida de parsearMHT()
 * @param {Array<string>} centrosFiltro - centros de la tienda
 * @returns {Object} codigo -> { cantidad, numeroNota, fechaNota }
 */
export function procesarNotasPendientes(filas, centrosFiltro) {
  const mapa = {};

  filas.forEach(f => {
    const centroReceptor = String(f["Centro Receptor"] || "").trim();
    if (!centrosFiltro.includes(centroReceptor)) return;

    const codigo = String(f["Material"] || "").trim();
    if (!codigo) return;

    const cantidad = aNumero(f["Cant Entrega"] || 0);
    if (cantidad <= 0) return;

    const numeroNota = String(f["Entrega"] || "").trim();
    let fechaNota = String(f["Fec. Entrega"] || "").trim();

    // Formatear la fecha si es un objeto Date o un string en formato ISO
    fechaNota = formatearFechaParaNota(fechaNota);

    if (!mapa[codigo]) {
      mapa[codigo] = { cantidad: 0, numeroNota: numeroNota, fechaNota: fechaNota };
    }

    mapa[codigo].cantidad += cantidad;
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
