# Informe de validación de posiciones

El recopilador reproducible es `scripts/validate-live.ts`. Usa los proveedores existentes y `comparePosition`, no una implementación orbital aparte. Requiere invocar explícitamente `--live` y nunca lee credenciales del entorno.

## Comparación observada entre proveedores públicos

El 3 de noviembre de 2026 se completaron correctamente una descarga de elementos orbitales de CelesTrak y tres solicitudes de referencia a Where the ISS at?. Las solicitudes estuvieron separadas por al menos 1,1 segundos. Cada comparación usa el segundo UTC exacto de la referencia y conserva la época y antigüedad orbitales.

- [Informe observado](evidence/validation-2026-11-03T21-21-39-080Z.md)
- [Evidencia orbital y de referencia sin procesar](evidence/validation-2026-11-03T21-21-39-080Z.json)

El primer intento dentro del entorno aislado falló antes de recopilar evidencia. El intento autorizado con acceso a red tuvo éxito; el recopilador no volvió a intentar una solicitud HTTP fallida del proveedor.

## Muestra en vivo de N2YO autorizada

El 7 de noviembre de 2026 se observó una comparación de la ISS con NORAD 25544, calculada en la aplicación mediante SGP4 a partir de elementos orbitales de Where the ISS at? y contrastada con N2YO a través del proxy local configurado en `127.0.0.1:4178`. En el instante `2026-11-07T22:58:52Z`, la época de los elementos era `2026-11-06T21:14:50.459Z` (antigüedad: 25,726 h). La aplicación calculó `(-33.30276°, 127.91116°, 432.73589 km)`; N2YO informó `(-33.35689°, 127.98321°, 432.75000 km)`. La diferencia fue de 9,614017 km en 3D y 0,014106 km en altitud.

Esta observación no incluyó una comparación de interfaz en un dispositivo físico, no generó JSON sin procesar para esta muestra y no establece una precisión universal. Tampoco representa una observación en vivo de Starlink con teléfono ni una prueba de entrega de notificaciones.

## Reproducción

```sh
npx tsx scripts/validate-live.ts --help
npx tsx scripts/validate-live.ts --live --output docs/evidence
```

No invoque esto en pruebas automatizadas ni en cada renderizado de la aplicación. La salida incluye una marca de tiempo y se crea en exclusiva para preservar la evidencia anterior. La disponibilidad de fuentes/descargas depende de servicios externos; los fallos no se reemplazan con coordenadas de ejemplo.

Para incluir N2YO, inicie primero el [proxy local](data-sources.md#run-the-local-n2yo-proxy) con sus credenciales y pase únicamente la URL al recopilador. El comando también solicita los elementos de CelesTrak y las referencias públicas de la ISS:

```sh
npx tsx scripts/validate-live.ts --live --output docs/evidence --proxy http://127.0.0.1:4178
```

Las credenciales deben permanecer en el servidor, fuera del paquete de la aplicación. La comparación de muestra anterior usa el proxy local explícitamente configurado; no equivale a una autorización general para otros proxies ni a un cambio de credenciales.

## Método e interpretación

La métrica es la distancia euclidiana 3D en coordenadas fijas terrestres WGS84, en kilómetros. El error de superficie es una cuerda ECEF a altitud cero, no una distancia geodésica elipsoidal. Las referencias de entrada y la propagación local usan marcas de tiempo idénticas. El observador en (0,0,0) es únicamente un parámetro de cálculo: no afecta el error de posición geodésica ni se presenta como la ubicación del usuario.

La coincidencia entre proveedores públicos no constituye una verdad de terreno independiente: las entradas orbitales pueden compartir origen. Una muestra breve de la ISS no establece precisión para todas las órbitas, elementos obsoletos o naves que maniobran. La consigna no prescribe una tolerancia de precisión de aprobado/reprobado; informe las discrepancias observadas y la antigüedad de la época en lugar de inventar una. Este informe no demuestra visibilidad óptica, funcionamiento en un dispositivo físico ni entrega nativa de notificaciones.

El recopilador solicita el segundo UTC actual. En N2YO, un cambio de segundo durante el tránsito al proxy puede dejar ese instante fuera de la ventana disponible. La muestra documentada arriba se pidió con anticipación y comparó la posición devuelta para ese mismo segundo.

Fuentes: [formato GP de CelesTrak](https://celestrak.org/NORAD/documentation/gp-data-formats.php), [política de uso de CelesTrak](https://celestrak.org/usage-policy.php), [API de Where the ISS at?](https://wheretheiss.at/w/developer).
