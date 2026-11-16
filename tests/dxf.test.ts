import { nomeDoArquivo, paraDxf } from '../src/nucleo/dxf';
import type { Desenho } from '../src/nucleo/tipos';

const desenho: Desenho = {
  quadro: { w: 124.6, h: 113 },
  prims: [
    { t: 'linha', camada: 'ESTRADA', pts: [[0, 0], [10, 0], [10, 5]], fechada: true },
    { t: 'linha', camada: 'ROTA', pts: [[1, 1], [2.5, 3.25]], largura: 0.22 },
    { t: 'linha', camada: 'ESTRADA_EIXO', pts: [[3, 3], [4, 4]] },
    { t: 'texto', camada: 'CIDADE', id: 'cidade:MISSÃO VELHA', txt: 'MISSÃO VELHA', centro: [20.5, 30.25], h: 1.152 },
    { t: 'texto', camada: 'TEXTO', id: 'x', txt: 'A→B', centro: [1, 2], h: 1.152 },
    { t: 'circulo', camada: 'LOCAL_DA_OBRA', centro: [50, 60], r: 1.329 },
  ],
};

const bytes = paraDxf(desenho);
const texto = Array.from(bytes, (b) => String.fromCharCode(b)).join(''); // um caractere por byte
const linhas = texto.split('\r\n');
// pares (código, valor)
const pares: [number, string][] = [];
for (let i = 0; i + 1 < linhas.length; i += 2) pares.push([Number(linhas[i].trim()), linhas[i + 1]]);

// os pares que seguem a primeira entidade do tipo, até o próximo código 0
function entidade(tipo: string, n = 0): [number, string][] {
  let achou = -1;
  for (let k = 0, i = 0; i < pares.length; i++) {
    if (pares[i][0] === 0 && pares[i][1] === tipo && k++ === n) { achou = i; break; }
  }
  expect(achou).toBeGreaterThanOrEqual(0);
  const fim = pares.findIndex((p, i) => i > achou && p[0] === 0);
  return pares.slice(achou + 1, fim);
}
const valor = (ps: [number, string][], codigo: number) => ps.find((p) => p[0] === codigo)?.[1];

test('começa com a seção HEADER e termina com EOF', () => {
  expect(linhas.slice(0, 4)).toEqual(['0', 'SECTION', '2', 'HEADER']);
  expect(linhas[linhas.length - 1]).toBe('');
  expect(linhas.slice(-3, -1)).toEqual(['0', 'EOF']);
  expect(pares.some((p) => p[0] === 9 && p[1] === '$ACADVER')).toBe(true);
  expect(texto).toContain('AC1009');
  expect(texto).toContain('ANSI_1252');
});

test('as 8 camadas estão na tabela com as cores 30, 7, 30, 2, 7, 7, 1, 7', () => {
  const camadas: [string, string][] = [];
  pares.forEach((p, i) => {
    if (p[0] === 0 && p[1] === 'LAYER') {
      const fim = pares.findIndex((q, j) => j > i && q[0] === 0);
      const ps = pares.slice(i + 1, fim);
      camadas.push([valor(ps, 2)!, valor(ps, 62)!.trim()]);
    }
  });
  expect(camadas).toEqual([
    ['ESTRADA', '30'], ['ESTRADA_EIXO', '7'], ['CARROÇAL', '30'], ['ROTA', '2'], ['CIDADE', '7'], ['TEXTO', '7'], ['LOCAL_DA_OBRA', '1'],
    ['TITULO', '7'],
  ]);
  // estilo ARIAL com arial.ttf
  expect(texto).toContain('arial.ttf');
  expect(texto).toContain('STANDARD');
});

test('"MISSÃO VELHA" sai com o byte 0xC3 no lugar do Ã', () => {
  const i = bytes.findIndex((_, k) => String.fromCharCode(...bytes.slice(k, k + 12)) === 'MISS\xC3O VELHA');
  expect(i).toBeGreaterThan(0);
  expect(bytes.includes(0xc3) && !bytes.includes(0xc2)).toBe(true);
});

test('caractere fora do Windows-1252 vira "?"', () => {
  expect(texto).toContain('A?B');
  expect(bytes.every((b) => b < 256)).toBe(true);
});

test('linha fechada tem 70 = 1; linha com largura tem 40 e 41', () => {
  const fechada = entidade('POLYLINE', 0);
  expect(valor(fechada, 70)?.trim()).toBe('1');
  expect(valor(fechada, 8)).toBe('ESTRADA');
  const larga = entidade('POLYLINE', 1);
  expect(valor(larga, 70)?.trim()).toBe('0');
  expect(valor(larga, 40)?.trim()).toBe('0.2200');
  expect(valor(larga, 41)?.trim()).toBe('0.2200');
  const fina = entidade('POLYLINE', 2);
  expect(valor(fina, 40)).toBeUndefined();
  // 3 + 2 + 2 vértices e 3 SEQEND
  expect(pares.filter((p) => p[0] === 0 && p[1] === 'VERTEX')).toHaveLength(7);
  expect(pares.filter((p) => p[0] === 0 && p[1] === 'SEQEND')).toHaveLength(3);
  // vértice com 4 casas
  const v = entidade('VERTEX', 4); // segundo vértice da rota: 2.5000;
  expect(valor(v, 10)?.trim()).toBe('2.5000');
  expect(valor(v, 20)?.trim()).toBe('3.2500');
});

test('texto tem 72 = 1, 73 = 2 e o ponto de alinhamento no centro', () => {
  const t = entidade('TEXT', 0);
  expect(valor(t, 7)).toBe('ARIAL');
  expect(valor(t, 8)).toBe('CIDADE');
  expect(valor(t, 40)?.trim()).toBe('1.1520');
  expect(valor(t, 72)?.trim()).toBe('1');
  expect(valor(t, 73)?.trim()).toBe('2');
  expect(valor(t, 11)?.trim()).toBe('20.5000');
  expect(valor(t, 21)?.trim()).toBe('30.2500');
  expect(valor(t, 10)?.trim()).toBe('20.5000');
  const c = entidade('CIRCLE', 0);
  expect(valor(c, 8)).toBe('LOCAL_DA_OBRA');
  expect(valor(c, 40)?.trim()).toBe('1.3290');
});

test('toda linha do arquivo termina em CRLF', () => {
  expect(texto.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  expect(texto.endsWith('\r\n')).toBe(true);
});

test('nomeDoArquivo(new Date(2026, 10, 12, 19, 5, 9)) === "mapa-situacao-20261112-190509.dxf"', () => {
  expect(nomeDoArquivo(new Date(2026, 10, 12, 19, 5, 9))).toBe('mapa-situacao-20261112-190509.dxf');
});

test('o AutoCAD abre enquadrado no quadro: $EXTMIN/$EXTMAX no HEADER e VPORT *ACTIVE no centro do quadro', () => {
  const header = pares.slice(0, pares.findIndex((p) => p[0] === 0 && p[1] === 'ENDSEC'));
  const variavel = (nome: string) => {
    const i = header.findIndex((p) => p[0] === 9 && p[1] === nome);
    expect(i, nome).toBeGreaterThanOrEqual(0);
    return header.slice(i + 1, i + 4);
  };
  expect(variavel('$EXTMIN')).toEqual([[10, '0.0000'], [20, '0.0000'], [30, '0.0000']]);
  expect(variavel('$EXTMAX')).toEqual([[10, '124.6000'], [20, '113.0000'], [30, '0.0000']]);

  // a tabela VPORT vem antes das outras, com uma entrada *ACTIVE
  const tabela = pares.findIndex((p, i) => p[0] === 2 && p[1] === 'VPORT' && pares[i - 1][1] === 'TABLE');
  expect(tabela).toBeGreaterThanOrEqual(0);
  expect(tabela).toBeLessThan(pares.findIndex((p) => p[0] === 2 && p[1] === 'LTYPE'));
  const vp = entidade('VPORT');
  expect(valor(vp, 2)).toBe('*ACTIVE');
  expect(Number(valor(vp, 12))).toBeCloseTo(124.6 / 2, 4);
  expect(Number(valor(vp, 22))).toBeCloseTo(113 / 2, 4);
  // altura da vista: o quadro inteiro com uma folga
  expect(Number(valor(vp, 40))).toBeGreaterThan(113);
  expect(Number(valor(vp, 40))).toBeLessThan(113 * 1.2);
  // vista de cima
  expect([valor(vp, 16), valor(vp, 26), valor(vp, 36)].map(Number)).toEqual([0, 0, 1]);
});

test('linha soPrevia não vai para o DXF', () => {
  const previa: Desenho = {
    ...desenho,
    prims: [...desenho.prims, { t: 'linha', camada: 'ROTA', pts: [[7, 7], [8, 9]], largura: 0.22, soPrevia: true }],
  };
  // o arquivo sai igual ao do desenho sem a linha da prévia
  expect(paraDxf(previa)).toEqual(bytes);
  // as três linhas do desenho, sem a quarta
  const comPrevia = Array.from(paraDxf(previa), (b) => String.fromCharCode(b)).join('').split('\r\n');
  expect(comPrevia.filter((x) => x === 'POLYLINE')).toHaveLength(3);
});
