export type MeetTurn = {
  id: string;
  atSeconds: number;
  speaker: 'investor' | 'founder';
  text: string;
};

export const MEET_TRANSCRIPT: readonly MeetTurn[] = [
  { id: 'intro', atSeconds: 0, speaker: 'investor', text: 'Hola, Mateo. Cuéntame cómo va la tracción de Nébula Salud.' },
  {
    id: 'traction', atSeconds: 6, speaker: 'founder',
    text: 'Al 31 de octubre de 2026 teníamos 42 clientes de pago. En octubre de 2026 registramos 32.000 euros de ingresos recurrentes mensuales.',
  },
  {
    id: 'investor-context', atSeconds: 15, speaker: 'investor',
    text: 'Otra empresa que vimos tenía 200 clientes de pago. ¿Qué nos podéis contar sobre retención?',
  },
  {
    id: 'retention', atSeconds: 23, speaker: 'founder',
    text: 'La retención a 90 días fue del 94 % en el tercer trimestre de 2026. Esperamos llegar a 100 clientes de pago en 2027.',
  },
  { id: 'question', atSeconds: 33, speaker: 'investor', text: '¿Habéis firmado ya algún piloto con un hospital?' },
  {
    id: 'pilot', atSeconds: 38, speaker: 'founder',
    text: 'En octubre de 2026 firmamos un piloto con el Hospital Mirador. Creo que es nuestra oportunidad más interesante.',
  },
];
