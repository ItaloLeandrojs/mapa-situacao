// @vitest-environment happy-dom
import { lugaresLigadosDePartida, proporArea } from '../src/nucleo/area';
import { caminhoRiscado, entradaMaisPerto, viradas, type Chegada } from '../src/nucleo/chegada';
import {
  caixaDoDetalhe, cantoMaisVazio, comporDetalhe, proporJanelaDetalhe, type EntradaDetalhe, type OpcoesDetalhe,
} from '../src/nucleo/detalhe';
import { escala, escalaNaCaixa, MEDIDAS } from '../src/nucleo/medidas';
import { textoCoordenada } from '../src/nucleo/obra';
import { larguraTexto, textoKm } from '../src/nucleo/rotulos';
import type { Alfinete, Aresta, Base, Canto, Janela, Primitiva, Pt, PtU, Quadro } from '../src/nucleo/tipos';
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

// pares de textos com a tinta de um em cima da do outro
function sobrepostos(ps: Primitiva[]): string[] {
  const ts = textos(ps);
  const achados: string[] = [];
  for (const [i, a] of ts.entries()) {
    for (const b of ts.slice(i + 1)) {
      const [wa, wb] = [larguraTexto(a.txt, a.h) / 2, larguraTexto(b.txt, b.h) / 2];
      if (Math.min(a.centro[0] + wa, b.centro[0] + wb) - Math.max(a.centro[0] - wa, b.centro[0] - wb) > 1e-9 &&
        Math.min(a.centro[1] + a.h / 2, b.centro[1] + b.h / 2) - Math.max(a.centro[1] - a.h / 2, b.centro[1] - b.h / 2) > 1e-9) {
        achados.push(`"${a.txt}" x "${b.txt}"`);
      }
    }
  }
  return achados;
}
// o que fica fora da caixa: linhas (vértices), círculos e textos (tinta)
function foraDaCaixa(ps: Primitiva[], [x0, y0, x1, y1]: number[]): string[] {
  const dentro = (x: number, y: number) => x >= x0 - 1e-9 && x <= x1 + 1e-9 && y >= y0 - 1e-9 && y <= y1 + 1e-9;
  return ps.flatMap((p) => {
    if (p.t === 'linha') return p.pts.every(([x, y]) => dentro(x, y)) ? [] : [`linha ${p.camada}`];
    if (p.t === 'circulo') {
      return dentro(p.centro[0] - p.r, p.centro[1] - p.r) && dentro(p.centro[0] + p.r, p.centro[1] + p.r) ? [] : [`círculo ${p.camada}`];
    }
    const w = larguraTexto(p.txt, p.h) / 2;
    const [x, y] = p.centro;
    return dentro(x - w, y - p.h / 2) && dentro(x + w, y + p.h / 2) ? [] : [`"${p.txt}" em ${x},${y}`];
  });
}

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
  expect(sobrepostos(comCaminho)).toEqual([]);
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
  // o que vai para o DXF é o desenho sem caminho (terra inteira, sem viradas nem comprimento, ENTRADA na mais perto)
  expect(pendente.filter((p) => p.t !== 'linha' || !p.soPrevia)).toEqual(detalhe({}, null));
  expect(ids(pendente)).not.toContain('detalhe:metros');
  expect(textos(pendente).find((t) => t.id === 'detalhe:entrada:coord')?.txt).toBe(textoCoordenada(entradaMaisPerto(c.base, c.obra)));
  // as linhas da prévia são o caminho sugerido, as mesmas do desenho aceito
  expect(linhasRota(pendente).map((p) => p.t === 'linha' && p.pts)).toEqual(linhasRota(comCaminho).map((p) => p.t === 'linha' && p.pts));
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

test('comporDetalhe com caminho de mais de 8 km: janela no limite e tudo dentro da caixa', () => {
  // caminho reto de 9 km a partir da entrada; a janela fica com 8000 m e as pontas saem dela
  const e0 = chegada.entrada;
  const caminho: Pt[] = Array.from({ length: 10 }, (_, k): Pt => [e0[0] + k * 1000, e0[1] - k * 100]);
  const obra = caminho[caminho.length - 1];
  const longo: Chegada = { entrada: e0, caminho, metros: 9050, origem: 'riscado' };
  const janela = proporJanelaDetalhe(obra, longo, e0, Q);
  expect(Math.max(janela.x1 - janela.x0, janela.y1 - janela.y0)).toBeCloseTo(8000, 6);
  const d: EntradaDetalhe = { terra: c.terra, chegada: longo, opcoes: opcoes({ janela }) };
  const ps = comporDetalhe({ base: c.base, obra, alfinetes: [], ligados, quadro: Q, detalhe: d });
  expect(foraDaCaixa(ps, caixaDoDetalhe(Q, 'id'))).toEqual([]);
  // obra e entrada fora da janela: sem marca; o comprimento sai, no meio da parte desenhada do caminho
  expect(ids(ps)).not.toContain('detalhe:obra');
  expect(ids(ps)).not.toContain('detalhe:entrada');
  expect(textos(ps).find((t) => t.id === 'detalhe:metros')?.txt).toBe('9,1Km');
}, 20000);

test('comporDetalhe num quadro 80 × 70: nenhum texto em cima de outro', () => {
  const q: Quadro = { w: 80, h: 70 };
  const d: EntradaDetalhe = { terra: c.terra, chegada, opcoes: opcoes({ janela: proporJanelaDetalhe(c.obra, chegada, chegada.entrada, q) }) };
  const ps = comporDetalhe({ base: c.base, obra: c.obra, alfinetes: c.arquivo.alfinetes, ligados, quadro: q, detalhe: d });
  expect(sobrepostos(ps)).toEqual([]);
}, 20000);

// o segmento ab cruza o segmento cd (no meio dos dois)?
function cruzam([ax, ay]: PtU, [bx, by]: PtU, [cx, cy]: PtU, [dx, dy]: PtU): boolean {
  const lado = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const [d1, d2] = [lado(cx, cy, dx, dy, ax, ay), lado(cx, cy, dx, dy, bx, by)];
  const [d3, d4] = [lado(ax, ay, bx, by, cx, cy), lado(ax, ay, bx, by, dx, dy)];
  return d1 * d2 < 0 && d3 * d4 < 0;
}

test('comporDetalhe: estradinhas param na borda da rodovia (não cruzam o eixo dela)', () => {
  const segs = (camada: string) => comCaminho.flatMap((p): PtU[][] => (p.t === 'linha' && p.camada === camada
    ? p.pts.slice(1).map((b, k) => [p.pts[k], b]) : []));
  const terra = segs('CARROÇAL');
  const eixo = segs('ESTRADA_EIXO');
  expect(terra.length).toBeGreaterThan(0);
  expect(eixo.length).toBeGreaterThan(0);
  expect(terra.filter(([a, b]) => eixo.some(([p, q]) => cruzam(a, b, p, q)))).toEqual([]);
});

test('cantoMaisVazio: lugar ligado conta quando a caixa dele cruza a área reservada, mesmo com o ponto fora', () => {
  const obra: Pt = [L - 1000, 1000];
  const rota: Pt[][] = [[[L / 2, 1000], obra]];
  // ponto 1 unidade da prancha à direita da caixa ie (x de 3 a 53): a caixa da cidade (4,6 de largura) cruza a reserva
  const k = escala(JANELA, Q).k;
  const perto: Pt = [(54 - 3) / k, 20 / k];
  expect(cobre(Q, JANELA, 'ie', perto)).toBe(false);
  expect(cantoMaisVazio(baseCom([['ALFA', perto]]), JANELA, Q, obra, rota, ['ALFA'])).toBe('sd');
  // 6 unidades à direita: a caixa da cidade fica fora da reserva e não conta
  const longe: Pt = [(59 - 3) / k, 20 / k];
  expect(cantoMaisVazio(baseCom([['ALFA', longe]]), JANELA, Q, obra, rota, ['ALFA'])).toBe('ie');
});

// caminho reto de 2 km saindo da rodovia em x = L/2 até a obra, cruzado por estradinhas de 400 m (200 m para cada
// lado) nas distâncias dadas a partir da entrada: cada cruzamento é uma virada
function cruzamentos(distancias: number[], desligadas: string[] = []) {
  const [x0, y] = [L / 2, 10000];
  const obra: Pt = [x0 + 2000, y];
  const ch: Chegada = { entrada: [x0, y], caminho: [[x0, y], obra], metros: 2000, origem: 'riscado' };
  const terra = distancias.map((d, i) => ({ id: i + 1, classe: 'track' as const, pts: [[x0 + d, y - 200], [x0 + d, y + 200]] as Pt[] }));
  const d: EntradaDetalhe = {
    terra, chegada: ch,
    opcoes: { canto: 'id', janela: proporJanelaDetalhe(obra, ch, ch.entrada, Q), viradasDesligadas: desligadas, refsDesligadas: [], sugestaoPendente: false },
  };
  const ps = comporDetalhe({ base: baseCom([]), obra, alfinetes: [], ligados: [], quadro: Q, detalhe: d });
  return { ps, vs: viradas(ch, terra) };
}
const JUNTAS = [300, 450, 600, 750, 900, 1050, 1200, 1350, 1500, 1650, 1800];

test('comporDetalhe: viradas amontoadas viram número ao lado do círculo e as coordenadas vão numa lista', () => {
  const { ps, vs } = cruzamentos(JUNTAS);
  expect(vs).toHaveLength(JUNTAS.length);
  // nenhuma coordenada ao lado do círculo; só o número, na ordem do caminho, altura normal, camada TEXTO
  expect(ids(ps).filter((id) => /^detalhe:virada:\d+$/.test(id))).toEqual([]);
  const nums = textos(ps).filter((t) => t.id.endsWith(':num'));
  expect(nums.map((t) => [t.id, t.txt])).toEqual(vs.map((v, k) => [`detalhe:${v.id}:num`, String(k + 1)]));
  expect(nums.every((t) => t.camada === 'TEXTO' && t.h === MEDIDAS.texto)).toBe(true);
  // a lista: uma linha por virada, "n: coordenada"
  const lista = textos(ps).filter((t) => t.id.startsWith('detalhe:lista:'));
  expect(lista.map((t) => [t.id, t.txt])).toEqual(vs.map((v, k) => [`detalhe:lista:${k}`, `${k + 1}: ${textoCoordenada(v.ponto)}`]));
  // ENTRADA e LOCAL DA OBRA continuam
  expect(ids(ps)).toEqual(expect.arrayContaining(['detalhe:entrada', 'detalhe:entrada:coord', 'detalhe:obra', 'detalhe:obra:coord', 'detalhe:metros']));
  expect(sobrepostos(ps)).toEqual([]);
  // a lista não encosta no caminho, na obra nem nos círculos das marcas
  const caminho = linhasRota(ps).flatMap((p) => (p.t === 'linha' ? [p.pts] : []));
  const circulos = ps.filter((p): p is Extract<Primitiva, { t: 'circulo' }> => p.t === 'circulo');
  for (const t of lista) {
    const w = larguraTexto(t.txt, t.h) / 2;
    const [x, y] = t.centro;
    const encosta = (px: number, py: number, r: number) => px > x - w - r && px < x + w + r && py > y - t.h / 2 - r && py < y + t.h / 2 + r;
    // o caminho é horizontal e cruza o quadrinho: a lista fica toda acima ou toda abaixo dele
    const yCaminho = caminho[0][0][1];
    expect(Math.abs(y - yCaminho)).toBeGreaterThan(t.h / 2 + MEDIDAS.larguraRota);
    expect(circulos.some((c) => encosta(c.centro[0], c.centro[1], c.r))).toBe(false);
  }
}, 20000);

test('comporDetalhe: virada desligada não entra na numeração nem na lista', () => {
  const { ps, vs } = cruzamentos(JUNTAS, ['virada:0']);
  const ligadas = vs.slice(1);
  expect(textos(ps).filter((t) => t.id.endsWith(':num')).map((t) => [t.id, t.txt]))
    .toEqual(ligadas.map((v, k) => [`detalhe:${v.id}:num`, String(k + 1)]));
  expect(textos(ps).filter((t) => t.id.startsWith('detalhe:lista:')).map((t) => t.txt))
    .toEqual(ligadas.map((v, k) => `${k + 1}: ${textoCoordenada(v.ponto)}`));
}, 20000);

test('comporDetalhe: viradas espaçadas continuam com a coordenada ao lado, sem número nem lista', () => {
  const { ps, vs } = cruzamentos([500, 1500]);
  expect(vs).toHaveLength(2);
  expect(textos(ps).filter((t) => /^detalhe:virada:\d+$/.test(t.id)).map((t) => t.txt)).toEqual(vs.map((v) => textoCoordenada(v.ponto)));
  expect(ids(ps).some((id) => id.endsWith(':num') || id.startsWith('detalhe:lista:'))).toBe(false);
}, 20000);

