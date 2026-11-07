# Lógica del dispositivo y de los recordatorios

## Observador y brújula

`src/device.ts` mantiene comprobables sin hardware la gestión de permisos y ubicación del observador y la guía de brújula. El adaptador nativo de `src/native/device.ts` solicita ubicación en primer plano solo cuando se llama explícitamente a `readDeviceObserver()`. La denegación de permisos y los errores nativos se propagan; se rechaza una ubicación GPS sin altitud para que quien llama pueda ofrecer coordenadas manuales o una opción explícita de incertidumbre, en lugar de suponer silenciosamente que la altitud es cero. El `parseObserver` existente valida los rangos de coordenadas y convierte la altitud GPS de metros a kilómetros.

La guía de brújula acepta únicamente el rumbo al norte verdadero de Expo. Se rechazan `trueHeading === -1` y una precisión no positiva; nunca se sustituye por el rumbo magnético. El giro con signo devuelto es la rotación más corta hacia el acimut objetivo, positiva en sentido horario, e incluye además la elevación prevista del objetivo. Las actualizaciones de rumbo usan suscripciones al sensor en primer plano; quien llama debe eliminar la suscripción devuelta cuando termine.

## Recordatorios de pases

`planReminders` acepta `PassWindow`s geométricas de radio y crea como máximo 60 recordatorios estables `tp7:pass:<noradId>:<aosMs>`. Omite ventanas sin un `AOS` futuro y activadores cuyo plazo de anticipación ya transcurrió; después ordena y deduplica los resultados. `createReminderScheduler` valida todo el lote deseado antes de modificar el estado nativo, comprueba los permisos existentes sin solicitar otros, programa los reemplazos antes de cancelar los recordatorios propios obsoletos y serializa las llamadas concurrentes. Se conservan las solicitudes de notificación no relacionadas. Los errores de operaciones nativas se propagan; una reconciliación posterior lee el estado programado nativo y puede converger sin usar `cancelAll`.

La función nativa explícita `requestReminderPermission()` configura primero el canal de Android y luego solicita el permiso. El adaptador de reconciliación compatible con segundo plano nunca solicita permisos. La programación de activadores por fecha de Expo es de mejor esfuerzo: la aplicación no afirma que las alarmas sean exactas ni garantiza que el sistema operativo presente una notificación programada.
