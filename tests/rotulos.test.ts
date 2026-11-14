import { G } from '../src/nucleo/geom';
import { MEDIDAS } from '../src/nucleo/medidas';
import { larguraTexto, Ocupacao, textoKm, textoRef } from '../src/nucleo/rotulos';

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

test('larguraTexto: largura do Arial desenhado (altura do texto = altura da maiúscula), dentro de 2%', () => {
  // valores do ezdxf (fonts.make_font('arial.ttf', 1.152).text_width), que desenha como o AutoCAD
  const reais: [string, number][] = [
    ['GUARAMIRANGA', 13.2339],
    ['BR404/CE187', 10.2886],
    ['35,2Km', 5.5463],
    ['0313225,9424930', 12.9777],
    ['P/ SÃO GONÇALO DO AMARANTE', 26.1117],
    ['INDEPENDÊNCIA', 13.2346],
  ];
  for (const [txt, w] of reais) expect(Math.abs(larguraTexto(txt, 1.152) / w - 1), txt).toBeLessThan(0.02);
  // proporcional à altura
  expect(larguraTexto('GUARAMIRANGA', 2.304)).toBeCloseTo(2 * larguraTexto('GUARAMIRANGA', 1.152), 9);
});

test('coloca escolhe o candidato livre e o seguinte não cai em cima', () => {
  const o = new Ocupacao(util(), [G.caixa(40, 40, 60, 60)]);
  // o primeiro candidato cai em cima do ocupado: fica o segundo
  expect(o.coloca(['ABC'], [[50, 50], [80, 80]])).toEqual([80, 80]);
  // o lugar escolhido agora está ocupado (com respiro): o mesmo texto vai para o próximo livre
  expect(o.coloca(['ABC'], [[80, 80], [20, 20]])).toEqual([20, 20]);
  // o mesmo texto a menos de respiroTexto do anterior (meia largura de cada lado + meio respiro) também perde
  const encosta = 80 + larguraTexto('ABC', MEDIDAS.texto) + MEDIDAS.respiroTexto / 2;
  expect(o.coloca(['ABC'], [[encosta, 80], [20, 80]])).toEqual([20, 80]);
  // sem candidato livre fica o que menos encosta
  expect(o.coloca(['ABC'], [[50, 50], [41, 50]])).toEqual([41, 50]);
});

test('colocaSemCobrir: nunca em cima de outro texto; sem candidato livre de texto, não coloca', () => {
  const o = new Ocupacao(util(), [G.caixa(40, 40, 60, 60)]);
  o.coloca(['SOBRAL'], [[20, 20]]);
  // em cima da estrada (ocupado que não é texto) pode, se for o que menos encosta
  expect(o.colocaSemCobrir(['CE417', '1,9Km'], [[50, 50], [20, 20]])).toEqual([50, 50]);
  // só candidatos em cima de texto: não coloca e não ocupa nada
  expect(o.colocaSemCobrir(['CE440'], [[20, 20], [21, 20]])).toBeNull();
  expect(o.colocaSemCobrir(['CE440'], [[20, 23]])).toEqual([20, 23]);
  // o texto posto por colocaSemCobrir também conta como texto
  expect(o.colocaSemCobrir(['X'], [[50, 50]])).toBeNull();
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

test('colocaLivre: só candidato cuja tinta não encosta no ocupado de partida (pista, caixa) nem em texto', () => {
  const o = new Ocupacao(util(), [G.caixa(40, 40, 60, 60)]);
  // o primeiro encosta na pista: fica o segundo
  expect(o.colocaLivre(['ABC'], [[50, 50], [80, 80]])).toEqual([80, 80]);
  // todos encostam na pista: não coloca e não ocupa nada
  expect(o.colocaLivre(['ABC'], [[50, 50], [41, 50]])).toBeNull();
  // em cima de texto também não
  expect(o.colocaLivre(['X'], [[80, 80]])).toBeNull();
  // vale a tinta (altura das letras) com a folga da rota: logo acima da pista, a entrelinha pode encostar
  const h = MEDIDAS.texto;
  expect(o.colocaLivre(['DEF'], [[50, 60 + h / 2 + MEDIDAS.larguraRota]])).toEqual([50, 60 + h / 2 + MEDIDAS.larguraRota]);
  expect(o.colocaLivre(['GHI'], [[50, 40 - h / 2 - MEDIDAS.larguraRota / 4]])).toBeNull();
  // fora do quadro útil não é livre
  expect(o.colocaLivre(['JKL'], [[99.5, 20]])).toBeNull();
});

test('colocaLivre separado: longe dos outros textos (dois espaços de lado), não só sem cobrir', () => {
  const o = new Ocupacao(util(), []);
  o.coloca(['ABC'], [[50, 50]]);
  const ao = 50 + larguraTexto('ABC', MEDIDAS.texto) / 2 + 0.3 + larguraTexto('X', MEDIDAS.texto) / 2;
  // a 0,3 do ABC: sem cobrir, mas encostado
  expect(o.colocaLivre(['X'], [[ao, 50]], MEDIDAS.texto, true)).toBeNull();
  expect(o.colocaLivre(['X'], [[ao, 50]])).toEqual([ao, 50]);
});
