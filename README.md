# Kacosa App

Portal único tipo SAP que unifica las 4 aplicaciones de KACOSA:
- **Portal-Kacosa** (login, header, footer)
- **Resumen-de-inventarios** → Dashboard Inventario
- **Inventario** → Trazabilidad, Consultas, Noticias, Imágenes, Documentos
- **Análisis de Abastecimiento** → Dashboard Abastecimiento, Nuevo Análisis, Alertas Kacosa

## Cómo está armado (arquitectura)

Se usó un enfoque de **shell + submódulos en iframe**, en vez de fusionar todo el
HTML/CSS/JS de las 4 apps en un solo archivo gigante. Motivo: las 4 apps usan
librerías, versiones de Tailwind/CSS y variables globales distintas entre sí; si
se combinan literalmente en una sola página, hay muy alto riesgo de que el CSS o
el JS de una rompa a las otras (por ejemplo, IDs repetidos, o variables globales
con el mismo nombre). El enfoque de iframe:

- **No modifica la lógica interna de ninguna app** (cumple "no rompas código
  funcional"). Cada app sigue siendo el mismo HTML/CSS/JS de siempre.
- Permite **desplegarlo tal cual en GitHub Pages** (todo son archivos estáticos,
  rutas relativas) y también copiarlo íntegro a cualquier servidor.
- Las 4 apps ya comparten el **mismo proyecto de Firebase Auth** ("portal-kacosa")
  y la colección `usuarios` (rol, nombre, tienda). Al vivir ahora bajo un solo
  dominio/repositorio, la sesión se comparte automáticamente entre el shell y
  cada submódulo — inicias sesión una sola vez.
- Solo se tocó cada app original para agregarle, de forma **aditiva**, la
  capacidad de abrir directamente una sección/vista concreta vía hash en la URL
  (por ejemplo `#section=news` o `#vista=vista-alertas-kacosa`). Si esas apps se
  abren solas, sin hash, se comportan exactamente igual que antes.

```
kacosa-app/
├── index.html            <- Login (diseño Portal-Kacosa) + shell SAP (header, footer, hamburguesa)
├── css/shell.css          <- Estilos del shell y del sidebar tipo SAP
├── js/
│   ├── firebase-config.js <- Mismo proyecto Firebase "portal-kacosa" (login/roles)
│   └── shell.js            <- Árbol de módulos, control de acceso por rol, apertura de submódulos
├── img/                   <- Logo y favicons
└── modules/
    ├── dashboard-inv/     <- App "Resumen de inventarios" (intacta)
    ├── inventario/        <- App "Inventario" (intacta + parche aditivo de hash)
    └── abastecimiento/    <- App "Análisis de Abastecimiento" (intacta + parche aditivo de hash)
```

## Mapeo de módulos (menú hamburguesa tipo SAP)

| Módulo         | Submódulo                | Origen                                   |
|----------------|---------------------------|-------------------------------------------|
| Dashboard      | Dashboard Inventario      | Resumen-de-inventarios (tal cual)         |
| Dashboard      | Dashboard Abastecimiento  | Abastecimiento → vista "vista-dashboard"  |
| Inventario     | Trazabilidad               | Inventario → sección "reports"            |
| Inventario     | Consultas                  | Inventario → sección "home"               |
| Abastecimiento | Nuevo Análisis             | Abastecimiento → vista "vista-nuevo-analisis" |
| Abastecimiento | Alertas Kacosa             | Abastecimiento → vista "vista-alertas-kacosa" |
| Reportes       | Noticias (primero al entrar)| Inventario → sección "news"              |
| Reportes       | Imágenes                   | Inventario → sección "images"             |
| Reportes       | Documentos                 | Inventario → sección "documents"          |

Al iniciar sesión, cada usuario cae directo en el Dashboard que le corresponde
según su rol (variable `HOME_POR_ROL` en `js/shell.js`), y el menú hamburguesa
solo muestra los módulos/submódulos permitidos para ese rol.

## Pendientes que necesito que me confirmes

1. **Reglas de rol exactas.** Tomé como base los roles que ya usaba cada app por
   separado (`ROLES_INVENTARIO`, `ROLES_ABASTECIMIENTO`, `ROLES_DASHBOARD_INV` y
   el mapa `HOME_POR_ROL`, todo en `js/shell.js`). Revísalos y ajústalos: son solo
   arrays de texto, muy fáciles de editar.
2. **Fuente de datos de "Consultas".** Pediste cambiar de dónde se consultan los
   materiales en inventarios activos. Ahora mismo sigue apuntando a la misma
   fuente que ya usaba la app de Inventario (Google Apps Script, variable
   `API_URL` en `modules/inventario/js/script.js`). Dime cuál es la nueva fuente
   (¿otra hoja/Apps Script?, ¿tabla de Supabase directa?, ¿mismo backend que usa
   Abastecimiento?) y lo conecto.
3. **Factor de conversión de Trazabilidad → Supabase.** Confirmé que la app de
   Abastecimiento ya migró sus factores de conversión a Supabase (tabla
   `factores_conversion`, vía `js/bridge.js` → Apps Script). La app de
   Inventario, en cambio, todavía trae ese listado **hardcodeado** dentro de
   `modules/inventario/js/trazabilidad-core.js` (el `Map` gigante al inicio de
   la clase `TrazabilidadCore`, cientos de líneas). No hice ese cambio todavía
   porque es el archivo más grande y sensible del proyecto (el motor entero de
   trazabilidad), y quiero evitar romperlo por apuro. Propuesta para la próxima
   iteración: agregar un método `cargarFactoresConversion()` (igual al que ya
   existe en Abastecimiento) que traiga el listado desde el mismo bridge/Supabase
   al iniciar un análisis, y usar el `Map` hardcodeado solo como respaldo si
   falla la conexión. Puedo hacerlo en cuanto confirmes que sí quieres que
   Trazabilidad use exactamente esa misma tabla `factores_conversion`.

## Cómo publicarlo

**GitHub Pages:** crea un repositorio nuevo `kacosa-app`, sube todo el contenido
de esta carpeta tal cual (manteniendo la estructura), y activa GitHub Pages
apuntando a la rama principal / carpeta raíz. La URL quedará como
`https://tuusuario.github.io/kacosa-app/`.

**Servidor propio:** copia la carpeta completa a la raíz pública del servidor
(Apache, Nginx, etc.). No requiere build ni Node — todo es HTML/CSS/JS estático.

## Notas técnicas

- El logo de KACOSA se extrajo del `base64` embebido en el HTML original a un
  archivo real `img/logo-kacosa.jpg`, para no repetir ~17 KB de texto en cada
  página y facilitar mantenimiento.
- Cada submódulo conserva su propio encabezado/menú interno (el que ya traía),
  visible dentro del área de contenido del iframe. Si prefieres ocultarlo para
  que se vea más "integrado" dentro del shell, se puede inyectar un pequeño CSS
  dentro de cada iframe para esconder esa barra — lo dejo como mejora opcional
  para no arriesgar la funcionalidad de esos botones en esta primera entrega.
