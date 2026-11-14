import { montarRede, type PontoRede } from '../src/nucleo/grafo';
import { normalizar } from '../scripts/base/montar';
import type { Aresta, Base, Classe, Janela, Pt } from '../src/nucleo/tipos';
import { CADEIAS_V4, CIDADES_V4, JANELA_V4, OBRA_V4, baseCariri } from './fixtures/v4';

// "H" de 6 nós (metros): 1-2-3 à esquerda, 4-5-6 à direita, travessa 2-5
//   3 (0,20000)      6 (20000,20000)
//   2 (0,10000) ---- 5 (20000,10000)
//   1 (0,0)          4 (20000,0)
const NOS_H: Record<number, Pt> = {
  1: [0, 0], 2: [0, 10000], 3: [0, 20000], 4: [20000, 0], 5: [20000, 10000], 6: [20000, 20000],
};
const LADOS_H: [number, number][] = [[1, 2], [2, 3], [4, 5], [5, 6], [2, 5]];
type Troca = Partial<Pick<Aresta, 'ref' | 'classe' | 'm'>>;

// trocas: por lado "a-b", muda ref, classe ou m (por padrão primary, ref CE-1, m = comprimento)
function baseH(trocas: Record<string, Troca> = {}): Base {
  const arestas = LADOS_H.map(([a, b], i): Aresta => {
    const pts: Pt[] = [NOS_H[a], NOS_H[b]];
    const m = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    return { id: i + 1, a, b, ref: 'CE-1', classe: 'primary' as Classe, m, pts, ...trocas[`${a}-${b}`] };
  });
  return { data: 'teste', nos: new Map(Object.entries(NOS_H).map(([id, p]) => [Number(id), p])), arestas, lugares: [] };
}

const JANELA_H: Janela = { x0: -5000, y0: -5000, x1: 25000, y1: 25000 };
const M_POR_U = 564.4; // 4,431 × 564,4 ≈ 2501 m
const cidade = (nome: string, ponto: Pt): PontoRede => ({ nome, ponto, tipo: 'cidade' });
const obra = (ponto: Pt): PontoRede => ({ nome: 'OBRA', ponto, tipo: 'obra' });
const pontas = (l: Pt[]) => [l[0], l[l.length - 1]];
const ligaOsDois = (l: Pt[], p: Pt, q: Pt) => {
  const [x, y] = pontas(l);
  return (x[0] === p[0] && x[1] === p[1] && y[0] === q[0] && y[1] === q[1]) || (x[0] === q[0] && x[1] === q[1] && y[0] === p[0] && y[1] === p[1]);
};

test('ponto no meio de uma aresta corta a aresta e divide m na proporção', () => {
  // travessa desenhada com 20 km, mas a estrada real tem 30 km
  const base = baseH({ '2-5': { m: 30000 } });
  const r = montarRede(base, [cidade('A', [5000, 10300]), obra([15000, 9800])], JANELA_H, M_POR_U);
  expect(r.trechos).toHaveLength(1);
  expect(pontas(r.trechos[0])).toEqual([[5000, 10000], [15000, 10000]]);
  expect(r.cadeias).toHaveLength(1);
  // 10 km de desenho = metade da travessa = 15 km de estrada
  expect(r.cadeias[0].km).toBeCloseTo(15, 9);
  expect(pontas(r.cadeias[0].linha)).toEqual([[5000, 10000], [15000, 10000]]);
});

test('trecho que passa colado num terceiro ponto não é direto', () => {
  const A: Pt = [0, 0];
  const B: Pt = [0, 20000];
  // C encaixa na travessa a 2 km de 2: desvio de 4 km (não pega na regra de 1,08) e a 2 km da linha A-B
  const C: Pt = [2000, 10000];
  const pontos = [cidade('A', A), cidade('B', B), obra(C)];
  const colado = montarRede(baseH(), pontos, JANELA_H, M_POR_U);
  expect(colado.trechos).toHaveLength(2);
  expect(colado.trechos.some((l) => ligaOsDois(l, A, B))).toBe(false);
  expect(colado.trechos.some((l) => ligaOsDois(l, A, C))).toBe(true);
  expect(colado.trechos.some((l) => ligaOsDois(l, C, B))).toBe(true);
  // com prancha mais detalhada (4,431 × 400 ≈ 1772 m) os 2 km já não são colados
  const longe = montarRede(baseH(), pontos, JANELA_H, 400);
  expect(longe.trechos).toHaveLength(3);
  expect(longe.trechos.some((l) => ligaOsDois(l, A, B))).toBe(true);
});

test('terceiro ponto colado só na ponta do trecho não tira o trecho', () => {
  // obra numa estradinha de 2 km que sai de B para o lado (caso de Crateús, obra a 3 km da sede):
  // A-B passa a 2 km da obra só porque termina em B, e continua direto
  const base = baseH();
  base.nos.set(7, [2000, 20000]);
  base.arestas.push({ id: 99, a: 3, b: 7, ref: 'CE-2', classe: 'primary', m: 2000, pts: [[0, 20000], [2000, 20000]] });
  const A: Pt = [0, 0];
  const B: Pt = [0, 20000];
  const O: Pt = [2000, 20000];
  const r = montarRede(base, [cidade('A', A), cidade('B', B), obra(O)], JANELA_H, M_POR_U);
  expect(r.trechos).toHaveLength(2);
  expect(r.trechos.some((l) => ligaOsDois(l, A, B))).toBe(true);
  expect(r.trechos.some((l) => ligaOsDois(l, B, O))).toBe(true);
});

test('regra de 1,08: terceiro ponto quase no caminho tira o trecho mesmo longe da linha', () => {
  // C a 3 km da travessa (fora da distância de colado) e encaixado nela: A-C-B custa o mesmo que A-B
  const A: Pt = [0, 0];
  const B: Pt = [20000, 20000];
  const C: Pt = [10000, 13000];
  const r = montarRede(baseH(), [cidade('A', A), obra(B), cidade('C', C)], JANELA_H, M_POR_U);
  expect(r.trechos.some((l) => ligaOsDois(l, A, B))).toBe(false);
  expect(r.trechos).toHaveLength(2);
});

test('trilha acima de 35% tira o trecho', () => {
  const pontos = [cidade('A', [0, 0]), obra([0, 20000])];
  const rede = (troca: Troca) => montarRede(baseH({ '1-2': troca }), pontos, JANELA_H, M_POR_U);
  // 1-2 é trilha (tertiary sem ref): 5 de 15 km = 33% fica; 6 de 16 km = 37,5% sai
  expect(rede({ classe: 'tertiary', ref: '', m: 5000 }).trechos).toHaveLength(1);
  const sem = rede({ classe: 'tertiary', ref: '', m: 6000 });
  expect(sem.trechos).toHaveLength(0);
  expect(sem.cadeias).toHaveLength(0);
  // tertiary com ref não é trilha
  expect(rede({ classe: 'tertiary', ref: 'CE-9', m: 10000 }).trechos).toHaveLength(1);
  // sem ref mas de outra classe também não é trilha
  expect(rede({ classe: 'secondary', ref: '', m: 10000 }).trechos).toHaveLength(1);
});

test('cadeia soma m e fica com o ref de mais metros', () => {
  // CE-1 tem mais lados (1-2 e 5-6, 16 km), CE-2 tem mais metros (20 km)
  const base = baseH({ '1-2': { m: 8000 }, '5-6': { m: 8000 }, '2-5': { ref: 'CE-2' }, '4-5': { ref: '' } });
  const doisPontos = montarRede(base, [cidade('A', [0, 0]), obra([20000, 20000])], JANELA_H, M_POR_U);
  expect(doisPontos.cadeias).toHaveLength(1);
  expect(doisPontos.cadeias[0].km).toBeCloseTo(36, 9);
  expect(doisPontos.cadeias[0].ref).toBe('CE-2');
  expect(doisPontos.cadeias[0].linha).toEqual([[0, 0], [0, 10000], [20000, 10000], [20000, 20000]]);

  // um terceiro ponto em 4 faz o nó 5 ter grau 3: a rede é cortada ali em três cadeias
  const tres = montarRede(base, [cidade('A', [0, 0]), obra([20000, 20000]), cidade('C', [20000, 0])], JANELA_H, M_POR_U);
  const resumo = tres.cadeias.map((c) => `${c.ref}:${c.km.toFixed(3)}`).sort();
  expect(resumo).toEqual([':10.000', 'CE-1:8.000', 'CE-2:28.000']);
});

test('obra a 3 km de qualquer aresta: erro "Esta rota fica fora da base do Ceará"', () => {
  const cidades = [cidade('A', [0, 0]), cidade('B', [0, 20000])];
  expect(() => montarRede(baseH(), [...cidades, obra([-3000, 5000])], JANELA_H, M_POR_U)).toThrow(
    new Error('Esta rota fica fora da base do Ceará'),
  );
  // a 1,9 km ainda encaixa
  expect(() => montarRede(baseH(), [...cidades, obra([-1900, 5000])], JANELA_H, M_POR_U)).not.toThrow();
});

test('viasRef: só arestas com ref, de trunk, primary ou secondary, que tocam a janela', () => {
  const base = baseH({ '1-2': { classe: 'tertiary' }, '2-3': { ref: '' }, '4-5': { classe: 'trunk' }, '5-6': { classe: 'secondary' } });
  // janela que corta só a perna direita de baixo (4-5) e a travessa, sem conter nenhuma ponta
  const janela: Janela = { x0: 15000, y0: 2000, x1: 25000, y1: 8000 };
  const r = montarRede(base, [cidade('A', [0, 0]), obra([0, 20000])], janela, M_POR_U);
  expect(r.viasRef).toEqual([[[20000, 0], [20000, 10000]]]);
  const toda = montarRede(base, [cidade('A', [0, 0]), obra([0, 20000])], JANELA_H, M_POR_U);
  expect(toda.viasRef).toHaveLength(3); // 4-5, 5-6 e a travessa 2-5
});

test('Cariri: cadeias batem com a v4', () => {
  const base = baseCariri(0);
  const pontos: PontoRede[] = CIDADES_V4.map((nome) => {
    const achados = base.lugares.filter((l) => normalizar(l.nome) === normalizar(nome));
    expect(achados, nome).toHaveLength(1);
    return cidade(nome, achados[0].ponto);
  });
  pontos.push(obra(OBRA_V4));
  const r = montarRede(base, pontos, JANELA_V4, 564.4);
  const sobra = r.cadeias.map((c) => ({ ref: c.ref.split(';')[0], km: c.km }));
  for (const [ref, km] of CADEIAS_V4) {
    const i = sobra.findIndex((c) => c.ref === ref && Math.abs(c.km - km) < 0.15);
    expect(i, `${ref} ${km} km`).toBeGreaterThanOrEqual(0);
    sobra.splice(i, 1);
  }
});
