// js/excel-estilos.js
// Helpers para generar hojas de Excel con formato profesional usando xlsx-js-style
// (encabezados con color, bordes, colores por clase/alerta, anchos de columna).
// NOTA: los gráficos nativos de Excel (barras/tortas) no son posibles con
// librerías gratuitas del lado del navegador — esa función es exclusiva de
// SheetJS Pro (de pago). En su lugar, se usa una hoja "Resumen" con las cifras
// clave bien presentadas visualmente.

const AZUL_BASE = "FF1B2A41";
const AMBAR = "FFE8A03D";
const VERDE = "FF2F8F6E";
const ROJO = "FFC4432B";
const GRIS_CLARO = "FFF7F8FA";
const BLANCO = "FFFFFFFF";

const BORDE_FINO = { style: "thin", color: { rgb: "FFD9DCE1" } };
const BORDE_CELDA = { top: BORDE_FINO, bottom: BORDE_FINO, left: BORDE_FINO, right: BORDE_FINO };

const ESTILO_HEADER = {
  font: { bold: true, color: { rgb: BLANCO }, sz: 11, name: "Calibri" },
  fill: { fgColor: { rgb: AZUL_BASE } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: BORDE_CELDA
};

const COLORES_CLASE = {
  A: "FFDCEEE6", // verde claro
  B: "FFDCE7F5", // azul claro
  C: "FFFCEBD3", // ámbar claro
  D: "FFEDEDED"  // gris claro
};

const COLORES_ALERTA = {
  "SIN_STOCK": "FFF9D6CF",
  "STOCK_BAJO": "FFFCEBD3",
  "Sin stock": "FFF9D6CF",
  "Stock bajo": "FFFCEBD3"
};

/**
 * Construye una hoja de Excel con encabezado estilizado, bordes, anchos de
 * columna automáticos, y coloreado condicional por clase/alerta si aplica.
 * @param {Array<Object>} filas - datos (cada objeto usa las keys de `columnas`)
 * @param {Array<{key:string, label:string, ancho?:number}>} columnas
 * @param {Object} opciones - { colorearPorClase: boolean, colorearPorAlerta: boolean }
 */
export function construirHojaEstilizada(filas, columnas, opciones = {}) {
  const headerRow = columnas.map(c => c.label);
  const dataRows = filas.map(f => columnas.map(c => f[c.key] ?? ""));
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);

  // Header
  columnas.forEach((c, idx) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: idx });
    if (ws[addr]) ws[addr].s = ESTILO_HEADER;
  });

  // Filas de datos: bordes + color condicional
  filas.forEach((fila, r) => {
    let colorFondo = null;
    if (opciones.colorearPorClase && fila.clase) colorFondo = COLORES_CLASE[fila.clase];
    if (opciones.colorearPorAlerta && fila.tipo) colorFondo = COLORES_ALERTA[fila.tipo];

    columnas.forEach((c, idx) => {
      const addr = XLSX.utils.encode_cell({ r: r + 1, c: idx });
      if (!ws[addr]) return;
      ws[addr].s = {
        border: BORDE_CELDA,
        alignment: { vertical: "center" },
        fill: colorFondo ? { fgColor: { rgb: colorFondo } } : undefined
      };
    });
  });

  ws["!cols"] = columnas.map(c => ({ wch: c.ancho || Math.max(12, c.label.length + 2) }));
  ws["!rows"] = [{ hpx: 22 }];

  return ws;
}

/**
 * Construye la hoja "Resumen" con las cifras clave presentadas como tarjetas
 * de texto grandes y con color, a modo de mini-dashboard (sin gráficos nativos,
 * que requieren la versión de pago de SheetJS).
 * @param {string} titulo
 * @param {Array<{label:string, valor:string|number, color?:string}>} tarjetas
 * @param {Array<string>} notasAdicionales - líneas de texto libres (ej. periodo analizado)
 */
export function construirHojaResumen(titulo, tarjetas, notasAdicionales = []) {
  const ws = {};
  const rango = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };

  const setCelda = (r, c, valor, estilo) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    ws[addr] = { t: typeof valor === "number" ? "n" : "s", v: valor, s: estilo };
    if (r > rango.e.r) rango.e.r = r;
    if (c > rango.e.c) rango.e.c = c;
  };

  // Título
  setCelda(0, 0, titulo, {
    font: { bold: true, sz: 16, color: { rgb: AZUL_BASE }, name: "Calibri" }
  });

  // Tarjetas (una por fila, con su valor destacado al lado)
  let fila = 2;
  tarjetas.forEach(t => {
    setCelda(fila, 0, t.label, {
      font: { bold: true, sz: 11, color: { rgb: "FF6B7280" } },
      fill: { fgColor: { rgb: GRIS_CLARO } },
      border: BORDE_CELDA,
      alignment: { vertical: "center" }
    });
    setCelda(fila, 1, t.valor, {
      font: { bold: true, sz: 16, color: { rgb: t.color || AZUL_BASE } },
      fill: { fgColor: { rgb: GRIS_CLARO } },
      border: BORDE_CELDA,
      alignment: { vertical: "center", horizontal: "center" }
    });
    fila++;
  });

  fila++;
  notasAdicionales.forEach(nota => {
    setCelda(fila, 0, nota, { font: { italic: true, sz: 10, color: { rgb: "FF6B7280" } } });
    fila++;
  });

  ws["!ref"] = XLSX.utils.encode_range(rango);
  ws["!cols"] = [{ wch: 32 }, { wch: 20 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];

  return ws;
}
