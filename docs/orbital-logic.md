# Lógica orbital y supuestos numéricos

Todas las horas públicas son valores `Date` de JavaScript interpretados como UTC; los ángulos están expresados en grados y las distancias en kilómetros. La propagación SGP4 y las conversiones de subpunto/topocéntricas delegan en la implementación fijada de `satellite.js` a través de `src/orbit.ts`.

## Predicción de pases

`predictPasses` sondea ambos extremos del intervalo configurable y su punto medio, por lo que la separación efectiva entre muestras es de 30 segundos con la configuración predeterminada. Luego refina por bisección los cruces del umbral y busca la máxima elevación de cada pase con una búsqueda local de sección áurea. Ambos refinamientos se detienen al alcanzar la tolerancia temporal solicitada (1 segundo de forma predeterminada). Devuelve `AOS`, `LOS`, el instante y el azimut de máxima elevación, y muestras de azimut y elevación para la carta polar. Un `AOS` nulo significa que el pase ya estaba en curso al comenzar el análisis; un `LOS` nulo indica que seguía en curso al final. Si ambos son nulos, el satélite se mantuvo por encima del umbral durante todo el intervalo. El trabajo está acotado por `maxSamples` y `maxPasses`; los análisis largos ceden el control al bucle de eventos de JavaScript y respetan `AbortSignal`.

El muestreo numérico no garantiza detectar todos los cruces del umbral. Puede omitirse un pase más breve que la mitad del intervalo configurado, en especial uno rasante que empieza y termina entre dos muestras. Reducir el intervalo mejora la resolución a costa de más cálculos. El resultado representa únicamente visibilidad geométrica: no determina si el satélite está iluminado, si el observador está a oscuras ni si el pase es visible a simple vista.

## Trayecto terrestre y cobertura

`generateGroundTrack` deriva el período orbital del movimiento medio OMM y toma muestras de un período completo centrado en la época solicitada. El paso predeterminado es de 45 segundos, ajustable entre 30 y 60 segundos. Las muestras se agrupan en polilíneas separadas cuando las longitudes sucesivas difieren en más de 180 grados; la aplicación puede representar esos segmentos sin una cuerda que atraviese el mapa por el antimeridiano. Un presupuesto explícito de muestras rechaza solicitudes que excedan el máximo configurado.

`calculateFootprint` usa una Tierra esférica con radio medio de 6371.0088 km y la geometría del horizonte/máscara de elevación para la altitud del satélite y la elevación mínima. Devuelve el radio del casquete terrestre y vértices geográficos ordenados por rumbo; la longitud se envuelve al rango [-180, 180] y la fórmula esférica directa de destino sigue definida en los polos. No incluye el achatamiento del elipsoide, el terreno, la refracción atmosférica ni las restricciones fuera del nadir del satélite. `projectSkyPosition` proporciona únicamente coordenadas de círculo unitario (norte arriba, este a la derecha y cenit en el centro); no representa SVG.

## Lotes de constelaciones

`propagateConstellation` conserva el orden de entrada, rechaza los lotes que superan el límite antes de procesarlos, cede el control de forma cooperativa entre lotes y registra los fallos por objeto sin descartar las posiciones válidas. Quien llama es responsable de seleccionar el subconjunto y debería mantener el límite configurado en un valor adecuado para el hilo de interfaz y el dispositivo.
