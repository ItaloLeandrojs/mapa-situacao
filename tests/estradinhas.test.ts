import { readFileSync } from 'node:fs';
import {
  carregarEstradinhas,
  deArquivo,
  ERRO_CARGA_TERRA,
  nomeDaCelulaTerra,
  paraArquivo,
  type EstradinhaArquivo,
  type IndiceTerra,
} from '../src/nucleo/estradinhas';
import type { Estradinha, Janela, Pt } from '../src/nucleo/tipos';
import { paraUtm } from '../src/nucleo/utm';
import { montarTerra } from '../scripts/base/montar-terra';

const osm = JSON.parse(readFileSync(new URL('./fixtures/terra-cariri.json', import.meta.url), 'utf8'));
const TERRA = ['track', 'unclassified', 'residential', 'living_street', 'road'];
const noDe = (id: number) => osm.elements.find((e: any) => e.type === 'node' && e.id === id);
const viasDeTerra = () => osm.elements.filter((e: any) => e.type === 'way' && TERRA.includes(e.tags?.highway));
const arredonda = (p: Pt): Pt => [Math.round(p[0]), Math.round(p[1])];
const utmDoNo = (id: number): Pt => paraUtm(noDe(id).lon, noDe(id).lat);

function distanciaAoSegmento(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const distanciaALinha = (p: Pt, linha: Pt[]) =>
  Math.min(...linha.slice(1).map((q, k) => distanciaAoSegmento(p, linha[k], q)));

test('montarTerra só traz as classes de terra e converte living_street e road em residential', () => {
  // a fixture só tem track, unclassified e residential: acrescenta um way de cada classe convertida ou excluída
  const base = osm.elements.find((e: any) => e.type === 'way' && e.tags.highway === 'track');
  const extra = ['living_street', 'road', 'service', 'footway', 'tertiary'].map((classe, k) => ({
    ...base,
    id: 9000000 + k,
    tags: { highway: classe },
  }));
  const t = montarTerra({ elements: [...osm.elements, ...extra] }, 3);
  expect(new Set(t.map((e) => e.classe))).toEqual(new Set(['track', 'unclassified', 'residential']));
  expect(t.find((e) => e.id === 9000000)!.classe).toBe('residential'); // living_street
  expect(t.find((e) => e.id === 9000001)!.classe).toBe('residential'); // road
  for (let k = 2; k < 5; k++) expect(t.some((e) => e.id === 9000000 + k)).toBe(false); // service, footway, tertiary
  expect(t.length).toBe(viasDeTerra().length + 2);
});

test('montarTerra guarda os encontros: ponto do OSM usado por dois ways fica igual nos dois depois de simplificar', () => {
  const vias = viasDeTerra();
  const usos = new Map<number, number[]>();
  for (const v of vias) for (const id of v.nodes as number[]) usos.set(id, [...(usos.get(id) ?? []), v.id]);
  const encontros = [...usos].filter(([, ways]) => new Set(ways).size >= 2);
  expect(encontros.length).toBeGreaterThan(20); // a fixture tem várias esquinas

  const t = montarTerra(osm, 3);
  const porId = new Map(t.map((e) => [e.id, e]));
  for (const [no, ways] of encontros) {
    const esperado = arredonda(utmDoNo(no));
    for (const w of new Set(ways)) {
      expect(porId.get(w)!.pts.some((p) => p[0] === esperado[0] && p[1] === esperado[1])).toBe(true);
    }
  }
  // as pontas de cada way também ficam
  for (const v of vias) {
    const e = porId.get(v.id)!;
    expect(e.pts[0]).toEqual(arredonda(utmDoNo(v.nodes[0])));
    expect(e.pts[e.pts.length - 1]).toEqual(arredonda(utmDoNo(v.nodes[v.nodes.length - 1])));
  }
});

test('montarTerra com tolerância 3 tem menos pontos que sem simplificar e nenhum ponto a mais de 3 m da linha original', () => {
  const bruto = montarTerra(osm, 0);
  const simples = montarTerra(osm, 3);
  const soma = (l: Estradinha[]) => l.reduce((s, e) => s + e.pts.length, 0);
  expect(soma(simples)).toBeLessThan(soma(bruto));

  // 3 m da simplificação + 0,5 m de folga pelo arredondamento para inteiro
  const porId = new Map(simples.map((e) => [e.id, e]));
  for (const v of viasDeTerra()) {
    const linha = porId.get(v.id)!.pts;
    for (const id of v.nodes as number[]) expect(distanciaALinha(utmDoNo(id), linha)).toBeLessThanOrEqual(3.5);
  }
});

// grade de 2 x 2 células de 0,1°: lon -39,1 a -38,9; lat -7,6 a -7,4
const INDICE: IndiceTerra = {
  data: '2026-11-15',
  celula: 0.1,
  oeste: -39.1,
  sul: -7.6,
  colunas: 2,
  linhas: 2,
  cheias: [nomeDaCelulaTerra(0, 0), nomeDaCelulaTerra(1, 0)], // c0_l1 e c1_l1 não têm estradinha
};
// janela no encontro das quatro células
const [cx, cy] = paraUtm(-39.0, -7.5);
const JANELA: Janela = { x0: cx - 100, y0: cy - 100, x1: cx + 100, y1: cy + 100 };
const MESMA: EstradinhaArquivo = [11, 2, 100, 200, 10, 5, 3, -4];
const ARQUIVOS: Record<string, unknown> = {
  'estradinhas/indice.json': INDICE,
  [nomeDaCelulaTerra(0, 0)]: [MESMA, [12, 0, 500, 600, 1, 1]],
  [nomeDaCelulaTerra(1, 0)]: [MESMA, [13, 1, 700, 800, -2, 2]], // o way 11 cruza a divisa e está nas duas
};

function buscarDeMentira() {
  const pedidos: string[] = [];
  const buscar = async (caminho: string) => {
    pedidos.push(caminho);
    if (!(caminho in ARQUIVOS)) throw new Error(`404 ${caminho}`);
    return ARQUIVOS[caminho];
  };
  return { pedidos, buscar };
}

test('carregarEstradinhas junta as células da janela e um way em duas células vem uma vez', async () => {
  const { buscar } = buscarDeMentira();
  const t = await carregarEstradinhas(JANELA, buscar);
  expect(t.map((e) => e.id).sort()).toEqual([11, 12, 13]);
  expect(t.find((e) => e.id === 11)).toEqual({ id: 11, classe: 'residential', pts: [[100, 200], [110, 205], [113, 201]] });
  expect(t.find((e) => e.id === 12)!.classe).toBe('track');
  expect(t.find((e) => e.id === 13)!.classe).toBe('unclassified');
});

test('carregarEstradinhas não busca célula fora de "cheias" (área sem estradinha não dá 404)', async () => {
  const { pedidos, buscar } = buscarDeMentira();
  await carregarEstradinhas(JANELA, buscar); // a janela toca as 4 células, mas só 2 estão em cheias
  expect([...pedidos].sort()).toEqual(['estradinhas/c0_l0.json', 'estradinhas/c1_l0.json', 'estradinhas/indice.json']);
  // janela longe da grade: só o índice
  const longe = buscarDeMentira();
  const [fx, fy] = paraUtm(-38.5267, -3.7319);
  expect(await carregarEstradinhas({ x0: fx, y0: fy, x1: fx + 10, y1: fy + 10 }, longe.buscar)).toEqual([]);
  expect(longe.pedidos).toEqual(['estradinhas/indice.json']);
});

test('carregarEstradinhas com buscar que falha lança ERRO_CARGA_TERRA com o erro original em cause', async () => {
  const falha = new Error('sem internet');
  const erro = await carregarEstradinhas(JANELA, async () => {
    throw falha;
  }).catch((e) => e);
  expect(erro).toBeInstanceOf(Error);
  expect(erro.message).toBe(ERRO_CARGA_TERRA);
  expect(erro.cause).toBe(falha);
});

test('arquivo de célula: ida e volta (gravar com deltas inteiros, ler) devolve os mesmos pontos', () => {
  const todas = montarTerra(osm, 3);
  expect(todas.length).toBeGreaterThan(50);
  for (const e of todas) {
    const linha = JSON.parse(JSON.stringify(paraArquivo(e))); // passa pelo JSON como no arquivo de verdade
    expect(deArquivo(linha)).toEqual(e);
    expect(linha.length).toBe(4 + 2 * (e.pts.length - 1));
  }
});
