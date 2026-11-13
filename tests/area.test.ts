// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aproximar, LADO_MAX, LADO_MIN, lugaresLigadosDePartida, mover, proporArea } from '../src/nucleo/area';
import { lerArquivoGoogle } from '../src/nucleo/kml';
import type { Janela, Lugar, Pt } from '../src/nucleo/tipos';
import { baseCariri, CIDADES_V4, JANELA_V4, OBRA_V4 } from './fixtures/v4';

const Q = { w: 124.6, h: 113 };
const lado = (j: Janela) => Math.max(j.x1 - j.x0, j.y1 - j.y0);
const dentro = (j: Janela, p: Pt) => p[0] >= j.x0 && p[0] <= j.x1 && p[1] >= j.y0 && p[1] <= j.y1;

test('proporArea no Cariri contém a rota, Porteiras, Brejo Santo e Juazeiro do Norte, e tem a proporção 118.6/96', () => {
  const arq = lerArquivoGoogle(new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'ce397.kml'))));
  const rota = arq.caminhos.map((c) => c.pontos);
  const base = baseCariri(0);
  const j = proporArea(OBRA_V4, rota, base.lugares, Q);
  for (const p of rota.flat()) expect(dentro(j, p)).toBe(true);
  expect(dentro(j, OBRA_V4)).toBe(true);
  for (const nome of ['PORTEIRAS', 'BREJO SANTO', 'JUAZEIRO DO NORTE']) {
    const l = base.lugares.find((x) => x.nome === nome)!;
    expect(l, nome).toBeDefined();
    expect(dentro(j, l.ponto), nome).toBe(true);
  }
  expect((j.x1 - j.x0) / (j.y1 - j.y0)).toBeCloseTo(118.6 / 96, 6);
});

test('proporArea nunca dá lado maior abaixo de 20 km', () => {
  const obra: Pt = [500000, 9170000];
  const j = proporArea(obra, [[[500000, 9170000], [500500, 9170300]]], [], Q);
  expect(lado(j)).toBeGreaterThanOrEqual(20000 - 1e-6);
  expect(dentro(j, obra)).toBe(true);
  expect((j.x1 - j.x0) / (j.y1 - j.y0)).toBeCloseTo(118.6 / 96, 6);
  expect((j.x0 + j.x1) / 2).toBeCloseTo(500250, 6);
});

test('proporArea: distrito nunca entra; só sede osm city em até 80 km entra além das 5 sedes', () => {
  const obra: Pt = [500000, 9170000];
  const rota: Pt[][] = [[obra, [503000, 9171000]]];
  const lug = (nome: string, tipo: Lugar['tipo'], osm: Lugar['osm'], ponto: Pt): Lugar => ({ nome, tipo, osm, ponto });
  // 5 sedes pequenas bem perto: a cidade testada fica sempre como 6ª mais próxima
  const cinco = [1, 2, 3, 4, 5].map((i) => lug(`S${i}`, 'sede', 'village', [500000 + i * 500, 9170000]));
  const usar = (extra: Lugar) => proporArea(obra, rota, [...cinco, extra], Q);
  const base = proporArea(obra, rota, cinco, Q);
  expect(lado(base)).toBeLessThan(40000); // janela pequena: o que entrar de longe será visível

  const distritoCity = lug('DISTRITO', 'distrito', 'city', [560000, 9170000]);
  expect(dentro(usar(distritoCity), distritoCity.ponto)).toBe(false);
  const sedeCityPerto = lug('CIDADE', 'sede', 'city', [560000, 9170000]);
  expect(dentro(usar(sedeCityPerto), sedeCityPerto.ponto)).toBe(true);
  const sedeCityLonge = lug('LONGE', 'sede', 'city', [600000, 9170000]);
  expect(dentro(usar(sedeCityLonge), sedeCityLonge.ponto)).toBe(false);
  const distritoTown = lug('POVOADO', 'distrito', 'town', [520000, 9170000]);
  expect(dentro(usar(distritoTown), distritoTown.ponto)).toBe(false);
});

test('proporArea com rota de um ponto e sem lugares dá janela finita com lado maior de pelo menos 20 km, centrada e na proporção', () => {
  const obra: Pt = [500000, 9170000];
  const j = proporArea(obra, [[obra]], [], Q);
  for (const v of [j.x0, j.y0, j.x1, j.y1]) expect(Number.isFinite(v)).toBe(true);
  expect(j.y1 - j.y0).toBeCloseTo(20000, 6); // a caixa quadrada de 20 km só cresce na largura, até a proporção
  expect(lado(j)).toBeGreaterThanOrEqual(20000);
  expect((j.x0 + j.x1) / 2).toBeCloseTo(obra[0], 6);
  expect((j.y0 + j.y1) / 2).toBeCloseTo(obra[1], 6);
  expect((j.x1 - j.x0) / (j.y1 - j.y0)).toBeCloseTo(118.6 / 96, 6);
});

test('mover desloca em metros sem mudar o tamanho', () => {
  const j = mover(JANELA_V4, 1000, -500);
  expect(j.x0).toBeCloseTo(JANELA_V4.x0 + 1000, 6);
  expect(j.y1).toBeCloseTo(JANELA_V4.y1 - 500, 6);
  expect(j.x1 - j.x0).toBeCloseTo(JANELA_V4.x1 - JANELA_V4.x0, 6);
});

test('aproximar para em 8 km e em 250 km', () => {
  let j = JANELA_V4;
  const prop = (j.x1 - j.x0) / (j.y1 - j.y0);
  const cx = (j.x0 + j.x1) / 2;
  for (let i = 0; i < 30; i++) j = aproximar(j, 1.5);
  expect(lado(j)).toBeCloseTo(LADO_MIN, 6);
  expect((j.x0 + j.x1) / 2).toBeCloseTo(cx, 6);
  expect((j.x1 - j.x0) / (j.y1 - j.y0)).toBeCloseTo(prop, 9);
  for (let i = 0; i < 30; i++) j = aproximar(j, 1 / 1.5);
  expect(lado(j)).toBeCloseTo(LADO_MAX, 6);
  expect(lado(aproximar(JANELA_V4, 2))).toBeCloseTo(lado(JANELA_V4) / 2, 6);
});

test('lugaresLigadosDePartida no Cariri com a janela da v4 dá as 9 cidades da v4', () => {
  const nomes = lugaresLigadosDePartida(baseCariri(0).lugares, JANELA_V4);
  expect([...nomes].sort()).toEqual([...CIDADES_V4].sort());
});
