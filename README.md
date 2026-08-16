# Kacosa App

Portal único tipo SAP que unifica las 4 aplicaciones internas de KACOSA en un
solo dominio, con **login compartido** y navegación por menú hamburguesa
según el rol del usuario:

- **Portal Kacosa** — login, header, footer y menú (el shell)
- **Dashboard Inventario** — resumen de inventarios
- **Inventario** — Trazabilidad, Consultas, Noticias, Imágenes, Documentos
- **Abastecimiento** — Dashboard, Nuevo Análisis, Alertas Kacosa

🔗 Publicado en GitHub Pages: `https://logisticainventariokacosa.github.io/Kacosa-app/`

## Arquitectura: shell + submódulos en iframe

Cada app vive como un módulo **independiente**, con su propio HTML/CSS/JS, y
se carga dentro de un `<iframe>` dentro del shell (`index.html` + `js/shell.js`).
No se fusionó el código de las 4 apps en un solo archivo porque cada una usa
versiones y variables globales distintas — combinarlas de verdad arriesgaba
que el CSS o el JS de una rompiera a las otras.

Ventajas de este enfoque:

- Cada módulo conserva su lógica original intacta; los cambios que se le
  hacen son **aditivos** (parches de hash en la URL para abrir una vista
  directamente, ej. `#vista=vista-alertas-kacosa`, o pequeños ajustes de
  integración — nunca se reescribe su lógica de negocio).
- Todo son archivos estáticos con rutas relativas: se despliega tal cual en
  GitHub Pages, o se copia entero a cualquier servidor. No requiere build ni Node.
- Las 4 apps comparten el mismo proyecto de **Firebase Auth** (`portal-kacosa`)
  y la colección `usuarios` (rol, nombre, tiendas asignadas) — se inicia
  sesión una sola vez y esa sesión se reconoce en todos los módulos.

```
Kacosa-app/
├── index.html                  Login + shell SAP (header, footer, hamburguesa)
├── css/shell.css                Estilos del shell y del sidebar
├── js/
│   ├── firebase-config.js       Proyecto Firebase "portal-kacosa" (login/roles)
│   └── shell.js                 Árbol de módulos, control de acceso por rol,
│                                 apertura de submódulos en el iframe
├── img/                         Logo y favicons
├── media/                       Videos de bienvenida
└── modules/
    ├── dashboard-inv/           App "Dashboard Inventario"
    ├── inventario/              App "Inventario" (Trazabilidad, Consultas, Reportes)
    └── abastecimiento/          App "Análisis de Abastecimiento"
```

### Sesión compartida entre el shell y los módulos

Firebase Auth persiste la sesión del navegador bajo una clave que incluye el
**nombre de la instancia de la app** (`initializeApp(config, nombre)`), no
solo el proyecto. Por eso todos los módulos que necesitan reconocer la sesión
ya iniciada en el portal registran su Firebase de auth como la app **por
defecto** (sin nombre), igual que el shell — de lo contrario cada uno busca
la sesión bajo una clave distinta a la que se guardó y termina pidiendo login
de nuevo aunque ya estabas autenticado.

- `modules/abastecimiento/js/firebase-config.js` usa **dos** proyectos de
  Firebase: uno de datos (`kacosa-abastecimiento`, con nombre `"datos"`, sin
  cambios) y uno de auth (`portal-kacosa`, registrado **sin nombre** para
  compartir sesión con el shell).
- `modules/dashboard-inv` y `modules/inventario` usan directamente el mismo
  proyecto `portal-kacosa` que el shell.

### Loader unificado al abrir un módulo

Cuando se abre un submódulo, el shell muestra "Cargando módulo…" mientras el
`<iframe>` carga. Pero terminar de cargar el HTML no significa que el módulo
ya verificó sesión/rol y está listo para mostrarse — cada módulo tiene su
propia verificación interna (`nav.js` en Abastecimiento, `loader-classic.js`
en Dashboard Inventario). Para que el usuario vea **un solo loader continuo**
en vez de dos en fila, cada módulo le avisa al shell por `postMessage`
(`{source: "kacosa-module", type: "listo"}`) cuando de verdad terminó; el
shell escucha ese mensaje antes de ocultar "Cargando módulo…" (con un tope de
6 segundos de seguridad si algún módulo no envía el aviso).

### Arranque sin sesión previa

El shell recuerda en `localStorage` (`kacosa-hubo-sesion`) si la última vez
hubo una sesión activa. Si no la hubo (o el usuario cerró sesión), muestra el
login de inmediato en vez de esperar a que Firebase confirme algo que ya se
sabía, evitando el parpadeo de "Verificando sesión…" innecesario.

## Mapeo de módulos (menú hamburguesa tipo SAP)

| Módulo         | Submódulo                    | Origen (`modules/…`)                              |
|----------------|-------------------------------|----------------------------------------------------|
| Dashboard      | Dashboard Inventario          | `dashboard-inv/index.html`                          |
| Dashboard      | Dashboard Abastecimiento      | `abastecimiento/app.html#vista=vista-dashboard`     |
| Inventario     | Trazabilidad                  | `inventario/index.html#section=reports`             |
| Inventario     | Consultas                     | `inventario/index.html#section=home`                |
| Abastecimiento | Nuevo Análisis                | `abastecimiento/app.html#vista=vista-nuevo-analisis`|
| Abastecimiento | Alertas Kacosa                | `abastecimiento/app.html#vista=vista-alertas-kacosa`|
| Reportes       | Noticias (primero al entrar)  | `inventario/index.html#section=news`                |
| Reportes       | Imágenes                      | `inventario/index.html#section=images`              |
| Reportes       | Documentos                    | `inventario/index.html#section=documents`           |

Al iniciar sesión, cada usuario cae directo en el Dashboard que le
corresponde según su rol (mapa `HOME_POR_ROL` en `js/shell.js`), y el menú
hamburguesa solo muestra los módulos/submódulos permitidos para ese rol
(arrays `ROLES_INVENTARIO`, `ROLES_ABASTECIMIENTO`, `ROLES_DASHBOARD_INV`,
también en `js/shell.js`).

## Roles y acceso a tiendas

La colección `usuarios` (Firestore, proyecto `portal-kacosa`) guarda por
cada cuenta: `rol`, `nombre`, `tiendas` (array de IDs de tienda) y
`passwordTemporal`.

- **`gerente`** ve únicamente la(s) tienda(s) listadas en su campo `tiendas`
  — nunca el selector completo. Tampoco ve el submódulo "Alertas Kacosa".
- El resto de roles permitidos en Abastecimiento (`supervisor`,
  `abastecimiento`, `compras`, `admin`, `directiva`) ven **todas** las
  tiendas.
- Esta restricción es **fail-closed**: cualquier caso donde el rol no se
  reconoce o el perfil no cargó (error de red, perfil inexistente, rol mal
  escrito) deja al usuario **sin acceso a ninguna tienda**, en vez de
  mostrarle todo por defecto. Ver `modules/abastecimiento/js/nav.js`.

## Cómo publicarlo

**GitHub Pages:** el repositorio ya está configurado así — cualquier push a
la rama principal se refleja en la URL pública. Al modificar archivos JS/HTML
de un módulo, sube también el cambio de versión en el `<script src="...?v=N">`
correspondiente (ver más abajo), para que el navegador no sirva la copia
vieja desde caché.

**Servidor propio:** copia la carpeta completa a la raíz pública del
servidor (Apache, Nginx, etc.). No requiere build ni Node.

## Notas al hacer cambios

- **Cache-busting:** cada script se importa con `?v=N` en su `<script src>` (y,
  cuando un módulo importa otro vía ES modules, también en el `import`, ej.
  `import { auth } from "./firebase-config.js?v=2"`). Al editar un archivo,
  sube en 1 el número de versión donde se referencia, o el navegador seguirá
  sirviendo la versión anterior desde caché aunque el archivo en el servidor
  ya haya cambiado.
- **No romper la lógica original de cada módulo.** Los cambios sobre
  Inventario, Abastecimiento y Dashboard Inventario deben mantenerse
  aditivos (parches de hash, mensajes `postMessage`, pequeños ajustes de
  integración) — evitar reescribir su lógica de negocio interna salvo que el
  cambio lo pida explícitamente.
- El logo de KACOSA vive como archivo real en `img/logo-kacosa.jpg` (no
  embebido en base64 dentro del HTML).
- Cada submódulo conserva su propio encabezado/menú interno dentro del área
  de contenido del iframe.
