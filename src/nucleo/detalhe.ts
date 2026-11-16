// "DETALHE DA CHEGADA": quadrinho num canto do quadro com a rodovia, as estradinhas de terra, o caminho até a
// obra, a entrada, as viradas e as referências, numa escala própria
import { entradaMaisPerto, viradas, type Chegada } from './chegada.ts';
import { chaikin, G } from './geom.ts';
import { areaUtil, escala, escalaNaCaixa, MEDIDAS } from './medidas.ts';
import { textoCoordenada } from './obra.ts';
import { bloco, colocaEmVolta, localDaObra, Ocupacao, textoKm, textosDasSaidas, type Texto } from './rotulos.ts';
import { saidas } from './saidas.ts';
import { tracar } from './tracado.ts';
import type { Alfinete, Base, Canto, Estradinha, Janela, Primitiva, Pt, PtU, Quadro } from './tipos.ts';

export interface OpcoesDetalhe {
  canto: Canto; janela: Janela; // área do detalhe em UTM
  viradasDesligadas: string[]; refsDesligadas: string[]; // ids de Virada e nomes de alfinete
  sugestaoPendente: boolean; // caminho sugerido ainda não aceito: sai só na prévia (soPrevia)
}
export interface EntradaDetalhe { terra: Estradinha[]; chegada: Chegada | null; opcoes: OpcoesDetalhe }

type Caixa = [number, number, number, number]; // [x0, y0, x1, y1]

const CANTOS: Canto[] = ['id', 'ie', 'sd', 'se']; // ordem de desempate
const NOTA_LUGAR = 3000; // cada lugar ligado embaixo da caixa conta como 3 km de estrada
const FOLGA_JANELA = 0.2; // de cada lado da caixa da entrada, do caminho e da obra
const LADO_MIN = 800; // m: lado maior da janela proposta
const LADO_MAX = 8000;
const SIMPLIFICA_TERRA = 0.1; // unidade da prancha, na escala do detalhe
const TITULO = 'DETALHE DA CHEGADA';

const dentroDe = (p: Pt, c: Caixa) => p[0] >= c[0] && p[0] <= c[2] && p[1] >= c[1] && p[1] <= c[3];
const cresce = (c: Caixa, d: number): Caixa => [c[0] - d, c[1] - d, c[2] + d, c[3] + d];
const daJanela = (j: Janela): Caixa => [j.x0, j.y0, j.x1, j.y1];
// o envelope dos pontos cruza a caixa?
function cruza(pts: Pt[], c: Caixa): boolean {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  return x0 <= c[2] && c[0] <= x1 && y0 <= c[3] && c[1] <= y1;
}

// pedaço [t0, t1] do segmento ab dentro da caixa (recorte de Liang-Barsky); null se não entra
function recorte([ax, ay]: Pt, [bx, by]: Pt, [x0, y0, x1, y1]: Caixa): [number, number] | null {
  let [t0, t1] = [0, 1];
  const [dx, dy] = [bx - ax, by - ay];
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  return t0 <= t1 ? [t0, t1] : null;
}
const metrosDentro = (pts: Pt[], c: Caixa) => pts.reduce((s, p, k) => {
  if (k === 0) return s;
  const t = recorte(pts[k - 1], p, c);
  return t ? s + (t[1] - t[0]) * Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : s;
}, 0);
const linhaToca = (pts: Pt[], c: Caixa) =>
  pts.length === 1 ? dentroDe(pts[0], c) : pts.some((p, k) => k > 0 && recorte(pts[k - 1], p, c) !== null);

// caixa do detalhe na prancha: até detalheW × detalheH, no máximo metade da área útil em cada lado, encostada no canto
export function caixaDoDetalhe(q: Quadro, canto: Canto): Caixa {
  const [x0, y0, x1, y1] = areaUtil(q);
  const w = Math.min(MEDIDAS.detalheW, (x1 - x0) / 2);
  const h = Math.min(MEDIDAS.detalheH, (y1 - y0) / 2);
  const esquerda = canto === 'ie' || canto === 'se';
  const embaixo = canto === 'id' || canto === 'ie';
  return [esquerda ? x0 : x1 - w, embaixo ? y0 : y1 - h, esquerda ? x0 + w : x1, embaixo ? y0 + h : y1];
}

// área que o detalhe tira do mapa geral: a caixa com margemDetalhe em volta
export const reservaDoDetalhe = (c: Caixa): Caixa => cresce(c, MEDIDAS.margemDetalhe);

// onde o mapa do detalhe é desenhado: a caixa menos a margem em volta e a faixa do título em cima
function areaDeDentro(c: Caixa): Caixa {
  const m = MEDIDAS.margemDetalhe;
  return [c[0] + m, c[1] + m, c[2] - m, c[3] - m - MEDIDAS.tituloDetalhe];
}

// o canto em que a caixa cobre menos do mapa geral: nota = metros de estrada da base embaixo dela + NOTA_LUGAR por
// lugar ligado embaixo dela. Fica de fora o canto cuja área reservada pega a obra (com o círculo) ou a rota (com
// a pista); se todos pegam, valem todos. Empate: na ordem id, ie, sd, se
export function cantoMaisVazio(base: Base, janela: Janela, q: Quadro, obra: Pt, rota: Pt[][], ligados: string[]): Canto {
  const esc = escala(janela, q);
  const ja = new Set(ligados);
  const lugares = base.lugares.filter((l) => ja.has(l.nome));
  const notas = CANTOS.map((canto) => {
    const caixa = caixaDoDetalhe(q, canto);
    const [x0, y0] = esc.paraMetros([caixa[0], caixa[1]]);
    const [x1, y1] = esc.paraMetros([caixa[2], caixa[3]]);
    const embaixo: Caixa = [Math.max(x0, janela.x0), Math.max(y0, janela.y0), Math.min(x1, janela.x1), Math.min(y1, janela.y1)];
    const reserva = cresce([x0, y0, x1, y1], MEDIDAS.margemDetalhe * esc.mPorU);
    const cobre = dentroDe(obra, cresce(reserva, MEDIDAS.raioObra * esc.mPorU)) ||
      rota.some((l) => linhaToca(l, cresce(reserva, MEDIDAS.meiaEstrada * esc.mPorU)));
    const vazia = embaixo[0] > embaixo[2] || embaixo[1] > embaixo[3];
    const nota = vazia ? 0 : base.arestas.reduce((s, a) => (cruza(a.pts, embaixo) ? s + metrosDentro(a.pts, embaixo) : s), 0) +
      NOTA_LUGAR * lugares.filter((l) => dentroDe(l.ponto, embaixo)).length;
    return { canto, nota, cobre };
  });
  const livres = notas.filter((n) => !n.cobre);
  return (livres.length > 0 ? livres : notas).reduce((a, b) => (b.nota < a.nota ? b : a)).canto;
}

// janela do detalhe: caixa da entrada, do caminho e da obra com FOLGA_JANELA de cada lado, na proporção da área de
// dentro do quadrinho, lado maior entre LADO_MIN e LADO_MAX (mesmo centro)
export function proporJanelaDetalhe(obra: Pt, chegada: Chegada | null, entrada: Pt, q: Quadro): Janela {
  const pts = [obra, entrada, ...(chegada?.caminho ?? [])];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const [dx0, dy0, dx1, dy1] = areaDeDentro(caixaDoDetalhe(q, 'id')); // o tamanho é o mesmo nos quatro cantos
  const proporcao = (dx1 - dx0) / (dy1 - dy0);
  let w = (x1 - x0) * (1 + 2 * FOLGA_JANELA);
  let h = (y1 - y0) * (1 + 2 * FOLGA_JANELA);
  if (w < h * proporcao) w = h * proporcao;
  else h = w / proporcao;
  if (Math.max(w, h) === 0) [w, h] = [proporcao, 1]; // tudo num ponto: só a proporção
  const f = Math.min(LADO_MAX, Math.max(LADO_MIN, Math.max(w, h))) / Math.max(w, h);
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  return { x0: cx - (w * f) / 2, y0: cy - (h * f) / 2, x1: cx + (w * f) / 2, y1: cy + (h * f) / 2 };
}

// comporDetalhe calcula as viradas com viradas(chegada, terra); a tela usa a mesma função para a lista
export function comporDetalhe(e: {
  base: Base; obra: Pt; alfinetes: Alfinete[]; ligados: string[]; quadro: Quadro; detalhe: EntradaDetalhe;
}): Primitiva[] {
  const { terra, chegada, opcoes } = e.detalhe;
  const j = opcoes.janela;
  const caixa = caixaDoDetalhe(e.quadro, opcoes.canto);
  const dentro = areaDeDentro(caixa);
  const esc = escalaNaCaixa(j, dentro);
  // onde a janela cai na área de dentro: com a janela na proporção dela, é a própria área de dentro
  const [jx0, jy0] = esc.paraU([j.x0, j.y0]);
  const [jx1, jy1] = esc.paraU([j.x1, j.y1]);
  const area: Caixa = [Math.max(dentro[0], jx0), Math.max(dentro[1], jy0), Math.min(dentro[2], jx1), Math.min(dentro[3], jy1)];
  const quadro = G.caixa(...area);
  const naJanela = daJanela(j);
  const paraU = (l: Pt[]) => l.map(esc.paraU);
  const recortar = (l: PtU[]) => G.linhas(G.intersecao(G.linha(l), quadro));
  const prims: Primitiva[] = [];

  prims.push({ t: 'linha', camada: 'ESTRADA', pts: [[caixa[0], caixa[1]], [caixa[2], caixa[1]], [caixa[2], caixa[3]], [caixa[0], caixa[3]]], fechada: true });
  prims.push({
    t: 'texto', camada: 'TITULO', id: 'detalhe:titulo', txt: TITULO, h: MEDIDAS.texto,
    centro: [(caixa[0] + caixa[2]) / 2, caixa[3] - MEDIDAS.tituloDetalhe / 2],
  });

  // rodovias da base, com o mesmo traçado do mapa geral
  const rodovias = e.base.arestas.filter((a) => cruza(a.pts, naJanela)).map((a) => paraU(a.pts));
  const tr = tracar(rodovias, [], [], G.uniao([]), quadro);
  for (const pts of tr.contornoEstrada) prims.push({ t: 'linha', camada: 'ESTRADA', pts });
  for (const pts of tr.tracinhos) prims.push({ t: 'linha', camada: 'ESTRADA_EIXO', pts });

  // estradinhas: linha simples, simplificada e arredondada, sem o pedaço junto do caminho
  const caminho = chegada ? recortar(paraU(chegada.caminho)) : [];
  const zona = G.engrossa(G.uniao(caminho.map(G.linha)), MEDIDAS.zonaRota);
  const estradinhas = terra.filter((t) => cruza(t.pts, naJanela)).flatMap((t) => recortar(paraU(t.pts)))
    .map((l) => chaikin(G.linhas(G.simplifica(G.linha(l), SIMPLIFICA_TERRA))[0] ?? l))
    .flatMap((l) => G.linhas(G.diferenca(G.linha(l), zona)));
  for (const pts of estradinhas) prims.push({ t: 'linha', camada: 'CARROÇAL', pts });
  for (const pts of caminho) {
    prims.push({ t: 'linha', camada: 'ROTA', pts, largura: MEDIDAS.larguraRota, ...(opcoes.sugestaoPendente ? { soPrevia: true } : {}) });
  }

  // marcas: obra, entrada, viradas ligadas e referências (alfinete com nome, que não é a obra nem do Google)
  const obra = esc.paraU(e.obra);
  const entrada = chegada?.entrada ?? entradaMaisPerto(e.base, e.obra);
  const vs = chegada ? viradas(chegada, terra).filter((v) => !opcoes.viradasDesligadas.includes(v.id)) : [];
  const refs = e.alfinetes.filter((a) => a.nome !== '' && !a.doGoogle && !(a.ponto[0] === e.obra[0] && a.ponto[1] === e.obra[1]) &&
    dentroDe(a.ponto, naJanela) && !opcoes.refsDesligadas.includes(a.nome));
  const marcas: { ponto: Pt; ids: string[]; linhas: string[] }[] = [
    { ponto: entrada, ids: ['detalhe:entrada', 'detalhe:entrada:coord'], linhas: ['ENTRADA', textoCoordenada(entrada)] },
    ...vs.map((v) => ({ ponto: v.ponto, ids: [`detalhe:${v.id}`], linhas: [textoCoordenada(v.ponto)] })),
    ...refs.map((r) => ({ ponto: r.ponto, ids: [`detalhe:ref:${r.nome}`], linhas: [r.nome] })),
  ];
  const oc = new Ocupacao(quadro, [
    tr.pista,
    G.engrossa(G.uniao(estradinhas.map(G.linha)), MEDIDAS.larguraRota),
    G.engrossa(G.uniao(caminho.map(G.linha)), MEDIDAS.larguraRota),
    G.engrossa(G.ponto(obra), MEDIDAS.raioObra),
    ...marcas.map((m) => G.engrossa(G.ponto(esc.paraU(m.ponto)), MEDIDAS.raioMarca)),
  ]);

  const blocos: Texto[][] = [];
  const daObra = localDaObra(oc, obra, e.obra, ['detalhe:obra', 'detalhe:obra:coord']);
  prims.push(...daObra.circulos);
  blocos.push(daObra.textos);
  for (const m of marcas) {
    const centro = esc.paraU(m.ponto);
    prims.push({ t: 'circulo', camada: 'TEXTO', centro, r: MEDIDAS.raioMarca });
    blocos.push(bloco('TEXTO', m.ids, m.linhas, colocaEmVolta(oc, m.linhas, centro, MEDIDAS.raioMarca)));
  }
  // comprimento perto do meio do caminho
  if (chegada && caminho.length > 0) {
    const txt = textoKm(chegada.metros / 1000);
    const meio = G.noMeio(paraU(chegada.caminho), 0.5);
    blocos.push(bloco('TEXTO', ['detalhe:metros'], [txt], colocaEmVolta(oc, [txt], meio, MEDIDAS.larguraRota)));
  }
  // P/ nas pontas da rodovia, como no mapa geral
  const eixoUtm = G.linhas(tr.eixo).map((l) => l.map(esc.paraMetros));
  blocos.push(...textosDasSaidas(oc, saidas(e.base, eixoUtm, j, e.ligados), esc.paraU, area, 'detalhe:saida'));

  prims.push(...blocos.flat());
  return prims;
}
