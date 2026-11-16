// @vitest-environment happy-dom
import type { Desenho } from '../src/nucleo/tipos';
import { desenharSvg } from '../src/tela/previa';

const D: Desenho = {
  quadro: { w: 124.6, h: 113 },
  prims: [
    { t: 'linha', camada: 'ESTRADA', pts: [[0, 0], [124.6, 0], [124.6, 113], [0, 113]], fechada: true },
    { t: 'linha', camada: 'ROTA', pts: [[10, 20], [30, 40]], largura: 0.22 },
    { t: 'circulo', camada: 'LOCAL_DA_OBRA', centro: [50, 10], r: 1.329 },
    { t: 'texto', camada: 'TEXTO', id: 'cidade:JARDIM', txt: 'JARDIM', centro: [40, 100], h: 1.152 },
    { t: 'texto', camada: 'TITULO', id: 'titulo', txt: 'SEM ESCALA', centro: [100, 90], h: 1.152 },
  ],
};

test('desenharSvg: uma <g> por camada, texto com o id em data-id, y invertido', () => {
  const svg = desenharSvg(D);
  expect(svg.getAttribute('viewBox')).toBe('0 0 124.6 113');
  const gs = [...svg.querySelectorAll('g')];
  expect(gs.map((g) => g.getAttribute('data-camada'))).toEqual([
    'ESTRADA', 'ESTRADA_EIXO', 'CARROÇAL', 'ROTA', 'CIDADE', 'TEXTO', 'LOCAL_DA_OBRA', 'TITULO',
  ]);
  const cor = (c: string) => svg.querySelector(`g[data-camada="${c}"]`)!.getAttribute('stroke');
  expect([cor('ESTRADA'), cor('ESTRADA_EIXO'), cor('CARROÇAL'), cor('ROTA'), cor('LOCAL_DA_OBRA')]).toEqual([
    '#ff7f00', '#ffffff', '#ff7f00', '#ffff00', '#ff0000',
  ]);

  const t = svg.querySelector('text[data-id="cidade:JARDIM"]')!;
  expect(t.parentElement!.getAttribute('data-camada')).toBe('TEXTO');
  expect(t.textContent).toBe('JARDIM');
  expect(Number(t.getAttribute('x'))).toBeCloseTo(40, 9);
  // DXF: TEXT alinhado ao meio (72=1, 73=2), linha de base h/2 abaixo do centro; altura = maiúscula do Arial
  expect(Number(t.getAttribute('y'))).toBeCloseTo(13 + 1.152 / 2, 4);
  expect(t.hasAttribute('dominant-baseline')).toBe(false);
  expect(t.getAttribute('text-anchor')).toBe('middle');
  expect(t.getAttribute('font-family')).toContain('Arial');
  // font-size é o "em"; a maiúscula do Arial tem 1467 de 2048 do em
  expect(Number(t.getAttribute('font-size'))).toBeCloseTo((1.152 * 2048) / 1467, 4);

  const rota = svg.querySelector('g[data-camada="ROTA"] polyline')!;
  expect(rota.getAttribute('points')).toBe('10,93 30,73');
  const quadro = svg.querySelector('g[data-camada="ESTRADA"] polygon')!;
  expect(quadro.getAttribute('points')).toBe('0,113 124.6,113 124.6,0 0,0');
  const obra = svg.querySelector('g[data-camada="LOCAL_DA_OBRA"] circle')!;
  expect([obra.getAttribute('cx'), obra.getAttribute('cy'), obra.getAttribute('r')]).toEqual(['50', '103', '1.329']);
});

test('linha soPrevia sai tracejada', () => {
  const d: Desenho = {
    quadro: D.quadro,
    prims: [
      { t: 'linha', camada: 'ROTA', pts: [[10, 20], [30, 40]], largura: 0.22 },
      { t: 'linha', camada: 'ROTA', pts: [[50, 20], [70, 40]], largura: 0.22, soPrevia: true },
    ],
  };
  const [normal, previa] = [...desenharSvg(d).querySelectorAll('g[data-camada="ROTA"] polyline')];
  expect(normal.hasAttribute('stroke-dasharray')).toBe(false);
  expect(previa.getAttribute('points')).toBe('50,93 70,73');
  expect(previa.getAttribute('stroke-dasharray')).toMatch(/^[\d.]+ [\d.]+$/);
});
