// js/administracion.js
// Submódulo "Administración": Centros, Almacenes, Personas, Analistas
// (asignar centro), Supervisores (asignar tiendas), Usuarios (asignar
// rol del sistema — solo administrador). Cada pestaña se muestra u
// oculta según el rol, pero el permiso REAL se valida siempre en
// Apps Script (esto es solo para no mostrar botones que van a fallar).

(function () {
  let perfilActual = null;

  function iniciar() {
    const link = document.querySelector('.nav a[data-section="administracion"]');
    if (!link) return;
    link.addEventListener('click', cargarPantalla);
  }

  async function cargarPantalla() {
    const cont = document.getElementById('administracion-contenido');
    if (!cont) return;
    cont.innerHTML = '<p class="muted">Cargando...</p>';

    const resp = await window.callBridgeInventario('perfilInventario', {});
    if (!resp.ok) {
      cont.innerHTML = `<p class="muted">${resp.error}</p>`;
      return;
    }
    if (resp.rol === 'analista') {
      cont.innerHTML = '<p class="muted">Este submódulo no está disponible para tu rol.</p>';
      return;
    }
    perfilActual = resp;
    render(cont);
  }

  const PESTANAS = [
    { id: 'centros', label: 'Centros', roles: ['coordinador', 'administrador'], init: iniciarCentros },
    { id: 'almacenes', label: 'Almacenes', roles: ['coordinador', 'administrador'], init: iniciarAlmacenes },
    { id: 'personas', label: 'Personas', roles: ['supervisor', 'coordinador', 'administrador'], init: iniciarPersonas },
    { id: 'analistas', label: 'Analistas', roles: ['supervisor', 'coordinador', 'administrador'], init: iniciarAnalistas },
    { id: 'supervisores', label: 'Supervisores', roles: ['coordinador', 'administrador'], init: iniciarSupervisores },
    { id: 'usuarios', label: 'Usuarios', roles: ['administrador'], init: iniciarUsuarios }
  ];

  function render(cont) {
    const disponibles = PESTANAS.filter(p => p.roles.indexOf(perfilActual.rol) !== -1);
    if (!disponibles.length) {
      cont.innerHTML = '<p class="muted">No tienes pestañas disponibles en Administración.</p>';
      return;
    }

    cont.innerHTML = `
      <div class="row" style="gap:8px;margin-bottom:16px;flex-wrap:wrap;">
        ${disponibles.map((p, i) => `<button class="${i === 0 ? '' : 'alt'}" data-tab="${p.id}">${p.label}</button>`).join('')}
      </div>
      <div id="adminSub"></div>
    `;
    const sub = document.getElementById('adminSub');

    cont.querySelectorAll('button[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        cont.querySelectorAll('button[data-tab]').forEach(b => b.className = 'alt');
        btn.className = '';
        const pestana = disponibles.find(p => p.id === btn.dataset.tab);
        pestana.init(sub);
      });
    });

    disponibles[0].init(sub);
  }

  // ---------------------------------------------------------------------
  // CENTROS
  // ---------------------------------------------------------------------
  async function iniciarCentros(sub) {
    sub.innerHTML = `
      <div class="search-card">
        <h3>Registrar centro</h3>
        <div class="row filter-controls">
          <div class="filter-input-group"><label>Código (centro)</label><input id="admCentroCodigo" /></div>
          <div class="filter-input-group"><label>Nombre</label><input id="admCentroNombre" /></div>
        </div>
        <div class="row filter-controls" style="margin-top:8px;">
          <div class="filter-input-group"><label>Siglas</label><input id="admCentroSiglas" /></div>
          <div class="filter-input-group"><label>Sociedad</label><input id="admCentroSociedad" /></div>
        </div>
        <div class="row filter-controls" style="margin-top:8px;">
          <div class="filter-input-group"><label>Estado</label><input id="admCentroEstado" /></div>
          <div class="filter-input-group"><label>Municipio</label><input id="admCentroMunicipio" /></div>
        </div>
        <input id="admCentroDireccion" placeholder="Dirección corta (opcional)" style="margin-top:8px;" />
        <div class="row" style="margin-top:12px;"><button id="btnRegistrarCentro">Registrar</button></div>
        <div id="admCentroStatus" class="muted" style="margin-top:8px;"></div>
      </div>
      <div id="admCentrosLista" style="margin-top:16px;"></div>
    `;
    document.getElementById('btnRegistrarCentro').addEventListener('click', async () => {
      const status = document.getElementById('admCentroStatus');
      const body = {
        centro: document.getElementById('admCentroCodigo').value.trim(),
        nombre_centro: document.getElementById('admCentroNombre').value.trim(),
        siglas: document.getElementById('admCentroSiglas').value.trim(),
        sociedad: document.getElementById('admCentroSociedad').value.trim(),
        estado: document.getElementById('admCentroEstado').value.trim(),
        municipio: document.getElementById('admCentroMunicipio').value.trim(),
        direccion_corta: document.getElementById('admCentroDireccion').value.trim()
      };
      if (!body.centro || !body.nombre_centro) { status.textContent = 'Código y nombre son obligatorios.'; return; }
      status.textContent = 'Guardando...';
      const resp = await window.callBridgeInventario('registrarCentro', body);
      status.textContent = resp.ok ? 'Centro registrado.' : resp.error;
      if (resp.ok) cargarListaCentros();
    });
    cargarListaCentros();
  }

  async function cargarListaCentros() {
    const cont = document.getElementById('admCentrosLista');
    if (!cont) return;
    cont.innerHTML = '<p class="muted">Cargando...</p>';
    const resp = await window.callBridgeInventario('listarCentrosAdmin', {});
    if (!resp.ok) { cont.innerHTML = `<p class="muted">${resp.error}</p>`; return; }
    cont.innerHTML = `
      <div class="table-container"><table class="inventory-table">
        <thead><tr><th>Código</th><th>Nombre</th><th>Siglas</th><th>Sociedad</th></tr></thead>
        <tbody>${resp.centros.map(c => `<tr><td>${c.centro}</td><td>${c.nombre_centro}</td><td>${c.siglas || '—'}</td><td>${c.sociedad || '—'}</td></tr>`).join('')}</tbody>
      </table></div>
    `;
  }

  // ---------------------------------------------------------------------
  // ALMACENES
  // ---------------------------------------------------------------------
  const TIPOS_ALMACEN = ['principal','exhibición','dañado','servicio_técnico','insumos_sistema','activos_tienda','caja_herramientas','garantías','eventos','reserva','descuento','insumos','garantia_sistema'];

  async function iniciarAlmacenes(sub) {
    const centrosResp = await window.callBridgeInventario('listarCentrosAdmin', {});
    const opcionesCentro = (centrosResp.ok ? centrosResp.centros : []).map(c => `<option value="${c.centro}">${c.nombre_centro} (${c.centro})</option>`).join('');

    sub.innerHTML = `
      <div class="search-card">
        <h3>Registrar almacén</h3>
        <div class="row filter-controls">
          <div class="filter-input-group"><label>Centro</label><select id="admAlmCentro" class="custom-select">${opcionesCentro}</select></div>
          <div class="filter-input-group"><label>Tipo</label>
            <select id="admAlmTipo" class="custom-select">${TIPOS_ALMACEN.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
          </div>
        </div>
        <div class="row filter-controls" style="margin-top:8px;">
          <div class="filter-input-group"><label>Código de almacén</label><input id="admAlmCodigo" /></div>
        </div>
        <input id="admAlmObservacion" placeholder="Observación (opcional)" style="margin-top:8px;" />
        <div class="row" style="margin-top:12px;"><button id="btnRegistrarAlmacen">Registrar</button></div>
        <div id="admAlmStatus" class="muted" style="margin-top:8px;"></div>
      </div>
      <div id="admAlmacenesLista" style="margin-top:16px;"></div>
    `;
    document.getElementById('btnRegistrarAlmacen').addEventListener('click', async () => {
      const status = document.getElementById('admAlmStatus');
      const body = {
        centro: document.getElementById('admAlmCentro').value,
        tipo_almacen: document.getElementById('admAlmTipo').value,
        codigo_almacen: document.getElementById('admAlmCodigo').value.trim(),
        observacion: document.getElementById('admAlmObservacion').value.trim()
      };
      if (!body.codigo_almacen) { status.textContent = 'El código de almacén es obligatorio.'; return; }
      status.textContent = 'Guardando...';
      const resp = await window.callBridgeInventario('registrarAlmacen', body);
      status.textContent = resp.ok ? 'Almacén registrado.' : resp.error;
      if (resp.ok) cargarListaAlmacenes();
    });
    cargarListaAlmacenes();
  }

  async function cargarListaAlmacenes() {
    const cont = document.getElementById('admAlmacenesLista');
    if (!cont) return;
    cont.innerHTML = '<p class="muted">Cargando...</p>';
    const resp = await window.callBridgeInventario('listarAlmacenesAdmin', {});
    if (!resp.ok) { cont.innerHTML = `<p class="muted">${resp.error}</p>`; return; }
    cont.innerHTML = `
      <div class="table-container"><table class="inventory-table">
        <thead><tr><th>Centro</th><th>Tipo</th><th>Código</th><th>Estatus</th></tr></thead>
        <tbody>${resp.almacenes.map(a => `<tr><td>${a.centro}</td><td>${a.tipo_almacen}</td><td>${a.codigo_almacen}</td><td>${a.estatus ? 'Activo' : 'Inactivo'}</td></tr>`).join('')}</tbody>
      </table></div>
    `;
  }

  // ---------------------------------------------------------------------
  // PERSONAS
  // ---------------------------------------------------------------------
  async function iniciarPersonas(sub) {
    sub.innerHTML = `
      <div class="search-card">
        <h3>Registrar persona</h3>
        <div class="row filter-controls">
          <div class="filter-input-group"><label>Nombre</label><input id="admPersNombre" /></div>
          <div class="filter-input-group"><label>Apellido</label><input id="admPersApellido" /></div>
        </div>
        <div class="row filter-controls" style="margin-top:8px;">
          <div class="filter-input-group"><label>Email</label><input id="admPersEmail" type="email" /></div>
          <div class="filter-input-group"><label>Teléfono</label><input id="admPersTelefono" /></div>
        </div>
        <input id="admPersCargo" placeholder="Cargo (opcional)" style="margin-top:8px;" />
        <div class="row" style="margin-top:12px;"><button id="btnRegistrarPersona">Registrar</button></div>
        <div id="admPersStatus" class="muted" style="margin-top:8px;"></div>
      </div>
      <div class="search-card" style="margin-top:16px;">
        <label>Buscar persona</label>
        <input id="admPersBuscar" placeholder="Nombre, apellido o email..." />
      </div>
      <div id="admPersonasLista" style="margin-top:16px;"></div>
    `;
    document.getElementById('btnRegistrarPersona').addEventListener('click', async () => {
      const status = document.getElementById('admPersStatus');
      const body = {
        nombre: document.getElementById('admPersNombre').value.trim(),
        apellido: document.getElementById('admPersApellido').value.trim(),
        email: document.getElementById('admPersEmail').value.trim(),
        telefono: document.getElementById('admPersTelefono').value.trim(),
        cargo: document.getElementById('admPersCargo').value.trim()
      };
      if (!body.nombre || !body.apellido) { status.textContent = 'Nombre y apellido son obligatorios.'; return; }
      status.textContent = 'Guardando...';
      const resp = await window.callBridgeInventario('registrarPersona', body);
      status.textContent = resp.ok ? 'Persona registrada.' : resp.error;
      if (resp.ok) cargarListaPersonas('');
    });
    let temporizador;
    document.getElementById('admPersBuscar').addEventListener('input', (e) => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => cargarListaPersonas(e.target.value.trim()), 350);
    });
    cargarListaPersonas('');
  }

  async function cargarListaPersonas(busqueda) {
    const cont = document.getElementById('admPersonasLista');
    if (!cont) return;
    cont.innerHTML = '<p class="muted">Cargando...</p>';
    const resp = await window.callBridgeInventario('listarPersonas', { busqueda });
    if (!resp.ok) { cont.innerHTML = `<p class="muted">${resp.error}</p>`; return; }
    cont.innerHTML = `
      <div class="table-container"><table class="inventory-table">
        <thead><tr><th>Nombre</th><th>Email</th></tr></thead>
        <tbody>${resp.personas.map(p => `<tr><td>${p.nombre} ${p.apellido}</td><td>${p.email || '—'}</td></tr>`).join('')}</tbody>
      </table></div>
    `;
  }

  // ---------------------------------------------------------------------
  // ANALISTAS (asignar / cambiar centro)
  // ---------------------------------------------------------------------
  async function iniciarAnalistas(sub) {
    const [personasResp, centrosResp] = await Promise.all([
      window.callBridgeInventario('listarPersonas', {}),
      window.callBridgeInventario('listarCentrosAdmin', {})
    ]);
    const opcionesPersona = (personasResp.ok ? personasResp.personas : []).map(p => `<option value="${p.id_persona}">${p.nombre} ${p.apellido} (${p.email || 'sin email'})</option>`).join('');
    const opcionesCentro = (centrosResp.ok ? centrosResp.centros : []).map(c => `<option value="${c.centro}">${c.nombre_centro} (${c.centro})</option>`).join('');

    sub.innerHTML = `
      <div class="search-card">
        <h3>Asignar / cambiar centro de un analista</h3>
        <p class="muted">La persona debe tener ya el rol "analista" asignado en la pestaña Usuarios.</p>
        <div class="row filter-controls">
          <div class="filter-input-group"><label>Persona</label><select id="admAnaPersona" class="custom-select">${opcionesPersona}</select></div>
          <div class="filter-input-group"><label>Centro</label><select id="admAnaCentro" class="custom-select">${opcionesCentro}</select></div>
        </div>
        <div class="row" style="margin-top:12px;"><button id="btnAsignarAnalista">Asignar</button></div>
        <div id="admAnaStatus" class="muted" style="margin-top:8px;"></div>
      </div>
      <div id="admAnalistasLista" style="margin-top:16px;"></div>
    `;
    document.getElementById('btnAsignarAnalista').addEventListener('click', async () => {
      const status = document.getElementById('admAnaStatus');
      const body = { id_persona: document.getElementById('admAnaPersona').value, centro: document.getElementById('admAnaCentro').value };
      status.textContent = 'Guardando...';
      const resp = await window.callBridgeInventario('asignarCentroAnalista', body);
      status.textContent = resp.ok ? 'Asignado correctamente.' : resp.error;
      if (resp.ok) cargarListaAnalistas();
    });
    cargarListaAnalistas();
  }

  async function cargarListaAnalistas() {
    const cont = document.getElementById('admAnalistasLista');
    if (!cont) return;
    cont.innerHTML = '<p class="muted">Cargando...</p>';
    const resp = await window.callBridgeInventario('listarAnalistasAdmin', {});
    if (!resp.ok) { cont.innerHTML = `<p class="muted">${resp.error}</p>`; return; }
    cont.innerHTML = `
      <div class="table-container"><table class="inventory-table">
        <thead><tr><th>Nombre</th><th>Centro asignado</th></tr></thead>
        <tbody>${resp.analistas.map(a => `<tr><td>${a.nombre} ${a.apellido}</td><td>${a.tienda_asignada || '—'}</td></tr>`).join('')}</tbody>
      </table></div>
    `;
  }

  // ---------------------------------------------------------------------
  // SUPERVISORES (asignar tiendas)
  // ---------------------------------------------------------------------
  async function iniciarSupervisores(sub) {
    const [personasResp, centrosResp] = await Promise.all([
      window.callBridgeInventario('listarPersonas', {}),
      window.callBridgeInventario('listarCentrosAdmin', {})
    ]);
    const opcionesPersona = (personasResp.ok ? personasResp.personas : []).map(p => `<option value="${p.id_persona}">${p.nombre} ${p.apellido} (${p.email || 'sin email'})</option>`).join('');
    const centros = centrosResp.ok ? centrosResp.centros : [];

    sub.innerHTML = `
      <div class="search-card">
        <h3>Asignar tiendas a un supervisor</h3>
        <p class="muted">La persona debe tener ya el rol "supervisor" asignado en la pestaña Usuarios.</p>
        <label>Persona</label>
        <select id="admSupPersona" class="custom-select">${opcionesPersona}</select>
        <label style="margin-top:10px;display:block;">Centros a asignar</label>
        <div class="lista-valores" style="max-height:220px;overflow-y:auto;border:1px solid rgba(100,116,139,0.25);border-radius:8px;padding:8px;">
          ${centros.map(c => `<label style="display:flex;align-items:center;gap:8px;margin:4px 0;font-weight:400;"><input type="checkbox" value="${c.centro}" style="width:auto;"/> ${c.nombre_centro} (${c.centro})</label>`).join('')}
        </div>
        <div class="row" style="margin-top:12px;"><button id="btnAsignarSupervisor">Asignar</button></div>
        <div id="admSupStatus" class="muted" style="margin-top:8px;"></div>
      </div>
      <div id="admSupervisoresLista" style="margin-top:16px;"></div>
    `;
    document.getElementById('btnAsignarSupervisor').addEventListener('click', async () => {
      const status = document.getElementById('admSupStatus');
      const seleccionados = Array.from(sub.querySelectorAll('.lista-valores input[type="checkbox"]:checked')).map(cb => cb.value);
      if (!seleccionados.length) { status.textContent = 'Selecciona al menos un centro.'; return; }
      status.textContent = 'Guardando...';
      const resp = await window.callBridgeInventario('asignarTiendasSupervisor', {
        id_persona: document.getElementById('admSupPersona').value,
        centros: seleccionados
      });
      status.textContent = resp.ok ? 'Asignado correctamente.' : resp.error;
      if (resp.ok) cargarListaSupervisores();
    });
    cargarListaSupervisores();
  }

  async function cargarListaSupervisores() {
    const cont = document.getElementById('admSupervisoresLista');
    if (!cont) return;
    cont.innerHTML = '<p class="muted">Cargando...</p>';
    const resp = await window.callBridgeInventario('listarSupervisoresAdmin', {});
    if (!resp.ok) { cont.innerHTML = `<p class="muted">${resp.error}</p>`; return; }
    cont.innerHTML = `
      <div class="table-container"><table class="inventory-table">
        <thead><tr><th>Nombre</th><th>Centros asignados</th></tr></thead>
        <tbody>${resp.supervisores.map(s => `<tr><td>${s.nombre} ${s.apellido}</td><td>${(s.tiendas_asignadas || []).join(', ') || '—'}</td></tr>`).join('')}</tbody>
      </table></div>
    `;
  }

  // ---------------------------------------------------------------------
  // USUARIOS (asignar rol del sistema) — solo administrador
  // ---------------------------------------------------------------------
  async function iniciarUsuarios(sub) {
    const personasResp = await window.callBridgeInventario('listarPersonas', {});
    const opcionesPersona = (personasResp.ok ? personasResp.personas : []).map(p => `<option value="${p.id_persona}">${p.nombre} ${p.apellido} (${p.email || 'sin email'})</option>`).join('');

    sub.innerHTML = `
      <div class="search-card">
        <h3>Asignar rol del sistema</h3>
        <div class="row filter-controls">
          <div class="filter-input-group"><label>Persona</label><select id="admUsuPersona" class="custom-select">${opcionesPersona}</select></div>
          <div class="filter-input-group"><label>Rol</label>
            <select id="admUsuRol" class="custom-select">
              <option value="analista">Analista</option>
              <option value="supervisor">Supervisor</option>
              <option value="coordinador">Coordinador</option>
              <option value="administrador">Administrador</option>
            </select>
          </div>
        </div>
        <div class="row" style="margin-top:12px;"><button id="btnAsignarRol">Asignar rol</button></div>
        <div id="admUsuStatus" class="muted" style="margin-top:8px;"></div>
      </div>
      <div id="admUsuariosLista" style="margin-top:16px;"></div>
    `;
    document.getElementById('btnAsignarRol').addEventListener('click', async () => {
      const status = document.getElementById('admUsuStatus');
      status.textContent = 'Guardando...';
      const resp = await window.callBridgeInventario('asignarRolUsuario', {
        id_persona: document.getElementById('admUsuPersona').value,
        rol: document.getElementById('admUsuRol').value
      });
      status.textContent = resp.ok ? 'Rol asignado.' : resp.error;
      if (resp.ok) cargarListaUsuarios();
    });
    cargarListaUsuarios();
  }

  async function cargarListaUsuarios() {
    const cont = document.getElementById('admUsuariosLista');
    if (!cont) return;
    cont.innerHTML = '<p class="muted">Cargando...</p>';
    const resp = await window.callBridgeInventario('listarUsuariosSistema', {});
    if (!resp.ok) { cont.innerHTML = `<p class="muted">${resp.error}</p>`; return; }
    cont.innerHTML = `
      <div class="table-container"><table class="inventory-table">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Activo</th></tr></thead>
        <tbody>${resp.usuarios.map(u => `<tr><td>${u.nombre}</td><td>${u.email || '—'}</td><td>${u.rol}</td><td>${u.status ? 'Sí' : 'No'}</td></tr>`).join('')}</tbody>
      </table></div>
    `;
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
