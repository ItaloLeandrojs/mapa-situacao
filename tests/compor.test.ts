// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import { lugaresLigadosDePartida, proporArea } from '../src/nucleo/area';
import { cadeiaDaRota as cadeiaDaRotaNaZona, compor, pertoDaPropria, zonaDaRota, type Entrada } from '../src/nucleo/compor';
import { G } from '../src/nucleo/geom';
import { escala, MEDIDAS } from '../src/nucleo/medidas';
import { textoCoordenada } from '../src/nucleo/obra';
import { larguraTexto } from '../src/nucleo/rotulos';
import { caminhoRiscado, entradaMaisPerto, sugerirCaminho } from '../src/nucleo/chegada';
import { caixaDoDetalhe, cantoMaisVazio, comporDetalhe, proporJanelaDetalhe, type EntradaDetalhe } from '../src/nucleo/detalhe';
import { casoAfastado, semRiscado } from './fixtures/chegada';
import { encostaEm, PISTA_E_CAIXA } from './fixtures/tinta';
import type { Aresta, Base, Canto, Desenho, Janela, Lugar, Primitiva, Pt, PtU } from '../src/nucleo/tipos';

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

// comprimento das linhas `de` que corre em cima das linhas `sobre` (a menos de tol), medido em passos de 0,05
function emCima(de: PtU[][], sobre: PtU[][], tol = 0.02): number {
  let total = 0;
  for (const l of de) {
    for (let k = 1; k < l.length; k++) {
      const [[ax, ay], [bx, by]] = [l[k - 1], l[k]];
      const c = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(c / 0.05));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        if (ateLinhas([ax + t * (bx - ax), ay + t * (by - ay)], sobre) < tol) total += c / n;
      }
    }
  }
  return total;
}

test('bordas do carroçal só na camada CARROÇAL; a rota amarela segue pelo meio do carroçal até o círculo', () => {
  const obra: Pt = [13000, 15000];
  const d = compor({ ...entrada(obra), base: TERCIARIA });
  const esc = escala(JANELA, Q);
  const carrocal = linhasDe(d, 'CARROÇAL');
  const rota = linhasDe(d, 'ROTA');
  expect(carrocal.length).toBeGreaterThan(0);
  // nenhum trecho da ROTA em cima de uma borda do carroçal (só o canto onde as linhas se encontram)
  expect(emCima(rota, carrocal)).toBeLessThan(0.1);
  // a rota passa pelo meio do carroçal, longe das bordas, até o centro do círculo
  for (const x of [11000, 11500, 12000, 12500, 13000]) {
    expect(ateLinhas(esc.paraU([x, 15000]), rota), `x = ${x}`).toBeLessThan(0.01);
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

test('crédito nunca cobre outro texto: com P/ nos dois cantos de baixo, vai para um canto de cima', () => {
  // estradas de ALFA para OESTE e LESTE, que saem pela borda de baixo perto dos dois cantos
  const [OESTE, LESTE]: Pt[] = [[-7469, -3000], [27469, -3000]];
  const aresta = (id: number, b: number, p: Pt): Aresta =>
    ({ id, a: 3, b, ref: `CE-${id}`, classe: 'primary', m: Math.hypot(p[0] - 10000, p[1] - 10000), pts: [[10000, 10000], p] });
  const base: Base = {
    ...BASE,
    nos: new Map([...BASE.nos, [6, OESTE], [7, LESTE]]),
    arestas: [...BASE.arestas, aresta(8, 6, OESTE), aresta(9, 7, LESTE)],
    lugares: [...BASE.lugares, sede('OESTE', OESTE), sede('LESTE', LESTE)],
  };
  const d = compor({ ...entrada([10000, 15000]), base, credito: true });
  const ts = textos(d);
  // os dois P/ junto da borda de baixo, perto dos cantos
  for (const txt of ['P/ OESTE', 'P/ LESTE']) {
    const p = ts.find((t) => t.txt === txt);
    expect(p, txt).toBeDefined();
    expect(p!.centro[1], txt).toBeLessThan(MEDIDAS.margem + 2 * MEDIDAS.texto);
  }
  const credito = ts.find((t) => t.id === 'credito')!;
  const caixa = (t: Texto) => {
    const w = larguraTexto(t.txt, t.h) / 2;
    return [t.centro[0] - w, t.centro[1] - t.h / 2, t.centro[0] + w, t.centro[1] + t.h / 2];
  };
  const [a0, b0, a1, b1] = caixa(credito);
  for (const t of ts.filter((t) => t !== credito)) {
    const [c0, e0, c1, e1] = caixa(t);
    const cobre = Math.min(a1, c1) - Math.max(a0, c0) > 1e-9 && Math.min(b1, e1) - Math.max(b0, e0) > 1e-9;
    expect(cobre, `crédito em cima de "${t.txt}"`).toBe(false);
  }
}, 20000);

test('pertoDaPropria: sem outra estrada no mapa, todo candidato vale; com outra mais perto, não', () => {
  const propria: PtU[] = [[10, 10], [10, 30]];
  const so = pertoDaPropria(propria, G.linha(propria));
  // a 5 da própria e nenhuma outra estrada: vale
  expect(so([[15, 20]])).toEqual([[15, 20]]);
  // outra estrada a 1 do candidato (a própria fica a 5): não vale; do outro lado, vale
  const comOutra = pertoDaPropria(propria, G.uniao([G.linha(propria), G.linha([[16, 10], [16, 30]])]));
  expect(comOutra([[15, 20], [5, 20]])).toEqual([[5, 20]]);
  // até uma altura de texto mais longe da própria que da outra ainda vale
  expect(comOutra([[13.4, 20]])).toEqual([[13.4, 20]]);
});

// a rodovia de BASE com duas estradas paralelas (primary com ref, desenhadas inteiras) a ± dx metros, de y0 a y1
function comParalelas(dx: number, y0: number, y1: number): Base {
  const nos: Pt[] = [[10000 - dx, y0], [10000 - dx, y1], [10000 + dx, y0], [10000 + dx, y1]];
  const aresta = (id: number, a: number, b: number): Aresta => ({
    id, a, b, ref: `CE-${id}`, classe: 'primary', m: y1 - y0, pts: [nos[a - 11], nos[b - 11]],
  });
  return {
    ...BASE,
    nos: new Map([...BASE.nos, ...nos.map((p, i): [number, Pt] => [11 + i, p])]),
    arestas: [...BASE.arestas, aresta(21, 11, 12), aresta(22, 13, 14)],
  };
}

test('LOCAL DA OBRA sem lugar livre nos 6 de sempre vai para um anel mais longe, livre', () => {
  // obra em cima da rodovia; paralelas a 4 unidades dos dois lados, só perto da obra: os 6 lugares de sempre
  // encostam em alguma estrada
  const esc = escala(JANELA, Q);
  const obra: Pt = [10000, 15000];
  const d = compor({ ...entrada(obra), base: comParalelas(4 * esc.mPorU, 14000, 16000) });
  const ts = textos(d).filter((t) => t.camada === 'LOCAL_DA_OBRA');
  expect(ts.map((t) => t.txt)).toEqual(['LOCAL DA OBRA', textoCoordenada(obra)]);
  for (const t of ts) expect(encostaEm(d, t, PISTA_E_CAIXA), t.txt).toBe(false);
  // mais longe do círculo que o mais longe dos 6 de sempre
  const [ox, oy] = esc.paraU(obra);
  const dx = MEDIDAS.raioObra + larguraTexto('LOCAL DA OBRA', MEDIDAS.texto) / 2 + MEDIDAS.folgaObra;
  const dy = MEDIDAS.raioObra + MEDIDAS.texto * 1.8;
  const meio: PtU = [ts[0].centro[0], (ts[0].centro[1] + ts[1].centro[1]) / 2];
  expect(Math.hypot(meio[0] - ox, meio[1] - oy)).toBeGreaterThan(Math.hypot(dx, 0.6 * dy) + 0.01);
}, 20000);

test('rótulo de estrada sem lugar livre fica de fora (não vai para cima da estrada)', () => {
  // paralelas a 3 unidades dos dois lados ao longo de todo o trecho ALFA-obra: o rótulo não cabe entre elas
  const esc = escala(JANELA, Q);
  const obra: Pt = [10000, 15000];
  const rotulos = (x: Desenho) => textos(x).filter((t) => t.id.startsWith('trecho:'));
  expect(rotulos(compor(entrada(obra))).length).toBeGreaterThan(0);
  const d = compor({ ...entrada(obra), base: comParalelas(3 * esc.mPorU, 9000, 16000) });
  expect(rotulos(d)).toEqual([]);
}, 20000);

// a cadeia vertical de 10 km e a rota que a cruza no ângulo dado, andando `compr` m
const cruzando = (graus: number, compr: number): Pt[] => {
  const a = (graus * Math.PI) / 180;
  const [dx, dy] = [Math.sin(a) * compr / 2, Math.cos(a) * compr / 2];
  return [[-dx, 5000 - dy], [dx, 5000 + dy]];
};

const cadeiaDaRota = (linha: Pt[], naBase: Pt[][]) => cadeiaDaRotaNaZona(linha, zonaDaRota(naBase));

test('rota que cruza uma rodovia em ângulo de 10° por 1,2 km não prioriza o rótulo dela', () => {
  const cadeia: Pt[] = [[0, 0], [0, 10000]];
  // a 10°, a rota fica a até 100 m da rodovia por uns 1,15 km (2 · 100 / sen 10°): mais que o 1 km que bastava
  // antes, mas é cruzamento (distância média de uns 50 m)
  expect(cadeiaDaRota(cadeia, [cruzando(10, 6000)])).toBe(false);
  expect(cadeiaDaRota(cadeia, [cruzando(5, 12000)])).toBe(false);
});

test('rota em cima da rodovia, com desvio de 15 m por 1,2 km, prioriza o rótulo dela', () => {
  const cadeia: Pt[] = [[0, 0], [0, 10000]];
  expect(cadeiaDaRota(cadeia, [[[15, 3000], [15, 4200]]])).toBe(true);
  // também quando a rota anda um pouco torta (de 0 a 30 m de desvio)
  expect(cadeiaDaRota(cadeia, [[[0, 3000], [30, 4200]]])).toBe(true);
});

test('cadeiaDaRota: metade da cadeia ou 1 km percorrido pela rota; cruzar a rodovia não conta', () => {
  const cadeia: Pt[] = [[0, 0], [0, 4000]];
  // rota em cima da metade de baixo (2 km de 4): conta
  expect(cadeiaDaRota(cadeia, [[[30, 0], [30, 2000]]])).toBe(true);
  // rota por 1,2 km de uma cadeia de 10 km: conta
  expect(cadeiaDaRota([[0, 0], [0, 10000]], [[[0, 3000], [0, 4200]]])).toBe(true);
  // rota por 600 m de 10 km: não conta
  expect(cadeiaDaRota([[0, 0], [0, 10000]], [[[0, 3000], [0, 3600]]])).toBe(false);
  // rota que só cruza a cadeia, ou passa a 300 m dela: não conta
  expect(cadeiaDaRota(cadeia, [[[-3000, 2000], [3000, 2000]]])).toBe(false);
  expect(cadeiaDaRota(cadeia, [[[300, 0], [300, 4000]]])).toBe(false);
  expect(cadeiaDaRota(cadeia, [])).toBe(false);
});

test('a cadeia por onde a rota passa é rotulada antes: disputando o lugar com uma mais comprida, ela ganha', () => {
  // CE-1 de ALFA até a obra (2 km, a rota) e CE-2 de ALFA até BETA, paralela a 300 m (2,5 km): o lugar é um só
  const nos: [number, Pt][] = [[1, [10000, 10000]], [2, [10000, 12000]], [3, [10300, 10200]], [4, [10300, 12300]], [9, [10000, 2000]]];
  const P = new Map(nos);
  const ar = (id: number, a: number, b: number, ref: string): Aresta => ({
    id, a, b, ref, classe: 'tertiary', m: Math.hypot(P.get(a)![0] - P.get(b)![0], P.get(a)![1] - P.get(b)![1]), pts: [P.get(a)!, P.get(b)!],
  });
  const base: Base = {
    data: 'teste', nos: P, arestas: [ar(1, 9, 1, 'CE-1'), ar(2, 1, 2, 'CE-1'), ar(3, 1, 3, 'CE-2'), ar(4, 3, 4, 'CE-2')],
    lugares: [sede('ALFA', [10000, 10000]), sede('BETA', [10300, 12300])],
  };
  const obra: Pt = [10000, 12000];
  const d = compor({
    base, arquivo: { caminhos: [{ nome: 'Rota', pontos: [[10000, 10000], obra] }], alfinetes: [{ nome: 'LOCAL DA OBRA', ponto: obra }] },
    obra, janela: JANELA, quadro: Q, ligados: ['ALFA', 'BETA'], ajustes: {}, credito: false,
  });
  const rotulos = textos(d).filter((t) => t.id.startsWith('trecho:')).map((t) => t.txt);
  expect(rotulos).toEqual(['CE1', '2Km']);
}, 20000);

test('pertoDaPropria: a continuação da mesma rodovia (depois da saída do carroçal) não conta como outra estrada', () => {
  const propria: PtU[] = [[10, 10], [10, 30]];
  const continuacao: PtU[] = [[10, 30], [16, 36]];
  const eixo = G.uniao([G.linha(propria), G.linha(continuacao)]);
  // a 1,4 da continuação e a 5,4 da própria: com a continuação como outra, não vale; como a mesma, vale
  expect(pertoDaPropria(propria, eixo)([[14, 33]])).toEqual([]);
  expect(pertoDaPropria(propria, eixo, [continuacao])([[14, 33]])).toEqual([[14, 33]]);
});

// impressão digital do desenho inteiro (todos os números com todas as casas)
const digital = (d: Desenho) => createHash('sha256').update(JSON.stringify(d)).digest('hex');
// o caso afastado do Cariri (Tarefa 2) no quadro q, com a área proposta e os lugares de partida
function cariri(q: { w: number; h: number }): Entrada {
  const c = casoAfastado();
  const janela = proporArea(c.obra, c.rota, c.base.lugares, q);
  return {
    base: c.base, arquivo: c.arquivo, obra: c.obra, janela, quadro: q,
    ligados: lugaresLigadosDePartida(c.base.lugares, janela), ajustes: {}, credito: true,
  };
}

test('compor sem detalhe dá o mesmo desenho de antes (ouro intacto)', () => {
  // impressões tiradas antes da Tarefa 3 (commit d2da62a)
  const obra: Pt = [13000, 15000];
  expect([
    compor(entrada(obra)),
    compor({ ...entrada(obra), base: TERCIARIA, credito: true }),
    compor(cariri(Q)),
    compor(cariri({ w: 80, h: 70 })),
  ].map(digital)).toEqual([
    '409a6add4d65fe75dca0618d93edf51f3ff9bc0b8b7c59ad20db349055595eab',
    '599737905694257e036bda5056fde721fe1867a6d3d0e84b9a99dd6de3dfee27',
    '8b908db8c2315501b881fb509eedbc8cd6eb0fa24098f661e3362aea68989a07',
    // Cariri 80x70: o JAMACARU e o rótulo da CE-153 mudaram de lugar pela correção de cidade em centro cheio
    // (Tarefa 6, aprovada pelo Italo em 16/11)
    '815c3de47d0b7bbb841aa981ba6d961ee6686d8b1e876ee75328a5e971a25a1f',
  ]);
}, 30000);

// o segmento ab entra no miolo da caixa? (recorte de Liang-Barsky, sem contar a borda)
function entraNaCaixa([ax, ay]: PtU, [bx, by]: PtU, [x0, y0, x1, y1]: number[]): boolean {
  let [t0, t1] = [0, 1];
  const [dx, dy] = [bx - ax, by - ay];
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) {
      if (q <= 1e-9) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  return t1 - t0 > 1e-9;
}

// compõe com o detalhe e separa o mapa geral das primitivas do detalhe (que vêm no fim)
function separar(e: Entrada): { geral: Primitiva[]; det: Primitiva[] } {
  const d = compor(e);
  const det = comporDetalhe({ base: e.base, obra: e.obra, alfinetes: e.arquivo.alfinetes, ligados: e.ligados, quadro: e.quadro, detalhe: e.detalhe! });
  const geral = d.prims.slice(0, d.prims.length - det.length);
  expect(d.prims.slice(geral.length)).toEqual(det);
  return { geral, det };
}

// o que o mapa geral põe dentro da caixa: segmentos de linha, círculos e caixas de texto
function geralNaCaixa(geral: Primitiva[], caixa: number[]): string[] {
  const [x0, y0, x1, y1] = caixa;
  return geral.flatMap((p) => {
    if (p.t === 'linha') {
      const pts = p.fechada ? [...p.pts, p.pts[0]] : p.pts;
      return pts.some((b, k) => k > 0 && entraNaCaixa(pts[k - 1], b, caixa)) ? [`linha ${p.camada}`] : [];
    }
    const [cx, cy] = p.centro;
    const [w, h] = p.t === 'texto' ? [larguraTexto(p.txt, p.h) / 2, p.h / 2] : [p.r, p.r];
    const cruza = Math.min(cx + w, x1) - Math.max(cx - w, x0) > 1e-9 && Math.min(cy + h, y1) - Math.max(cy - h, y0) > 1e-9;
    return cruza ? [p.t === 'texto' ? `"${p.txt}"` : `círculo ${p.camada}`] : [];
  });
}

// detalhe sem caminho no canto pedido, para a entrada sintética
function semCaminho(obra: Pt, canto: Canto): EntradaDetalhe {
  return {
    terra: [], chegada: null,
    opcoes: {
      canto, janela: proporJanelaDetalhe(obra, null, entradaMaisPerto(BASE, obra), Q),
      viradasDesligadas: [], refsDesligadas: [], sugestaoPendente: false,
    },
  };
}

test('cidade escondida pelo detalhe: a estrada segue pela parte da caixa dela que fica fora da reserva', () => {
  const k = escala(JANELA, Q).k;
  // ALFA (10000, 10000) cai em (71, 50) da prancha: a caixa dela (y de 48,5 a 51,5) cruza a reserva do canto id
  // (até y = 49,5) e a rodovia sobe por x = 71
  const x0 = 10000 - 68 / k;
  const y0 = 10000 - 47 / k;
  const janela: Janela = { x0, y0, x1: x0 + LARGURA, y1: y0 + ALTURA };
  const obra: Pt = [13000, 15000];
  const { geral } = separar({ ...entrada(obra), janela, detalhe: semCaminho(obra, 'id') });
  expect(geral.some((p) => p.t === 'texto' && p.id === 'cidade:ALFA')).toBe(false);
  expect(geral.some((p) => p.t === 'linha' && p.camada === 'CIDADE')).toBe(false);
  const [ax, ay] = escala(janela, Q).paraU([10000, 10000]);
  const topo = ay + MEDIDAS.caixaH / 2;
  const reservaY = 3 + 45 + MEDIDAS.margemDetalhe;
  // tracinhos do eixo e as duas bordas entre a reserva e o alto da caixa escondida
  // (alguma linha da camada passa perto de (x, y) em algum y da faixa, segmento por segmento)
  // (as bordas aqui são da rota, que sobe pela rodovia)
  const naFaixa = (camada: string, x: number) => [0.2, 0.4, 0.6, 0.8].some((f) => {
    const y = reservaY + f * (topo - reservaY);
    return ateLinhas([x, y], geral.flatMap((p) => (p.t === 'linha' && p.camada === camada ? [p.pts] : []))) < 0.05;
  });
  expect(naFaixa('ESTRADA_EIXO', ax)).toBe(true);
  expect(naFaixa('ROTA', ax - MEDIDAS.meiaEstrada)).toBe(true);
  expect(naFaixa('ROTA', ax + MEDIDAS.meiaEstrada)).toBe(true);
  expect(geralNaCaixa(geral, caixaDoDetalhe(Q, 'id'))).toEqual([]);
}, 20000);

test('canto manual em cima da obra: a obra do mapa geral não é desenhada', () => {
  const obra: Pt = [13000, 15000];
  // a obra cai no canto sd
  const [ox, oy] = escala(JANELA, Q).paraU(obra);
  const caixa = caixaDoDetalhe(Q, 'sd');
  expect(ox > caixa[0] && ox < caixa[2] && oy > caixa[1] && oy < caixa[3]).toBe(true);
  const { geral, det } = separar({ ...entrada(obra), detalhe: semCaminho(obra, 'sd') });
  expect(geral.filter((p) => p.camada === 'LOCAL_DA_OBRA')).toEqual([]);
  expect(geralNaCaixa(geral, caixa)).toEqual([]);
  // a obra continua no detalhe
  expect(det.some((p) => p.t === 'texto' && p.id === 'detalhe:obra')).toBe(true);
}, 20000);

// o caso afastado com o detalhe no canto mais vazio: nada do mapa geral dentro da caixa
function confereDetalhe(q: { w: number; h: number }) {
  const c = casoAfastado();
  const e = cariri(q);
  const chegada = caminhoRiscado(c.base, c.obra, c.rota)!;
  const canto = cantoMaisVazio(e.base, e.janela, q, e.obra, c.rota, e.ligados);
  const detalhe: EntradaDetalhe = {
    terra: c.terra, chegada,
    opcoes: { canto, janela: proporJanelaDetalhe(c.obra, chegada, chegada.entrada, q), viradasDesligadas: [], refsDesligadas: [], sugestaoPendente: false },
  };
  const { geral, det } = separar({ ...e, detalhe });
  expect(geralNaCaixa(geral, caixaDoDetalhe(q, canto))).toEqual([]);
  // a obra e a rota continuam no mapa geral; o mapa geral tem estradas e textos
  expect(geral.filter((p) => p.t === 'circulo' && p.camada === 'LOCAL_DA_OBRA')).toHaveLength(2);
  expect(geral.some((p) => p.t === 'linha' && p.camada === 'ROTA')).toBe(true);
  expect(geral.filter((p) => p.t === 'texto' && p.id.startsWith('trecho:')).length).toBeGreaterThan(0);
  expect(det.some((p) => p.t === 'texto' && p.id === 'detalhe:titulo')).toBe(true);
}

test('compor com detalhe: nenhuma linha nem texto do mapa geral dentro da caixa', () => {
  confereDetalhe(Q);
}, 30000);

test('compor com detalhe num quadro 80 × 70: idem', () => {
  confereDetalhe({ w: 80, h: 70 });
}, 30000);

// o caso afastado sem o caminho riscado, com o caminho sugerido pelas estradinhas no detalhe. comoRiscado: o mesmo
// caminho vem riscado no arquivo (e a chegada do detalhe é a riscada)
function comSugerido(pendente: boolean, comoRiscado = false): Entrada {
  const s = semRiscado();
  const ch = sugerirCaminho(s.base, s.terra, s.obra, s.rota)!;
  const janela = proporArea(s.obra, s.rota, s.base.lugares, Q);
  const ligados = lugaresLigadosDePartida(s.base.lugares, janela);
  const canto = cantoMaisVazio(s.base, janela, Q, s.obra, s.rota, ligados);
  const caminhos = comoRiscado ? [...s.arquivo.caminhos, { nome: 'Terra', pontos: ch.caminho }] : s.arquivo.caminhos;
  return {
    base: s.base, arquivo: { ...s.arquivo, caminhos }, obra: s.obra, janela, quadro: Q, ligados, ajustes: {}, credito: true,
    detalhe: {
      terra: s.terra, chegada: comoRiscado ? { ...ch, origem: 'riscado' } : ch,
      opcoes: {
        canto, janela: proporJanelaDetalhe(s.obra, ch, ch.entrada, Q), viradasDesligadas: [], refsDesligadas: [], sugestaoPendente: pendente,
      },
    },
  };
}

test('caminho sugerido aceito: o mapa geral fica como se o mesmo caminho viesse riscado no arquivo', () => {
  const e = comSugerido(false);
  const { geral } = separar(e);
  expect(geral).toEqual(separar(comSugerido(false, true)).geral);
  // o caminho chega no círculo da obra no mapa geral
  const obra = escala(e.janela, Q).paraU(e.obra);
  expect(ateLinhas(obra, linhasDe({ quadro: Q, prims: geral }, 'ROTA'))).toBeLessThan(MEDIDAS.raioObra);
  expect(geral.some((p) => p.t === 'linha' && p.soPrevia)).toBe(false);
}, 30000);

test('caminho sugerido pendente: no mapa geral só a prévia (soPrevia); o resto é o desenho sem caminho', () => {
  const e = comSugerido(true);
  const d = compor(e);
  const semPrevia = d.prims.filter((p) => !(p.t === 'linha' && p.soPrevia));
  const det = e.detalhe!;
  const semCaminho = compor({ ...e, detalhe: { ...det, chegada: null, opcoes: { ...det.opcoes, sugestaoPendente: false } } });
  expect(semPrevia).toEqual(semCaminho.prims);
  // a prévia do mapa geral é o caminho na ROTA, fora da caixa do detalhe, e chega na obra
  const previa = separar(e).geral.filter((p) => p.t === 'linha' && p.soPrevia);
  expect(previa.length).toBeGreaterThan(0);
  expect(previa.every((p) => p.camada === 'ROTA' && p.t === 'linha' && p.largura === MEDIDAS.larguraRota)).toBe(true);
  expect(geralNaCaixa(previa, caixaDoDetalhe(Q, det.opcoes.canto))).toEqual([]);
  const obra = escala(e.janela, Q).paraU(e.obra);
  expect(ateLinhas(obra, previa.flatMap((p) => (p.t === 'linha' ? [p.pts] : [])))).toBeLessThan(1e-6);
}, 30000);

