import { saidas } from '../src/nucleo/saidas';
import type { Aresta, Base, Janela, Lugar, Pt } from '../src/nucleo/tipos';

// janela de 20 x 20 km; a estrada desce na vertical x = 10000 e sai pelo sul (y = 0)
const JANELA: Janela = { x0: 0, y0: 0, x1: 20000, y1: 20000 };

// arestas retas entre pontos; m = comprimento, a não ser que venha outro
function base(lados: [number, number, number?][], nos: Record<number, Pt>, lugares: Lugar[]): Base {
  const arestas = lados.map(([a, b, m], i): Aresta => {
    const pts: Pt[] = [nos[a], nos[b]];
    return { id: i + 1, a, b, ref: 'BR-1', classe: 'trunk', m: m ?? Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), pts };
  });
  return { data: 'teste', nos: new Map(Object.entries(nos).map(([id, p]) => [Number(id), p])), arestas, lugares };
}
const sede = (nome: string, ponto: Pt): Lugar => ({ nome, tipo: 'sede', osm: 'town', ponto });

test('estrada que sai pelo sul rumo a uma sede fora da janela dá P/ <sede>', () => {
  // 1 (norte, fora) - 2 (dentro) - 3 (sul, fora, sede ligada) - 4 (sul, 30 km da borda)
  const nos: Record<number, Pt> = { 1: [10000, 21000], 2: [10000, 10000], 3: [10000, -3000], 4: [10000, -30000] };
  const lugares: Lugar[] = [
    sede('NORTE', [10000, 21000]), // 21 km pela rede, mas só passando por dentro da janela
    sede('DENTRO', [10000, 5000]), // dentro da janela: não é saída
    sede('LIGADA', [10000, -3000]), // já aparece no mapa
    { nome: 'VILA', tipo: 'distrito', osm: 'city', ponto: [10000, -10000] }, // distrito nunca é destino
    sede('SUL', [10000, -30000]),
  ];
  const b = base([[1, 2], [2, 3], [3, 4]], nos, lugares);
  // o eixo termina na borda, como sai do traçado
  const eixo: Pt[][] = [[[10000, 10000], [10000, 0]]];
  expect(saidas(b, eixo, JANELA, ['LIGADA'])).toEqual([{ ponto: [10000, 0], destino: 'SUL' }]);
  // sem LIGADA nos ligados, ela é a primeira sede
  expect(saidas(b, eixo, JANELA, []).map((s) => s.destino)).toEqual(['LIGADA']);
});

test('estrada sem sede em 80 km não dá saída', () => {
  const nos: Record<number, Pt> = { 2: [10000, 10000], 3: [10000, -3000], 4: [10000, -30000] };
  const lugares = [sede('SUL', [10000, -30000])];
  // o limite é pela rede (m), não pelo desenho: 3 km + 76,5 km passa, 3 km + 77,5 km não
  const eixo: Pt[][] = [[[10000, 10000], [10000, -2000]]];
  const perto = base([[2, 3], [3, 4, 76500]], nos, lugares);
  expect(saidas(perto, eixo, JANELA, [])).toEqual([{ ponto: [10000, 0], destino: 'SUL' }]);
  const longe = base([[2, 3], [3, 4, 77500]], nos, lugares);
  expect(saidas(longe, eixo, JANELA, [])).toEqual([]);
});

test('pista dupla cruzando a borda dá uma saída só', () => {
  // duas pistas a 30 m uma da outra, que se juntam na sede
  const nos: Record<number, Pt> = { 1: [10000, 10000], 2: [10030, 10000], 3: [10015, -20000] };
  const b = base([[1, 3], [2, 3]], nos, [sede('SUL', [10015, -20000])]);
  const eixo: Pt[][] = [
    [[10000, 10000], [10000.5, -500]],
    [[10030, 10000], [10029.5, -500]],
  ];
  const s = saidas(b, eixo, JANELA, []);
  expect(s).toHaveLength(1);
  expect(s[0].destino).toBe('SUL');
  expect(s[0].ponto[1]).toBeCloseTo(0, 9);
});
