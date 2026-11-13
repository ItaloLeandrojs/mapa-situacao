import { G } from '../src/nucleo/geom';
import { MEDIDAS } from '../src/nucleo/medidas';
import { Ocupacao, textoKm, textoRef } from '../src/nucleo/rotulos';

const util = () => G.caixa(0, 0, 100, 100);

test('textoKm', () => {
  expect(textoKm(20)).toBe('20Km');
  expect(textoKm(12.5)).toBe('12,5Km');
  expect(textoKm(4.44)).toBe('4,4Km');
  expect(textoKm(0.45)).toBe('450m');
});

test('textoRef', () => {
  expect(textoRef('CE-397')).toBe('CE397');
  expect(textoRef('BR-116;CE-293')).toBe('BR116/CE293');
});

test('coloca escolhe o candidato livre e o seguinte não cai em cima', () => {
  const o = new Ocupacao(util(), [G.caixa(40, 40, 60, 60)]);
  // o primeiro candidato cai em cima do ocupado: fica o segundo
  expect(o.coloca(['ABC'], [[50, 50], [80, 80]])).toEqual([80, 80]);
  // o lugar escolhido agora está ocupado (com respiro): o mesmo texto vai para o próximo livre
  expect(o.coloca(['ABC'], [[80, 80], [20, 20]])).toEqual([20, 20]);
  // um texto de largura 3 × 0,74 × 1,152 ≈ 2,56 a menos de respiroTexto do anterior também perde
  const encosta = 80 + 2 * 0.74 * MEDIDAS.texto * 3 / 2 + MEDIDAS.respiroTexto / 2;
  expect(o.coloca(['ABC'], [[encosta, 80], [20, 80]])).toEqual([20, 80]);
  // sem candidato livre fica o que menos encosta
  expect(o.coloca(['ABC'], [[50, 50], [41, 50]])).toEqual([41, 50]);
});

test('candidato fora do quadro útil perde para um dentro', () => {
  const o = new Ocupacao(util(), []);
  expect(o.coloca(['ABC'], [[-5, 50], [50, 50]])).toEqual([50, 50]);
  // meio fora perde para um dentro que encosta um pouco no ocupado (fora pesa 5 vezes)
  const p = new Ocupacao(util(), [G.caixa(49, 0, 60, 100)]);
  expect(p.coloca(['ABC'], [[0.5, 50], [49 - 1.28 + 0.2, 50]])).toEqual([49 - 1.28 + 0.2, 50]);
});

test('bloco de duas linhas ocupa a altura das duas', () => {
  const o = new Ocupacao(util(), []);
  expect(o.coloca(['CE397', '12,5Km'], [[50, 50]])).toEqual([50, 50]);
  // uma linha logo acima, a 1,5 × texto do centro, cai em cima do bloco de duas linhas
  expect(o.coloca(['X'], [[50, 50 + 1.5 * MEDIDAS.texto], [10, 10]])).toEqual([10, 10]);
});
