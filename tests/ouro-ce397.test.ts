// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lugaresLigadosDePartida } from '../src/nucleo/area';
import { compor, type Entrada } from '../src/nucleo/compor';
import { lerArquivoGoogle } from '../src/nucleo/kml';
import { MEDIDAS } from '../src/nucleo/medidas';
import { escolherObra } from '../src/nucleo/obra';
import { larguraTexto, textoRef } from '../src/nucleo/rotulos';
import type { Desenho, Primitiva, PtU } from '../src/nucleo/tipos';
import { baseCariri, CADEIAS_V4, CENTROS_CIDADES_V4, CIDADES_V4, JANELA_V4 } from './fixtures/v4';

type Texto = Extract<Primitiva, { t: 'texto' }>;

const Q = { w: 124.6, h: 113 };
const base = baseCariri(10);
const arquivo = lerArquivoGoogle(new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'ce397.kml'))));
const entrada: Entrada = {
  base,
  arquivo,
  obra: escolherObra(arquivo)!.ponto,
  janela: JANELA_V4,
  quadro: Q,
  ligados: lugaresLigadosDePartida(base.lugares, JANELA_V4),
  ajustes: {},
  credito: false,
};

// o traçado leva cerca de 1 s: cada entrada é composta uma vez só
let d: Desenho;
let ajustado: Desenho;
let idAjustado: string;
const PEDIDO: PtU = [60, 60];

const textos = (x: Desenho) => x.prims.filter((p): p is Texto => p.t === 'texto');
const kmDoTexto = (s: string) => (s.endsWith('Km') ? Number(s.slice(0, -2).replace(',', '.')) : Number(s.slice(0, -1)) / 1000);
// rótulos de estrada: as linhas de cada bloco, agrupadas pelo id da primeira linha
function rotulosDeEstrada(x: Desenho): Map<string, Texto[]> {
  const blocos = new Map<string, Texto[]>();
  for (const t of textos(x).filter((t) => t.id.startsWith('trecho:'))) {
    const chave = t.id.endsWith(':km') ? t.id.slice(0, -3) : t.id;
    blocos.set(chave, [...(blocos.get(chave) ?? []), t]);
  }
  return blocos;
}

beforeAll(() => {
  d = compor(entrada);
  idAjustado = [...rotulosDeEstrada(d).entries()].find(([, ls]) => ls.length === 2)![0];
  ajustado = compor({ ...entrada, ajustes: { [idAjustado]: PEDIDO }, credito: true });
}, 20000);

test('cidades iguais às da v4', () => {
  const cidades = textos(d).filter((t) => t.camada === 'TEXTO' && !/\d/.test(t.txt));
  expect(cidades.map((t) => t.txt).sort()).toEqual([...CIDADES_V4].sort());
  for (const t of cidades) expect(t.id).toBe(`cidade:${t.txt}`);
  // a caixa de cada cidade, na camada CIDADE
  expect(d.prims.filter((p) => p.t === 'linha' && p.camada === 'CIDADE')).toHaveLength(9);
});

test('obra', () => {
  const daObra = d.prims.filter((p) => p.camada === 'LOCAL_DA_OBRA');
  const ts = daObra.filter((p): p is Texto => p.t === 'texto');
  expect(ts.map((t) => [t.id, t.txt])).toEqual([['obra:nome', 'LOCAL DA OBRA'], ['obra:coord', '0492400,9166630']]);
  const raios = daObra.flatMap((p) => (p.t === 'circulo' ? [p.r] : [])).sort();
  expect(raios).toEqual([1.037, 1.329]);
  // as duas linhas formam um bloco: mesma coluna, uma entrelinha de distância
  expect(ts[0].centro[0]).toBeCloseTo(ts[1].centro[0], 9);
  expect(ts[0].centro[1] - ts[1].centro[1]).toBeCloseTo(MEDIDAS.texto * MEDIDAS.entrelinha, 9);
});

test('rótulos de estrada iguais aos da v4', () => {
  const sobra = [...rotulosDeEstrada(d).values()];
  expect(sobra).toHaveLength(CADEIAS_V4.length);
  for (const [ref, km] of CADEIAS_V4) {
    const i = sobra.findIndex((ls) => {
      const kmLinha = ls[ls.length - 1].txt;
      const certo = ref === '' ? ls.length === 1 : ls.length === 2 && ls[0].txt.split('/')[0] === textoRef(ref);
      return certo && Math.abs(kmDoTexto(kmLinha) - km) < 0.15;
    });
    expect(i, `${ref} ${km} km`).toBeGreaterThanOrEqual(0);
    sobra.splice(i, 1);
  }
});

test('tem SEM ESCALA e não tem título SITUAÇÃO', () => {
  const titulo = textos(d).filter((t) => t.camada === 'TITULO');
  expect(titulo.map((t) => [t.id, t.txt])).toEqual([['titulo', 'SEM ESCALA']]);
  expect(textos(d).some((t) => t.txt.includes('SITUAÇÃO'))).toBe(false);
});

test('toda primitiva cabe no quadro; todo texto tem altura 1.152', () => {
  const dentro = (x: number, y: number) => x >= -1e-9 && x <= Q.w + 1e-9 && y >= -1e-9 && y <= Q.h + 1e-9;
  for (const p of d.prims) {
    if (p.t === 'linha') for (const [x, y] of p.pts) expect(dentro(x, y), `${p.camada} ${x},${y}`).toBe(true);
    if (p.t === 'circulo') {
      expect(dentro(p.centro[0] - p.r, p.centro[1] - p.r)).toBe(true);
      expect(dentro(p.centro[0] + p.r, p.centro[1] + p.r)).toBe(true);
    }
    if (p.t === 'texto') {
      expect(p.h).toBe(1.152);
      const [x, y] = p.centro;
      const w = larguraTexto(p.txt, p.h) / 2;
      expect(dentro(x - w, y - p.h / 2) && dentro(x + w, y + p.h / 2), `${p.txt} em ${x},${y}`).toBe(true);
    }
  }
  // o retângulo do quadro
  expect(d.prims).toContainEqual({ t: 'linha', camada: 'ESTRADA', pts: [[0, 0], [Q.w, 0], [Q.w, Q.h], [0, Q.h]], fechada: true });
  // a rota na camada ROTA, grossa
  const rota = d.prims.filter((p) => p.t === 'linha' && p.camada === 'ROTA');
  expect(rota.length).toBeGreaterThan(0);
  for (const p of rota) expect(p.t === 'linha' && p.largura).toBe(0.22);
  expect(d.prims.filter((p) => p.camada === 'ESTRADA_EIXO').length).toBeGreaterThan(300);
});

test('centros dos textos de cidade ficam a menos de 3 unidades dos da v4', () => {
  for (const [nome, [x, y]] of Object.entries(CENTROS_CIDADES_V4)) {
    const t = textos(d).find((p) => p.id === `cidade:${nome}`)!;
    expect(Math.hypot(t.centro[0] - x, t.centro[1] - y), nome).toBeLessThan(3);
  }
});

test('ajuste leva o bloco do rótulo para o centro pedido', () => {
  const antes = rotulosDeEstrada(d).get(idAjustado)!;
  const depois = rotulosDeEstrada(ajustado).get(idAjustado)!;
  expect(depois[0].centro).toEqual(PEDIDO);
  // a segunda linha vai junto, na mesma posição relativa
  const dx = PEDIDO[0] - antes[0].centro[0];
  const dy = PEDIDO[1] - antes[0].centro[1];
  expect(depois[1].centro[0]).toBeCloseTo(antes[1].centro[0] + dx, 9);
  expect(depois[1].centro[1]).toBeCloseTo(antes[1].centro[1] + dy, 9);
  // os outros textos não se mexem
  const outros = (x: Desenho) => textos(x).filter((t) => !t.id.startsWith(idAjustado) && t.id !== 'credito');
  expect(outros(ajustado)).toEqual(outros(d));
});

test('credito: true acrescenta "Base: OpenStreetMap" com altura 0.8', () => {
  expect(textos(d).some((t) => t.id === 'credito')).toBe(false);
  const c = textos(ajustado).filter((t) => t.id === 'credito');
  expect(c.map((t) => [t.camada, t.txt, t.h])).toEqual([['TEXTO', 'Base: OpenStreetMap', 0.8]]);
  // no canto de baixo, dentro do quadro útil
  expect(c[0].centro[1]).toBeLessThan(Q.h / 2);
  expect(c[0].centro[1] - 0.4).toBeGreaterThanOrEqual(MEDIDAS.margem);
});
