# Interfaces de cálculo de mapas y constelaciones

Estos módulos devuelven datos; no dibujan mapas ni cambian pantallas.

`generateGroundTrack` toma muestras de un período orbital completo, centrado en la fecha solicitada, con un intervalo predeterminado de 45 segundos. Divide las polilíneas cuando la diferencia entre longitudes consecutivas supera los 180 grados. Un límite de muestras rechaza las solicitudes que exigirían demasiado trabajo.

`calculateFootprint` devuelve el radio de un casquete esférico de cobertura y los vértices geográficos del límite para una altitud y elevación mínima. El radio terrestre usado es 6371.0088 km. No se incluyen el terreno, la refracción, el achatamiento terrestre ni las restricciones de antena. El recorte de polígonos en el borde del mapa es responsabilidad de la capa de presentación; los vértices que cruzan el límite de longitudes no deben unirse a ciegas a través del antimeridiano.

`projectSkyPosition` devuelve coordenadas polares de círculo unitario: norte arriba, este a la derecha y el cenit en el centro. No dibuja SVG.

`propagateConstellation` limita la cantidad de objetos, cede el control entre lotes, conserva el orden de entrada e informa los errores de propagación individuales sin descartar los resultados válidos. Quien llama selecciona un subconjunto acotado adecuado para el dispositivo. Los cálculos usan la función local existente `track` y nunca solicitan posiciones remotas en cada fotograma.

Verificación: `node --import tsx --test tests/geometry.test.ts tests/constellation.test.ts`. El rendimiento en dispositivos y la representación visual requieren comprobaciones independientes de la interfaz.
