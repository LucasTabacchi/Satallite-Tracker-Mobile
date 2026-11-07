# Mapa satelital nativo sin conexión

`OrbitMap` es un componente de presentación puro de React Native SVG. Acepta resultados de geometría local existentes y no realiza accesos a la red. `position` se muestra como un marcador que se interpola entre muestras de telemetría cada dos segundos siguiendo el arco más corto de longitud; el marcador se refleja en el borde del mapa para que cruzar el antimeridiano nunca produzca una animación que atraviese el mundo entero. Los ajustes de accesibilidad para reducir el movimiento desactivan la interpolación.

```tsx
const footprint = calculateFootprint(telemetry.altitudeKm, minimumElevation, telemetry.latitude, telemetry.longitude);
<OrbitMap
  position={telemetry}
  groundTrack={groundTrack}
  footprint={calculateFootprint(position.altitudeKm, minimumElevation, position.latitude, position.longitude)}
  observer={observer}
  constellation={members}
  onSelectSatellite={setSelectedNoradId}
/>
```

Las propiedades opcionales `groundTrack`, `footprint`, `observer` y `constellation` reutilizan `src/geometry.ts`, `src/orbit.ts` y `src/constellation.ts`; el mapa no vuelve a calcular la geometría orbital ni de cobertura. El mapa del mundo usa una proyección equirectangular de longitud/latitud. Las capas de trayecto terrestre y huella se pueden activar por separado; el zoom tiene controles accesibles y la representación de constelaciones está limitada a 50 marcadores seleccionables al tocarlos.

## Datos terrestres incluidos

El archivo generado `src/ui/world-land.json` contiene anillos simplificados a escala Natural Earth 1:110m para polígonos terrestres físicos y metadatos de origen. El conjunto de datos terrestre de Natural Earth está disponible en su [página de vectores físicos a 110m](https://www.naturalearthdata.com/downloads/110m-physical-vectors/) y Natural Earth indica que sus datos ráster y vectoriales son de [dominio público](https://www.naturalearthdata.com/about/terms-of-use/). El archivo comprimido se sirve desde `https://naturalearth.s3.amazonaws.com/110m_physical/ne_110m_land.zip`; los metadatos generados registran su SHA-256 para que se puedan auditar los bytes.

Para regenerar el JSON versionado, use Node 24:

```sh
node scripts/import-world-land.cjs
```

Para importar un archivo oficial ya descargado sin otra solicitud de red, pase su ruta como primer argumento:

```sh
node scripts/import-world-land.cjs /path/to/ne_110m_land.zip
```

El importador utiliza únicamente módulos integrados de Node para leer el ZIP y los registros de polígonos ESRI. El archivo incluido conserva los anillos de polígonos y el hash del archivo de origen. No se usan teselas de mapa, geocodificación ni descargas de conjuntos de datos durante la ejecución.

## Limitaciones

Los contornos 1:110m incluidos son una vista general, no costas aptas para navegación. La proyección equirectangular conserva intencionalmente el espaciado uniforme de longitud/latitud y distorsiona las áreas cerca de los polos. La huella es la aproximación existente de casquete esférico; no incluye terreno, achatamiento elipsoidal ni refracción atmosférica. Se omiten de la representación los elementos de constelación que exceden los primeros 50, y una nota de estado en español indica ese límite.
