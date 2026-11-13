import { carregarBase, celulasDaJanela, type Indice } from '../src/nucleo/base';
import { paraUtm } from '../src/nucleo/utm';
import type { Janela } from '../src/nucleo/tipos';

const ERRO = 'Não consegui carregar a base de estradas. Confira a internet e tente de novo';
// grade de 2 x 2 células de 0,5°: lon -39,5 a -38,5; lat -7,5 a -6,5
const INDICE: Indice = { data: '2026-11-13', celula: 0.5, oeste: -39.5, sul: -7.5, colunas: 2, linhas: 2 };

// dentro da célula c0_l0: ~16 km da divisa leste (lon -39) e ~38 km da norte (lat -7)
const [cx, cy] = paraUtm(-39.15, -7.35);
const JANELA: Janela = { x0: cx - 1000, y0: cy - 1000, x1: cx + 1000, y1: cy + 1000 };
const [fx, fy] = paraUtm(-38.5267, -3.7319); // Fortaleza, longe da grade
const LONGE: Janela = { x0: fx - 1000, y0: fy - 1000, x1: fx + 1000, y1: fy + 1000 };

const CIDADES = [
  { n: 'JATI', t: 'sede', o: 'village', x: 500100, y: 9170200 },
  { n: 'JAMACARU', t: 'distrito', o: 'town', x: 480000, y: 9190000 },
];
// a aresta 7 cruza a divisa e está nas duas células
const C0_L0 = {
  nos: [[1, 470000, 9180000], [2, 480000, 9181000], [3, 520000, 9182000]],
  arestas: [
    [5, 1, 2, '', 'tertiary', 10050, [470000, 9180000, 480000, 9181000]],
    [7, 2, 3, 'CE-397', 'secondary', 40100, [480000, 9181000, 500000, 9181500, 520000, 9182000]],
  ],
};
const C1_L0 = {
  nos: [[2, 480000, 9181000], [3, 520000, 9182000], [4, 530000, 9190000]],
  arestas: [
    [7, 2, 3, 'CE-397', 'secondary', 40100, [480000, 9181000, 500000, 9181500, 520000, 9182000]],
    [9, 3, 4, 'BR-116', 'primary', 12000, [520000, 9182000, 530000, 9190000]],
  ],
};
const VAZIA = { nos: [], arestas: [] };

function buscarDeMentira(falha?: string) {
  const pedidos: string[] = [];
  const arquivos: Record<string, unknown> = {
    'indice.json': INDICE,
    'cidades.json': CIDADES,
    'rodovias/c0_l0.json': C0_L0,
    'rodovias/c1_l0.json': C1_L0,
    'rodovias/c0_l1.json': VAZIA,
    'rodovias/c1_l1.json': VAZIA,
  };
  const buscar = async (caminho: string) => {
    pedidos.push(caminho);
    if (caminho === falha || !(caminho in arquivos)) throw new Error(`404 ${caminho}`);
    return structuredClone(arquivos[caminho]);
  };
  return { buscar, pedidos };
}

test('celulasDaJanela devolve as células tocadas pela janela mais a margem', () => {
  expect(celulasDaJanela(INDICE, JANELA, 0)).toEqual(['rodovias/c0_l0.json']);
  // 30 km de margem passam da divisa leste (lon -39, x = 500000) mas não da norte (lat -7)
  expect(celulasDaJanela(INDICE, JANELA, 30000)).toEqual(['rodovias/c0_l0.json', 'rodovias/c1_l0.json']);
  expect(celulasDaJanela(INDICE, JANELA, 60000).sort()).toEqual([
    'rodovias/c0_l0.json',
    'rodovias/c0_l1.json',
    'rodovias/c1_l0.json',
    'rodovias/c1_l1.json',
  ]);
});

test('aresta repetida em duas células entra uma vez', async () => {
  const { buscar, pedidos } = buscarDeMentira();
  const base = await carregarBase(JANELA, buscar, 30000);
  expect(pedidos.sort()).toEqual(['cidades.json', 'indice.json', 'rodovias/c0_l0.json', 'rodovias/c1_l0.json']);
  expect(base.data).toBe('2026-11-13');
  expect(base.arestas.map((a) => a.id).sort()).toEqual([5, 7, 9]);
  expect(base.arestas.find((a) => a.id === 7)).toEqual({
    id: 7,
    a: 2,
    b: 3,
    ref: 'CE-397',
    classe: 'secondary',
    m: 40100,
    pts: [[480000, 9181000], [500000, 9181500], [520000, 9182000]],
  });
  expect([...base.nos.keys()].sort()).toEqual([1, 2, 3, 4]);
  expect(base.nos.get(4)).toEqual([530000, 9190000]);
});

test('lugares vêm de cidades.json', async () => {
  const base = await carregarBase(JANELA, buscarDeMentira().buscar);
  expect(base.lugares).toEqual([
    { nome: 'JATI', tipo: 'sede', osm: 'village', ponto: [500100, 9170200] },
    { nome: 'JAMACARU', tipo: 'distrito', osm: 'town', ponto: [480000, 9190000] },
  ]);
});

test('célula que falha: erro "Não consegui carregar a base de estradas. Confira a internet e tente de novo"', async () => {
  for (const falha of ['rodovias/c1_l0.json', 'indice.json', 'cidades.json']) {
    await expect(carregarBase(JANELA, buscarDeMentira(falha).buscar, 30000)).rejects.toThrow(ERRO);
  }
});

test('janela fora da grade: base sem arestas, sem erro', async () => {
  const { buscar, pedidos } = buscarDeMentira();
  expect(celulasDaJanela(INDICE, LONGE, 60000)).toEqual([]);
  const base = await carregarBase(LONGE, buscar);
  expect(base.arestas).toEqual([]);
  expect(base.nos.size).toBe(0);
  expect(base.lugares).toHaveLength(2);
  expect(pedidos.sort()).toEqual(['cidades.json', 'indice.json']);
});
