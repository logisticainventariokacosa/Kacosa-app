// js/supabase-client.js
// Cliente mínimo (sin SDK) para que el módulo Abastecimiento hable DIRECTO
// con Supabase desde el navegador, usando el idToken de Firebase (sesión de
// portal-kacosa) como Authorization: Bearer — sin pasar por Apps Script.
//
// Requiere que la integración "Third-Party Auth (Firebase)" ya esté activa
// en el proyecto de Supabase y que las políticas RLS para el rol
// "authenticated" ya existan (ver FASE_1_INSTRUCCIONES.md /
// politicas_rls_nuevas.sql). Antes de esto, cualquier llamada de aquí
// devolverá 401/403 aunque el código esté bien.
import { auth } from "./firebase-config.js";
import { getIdToken } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const SUPABASE_URL = "https://nlrgneggfqhmwszzbydb.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_3w3-FLBmhA3NPqwXVdm3AQ_OxTGvPix";

let tokenCache = null;
let tokenCacheExp = 0; // epoch ms

/**
 * Devuelve un idToken de Firebase vigente, renovándolo si ya casi expira
 * (los idToken de Firebase duran 1h) o si se pide forzado (tras un 401).
 */
async function obtenerTokenFirebase(forzar) {
  if (!auth.currentUser) {
    throw new Error("No hay sesión activa. Inicia sesión de nuevo.");
  }
  const margenMs = 5 * 60 * 1000; // renueva 5 min antes de que expire
  if (!forzar && tokenCache && Date.now() < tokenCacheExp - margenMs) {
    return tokenCache;
  }
  tokenCache = await getIdToken(auth.currentUser, !!forzar);
  tokenCacheExp = Date.now() + 55 * 60 * 1000; // margen conservador sobre 1h real
  return tokenCache;
}

async function ejecutar(method, pathConQuery, body, extraHeaders, token) {
  return fetch(SUPABASE_URL + "/rest/v1/" + pathConQuery, {
    method,
    headers: Object.assign(
      {
        apikey: PUBLISHABLE_KEY,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      extraHeaders || {}
    ),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

/**
 * Petición genérica a la API REST de Supabase (PostgREST).
 * @param {string} method GET | POST | PATCH | DELETE
 * @param {string} pathConQuery ej. "stock?select=material&centro=eq.1300"
 * @param {object|array} [body]
 * @param {object} [extraHeaders]
 */
async function request(method, pathConQuery, body, extraHeaders) {
  let token = await obtenerTokenFirebase(false);
  let resp = await ejecutar(method, pathConQuery, body, extraHeaders, token);

  if (resp.status === 401) {
    // El token pudo haber vencido justo antes de esta llamada: se fuerza uno
    // fresco y se reintenta UNA vez.
    token = await obtenerTokenFirebase(true);
    resp = await ejecutar(method, pathConQuery, body, extraHeaders, token);
  }

  if (!resp.ok) {
    const texto = await resp.text();
    throw new Error("Error Supabase (" + resp.status + "): " + texto);
  }
  const texto = await resp.text();
  return texto ? JSON.parse(texto) : null;
}

/** SELECT simple (hasta el límite por defecto de PostgREST, 1000 filas). */
async function supabaseSelect(tabla, queryString) {
  return request("GET", tabla + (queryString ? "?" + queryString : ""));
}

/**
 * SELECT paginado: trae TODAS las filas que cumplan el filtro, sin
 * importar cuántas sean, usando el header Range de PostgREST.
 * Úsalo para tablas que pueden superar las 1000 filas (stock, movimientos,
 * paquetes, analisis, etc.).
 */
async function supabaseSelectTodo(tabla, queryString, tamanoPagina = 1000) {
  const todas = [];
  let desde = 0;
  while (true) {
    const hasta = desde + tamanoPagina - 1;
    const token = await obtenerTokenFirebase(false);
    const resp = await ejecutar(
      "GET",
      tabla + (queryString ? "?" + queryString : ""),
      undefined,
      { Range: desde + "-" + hasta, Prefer: "count=exact" },
      token
    );
    if (!resp.ok) {
      const texto = await resp.text();
      throw new Error("Error Supabase (" + resp.status + "): " + texto);
    }
    const lote = await resp.json();
    todas.push(...lote);
    if (lote.length < tamanoPagina) break;
    desde += tamanoPagina;
  }
  return todas;
}

/**
 * INSERT (o upsert si se pasa onConflict).
 * @param {object} [opciones]
 * @param {string} [opciones.onConflict] columnas para on_conflict, ej. "material,centro,almacen"
 * @param {boolean} [opciones.merge=true] al haber conflicto: fusionar (true) o ignorar (false) la fila nueva
 */
async function supabaseInsert(tabla, filas, opciones = {}) {
  if (!filas || filas.length === 0) return [];
  const { onConflict, merge = true } = opciones;
  const query = onConflict ? tabla + "?on_conflict=" + encodeURIComponent(onConflict) : tabla;
  const prefer = onConflict
    ? "resolution=" + (merge ? "merge-duplicates" : "ignore-duplicates") + ",return=representation"
    : "return=representation";
  return request("POST", query, filas, { Prefer: prefer });
}

/** UPDATE de las filas que cumplan queryString (ej. "material=eq.123"). */
async function supabaseUpdate(tabla, queryString, cambios) {
  return request("PATCH", tabla + "?" + queryString, cambios, { Prefer: "return=representation" });
}

/** DELETE de las filas que cumplan queryString. */
async function supabaseDelete(tabla, queryString) {
  return request("DELETE", tabla + "?" + queryString, undefined, { Prefer: "return=minimal" });
}

export {
  request,
  supabaseSelect,
  supabaseSelectTodo,
  supabaseInsert,
  supabaseUpdate,
  supabaseDelete,
  obtenerTokenFirebase
};
