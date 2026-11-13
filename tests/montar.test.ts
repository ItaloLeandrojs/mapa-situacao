import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { montarBase, normalizar, type Ajustes, type Ibge } from '../scripts/base/montar';
import { paraUtm } from '../src/nucleo/utm';
import type { Pt } from '../src/nucleo/tipos';

const lerFixture = (nome: string) => JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', nome), 'utf8'));
const OSM: { elements: any[] } = lerFixture('osm-cariri.json');
const IBGE: Ibge = lerFixture('ibge-cariri.json');
const VAZIO: Ajustes = { remover: [], forcarSede: [], acrescentar: [] };
const CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];

const BASE10 = montarBase(OSM, IBGE, VAZIO);
const BASE0 = montarBase(OSM, IBGE, VAZIO, 0);
const lugar = (b: ReturnType<typeof montarBase>, nome: string) => b.lugares.filter((l) => l.nome === nome);

test('só entram as 5 classes de rodovia', () => {
  const ponta = OSM.elements.find((e) => e.type === 'way').nodes;
  const intrusas = ['residential', 'primary_link', 'track'].map((highway, i) => ({
    type: 'way',
    id: -1 - i,
    nodes: [ponta[0], ponta[1]],
    tags: { highway, ref: 'INTRUSA' },
  }));
  const b = montarBase({ elements: [...OSM.elements, ...intrusas] }, IBGE, VAZIO);
  expect(b.arestas.length).toBe(BASE10.arestas.length);
  expect(b.arestas.some((a) => a.ref === 'INTRUSA')).toBe(false);
  expect(new Set(b.arestas.map((a) => a.classe))).toEqual(new Set(['trunk', 'primary', 'secondary', 'tertiary']));
  for (const a of b.arestas) expect(CLASSES).toContain(a.classe);
});

test('toda aresta liga dois nós que existem e tem pts com as duas pontas', () => {
  const nos = new Map(BASE10.nos.map(([id, x, y]) => [id, [x, y] as Pt]));
  expect(BASE10.arestas.length).toBeGreaterThan(BASE10.nos.length / 2);
  expect(new Set(BASE10.arestas.map((a) => a.id)).size).toBe(BASE10.arestas.length);
  for (const a of BASE10.arestas) {
    expect(nos.has(a.a) && nos.has(a.b)).toBe(true);
    expect(a.pts.length).toBeGreaterThanOrEqual(2);
    expect(a.pts[0]).toEqual(nos.get(a.a));
    expect(a.pts[a.pts.length - 1]).toEqual(nos.get(a.b));
  }
});

test('a soma de m das arestas é igual à soma das vias originais (erro < 1 m)', () => {
  const coord = new Map<number, Pt>();
  for (const e of OSM.elements) if (e.type === 'node') coord.set(e.id, paraUtm(e.lon, e.lat));
  let original = 0;
  for (const e of OSM.elements) {
    if (e.type !== 'way' || !CLASSES.includes(e.tags?.highway)) continue;
    for (let k = 1; k < e.nodes.length; k++) {
      const p = coord.get(e.nodes[k - 1])!;
      const q = coord.get(e.nodes[k])!;
      original += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
  }
  const somar = (b: ReturnType<typeof montarBase>) => b.arestas.reduce((s, a) => s + a.m, 0);
  expect(original).toBeGreaterThan(1_000_000);
  expect(Math.abs(somar(BASE10) - original)).toBeLessThan(1);
  expect(Math.abs(somar(BASE0) - original)).toBeLessThan(1);
});

test('com tolerância 0 nenhum ponto some; com 10 o total de pontos cai', () => {
  // cada via de n nós cortada em k pedaços dá n + k - 1 pontos (as pontas internas se repetem)
  let esperado = BASE0.arestas.length;
  for (const e of OSM.elements) {
    if (e.type === 'way' && CLASSES.includes(e.tags?.highway)) esperado += e.nodes.length - 1;
  }
  const total = (b: ReturnType<typeof montarBase>) => b.arestas.reduce((s, a) => s + a.pts.length, 0);
  expect(total(BASE0)).toBe(esperado);
  expect(total(BASE10)).toBeLessThan(total(BASE0) * 0.9);
  expect(BASE10.arestas.length).toBe(BASE0.arestas.length);
});

test('Jati é village no OSM e sai como sede', () => {
  const jati = lugar(BASE10, 'JATI');
  expect(jati).toHaveLength(1);
  expect(jati[0].tipo).toBe('sede');
  expect(jati[0].osm).toBe('village');
});

test('Jamacaru sai como distrito com osm town', () => {
  const jamacaru = lugar(BASE10, 'JAMACARU');
  expect(jamacaru).toHaveLength(1);
  expect(jamacaru[0]).toMatchObject({ tipo: 'distrito', osm: 'town' });
});

test('Sítio Amolar fica de fora', () => {
  expect(BASE10.lugares.some((l) => normalizar(l.nome).includes('AMOLAR'))).toBe(false);
  // e o nome guardado é em maiúsculas com acento
  expect(lugar(BASE10, 'MISSÃO VELHA')[0]).toMatchObject({ tipo: 'sede', osm: 'town' });
  expect(lugar(BASE10, 'MISSÃO NOVA')[0]).toMatchObject({ tipo: 'distrito', osm: 'village' });
  const crato = OSM.elements.find((e) => e.tags?.name === 'Crato');
  expect(lugar(BASE10, 'CRATO')[0].ponto).toEqual(paraUtm(crato.lon, crato.lat));
});

test('ajustes.remover tira o lugar; ajustes.forcarSede promove; ajustes.acrescentar cria um lugar que o OSM não tem', () => {
  const b = montarBase(OSM, IBGE, {
    remover: ['crato'],
    forcarSede: ['Arajará'],
    acrescentar: [{ nome: 'Lugar Novo', tipo: 'distrito', lon: -39.2, lat: -7.4 }],
  });
  expect(lugar(b, 'CRATO')).toHaveLength(0);
  expect(lugar(b, 'ARAJARA')[0].tipo).toBe('sede');
  expect(lugar(BASE10, 'ARAJARA')[0].tipo).toBe('distrito');
  expect(lugar(b, 'LUGAR NOVO')).toEqual([{ nome: 'LUGAR NOVO', tipo: 'distrito', osm: 'village', ponto: paraUtm(-39.2, -7.4) }]);
  expect(b.lugares.length).toBe(BASE10.lugares.length);
});

test('normalizar("Missão  Velha") === "MISSAO VELHA"', () => {
  expect(normalizar('Missão  Velha')).toBe('MISSAO VELHA');
  expect(normalizar(' juazeiro do\tnorte ')).toBe('JUAZEIRO DO NORTE');
  expect(normalizar("Mãe d'Água")).toBe("MAE D'AGUA");
});
