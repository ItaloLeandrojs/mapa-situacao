import { chaikin, G } from '../src/nucleo/geom';
import type { PtU } from '../src/nucleo/tipos';

const perto = (a: PtU, b: PtU, tol = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;

test('engrossa de uma linha de comprimento 10 por 1 tem área entre 23 e 23,2', () => {
  const a = G.area(G.engrossa(G.linha([[0, 0], [10, 0]]), 1));
  expect(a).toBeGreaterThan(23);
  expect(a).toBeLessThan(23.2);
});

test('diferenca de linha por polígono devolve só o que sobra', () => {
  const sobra = G.diferenca(G.linha([[0, 0], [10, 0]]), G.caixa(3, -1, 6, 1));
  expect(G.comprimento(sobra)).toBeCloseTo(7, 9);
  const pedacos = G.linhas(sobra)
    .map((l) => [Math.min(l[0][0], l[l.length - 1][0]), Math.max(l[0][0], l[l.length - 1][0])])
    .sort((a, b) => a[0] - b[0]);
  expect(pedacos).toEqual([[0, 3], [6, 10]]);
  // nada do que sobra fica dentro da caixa
  expect(G.comprimento(G.intersecao(sobra, G.caixa(3.001, -1, 5.999, 1)))).toBe(0);
});

test('costura junta duas linhas que se tocam na ponta', () => {
  const duas = G.uniao([G.linha([[0, 0], [5, 0]]), G.linha([[5, 0], [5, 4]])]);
  expect(G.linhas(duas)).toHaveLength(2);
  const uma = G.linhas(G.costura(duas));
  expect(uma).toHaveLength(1);
  expect(uma[0]).toHaveLength(3);
  expect(G.comprimento(G.linha(uma[0]))).toBeCloseTo(9, 9);
  const pontas = [uma[0][0], uma[0][2]];
  expect(pontas.some((p) => perto(p, [0, 0]))).toBe(true);
  expect(pontas.some((p) => perto(p, [5, 4]))).toBe(true);
});

test('semBuracos fecha buraco menor que o mínimo e mantém o maior', () => {
  // quadrado 20 × 20 com um buraco de 1 × 1 e outro de 5 × 5
  const furado = G.diferenca(G.caixa(0, 0, 20, 20), G.uniao([G.caixa(2, 2, 3, 3), G.caixa(10, 10, 15, 15)]));
  expect(G.area(furado)).toBeCloseTo(400 - 1 - 25, 9);
  expect(G.area(G.semBuracos(furado, 4))).toBeCloseTo(400 - 25, 9);
  expect(G.area(G.semBuracos(furado, 30))).toBeCloseTo(400, 9);
  expect(G.area(G.semBuracos(furado, 0.5))).toBeCloseTo(400 - 1 - 25, 9);
});

test('trecho e noMeio em linha quebrada', () => {
  const l: PtU[] = [[0, 0], [3, 0], [3, 4]]; // comprimento 7
  const t = G.trecho(l, 2, 5);
  expect(t).toHaveLength(3);
  expect(perto(t[0], [2, 0])).toBe(true);
  expect(perto(t[1], [3, 0])).toBe(true);
  expect(perto(t[2], [3, 2])).toBe(true);
  expect(perto(G.noMeio(l, 0.5), [3, 0.5])).toBe(true);
  expect(perto(G.noMeio(l, 0), [0, 0])).toBe(true);
  expect(perto(G.noMeio(l, 1), [3, 4])).toBe(true);
});

test('chaikin mantém as pontas e multiplica os pontos', () => {
  const l: PtU[] = [[0, 0], [4, 0], [4, 4]];
  const uma = chaikin(l, 1);
  expect(uma).toHaveLength(6);
  expect(uma[0]).toEqual([0, 0]);
  expect(uma[uma.length - 1]).toEqual([4, 4]);
  expect(perto(uma[1], [1, 0])).toBe(true);
  expect(perto(uma[2], [3, 0])).toBe(true);
  const duas = chaikin(l);
  expect(duas).toHaveLength(12);
  expect(duas[0]).toEqual([0, 0]);
  expect(duas[duas.length - 1]).toEqual([4, 4]);
});

test('envelope de linha quebrada e de geometria vazia', () => {
  expect(G.envelope(G.linha([[1, 5], [4, 2], [3, 7]]))).toEqual([1, 2, 4, 7]);
  expect(G.envelope(G.engrossa(G.ponto([0, 0]), 2))).toEqual([-2, -2, 2, 2]);
  const [x0, y0, x1, y1] = G.envelope(G.uniao([]));
  expect(x0 > x1 && y0 > y1).toBe(true);
});

test('distancia e maisPerto', () => {
  const l = G.linha([[0, 0], [10, 0]]);
  expect(G.distancia(l, G.ponto([4, 3]))).toBeCloseTo(3, 9);
  expect(perto(G.maisPerto(l, [4, 3]), [4, 0])).toBe(true);
});

test('encostaCaixa: diz se a caixa encosta, contra polígono, buraco, coleção mista e vazio', () => {
  const pista = G.uniao([G.caixa(0, 0, 10, 1), G.caixa(0, 5, 10, 6)]);
  const toca = G.encostaCaixa(pista);
  expect(toca(G.caixa(2, 0.5, 3, 2))).toBe(true);
  expect(toca(G.caixa(2, 2, 3, 4))).toBe(false);
  // caixa toda dentro do polígono e caixa dentro do buraco
  const anel = G.diferenca(G.caixa(0, 0, 10, 10), G.caixa(3, 3, 7, 7));
  expect(G.encostaCaixa(anel)(G.caixa(1, 1, 2, 2))).toBe(true);
  expect(G.encostaCaixa(anel)(G.caixa(4, 4, 5, 5))).toBe(false);
  const mista = G.uniao([G.caixa(0, 0, 1, 1), G.linha([[5, 5], [6, 6]])]);
  expect(G.encostaCaixa(mista)(G.caixa(5.4, 5.4, 5.6, 5.6))).toBe(true);
  expect(G.encostaCaixa(mista)(G.caixa(3, 3, 4, 4))).toBe(false);
  expect(G.encostaCaixa(G.uniao([]))(G.caixa(0, 0, 1, 1))).toBe(false);
});
