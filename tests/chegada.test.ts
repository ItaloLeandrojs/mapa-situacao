// @vitest-environment happy-dom
import { distanciaALinha, separarRota } from '../src/nucleo/grafo';
import {
  BUSCA_TERRA, NA_BEIRA, caminhoRiscado, entradaMaisPerto, obraNaBeira, sugerirCaminho, viradas, type Chegada,
} from '../src/nucleo/chegada';
import type { Base, Estradinha, Pt } from '../src/nucleo/tipos';
import { casoAfastado, rotaCe397, semRiscado, terraCariri } from './fixtures/chegada';
import { baseCariri } from './fixtures/v4';

const base = baseCariri(3);
const dist = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);
const ateBase = (b: Base, p: Pt) => b.arestas.reduce((m, a) => Math.min(m, distanciaALinha(p, a.pts)), Infinity);
const ateCe397 = (p: Pt) => ateBase({ ...base, arestas: base.arestas.filter((a) => a.ref === 'CE-397') }, p);
const comprimento = (pts: Pt[]) => pts.reduce((s, p, k) => (k ? s + dist(pts[k - 1], p) : 0), 0);

test('obraNaBeira: obra da ce397.kml (na CE-397) dá true; obra do casoAfastado dá false', () => {
  const kml = rotaCe397();
  expect(obraNaBeira(base, kml.alfinetes[0].ponto)).toBe(true);
  const c = casoAfastado();
  expect(c.distObraBase).toBeGreaterThan(NA_BEIRA);
  expect(obraNaBeira(c.base, c.obra)).toBe(false);
});

test('entradaMaisPerto: ponto da base mais perto da obra, em cima de uma aresta', () => {
  const c = casoAfastado();
  const e = entradaMaisPerto(c.base, c.obra);
  expect(dist(e, c.obra)).toBeCloseTo(c.distObraBase, 6);
  expect(ateBase(c.base, e)).toBeLessThan(1e-6);
});

test('caminhoRiscado: entrada a até 50 m da CE-397, último ponto é a obra, origem riscado, metros múltiplo de 10', () => {
  const c = casoAfastado();
  const r = caminhoRiscado(c.base, c.obra, c.rota)!;
  expect(r).not.toBeNull();
  expect(r.origem).toBe('riscado');
  expect(ateCe397(r.entrada)).toBeLessThanOrEqual(50);
  expect(r.caminho[0]).toEqual(r.entrada);
  expect(r.caminho[r.caminho.length - 1]).toEqual(c.obra);
  expect(r.metros % 10).toBe(0);
  expect(Math.abs(r.metros - comprimento(r.caminho))).toBeLessThanOrEqual(5);
  // tem a extensão da estradinha riscada, menos o pedaço que fica em cima da rodovia
  expect(r.metros).toBeGreaterThan(comprimento(c.estradinha.pts) - 300);
});

test('caminhoRiscado com um desvio fora da base no meio da viagem: fica o trecho que termina na obra', () => {
  const c = casoAfastado();
  const ce = c.rota[0];
  const [a, b] = [ce[Math.floor(ce.length * 0.3)], ce[Math.floor(ce.length * 0.5)]];
  // desvio: sai da rota 1 km para o lado e volta; escolhe o lado que fica mais longe da base
  const lado = [[0, 1000], [0, -1000], [1000, 0], [-1000, 0]]
    .map(([dx, dy]): Pt => [(a[0] + b[0]) / 2 + dx, (a[1] + b[1]) / 2 + dy])
    .reduce((m, p) => (ateBase(c.base, p) > ateBase(c.base, m) ? p : m));
  const rota = [...c.rota, [a, lado, b]];
  expect(separarRota(c.base, rota).fora.length).toBeGreaterThanOrEqual(2); // o desvio é um pedaço fora a mais
  const r = caminhoRiscado(c.base, c.obra, rota)!;
  expect(r.caminho[r.caminho.length - 1]).toEqual(c.obra);
  expect(r.caminho).not.toContainEqual(lado);
  expect(dist(r.entrada, c.encontro)).toBeLessThan(60);
  expect(r).toEqual(caminhoRiscado(c.base, c.obra, c.rota));
});

test('caminhoRiscado sem trecho fora perto da obra: null', () => {
  const c = semRiscado();
  expect(caminhoRiscado(c.base, c.obra, c.rota)).toBeNull();
});

test('caminhoRiscado: ponta perto da obra que não é a obra, a obra entra como último ponto', () => {
  const c = casoAfastado();
  const riscado = c.arquivo.caminhos[1].pontos;
  const [pen, ult] = [riscado[riscado.length - 2], riscado[riscado.length - 1]];
  const f = Math.min(1, 100 / dist(pen, ult)); // termina 100 m antes da obra, na própria linha
  const antes: Pt = [ult[0] + f * (pen[0] - ult[0]), ult[1] + f * (pen[1] - ult[1])];
  expect(dist(antes, c.obra)).toBeGreaterThan(50);
  expect(dist(antes, c.obra)).toBeLessThan(NA_BEIRA);
  const r = caminhoRiscado(c.base, c.obra, [c.rota[0], [...riscado.slice(0, -2), antes]])!;
  expect(r.caminho[r.caminho.length - 2]).toEqual(antes);
  expect(r.caminho[r.caminho.length - 1]).toEqual(c.obra);
});

test('sugerirCaminho em semRiscado: entrada a até 50 m da CE-397, caminho pelas estradinhas, termina na obra, origem sugerido', () => {
  const c = semRiscado();
  const s = sugerirCaminho(c.base, c.terra, c.obra, c.rota)!;
  expect(s).not.toBeNull();
  expect(s.origem).toBe('sugerido');
  expect(ateCe397(s.entrada)).toBeLessThanOrEqual(50);
  expect(s.caminho[0]).toEqual(s.entrada);
  expect(s.caminho[s.caminho.length - 1]).toEqual(c.obra);
  expect(s.metros % 10).toBe(0);
  // todo ponto do meio está em cima de alguma estradinha
  for (const p of s.caminho.slice(1, -1)) expect(Math.min(...c.terra.map((e) => distanciaALinha(p, e.pts)))).toBeLessThan(1e-6);
  expect(s.metros).toBeGreaterThanOrEqual(Math.round(dist(s.entrada, c.obra) / 10) * 10 - 10);
  expect(s.metros).toBeLessThan(comprimento(c.estradinha.pts) * 1.3);
});

test('sugerirCaminho com a obra a 800 m de qualquer estradinha: null', () => {
  const c = semRiscado();
  const xs = c.terra.flatMap((e) => e.pts.map((p) => p[0]));
  const longe: Pt = [Math.min(...xs) - 800, c.obra[1]];
  expect(Math.min(...c.terra.map((e) => distanciaALinha(longe, e.pts)))).toBeGreaterThanOrEqual(800);
  expect(BUSCA_TERRA).toBeLessThan(800);
  expect(sugerirCaminho(c.base, c.terra, longe, c.rota)).toBeNull();
});

test('viradas: nenhuma a menos de 80 m da entrada ou da obra, nenhuma a menos de 80 m de outra, ids em ordem', () => {
  const c = casoAfastado();
  const terra = terraCariri();
  const chegadas = [caminhoRiscado(c.base, c.obra, c.rota)!, sugerirCaminho(c.base, terra, c.obra, semRiscado().rota)!];
  for (const ch of chegadas) {
    const v = viradas(ch, terra);
    expect(v.length).toBeGreaterThan(0);
    expect(v.map((x) => x.id)).toEqual(v.map((_, i) => `virada:${i}`));
    const obra = ch.caminho[ch.caminho.length - 1];
    for (const x of v) {
      expect(dist(x.ponto, ch.entrada)).toBeGreaterThan(80);
      expect(dist(x.ponto, obra)).toBeGreaterThan(80);
      expect(ch.caminho.some((p, k) => k > 0 && distanciaALinha(x.ponto, [ch.caminho[k - 1], p]) < 1e-6)).toBe(true);
    }
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) expect(dist(v[i].ponto, v[j].ponto)).toBeGreaterThanOrEqual(80);
    // ordem do caminho: a distância andada até cada ponto só cresce
    const andado = (p: Pt) => {
      let s = 0;
      for (let k = 1; k < ch.caminho.length; k++) {
        if (distanciaALinha(p, [ch.caminho[k - 1], ch.caminho[k]]) < 1e-6) return s + dist(ch.caminho[k - 1], p);
        s += dist(ch.caminho[k - 1], ch.caminho[k]);
      }
      return s;
    };
    const ss = v.map((x) => andado(x.ponto));
    expect([...ss].sort((a, b) => a - b)).toEqual(ss);
  }
});

const reta = (pts: Pt[]): Chegada => ({ entrada: pts[0], caminho: pts, metros: Math.round(comprimento(pts) / 10) * 10, origem: 'riscado' });
const estr = (id: number, pts: Pt[]): Estradinha => ({ id, classe: 'track', pts });

test('viradas: caminho reto que cruza uma estradinha de 200 m para cada lado dá um encontro no cruzamento', () => {
  const v = viradas(reta([[0, 0], [1000, 0]]), [estr(1, [[500, -200], [500, 200]])]);
  expect(v).toHaveLength(1);
  expect(v[0].id).toBe('virada:0');
  expect(v[0].motivo).toBe('encontro');
  expect(dist(v[0].ponto, [500, 0])).toBeLessThan(5);
});

test('viradas: estradinha de 40 m ou paralela colada ao caminho não é encontro', () => {
  expect(viradas(reta([[0, 0], [1000, 0]]), [estr(1, [[500, 0], [500, 40]])])).toEqual([]);
  expect(viradas(reta([[0, 0], [1000, 0]]), [estr(2, [[100, 10], [900, 10]])])).toEqual([]);
});

// no detalhe, a estradinha some a até zonaRota do caminho (160 m na janela maior, de 8 km): a sem saída que anda
// menos que isso fora da faixa (acesso de casa) não aparece no desenho e não pode virar virada
test('viradas: estradinha sem saída de 120 m saindo do caminho não é encontro; de 200 m é', () => {
  expect(viradas(reta([[0, 0], [1000, 0]]), [estr(1, [[500, 0], [500, 120]])])).toEqual([]);
  const v = viradas(reta([[0, 0], [1000, 0]]), [estr(1, [[500, 0], [500, 200]])]);
  expect(v.map((x) => x.motivo)).toEqual(['encontro']);
  expect(dist(v[0].ponto, [500, 0])).toBeLessThan(5);
});

test('viradas: encontro a menos de 80 m da entrada não conta', () => {
  expect(viradas(reta([[0, 0], [1000, 0]]), [estr(1, [[50, -200], [50, 200]])])).toEqual([]);
});

test('viradas: caminho em L sem estradinha no canto dá uma curva no canto; em ângulo de 45° não dá', () => {
  const l = viradas(reta([[0, 0], [500, 0], [500, 500]]), []);
  expect(l).toHaveLength(1);
  expect(l[0].motivo).toBe('curva');
  expect(dist(l[0].ponto, [500, 0])).toBeLessThan(5);
  expect(viradas(reta([[0, 0], [500, 0], [500 + 354, 354]]), [])).toEqual([]);
});

test('viradas: no canto do L com estradinha saindo dele, fica o encontro e não a curva', () => {
  const v = viradas(reta([[0, 0], [500, 0], [500, 500]]), [estr(1, [[500, 0], [900, -100]])]);
  expect(v.map((x) => x.motivo)).toEqual(['encontro']);
});
