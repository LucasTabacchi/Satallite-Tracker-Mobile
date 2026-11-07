import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createNativeApplication, readDeviceObserver, watchDeviceHeading } from '../native/application';
import type { ApplicationController, ApplicationState } from '../application/controller';
import { DeviceLocationTimeoutError, type HeadingGuidance } from '../device';

const GPS_PERMISSION_PENDING = 'Comprobando permiso de ubicación…';
const GPS_PENDING = 'Buscando ubicación del dispositivo…';

/** Owns foreground state and removes every native listener on teardown. */
export function useOrbit(publicProxyUrl?: string) {
  const controller = useRef<ApplicationController | null>(null);
  const [state, setState] = useState<ApplicationState>();
  const [actionError, setActionError] = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [heading, setHeading] = useState<HeadingGuidance>();
  const [headingError, setHeadingError] = useState('');
  const [headingEnabled, setHeadingEnabled] = useState(false);
  const mounted = useRef(false), headingRevision = useRef(0), gpsRevision = useRef(0);
  const headingSubscription = useRef<{ remove(): void } | undefined>(undefined);
  const stopHeading = () => {
    headingRevision.current++;
    headingSubscription.current?.remove();
    headingSubscription.current = undefined;
    if (mounted.current) { setHeadingEnabled(false); setHeading(undefined); setHeadingError(''); }
  };
  useEffect(() => {
    mounted.current = true;
    let app: ApplicationController;
    try { app = createNativeApplication({ publicProxyUrl }); }
    catch (error) { setActionError(`Configuración no válida: ${String(error)}`); return () => { mounted.current = false; }; }
    controller.current = app;
    const unsubscribe = app.subscribe(() => setState(app.getState()));
    app.setActive(AppState.currentState === 'active');
    setState(app.getState());
    void app.initialize().catch(error => { if (mounted.current) setActionError(`No se pudo iniciar: ${String(error)}`); });
    const lifetime = AppState.addEventListener('change', status => {
      app.setActive(status === 'active');
      if (status !== 'active') {
        gpsRevision.current++;
        setGpsStatus(current => current === GPS_PENDING || current === GPS_PERMISSION_PENDING
          ? 'Búsqueda de ubicación interrumpida. Puedes volver a intentarlo.' : current);
        stopHeading();
      }
    });
    return () => {
      mounted.current = false;
      gpsRevision.current++;
      stopHeading(); lifetime.remove(); unsubscribe(); app.dispose(); controller.current = null;
    };
  }, [publicProxyUrl]);
  const run = (operation: (app: ApplicationController) => unknown) => {
    setActionError('');
    const app = controller.current;
    if (!app) return;
    Promise.resolve().then(() => operation(app)).catch(error => {
      if (mounted.current) setActionError(`No se pudo completar la acción: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  const requestGps = async () => {
    const revision = ++gpsRevision.current;
    setGpsStatus(GPS_PERMISSION_PENDING);
    try {
      const { observer, source } = await readDeviceObserver(() => {
        if (mounted.current && revision === gpsRevision.current) setGpsStatus(GPS_PENDING);
      });
      if (!mounted.current || revision !== gpsRevision.current) return;
      controller.current?.setObserver(observer, 'device');
      setGpsStatus(source === 'recent' ? 'Se aplicó una ubicación reciente del dispositivo.' : 'Ubicación actual del dispositivo aplicada.');
    } catch (error) {
      if (mounted.current && revision === gpsRevision.current) {
        setGpsStatus(error instanceof DeviceLocationTimeoutError
          ? error.phase === 'permission'
            ? 'Android no confirmó el permiso a tiempo. Puedes volver a intentarlo.'
            : 'No se pudo obtener la ubicación a tiempo. Puedes volver a intentarlo o ingresar las coordenadas manualmente.'
          : `GPS no disponible. Puede ingresar coordenadas manuales. ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const startHeading = async () => {
    stopHeading();
    const revision = headingRevision.current;
    const target = () => {
      const position = controller.current?.getState().position;
      if (position?.azimuthDeg === undefined || position.elevationDeg === undefined) throw new Error('Seleccione un satélite y configure su ubicación.');
      return { azimuthDeg: position.azimuthDeg, elevationDeg: position.elevationDeg };
    };
    try {
      target(); setHeadingEnabled(true);
      const subscription = await watchDeviceHeading((guidance, error) => {
        if (!mounted.current || revision !== headingRevision.current) return;
        setHeading(guidance ?? undefined);
        setHeadingError(error ? `Rumbo no disponible: ${error.message}` : '');
      }, target);
      if (!mounted.current || revision !== headingRevision.current) subscription.remove();
      else headingSubscription.current = subscription;
    } catch (error) {
      if (mounted.current && revision === headingRevision.current) {
        setHeadingEnabled(false);
        setHeadingError(`Brújula no disponible: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  return { state, run, actionError, gpsStatus, requestGps, startHeading, stopHeading, heading, headingError, headingEnabled };
}
