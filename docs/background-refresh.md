# Actualización en segundo plano e integración de recordatorios

`src/refresh.ts` coordina la configuración persistida, la capa de datos, las predicciones locales acotadas y la reconciliación de notificaciones. Acepta entre 1 y 5 satélites seleccionados de un grupo del catálogo, un observador explícito, una elevación geométrica mínima y un plazo de anticipación mayor que 0 y menor o igual a 1440 minutos. Analiza 48 horas con pasos gruesos de 60 segundos (sondeos en el punto medio y límites refinados) y conserva las 60 notificaciones futuras más próximas entre todos los satélites seleccionados.

El registro de configuración está versionado. La configuración inválida o dañada falla antes de cualquier operación de red o notificación. El coordinador serializa las llamadas de configuración y actualización, y toma una instantánea de la configuración aceptada. Si faltan satélites seleccionados o falla un cálculo, conserva la programación de notificaciones existente. Las advertencias de caché obsoleta se devuelven en lugar de ocultarse.

`src/native/background.ts` proporciona AsyncStorage, proveedores públicos y adaptadores de Expo. `index.js` define la tarea sin interfaz antes de cargar Expo Router, sin cambiar una pantalla ni solicitar permisos durante la importación. Una interfaz futura puede llamar explícitamente a:

```ts
import { enablePassReminders, disablePassReminders, refreshCoordinator } from '../src/native/background';

await enablePassReminders({
  observer: { latitude: -32.48, longitude: -58.23, altitudeKm: 0.02 },
  group: 'stations', noradIds: [25544], leadMinutes: 10, minimumElevationDeg: 10,
});
await refreshCoordinator.refresh(); // Comprobación en primer plano, aún sujeta al TTL de la caché.
await disablePassReminders(); // Cancela solo los recordatorios de esta función.
```

Las coordenadas anteriores son ilustrativas, no una ubicación detectada del usuario. Obtenga un observador actualizado mediante la acción explícita de GPS o una entrada manual. El trabajo en segundo plano usa el último observador guardado explícitamente y no rastrea la ubicación en segundo plano. Para cambiar la ubicación o los satélites seleccionados, se debe volver a llamar a la API de configuración.

El registro solicita un intervalo mínimo de 12 horas; los datos orbitales en caché tienen un TTL predeterminado de 24 horas. La actualización también está disponible en primer plano. [Expo BackgroundTask](https://docs.expo.dev/versions/latest/sdk/background-task/) programa de forma inexacta, bajo el control del sistema operativo. No puede garantizar un plazo de actualización, la ejecución tras forzar el cierre ni la entrega ininterrumpida. La tarea interrumpe los cálculos y el trabajo de red al vencer el plazo o después de 60 segundos. [Las notificaciones locales](https://docs.expo.dev/versions/latest/sdk/notifications/) usan activadores por fecha con entrega de mejor esfuerzo, no alarmas exactas.

La programación nativa, el almacenamiento y el registro de tareas no forman una transacción atómica. Los errores se propagan; un reintento explícito posterior reconcilia el estado real del sistema operativo. Si falla el registro después de guardar la configuración, la persona que llama recibe un error y puede reintentar o desactivar la función. Las solicitudes de permisos solo ocurren en las API explícitas de primer plano, nunca durante una ejecución en segundo plano. Denegar permisos no elimina los recordatorios existentes. La desactivación persiste el estado desactivado antes de cancelar, para que ninguna actualización en cola pueda recrear los recordatorios.

Las pruebas ejercitan estas interfaces mediante puertos nativos simulados. Una exportación correcta de Metro no demuestra el funcionamiento en un dispositivo. Aún es necesario probar en compilaciones de desarrollo de Android/iOS los diálogos de permisos, la calibración de la brújula, la disponibilidad de la altitud GPS, la ejecución en segundo plano del sistema operativo y la entrega de notificaciones. Las personas que llaman desde primer plano invocan estas API de forma explícita; la aceptación en dispositivos físicos sigue pendiente.

## Orden de intención de los recordatorios

Las acciones de recordatorios en primer plano usan `createReminderActions`. Cada nueva acción para activar o desactivar invalida la intención anterior e interrumpe la actualización que esté en curso. Las solicitudes de permisos se ejecutan fuera de la cola de efectos secundarios, por lo que una cancelación puede completarse sin esperar una respuesta a un diálogo de permisos. Conceder un permiso solicitado anteriormente no puede restaurar la configuración ni registrar tareas después de una cancelación.

Los cambios de configuración y los efectos de actualización se serializan mediante el coordinador existente. Un registro que ya comenzó puede finalizar antes de que la desactivación en cola lo elimine; la cancelación completada es el punto observable a partir del cual la solicitud anterior ya no puede restaurar los recordatorios. El controlador también rechaza la publicación de resultados o errores obsoletos, en vez de limitarse a ocultar los efectos nativos tras un interruptor cambiado.

Las pruebas de regresión llaman a las acciones nativas exportadas reales con puertos del sistema operativo y del proveedor sustituidos. Cubren la cancelación mientras hay un permiso pendiente, concesiones fuera de orden, activación/desactivación normal y denegación sin cambios en los datos guardados. Estas pruebas no demuestran la entrega de notificaciones en dispositivos físicos ni la puntualidad de las tareas en segundo plano.
