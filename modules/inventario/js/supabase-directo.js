// js/supabase-directo.js
// Cliente mínimo (sin SDK) para que la Captura Móvil hable DIRECTO con
// Supabase, usando el token de sesión temporal (ver sesiones_movil /
// fase1_rls_corregido.sql), en vez de pasar cada escaneo por Apps Script.
//
// *** RELLENA ESTAS DOS CONSTANTES ANTES DE USAR ***
// SUPABASE_URL   -> la misma que ya usa tu Code.gs (Script Properties).
// PUBLISHABLE_KEY -> Supabase → Project Settings → API → Publishable key
//                    (es pública/segura para el cliente, es la sucesora
//                    de la "anon key" clásica — NO es la "secret key").
(function () {
  const SUPABASE_URL = "https://nlrgneggfqhmwszzbydb.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_3w3-FLBmhA3NPqwXVdm3AQ_OxTGvPix";

  let tokenActual = null;
  let expiraEn = 0; // epoch ms

  /** Pide un token de sesión nuevo al bridge (Apps Script) y lo guarda en memoria. */
  async function asegurarToken() {
    const margenSegundos = 60; // renueva 1 minuto antes de que expire
    if (tokenActual && Date.now() < expiraEn - margenSegundos * 1000) {
      return tokenActual;
    }
    const resp = await window.callBridgeInventario('obtenerTokenSupabase', {});
    if (!resp.ok) throw new Error(resp.error || 'No se pudo obtener el token de sesión.');
    tokenActual = resp.token;
    expiraEn = Date.now() + (resp.expira_en ? new Date(resp.expira_en).getTime() - Date.now() : 30 * 60 * 1000);
    // Nota: expira_en viene como ISO string absoluto desde Inventario.gs.
    expiraEn = new Date(resp.expira_en).getTime();
    return tokenActual;
  }

  /**
   * @param {string} method GET | POST | PATCH | DELETE
   * @param {string} pathConQuery ej. "maestro_materiales?material=eq.1000001234&select=*"
   * @param {object|array} [body]
   * @param {object} [extraHeaders]
   */
  async function request(method, pathConQuery, body, extraHeaders) {
    const token = await asegurarToken();
    const resp = await fetch(SUPABASE_URL + '/rest/v1/' + pathConQuery, {
      method,
      headers: Object.assign({
        apikey: PUBLISHABLE_KEY,
        'x-kacosa-token': token,
        'Content-Type': 'application/json'
      }, extraHeaders || {}),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    if (!resp.ok) {
      const texto = await resp.text();
      throw new Error('Error Supabase (' + resp.status + '): ' + texto);
    }
    const texto = await resp.text();
    return texto ? JSON.parse(texto) : null;
  }

  window.supabaseDirecto = { request, asegurarToken };
})();
