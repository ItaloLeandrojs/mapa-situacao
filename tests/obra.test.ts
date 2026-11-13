import { candidatosObra, escolherObra, textoCoordenada } from '../src/nucleo/obra';
import type { ArquivoGoogle } from '../src/nucleo/tipos';

const arq = (nomes: string[], caminhos: ArquivoGoogle['caminhos'] = []): ArquivoGoogle => ({
  caminhos,
  alfinetes: nomes.map((nome, i) => ({ nome, ponto: [1000 + i, 2000 + i] })),
});

test('alfinete com OBRA no nome ganha, mesmo com outros', () => {
  const o = escolherObra(arq(['Posto', 'local da obra ']));
  expect(o?.rotulo).toBe('local da obra ');
  expect(o?.ponto).toEqual([1001, 2001]);
  expect(o?.origem).toBe('alfinete');
});

test('com mais de um OBRA, vale o primeiro', () => {
  expect(escolherObra(arq(['Obra A', 'Obra B']))?.rotulo).toBe('Obra A');
});

test('"Obra", "OBRA 2" e "obrá" contam; "Sobral" e "manobra" não', () => {
  for (const nome of ['Obra', 'OBRA 2', 'obrá', '  obra  ', 'Local-OBRA!']) {
    expect(escolherObra(arq(['Posto', nome]))?.rotulo).toBe(nome);
  }
  // com um alfinete só, ele é escolhido de qualquer jeito; use dois para provar que não casam
  for (const nome of ['Sobral', 'manobra', 'obras']) {
    expect(escolherObra(arq([nome, 'Outro']))).toBeNull();
  }
});

test('sem nome OBRA e um alfinete só: é ele', () => {
  const o = escolherObra(arq(['Sobral']));
  expect(o?.rotulo).toBe('Sobral');
  expect(o?.origem).toBe('alfinete');
});

test('dois alfinetes sem OBRA no nome: null', () => {
  expect(escolherObra(arq(['A', 'B']))).toBeNull();
});

test('nenhum alfinete: null', () => {
  expect(escolherObra(arq([], [{ nome: 'Rota', pontos: [[0, 0], [1, 1]] }]))).toBeNull();
});

test('candidatos: alfinetes e depois 2 pontas por caminho', () => {
  const a = arq(['A', ''], [
    { nome: 'Rota', pontos: [[1, 2], [3, 4], [5, 6]] },
    { nome: '', pontos: [[7, 8], [9, 10]] },
  ]);
  expect(candidatosObra(a)).toEqual([
    { rotulo: 'A', ponto: [1000, 2000], origem: 'alfinete' },
    { rotulo: 'Alfinete sem nome', ponto: [1001, 2001], origem: 'alfinete' },
    { rotulo: 'Início de Rota', ponto: [1, 2], origem: 'ponta' },
    { rotulo: 'Fim de Rota', ponto: [5, 6], origem: 'ponta' },
    { rotulo: 'Início do caminho', ponto: [7, 8], origem: 'ponta' },
    { rotulo: 'Fim do caminho', ponto: [9, 10], origem: 'ponta' },
  ]);
});

test('textoCoordenada', () => {
  expect(textoCoordenada([492399.97, 9166630.19])).toBe('0492400,9166630');
  expect(textoCoordenada([5.2, 12.9])).toBe('0000005,0000013');
});
