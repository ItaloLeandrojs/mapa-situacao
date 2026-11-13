import type { Pt } from './tipos.ts';

// UTM fuso 24 Sul, SIRGAS 2000 (GRS80), série de Krüger. Meridiano central -39.
const A_EQ = 6378137.0;
const ACHAT = 1 / 298.257222101;
const K0 = 0.9996;
const N = ACHAT / (2 - ACHAT);
const A_RETIFICADO = (A_EQ / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
const ALFA = [
  N / 2 - (2 * N ** 2) / 3 + (5 * N ** 3) / 16,
  (13 * N ** 2) / 48 - (3 * N ** 3) / 5,
  (61 * N ** 3) / 240,
];
const C = (2 * Math.sqrt(N)) / (1 + N);

export function paraUtm(lon: number, lat: number): Pt {
  const fi = (lat * Math.PI) / 180;
  const dl = ((lon + 39.0) * Math.PI) / 180;
  const t = Math.sinh(Math.atanh(Math.sin(fi)) - C * Math.atanh(C * Math.sin(fi)));
  const xi = Math.atan2(t, Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let e = eta;
  let n = xi;
  ALFA.forEach((aj, i) => {
    const j = i + 1;
    e += aj * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    n += aj * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  });
  return [500000.0 + K0 * A_RETIFICADO * e, 10000000.0 + K0 * A_RETIFICADO * n];
}
