# Fuentes de datos orbitales y límites del proxy

Cuando es posible, la aplicación consume JSON con formato OMM y propaga los elementos localmente con `satellite.js`; las llamadas de red se reservan para actualizar conjuntos de elementos y para validaciones solicitadas explícitamente, nunca para cada fotograma de animación. La antigüedad de la caché (`fetchedAt`) y la época de los elementos (`EPOCH`) son mediciones distintas. El repositorio ofrece una caché de 24 horas con almacenamiento inyectado, deduplicación de solicitudes, alternativa obsoleta sin conexión, reintentos con espera progresiva y límites por proveedor en ventanas móviles. Las cachés de catálogos se organizan por grupo de proveedor y conservan la respuesta original del grupo; los filtros por nombre y NORAD se aplican localmente para que distintas búsquedas reutilicen el mismo catálogo descargado. Que no haya coincidencias locales es un resultado válido.

Las esperas por cuota y la espera progresiva de reintentos están limitadas por `maxWaitMs` (2.000 ms de forma predeterminada). Si la espera supera ese máximo, se omite ese proveedor y se prueba el siguiente, en vez de mantener bloqueada la cola de solicitudes. Las esperas respetan las señales de cancelación. Las solicitudes compartidas continúan mientras quede algún solicitante interesado; si se cancela el último, se abandona la solicitud y se impide que una respuesta tardía del proveedor entre en la caché. Solo se reintentan fallas de red, respuestas HTTP 429 y respuestas HTTP 5xx. Los errores HTTP muestran el estado y el retraso `Retry-After` analizado, sin reenviar los cuerpos ni las URL de origen; los errores 4xx permanentes pasan al siguiente proveedor de inmediato.

## Compatibilidad de proveedores

| Proveedor | Catálogo | Datos orbitales | Validación | Límites y notas |
| --- | --- | --- | --- | --- |
| CelesTrak | Grupos GP JSON, nombre/número de catálogo; CSV Starlink SupGP | GP JSON y CSV Starlink SupGP | No compatible | Público; los nombres de grupo se contrastan con los identificadores GP actuales. Starlink usa la consulta SupGP `FILE=starlink&FORMAT=CSV`. |
| Space-Track | GP JSON de todos los objetos activos, solo en servidor | GP JSON por NORAD o de todos los activos | No compatible | No afirma pertenencia a grupos seleccionados por CelesTrak; las solicitudes de grupos no compatibles fallan antes de autenticar. Las credenciales y la cookie permanecen en el servidor. |
| N2YO | No compatible | TLE solo en servidor, convertido a campos OMM | Instantáneas de posición solo en servidor | La clave API permanece en el servidor; solo se aceptan marcas de tiempo devueltas con precisión de segundos enteros. |
| Where the ISS at? | No compatible | TLE de la ISS adaptado al analizador OMM existente | Instantáneas de posición de la ISS | Solo NORAD 25544; el límite del servicio público es de aproximadamente una solicitud por segundo. |

La interfaz común `DataProvider` declara capacidades explícitas. Si se llama a una operación que un proveedor no admite, se rechaza con un error explícito de operación no compatible. Ninguna fuente que solo ofrezca datos orbitales se presenta como fuente de validación. Los identificadores NORAD de seis dígitos se aceptan en datos JSON OMM; no se inventa una codificación TLE para ellos.

La alternativa conserva el alcance de catálogo solicitado. Space-Track admite catálogos sin grupo/de todos los activos y consultas explícitas por NORAD (el identificador tiene prioridad, igual que en CelesTrak). Sin un mapeo de pertenencia autoritativo, rechaza categorías seleccionadas como estaciones, Starlink, GPS o meteorología, en vez de devolver todos los objetos activos bajo esa etiqueta. Entonces el orquestador puede probar otro proveedor compatible o conservar la caché validada previamente para ese grupo exacto. Para descargar ese grupo por primera vez hace falta una fuente que informe esa pertenencia; la aplicación no la deduce por los nombres de los satélites.

Where the ISS at? puede proporcionar datos orbitales para una consulta explícita de la ISS o ser una alternativa parcial para estaciones. No reemplaza a ningún otro grupo. Se ignoran respuestas previas que solo contengan la ISS cuando se guardaron para grupos incompatibles; siguen disponibles las entradas de caché validadas de la fuente correcta.

Cuando CelesTrak rechaza la consulta del grupo Starlink con HTTP 403, la aplicación deja de solicitar ese grupo a CelesTrak durante al menos dos horas (o el intervalo `Retry-After` si es más largo). Esta pausa persiste al reiniciar la aplicación. Puede seguir mostrándose una caché Starlink validada previamente, junto con su antigüedad y el aviso de uso sin conexión; la pausa no afecta otros grupos ni las consultas individuales por NORAD. Que termine la pausa no garantiza que CelesTrak haya restablecido el acceso.

## Grupos de CelesTrak

Los identificadores de categorías implementados incluyen `stations`, `starlink`, `gps-ops`, `weather`, `noaa`, `goes`, `active`, `science`, `amateur` y `cubesat`. El conjunto estándar de Starlink usa el punto de acceso CSV SupGP de CelesTrak; no se sustituye por la lista GP normal. Los registros CSV se validan como elementos OMM con las mismas comprobaciones orbitales que el JSON GP. Los nombres y formatos siguen la documentación de consultas GP/SupGP de CelesTrak:

- [Formatos de consulta GP de CelesTrak](https://celestrak.org/NORAD/documentation/gp-data-formats.php)
- [Formatos de consulta SupGP de CelesTrak](https://celestrak.org/NORAD/documentation/sup-gp-queries.php)
- [Índice actual de grupos GP](https://celestrak.org/NORAD/elements/index.php?FORMAT=json)

Where the ISS at? documenta un punto de acceso TLE y otro de posiciones con marca de tiempo, e indica un límite aproximado de una solicitud por segundo: [API de Where the ISS at?](https://www.media.wheretheiss.at/w/developer). La documentación actual de N2YO describe marcas de tiempo Unix de segundos enteros para posiciones, acceso mediante clave y presupuestos de transacciones por operación: [API de N2YO](https://www.n2yo.com/api/). Space-Track documenta aquí los puntos de acceso GP JSON y las pautas de uso y limitación de solicitudes: [documentación de la API de Space-Track](https://www.space-track.org/documentation).

## Configuración de proveedores con credenciales

Importe `SpaceTrackProvider` y `N2yoProvider` únicamente desde `server/providers.ts`; nunca importe estos módulos desde una pantalla Expo, el punto de entrada de la aplicación ni el paquete del cliente. Inyecte las credenciales desde la configuración del servidor en sus constructores. Nunca use `EXPO_PUBLIC_*` para credenciales de Space-Track ni para una clave de N2YO, confirme secretos al repositorio, muestre credenciales en pantalla o reenvíe cuerpos de error de origen. No se guardan credenciales en este proyecto. Hay evidencia de una comparación autenticada de N2YO realizada el 2026-11-07; no acredita la alternativa automática de Space-Track.

`createProxyHandler` crea un controlador de solicitudes Node, pero no inicia un servidor. De forma predeterminada, se limita a loopback y solo distribuye rutas fijas de proveedor/operación con entrada JSON acotada; no acepta URL de destino proporcionadas por quien llama. `ProxyProvider` apunta a un punto de acceso proxy fijo e inyectado; se exige HTTPS excepto en localhost. No establezcas `allowRemote` ni expongas el controlador fuera de loopback hasta que el despliegue incorpore autenticación/autorización, TLS, una política de origen/CSRF según corresponda, cuotas de solicitudes, gestión de secretos, monitoreo y un límite de red revisado. Este proxy local no es un sistema de autorización de producción.

<a id="run-the-local-space-track-proxy"></a>
### Ejecutar el proxy local de Space-Track

Desde el directorio `satellite-tracker`, abra una terminal dedicada de PowerShell y ejecute lo siguiente. Ingrese el correo y la contraseña de Space-Track cuando se soliciten. La contraseña se ingresa de forma oculta; ninguno de los dos valores se escribe en un archivo. Mantenga esta terminal abierta mientras realiza las pruebas. Detenga el proceso con Ctrl+C y después cierre la terminal.

```powershell
$env:SPACETRACK_IDENTITY = Read-Host 'Space-Track email'
$secret = Read-Host 'Space-Track password' -AsSecureString
try {
    $env:SPACETRACK_PASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password
    npm run proxy:local
} finally {
    Remove-Item Env:SPACETRACK_IDENTITY, Env:SPACETRACK_PASSWORD -ErrorAction SilentlyContinue
    $secret.Dispose()
}
```

El iniciador escucha solo en `http://127.0.0.1:4178`, requiere JSON en las solicitudes POST y no se comunica con Space-Track hasta recibir una consulta compatible. Desde una segunda terminal, este comando hace una solicitud autenticada a la ISS con la cuenta configurada:

```powershell
$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4178/spacetrack/orbital' `
    -ContentType 'application/json' -Body '{"noradId":25544}'
$response | Select-Object NORAD_CAT_ID, OBJECT_NAME, EPOCH
```

Una respuesta correcta comprueba la conexión con Space-Track a través del proxy local. No demuestra la alternativa automática de CelesTrak (RF-14). Se observó que una consulta en el sitio web de Space-Track tuvo éxito; no se ha probado la alternativa del proxy.

<a id="run-the-local-n2yo-proxy"></a>
### Ejecutar el proxy local de N2YO

En una terminal dedicada de PowerShell, ubicada en `satellite-tracker`, ejecute este bloque. Pegue la clave solo en la solicitud oculta. El iniciador no lee archivos `.env` ni guarda la clave. Antes de reiniciar en el mismo puerto, detenga la instancia anterior.

```powershell
$secret = Read-Host 'N2YO API key' -AsSecureString
try {
    $env:N2YO_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
    npm run proxy:local
} finally {
    Remove-Item Env:N2YO_API_KEY -ErrorAction SilentlyContinue
    $secret.Dispose()
}
```

No hacen falta credenciales de Space-Track para ejecutar N2YO. Para usar ambos proveedores, configure las tres variables en la misma terminal del servidor antes de iniciar el lanzador; para Space-Track se necesitan tanto el correo como la contraseña. Mantenga el proxy en ejecución y use una terminal aparte para el cliente. Detenga el servidor con Ctrl+C y cierre su terminal. Solo se puede pasar a Expo la URL del proxy mediante `EXPO_PUBLIC_PROVIDER_PROXY_URL`; no pase la clave a Expo.

Para comprobar el punto de acceso de posiciones en vivo de N2YO a través del proxy, ejecutá esto desde una segunda terminal de PowerShell. La solicitud usa un observador de ejemplo y una marca de tiempo UTC en segundos enteros, 30 segundos en el futuro:

```powershell
$body = @{
    noradId = 25544
    at = [DateTime]::UtcNow.AddSeconds(30).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
    observer = @{ latitude = 1; longitude = 2; altitudeKm = 0 }
} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4178/n2yo/validation' `
    -ContentType 'application/json' -Body $body
```

Una respuesta correcta confirma que el proxy puede consultar N2YO. RF-15 además requiere registrar una comparación con posiciones SGP4 locales y marcas de tiempo alineadas. El 2026-11-07 se observó una comparación autorizada ISS/N2YO frente a SGP4 para el mismo segundo UTC: separación 3D de 9,614017 km y diferencia de altitud de 0,014106 km, a las `2026-11-07T22:58:52Z`. Los elementos tenían 25,726 horas de antigüedad según Where the ISS at?. Esta medición no se obtuvo desde la interfaz del teléfono y no representa una garantía de precisión universal.

## Semántica de validación

Las filas de comparación se generan únicamente a partir de una respuesta del proveedor para el NORAD solicitado y la marca de tiempo exacta. La propagación SGP4 local usa esa marca de tiempo. Las posiciones geodésicas locales y de referencia se convierten a coordenadas ECEF WGS-84 en kilómetros antes de calcular la separación euclidiana 3D; se incluyen como componentes opcionales la distancia superficial y la diferencia de altitud. La fila del informe conserva el proveedor, el identificador NORAD, la marca de tiempo solicitada, la época de los elementos y su antigüedad. No se inventan mediciones de validación en vivo: la comparación registrada arriba solo corresponde a esa observación puntual.

## Ventana de solicitudes de validación de N2YO

Las posiciones de N2YO comienzan en el segundo UTC actual del proveedor y admiten como máximo 300 muestras. El adaptador del servidor acepta marcas de tiempo en segundos enteros, desde el segundo actual hasta +299 segundos; solicita una cantidad inclusiva de muestras, convierte la altura del observador de kilómetros a metros y exige una coincidencia exacta de NORAD y marca de tiempo. Las solicitudes históricas o fuera de la ventana fallan antes del transporte. El retraso de red o la diferencia entre relojes aún pueden dejar una muestra casi actual sin disponibilidad; se informa esa situación y nunca se compara silenciosamente con otro instante. Para una validación en vivo, usá una marca de tiempo UTC poco posterior al momento actual. N2YO describe la altura del observador como altura sobre el nivel del mar; el modelo del observador usa altura elipsoidal. No se aplica una corrección de geoide, por lo que el acimut/elevación de N2YO no se usa como validación topocéntrica de precisión; el módulo compara únicamente posiciones satelitales 3D. Tanto las solicitudes orbitales como las de validación propagan la cancelación.

Referencia: [documentación de posiciones de N2YO](https://www.n2yo.com/api/). La comparación autenticada observada está fechada y acotada a una única muestra; no establece una precisión general.
