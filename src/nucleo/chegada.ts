import { chegadaNaBase, distanciaALinha, Fila, projetar, separarRota } from './grafo.ts';
import type { Base, Estradinha, Pt } from './tipos.ts';

export interface Chegada { entrada: Pt; caminho: Pt[]; metros: number; origem: 'riscado' | 'sugerido' } // caminho vai da entrada até a obra
export interface Virada { id: string; ponto: Pt; motivo: 'encontro' | 'curva' } // id "virada:0", "virada:1"... na ordem do caminho

export const NA_BEIRA = 200; // m: obra a até isso de uma rodovia da base não tem detalhe
export const BUSCA_TERRA = 500; // m: até onde se procura estradinha perto da obra

const ALVO_NA_BASE = 50; // m: ponto de estradinha a até isso de uma aresta da base serve de entrada
const LONGE_DE_PONTA = 80; // m: viragem só a mais que isso da entrada e da obra, e de outra viragem
const FAIXA = 15; // m: estradinha a até isso do caminho encosta nele
const SAI_DA_FAIXA = 60; // m: o que a estradinha precisa andar fora da faixa para ser um encontro
const PASSO = 5; // m: espaçamento das amostras ao longo das linhas
const VISTA = 40; // m: distância antes e depois do ponto para medir o rumo
const CURVA_MIN = 60; // graus: mudança de rumo que conta como curva

const dist = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);
const ateBase = (base: Base, p: Pt) => base.arestas.reduce((m, a) => Math.min(m, distanciaALinha(p, a.pts)), Infinity);
const comprimento = (pts: Pt[]) => pts.reduce((s, p, k) => (k ? s + dist(pts[k - 1], p) : 0), 0);
const arredondar = (m: number) => Math.round(m / 10) * 10;

function montar(entrada: Pt, caminho: Pt[], origem: Chegada['origem']): Chegada {
  return { entrada, caminho, metros: arredondar(comprimento(caminho)), origem };
}

export function obraNaBeira(base: Base, obra: Pt): boolean {
  return ateBase(base, obra) <= NA_BEIRA;
}

// ponto da aresta da base mais perto da obra
export function entradaMaisPerto(base: Base, obra: Pt): Pt {
  let melhor: Pt = obra;
  let menor = Infinity;
  for (const a of base.arestas) {
    for (let k = 1; k < a.pts.length; k++) {
      const q = projetar(obra, a.pts[k - 1], a.pts[k]).q;
      const d = dist(obra, q);
      if (d < menor) [melhor, menor] = [q, d];
    }
  }
  return melhor;
}

// o pedaço da rota fora da base que termina perto da obra (a até NA_BEIRA); com vários, o de ponta mais perto
export function caminhoRiscado(base: Base, obra: Pt, rota: Pt[][]): Chegada | null {
  let melhor: Pt[] | null = null;
  let menor = Infinity;
  for (const pedaco of separarRota(base, rota).fora) {
    const [d0, d1] = [dist(pedaco[0], obra), dist(pedaco[pedaco.length - 1], obra)];
    const perto = Math.min(d0, d1);
    if (perto > NA_BEIRA || perto >= menor) continue;
    menor = perto;
    melhor = d1 <= d0 ? pedaco : [...pedaco].reverse(); // a ponta perto da obra vai por último
  }
  if (!melhor) return null;
  const caminho = dist(melhor[melhor.length - 1], obra) > 0 ? [...melhor, obra] : melhor;
  return montar(caminho[0], caminho, 'riscado');
}

// caminho pelas estradinhas do encontro mais perto da obra até a entrada de menor custo
export function sugerirCaminho(base: Base, terra: Estradinha[], obra: Pt, rota: Pt[][]): Chegada | null {
  // ponto da estradinha mais perto da obra (pode cair no meio de um segmento)
  let entrou: { q: Pt; a: Pt; b: Pt } | null = null;
  let menor = Infinity;
  for (const e of terra) {
    for (let k = 1; k < e.pts.length; k++) {
      const q = projetar(obra, e.pts[k - 1], e.pts[k]).q;
      const d = dist(obra, q);
      if (d < menor) [entrou, menor] = [{ q, a: e.pts[k - 1], b: e.pts[k] }, d];
    }
  }
  if (!entrou || menor > BUSCA_TERRA) return null;

  // nós: pontos das estradinhas (os de mesma coordenada em duas estradinhas viram um só) e o ponto de entrada da obra
  const indice = new Map<string, number>();
  const pos: Pt[] = [];
  const viz: { para: number; m: number }[][] = [];
  const no = (p: Pt): number => {
    const k = `${p[0]},${p[1]}`;
    if (!indice.has(k)) {
      indice.set(k, pos.length);
      pos.push(p);
      viz.push([]);
    }
    return indice.get(k)!;
  };
  const liga = (p: Pt, q: Pt) => {
    const [i, j] = [no(p), no(q)];
    if (i === j) return;
    const m = dist(p, q);
    viz[i].push({ para: j, m });
    viz[j].push({ para: i, m });
  };
  for (const e of terra) for (let k = 1; k < e.pts.length; k++) liga(e.pts[k - 1], e.pts[k]);
  liga(entrou.a, entrou.q);
  liga(entrou.q, entrou.b);

  const origem = no(entrou.q);
  const custo = new Map<number, number>([[origem, 0]]);
  const veio = new Map<number, number>();
  const fila = new Fila();
  fila.por([0, origem]);
  while (!fila.vazia) {
    const [c, i] = fila.tirar();
    if (c > custo.get(i)!) continue;
    for (const { para, m } of viz[i]) {
      if (c + m < (custo.get(para) ?? Infinity)) {
        custo.set(para, c + m);
        veio.set(para, i);
        fila.por([c + m, para]);
      }
    }
  }

  const chegada = chegadaNaBase(base, obra, rota);
  const caixas = base.arestas.map((a) => ({
    a, x0: Math.min(...a.pts.map((p) => p[0])) - ALVO_NA_BASE, x1: Math.max(...a.pts.map((p) => p[0])) + ALVO_NA_BASE,
    y0: Math.min(...a.pts.map((p) => p[1])) - ALVO_NA_BASE, y1: Math.max(...a.pts.map((p) => p[1])) + ALVO_NA_BASE,
  }));
  const naBase = (p: Pt) => caixas.some((c) => p[0] >= c.x0 && p[0] <= c.x1 && p[1] >= c.y0 && p[1] <= c.y1
    && distanciaALinha(p, c.a.pts) <= ALVO_NA_BASE);
  let alvo: number | null = null;
  let melhor = Infinity;
  for (const [i, c] of custo) {
    if (!naBase(pos[i])) continue;
    const total = c + dist(pos[i], chegada);
    if (total < melhor) [alvo, melhor] = [i, total];
  }
  if (alvo === null) return null;

  const caminho: Pt[] = [];
  for (let i: number | undefined = alvo; i !== undefined; i = veio.get(i)) caminho.push(pos[i]);
  if (dist(caminho[caminho.length - 1], obra) > 0) caminho.push(obra);
  return montar(caminho[0], caminho, 'sugerido');
}

// ---- viradas

interface Amostra { p: Pt; s: number } // ponto e distância percorrida desde o começo da linha

// amostras a cada `passo` metros, mais os vértices
function amostrar(pts: Pt[], passo: number): Amostra[] {
  const r: Amostra[] = [{ p: pts[0], s: 0 }];
  let acum = 0;
  for (let k = 1; k < pts.length; k++) {
    const l = dist(pts[k - 1], pts[k]);
    for (let t = passo; t < l; t += passo) {
      const f = t / l;
      r.push({ p: [pts[k - 1][0] + f * (pts[k][0] - pts[k - 1][0]), pts[k - 1][1] + f * (pts[k][1] - pts[k - 1][1])], s: acum + t });
    }
    acum += l;
    r.push({ p: pts[k], s: acum });
  }
  return r;
}

// ponto da linha mais perto de p, com a distância e o quanto se anda na linha até ele
function noCaminho(p: Pt, linha: Pt[]): { d: number; q: Pt; s: number } {
  let melhor = { d: Infinity, q: linha[0], s: 0 };
  let acum = 0;
  for (let k = 1; k < linha.length; k++) {
    const l = dist(linha[k - 1], linha[k]);
    const { t, q } = projetar(p, linha[k - 1], linha[k]);
    const d = dist(p, q);
    if (d < melhor.d) melhor = { d, q, s: acum + t * l };
    acum += l;
  }
  return melhor;
}

const rumo = (p: Pt, q: Pt) => Math.atan2(q[1] - p[1], q[0] - p[0]);
const graus = (a: number) => {
  const d = Math.abs(((a * 180) / Math.PI) % 360);
  return d > 180 ? 360 - d : d;
};

interface Candidata { ponto: Pt; s: number; motivo: Virada['motivo'] }

// onde uma estradinha sai do caminho: o ponto do caminho mais perto de onde a estradinha se afasta
function encontros(caminho: Pt[], terra: Estradinha[]): Candidata[] {
  const xs = caminho.map((p) => p[0]);
  const ys = caminho.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - FAIXA, Math.max(...xs) + FAIXA, Math.min(...ys) - FAIXA, Math.max(...ys) + FAIXA];
  const achados: Candidata[] = [];
  for (const e of terra) {
    const ex = e.pts.map((p) => p[0]);
    const ey = e.pts.map((p) => p[1]);
    if (Math.max(...ex) < x0 || Math.min(...ex) > x1 || Math.max(...ey) < y0 || Math.min(...ey) > y1) continue;
    const am = amostrar(e.pts, PASSO).map((a) => ({ ...a, ...noCaminho(a.p, caminho), sTerra: a.s }));
    const perto = am.map((a) => a.d <= FAIXA);
    if (!perto.some(Boolean)) continue;
    for (let i = 0; i < am.length; ) {
      if (perto[i]) { i++; continue; }
      let j = i;
      while (j + 1 < am.length && !perto[j + 1]) j++;
      // trecho fora i..j; vale se tem 60 m e encosta num trecho perto de um dos lados
      if (am[j].sTerra - am[i].sTerra >= SAI_DA_FAIXA) {
        for (const lado of [-1, 1]) {
          let k = lado < 0 ? i - 1 : j + 1;
          if (k < 0 || k >= am.length || !perto[k]) continue;
          // trecho perto contínuo; guarda a amostra mais perto do caminho (empate: a mais perto do trecho fora)
          const trecho: number[] = [];
          for (; k >= 0 && k < am.length && perto[k]; k += lado) trecho.push(k);
          const menor = Math.min(...trecho.map((m) => am[m].d));
          const escolhida = trecho.find((m) => am[m].d <= menor + 1)!; // trecho vem do mais perto do trecho fora para longe dele
          achados.push({ ponto: am[escolhida].q, s: am[escolhida].s, motivo: 'encontro' });
        }
      }
      i = j + 1;
    }
  }
  return achados;
}

function curvas(caminho: Pt[]): Candidata[] {
  const am = amostrar(caminho, PASSO);
  const total = am[am.length - 1].s;
  const mudanca = am.map((a) => {
    if (a.s < VISTA || a.s > total - VISTA) return 0;
    return graus(rumo(a.p, pontoEm(caminho, a.s + VISTA)) - rumo(pontoEm(caminho, a.s - VISTA), a.p));
  });
  const achados: Candidata[] = [];
  for (let i = 0; i < am.length; ) {
    if (mudanca[i] <= CURVA_MIN) { i++; continue; }
    let j = i;
    while (j + 1 < am.length && mudanca[j + 1] > CURVA_MIN) j++;
    let melhor = i;
    for (let k = i; k <= j; k++) if (mudanca[k] > mudanca[melhor]) melhor = k;
    achados.push({ ponto: am[melhor].p, s: am[melhor].s, motivo: 'curva' });
    i = j + 1;
  }
  return achados;
}

// ponto a `s` metros do começo da linha
function pontoEm(linha: Pt[], s: number): Pt {
  let acum = 0;
  for (let k = 1; k < linha.length; k++) {
    const l = dist(linha[k - 1], linha[k]);
    if (acum + l >= s) {
      const f = l === 0 ? 0 : (s - acum) / l;
      return [linha[k - 1][0] + f * (linha[k][0] - linha[k - 1][0]), linha[k - 1][1] + f * (linha[k][1] - linha[k - 1][1])];
    }
    acum += l;
  }
  return linha[linha.length - 1];
}

// pontos do caminho onde dá para errar: encontro com outra estradinha ou curva fechada
export function viradas(c: Chegada, terra: Estradinha[]): Virada[] {
  const caminho = c.caminho;
  if (caminho.length < 2) return [];
  const obra = caminho[caminho.length - 1];
  const longeDasPontas = (k: Candidata) => dist(k.ponto, c.entrada) > LONGE_DE_PONTA && dist(k.ponto, obra) > LONGE_DE_PONTA;
  const doEncontro = encontros(caminho, terra).filter(longeDasPontas);
  const daCurva = curvas(caminho).filter(longeDasPontas)
    .filter((k) => !doEncontro.some((e) => dist(e.ponto, k.ponto) < LONGE_DE_PONTA));
  const guardadas: Candidata[] = [];
  for (const k of [...doEncontro, ...daCurva].sort((a, b) => a.s - b.s)) {
    if (guardadas.every((g) => dist(g.ponto, k.ponto) >= LONGE_DE_PONTA)) guardadas.push(k);
  }
  return guardadas.map((k, i) => ({ id: `virada:${i}`, ponto: k.ponto, motivo: k.motivo }));
}
