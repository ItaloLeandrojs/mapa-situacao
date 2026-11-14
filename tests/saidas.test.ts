import { candidatosSaida } from '../src/nucleo/compor';
import { MEDIDAS } from '../src/nucleo/medidas';
import { larguraTexto } from '../src/nucleo/rotulos';
import { saidas } from '../src/nucleo/saidas';
import type { Aresta, Base, Janela, Lugar, Pt, PtU } from '../src/nucleo/tipos';

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

test('o mesmo destino na mesma borda dá um P/ só: o de menor distância pela rede', () => {
  // duas estradas saem pelo sul, 12 km uma da outra, e chegam à mesma sede; a da direita é mais curta
  const nos: Record<number, Pt> = { 1: [4000, 10000], 2: [4000, -1000], 3: [16000, 10000], 4: [16000, -1000], 5: [10000, -20000] };
  const b = base([[1, 2], [2, 5, 30000], [3, 4], [4, 5, 20000]], nos, [sede('SUL', [10000, -20000])]);
  const eixo: Pt[][] = [[[4000, 10000], [4000, -500]], [[16000, 10000], [16000, -500]]];
  expect(saidas(b, eixo, JANELA, [])).toEqual([{ ponto: [16000, 0], destino: 'SUL' }]);
  // a da esquerda mais curta: fica ela
  const b2 = base([[1, 2], [2, 5, 20000], [3, 4], [4, 5, 30000]], nos, [sede('SUL', [10000, -20000])]);
  expect(saidas(b2, eixo, JANELA, [])).toEqual([{ ponto: [4000, 0], destino: 'SUL' }]);
});

test('o mesmo destino em bordas diferentes dá um P/ em cada borda', () => {
  // uma estrada sai pelo sul e outra pelo leste, rumo à mesma sede a sudeste
  const nos: Record<number, Pt> = { 1: [10000, 10000], 2: [10000, -1000], 3: [15000, 10000], 4: [21000, 10000], 5: [30000, -10000] };
  const b = base([[1, 2], [2, 5], [3, 4], [4, 5]], nos, [sede('SE', [30000, -10000])]);
  const eixo: Pt[][] = [[[10000, 10000], [10000, -500]], [[15000, 10000], [20500, 10000]]];
  const s = saidas(b, eixo, JANELA, []);
  expect(s.map((x) => x.destino)).toEqual(['SE', 'SE']);
  expect(s.map((x) => x.ponto)).toEqual([[10000, 0], [20000, 10000]]);
});

test('cruzamento a mais de 2 km de qualquer estrada da base não dá saída', () => {
  // a estrada da base desce em x = 10000; a rota do KML sai pelo sul por um caminho fora da base, 6 km ao lado
  const nos: Record<number, Pt> = { 2: [10000, 10000], 3: [10000, -20000] };
  const b = base([[2, 3]], nos, [sede('SUL', [10000, -20000])]);
  expect(saidas(b, [[[16000, 10000], [16000, -500]]], JANELA, [])).toEqual([]);
  // a 1,5 km ainda encaixa na estrada
  expect(saidas(b, [[[11500, 10000], [11500, -500]]], JANELA, [])).toEqual([{ ponto: [11500, 0], destino: 'SUL' }]);
});

test('texto P/ perto do canto fica dentro da área dos textos', () => {
  const area = [10, 10, 50, 40] as const;
  const txt = 'P/ JUAZEIRO DO NORTE';
  const w = larguraTexto(txt, MEDIDAS.texto) / 2;
  const h = (MEDIDAS.texto * MEDIDAS.entrelinha) / 2;
  // borda de baixo junto do canto esquerdo, borda esquerda junto do canto de cima, borda direita junto do canto de baixo
  for (const p of [[11, 10], [10, 39], [50, 10.5]] as PtU[]) {
    const cs = candidatosSaida(p, txt, area);
    expect(cs).toHaveLength(4);
    for (const [x, y] of cs) {
      expect(x - w, `${p} -> ${x},${y}`).toBeGreaterThanOrEqual(area[0] - 1e-9);
      expect(x + w, `${p} -> ${x},${y}`).toBeLessThanOrEqual(area[2] + 1e-9);
      expect(y - h, `${p} -> ${x},${y}`).toBeGreaterThanOrEqual(area[1] - 1e-9);
      expect(y + h, `${p} -> ${x},${y}`).toBeLessThanOrEqual(area[3] + 1e-9);
    }
  }
  // longe do canto, os candidatos ficam dos dois lados do cruzamento, logo para dentro da borda de baixo
  const meio = candidatosSaida([30, 10], txt, area);
  expect(meio.some(([x]) => x > 30) && meio.some(([x]) => x < 30)).toBe(true);
  for (const [, y] of meio) expect(y).toBeCloseTo(10 + h + MEDIDAS.folgaSaida, 9);
});

test('candidatosSaida com mais: pares dos dois lados, do mais perto ao mais longe, até 4 linhas ao longo da borda', () => {
  const area = [10, 10, 110, 90] as const;
  const txt = 'P/ CRATO';
  const h = (MEDIDAS.texto * MEDIDAS.entrelinha) / 2;
  const linha = MEDIDAS.texto * MEDIDAS.entrelinha;
  // borda da esquerda, longe dos cantos: o texto anda para cima e para baixo da estrada (y = 50)
  const cs = candidatosSaida([10, 50], txt, area, true);
  // os 4 de sempre vêm primeiro na ordem da distância: passo 0 e passo de uma linha (2 × meia linha)
  expect(cs.slice(0, 4).sort()).toEqual(candidatosSaida([10, 50], txt, area).sort());
  // pares: um de cada lado da estrada, à mesma distância
  const d0 = MEDIDAS.meiaEstrada + MEDIDAS.folgaRotulo + h;
  const ds = [];
  for (let k = 0; k < cs.length; k += 2) {
    const [a, b] = [cs[k][1] - 50, cs[k + 1][1] - 50];
    expect(a).toBeCloseTo(-b, 9);
    ds.push(Math.abs(a));
  }
  // passos 0, 1, 2, 3 e 4 linhas (a de uma linha não se repete), crescendo
  expect(ds.map((d) => (d - d0) / linha)).toEqual([0, 1, 2, 3, 4].map((k) => expect.closeTo(k, 9)));
  // sem mais, só os 4 de sempre
  expect(candidatosSaida([10, 50], txt, area)).toHaveLength(4);
});
