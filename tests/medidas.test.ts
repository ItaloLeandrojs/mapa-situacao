import { escala, MEDIDAS } from '../src/nucleo/medidas';
import { JANELA_V4 } from './fixtures/v4';

const Q = { w: 124.6, h: 113 };

test('escala da v4', () => {
  const e = escala(JANELA_V4, Q);
  expect(e.k).toBeCloseTo(0.0017717, 6);
  expect(e.mPorU).toBeCloseTo(564.4, 0);
});

test('paraU e paraMetros são inversas; o canto SW da janela cai dentro da área útil', () => {
  const e = escala(JANELA_V4, Q);
  const p: [number, number] = [480000, 9180000];
  const volta = e.paraMetros(e.paraU(p));
  expect(volta[0]).toBeCloseTo(p[0], 6);
  expect(volta[1]).toBeCloseTo(p[1], 6);
  const sw = e.paraU([JANELA_V4.x0, JANELA_V4.y0]);
  const ne = e.paraU([JANELA_V4.x1, JANELA_V4.y1]);
  expect(sw[0]).toBeGreaterThanOrEqual(MEDIDAS.margem - 1e-9);
  expect(sw[1]).toBeGreaterThanOrEqual(MEDIDAS.margem - 1e-9);
  expect(ne[0]).toBeLessThanOrEqual(Q.w - MEDIDAS.margem + 1e-9);
  expect(ne[1]).toBeLessThanOrEqual(Q.h - MEDIDAS.topo + 1e-9);
  // v4 é limitada pela altura: sobra folga dos lados, centrada
  expect(sw[1]).toBeCloseTo(MEDIDAS.margem, 6);
  expect(sw[0] + (Q.w - ne[0])).toBeCloseTo(2 * sw[0], 6);
});
