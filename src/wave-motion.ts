/** Visual travel vector: model bearings are FROM; wave crests travel the other way. */
export function waveTravel(directionFrom: number): Readonly<{ x: number; y: number }> {
  const angle = directionFrom * Math.PI / 180;
  return { x: -Math.sin(angle), y: Math.cos(angle) }; // screen y points south
}
/** Display speed only. Not a physical propagation speed or a beach-wave simulation. */
export const waveVisualSpeed = (period: number): number => Math.max(0.55, Math.min(1.8, period * 0.09));
