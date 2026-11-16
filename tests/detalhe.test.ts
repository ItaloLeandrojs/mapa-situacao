// @vitest-environment happy-dom
import { lugaresLigadosDePartida, proporArea } from '../src/nucleo/area';
import { caminhoRiscado, entradaMaisPerto, viradas, type Chegada } from '../src/nucleo/chegada';
import {
  caixaDoDetalhe, cantoMaisVazio, comporDetalhe, proporJanelaDetalhe, type EntradaDetalhe, type OpcoesDetalhe,
} from '../src/nucleo/detalhe';
import { escala, escalaNaCaixa, MEDIDAS } from '../src/nucleo/medidas';
import { textoCoordenada } from '../src/nucleo/obra';
import { larguraTexto, textoKm } from '../src/nucleo/rotulos';
import type { Alfinete, Aresta, Base, Canto, Janela, Primitiva, Pt, Quadro } from '../src/nucleo/tipos';
import { casoAfastado } from './fixtures/chegada';

type Texto = Extract<Primitiva, { t: 'texto' }>;

const Q: Quadro = { w: 124.6, h: 113 };
const CANTOS: Canto[] = ['id', 'ie', 'sd', 'se'];
const c = casoAfastado();
const chegada = caminhoRiscado(c.base, c.obra, c.rota)!;
const janelaGeral = proporArea(c.obra, c.rota, c.base.lugares, Q);
const ligados = lugaresLigadosDePartida(c.base.lugares, janelaGeral);
const janelaDetalhe = proporJanelaDetalhe(c.obra, chegada, chegada.entrada, Q);

const opcoes = (extra: Partial<OpcoesDetalhe> = {}): OpcoesDetalhe => ({
  canto: 'id', janela: janelaDetalhe, viradasDesligadas: [], refsDesligadas: [], sugestaoPendente: false, ...extra,
});
function detalhe(o: Partial<OpcoesDetalhe> = {}, ch: Chegada | null = chegada, alfinetes: Alfinete[] = c.arquivo.alfinetes) {
  const d: EntradaDetalhe = { terra: c.terra, chegada: ch, opcoes: opcoes(o) };
  return comporDetalhe({ base: c.base, obra: c.obra, alfinetes, ligados, quadro: Q, detalhe: d });
}
const textos = (ps: Primitiva[]) => ps.filter((p): p is Texto => p.t === 'texto');
const ids = (ps: Primitiva[]) => textos(ps).map((t) => t.id);
const linhasRota = (ps: Primitiva[]) => ps.filter((p) => p.t === 'linha' && p.camada === 'ROTA');
const dentroDaJanela = (p: Pt, j: Janela) => p[0] >= j.x0 && p[0] <= j.x1 && p[1] >= j.y0 && p[1] <= j.y1;

// o desenho de sempre, que já existe para o detalhe sem caminho e serve a vários testes
const comCaminho = detalhe();

test('escala(j, q) dá os mesmos números de antes (escalaNaCaixa com a área útil)', () => {
  // a conta como estava em medidas.ts antes da Tarefa 3
  const antes = (j: Janela, q: Quadro) => {
    const utilW = q.w - 2 * MEDIDAS.margem;
    const utilH = q.h - MEDIDAS.margem - MEDIDAS.topo;
    const larg = j.x1 - j.x0;
    const alt = j.y1 - j.y0;
    const k = Math.min(utilW / larg, utilH / alt);
    const ox = MEDIDAS.margem + (utilW - larg * k) / 2;
    const oy = MEDIDAS.margem + (utilH - alt * k) / 2;
    return { k, paraU: (p: Pt) => [(p[0] - j.x0) * k + ox, (p[1] - j.y0) * k + oy], paraMetros: (p: Pt) => [(p[0] - ox) / k + j.x0, (p[1] - oy) / k + j.y0] };
  };
  const janelas: Janela[] = [janelaGeral, { x0: 460295.86, y0: 9153272.74, x1: 511041.06, y1: 9207456.95 }, { x0: 0, y0: 0, x1: 1000, y1: 5000 }];
  const quadros: Quadro[] = [Q, { w: 80, h: 70 }, { w: 297.3, h: 210.1 }, { w: 40.7, h: 33.3 }];
  for (const j of janelas) {
    for (const q of quadros) {
      const [a, b] = [antes(j, q), escala(j, q)];
      expect(b.k).toBe(a.k);
      expect(b.mPorU).toBe(1 / a.k);
      for (const p of [[j.x0, j.y0], [j.x1, j.y1], [(j.x0 + j.x1) / 2 + 123.4, j.y0 + 77.7]] as Pt[]) {
        expect(b.paraU(p)).toEqual(a.paraU(p));
        expect(b.paraMetros(p)).toEqual(a.paraMetros(p));
      }
      expect(escalaNaCaixa(j, [3, 3, q.w - 3, q.h - 14]).paraU([j.x1, j.y1])).toEqual(a.paraU([j.x1, j.y1]));
    }
  }
});

test('caixaDoDetalhe 124,6 × 113 no canto id: [124.6 - 3 - 50, 3, 124.6 - 3, 3 + 45]', () => {
  expect(caixaDoDetalhe(Q, 'id')).toEqual([124.6 - 3 - 50, 3, 124.6 - 3, 3 + 45]);
  expect(caixaDoDetalhe(Q, 'ie')).toEqual([3, 3, 3 + 50, 3 + 45]);
  expect(caixaDoDetalhe(Q, 'sd')).toEqual([124.6 - 3 - 50, 113 - 14 - 45, 124.6 - 3, 113 - 14]);
  expect(caixaDoDetalhe(Q, 'se')).toEqual([3, 113 - 14 - 45, 3 + 50, 113 - 14]);
});

test('caixaDoDetalhe num quadro 80 × 70: metade da área útil em cada lado, dentro do quadro', () => {
  const q: Quadro = { w: 80, h: 70 };
  // área útil 74 × 53, de (3, 3) a (77, 56)
  for (const canto of CANTOS) {
    const [x0, y0, x1, y1] = caixaDoDetalhe(q, canto);
    expect(x1 - x0).toBeCloseTo(74 / 2, 9);
    expect(y1 - y0).toBeCloseTo(53 / 2, 9);
    expect(x0).toBeGreaterThanOrEqual(3);
    expect(y0).toBeGreaterThanOrEqual(3);
    expect(x1).toBeLessThanOrEqual(77);
    expect(y1).toBeLessThanOrEqual(56);
    // encostada no canto da área útil
    expect(canto[1] === 'e' ? x0 : x1).toBe(canto[1] === 'e' ? 3 : 77);
    expect(canto[0] === 'i' ? y0 : y1).toBe(canto[0] === 'i' ? 3 : 56);
  }
});

// rodovia reta em x = L/2, de baixo a cima da janela, e lugares nos cantos
const L = (20000 * (Q.w - 6)) / (Q.h - 17);
const JANELA: Janela = { x0: 0, y0: 0, x1: L, y1: 20000 };
const reta: Aresta = { id: 1, a: 1, b: 2, ref: 'CE-1', classe: 'primary', m: 80000, pts: [[L / 2, -30000], [L / 2, 50000]] };
function baseCom(lugares: [string, Pt][]): Base {
  return {
    data: 'teste', nos: new Map([[1, [L / 2, -30000]], [2, [L / 2, 50000]]]), arestas: [reta],
    lugares: lugares.map(([nome, ponto]) => ({ nome, tipo: 'sede', osm: 'town', ponto })),
  };
}
// o canto cobre p? (pela escala do mapa geral, com a área reservada em volta da caixa)
function cobre(q: Quadro, j: Janela, canto: Canto, p: Pt): boolean {
  const esc = escala(j, q);
  const [x, y] = esc.paraU(p);
  const [x0, y0, x1, y1] = caixaDoDetalhe(q, canto);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

test('cantoMaisVazio nunca devolve o canto que tem a obra ou a rota', () => {
  // obra no canto id e rota saindo dela até a rodovia pela parte de baixo: fica o ie, o primeiro dos vazios
  const obra: Pt = [L - 1000, 1000];
  const rota: Pt[][] = [[[L / 2, 1000], obra]];
  expect(cobre(Q, JANELA, 'id', obra)).toBe(true);
  expect(cantoMaisVazio(baseCom([]), JANELA, Q, obra, rota, [])).toBe('ie');
  // com uma cidade ligada no ie, vai para o sd (a cidade pesa); desligada, não pesa
  const comCidade = baseCom([['ALFA', [1000, 1000]]]);
  expect(cantoMaisVazio(comCidade, JANELA, Q, obra, rota, ['ALFA'])).toBe('sd');
  expect(cantoMaisVazio(comCidade, JANELA, Q, obra, rota, [])).toBe('ie');
  // rota passando por baixo e por cima (ie e se tocados por ela, id pela obra): fica o sd
  const volta: Pt[][] = [[obra, [1000, 1000], [1000, 19000], [L / 2, 19000]]];
  expect(cantoMaisVazio(baseCom([]), JANELA, Q, obra, volta, [])).toBe('sd');
  // a rota em todos os cantos: valem todos, fica o de menor nota (cidade no id e no ie)
  const todos: Pt[][] = [[obra, [1000, 1000], [1000, 19000], [L - 1000, 19000]]];
  const duas = baseCom([['ALFA', [L - 2000, 2000]], ['BETA', [2000, 2000]]]);
  expect(cantoMaisVazio(duas, JANELA, Q, obra, todos, ['ALFA', 'BETA'])).toBe('sd');

  // o caso afastado do Cariri, nos dois quadros: o canto escolhido não cobre a obra nem ponto da rota
  for (const q of [Q, { w: 80, h: 70 }]) {
    const j = proporArea(c.obra, c.rota, c.base.lugares, q);
    const canto = cantoMaisVazio(c.base, j, q, c.obra, c.rota, lugaresLigadosDePartida(c.base.lugares, j));
    expect(cobre(q, j, canto, c.obra)).toBe(false);
    for (const p of c.rota.flat()) expect(cobre(q, j, canto, p)).toBe(false);
  }
});

test('proporJanelaDetalhe: contém entrada, caminho e obra; lado maior entre 800 e 8000 m; proporção da área de dentro', () => {
  const [x0, y0, x1, y1] = caixaDoDetalhe(Q, 'id');
  const m = MEDIDAS.margemDetalhe;
  const proporcao = (x1 - x0 - 2 * m) / (y1 - y0 - 2 * m - MEDIDAS.tituloDetalhe);
  const confere = (j: Janela, pts: Pt[]) => {
    for (const p of pts) expect(dentroDaJanela(p, j)).toBe(true);
    const maior = Math.max(j.x1 - j.x0, j.y1 - j.y0);
    expect(maior).toBeGreaterThanOrEqual(800 - 1e-6);
    expect(maior).toBeLessThanOrEqual(8000 + 1e-6);
    expect((j.x1 - j.x0) / (j.y1 - j.y0)).toBeCloseTo(proporcao, 9);
  };
  confere(janelaDetalhe, [chegada.entrada, ...chegada.caminho, c.obra]);
  // folga de 20%: a caixa dos pontos ocupa no máximo 1/1,4 de cada lado
  const xs = chegada.caminho.map((p) => p[0]);
  expect(janelaDetalhe.x1 - janelaDetalhe.x0).toBeGreaterThanOrEqual((Math.max(...xs) - Math.min(...xs)) * 1.4 - 1e-6);
  // sem caminho: obra e a entrada mais perto
  const entrada = entradaMaisPerto(c.base, c.obra);
  confere(proporJanelaDetalhe(c.obra, null, entrada, Q), [c.obra, entrada]);
  // tudo num ponto só, ou perto: lado maior de 800 m
  const j0 = proporJanelaDetalhe(c.obra, null, c.obra, Q);
  confere(j0, [c.obra]);
  expect(Math.max(j0.x1 - j0.x0, j0.y1 - j0.y0)).toBeCloseTo(800, 6);
  const perto = proporJanelaDetalhe([1000, 1000], null, [1010, 1000], Q);
  expect(Math.max(perto.x1 - perto.x0, perto.y1 - perto.y0)).toBeCloseTo(800, 6);
  // muito longe: lado maior de 8000 m, centrado
  const longe = proporJanelaDetalhe([0, 0], null, [20000, 0], Q);
  expect(longe.x1 - longe.x0).toBeCloseTo(8000, 6);
  expect((longe.x0 + longe.x1) / 2).toBeCloseTo(10000, 6);
});

test('comporDetalhe: tem detalhe:titulo, detalhe:obra, detalhe:entrada, detalhe:metros e uma linha ROTA', () => {
  const ts = textos(comCaminho);
  const por = (id: string) => ts.find((t) => t.id === id);
  expect(por('detalhe:titulo')).toMatchObject({ camada: 'TITULO', txt: 'DETALHE DA CHEGADA' });
  expect(por('detalhe:obra')).toMatchObject({ camada: 'LOCAL_DA_OBRA', txt: 'LOCAL DA OBRA' });
  expect(por('detalhe:obra:coord')).toMatchObject({ camada: 'LOCAL_DA_OBRA', txt: textoCoordenada(c.obra) });
  expect(por('detalhe:entrada')).toMatchObject({ camada: 'TEXTO', txt: 'ENTRADA' });
  expect(por('detalhe:entrada:coord')).toMatchObject({ camada: 'TEXTO', txt: textoCoordenada(chegada.entrada) });
  expect(por('detalhe:metros')).toMatchObject({ camada: 'TEXTO', txt: textoKm(chegada.metros / 1000) });
  // título centrado na faixa de cima do quadrinho
  const [x0, , x1, y1] = caixaDoDetalhe(Q, 'id');
  expect(por('detalhe:titulo')!.centro).toEqual([(x0 + x1) / 2, y1 - MEDIDAS.tituloDetalhe / 2]);
  // o retângulo do quadrinho, fechado, na ESTRADA
  const [, y0] = caixaDoDetalhe(Q, 'id');
  expect(comCaminho).toContainEqual({ t: 'linha', camada: 'ESTRADA', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fechada: true });
  // o caminho na ROTA, grosso; estradinhas na CARROÇAL; a rodovia com bordas e tracinhos
  const rota = linhasRota(comCaminho);
  expect(rota.length).toBeGreaterThan(0);
  for (const p of rota) expect(p.t === 'linha' && p.largura).toBe(MEDIDAS.larguraRota);
  expect(comCaminho.some((p) => p.t === 'linha' && p.camada === 'CARROÇAL')).toBe(true);
  expect(comCaminho.some((p) => p.t === 'linha' && p.camada === 'ESTRADA' && !p.fechada)).toBe(true);
  expect(comCaminho.some((p) => p.t === 'linha' && p.camada === 'ESTRADA_EIXO')).toBe(true);
  // obra: os dois círculos; entrada e cada virada: um círculo pequeno na TEXTO
  const circulos = comCaminho.filter((p) => p.t === 'circulo');
  expect(circulos.filter((p) => p.camada === 'LOCAL_DA_OBRA').map((p) => p.t === 'circulo' && p.r).sort()).toEqual([MEDIDAS.raioObraDentro, MEDIDAS.raioObra]);
  const vs = viradas(chegada, c.terra);
  expect(vs.length).toBeGreaterThan(0);
  expect(circulos.filter((p) => p.camada === 'TEXTO' && p.t === 'circulo' && p.r === MEDIDAS.raioMarca)).toHaveLength(1 + vs.length);
  for (const v of vs) expect(ts.find((t) => t.id === `detalhe:${v.id}`)?.txt).toBe(textoCoordenada(v.ponto));
  // nenhum texto em cima de outro
  for (const a of ts) {
    for (const b of ts) {
      if (a === b) continue;
      const [wa, wb] = [larguraTexto(a.txt, a.h) / 2, larguraTexto(b.txt, b.h) / 2];
      const sobrepoe = Math.min(a.centro[0] + wa, b.centro[0] + wb) - Math.max(a.centro[0] - wa, b.centro[0] - wb) > 1e-9 &&
        Math.min(a.centro[1] + a.h / 2, b.centro[1] + b.h / 2) - Math.max(a.centro[1] - a.h / 2, b.centro[1] - b.h / 2) > 1e-9;
      expect(sobrepoe, `"${a.txt}" em cima de "${b.txt}"`).toBe(false);
    }
  }
});

test('comporDetalhe: todas as primitivas ficam dentro da caixa', () => {
  for (const canto of CANTOS) {
    const ps = canto === 'id' ? comCaminho : detalhe({ canto });
    const [x0, y0, x1, y1] = caixaDoDetalhe(Q, canto);
    const dentro = (x: number, y: number) => x >= x0 - 1e-9 && x <= x1 + 1e-9 && y >= y0 - 1e-9 && y <= y1 + 1e-9;
    for (const p of ps) {
      if (p.t === 'linha') for (const [x, y] of p.pts) expect(dentro(x, y), `${canto} ${p.camada} ${x},${y}`).toBe(true);
      if (p.t === 'circulo') {
        expect(dentro(p.centro[0] - p.r, p.centro[1] - p.r), `${canto} círculo`).toBe(true);
        expect(dentro(p.centro[0] + p.r, p.centro[1] + p.r), `${canto} círculo`).toBe(true);
      }
      if (p.t === 'texto') {
        const w = larguraTexto(p.txt, p.h) / 2;
        const [x, y] = p.centro;
        expect(dentro(x - w, y - p.h / 2) && dentro(x + w, y + p.h / 2), `${canto} "${p.txt}" em ${x},${y}`).toBe(true);
      }
    }
  }
}, 20000);

test('comporDetalhe com sugestaoPendente: linhas ROTA com soPrevia; sem pendência, sem soPrevia', () => {
  const pendente = detalhe({ sugestaoPendente: true });
  expect(linhasRota(pendente).length).toBeGreaterThan(0);
  for (const p of linhasRota(pendente)) expect(p.t === 'linha' && p.soPrevia).toBe(true);
  // só o caminho fica na prévia: o resto é o mesmo desenho
  expect(pendente.filter((p) => p.t !== 'linha' || !p.soPrevia)).toEqual(comCaminho.filter((p) => !(p.t === 'linha' && p.camada === 'ROTA')));
  expect(comCaminho.some((p) => p.t === 'linha' && p.soPrevia)).toBe(false);
});

test('comporDetalhe: virada desligada some com o círculo; alfinete doGoogle não vira referência', () => {
  const v0 = viradas(chegada, c.terra)[0];
  const sem = detalhe({ viradasDesligadas: [v0.id] });
  expect(ids(sem)).not.toContain(`detalhe:${v0.id}`);
  const marcas = (ps: Primitiva[]) => ps.filter((p) => p.t === 'circulo' && p.r === MEDIDAS.raioMarca);
  expect(marcas(sem)).toHaveLength(marcas(comCaminho).length - 1);
  // o círculo que sumiu é o da virada
  const centros = (ps: Primitiva[]) => marcas(ps).map((p) => p.t === 'circulo' && p.centro.join(','));
  const sumiu = centros(comCaminho).filter((x) => !centros(sem).includes(x));
  expect(sumiu).toHaveLength(1);

  // referências: alfinete com nome dentro da janela; doGoogle, sem nome, a obra, fora da janela ou desligado não
  const meio: Pt = [(c.obra[0] + chegada.entrada[0]) / 2 + 30, (c.obra[1] + chegada.entrada[1]) / 2 + 30];
  const fora: Pt = [janelaDetalhe.x1 + 500, janelaDetalhe.y1 + 500];
  const alfinetes: Alfinete[] = [
    ...c.arquivo.alfinetes,
    { nome: 'ESCOLA', ponto: meio },
    { nome: 'PARTIDA', ponto: [meio[0] + 200, meio[1] - 200], doGoogle: true },
    { nome: '', ponto: [meio[0] - 200, meio[1] + 200] },
    { nome: 'IGREJA', ponto: fora },
  ];
  const comRefs = detalhe({}, chegada, alfinetes);
  expect(ids(comRefs).filter((id) => id.startsWith('detalhe:ref:'))).toEqual(['detalhe:ref:ESCOLA']);
  expect(textos(comRefs).find((t) => t.id === 'detalhe:ref:ESCOLA')?.txt).toBe('ESCOLA');
  expect(marcas(comRefs)).toHaveLength(marcas(comCaminho).length + 1);
  // a obra (alfinete OBRA) não vira referência
  expect(ids(comCaminho).some((id) => id.startsWith('detalhe:ref:'))).toBe(false);
  // desligada pelo nome
  const desligada = detalhe({ refsDesligadas: ['ESCOLA'] }, chegada, alfinetes);
  expect(ids(desligada).some((id) => id.startsWith('detalhe:ref:'))).toBe(false);
}, 20000);

test('comporDetalhe com chegada null: sem ROTA, sem detalhe:metros, com detalhe:entrada', () => {
  const entrada = entradaMaisPerto(c.base, c.obra);
  const ps = detalhe({ janela: proporJanelaDetalhe(c.obra, null, entrada, Q) }, null);
  expect(linhasRota(ps)).toEqual([]);
  expect(ids(ps)).not.toContain('detalhe:metros');
  expect(ids(ps).some((id) => id.startsWith('detalhe:virada:'))).toBe(false);
  expect(textos(ps).find((t) => t.id === 'detalhe:entrada:coord')?.txt).toBe(textoCoordenada(entrada));
  expect(ids(ps)).toEqual(expect.arrayContaining(['detalhe:titulo', 'detalhe:obra', 'detalhe:obra:coord', 'detalhe:entrada']));
  expect(ps.some((p) => p.t === 'linha' && p.camada === 'CARROÇAL')).toBe(true);
  expect(ps.some((p) => p.t === 'linha' && p.camada === 'ESTRADA_EIXO')).toBe(true);
});
