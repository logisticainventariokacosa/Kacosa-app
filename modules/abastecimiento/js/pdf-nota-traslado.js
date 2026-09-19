// js/pdf-nota-traslado.js
// Genera y descarga el PDF "Nota de Traslado" para solicitudes Extra SAP ya
// aprobadas. Se llama SOLO después de reclamar exitosamente la clave de un
// solo uso (ver abrirModalDescarga en traslados.js) — este archivo no vuelve
// a validar nada, confía en que quien lo llamó ya hizo el UPDATE atómico.
//
// Requiere, cargados como <script> globales en app.html:
// - jsPDF (https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js) → window.jspdf.jsPDF
// - JsBarcode (https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.5/JsBarcode.all.min.js) → window.JsBarcode
import { supabaseSelect } from "./supabase-client.js?v=1";
import { TIENDAS, nombrePorId } from "./tiendas.js?v=1";

const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

/** Busca nombre/dirección/ciudad del centro en maestro_centros (tabla compartida con kacosa-inventario-main). */
async function obtenerDatosCentro(idTienda) {
  const t = TIENDAS.find(x => x.id === idTienda);
  const centroSap = t ? t.centro : idTienda;
  try {
    const filas = await supabaseSelect(
      "maestro_centros",
      `select=nombre_centro,direccion_corta,municipio,estado&centro=eq.${encodeURIComponent(centroSap)}&limit=1`
    );
    if (filas && filas.length > 0) {
      const f = filas[0];
      return {
        nombre: f.nombre_centro || nombrePorId(idTienda),
        direccion: f.direccion_corta || "",
        ciudad: f.municipio || f.estado || ""
      };
    }
  } catch (err) {
    console.warn("No se pudo leer maestro_centros para " + idTienda + ":", err.message);
  }
  return { nombre: nombrePorId(idTienda), direccion: "", ciudad: "" };
}

function fechaEnLetras(fecha, ciudad) {
  const d = fecha.getDate();
  const mes = MESES[fecha.getMonth()];
  const y = fecha.getFullYear();
  return `${ciudad ? ciudad + ", " : ""}${d} de ${mes} del ${y}`;
}

/** PNG en base64 de un código de barras CODE128 para `texto`, o null si no se pudo generar (no bloquea el PDF). */
function generarBarcodeDataUrl(texto) {
  if (!texto || !window.JsBarcode) return null;
  try {
    const canvas = document.createElement("canvas");
    window.JsBarcode(canvas, texto, { format: "CODE128", displayValue: false, margin: 0, height: 60 });
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.warn("No se pudo generar el código de barras:", err.message);
    return null;
  }
}

export async function descargarNotaDeTraslado(solicitud) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("No se pudo cargar el generador de PDF (jsPDF). Verifica tu conexión e inténtalo de nuevo.");
  }
  const { jsPDF } = window.jspdf;

  const [emisora, destino] = await Promise.all([
    obtenerDatosCentro(solicitud.tienda_solicitante),
    obtenerDatosCentro(solicitud.centro_destino)
  ]);

  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const margenIzq = 18, margenDer = 18, anchoUtil = 216 - margenIzq - margenDer; // letter = 216x279mm
  let y = 20;

  const barcodeNota = generarBarcodeDataUrl(solicitud.numero_nota);
  const barcodeClave = generarBarcodeDataUrl(solicitud.clave_descarga);

  // --- Encabezado: fecha (izq) y número de nota + su código de barras (der) ---
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(fechaEnLetras(new Date(), emisora.ciudad), margenIzq, y);
  doc.text(String(solicitud.numero_nota || ""), 216 - margenDer, y, { align: "right" });
  if (barcodeNota) {
    doc.addImage(barcodeNota, "PNG", 216 - margenDer - 45, y + 3, 45, 10);
  }

  y += barcodeNota ? 26 : 14;
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("Nota de Traslado", 108, y, { align: "center" });

  y += 12;
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "normal");
  const cuerpo =
    `Por medio del presente se realiza la salida de la tienda ${emisora.nombre}` +
    `${emisora.direccion ? " ubicada en " + emisora.direccion : ""} hacia el centro de destino ` +
    `${destino.nombre}${destino.direccion ? " ubicado en " + destino.direccion : ""} por los siguientes materiales:`;
  const lineasCuerpo = doc.splitTextToSize(cuerpo, anchoUtil);
  doc.text(lineasCuerpo, margenIzq, y);
  y += lineasCuerpo.length * 5 + 8;

  // --- Tabla de materiales (dibujada a mano, columnas fijas) ---
  const colX = { codigo: margenIzq, desc: margenIzq + 22, umb: margenIzq + 130, cant: margenIzq + 155 };
  const anchoDesc = colX.umb - colX.desc - 3;

  function encabezadoTabla() {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text("Código", colX.codigo, y);
    doc.text("Descripción", colX.desc, y);
    doc.text("UMB", colX.umb, y);
    doc.text("Cantidad", colX.cant, y);
    y += 2;
    doc.setLineWidth(0.3);
    doc.line(margenIzq, y, 216 - margenDer, y);
    y += 5;
    doc.setFont("helvetica", "normal");
  }
  encabezadoTabla();

  (solicitud.materiales || []).forEach(m => {
    const lineasDesc = doc.splitTextToSize(String(m.descripcion || ""), anchoDesc);
    const alturaFila = Math.max(lineasDesc.length, 1) * 4.6;

    if (y + alturaFila > 245) { // deja espacio para pie de página
      doc.addPage();
      y = 20;
      encabezadoTabla();
    }

    doc.text(String(m.codigo || (m.sinCodigoSap ? "S/C" : "")), colX.codigo, y);
    doc.text(lineasDesc, colX.desc, y);
    doc.text(String(m.unidad || ""), colX.umb, y);
    doc.text(String(m.cantidad ?? ""), colX.cant, y);
    y += alturaFila;
  });

  // --- Firmas (al final del documento, después de la tabla) ---
  if (y > 130) { doc.addPage(); y = 20; }
  y += 14;
  const firmas = ["Gerente emisor", "Personal de seguridad de tienda emisora", "Chófer", "Gerente receptor"];
  const anchoFirma = anchoUtil / 2 - 6;
  firmas.forEach((etiqueta, idx) => {
    const col = idx % 2;
    const fila = Math.floor(idx / 2);
    const x = margenIzq + col * (anchoFirma + 12);
    const yy = y + fila * 26;
    doc.setLineWidth(0.2);
    doc.line(x, yy + 14, x + anchoFirma, yy + 14);
    doc.setFontSize(9);
    doc.text(etiqueta, x, yy + 19);
  });

  // --- Sello de la tienda (abajo-izquierda) y código de seguridad + su
  // código de barras (abajo-derecha, 18/19-sep-2026): el código queda
  // impreso en el documento ya canjeado (no sirve para volver a descargarlo,
  // eso ya se invalidó al usarse) — su función aquí es servir de sello de
  // autenticidad: cualquiera que reciba el papel puede escanearlo o
  // verificarlo en el sistema (solicitud/código) para confirmar que
  // corresponde a esta nota específica, y una fotocopia no puede hacerse
  // pasar por otra nota distinta.
  y += 58;
  if (y > 210) { doc.addPage(); y = 30; }

  const selloAncho = 70, selloAlto = 35;
  doc.setLineWidth(0.3);
  doc.rect(margenIzq, y, selloAncho, selloAlto);
  doc.setFontSize(8.5);
  doc.setTextColor(120);
  doc.text("Sello de la tienda", margenIzq + selloAncho / 2, y + selloAlto + 6, { align: "center" });

  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Código de seguridad del documento:", 216 - margenDer, y + 8, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text(String(solicitud.clave_descarga || ""), 216 - margenDer, y + 16, { align: "right" });
  doc.setFontSize(7.5);
  doc.setTextColor(130);
  doc.text("Verificar en el sistema — N° de nota " + (solicitud.numero_nota || ""), 216 - margenDer, y + 22, { align: "right" });
  doc.setTextColor(0);
  if (barcodeClave) {
    doc.addImage(barcodeClave, "PNG", 216 - margenDer - 45, y + 25, 45, 12);
  }

  // --- Pie de página con número de página en todas las hojas ---
  const totalPaginas = doc.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8.5);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${totalPaginas}`, 108, 273, { align: "center" });
    doc.setTextColor(0);
  }

  doc.save(`Nota_Traslado_${solicitud.numero_nota || solicitud.id}.pdf`);
}
