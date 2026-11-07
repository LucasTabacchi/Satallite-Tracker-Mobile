export function notificationCopy(name: string, leadMinutes: number): { title: string; body: string } {
  return { title: `Próximo pase: ${name}`, body: `El pase comienza en ${leadMinutes} ${leadMinutes === 1 ? 'minuto' : 'minutos'}.` };
}
