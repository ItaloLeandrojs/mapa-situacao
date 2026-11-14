// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { G, type Geo } from '../src/nucleo/geom';
import { montarRede, type PontoRede } from '../src/nucleo/grafo';
import { lerArquivoGoogle } from '../src/nucleo/kml';
import { escala, MEDIDAS } from '../src/nucleo/medidas';
import { tracar } from '../src/nucleo/tracado';
import type { PtU } from '../src/nucleo/tipos';
import { normalizar } from '../scripts/base/montar';
import { baseCariri, CIDADES_V4, JANELA_V4, OBRA_V4 } from './fixtures/v4';

const Q = { w: 124.6, h: 113 };
const UTIL = { x0: MEDIDAS.margem, y0: MEDIDAS.margem, x1: Q.w - MEDIDAS.margem, y1: Q.h - MEDIDAS.topo };
const quadroUtil = () => G.caixa(UTIL.x0, UTIL.y0, UTIL.x1, UTIL.y1);
const semCaixas = () => G.uniao([]);
const caixaCidade = (c: PtU) =>
  G.caixa(c[0] - MEDIDAS.caixaW / 2, c[1] - MEDIDAS.caixaH / 2, c[0] + MEDIDAS.caixaW / 2, c[1] + MEDIDAS.caixaH / 2);
const comp = (l: PtU[]) => G.comprimento(G.linha(l));
const perto = (a: PtU, b: PtU, tol = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
const pontasDoEixo = (eixo: Geo) => G.linhas(eixo).flatMap((l) => [l[0], l[l.length - 1]]);

test('pista dupla (duas linhas paralelas a 0,05 de distância) vira um eixo só', () => {
  // a segunda pista traz um vértice repetido (segmento de comprimento zero), como sai do grafo às vezes
  const ida: PtU[] = [[20, 50], [50, 50]];
  const volta: PtU[] = [[20, 50.05], [35, 50.05], [35, 50.05], [50, 50.05]];
  const t = tracar([ida, volta], [], [], semCaixas(), quadroUtil());
  expect(Math.abs(G.comprimento(t.eixo) - 30)).toBeLessThan(0.01);
  expect(G.linhas(t.eixo)).toHaveLength(1);
  expect(G.distancia(t.eixo, G.ponto([35, 50]))).toBeLessThan(1e-9);
});

test('pedaço menor que pedacoMin fora da zona não entra', () => {
  const principal: PtU[] = [[20, 50], [60, 50]];
  const curtoSolto: PtU[] = [[20, 70], [21, 70]]; // 1 < pedacoMin
  const galhoCurto: PtU[] = [[40, 50], [40, 51]]; // só 1 − junta fica fora da zona
  const compridoSolto: PtU[] = [[20, 80], [22, 80]]; // 2 ≥ pedacoMin: entra
  const t = tracar([principal, curtoSolto, galhoCurto, compridoSolto], [], [], semCaixas(), quadroUtil());
  expect(G.comprimento(t.eixo)).toBeCloseTo(42, 6);
  expect(G.distancia(t.eixo, G.ponto([20.5, 70]))).toBeGreaterThan(1);
  expect(G.distancia(t.eixo, G.ponto([40, 51]))).toBeGreaterThan(0.9);
  expect(G.distancia(t.eixo, G.ponto([21, 80]))).toBeLessThan(1e-9);
});

test('ponta solta a menos de liga é ligada na rede', () => {
  const principal: PtU[] = [[20, 50], [60, 50]];
  const perto06: PtU[] = [[40, 50.6], [40, 60]]; // ponta a 0,6 da principal (< liga)
  const longe1: PtU[] = [[55, 51], [55, 59]]; // ponta a 1 da principal (> liga)
  const t = tracar([principal, perto06, longe1], [], [], semCaixas(), quadroUtil());
  const pontas = pontasDoEixo(t.eixo);
  expect(pontas.some((p) => perto(p, [40, 50]))).toBe(true);
  expect(G.distancia(t.eixo, G.ponto([40, 50.3]))).toBeLessThan(1e-9);
  expect(G.distancia(t.eixo, G.ponto([55, 50.5]))).toBeGreaterThan(0.4);
  expect(pontas.some((p) => perto(p, [55, 51]))).toBe(true);
});

test('contorno não passa por dentro da caixa de cidade', () => {
  const caixa = caixaCidade([40, 50]);
  const t = tracar([[[20, 50], [60, 50]], [[40, 40], [40, 60]]], [], [[[20, 50], [30, 50]]], G.uniao([caixa]), quadroUtil());
  const dentro = G.engrossa(caixa, -0.001);
  const contornos = [...t.contornoEstrada, ...t.contornoRota];
  expect(t.contornoEstrada.length).toBeGreaterThan(0);
  expect(t.contornoRota.length).toBeGreaterThan(0);
  for (const l of contornos) expect(G.comprimento(G.intersecao(G.linha(l), dentro))).toBe(0);
  for (const l of t.tracinhos) expect(G.comprimento(G.intersecao(G.linha(l), dentro))).toBe(0);
  // o eixo passa pela caixa, mas os tracinhos param na borda
  expect(G.comprimento(G.intersecao(t.eixo, dentro))).toBeGreaterThan(1);
});

test('vão entre estradas que chegam na cidade fica aberto; o mesmo vão longe de cidade (trevo) se fecha', () => {
  // estrada de oeste e de norte chegando na cidade em (40, 50) e uma ligação entre elas: um triângulo de
  // catetos 6, cujo vão (cerca de 8,8) é menor que buracoMin e encosta na caixa da cidade
  const estradas: PtU[][] = [[[20, 50], [40, 50]], [[40, 70], [40, 50]], [[34, 50], [40, 56]]];
  const vao = G.ponto([38.5, 51.5]); // dentro do triângulo, a 1,5 das duas estradas e fora da caixa
  const naCidade = tracar(estradas, [], [], G.uniao([caixaCidade([40, 50])]), quadroUtil());
  expect(G.distancia(naCidade.pista, vao)).toBeGreaterThan(0.5);
  // o bordo do vão aparece: há contorno dentro do triângulo, fora da caixa
  const noVao = (p: PtU) => p[1] > 50.3 && p[0] < 39.7 && p[1] < p[0] + 16 && !(p[0] > 37.7 && p[1] < 51.5);
  expect(naCidade.contornoEstrada.some((l) => l.some(noVao))).toBe(true);
  // sem a cidade é um trevo: o vão se fecha
  const trevo = tracar(estradas, [], [], semCaixas(), quadroUtil());
  expect(G.distancia(trevo.pista, vao)).toBe(0);
});

test('contornoRota fica todo a menos de zonaRota + 0,01 da rota; contornoEstrada fica todo fora', () => {
  const rota: PtU[][] = [[[50, 50], [70, 50], [80, 55]]];
  const estradas: PtU[][] = [[[20, 50], [100, 50]], [[60, 30], [60, 80]]];
  const t = tracar(estradas, [], rota, semCaixas(), quadroUtil());
  const r = G.uniao(rota.map((l) => G.linha(l)));
  expect(t.contornoRota.length).toBeGreaterThan(0);
  expect(t.contornoEstrada.length).toBeGreaterThan(0);
  for (const l of t.contornoRota) {
    for (const p of l) expect(G.distancia(r, G.ponto(p))).toBeLessThan(MEDIDAS.zonaRota + 0.01);
  }
  for (const l of t.contornoEstrada) expect(G.distancia(r, G.linha(l))).toBeGreaterThan(MEDIDAS.zonaRota - 0.01);
});

test('tracinhos: nenhum maior que traco + 0,01 nem menor que tracoMin', () => {
  const t = tracar([[[20, 50], [100, 50]], [[60, 20], [62, 40], [58, 60], [61, 90]]], [], [], semCaixas(), quadroUtil());
  expect(t.tracinhos.length).toBeGreaterThan(100);
  for (const l of t.tracinhos) {
    expect(comp(l)).toBeLessThanOrEqual(MEDIDAS.traco + 0.01);
    expect(comp(l)).toBeGreaterThanOrEqual(MEDIDAS.tracoMin);
  }
  // os tracinhos cobrem o eixo na proporção traco / (traco + vao)
  const soma = t.tracinhos.reduce((s, l) => s + comp(l), 0);
  expect(soma / G.comprimento(t.eixo)).toBeGreaterThan(0.5);
  expect(soma / G.comprimento(t.eixo)).toBeLessThan(0.65);
});

test('Cariri: mais de 300 tracinhos, e tudo dentro do quadro útil', () => {
  const base = baseCariri(0);
  const e = escala(JANELA_V4, Q);
  const pontos: PontoRede[] = CIDADES_V4.map((nome) => {
    const l = base.lugares.find((x) => normalizar(x.nome) === normalizar(nome))!;
    return { nome, ponto: l.ponto, tipo: 'cidade' };
  });
  pontos.push({ nome: 'OBRA', ponto: OBRA_V4, tipo: 'obra' });
  const rede = montarRede(base, pontos, JANELA_V4, e.mPorU);
  const arq = lerArquivoGoogle(new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'ce397.kml'))));
  const paraU = (ls: [number, number][][]) => ls.map((l) => l.map(e.paraU));
  const caixas = G.uniao(pontos.filter((p) => p.tipo === 'cidade').map((p) => caixaCidade(e.paraU(p.ponto))));

  const t = tracar(paraU(rede.trechos), paraU(rede.viasRef), paraU(arq.caminhos.map((c) => c.pontos)), caixas, quadroUtil());

  expect(t.tracinhos.length).toBeGreaterThan(300);
  expect(t.contornoEstrada.length).toBeGreaterThan(0);
  expect(t.contornoRota.length).toBeGreaterThan(0);
  const dentro = (p: PtU) => p[0] >= UTIL.x0 - 1e-9 && p[0] <= UTIL.x1 + 1e-9 && p[1] >= UTIL.y0 - 1e-9 && p[1] <= UTIL.y1 + 1e-9;
  const todas = [...G.linhas(t.eixo), ...G.linhas(G.contorno(t.pista)), ...t.contornoEstrada, ...t.contornoRota, ...t.tracinhos];
  for (const l of todas) for (const p of l) expect(dentro(p), `${p}`).toBe(true);
}, 3000); // alarme: o traçado do Cariri leva menos de 1,5 s

test('linha do meio da rota no carroçal: cortada pela caixa de cidade e pela faixa junto da borda do quadro útil', () => {
  // estrada em y = 50; carroçal sai dela em x = 40, atravessa uma cidade e vai até a borda de cima
  const caixa = caixaCidade([60, 70]);
  const carrocal: PtU[][] = [[[40, 50], [60, 70], [60, UTIL.y1 + 5]]];
  const t = tracar([[[20, 50], [100, 50]]], [], [], G.uniao([caixa]), quadroUtil(), carrocal);
  expect(t.rotaNoCarrocal.length).toBeGreaterThan(0);
  const dentro = G.engrossa(caixa, -0.001);
  for (const l of t.rotaNoCarrocal) {
    expect(G.comprimento(G.intersecao(G.linha(l), dentro))).toBe(0);
    // a mesma faixa que as bordas não usam (5 m do teste, 0,0089)
    for (const [, y] of l) expect(y).toBeLessThan(UTIL.y1 - 0.0089 + 1e-6);
  }
});
