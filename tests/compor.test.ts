import { compor, type Entrada } from '../src/nucleo/compor';
import { escala, MEDIDAS } from '../src/nucleo/medidas';
import { textoCoordenada } from '../src/nucleo/obra';
import type { Aresta, Base, Desenho, Janela, Lugar, Primitiva, Pt, PtU } from '../src/nucleo/tipos';

type Texto = Extract<Primitiva, { t: 'texto' }>;

// rodovia reta em x = 10000, de y = -30000 (sede SUL) a y = 50000 (sede NORTE), com a sede ALFA no meio da janela
const NOS: Pt[] = [[10000, -30000], [10000, 0], [10000, 10000], [10000, 20000], [10000, 50000]];
const sede = (nome: string, ponto: Pt): Lugar => ({ nome, tipo: 'sede', osm: 'town', ponto });
const BASE: Base = {
  data: 'teste',
  nos: new Map(NOS.map((p, i) => [i + 1, p])),
  arestas: NOS.slice(1).map((p, i): Aresta => ({
    id: i + 1, a: i + 1, b: i + 2, ref: 'CE-1', classe: 'primary', m: Math.hypot(p[0] - NOS[i][0], p[1] - NOS[i][1]), pts: [NOS[i], p],
  })),
  lugares: [sede('ALFA', [10000, 10000]), sede('SUL', [10000, -30000]), sede('NORTE', [10000, 50000])],
};
const Q = { w: 124.6, h: 113 };
// 20 km de altura, na proporção da área útil
const ALTURA = 20000;
const LARGURA = (ALTURA * (Q.w - 6)) / (Q.h - 17);
const JANELA: Janela = { x0: 10000 - LARGURA / 2, y0: 0, x1: 10000 + LARGURA / 2, y1: ALTURA };

// rota do Google: vem pela rodovia desde o sul e sai para leste em y = 15000, andando 3 km fora da base
function entrada(obra: Pt): Entrada {
  const pontos: Pt[] = [[10000, 2000], [10000, 15000]];
  for (let x = 10500; x <= obra[0]; x += 500) pontos.push([x, 15000]);
  return {
    base: BASE, arquivo: { caminhos: [{ nome: 'Rota', pontos }], alfinetes: [{ nome: 'LOCAL DA OBRA', ponto: obra }] },
    obra, janela: JANELA, quadro: Q, ligados: ['ALFA'], ajustes: {}, credito: false,
  };
}
const textos = (d: Desenho) => d.prims.filter((p): p is Texto => p.t === 'texto');
// distância do ponto às linhas, segmento por segmento
function ateLinhas([px, py]: PtU, linhas: PtU[][]): number {
  let menor = Infinity;
  for (const l of linhas) {
    for (let k = 1; k < l.length; k++) {
      const [[ax, ay], [bx, by]] = [l[k - 1], l[k]];
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
      menor = Math.min(menor, Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay)));
    }
  }
  return menor;
}
const saidasDe = (d: Desenho) => textos(d).filter((t) => t.id.startsWith('saida:')).map((t) => t.txt).sort();

test('obra a 3 km da rodovia com a rota chegando na base: mapa completo, rota amarela até o círculo', () => {
  const obra: Pt = [13000, 15000];
  const d = compor(entrada(obra));
  const esc = escala(JANELA, Q);
  const [ox, oy] = esc.paraU(obra);

  // círculo vermelho e textos da obra no alfinete, não no pé da rodovia
  const circulos = d.prims.filter((p) => p.t === 'circulo' && p.camada === 'LOCAL_DA_OBRA');
  expect(circulos).toHaveLength(2);
  for (const c of circulos) if (c.t === 'circulo') expect(c.centro).toEqual([ox, oy]);
  expect(textos(d).find((t) => t.id === 'obra:nome')?.txt).toBe('LOCAL DA OBRA');
  expect(textos(d).find((t) => t.id === 'obra:coord')?.txt).toBe(textoCoordenada(obra));

  // a rota amarela chega até o círculo: o contorno dela passa a menos de meia estrada do centro da obra
  const rota = d.prims.flatMap((p) => (p.t === 'linha' && p.camada === 'ROTA' ? [p.pts] : []));
  expect(ateLinhas([ox, oy], rota)).toBeLessThan(MEDIDAS.meiaEstrada + 0.01);
  // e cobre o trecho fora da base: há contorno amarelo no meio do caminho entre a rodovia e a obra
  expect(ateLinhas(esc.paraU([11500, 15000]), rota)).toBeLessThan(MEDIDAS.meiaEstrada + 0.01);

  // cidade e saídas P/ como com a obra perto da rodovia
  expect(textos(d).find((t) => t.id === 'cidade:ALFA')?.txt).toBe('ALFA');
  expect(saidasDe(d)).toEqual(['P/ NORTE', 'P/ SUL']);
  expect(saidasDe(d)).toEqual(saidasDe(compor(entrada([11500, 15000]))));
}, 20000);

test('obra e rota a mais de 2 km da base: compor lança "Esta rota fica fora da base do Ceará"', () => {
  const e = entrada([13000, 15000]);
  const longe = { ...e, arquivo: { ...e.arquivo, caminhos: [{ nome: 'Rota', pontos: [[12500, 2000], [13000, 15000]] as Pt[] }] } };
  expect(() => compor(longe)).toThrow(new Error('Esta rota fica fora da base do Ceará'));
});

// a mesma rodovia como a CE-397 real: tertiary com ref, que não entra nas vias com ref desenhadas por inteiro
const TERCIARIA: Base = { ...BASE, arestas: BASE.arestas.map((a) => ({ ...a, ref: 'CE-9', classe: 'tertiary' })) };
const linhasDe = (d: Desenho, camada: string) => d.prims.flatMap((p) => (p.t === 'linha' && p.camada === camada ? [p.pts] : []));

test('rota que sai da rodovia por 3 km: trecho fora é CARROÇAL sem eixo, a rodovia continua depois da saída', () => {
  const obra: Pt = [13000, 15000];
  const d = compor({ ...entrada(obra), base: TERCIARIA });
  const esc = escala(JANELA, Q);
  const u = (p: Pt) => esc.paraU(p);

  // bordas do carroçal ao longo de todo o trecho fora da base, a meia estrada do eixo
  const carrocal = linhasDe(d, 'CARROÇAL');
  expect(carrocal.length).toBeGreaterThan(0);
  for (const x of [11000, 11500, 12000, 12500]) {
    expect(ateLinhas(u([x, 15000]), carrocal)).toBeGreaterThan(MEDIDAS.meiaEstrada - 0.05);
    expect(ateLinhas(u([x, 15000]), carrocal)).toBeLessThan(MEDIDAS.meiaEstrada + 0.05);
  }
  // nenhum tracinho do eixo no trecho fora (passada a pista da rodovia)
  const [ex0, ey0] = u([10000, 15000]);
  const [, ey1] = u([13000, 15000]);
  const tracinhos = linhasDe(d, 'ESTRADA_EIXO').flat();
  expect(tracinhos.filter(([x, y]) => x > ex0 + 2 * MEDIDAS.meiaEstrada && Math.abs(y - ey0) < 2 * MEDIDAS.meiaEstrada && Math.abs(y - ey1) < 2 * MEDIDAS.meiaEstrada)).toEqual([]);

  // a rodovia continua depois da saída (para o norte), mas sem encontro em MEDIDAS.continuaMax só um toco:
  // nesta escala o toco tem MEDIDAS.tocoContinua × mPorU (cerca de 550 m) e a borda da janela fica a 5 km
  const toco = MEDIDAS.tocoContinua * esc.mPorU;
  expect(ateLinhas(u([10000, 15000 + toco / 2]), linhasDe(d, 'ESTRADA'))).toBeLessThan(MEDIDAS.meiaEstrada + 0.05);
  expect(ateLinhas(u([10000, 17000]), linhasDe(d, 'ESTRADA'))).toBeGreaterThan(2);

  // a rota amarela vai por cima até o círculo
  const rota = linhasDe(d, 'ROTA');
  expect(ateLinhas(u(obra), rota)).toBeLessThan(MEDIDAS.meiaEstrada + 0.01);
  expect(ateLinhas(u([11500, 15000]), rota)).toBeLessThan(MEDIDAS.meiaEstrada + 0.01);

  // nem o carroçal nem a continuação ganham rótulo: os rótulos de trecho são os mesmos da rota toda na rodovia,
  // e todos ficam ao lado da rodovia entre a cidade (y = 10000) e a saída (y = 15000)
  const rotulos = (x: Desenho) => textos(x).filter((t) => t.id.startsWith('trecho:'));
  const naBase = compor({ ...entrada([10000, 15000]), base: TERCIARIA });
  expect(rotulos(d).map((t) => t.txt).sort()).toEqual(rotulos(naBase).map((t) => t.txt).sort());
  expect(rotulos(d).length).toBeGreaterThan(0);
  for (const t of rotulos(d)) {
    const [x, y] = esc.paraMetros(t.centro);
    expect(Math.abs(x - 10000), t.txt).toBeLessThan(1500);
    expect(y, t.txt).toBeLessThan(15000);
  }
}, 20000);

test('rota em cima da rodovia com um pico de 80 m (Google x OSM): sem CARROÇAL e sem continuação', () => {
  const e = entrada([10000, 15000]);
  const pontos: Pt[] = [[10000, 2000], [10000, 12000], [10080, 13000], [10000, 14000], [10000, 15000]];
  const d = compor({ ...e, base: TERCIARIA, arquivo: { ...e.arquivo, caminhos: [{ nome: 'Rota', pontos }] } });
  expect(linhasDe(d, 'CARROÇAL')).toEqual([]);
  // sem continuação: nenhum tracinho do eixo ao norte do fim da rota (a rodovia tertiary não está nas viasRef)
  const esc = escala(JANELA, Q);
  const norte = linhasDe(d, 'ESTRADA_EIXO').flat().map(esc.paraMetros).filter(([x, y]) => Math.abs(x - 10000) < 500 && y > 15200);
  expect(norte).toEqual([]);
}, 20000);

test('rota toda em cima da base: sem CARROÇAL', () => {
  const e = entrada([10000, 15000]);
  const d = compor({ ...e, base: TERCIARIA });
  expect(linhasDe(d, 'CARROÇAL')).toEqual([]);
}, 20000);
