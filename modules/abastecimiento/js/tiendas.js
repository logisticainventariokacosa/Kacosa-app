// js/tiendas.js
// Catálogo único de tiendas: usado por el dashboard, el selector de tienda,
// y para mapear el "Centro" de los archivos SAP a cada tienda.

export const TIENDAS = [
  { id: "UPI_VALENCIA",        nombre: "Upi Valencia",        centro: "1200" },
  { id: "UPI_LOS_GUAYOS",      nombre: "Upi Los Guayos",      centro: "1700" },
  { id: "UPI_CASTILLO",        nombre: "Upi Castillo",        centro: "1500" },
  { id: "UPI_MARACAY",         nombre: "Upi Maracay",         centro: "1400" },
  { id: "UPI_PUERTO_CABELLO",  nombre: "Upi Puerto Cabello",  centro: "11A0" },
  { id: "UPI_CORO",            nombre: "Upi Coro",            centro: "12A0" },
  { id: "UPI_MERCADERES",      nombre: "Upi Mercaderes",      centro: "1900" },
  { id: "UPI_ROSAL",           nombre: "Upi Rosal",           centro: "19A0" },
  { id: "GIGANTE",             nombre: "Gigante",             centro: "1300" },
  { id: "GIGANTE_2",           nombre: "Gigante 2",           centro: "1600" },
  { id: "COMERCIAL_SALVADOR",  nombre: "Comercial Salvador",  centro: "2010" },
  { id: "PRODUCTOS_KHALED",    nombre: "Productos Khaled",    centro: "2090" },
  { id: "FERRETOOLS",          nombre: "Ferretools",          centro: "1020" },
  // Kacosa también vende al mayor a sus propios clientes, por eso participa
  // en el análisis igual que una tienda más. Sus centros son 1000 y 3000
  // (los mismos de la casa matriz, tratados como una sola unidad).
  { id: "KACOSA",              nombre: "Kacosa",              centro: "1000", centros: ["1000", "3000"] }
];

// Centros que pertenecen a Kacosa (casa matriz) — se tratan como una sola unidad
export const CENTROS_KACOSA = ["1000", "3000"];

/** Devuelve el array de centros válidos para una tienda (la mayoría tiene 1, Kacosa tiene 2). */
export function centrosDeTienda(idTienda) {
  const t = TIENDAS.find(t => t.id === idTienda);
  if (!t) return [];
  return t.centros || [t.centro];
}

export function nombrePorId(id) {
  const t = TIENDAS.find(t => t.id === id);
  return t ? t.nombre : id;
}

// Almacenes SAP considerados "stock disponible de verdad" para cada centro
// (general + exhibición) — usado para filtrar la tabla "stock" de Supabase
// al leer stock directo (Nuevo Análisis y Alertas Kacosa comparten este mapa).
export const ALMACENES_POR_CENTRO = {
  "1200": ["1200", "1203"],
  "1300": ["1300", "1303"],
  "1400": ["1400", "1403"],
  "1500": ["1500", "1503"],
  "1600": ["1600", "1603"],
  "1700": ["1700", "1703"],
  "1900": ["1900", "1903"],
  "11A0": ["11A0", "11A3"],
  "12A0": ["12A0", "12A3"],
  "19A0": ["19A0", "19A3"],
  "2010": ["2010", "2013", "2017"],
  "2090": ["2090", "2093"],
  // Ferretools (centro 1020): además de los almacenes generales (1020/1023),
  // este centro también admite 1028 y 1029.
  "1020": ["1020", "1023", "1028", "1029"],
  // Kacosa (casa matriz): 1000/1029 = general, 1001 = exhibición (centro 1000);
  // 3000/3029 = general, 3001 = exhibición (centro 3000).
  "1000": ["1000", "1029"],
  "3000": ["3000", "3029"]
};

/** Une los almacenes permitidos de una lista de centros, sin duplicados. */
export function almacenesPermitidosParaCentros(centros) {
  const set = new Set();
  (centros || []).forEach(c => (ALMACENES_POR_CENTRO[c] || []).forEach(a => set.add(a)));
  return [...set];
}
