/* ====== CONFIG ====== */
const API_URL = 'https://script.google.com/macros/s/AKfycbzGoWmn4doU1_vDqQvWYbqg4WzW8WD6y64lI96xKYn_bGd-L1THgt3HVJJl_BprqpysTA/exec';

// Kacosa App: Consultas ahora busca en la MISMA fuente que usa el Dashboard
// de Resumen de Inventarios (Maestro_Conteo_Completo + Tiendas_Upi +
// Grupo_Pepetodo), en vez de la hoja "Inventario" aparte que usaba antes.
// Todo lo demás de este archivo (subir imágenes, noticias, documentos) sigue
// usando API_URL normal, sin cambios.
const DASHBOARD_API_URL = 'https://script.google.com/macros/s/AKfycbz44oS6IUyYcoHamu-b8UizNWElrOTFeOZQ3IcnnVHdr79FlGnYU4xBB5Z7zRNjfgca/exec';

// Este proyecto ahora es el mismo que usa el Portal KACOSA (sesión compartida:
// si el usuario ya inició sesión en el portal, entra aquí directo sin volver a loguearse)
const firebaseConfig = {
    apiKey: "AIzaSyAeXFRdPZsEKX5vcTgGQ5hIOAlJyVv92kQ",
    authDomain: "portal-kacosa.firebaseapp.com",
    projectId: "portal-kacosa",
    storageBucket: "portal-kacosa.firebasestorage.app",
    messagingSenderId: "350653710617",
    appId: "1:350653710617:web:d29f757730e4515ec3c588"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Roles que tienen acceso a esta app (Información Logística)
// Nota: este mismo módulo sirve tanto "Inventario" (Trazabilidad/Consultas)
// como "Reportes" (Noticias/Imágenes/Documentos) en el portal. "abastecimiento"
// se agregó para que pueda entrar a Reportes; el menú del shell (js/shell.js)
// sigue ocultándole Trazabilidad/Consultas, aunque técnicamente podría llegar
// a esas secciones si escribe la URL a mano.
const ROLES_PERMITIDOS = ["admin", "supervisor", "directiva", "gerente", "abastecimiento","coordinador","analista"];

// Revisa si el correo está dado de alta en el portal y con un rol permitido para esta app,
// y devuelve además el perfil completo (rol + tiendas asignadas) para poder aplicar el
// filtro de tienda de los gerentes en "Consultas" (ver aplicarFiltroTiendaGerente más abajo).
async function obtenerPerfilInventario(email) {
    try {
        const snap = await db.collection("usuarios").doc(email.toLowerCase()).get();
        if (!snap.exists) return { autorizado: false, perfil: null };
        const perfil = snap.data();
        return { autorizado: ROLES_PERMITIDOS.includes(perfil.rol), perfil };
    } catch (e) {
        console.error("Error verificando acceso:", e);
        return { autorizado: false, perfil: null };
    }
}

// Mapa de ID de tienda (como se guarda en el campo "tiendas" del portal, ej. "UPI_MERCADERES")
// al texto exacto que usa el <select id="filterCenter"> de Consultas (ej. "Upi Mercaderes").
// Debe reflejar el mismo catálogo que usa el módulo de Abastecimiento (js/tiendas.js).
const NOMBRE_TIENDA_POR_ID = {
    UPI_VALENCIA: "Upi Valencia",
    UPI_LOS_GUAYOS: "Upi Los Guayos",
    UPI_CASTILLO: "Upi Castillo",
    UPI_MARACAY: "Upi Maracay",
    UPI_PUERTO_CABELLO: "Upi Puerto Cabello",
    UPI_CORO: "Upi Coro",
    UPI_MERCADERES: "Upi Mercaderes",
    UPI_ROSAL: "Upi Rosal",
    GIGANTE: "Gigante",
    GIGANTE_2: "Gigante 2",
    COMERCIAL_SALVADOR: "Comercial Salvador",
    PRODUCTOS_KHALED: "Productos Khaled",
    FERRETOOLS: "Ferretools",
    KACOSA: "Kacosa"
};

// Kacosa App: un usuario con rol "gerente" solo debe ver, en el selector de
// Consultas, la(s) tienda(s) que tiene asignada(s) en el portal (mismo criterio
// que ya aplica el módulo de Abastecimiento en js/nav.js). El resto de roles
// permitidos siguen viendo el listado completo, sin cambios.
function aplicarFiltroTiendaGerente(perfil) {
    const filterCenter = document.getElementById('filterCenter');
    if (!filterCenter) return;

    const rol = (perfil?.rol || '').toString().trim().toLowerCase();
    if (rol !== 'gerente') return; // otros roles ven todas las tiendas, tal como antes

    const tiendasAsignadas = Array.isArray(perfil?.tiendas)
        ? perfil.tiendas.map(t => (t || '').toString().trim()).filter(Boolean)
        : [];
    const nombresAsignados = tiendasAsignadas
        .map(id => NOMBRE_TIENDA_POR_ID[id])
        .filter(Boolean);

    if (nombresAsignados.length === 0) {
        console.warn('El usuario gerente no tiene tiendas asignadas en el portal (campo "tiendas" en Firestore); se deja el selector sin cambios por seguridad.');
        return;
    }

    // Elimina "Todas las tiendas" y cualquier tienda que no sea la(s) suya(s)
    Array.from(filterCenter.options).forEach(opt => {
        if (opt.value === '' || !nombresAsignados.includes(opt.value)) {
            opt.remove();
        }
    });

    // Deja su tienda (o la primera, si tiene varias) seleccionada por defecto
    filterCenter.value = nombresAsignados[0];
}

// Variables globales
let currentInventoryResults = [];
let allNewsData = [];
// ====== LOADER GLOBAL ======
function showLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) loader.classList.remove('hidden');
}

function hideLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) loader.classList.add('hidden');
}

// Mostrar loader al cargar la página
document.addEventListener('DOMContentLoaded', function() {
    showLoader();
    
    // Ocultar loader cuando todo esté listo
    window.addEventListener('load', function() {
        setTimeout(hideLoader, 1500); // Pequeño delay para mejor UX
    });
    
    // Inicializar la app
    initializeApp();
});

// También ocultar loader si hay error
window.addEventListener('error', function() {
    setTimeout(hideLoader, 1500);
});

function initializeApp() {
/* ====== FUNCIÓN PARA ALERTAS PERSONALIZADAS - MODAL STYLE ====== */
function showAlert(message, type = 'info', duration = 0) {
    // NO mostrar alertas personalizadas en la sección de login/auth
    const authScreen = document.getElementById('authScreen');
    if (authScreen && !authScreen.classList.contains('hidden')) {
        // Usar alert normal para el login
        alert(message);
        return;
    }
    
    // Crear overlay y modal
    const overlay = document.createElement('div');
    overlay.className = 'alert-overlay';
    
    const modal = document.createElement('div');
    modal.className = `alert-modal alert-${type}`;
    
    // Iconos para cada tipo
    const icons = {
        'success': '✓',
        'error': '✕',
        'warning': '⚠',
        'info': 'ℹ'
    };
    
    modal.innerHTML = `
        <div class="alert-icon">${icons[type] || icons.info}</div>
        <div class="alert-content">
            <div class="alert-title">${getAlertTitle(type)}</div>
            <div class="alert-message">${message}</div>
        </div>
        <div class="alert-actions">
            <button class="alert-btn alert-btn-primary" id="alertAcceptBtn">Aceptar</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Configurar botón de aceptar
    const acceptBtn = document.getElementById('alertAcceptBtn');
    const closeAlert = () => {
        modal.classList.add('closing');
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.remove();
            }
        }, 300);
    };
    
    acceptBtn.addEventListener('click', closeAlert);
    
    // Cerrar al hacer clic fuera del modal
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeAlert();
        }
    });
    
    // Cerrar con tecla Escape
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeAlert();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
    
    // Auto-cierre si se especifica duración (COMENTADO PARA QUE NO SE CIERRE SOLO)
    if (duration > 0) {
        setTimeout(closeAlert, duration);
    }
}

// Función helper para títulos
function getAlertTitle(type) {
    const titles = {
        'success': 'Éxito',
        'error': 'Error',
        'warning': 'Advertencia',
        'info': 'Información'
    };
    return titles[type] || 'Información';
}
    /* ====== Helpers ====== */
    function getDriveDirectUrl(url) {
        if (!url) return '';
        try {
            if (url.includes('uc?export=view') || url.includes('=export')) return url;
            
            let fileId = '';
            const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/); 
            const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/); 

            if (m1 && m1[1]) {
                fileId = m1[1];
            } else if (m2 && m2[1]) {
                fileId = m2[1];
            }
            
            if (fileId) {
                 return `https://drive.google.com/uc?export=view&id=${fileId}`; 
            }
            return url;
        } catch (e) { return url; }
    }

    function getDriveThumbnailUrl(url, size = 300) {
        if (!url) return '';
        
        let fileId = '';
        const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);

        if (m1 && m1[1]) {
            fileId = m1[1];
        } else if (m2 && m2[1]) {
            fileId = m2[1];
        }
        
        if (!fileId && url.includes('uc?export=view')) {
               const m3 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
               if (m3 && m3[1]) fileId = m3[1];
        }

        if (fileId) {
               return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`; 
        }

        return url;
    }

    function safeString(v){return v === undefined || v === null ? '' : String(v); }

    function getField(obj, ...keys) {
        for (const k of keys) {
            if (obj[k] !== undefined && obj[k] !== null) return obj[k];
        }
        const lowerMap = {};
        for (const p in obj) lowerMap[p.toLowerCase().replace(/[\s_]+/g, '')] = obj[p];
        for (const k of keys) {
            const low = k.toLowerCase().replace(/[\s_]+/g, ''); 
            if (lowerMap[low] !== undefined) return lowerMap[low];
        }
        return '';
    }

    /* ====== AUTH ====== */
    document.getElementById('togglePasswordBtn').addEventListener('click', function() {
        const passwordInput = document.getElementById('password');
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        this.textContent = type === 'password' ? '👁️' : '🔒'; 
    });

    auth.onAuthStateChanged(async user => {
        if (user) {
            const { autorizado, perfil } = await obtenerPerfilInventario(user.email);
            if (!autorizado) {
                // No se cierra sesión: es compartida con el portal y las demás apps de KACOSA.
                document.getElementById('authScreen').classList.remove('hidden');
                document.getElementById('mainApp').classList.add('hidden');
                showAlert('Tu cuenta no tiene acceso a este módulo. Contacta al administrador.', 'error', 6000);
                return;
            }
            document.getElementById('authScreen').classList.add('hidden');
            document.getElementById('mainApp').classList.remove('hidden');
            document.getElementById('userEmail').textContent = user.email || user.displayName || '';
            aplicarFiltroTiendaGerente(perfil);
            loadNews();
            listUploads('documents');
        } else {
            document.getElementById('authScreen').classList.remove('hidden');
            document.getElementById('mainApp').classList.add('hidden');
        }
    });

    document.getElementById('btnLogin').addEventListener('click', async () => {
        const email = document.getElementById('email').value.trim();
        const pass = document.getElementById('password').value;
        try { 
            await auth.signInWithEmailAndPassword(email, pass); 
        } catch (err) { 
            showAlert(err.message, 'error', 5000);
        }
    });

    document.getElementById('btnGoogle').addEventListener('click', async () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await auth.signInWithPopup(provider);
        } catch (err) { 
            showAlert(err.message, 'error', 5000);
        }
    });

    document.getElementById('btnLogout').addEventListener('click', () => auth.signOut());

    /* ====== API Helpers ====== */
    async function getApi(action, params = {}) {
        const q = new URLSearchParams(Object.assign({ action }, params)).toString();
        const res = await fetch(API_URL + '?' + q);
        return res.json();
    }

    async function callApi(action, payload = {}) {
        const isNoCors = (action === 'uploadFile' || action === 'addNews' || action === 'registerUser'); 
        const body = JSON.stringify(Object.assign({ action }, payload));
        if (isNoCors) {
            await fetch(API_URL, { method: 'POST', body, mode: 'no-cors' }); 
            return { ok: true, opaque: true };
        } else {
            const res = await fetch(API_URL, {
                method:'POST',
                headers: { 'Content-Type': 'application/json' },
                body
            });
            return res.json();
        }
    }


/* ====== INVENTARIO ====== */
// Kacosa App: estado de orden de la tabla de resultados — se controla desde
// los encabezados (clic para ordenar asc/desc por esa columna).
let ordenActual = { columna: null, asc: true };

const COLUMNAS_RESULTADOS = [
    { key: 'codigo', label: 'Código' },
    { key: 'descripcion', label: 'Descripción' },
    { key: 'um', label: 'UM' },
    { key: 'ubicacionGeneral', label: 'Ubicación General' },
    { key: 'conteoGeneral', label: 'Conteo General', numerica: true },
    { key: 'ubicacionExhibicion', label: 'Ubicación Exhibición' },
    { key: 'conteoExhibicion', label: 'Conteo Exhibición', numerica: true },
    { key: 'fechaUltimoConteo', label: 'Fecha Último Conteo' },
    { key: 'ultimoAuditor', label: 'Auditor' },
    { key: 'difGeneral', label: 'DIF General', numerica: true },
    { key: 'difExhibicion', label: 'DIF Exhibición', numerica: true },
    { key: 'centro', label: 'Centro' },
    { key: 'documento', label: 'Documento' },
];

function valorColumna(r, key) {
    switch (key) {
        case 'codigo': return safeString(getField(r, 'codigo', 'Código', 'code'));
        case 'descripcion': return safeString(getField(r, 'descripcion', 'Descripción', 'description'));
        case 'um': return safeString(getField(r, 'um', 'UM'));
        case 'ubicacionGeneral': return safeString(getField(r, 'ubicacionGeneral', 'ubicacionFisicaGeneral', 'ubicacion'));
        case 'conteoGeneral': return safeString(getField(r, 'conteoGeneral', 'cantidad', 'Cant'));
        case 'ubicacionExhibicion': return safeString(getField(r, 'ubicacionExhibicion', 'ubicacionExhib', 'ubicacion exhib'));
        case 'conteoExhibicion': return safeString(getField(r, 'conteoExhibicion', 'conteoExhb', 'conteo exhb'));
        case 'fechaUltimoConteo': return safeString(getField(r, 'fechaUltimoConteo', 'fecha'));
        case 'ultimoAuditor': {
            // Cuando un material se contó en más de un almacén de la misma tienda
            // (ej. Ubicación General por un analista y Ubicación Exhibición por
            // otro), se muestran ambos nombres en vez de descartar uno. El backend
            // (acción "buscar_material") ya manda los campos "auditorGeneral" y
            // "auditorExhibicion" por separado (además de "ultimoAuditor", que se
            // deja como respaldo por si vinieran de una fuente más vieja).
            const principal = safeString(getField(r, 'auditorGeneral', 'ultimoAuditor', 'auditor', 'ultimoAuditorGeneral'));
            const secundario = safeString(getField(r, 'auditorExhibicion', 'ultimoAuditorExhibicion', 'auditorExhib', 'segundoAuditor', 'ultimoAuditor2'));
            if (secundario && secundario.trim().toLowerCase() !== principal.trim().toLowerCase()) {
                return [principal, secundario].filter(Boolean).join(' / ');
            }
            return principal || secundario;
        }
        case 'difGeneral': return safeString(getField(r, 'difGeneral', 'dif_general'));
        case 'difExhibicion': return safeString(getField(r, 'difExhibicion', 'difExhib', 'dif_exhib'));
        case 'centro': return safeString(getField(r, 'Centro_Inventario', 'centro', 'centroinventario'));
        case 'documento': return safeString(getField(r, 'Nombre_Documento', 'documento', 'nombredocumento'));
        default: return '';
    }
}

// La tienda "Kacosa" (casa matriz) a veces llega desde el origen de datos
// identificada como "Casa Matriz / CD", "Matriz", etc. en vez de "Kacosa"
// literal (así aparece, por ejemplo, en el dashboard de resumen). Por eso,
// al filtrar por "Kacosa" también se reconocen esas variantes; de lo
// contrario sus materiales no aparecían nunca en Consultas.
function coincideCentro(centroValor, filtroSeleccionado) {
    const centro = (centroValor || '').toString().toLowerCase();
    const filtro = (filtroSeleccionado || '').toString().trim().toLowerCase();
    if (!filtro) return true;
    if (filtro === 'kacosa') return centro.includes('kacosa') || centro.includes('matriz');
    return centro.includes(filtro);
}

function renderInventoryResults() {
    const out = document.getElementById('searchResults');
    const centroFilter = (document.getElementById('filterCenter')?.value || '').trim().toLowerCase();

    let filtered = centroFilter
        ? currentInventoryResults.filter(r => coincideCentro(valorColumna(r, 'centro'), centroFilter))
        : currentInventoryResults;

    if (!filtered.length) {
        out.innerHTML = '<div class="no-results">🔍 Sin resultados para este filtro</div>';
        return;
    }

    if (ordenActual.columna) {
        const col = COLUMNAS_RESULTADOS.find(c => c.key === ordenActual.columna);
        filtered = [...filtered].sort((a, b) => {
            let va = valorColumna(a, ordenActual.columna);
            let vb = valorColumna(b, ordenActual.columna);
            if (col && col.numerica) {
                va = parseFloat(va.replace(',', '.')) || 0;
                vb = parseFloat(vb.replace(',', '.')) || 0;
                return ordenActual.asc ? va - vb : vb - va;
            }
            return ordenActual.asc ? va.localeCompare(vb, 'es') : vb.localeCompare(va, 'es');
        });
    }

    const encabezados = COLUMNAS_RESULTADOS.map(c => {
        const activa = ordenActual.columna === c.key;
        const flecha = activa ? (ordenActual.asc ? ' ▲' : ' ▼') : '';
        return `<th data-col="${c.key}" class="th-ordenable${activa ? ' th-activa' : ''}">${c.label}${flecha}</th>`;
    }).join('');

    const rows = filtered.map(r => {
        const codigo = valorColumna(r, 'codigo');
        const descripcion = valorColumna(r, 'descripcion');
        const um = valorColumna(r, 'um');
        const ubicG = valorColumna(r, 'ubicacionGeneral');
        const conteoG = valorColumna(r, 'conteoGeneral');
        const ubicE = valorColumna(r, 'ubicacionExhibicion');
        const conteoE = valorColumna(r, 'conteoExhibicion');
        const fechaUlt = valorColumna(r, 'fechaUltimoConteo');
        const auditor = valorColumna(r, 'ultimoAuditor');
        const difG = valorColumna(r, 'difGeneral');
        const difE = valorColumna(r, 'difExhibicion');
        const centro = valorColumna(r, 'centro');
        const nombreDoc = valorColumna(r, 'documento');

        const claseDifG = difG.startsWith('-') ? 'class="negative-diff"' : (difG && difG !== '0' ? 'class="positive-diff"' : '');
        const claseDifE = difE.startsWith('-') ? 'class="negative-diff"' : (difE && difE !== '0' ? 'class="positive-diff"' : '');

        return `<tr>
            <td>${codigo}</td>
            <td>${descripcion}</td>
            <td>${um}</td>
            <td>${ubicG}</td>
            <td>${conteoG}</td>
            <td>${ubicE}</td>
            <td>${conteoE}</td>
            <td>${fechaUlt}</td>
            <td>${auditor}</td>
            <td ${claseDifG}>${difG}</td>
            <td ${claseDifE}>${difE}</td>
            <td>${centro}</td>
            <td>${nombreDoc}</td>
        </tr>`;
    }).join('');

    out.innerHTML = `<div class="table-container">
    <div class="results-table-container">
        <table class="inventory-table">
            <thead>
                <tr>${encabezados}</tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    </div>
</div>`;

    out.querySelectorAll('.th-ordenable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (ordenActual.columna === col) {
                ordenActual.asc = !ordenActual.asc;
            } else {
                ordenActual = { columna: col, asc: true };
            }
            renderInventoryResults();
        });
    });
}

const btnSearch = document.getElementById('btnSearch');
const searchCodeInput2 = document.getElementById('searchCode');
const btnLimpiarBusqueda = document.getElementById('btnLimpiarBusqueda');

btnSearch.addEventListener('click', async () => {
    const code = searchCodeInput2.value.trim();
    if (!code) {
        showAlert('Ingrese un código.', 'warning');
        return;
    }

    // Bloquea el botón para evitar búsquedas repetidas mientras carga; se
    // vuelve a habilitar solo cuando el usuario cambia el código (ver más abajo).
    btnSearch.disabled = true;
    btnSearch.textContent = 'Buscando…';

    document.getElementById('searchResults').innerHTML = '<div class="loading-results">🔍 Buscando en el inventario...</div>';

    // Kacosa App: búsqueda contra la fuente del Dashboard (acción "buscar_material"),
    // no contra el API_URL antiguo de este módulo.
    let data;
    try {
        const q = new URLSearchParams({ action: 'buscar_material', codigo: code }).toString();
        const res = await fetch(DASHBOARD_API_URL + '?' + q);
        data = await res.json();
    } catch (err) {
        console.error('Error buscando material:', err);
        document.getElementById('searchResults').innerHTML = '<div class="no-results">⚠️ No se pudo completar la búsqueda. Intenta de nuevo.</div>';
        btnSearch.disabled = false;
        btnSearch.textContent = 'Buscar';
        return;
    }

    ordenActual = { columna: null, asc: true }; // cada búsqueda nueva arranca sin orden aplicado

    if (data && data.resultados && data.resultados.length) {
        currentInventoryResults = data.resultados;
        renderInventoryResults();
    } else {
        currentInventoryResults = [];
        document.getElementById('searchResults').innerHTML = '<div class="no-results">🔍 Sin resultados</div>';
    }
});

// El botón "Buscar" se queda bloqueado (para no repetir la misma búsqueda
// mientras carga) hasta que el usuario vuelva a tocar el campo de código.
searchCodeInput2.addEventListener('input', () => {
    btnSearch.disabled = false;
    btnSearch.textContent = 'Buscar';
});

btnLimpiarBusqueda.addEventListener('click', () => {
    searchCodeInput2.value = '';
    document.getElementById('filterCenter').value = '';
    currentInventoryResults = [];
    ordenActual = { columna: null, asc: true };
    document.getElementById('searchResults').innerHTML = '';
    btnSearch.disabled = false;
    btnSearch.textContent = 'Buscar';
    searchCodeInput2.focus();
});

document.getElementById('searchCode').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        document.getElementById('btnSearch').click();
    }
});

// Filtro automático al cambiar selección del centro
document.getElementById('filterCenter').addEventListener('change', function() {
    if (currentInventoryResults.length > 0) {
        renderInventoryResults();
    }
});
    /* ====== UPLOAD ====== */
    async function uploadFile(file, filenameOpt) {
        const base64 = await new Promise(res => {
            const r = new FileReader();
            r.onload = e => res(e.target.result.split(',')[1]);
            r.readAsDataURL(file);
        });
        const uploaderName = auth.currentUser?.displayName || ""; 
        const uploaderEmail = auth.currentUser?.email || "";
        return callApi('uploadFile', {
            filename: filenameOpt || file.name,
            mimeType: file.type,
            base64,
            nombreDeUsuario: uploaderName, 
            uploaderEmail 
        });
    }

    document.getElementById('btnUploadDoc').addEventListener('click', async () => {
        const f = document.getElementById('docFile');
        const name = document.getElementById('docName').value.trim();
        if (!f.files.length) {
            showAlert('Selecciona un archivo', 'warning');
            return;
        }
        if (!name) {
            showAlert('El nombre del documento es obligatorio', 'warning');
            return;
        }
        document.getElementById('docStatus').textContent = 'Subiendo...';
        try {
            await uploadFile(f.files[0], name);
            document.getElementById('docStatus').textContent = 'Documento subido. Recargando lista...';
            await listUploads('documents');
            document.getElementById('docStatus').textContent = 'Subido: ' + name;
            document.getElementById('docFile').value = '';
            document.getElementById('docName').value = '';
        } catch (e) {
            document.getElementById('docStatus').textContent = 'Error al subir';
            console.error(e);
        }
    });

    document.getElementById('btnUploadImg').addEventListener('click', async () => {
        const f = document.getElementById('imgFile');
        const name = document.getElementById('imgName').value.trim();
        if (!f.files.length) {
            showAlert('Selecciona una imagen', 'warning');
            return;
        }
        if (!name) {
            showAlert('El nombre de la imagen es obligatorio', 'warning');
            return;
        }
        document.getElementById('imgStatus').textContent = 'Subiendo...';
        try {
            await uploadFile(f.files[0], name);
            document.getElementById('imgStatus').textContent = 'Imagen subida. Recargando lista...';
            await listUploads('images');
            document.getElementById('imgStatus').textContent = 'Subido: ' + name;
            document.getElementById('imgFile').value = '';
            document.getElementById('imgName').value = '';
        } catch (e) {
            document.getElementById('imgStatus').textContent = 'Error al subir';
            console.error(e);
        }
    });

    /* ====== FILTROS ====== */
    function resetAllFilters(section) {
        if (section === 'documents') {
            document.getElementById('filterNameDoc').value = '';
            document.getElementById('filterEmailDoc').value = '';
            document.getElementById('filterDateDoc').value = '';
            document.getElementById('filterFileNameDoc').value = '';
            listUploads('documents', false, '', true);
        } else if (section === 'images') {
            document.getElementById('filterNameImg').value = '';
            document.getElementById('filterEmailImg').value = '';
            document.getElementById('filterDateImg').value = '';
            document.getElementById('filterFileNameImg').value = '';
            listUploads('images', false, '', true);
        } else if (section === 'news') {
            document.getElementById('filterNewsTitle').value = '';
            document.getElementById('filterNewsDate').value = '';
            renderNews(allNewsData);
        }
    }

    function resetFilter(targetId, section) {
        document.getElementById(targetId).value = '';
        listUploads(section, false, '', true);
    }

    // Listeners para filtros de documentos
    document.getElementById('btnResetFilterNameDoc').addEventListener('click', (e) => resetFilter(e.target.dataset.target, 'documents'));
    document.getElementById('btnResetFilterEmailDoc').addEventListener('click', (e) => resetFilter(e.target.dataset.target, 'documents'));
    document.getElementById('btnResetFilterDateDoc').addEventListener('click', (e) => resetFilter(e.target.dataset.target, 'documents'));
    document.getElementById('btnResetFilterFileNameDoc').addEventListener('click', (e) => resetFilter(e.target.dataset.target, 'documents'));

    // Listeners para filtros de imágenes
    document.getElementById('btnResetFilterNameImg').addEventListener('click', (e) => resetFilter(e.target.dataset.target, 'images'));
    document.getElementById('btnResetFilterEmailImg').addEventListener('click', (e) => resetFilter(e.target.dataset.target, 'images'));
    document.getElementById('btnResetFilterDateImg').addEventListener('click', (e) => resetFilter(e.target.dataset.target, 'images'));
    document.getElementById('btnResetFilterFileNameImg').addEventListener('click', (e) => resetFilter(e.target.dataset.target, 'images'));

    document.getElementById('btnResetAllDoc').addEventListener('click', () => resetAllFilters('documents'));
    document.getElementById('btnResetAllImg').addEventListener('click', () => resetAllFilters('images'));

    document.getElementById('btnFilterDoc').addEventListener('click', () => listUploads('documents', false, '', true));
    document.getElementById('btnFilterImg').addEventListener('click', () => listUploads('images', false, '', true));

    // Enter en filtros de documentos
    document.getElementById('filterNameDoc').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') listUploads('documents', false, '', true);
    });
    document.getElementById('filterEmailDoc').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') listUploads('documents', false, '', true);
    });
    document.getElementById('filterDateDoc').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') listUploads('documents', false, '', true);
    });
    document.getElementById('filterFileNameDoc').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') listUploads('documents', false, '', true);
    });

    // Enter en filtros de imágenes
    document.getElementById('filterNameImg').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') listUploads('images', false, '', true);
    });
    document.getElementById('filterEmailImg').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') listUploads('images', false, '', true);
    });
    document.getElementById('filterDateImg').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') listUploads('images', false, '', true);
    });
    document.getElementById('filterFileNameImg').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') listUploads('images', false, '', true);
    });

    async function listUploads(section = 'documents', findAndShowName = false, findName = '', showLoading = false) {
        const docList = document.getElementById('docList');
        const imgList = document.getElementById('imgList');

        if (showLoading) {
            if (section === 'documents') {
                docList.innerHTML = '<div class="loading-results">🔍 Filtrando documentos...</div>';
            } else if (section === 'images') {
                imgList.innerHTML = '<div class="loading-results">🔍 Filtrando imágenes...</div>';
            }
        }

        const res = await getApi('listUploads');
        const docs = res.docs || [];
        const imgs = res.imgs || [];

        let nameFilter, emailFilter, dateFilter, fileNameFilter;

        if (section === 'documents') {
            nameFilter = (document.getElementById('filterNameDoc')?.value || '').trim().toLowerCase();
            emailFilter = (document.getElementById('filterEmailDoc')?.value || '').trim().toLowerCase();
            dateFilter = (document.getElementById('filterDateDoc')?.value || '').trim();
            fileNameFilter = (document.getElementById('filterFileNameDoc')?.value || '').trim().toLowerCase();
        } else if (section === 'images') {
            nameFilter = (document.getElementById('filterNameImg')?.value || '').trim().toLowerCase();
            emailFilter = (document.getElementById('filterEmailImg')?.value || '').trim().toLowerCase();
            dateFilter = (document.getElementById('filterDateImg')?.value || '').trim();
            fileNameFilter = (document.getElementById('filterFileNameImg')?.value || '').trim().toLowerCase();
        } else {
            nameFilter = ''; emailFilter = ''; dateFilter = ''; fileNameFilter = '';
        }
        
        const filterFn = x => {
            const n = (x.uploaderName || '').toString().toLowerCase();
            const e = (x.uploaderEmail || '').toString().toLowerCase();
            const f = (x.name || '').toString().toLowerCase();
            return (
                (!nameFilter || n.includes(nameFilter)) && 
                (!emailFilter || e.includes(emailFilter)) && 
                (!dateFilter || x.date === dateFilter) &&
                (!fileNameFilter || f.includes(fileNameFilter))
            );
        };

        const filteredDocs = docs.filter(filterFn);
        const filteredImgs = imgs.filter(x => {
            if (x.name && x.name.startsWith('NEWS_')) return false;
            return filterFn(x);
        });

        // Render documentos
        if (filteredDocs.length) {
            docList.innerHTML = filteredDocs.map(d => {
                const direct = getDriveDirectUrl(d.url); 
                return `<div class="card-item">
                    <div style="flex:0 0 auto">
                        <a href="${direct}" target="_blank" style="font-weight:bold;color:var(--text);font-size:1.1rem">${d.name}</a>
                    </div>
                    <div style="font-size:0.8rem;color:var(--muted);margin-top:10px">
                        📅 ${safeString(d.date)}<br>👤 ${safeString(d.uploaderName) || 'Sin nombre'}<br>✉️ ${safeString(d.uploaderEmail) || 'Sin correo'}
                    </div>
                </div>`;
            }).join('');
        } else {
            docList.innerHTML = '<div class="no-results">Sin documentos</div>';
        }

        // Render imágenes
        if (filteredImgs.length) {
            imgList.innerHTML = filteredImgs.map(i => {
                const thumbnail = getDriveThumbnailUrl(i.url, 400); 
                const directUrl = getDriveDirectUrl(i.url); 
                
                return `<div class="card-item">
                    <a href="${directUrl}" target="_blank" style="display:block">
                        <img loading="lazy" src="${thumbnail}" alt="${i.name}" class="card-item-img"
                            onerror="this.onerror=null;this.style.display='none';this.insertAdjacentHTML('afterend','<div class=&quot;placeholder&quot;>Sin miniatura</div>');"
                        />
                    </a>
                    <div style="margin-top:5px;font-weight:bold;color:var(--text);font-size:1.1rem">${i.name}</div>
                    <div style="font-size:0.8rem;color:var(--muted);margin-top:6px">
                        📅 ${safeString(i.date)}<br>👤 ${safeString(i.uploaderName) || 'Sin nombre'}<br>✉️ ${safeString(i.uploaderEmail) || 'Sin correo'}
                    </div>
                </div>`;
            }).join('');
        } else {
            imgList.innerHTML = '<div class="no-results">Sin imágenes</div>';
        }

        if (findAndShowName && findName) {
            const allFiles = [...docs, ...imgs];
            const found = allFiles.find(x => x.name === findName);
            if (found) {
                const directUrl = getDriveDirectUrl(found.url);
                const isImg = (found.mime && found.mime.toLowerCase().startsWith('image/')) || /\.(jpg|jpeg|png|gif|webp)$/i.test(found.name);
                if (isImg) document.getElementById('imgStatus').innerHTML = `Subida: <a href="${directUrl}" target="_blank">Abrir</a>`;
                else document.getElementById('docStatus').innerHTML = `Subido: <a href="${directUrl}" target="_blank">Abrir</a>`;
            } else {
                document.getElementById('imgStatus').textContent = '';
                document.getElementById('docStatus').textContent = '';
            }
        }
    }

    /* ====== NOTICIAS ====== */
    document.getElementById('btnToggleNewsForm').addEventListener('click', () => {
        document.getElementById('createNewsForm').classList.toggle('hidden');
        if (!document.getElementById('createNewsForm').classList.contains('hidden')) {
            document.getElementById('newsTitle').value = '';
            document.getElementById('newsContent').value = '';
            document.getElementById('newsImgFile').value = '';
            document.getElementById('newsStatus').textContent = '';
        }
    });

    document.getElementById('btnCancelNews').addEventListener('click', () => {
        document.getElementById('createNewsForm').classList.add('hidden');
    });

    document.getElementById('btnUploadNews').addEventListener('click', async () => {
        const title = document.getElementById('newsTitle').value.trim();
        const content = document.getElementById('newsContent').value.trim();
        const imgFile = document.getElementById('newsImgFile').files[0];
        const status = document.getElementById('newsStatus');

        if (!title || !content) {
            showAlert('El Título y el Contenido son obligatorios.', 'warning');
            return;
        }

        status.textContent = 'Subiendo noticia...';
        let imageUrl = '';

        try {
            if (imgFile) {
                status.textContent = 'Subiendo imagen...';
                const imgName = `NEWS_${Date.now()}_${imgFile.name}`; 
                await uploadFile(imgFile, imgName);
                const listRes = await getApi('listUploads');
                const uploadedImg = (listRes.imgs || []).find(x => x.name === imgName);
                if (uploadedImg && uploadedImg.url) imageUrl = uploadedImg.url;
            }
            
            status.textContent = 'Publicando noticia..';
            const newsData = { titulo: title, contenido: content, imagenUrl: imageUrl };
            await callApi('addNews', { news: newsData });
            status.textContent = '✅ Noticia publicada exitosamente. Recargando lista...';
            document.getElementById('createNewsForm').classList.add('hidden');
            await loadNews();
        } catch (e) {
            status.textContent = '❌ Error al publicar la noticia.';
            console.error(e);
        }
    });

    function renderNews(newsArray) {
        const main = document.getElementById('mainNews');
        const list = document.getElementById('newsList');

        if (newsArray.length === 0) {
            main.innerHTML = '<div class="no-results">No se han publicado noticias.</div>';
            list.innerHTML = '';
            return;
        }

        const n = newsArray[0];
        const imgUrl = getDriveThumbnailUrl(safeString(n.imagenUrl), 300); 
        const directLink = getDriveDirectUrl(safeString(n.imagenUrl));

        main.innerHTML = `
            <div class="news-image-area">
                ${imgUrl 
                    ? `<a href="${directLink}" target="_blank"><img loading="lazy" src="${imgUrl}" alt="noticia" class="news-card-img" 
                        onerror="this.style.display='none'; this.alt='No image'"></a>` 
                    : ''}
                <div class="news-meta-data">
                    📅 ${safeString(n.fecha)}
                </div>
            </div>
            <div class='news-content-area'>
                <h3>${safeString(n.titulo)}</h3>
                <p style="margin-top:10px">${safeString(n.contenido)}</p>
            </div>
            `; 

        list.innerHTML = newsArray.map(x => {
            const thumb = getDriveThumbnailUrl(safeString(x.imagenUrl), 200); 
            const directLinkItem = getDriveDirectUrl(safeString(x.imagenUrl));
            
            return `<div class="item">
                <a href="${directLinkItem}" target="_blank">
                ${thumb
                    ? `<img loading="lazy" src="${thumb}" alt="${safeString(x.titulo)}" class="news-list-thumb"
                        onerror="this.style.display='none'; this.alt='No image'">`
                    : ''}
                </a>
                <div>
                    <strong>${safeString(x.titulo)}</strong>
                    <small>${safeString(x.fecha)}</small>
                    <p>${safeString(x.contenido)}</p> 
                </div>
            </div>`;
        }).join('');
    }

    async function loadNews(){
        const res = await getApi('listNews');
        allNewsData = (res && res.news && res.news.length) ? res.news : [];
        renderNews(allNewsData);
    }

    function filterNews() {
        const titleFilter = (document.getElementById('filterNewsTitle')?.value || '').trim().toLowerCase();
        const dateFilter = (document.getElementById('filterNewsDate')?.value || '').trim();

        const filteredNews = allNewsData.filter(n => {
            const title = (n.titulo || '').toString().toLowerCase();
            const date = (n.fecha || '').toString().trim();
            return ((!titleFilter || title.includes(titleFilter)) && (!dateFilter || date.startsWith(dateFilter)));
        });

        renderNews(filteredNews);
    }

    document.getElementById('btnFilterNews').addEventListener('click', filterNews);
    document.getElementById('filterNewsTitle').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') filterNews();
    });
    document.getElementById('filterNewsDate').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') filterNews();
    });

    document.getElementById('btnResetFilterNewsTitle').addEventListener('click', (e) => {
        document.getElementById(e.target.dataset.target).value = '';
        filterNews(); 
    });

    document.getElementById('btnResetFilterNewsDate').addEventListener('click', (e) => {
        document.getElementById(e.target.dataset.target).value = '';
        filterNews(); 
    });

    document.getElementById('btnResetNewsAll').addEventListener('click', () => {
        document.getElementById('filterNewsTitle').value = '';
        document.getElementById('filterNewsDate').value = '';
        renderNews(allNewsData);
    });

 /* ====== NAVEGACIÓN ====== */
document.querySelectorAll('.nav a').forEach(a => {
    a.addEventListener('click', e => {
        e.preventDefault();
        
        document.querySelectorAll('.nav a').forEach(n => n.classList.remove('active'));
        a.classList.add('active');
        
        const target = a.dataset.section;
        document.querySelectorAll('.section').forEach(s => {
            s.classList.remove('active-section');
        });
        document.getElementById(target).classList.add('active-section');
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        const container = document.querySelector('.container');
        if (container) container.scrollTop = 0;
        
        if (target === 'documents') listUploads('documents'); 
        if (target === 'images') listUploads('images');
        if (target === 'home') loadNews();
        
        // AGREGAR ESTE NUEVO CASO PARA REPORTES
        if (target === 'reports') {
            initializeReportsSystem();
        }
        
        if (target === 'home') {
            setTimeout(function() {
                const searchCodeInput = document.getElementById('searchCode');
                if (searchCodeInput) searchCodeInput.focus();
            }, 100);
        }
    });
});

/* ====== SISTEMA DE REPORTES - CORREGIDO ====== */
function initializeReportsSystem() {
    console.log('Inicializando sistema de reportes...');
    
    const reportContent = document.getElementById('report-content');
    if (!reportContent) {
        console.error('No se encontró el contenedor report-content');
        return;
    }

    // Verificar si los scripts ya están cargados
    if (typeof TrazabilidadSystem === 'undefined') {
        console.log('Sistema de reportes no disponible, mostrando mensaje...');
        reportContent.innerHTML = `
            <div class="search-card" style="text-align: center; padding: 40px;">
                <div class="loading-state">Cargando sistema de reportes...</div>
            </div>
        `;
        
        // Los scripts deberían estar cargados por el HTML, reintentar
        setTimeout(() => {
            initializeReportsSystem();
        }, 500);
        return;
    }

    try {
        // Inicializar el sistema
        if (!window.reportsSystem) {
            window.reportsSystem = new TrazabilidadSystem(reportContent);
            console.log('Nueva instancia de reportes creada');
        }
        
        // Kacosa App: se entra directo a Trazabilidad (TrazabilidadSystem.init(),
        // que dibuja render()+bindEvents()+initializeTrazabilidadLogic() de una),
        // en vez de showReportsMenu() que mostraba el selector de módulos —
        // ya no hace falta, el shell solo trae al usuario aquí cuando ya
        // eligió "Trazabilidad" en su menú.
        window.reportsSystem.init();
        console.log('Menú de reportes mostrado correctamente');
        
    } catch (error) {
        console.error('Error al inicializar reportes:', error);
        reportContent.innerHTML = `
            <div class="search-card" style="text-align: center; padding: 40px;">
                <h3 style="color: var(--red);">Error en sistema de reportes</h3>
                <p style="color: var(--muted);">${error.message}</p>
                <button onclick="initializeReportsSystem()" class="alt">Reintentar</button>
            </div>
        `;
    }
}

// Función global para mostrar alertas
if (typeof showAlert === 'undefined') {
    window.showAlert = function(message, type = 'info') {
        // Usar tu sistema de alertas existente o este simple
        alert(`${type.toUpperCase()}: ${message}`);
    };
}
        

    /* ====== CONTACTO ====== */
    document.getElementById('waBtn').href = "https://wa.me/4129915255?text=Hola%20";
    document.getElementById('mailBtn').href = "mailto:derwins.rojas@kacosa.com";

    /* ====== INICIALIZACIÓN ====== */
    setTimeout(() => {
        if (auth.currentUser) { 
            listUploads('documents'); 
            listUploads('images'); 
            loadNews(); 
        }
    }, 800);

    /* ====== AUTO-FOCUS ====== */
    function focusSearchField() {
        const searchCodeInput = document.getElementById('searchCode');
        if (searchCodeInput && document.getElementById('home').classList.contains('active-section')) {
            searchCodeInput.focus();
            setTimeout(() => { searchCodeInput.focus(); }, 500);
        }
    }

    setTimeout(focusSearchField, 300);

    /* ====== LIMPIAR RESULTADOS ====== */
    document.getElementById('searchCode').addEventListener('input', function() {
        const code = this.value.trim();
        if (!code) {
            currentInventoryResults = [];
            document.getElementById('searchResults').innerHTML = '';
        }
    });

    document.getElementById('filterCenter').addEventListener('input', function() {
        const filterValue = this.value.trim();
        if (!filterValue && currentInventoryResults.length > 0) {
            renderInventoryResults();
        }
    });

    document.getElementById('filterFileNameDoc').addEventListener('input', function() {
        const filterValue = this.value.trim();
        if (!filterValue) listUploads('documents', false, '', true);
    });

    document.getElementById('filterFileNameImg').addEventListener('input', function() {
        const filterValue = this.value.trim();
        if (!filterValue) listUploads('images', false, '', true);
    });
}

/* ====== SISTEMA MODULAR DE REPORTES ====== */
/* ====== SISTEMA DE REPORTES - VERSIÓN CORREGIDA ====== */
function initializeReportsSystem() {
    console.log('Inicializando sistema de reportes...');
    
    const reportContent = document.getElementById('report-content');
    if (!reportContent) {
        console.error('No se encontró el contenedor report-content');
        return;
    }

    // Limpiar contenido anterior
    reportContent.innerHTML = '';

    try {
        // Inicializar el gestor de módulos
        if (!window.modulesManager) {
            window.modulesManager = new ModulesManager();
            console.log('ModulesManager inicializado');
        }
        
        window.modulesManager.init(reportContent);
        console.log('Sistema modular de reportes inicializado correctamente');
        
    } catch (error) {
        console.error('Error al inicializar sistema modular:', error);
        reportContent.innerHTML = `
            <div class="search-card" style="text-align: center; padding: 40px;">
                <h3 style="color: var(--red);">Error en sistema de reportes</h3>
                <p style="color: var(--muted);">${error.message}</p>
                <button onclick="initializeReportsSystem()" class="alt">Reintentar</button>
            </div>
        `;
    }
}

// Función global para mostrar alertas (si no existe)
if (typeof showAlert === 'undefined') {
    window.showAlert = function(message, type = 'info') {
        // Puedes usar tu sistema de alertas existente o este simple
        alert(`${type.toUpperCase()}: ${message}`);
    };
}

/* =====================================================================
   PARCHE ADITIVO — Kacosa App (portal unificado)
   No modifica la lógica original. Permite que el shell (index.html del
   portal) enlace directamente a una sección específica de esta app
   usando un hash tipo "#section=news", para poder incrustarla dentro
   de un iframe por submódulo (Reportes > Noticias, Inventario >
   Trazabilidad, etc.) sin tocar el comportamiento normal cuando se
   abre esta página de forma independiente (sin hash, se comporta igual
   que siempre: entra en "home").
   ===================================================================== */
(function () {
    function aplicarSeccionDesdeHash() {
        const match = location.hash.match(/section=([a-z]+)/i);
        if (!match) return;
        const destino = match[1];
        const link = document.querySelector('.nav a[data-section="' + destino + '"]');
        if (link) {
            // Espera a que mainApp esté visible (sesión ya validada) antes de simular el click
            const intento = setInterval(() => {
                const mainApp = document.getElementById('mainApp');
                if (mainApp && !mainApp.classList.contains('hidden')) {
                    clearInterval(intento);
                    link.click();
                }
            }, 150);
            setTimeout(() => clearInterval(intento), 15000);
        }
    }
    window.addEventListener('DOMContentLoaded', aplicarSeccionDesdeHash);
    window.addEventListener('hashchange', aplicarSeccionDesdeHash);
})();
