# Mitigación de la salida de Expo CLI local

Este es un control de recursos mantenido por el proyecto para la salida de complementos de herramientas de desarrollo, no una bifurcación de Zod. Expo 58.0.23 usa CLI 58.1.19, que reemplaza la dependencia de producción Zod por `@expo/schema-utils`, que no tiene dependencias propias. La prueba de regresión de dependencias revisa todo el archivo de bloqueo para detectar versiones afectadas por [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); no silencia el aviso. Los descriptores de complementos, su ejecución arbitraria y la aceptación en dispositivos físicos quedan fuera del alcance de este control.

## Política

`scripts/cli-output-budget.cjs` protege el recopilador de resultados de CLI antes de la validación con schema-utils. CLI 58.1.19 trasladó el recopilador a `start/server/devtools/` y ya no realiza la segunda validación anterior del esquema de salida MCP. Por eso, el parche se aplica solo al recopilador; el esquema de salida del proveedor no cambia.

- El JSON sin procesar se limita a 1 MiB en UTF-8 antes de `JSON.parse`.
- Antes de validar el esquema: longitud máxima de arreglos de 1.024, profundidad 16 (la raíz tiene profundidad cero), 4.096 valores visitados y 1 MiB de datos de cadenas/claves en UTF-8. Se rechazan objetos cíclicos o con alias; JSON no puede expresar esas referencias.
- El texto plano se limita a 1.024 líneas no vacías antes de dividirse en registros de salida.
- Un recopilador conserva como máximo 1 MiB de entrada sin procesar, 1 MiB de resultados serializados y 1.024 registros, además de un único aviso acotado de truncamiento. Tras truncar, ignora las salidas posteriores.
- La entrada que supera el límite devuelve un error explícito `Plugin output rejected:` antes de la validación. La salida dentro del límite conserva el análisis, los errores, las devoluciones de llamada y el comportamiento de salida del CLI de esta versión.

Estos límites locales son deliberadamente conservadores; los complementos que necesiten generar más contenido deben paginarlo o escribir archivos. Este control no pone en un entorno aislado un fragmento entrante ya asignado ni la ejecución de complementos arbitrarios. Mantenga confiable el código de los complementos.

## Instalación y mantenimiento

`npm ci` / `npm install` ejecuta el script local `postinstall`. Antes de escribir, este comprueba CLI 58.1.19 y el SHA-256 de su recopilador y esquema. Las versiones o los bytes desconocidos fallan de forma segura, sin escribir parches. Solo se modifican el recopilador y un asistente local; el instalador no altera las versiones de dependencias, el archivo de bloqueo ni el esquema oficial. Las escrituras reemplazan archivos individuales de forma atómica; se puede volver a ejecutar una instalación parcialmente completada para los mismos bytes compatibles. La actualización independiente del parche de Expo elimina la ruta de dependencia vulnerable.

```sh
npm run mitigation:check
node scripts/patch-expo-cli.cjs --help
```

Si la instalación usa `--ignore-scripts`, la mitigación no se instala automáticamente: ejecute `node scripts/patch-expo-cli.cjs` explícitamente y luego verifíquela. Vuelva a validar el parche y sus pruebas antes de cambiar Expo CLI; no reemplace los hashes esperados solo para eludir un fallo.

## Pruebas de regresión aisladas (Windows)

```powershell
npm run test:cli-mitigation
```

El ejecutor requiere el motor local de Docker para Linux y la imagen de Node fijada por digest y ya almacenada en caché que se nombra en `scripts/test-cli-mitigation.ps1`. Nunca descarga una imagen, instala paquetes ni ejecuta los fixtures del proveedor en el host como alternativa. El punto de entrada predeterminado de la aplicación en caché se reemplaza por `env -i` y Node; no se inicia la aplicación de la imagen.

Controles: red deshabilitada; usuario sin privilegios; raíz de solo lectura y entradas acotadas de solo lectura; sin capacidades; sin nuevos privilegios; sin heredar el entorno del host, credenciales, directorio personal ni sockets; 256 MiB de memoria, sin intercambio adicional, media CPU, 32 procesos, límite de archivo de un MiB, 128 descriptores, 30 segundos de CPU, `tmpfs` temporal de 32 MiB y límite de pared de 60 segundos supervisado. El contenedor de prueba único se elimina al finalizar. Los registros de prueba se conservan en una carpeta única del directorio temporal del sistema.

Las pruebas copian al espacio temporal del contenedor únicamente los archivos de fixtures del proveedor requeridos y enlazan las dependencias instaladas de solo lectura para resolver schema-utils. Cubren el rechazo antes de las llamadas al esquema, los límites de texto plano y estructura, el truncamiento agregado, la equivalencia diferencial de salidas normales, la idempotencia del instalador y su rechazo sin escrituras. El mismo ejecutor comprueba que el archivo de bloqueo no contenga una versión de Zod afectada y que se mantenga en SDK 58. `-Baseline` ejecuta las aserciones de límites de salida contra los bytes originales del proveedor; se espera que esas pruebas de rechazo fallen incluso en el CLI sin Zod, porque el esquema de salida sigue sin tener límites. No se usa ninguna carga deliberadamente ilimitada que pueda agotar la memoria.

## Reversión

Para quitar únicamente los límites locales de salida, elimine las entradas de su hook/comprobación de npm y los scripts y pruebas específicos del control; luego haga una instalación limpia de dependencias para restaurar los bytes originales del proveedor. Conserve la actualización compatible de Expo, el archivo de bloqueo y la prueba de regresión de seguridad de dependencias. No quite otros cambios de interfaz ni credenciales. Quitar el control no requiere restaurar la dependencia vulnerable anterior.
