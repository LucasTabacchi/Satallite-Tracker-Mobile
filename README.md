# Satellite Tracker — TP7

Satellite Tracker, con la interfaz **Orbit**, es una aplicación móvil para explorar satélites artificiales, estimar su posición y planificar pases desde un punto de observación. Descarga elementos orbitales de catálogos reales y calcula las posiciones **en el dispositivo con SGP4**. El movimiento del mapa no es telemetría: la aplicación no recibe la ubicación del satélite cada dos segundos.

El recorrido principal se verificó en un **Motorola Edge 30 Ultra**. La descarga directa de Starlink en ese teléfono, el respaldo autenticado de Space-Track y la entrega de una notificación por Android siguen siendo verificaciones separadas. Véase [estado de verificación](#estado-de-verificación-y-demo).

## Índice

- [Inicio rápido](#inicio-rápido)
- [Cómo usar la aplicación](#cómo-usar-la-aplicación)
- [Qué representa el mapa](#qué-representa-el-mapa)
- [Fuentes de datos y proxy local](#fuentes-de-datos-y-proxy-local)
- [Arquitectura y cálculo orbital](#arquitectura-y-cálculo-orbital)
- [Pruebas](#pruebas)
- [Estado de verificación y demo](#estado-de-verificación-y-demo)
- [Documentación](#documentación)

## Inicio rápido

Ejecute los comandos desde `satellite-tracker/`, donde está `package.json`.

| Requisito | Uso |
| --- | --- |
| Node.js 24 LTS y npm | Instalar dependencias, ejecutar Metro y correr las pruebas. |
| JDK 21 y Android SDK con Platform Tools | Construir e instalar la app nativa. `adb` permite usar un emulador o un teléfono por USB. |
| Internet | Descargar dependencias y obtener el primer catálogo. El flujo público de la ISS no requiere credenciales. |

```powershell
npm.cmd ci
npm.cmd run mitigation:check
npm.cmd run android
```

En Windows, `npm.cmd` no depende de la política de scripts de PowerShell. En otras plataformas, use `npm`. `npm run android` construye los módulos nativos e instala la versión de desarrollo: **no es Expo Go**. Si utiliza un teléfono, habilite la depuración USB y autorice la conexión desde Android. El identificador de la aplicación es `dev.tp7.satellitetracker`.

### Si ya está instalado el APK de depuración

Este APK necesita **Metro** para cargar el código JavaScript. Para la conexión USB en Windows, inicie Metro con IPv4 como primera opción:

```powershell
$env:NODE_OPTIONS = (($env:NODE_OPTIONS, '--dns-result-order=ipv4first') -join ' ').Trim()
npm.cmd start -- --localhost --port 8081
```

En otra terminal, con un único dispositivo autorizado:

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
```

Si hay varios dispositivos, use `adb -s <serial> reverse tcp:8081 tcp:8081`. Si la app no carga, compruebe que `http://127.0.0.1:8081/status` devuelve `packager-status:running`. Si el teléfono sigue mostrando una versión anterior, reinicie Metro con `--clear` y recargue la app. Véase [aceptación en Android](docs/device-acceptance.md).

Expo también tiene una variante web con limitaciones explícitas de hardware y ejecución en segundo plano. La carpeta `design/` contiene una maqueta anterior: **no sustituye a la app nativa ni a la demo real**.

## Cómo usar la aplicación

| Pantalla | Qué permite hacer |
| --- | --- |
| **Catálogo** | Elegir Estaciones, Starlink, GPS, Meteorológicos o Todos activos; buscar por nombre o NORAD dentro del grupo descargado; seleccionar un objeto. |
| **Seguimiento** | Ver el marcador, la trayectoria, la cobertura y los datos orbitales del satélite seleccionado. |
| **Cielo** | Ver la carta polar de un pase e iniciar la brújula para recibir orientación cuando hay un rumbo fiable. |
| **Pases** | Consultar ventanas geométricas y su máxima elevación; configurar recordatorios de manera explícita. |
| **Ajustes** | Definir el observador con GPS o coordenadas manuales, ajustar la elevación mínima y acceder a la validación por proveedor. |

### Primera prueba: seguir la ISS

1. En **Catálogo → Estaciones**, busque `25544` y seleccione **ISS (ZARYA)**.
2. En **Seguimiento**, observe el marcador y las coordenadas. La app calcula la posición cada **2 segundos** en primer plano. Revise también la fuente, la hora de descarga y la antigüedad orbital.
3. En **Ajustes → Usar GPS actual**, conceda el permiso si desea usar su ubicación. Como alternativa, introduzca latitud y longitud en grados decimales y altitud en metros. La app no inventa una altitud si el dispositivo no la informa.
4. Abra **Pases** y **Cielo**. **AOS** es el inicio de la ventana por encima de la elevación mínima, **LOS** es el final y la elevación máxima indica el punto más alto. Son predicciones geométricas, no una garantía de visibilidad a simple vista.
5. Para ver varios objetos, elija un grupo con datos y pulse **Mostrar constelación · máx. 50**, debajo del mapa. Cambiar de grupo no activa la capa por sí solo. El botón superior **Constelación (n)** controla si se ven los marcadores calculados.

La lectura GPS solicita permiso de primer plano. Si no llega una posición actual, puede aceptar una lectura reciente válida, señalada como tal (hasta 60 segundos de antigüedad y una precisión horizontal informada de 200 metros o mejor). Si no hay una lectura utilizable, la app permite reintentar o usar la ubicación manual. La brújula usa el **norte geográfico**: no sustituye un rumbo no disponible por el magnético ni muestra un giro para un satélite por debajo del horizonte.

## Qué representa el mapa

| Elemento | Interpretación |
| --- | --- |
| **Punto verde** | Posición calculada del satélite. Con zoom, la cámara intenta seguirlo; el punto puede parecer quieto mientras se desplaza el mapa. |
| **Punto gris del observador** | Ubicación configurada para calcular azimut, elevación y pases. No es otro satélite. |
| **Línea punteada** | Una vuelta sobre el mapa: media órbita antes y media después del instante de cálculo. Sus extremos no tienen por qué coincidir porque la Tierra gira. Si cruza el antimeridiano, la línea sale por un borde y reaparece por el otro. |
| **Área verde sombreada** | Cobertura geométrica aproximada en ese instante, a partir de la altitud y la elevación mínima elegida. No indica calidad de señal, cobertura de un servicio ni visibilidad a simple vista. |
| **Marcadores de constelación** | Hasta 50 objetos del grupo cargado. La capa no equivale al catálogo completo. |

La cartografía de **Natural Earth** viene incluida y se dibuja en SVG sin descargar teselas. Puede mostrarse sin conexión, aunque para calcular posiciones se necesitan elementos orbitales válidos previamente descargados. El relleno y el contorno de cobertura se dibujan por separado para evitar líneas falsas en los polos y los bordes. Véase [mapa nativo](docs/native-map.md).

## Fuentes de datos y proxy local

| Proveedor | Uso en la app | Credenciales |
| --- | --- | --- |
| **CelesTrak** | Catálogo principal en GP JSON/OMM; para Starlink, datos suplementarios **SupGP CSV**. | No. |
| **Where the ISS at?** | Referencia pública de posición para la ISS y respaldo limitado a consultas compatibles de la ISS o de Estaciones. | No. |
| **Space-Track** | Respaldo para consultas compatibles, como un NORAD explícito o el grupo de activos. No sustituye grupos temáticos sin un listado verificado de pertenencia. | Correo y contraseña, solo en el servidor. |
| **N2YO** | Elementos orbitales por NORAD y posición de referencia para la comparación. No proporciona el catálogo general en esta integración. | API key, solo en el servidor. |

### Caché y errores de red

- Se conservan elementos en **AsyncStorage**, con un TTL de **24 horas** y claves separadas por consulta. Si falla una actualización, la app puede mostrar una copia válida del mismo grupo con un aviso; no inventa resultados.
- La **hora de descarga** indica cuándo se obtuvo el archivo. La **época orbital** es el instante de referencia de sus elementos. Una descarga reciente puede traer elementos antiguos; la UI avisa cuando la época tiene 24 horas o más.
- Si Starlink responde **HTTP 403**, no se sustituye por la ISS. La app pausa las consultas de ese grupo a CelesTrak durante al menos dos horas o durante un `Retry-After` mayor, y conserva una copia válida si existe. El fin de la pausa no garantiza que el proveedor restablezca el acceso.

### Prueba segura de Space-Track y N2YO

1. En una terminal dedicada, siga la guía de [Space-Track](docs/data-sources.md#run-the-local-space-track-proxy) o [N2YO](docs/data-sources.md#run-the-local-n2yo-proxy). Ingrese la contraseña o la clave cuando aparezca el pedido de texto oculto, sin crear un `.env`.
2. Inicie `npm.cmd run proxy:local` como indica la guía. El servidor escucha solo en `http://127.0.0.1:4178`. Puede configurarse un proveedor o ambos.
3. Desde otra terminal, pruebe la consulta de la ISS. Una respuesta con NORAD y época confirma el acceso a los elementos; no demuestra el respaldo automático ni la comparación de posiciones.

En Expo solo se configura la URL mediante `EXPO_PUBLIC_PROVIDER_PROXY_URL`. Nunca coloque allí una clave, contraseña ni correo de acceso. **El proxy local no es un servicio de producción**: no lo exponga en la red sin un diseño de seguridad. Véase [fuentes de datos y proxy](docs/data-sources.md).

## Arquitectura y cálculo orbital

```text
app/                 Pantallas y navegación con Expo Router
src/application/     Controlador de selección, catálogo, ciclos y pases
src/ui/              Mapa SVG, carta celeste y paneles de observación
src/native/          GPS, brújula, notificaciones y tareas de plataforma
src/providers/       Adaptadores públicos y cliente del proxy
src/data-service.ts  Caché, prioridades de fuentes, cancelación y límites
src/orbit.ts         Propagación SGP4 y conversión de coordenadas
src/geometry.ts      Trayectoria, cobertura y proyección polar
src/prediction.ts    Ventanas de pases y máxima elevación
src/validation.ts    Comparación de posiciones para el mismo instante UTC
server/              Proxy local y adaptadores autenticados, fuera de la app
tests/               Pruebas deterministas del dominio y de integración
docs/                Referencia técnica, guías y evidencias
```

**Flujo principal:** el proveedor entrega elementos orbitales → el servicio los valida y almacena → el controlador selecciona un objeto → SGP4 calcula su posición → la interfaz la dibuja. Con un observador configurado, el mismo cálculo obtiene azimut, elevación y distancia. No hay una consulta remota por cada actualización del mapa.

La aplicación usa **React Native 0.88**, **Expo SDK 58**, TypeScript y **satellite.js 6.0.2**. Esta versión de satellite.js mantiene el cálculo en JavaScript y el soporte OMM sin incorporar a Metro el entorno WASM ni módulos de Node. OMM permite manejar números NORAD de seis dígitos. SGP4 produce coordenadas **TEME** que se convierten en posición geodética y ángulos respecto del observador. Véase [lógica orbital](docs/orbital-logic.md).

La predicción busca pases geométricos en las próximas **48 horas**. El modelo de cobertura esférica no incluye relieve ni refracción atmosférica. La validación exige el mismo **NORAD y segundo UTC** y mide la distancia 3D en coordenadas terrestres **ECEF/WGS84**, en kilómetros. La diferencia entre dos fuentes no equivale por sí sola a la precisión respecto de la posición física real.

Los recordatorios se programan mediante acciones explícitas. La app administra solo los que creó y Android decide cuándo ejecuta las tareas en segundo plano. El inicio de la app no solicita permisos ni registra avisos por sí solo. Véanse [lógica de dispositivos](docs/device-logic.md) y [actualización en segundo plano](docs/background-refresh.md).

## Pruebas

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run mitigation:check
npm.cmd run test:cli-mitigation
npm.cmd run export:android
```

- `npm test`: órbitas, pases, cobertura, catálogo, caché, proxy local y validación, sin credenciales reales.
- `typecheck`: verificación de tipos sin emitir archivos JavaScript.
- `mitigation:check` y `test:cli-mitigation`: verificación y regresiones de la [mitigación local de Expo CLI](docs/cli-output-mitigation.md).
- `export:android`: comprueba el empaquetado con Metro; **no genera un APK ni verifica sensores**.

Las pruebas numéricas incluyen un caso histórico de Vanguard contrastado con [vectores de verificación de Vallado](https://github.com/aholinch/sgp4/blob/master/data/tcppver.out). La tolerancia de 10 m por componente corresponde a ese caso de regresión, no es una garantía de precisión para órbitas reales.

## Estado de verificación y demo

| Área | Evidencia o límite |
| --- | --- |
| Seguimiento en Android | En el Motorola se verificó el movimiento del marcador y de las coordenadas de la ISS (25544) y GPS BIIR-5 (26407). |
| GPS y brújula | El usuario confirmó la obtención de ubicación. Se observó orientación real de la brújula tras una espera inicial; no se calibró contra un instrumento externo. |
| Catálogo, cobertura y constelación | Se observaron 74 objetos meteorológicos de CelesTrak, una capa de 32 satélites GPS y el control de cobertura corregido en el teléfono. |
| Comparación de posiciones | El [informe](docs/validation-report.md) reúne tres muestras públicas de la ISS frente a Where the ISS at? y una muestra real de N2YO frente al SGP4 de la app, para el mismo segundo UTC. |
| Starlink | El CSV oficial respondió en la PC; en el Motorola se observó HTTP 403. No se afirma que la descarga móvil funcione. |
| Pendientes | Respaldo real con Space-Track, validación N2YO desde la interfaz del teléfono y entrega real de notificaciones y ejecución en segundo plano en Android. |

La grabación física se guardó localmente en `output/native-demo/TP7-Satellite-Tracker-demo-Motorola-20261107-194147.mp4`. Es una captura de **90 segundos sin audio** con la constelación GPS, cobertura, selección y seguimiento de la ISS, pases y carta celeste. **No incluye Starlink ni una notificación recibida**. `output/` no forma parte del repositorio. Véase [guía para grabar la demo](docs/demo-checklist.md).

## Documentación

| Tema | Referencia |
| --- | --- |
| Instalación, pruebas y demo | [Aceptación en Android](docs/device-acceptance.md) · [Guía de grabación](docs/demo-checklist.md) |
| Proveedores y validación | [Fuentes de datos y proxy](docs/data-sources.md) · [Informe de posiciones](docs/validation-report.md) |
| Arquitectura y pantallas | [Controlador de la app](docs/native-application.md) · [Paneles de observación](docs/observation-ui.md) |
| Cálculos y mapa | [Lógica orbital](docs/orbital-logic.md) · [Geometría](docs/geometry.md) · [Mapa nativo](docs/native-map.md) |
| GPS, brújula y notificaciones | [Lógica de dispositivos](docs/device-logic.md) · [Actualización en segundo plano](docs/background-refresh.md) |
| Herramientas de desarrollo | [Mitigación de Expo CLI](docs/cli-output-mitigation.md) |
