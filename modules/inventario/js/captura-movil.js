// js/captura-movil.js
// Submódulo "Captura Móvil" (rol analista). Habla DIRECTO con Supabase
// usando window.supabaseDirecto (token de sesión), no pasa por Apps
// Script en cada escaneo — ver supabase-directo.js.
//
// Flujo: código (escáner físico / cámara / manual) -> ubicación física
// (obligatoria, también escaneable) -> conteo físico (obligatorio) ->
// por sincronizar / observación / foto (opcionales) -> guardar o cancelar.

(function () {
  let inventarioActivo = null; // fila de control_inventarios (abierto) del centro del analista
  let perfil = null;
  let materialActual = null; // material encontrado tras la búsqueda, listo para guardar

  // Se llama desde inventario-fisico.js cuando el rol es "analista": su
  // tienda ya está fija, se busca el inventario abierto directamente.
  window.iniciarCapturaMovil = async function (cont, perfilRecibido) {
    perfil = perfilRecibido;
    const centro = perfil.centros && perfil.centros[0] ? perfil.centros[0].centro : null;
    if (!centro) {
      cont.innerHTML = '<p class="muted">Tu usuario no tiene una tienda asignada.</p>';
      return;
    }
    await cargarInventarioYMostrar(cont, centro);
  };

  // Se llama desde "Control de Inventarios" > "Contar" cuando el rol es
  // supervisor/coordinador: como puede tener varios centros asignados,
  // primero elige en cuál va a apoyar el conteo.
  window.iniciarCapturaSupervisor = async function (cont, perfilRecibido) {
    perfil = perfilRecibido;
    if (!perfil.centros || !perfil.centros.length) {
      cont.innerHTML = '<p class="muted">No tienes centros asignados.</p>';
      return;
    }
    const opciones = perfil.centros.map(c => `<option value="${c.centro}">${c.nombre_centro} (${c.centro})</option>`).join('');
    cont.innerHTML = `
      <div class="search-card">
        <h2>Contar como apoyo</h2>
        <label for="capturaSupCentro">Centro</label>
        <select id="capturaSupCentro" class="custom-select">${opciones}</select>
        <div class="row" style="margin-top:14px;">
          <button id="btnContinuarCaptura">Continuar</button>
        </div>
      </div>
    `;
    document.getElementById('btnContinuarCaptura').addEventListener('click', () => {
      const centro = document.getElementById('capturaSupCentro').value;
      cargarInventarioYMostrar(cont, centro);
    });
  };

  async function cargarInventarioYMostrar(cont, centro) {
    cont.innerHTML = '<p class="muted">Buscando inventario abierto...</p>';
    try {
      const inventarios = await window.supabaseDirecto.request(
        'GET',
        'control_inventarios?centro=eq.' + encodeURIComponent(centro) + '&estado=eq.abierto&select=*&limit=1'
      );

      if (!inventarios || !inventarios.length) {
        cont.innerHTML = '<p class="muted">No hay ningún inventario abierto en esa tienda todavía.</p>';
        return;
      }

      inventarioActivo = inventarios[0];
      if (inventarioActivo.estado === 'abierto') {
        try {
          inventarioActivo.dias_transcurridos = await window.supabaseDirecto.request(
            'POST', 'rpc/fn_recalcular_dias_transcurridos', { p_id_inventario: inventarioActivo.id_inventario }
          );
        } catch (e) { /* si falla, se muestra el valor guardado */ }
      }
      render(cont);
    } catch (err) {
      cont.innerHTML = `<p class="muted">Error al iniciar la captura: ${err.message}</p>`;
    }
  }

  function render(cont) {
    cont.innerHTML = `
      <style>
        .fisico-inv-card{border:1px solid rgba(100,116,139,0.25);border-radius:12px;padding:14px 16px;margin-bottom:12px;background:var(--card-bg);}
        .fisico-inv-card .fisico-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}
        .fisico-inv-card .fisico-titulo{font-weight:600;}
        .fisico-badge{font-size:0.78rem;font-weight:600;padding:3px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;}
        .fisico-badge.falta{background:#fee2e2;color:#991b1b;}
        .fisico-badge.sobra{background:#fef3c7;color:#92400e;}
        .fisico-badge.ok{background:#dcfce7;color:#166534;}
        html.kacosa-dark .fisico-badge.falta{background:#7f1d1d;color:#fecaca;}
        html.kacosa-dark .fisico-badge.sobra{background:#78350f;color:#fde68a;}
        html.kacosa-dark .fisico-badge.ok{background:#14532d;color:#bbf7d0;}
        .fisico-inv-card .fisico-meta{margin-top:6px;font-size:0.9rem;}
        .fisico-inv-card .fisico-acciones{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
        .fisico-inv-card .fisico-acciones button{padding:8px 14px;font-size:0.9rem;}
      </style>
      <div class="search-card">
        <h2>${inventarioActivo.nombre_centro} · Almacén ${inventarioActivo.almacen}</h2>
        <p class="muted">Inventario abierto — día ${inventarioActivo.dias_transcurridos}</p>

        <div class="row" style="margin-top:12px;">
          <input id="capturaCodigo" placeholder="Escanea o escribe el código EAN / SAP" autofocus />
          <button id="btnBuscarCodigo">Buscar</button>
        </div>
        <div class="row" style="margin-top:6px; justify-content:flex-end;">
          <button class="alt" id="btnEscanearCamaraCodigo">📷 Escanear código con cámara</button>
        </div>
        <div id="capturaEstado" class="muted" style="margin-top:8px;"></div>
      </div>

      <div id="capturaFormulario"></div>

      <video id="capturaVideo" style="width:100%;border-radius:12px;margin-top:12px;display:none;" playsinline muted></video>
      <div class="row" id="capturaVideoAcciones" style="display:none; margin-top:8px;">
        <button class="alt" id="btnCerrarCamara">Cerrar cámara</button>
      </div>

      <h3 style="margin-top:28px;margin-bottom:12px;">Mis conteos pendientes</h3>
      <div id="misConteosLista"><p class="muted">Cargando...</p></div>
    `;

    document.getElementById('btnBuscarCodigo').addEventListener('click', () => buscarCodigo());
    document.getElementById('capturaCodigo').addEventListener('keydown', (e) => {
      // Los lectores de código de barras físicos funcionan como teclado y
      // mandan "Enter" al terminar de leer — por eso se dispara aquí también.
      if (e.key === 'Enter') { e.preventDefault(); buscarCodigo(); }
    });
    document.getElementById('btnEscanearCamaraCodigo').addEventListener('click', () => abrirCamara('capturaCodigo'));
    document.getElementById('btnCerrarCamara').addEventListener('click', cerrarCamara);

    cargarMisConteos();
  }

  function emailActual() {
    return window.firebase && firebase.auth().currentUser ? firebase.auth().currentUser.email : '';
  }

  let filasMisConteos = [];
  let ordenMisConteosCampo = 'fecha_ultimo_conteo';
  let ordenMisConteosDir = 'desc';

  // Solo lo que ESTE analista contó, en ESTE inventario (que ya sabemos
  // que está abierto, porque solo llegamos aquí si lo está), y que
  // todavía no pasó a otra etapa: sin contabilizar, no preliminar, no
  // verificado. En cuanto el supervisor cambia cualquiera de esos tres,
  // el registro deja de aparecer en la lista del analista.
  async function cargarMisConteos() {
    const cont = document.getElementById('misConteosLista');
    if (!cont) return;
    cont.innerHTML = '<p class="muted">Cargando...</p>';

    try {
      filasMisConteos = await window.supabaseDirecto.request(
        'GET',
        'maestro_conteo?id_inventario_ref=eq.' + inventarioActivo.id_inventario +
        '&usuario_asignado=eq.' + encodeURIComponent(emailActual()) +
        '&documento=eq.' + encodeURIComponent('sin contabilizar') +
        '&preliminar=eq.false&verificado=eq.false' +
        '&select=*&limit=200'
      ) || [];

      if (!filasMisConteos.length) {
        cont.innerHTML = '<p class="muted">Todavía no has registrado conteos en este inventario.</p>';
        return;
      }

      ordenarYRenderizarMisConteos();
    } catch (err) {
      cont.innerHTML = `<p class="muted">Error al cargar tus conteos: ${err.message}</p>`;
    }
  }

  function filaMisConteosHtml(f) {
    return `
      <tr data-id="${f.unique_id}">
        <td>${f.material}</td>
        <td>${f.descripcion_material || '—'}</td>
        <td>${f.ubicacion_fisica || '—'}</td>
        <td>${f.conteo}</td>
        <td>${f.por_sincronizar}</td>
        <td>${f.libre_utilizacion}</td>
        <td>${f.diferencia}</td>
        <td><span class="fisico-badge ${f.estatus_diferencia || ''}">${f.estatus_diferencia || '—'}</span></td>
        <td><button class="alt" data-editar="${f.unique_id}">Ver / editar</button></td>
      </tr>
    `;
  }

  function ordenarYRenderizarMisConteos() {
    const cont = document.getElementById('misConteosLista');
    const campo = ordenMisConteosCampo;
    const dir = ordenMisConteosDir === 'asc' ? 1 : -1;
    const copia = filasMisConteos.slice().sort((a, b) => {
      const va = a[campo], vb = b[campo];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });

    cont.innerHTML = `
      <div class="table-container">
        <table class="inventory-table" id="misConteosTabla">
          <thead>
            <tr>
              <th data-ordenar="material">Material</th>
              <th data-ordenar="descripcion_material">Descripción</th>
              <th data-ordenar="ubicacion_fisica">Ubicación</th>
              <th data-ordenar="conteo">Conteo</th>
              <th data-ordenar="por_sincronizar">Por sincronizar</th>
              <th data-ordenar="libre_utilizacion">Sistema</th>
              <th data-ordenar="diferencia">Diferencia</th>
              <th data-ordenar="estatus_diferencia">Estatus</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${copia.map(filaMisConteosHtml).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.querySelectorAll('#misConteosTabla th[data-ordenar]').forEach(th => {
      th.style.cursor = 'pointer';
      if (th.dataset.ordenar === ordenMisConteosCampo) {
        th.textContent += ordenMisConteosDir === 'asc' ? ' ▲' : ' ▼';
      }
      th.addEventListener('click', () => {
        const campo = th.dataset.ordenar;
        if (ordenMisConteosCampo === campo) {
          ordenMisConteosDir = ordenMisConteosDir === 'asc' ? 'desc' : 'asc';
        } else {
          ordenMisConteosCampo = campo;
          ordenMisConteosDir = 'asc';
        }
        ordenarYRenderizarMisConteos();
      });
    });

    cont.querySelectorAll('button[data-editar]').forEach(btn => {
      btn.addEventListener('click', () => {
        const fila = filasMisConteos.find(f => String(f.unique_id) === btn.dataset.editar);
        if (fila) cargarParaEditar(fila);
      });
    });
  }

  // Reutiliza el mismo formulario de captura, precargado con un registro
  // que ya existe (los datos del material ya están guardados en la fila,
  // no hace falta volver a consultar maestro_materiales/UBICACIONES/stock).
  function cargarParaEditar(fila) {
    materialActual = {
      material: fila.material,
      descripcion: fila.descripcion_material,
      umb: fila.unidad_medida_base,
      ubicacionSistema: fila.ubicacion_sistema,
      libreUtilizacion: fila.libre_utilizacion,
      codigoEan: fila.codigo_ean,
      existente: fila
    };
    document.getElementById('capturaCodigo').value = fila.codigo_ean || fila.material;
    document.getElementById('capturaEstado').textContent = 'Editando un conteo existente.';
    renderFormulario();
    document.getElementById('capturaFormulario').scrollIntoView({ behavior: 'smooth', block: 'start' });
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

        <label for="capturaUbicacionFisica">Ubicación física <span style="color:#dc2626;">*</span></label>
        <div class="row">
          <input id="capturaUbicacionFisica" value="${ex ? (ex.ubicacion_fisica || '') : ''}" placeholder="Escanea o escribe la ubicación" />
        </div>
        <div class="row" style="margin-top:4px; justify-content:flex-end;">
          <button class="alt" id="btnEscanearCamaraUbicacion" type="button">📷 Escanear ubicación</button>
        </div>

        <label for="capturaConteo" style="margin-top:10px;display:block;">Conteo físico <span style="color:#dc2626;">*</span></label>
        <input id="capturaConteo" type="number" step="0.001" value="${ex ? ex.conteo : ''}" placeholder="0.000" />

        <label for="capturaPorSincronizar" style="margin-top:10px;display:block;">Por sincronizar (opcional)</label>
        <input id="capturaPorSincronizar" type="number" step="0.001" value="${ex ? ex.por_sincronizar : 0}" />

        <label for="capturaObservacion" style="margin-top:10px;display:block;">Observación (opcional)</label>
        <input id="capturaObservacion" value="${ex ? (ex.observacion || '') : ''}" />

        <label for="capturaVerificado" style="margin-top:10px;display:block;">Verificado</label>
        <select id="capturaVerificado" class="custom-select">
          <option value="false" ${!ex || !ex.verificado ? 'selected' : ''}>No</option>
          <option value="true" ${ex && ex.verificado ? 'selected' : ''}>Sí</option>
        </select>

        <label for="capturaImagenInput" style="margin-top:10px;display:block;">Foto del producto (opcional)</label>
        <input id="capturaImagenInput" type="file" accept="image/*" capture="environment" />
        <div id="capturaImagenPreview" style="margin-top:8px;"></div>

        <div class="row" style="margin-top:16px;">
          <button id="btnGuardarConteo">${ex ? 'Actualizar conteo' : 'Guardar conteo'}</button>
        </div>
        <div id="capturaGuardarStatus" class="muted" style="margin-top:8px;"></div>

        <div class="row" style="margin-top:14px;">
          <button id="btnCancelarConteo" type="button" style="background:none;border:none;color:#94a3b8;text-decoration:underline;font-size:0.85rem;cursor:pointer;padding:4px;">
            Cancelar y limpiar
          </button>
        </div>
      </div>
    `;

    document.getElementById('btnGuardarConteo').addEventListener('click', guardarConteo);
    document.getElementById('btnCancelarConteo').addEventListener('click', cancelarCaptura);
    document.getElementById('btnEscanearCamaraUbicacion').addEventListener('click', () => abrirCamara('capturaUbicacionFisica'));

    const inputUbicacion = document.getElementById('capturaUbicacionFisica');
    const inputConteo = document.getElementById('capturaConteo');
    inputUbicacion.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inputConteo.focus(); }
    });
    inputConteo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btnGuardarConteo').click(); }
    });

    document.getElementById('capturaImagenInput').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      const preview = document.getElementById('capturaImagenPreview');
      if (!file) { preview.innerHTML = ''; return; }
      const url = URL.createObjectURL(file);
      preview.innerHTML = `<img src="${url}" style="max-width:140px;border-radius:8px;" />`;
    });

    // Paso 1 (código) ya está resuelto; el siguiente campo obligatorio es
    // la ubicación física, así que el foco va ahí, no en el conteo.
    inputUbicacion.focus();
  }

  function cancelarCaptura() {
    materialActual = null;
    document.getElementById('capturaFormulario').innerHTML = '';
    const codigoInput = document.getElementById('capturaCodigo');
    const estado = document.getElementById('capturaEstado');
    codigoInput.value = '';
    estado.textContent = '';
    codigoInput.focus();
  }

  function imagenABase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function guardarConteo() {
    const status = document.getElementById('capturaGuardarStatus');
    const ubicacionFisica = document.getElementById('capturaUbicacionFisica').value.trim();
    const conteoRaw = document.getElementById('capturaConteo').value;
    const conteo = parseFloat(conteoRaw);

    // Obligatorios: código (ya resuelto para llegar aquí), ubicación física y conteo.
    if (!ubicacionFisica) {
      status.textContent = 'La ubicación física es obligatoria.';
      document.getElementById('capturaUbicacionFisica').focus();
      return;
    }
    if (conteoRaw === '' || isNaN(conteo)) {
      status.textContent = 'El conteo físico es obligatorio.';
      document.getElementById('capturaConteo').focus();
      return;
    }

    const porSincronizar = parseFloat(document.getElementById('capturaPorSincronizar').value) || 0;
    const observacion = document.getElementById('capturaObservacion').value.trim();
    const verificado = document.getElementById('capturaVerificado').value === 'true';
    const archivoImagen = document.getElementById('capturaImagenInput').files[0];
    const m = materialActual;

    status.textContent = 'Guardando...';
    try {
      let imagenBase64 = null;
      if (archivoImagen) {
        status.textContent = 'Procesando foto...';
        imagenBase64 = await imagenABase64(archivoImagen);
        // Nota: se guarda como base64 en la columna de texto IMAGEN_VISUAL.
        // Para volúmenes altos de fotos conviene migrar esto a Supabase
        // Storage (guardar solo la URL) — queda como mejora futura.
      }

      const emailUsuario = window.firebase && firebase.auth().currentUser ? firebase.auth().currentUser.email : '';
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
        usuario_asignado: emailUsuario,
        verificado: verificado,
        correo_ultimo_auditor: emailUsuario,
        observacion: observacion
      };
      if (imagenBase64) filaBase.imagen_visual = imagenBase64;

      status.textContent = 'Guardando...';
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
      cancelarCaptura();
      cargarMisConteos();
    } catch (err) {
      status.textContent = 'No se pudo guardar: ' + err.message;
    }
  }

  // ---------------------------------------------------------------------
  // Escaneo por cámara (opcional): usa BarcodeDetector nativo si el
  // navegador lo soporta (Chrome/Android sí; Safari/iOS no). Si no está
  // disponible, se avisa y se sigue con la entrada manual/lector físico.
  // Se reutiliza tanto para el código de material como para la ubicación
  // física (las etiquetas de estante también son códigos de barras).
  // ---------------------------------------------------------------------
  let streamActivo = null;
  let detectorActivo = false;
  let campoDestinoEscaneo = null;

  async function abrirCamara(idCampoDestino) {
    if (!('BarcodeDetector' in window)) {
      alert('Tu navegador no soporta escaneo de cámara. Usa un lector físico o escribe el código manualmente.');
      return;
    }
    campoDestinoEscaneo = idCampoDestino;
    const video = document.getElementById('capturaVideo');
    const acciones = document.getElementById('capturaVideoAcciones');
    try {
      streamActivo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = streamActivo;
      video.style.display = 'block';
      acciones.style.display = 'flex';
      await video.play();

      // Auto-scroll para que el usuario no tenga que buscar la cámara
      // con el dedo — la enfoca de una vez.
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e'] });
      detectorActivo = true;
      const loop = async () => {
        if (!detectorActivo) return;
        try {
          const codigos = await detector.detect(video);
          if (codigos && codigos.length) {
            const destino = document.getElementById(campoDestinoEscaneo);
            destino.value = codigos[0].rawValue;
            cerrarCamara();
            if (campoDestinoEscaneo === 'capturaCodigo') {
              buscarCodigo();
            } else {
              // Ubicación escaneada: siguiente parada es el conteo.
              const conteoInput = document.getElementById('capturaConteo');
              if (conteoInput) conteoInput.focus();
            }
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
  // ---------------------------------------------------------------------
  // Modal de edición reutilizable — lo usa Monitor (supervisor) para
  // editar un conteo existente sin tener que "entrar" a la pantalla de
  // Captura Móvil. Incluye Verificado como Sí/No, tal como en el
  // formulario normal de captura.
  // ---------------------------------------------------------------------
  window.abrirEdicionConteoModal = function (fila, opciones) {
    opciones = opciones || {};
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px;';
    overlay.innerHTML = `
      <div class="search-card" style="max-width:420px;width:100%;max-height:85vh;overflow-y:auto;">
        <h3>${fila.material} — ${fila.descripcion_material || 'Sin descripción'}</h3>
        <p class="muted">${fila.nombre_centro || fila.centro} · Almacén ${fila.almacen}</p>

        <label for="modalEdicionUbicacion">Ubicación física</label>
        <input id="modalEdicionUbicacion" value="${fila.ubicacion_fisica || ''}" />

        <label for="modalEdicionConteo" style="margin-top:10px;display:block;">Conteo físico</label>
        <input id="modalEdicionConteo" type="number" step="0.001" value="${fila.conteo}" />

        <label for="modalEdicionPorSincronizar" style="margin-top:10px;display:block;">Por sincronizar</label>
        <input id="modalEdicionPorSincronizar" type="number" step="0.001" value="${fila.por_sincronizar || 0}" />

        <label for="modalEdicionObservacion" style="margin-top:10px;display:block;">Observación</label>
        <input id="modalEdicionObservacion" value="${fila.observacion || ''}" />

        <label for="modalEdicionVerificado" style="margin-top:10px;display:block;">Verificado</label>
        <select id="modalEdicionVerificado" class="custom-select">
          <option value="false" ${!fila.verificado ? 'selected' : ''}>No</option>
          <option value="true" ${fila.verificado ? 'selected' : ''}>Sí</option>
        </select>

        <div class="row" style="margin-top:16px;">
          <button id="modalEdicionGuardar">Guardar</button>
          <button class="alt" id="modalEdicionCancelar">Cancelar</button>
        </div>
        <div id="modalEdicionStatus" class="muted" style="margin-top:8px;"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#modalEdicionCancelar').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#modalEdicionGuardar').addEventListener('click', async () => {
      const status = overlay.querySelector('#modalEdicionStatus');
      const ubicacion = overlay.querySelector('#modalEdicionUbicacion').value.trim();
      const conteo = parseFloat(overlay.querySelector('#modalEdicionConteo').value);
      if (!ubicacion) { status.textContent = 'La ubicación física es obligatoria.'; return; }
      if (isNaN(conteo)) { status.textContent = 'El conteo físico es obligatorio.'; return; }

      const cambios = {
        ubicacion_fisica: ubicacion,
        conteo: conteo,
        por_sincronizar: parseFloat(overlay.querySelector('#modalEdicionPorSincronizar').value) || 0,
        observacion: overlay.querySelector('#modalEdicionObservacion').value.trim(),
        verificado: overlay.querySelector('#modalEdicionVerificado').value === 'true',
        libre_utilizacion: fila.libre_utilizacion
      };

      status.textContent = 'Guardando...';
      try {
        await window.supabaseDirecto.request('PATCH', 'maestro_conteo?unique_id=eq.' + fila.unique_id, cambios, { Prefer: 'return=minimal' });
        overlay.remove();
        if (opciones.onGuardado) opciones.onGuardado(cambios);
      } catch (err) {
        status.textContent = 'No se pudo guardar: ' + err.message;
      }
    });
  };
})();
