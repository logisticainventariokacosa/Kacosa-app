// js/captura-movil.js
// Submódulo "Captura Móvil" (rol analista). Habla DIRECTO con Supabase
// usando window.supabaseDirecto (token de sesión), no pasa por Apps
// Script en cada escaneo — ver supabase-directo.js.

(function () {
  let inventarioActivo = null; // fila de control_inventarios (abierto) del centro del analista
  let perfil = null;
  let materialActual = null; // material encontrado tras la búsqueda, listo para guardar

  // Se llama desde inventario-fisico.js cuando el rol es "analista".
  window.iniciarCapturaMovil = async function (cont, perfilRecibido) {
    perfil = perfilRecibido;
    cont.innerHTML = '<p class="muted">Buscando inventario abierto en tu tienda...</p>';

    try {
      const centro = perfil.centros && perfil.centros[0] ? perfil.centros[0].centro : null;
      if (!centro) {
        cont.innerHTML = '<p class="muted">Tu usuario no tiene una tienda asignada.</p>';
        return;
      }

      const inventarios = await window.supabaseDirecto.request(
        'GET',
        'control_inventarios?centro=eq.' + encodeURIComponent(centro) + '&estado=eq.abierto&select=*&limit=1'
      );

      if (!inventarios || !inventarios.length) {
        cont.innerHTML = '<p class="muted">No hay ningún inventario abierto en tu tienda todavía. Avisa a tu supervisor.</p>';
        return;
      }

      inventarioActivo = inventarios[0];
      render(cont);
    } catch (err) {
      cont.innerHTML = `<p class="muted">Error al iniciar la captura: ${err.message}</p>`;
    }
  };

  function render(cont) {
    cont.innerHTML = `
      <div class="search-card">
        <h2>${inventarioActivo.nombre_centro} · Almacén ${inventarioActivo.almacen}</h2>
        <p class="muted">Inventario abierto — día ${inventarioActivo.dias_transcurridos}</p>

        <div class="row" style="margin-top:12px;">
          <input id="capturaCodigo" placeholder="Escanea o escribe el código EAN / SAP" autofocus />
          <button id="btnBuscarCodigo">Buscar</button>
        </div>
        <div class="row" style="margin-top:6px; justify-content:flex-end;">
          <button class="alt" id="btnEscanearCamara">📷 Escanear con cámara</button>
        </div>
        <div id="capturaEstado" class="muted" style="margin-top:8px;"></div>
      </div>

      <div id="capturaFormulario"></div>

      <video id="capturaVideo" style="width:100%;border-radius:12px;margin-top:12px;display:none;" playsinline muted></video>
      <div class="row" id="capturaVideoAcciones" style="display:none; margin-top:8px;">
        <button class="alt" id="btnCerrarCamara">Cerrar cámara</button>
      </div>
    `;

    document.getElementById('btnBuscarCodigo').addEventListener('click', () => buscarCodigo());
    document.getElementById('capturaCodigo').addEventListener('keydown', (e) => {
      // Los lectores de código de barras físicos funcionan como teclado y
      // mandan "Enter" al terminar de leer — por eso se dispara aquí también.
      if (e.key === 'Enter') { e.preventDefault(); buscarCodigo(); }
    });
    document.getElementById('btnEscanearCamara').addEventListener('click', abrirCamara);
    document.getElementById('btnCerrarCamara').addEventListener('click', cerrarCamara);
  }

  async function buscarCodigo() {
    const input = document.getElementById('capturaCodigo');
    const codigo = input.value.trim();
    const estado = document.getElementById('capturaEstado');
    const formCont = document.getElementById('capturaFormulario');
    if (!codigo) return;

    estado.textContent = 'Buscando...';
    formCont.innerHTML = '';
    materialActual = null;

    try {
      // 1) ¿es un código EAN/UPC registrado?
      let material = null;
      const porEan = await window.supabaseDirecto.request(
        'GET',
        'codigos_ean_upc?codigo=eq.' + encodeURIComponent(codigo) + '&select=material'
      );
      if (porEan && porEan.length) {
        material = porEan[0].material;
      } else {
        // 2) si no, ¿el código escrito ES directamente el material SAP?
        const porMaterial = await window.supabaseDirecto.request(
          'GET',
          'maestro_materiales?material=eq.' + encodeURIComponent(codigo) + '&select=material'
        );
        if (porMaterial && porMaterial.length) material = porMaterial[0].material;
      }

      if (!material) {
        estado.textContent = 'Código no encontrado en el maestro de materiales.';
        return;
      }

      const [materiales, ubicaciones, stockRows, conteoExistente] = await Promise.all([
        window.supabaseDirecto.request('GET', 'maestro_materiales?material=eq.' + encodeURIComponent(material) + '&select=*'),
        window.supabaseDirecto.request('GET', 'UBICACIONES?material=eq.' + encodeURIComponent(material) + '&centro=eq.' + encodeURIComponent(inventarioActivo.centro) + '&almacen=eq.' + encodeURIComponent(inventarioActivo.almacen) + '&select=ubicacion'),
        window.supabaseDirecto.request('GET', 'stock?material=eq.' + encodeURIComponent(material) + '&centro=eq.' + encodeURIComponent(inventarioActivo.centro) + '&almacen=eq.' + encodeURIComponent(inventarioActivo.almacen) + '&select=libre_utilizacion'),
        window.supabaseDirecto.request('GET', 'maestro_conteo?id_inventario_ref=eq.' + inventarioActivo.id_inventario + '&material=eq.' + encodeURIComponent(material) + '&almacen=eq.' + encodeURIComponent(inventarioActivo.almacen) + '&select=*')
      ]);

      materialActual = {
        material,
        descripcion: materiales && materiales[0] ? materiales[0].descripcion : '',
        umb: materiales && materiales[0] ? materiales[0].umb : '',
        ubicacionSistema: ubicaciones && ubicaciones[0] ? ubicaciones[0].ubicacion : '',
        libreUtilizacion: stockRows && stockRows[0] ? stockRows[0].libre_utilizacion : 0,
        codigoEan: codigo,
        existente: conteoExistente && conteoExistente[0] ? conteoExistente[0] : null
      };

      estado.textContent = materialActual.existente
        ? 'Ya existe un conteo para este material en este almacén — se actualizará al guardar.'
        : '';
      renderFormulario();
    } catch (err) {
      estado.textContent = 'Error al buscar: ' + err.message;
    }
  }

  function renderFormulario() {
    const m = materialActual;
    const ex = m.existente;
    document.getElementById('capturaFormulario').innerHTML = `
      <div class="search-card">
        <h3>${m.material} — ${m.descripcion || 'Sin descripción'}</h3>
        <p class="muted">UMB: ${m.umb || '—'} · Ubicación sistema: ${m.ubicacionSistema || '—'} · Stock sistema: ${m.libreUtilizacion}</p>

        <label for="capturaUbicacionFisica">Ubicación física</label>
        <input id="capturaUbicacionFisica" value="${ex ? (ex.ubicacion_fisica || '') : (m.ubicacionSistema || '')}" />

        <label for="capturaConteo" style="margin-top:10px;display:block;">Conteo físico</label>
        <input id="capturaConteo" type="number" step="0.001" value="${ex ? ex.conteo : ''}" placeholder="0.000" />

        <label for="capturaPorSincronizar" style="margin-top:10px;display:block;">Por sincronizar (opcional)</label>
        <input id="capturaPorSincronizar" type="number" step="0.001" value="${ex ? ex.por_sincronizar : 0}" />

        <label for="capturaObservacion" style="margin-top:10px;display:block;">Observación (opcional)</label>
        <input id="capturaObservacion" value="${ex ? (ex.observacion || '') : ''}" />

        <div class="row" style="margin-top:14px;">
          <button id="btnGuardarConteo">${ex ? 'Actualizar conteo' : 'Guardar conteo'}</button>
        </div>
        <div id="capturaGuardarStatus" class="muted" style="margin-top:8px;"></div>
      </div>
    `;
    document.getElementById('btnGuardarConteo').addEventListener('click', guardarConteo);
    document.getElementById('capturaConteo').focus();
  }

  async function guardarConteo() {
    const status = document.getElementById('capturaGuardarStatus');
    const conteo = parseFloat(document.getElementById('capturaConteo').value);
    if (isNaN(conteo)) {
      status.textContent = 'Ingresa el conteo físico.';
      return;
    }
    const porSincronizar = parseFloat(document.getElementById('capturaPorSincronizar').value) || 0;
    const ubicacionFisica = document.getElementById('capturaUbicacionFisica').value.trim();
    const observacion = document.getElementById('capturaObservacion').value.trim();
    const m = materialActual;

    status.textContent = 'Guardando...';
    try {
      const filaBase = {
        id_inventario_ref: inventarioActivo.id_inventario,
        material: m.material,
        descripcion_material: m.descripcion,
        unidad_medida_base: m.umb,
        codigo_ean: m.codigoEan,
        ubicacion_sistema: m.ubicacionSistema,
        ubicacion_fisica: ubicacionFisica,
        conteo: conteo,
        por_sincronizar: porSincronizar,
        libre_utilizacion: m.libreUtilizacion,
        nombre_centro: inventarioActivo.nombre_centro,
        centro: inventarioActivo.centro,
        almacen: inventarioActivo.almacen,
        usuario_asignado: perfil.rol,
        correo_ultimo_auditor: window.firebase && firebase.auth().currentUser ? firebase.auth().currentUser.email : '',
        observacion: observacion
      };

      if (m.existente) {
        await window.supabaseDirecto.request(
          'PATCH',
          'maestro_conteo?unique_id=eq.' + m.existente.unique_id,
          filaBase,
          { Prefer: 'return=minimal' }
        );
      } else {
        await window.supabaseDirecto.request(
          'POST',
          'maestro_conteo',
          [filaBase],
          { Prefer: 'return=minimal' }
        );
      }

      status.textContent = 'Conteo guardado correctamente.';
      document.getElementById('capturaCodigo').value = '';
      document.getElementById('capturaFormulario').innerHTML = '';
      document.getElementById('capturaCodigo').focus();
    } catch (err) {
      status.textContent = 'No se pudo guardar: ' + err.message;
    }
  }

  // ---------------------------------------------------------------------
  // Escaneo por cámara (opcional): usa BarcodeDetector nativo si el
  // navegador lo soporta (Chrome/Android sí; Safari/iOS no). Si no está
  // disponible, se avisa y se sigue con la entrada manual/lector físico.
  // ---------------------------------------------------------------------
  let streamActivo = null;
  let detectorActivo = false;

  async function abrirCamara() {
    if (!('BarcodeDetector' in window)) {
      alert('Tu navegador no soporta escaneo de cámara. Usa un lector físico o escribe el código manualmente.');
      return;
    }
    const video = document.getElementById('capturaVideo');
    const acciones = document.getElementById('capturaVideoAcciones');
    try {
      streamActivo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = streamActivo;
      video.style.display = 'block';
      acciones.style.display = 'flex';
      await video.play();

      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e'] });
      detectorActivo = true;
      const loop = async () => {
        if (!detectorActivo) return;
        try {
          const codigos = await detector.detect(video);
          if (codigos && codigos.length) {
            document.getElementById('capturaCodigo').value = codigos[0].rawValue;
            cerrarCamara();
            buscarCodigo();
            return;
          }
        } catch (e) { /* frame ilegible, se reintenta */ }
        requestAnimationFrame(loop);
      };
      loop();
    } catch (err) {
      alert('No se pudo acceder a la cámara: ' + err.message);
    }
  }

  function cerrarCamara() {
    detectorActivo = false;
    if (streamActivo) {
      streamActivo.getTracks().forEach(t => t.stop());
      streamActivo = null;
    }
    document.getElementById('capturaVideo').style.display = 'none';
    document.getElementById('capturaVideoAcciones').style.display = 'none';
  }
})();
