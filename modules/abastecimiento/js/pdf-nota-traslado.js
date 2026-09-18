// js/pdf-nota-traslado.js
// Genera y descarga el PDF "Nota de Traslado" para solicitudes Extra SAP ya
// aprobadas. Se llama SOLO después de reclamar exitosamente la clave de un
// solo uso (ver abrirModalDescarga en traslados.js) — este archivo no vuelve
// a validar nada, confía en que quien lo llamó ya hizo el UPDATE atómico.
//
// Requiere jsPDF cargado como <script> global en app.html
// (https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js) —
// expone window.jspdf.jsPDF.
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

  // --- Encabezado: fecha (izq) y número de nota (der) ---
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(fechaEnLetras(new Date(), emisora.ciudad), margenIzq, y);
  doc.text(String(solicitud.numero_nota || ""), 216 - margenDer, y, { align: "right" });

  y += 14;
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

    if (y + alturaFila > 250) { // deja espacio para pie de página
      doc.addPage();
      y = 20;
      encabezadoTabla();
    }

    doc.text(String(m.codigo || ""), colX.codigo, y);
    doc.text(lineasDesc, colX.desc, y);
    doc.text(String(m.unidad || ""), colX.umb, y);
    doc.text(String(m.cantidad ?? ""), colX.cant, y);
    y += alturaFila;
  });

  // --- Firmas (al final del documento, después de la tabla) ---
  if (y > 225) { doc.addPage(); y = 20; }
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
