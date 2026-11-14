import type { Aresta, Base, Janela, Pt } from './tipos.ts';

export interface PontoRede { nome: string; ponto: Pt; tipo: 'cidade' | 'obra' }
export interface Cadeia { linha: Pt[]; km: number; ref: string }
export interface Rede { trechos: Pt[][]; cadeias: Cadeia[]; viasRef: Pt[][] }

const ERRO_FORA = 'Esta rota fica fora da base do Ceará';
const LONGE = 2000; // m: obra, rota ou ponto mais longe que isso de qualquer aresta está fora da base
const NA_BASE = 50; // m: ponto da rota a até isso de uma aresta está em cima da base (rota do Google x traçado do OSM)
// continuação da rodovia: curva mais fechada que ~135° (cosseno abaixo disto) é voltar para trás, como na outra pista
const COS_VOLTA = -0.7;
// abaixo desta distância (unidade da prancha) o trecho "passa colado" num terceiro ponto
const COLADO_U = 4.431;
const DESVIO = 1.08; // A-C-B custando menos que 1,08 × A-B: o trecho A-B não é direto
const TRILHA_MAX = 0.35; // fração máxima de trilha num trecho
const PESO_TRILHA = 1.5;
const CLASSES_REF: readonly string[] = ['trunk', 'primary', 'secondary'];

// aresta percorrida a partir do nó `de`
interface Passo { aresta: Aresta; de: number }

const distancia = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);
const ehTrilha = (a: Aresta) => a.classe === 'tertiary' && !a.ref;
const peso = (a: Aresta) => (ehTrilha(a) ? a.m * PESO_TRILHA : a.m);
const outraPonta = (a: Aresta, no: number) => (a.a === no ? a.b : a.a);

function comprimento(pts: Pt[]): number {
  let s = 0;
  for (let k = 1; k < pts.length; k++) s += distancia(pts[k - 1], pts[k]);
  return s;
}

// ponto do segmento a-b mais perto de p, com o parâmetro t (0 em a, 1 em b)
function projetar(p: Pt, a: Pt, b: Pt): { t: number; q: Pt } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return { t, q: [a[0] + t * dx, a[1] + t * dy] };
}

function distanciaALinha(p: Pt, linha: Pt[]): number {
  let menor = Infinity;
  for (let k = 1; k < linha.length; k++) menor = Math.min(menor, distancia(p, projetar(p, linha[k - 1], linha[k]).q));
  return menor;
}

// pedaço da linha entre as distâncias `de` e `ate` medidas ao longo dela
function pedaco(pts: Pt[], de: number, ate: number): Pt[] {
  const acumulado = [0];
  for (let k = 1; k < pts.length; k++) acumulado.push(acumulado[k - 1] + distancia(pts[k - 1], pts[k]));
  // ponto a s metros do início, dentro do segmento k-1 a k (de comprimento l)
  const ponto = (s: number, k: number, l: number): Pt => {
    const t = l === 0 ? 0 : (s - acumulado[k - 1]) / l;
    return [pts[k - 1][0] + t * (pts[k][0] - pts[k - 1][0]), pts[k - 1][1] + t * (pts[k][1] - pts[k - 1][1])];
  };
  const saida: Pt[] = [];
  for (let k = 1; k < pts.length; k++) {
    const l = acumulado[k] - acumulado[k - 1];
    if (saida.length === 0 && de <= acumulado[k]) saida.push(ponto(de, k, l));
    if (saida.length === 0) continue;
    if (ate <= acumulado[k]) {
      saida.push(ponto(ate, k, l));
      return saida;
    }
    saida.push(pts[k]);
  }
  return saida;
}

// arestas da maior componente ligada (pelo número de nós)
function maiorComponente(arestas: Aresta[]): Aresta[] {
  const pai = new Map<number, number>();
  const raiz = (n: number): number => {
    if (!pai.has(n)) pai.set(n, n);
    let r = n;
    while (pai.get(r) !== r) r = pai.get(r)!;
    // encurta o caminho para as próximas buscas
    while (n !== r) {
      const proximo = pai.get(n)!;
      pai.set(n, r);
      n = proximo;
    }
    return r;
  };
  for (const a of arestas) pai.set(raiz(a.a), raiz(a.b));
  const tamanho = new Map<number, number>();
  for (const n of pai.keys()) tamanho.set(raiz(n), (tamanho.get(raiz(n)) ?? 0) + 1);
  let maior = -1;
  let qual = 0;
  for (const [r, t] of tamanho) if (t > maior) [maior, qual] = [t, r];
  return arestas.filter((a) => raiz(a.a) === qual);
}

interface Encaixe { aresta: Aresta; ao: number; q: Pt; dist: number } // ao: metros de desenho desde a ponta a

function encaixar(p: Pt, arestas: Aresta[]): Encaixe | null {
  let melhor: Encaixe | null = null;
  for (const aresta of arestas) {
    let ao = 0;
    for (let k = 1; k < aresta.pts.length; k++) {
      const { t, q } = projetar(p, aresta.pts[k - 1], aresta.pts[k]);
      const l = distancia(aresta.pts[k - 1], aresta.pts[k]);
      const dist = distancia(p, q);
      if (!melhor || dist < melhor.dist) melhor = { aresta, ao: ao + t * l, q, dist };
      ao += l;
    }
  }
  return melhor;
}

// corta as arestas nos pontos encaixados; m de cada parte na proporção do comprimento desenhado
function cortar(arestas: Aresta[], encaixes: Encaixe[]): { arestas: Aresta[]; noDoPonto: number[] } {
  let novoId = 0; // ids negativos para nós e arestas novos
  const cortes = new Map<number, { ao: number; q: Pt; i: number }[]>();
  encaixes.forEach((e, i) => {
    if (!cortes.has(e.aresta.id)) cortes.set(e.aresta.id, []);
    cortes.get(e.aresta.id)!.push({ ao: e.ao, q: e.q, i });
  });
  const noDoPonto: number[] = [];
  const saida: Aresta[] = [];
  for (const a of arestas) {
    const lista = cortes.get(a.id);
    if (!lista) {
      saida.push(a);
      continue;
    }
    const total = comprimento(a.pts);
    const marcas = [{ ao: 0, no: a.a }];
    for (const c of lista.sort((p, q) => p.ao - q.ao)) {
      const no = c.ao <= 0 ? a.a : c.ao >= total ? a.b : --novoId;
      noDoPonto[c.i] = no;
      marcas.push({ ao: Math.max(0, Math.min(total, c.ao)), no });
    }
    marcas.push({ ao: total, no: a.b });
    for (let k = 1; k < marcas.length; k++) {
      const [p, q] = [marcas[k - 1], marcas[k]];
      if (p.no === q.no) continue;
      const m = total === 0 ? 0 : (a.m * (q.ao - p.ao)) / total;
      saida.push({ ...a, id: --novoId, a: p.no, b: q.no, m, pts: pedaco(a.pts, p.ao, q.ao) });
    }
  }
  return { arestas: saida, noDoPonto };
}

function vizinhanca(arestas: Iterable<Aresta>): Map<number, Aresta[]> {
  const viz = new Map<number, Aresta[]>();
  const pendurar = (no: number, a: Aresta) => {
    if (!viz.has(no)) viz.set(no, []);
    viz.get(no)!.push(a);
  };
  for (const a of arestas) {
    pendurar(a.a, a);
    if (a.b !== a.a) pendurar(a.b, a);
  }
  return viz;
}

// fila de prioridade (heap binário) de [custo, nó]
class Fila {
  private itens: [number, number][] = [];
  get vazia() {
    return this.itens.length === 0;
  }
  por(item: [number, number]) {
    const h = this.itens;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p][0] <= h[i][0]) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  tirar(): [number, number] {
    const h = this.itens;
    const topo = h[0];
    const ultimo = h.pop()!;
    if (h.length) {
      h[0] = ultimo;
      let i = 0;
      for (;;) {
        const [e, d] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (e < h.length && h[e][0] < h[m][0]) m = e;
        if (d < h.length && h[d][0] < h[m][0]) m = d;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return topo;
  }
}

interface Arvore { custo: Map<number, number>; veio: Map<number, Passo> }

// menor custo da origem a cada nó; não entra nos nós em que `entra` dá falso nem passa de `limite`
function dijkstra(
  viz: Map<number, Aresta[]>, origem: number,
  custoDe: (a: Aresta) => number = peso, entra: (no: number) => boolean = () => true, limite = Infinity,
): Arvore {
  const custo = new Map([[origem, 0]]);
  const veio = new Map<number, Passo>();
  const fila = new Fila();
  fila.por([0, origem]);
  while (!fila.vazia) {
    const [c, no] = fila.tirar();
    if (c > custo.get(no)!) continue;
    for (const a of viz.get(no) ?? []) {
      const outro = outraPonta(a, no);
      const novo = c + custoDe(a);
      if (novo <= limite && novo < (custo.get(outro) ?? Infinity) && entra(outro)) {
        custo.set(outro, novo);
        veio.set(outro, { aresta: a, de: no });
        fila.por([novo, outro]);
      }
    }
  }
  return { custo, veio };
}

function caminho(arv: Arvore, destino: number): Passo[] {
  const passos: Passo[] = [];
  for (let no = destino; arv.veio.has(no); ) {
    const p = arv.veio.get(no)!;
    passos.push(p);
    no = p.de;
  }
  return passos.reverse();
}

function linhaDe(passos: Passo[]): Pt[] {
  const linha: Pt[] = [];
  for (const { aresta, de } of passos) {
    const pts = aresta.a === de ? aresta.pts : [...aresta.pts].reverse();
    linha.push(...(linha.length ? pts.slice(1) : pts));
  }
  return linha;
}

function cadeiaDe(passos: Passo[]): Cadeia {
  const porRef = new Map<string, number>();
  let m = 0;
  for (const { aresta } of passos) {
    m += aresta.m;
    if (aresta.ref) porRef.set(aresta.ref, (porRef.get(aresta.ref) ?? 0) + aresta.m);
  }
  let ref = '';
  let maior = -1;
  for (const [r, metros] of porRef) if (metros > maior) [ref, maior] = [r, metros];
  return { linha: linhaDe(passos), km: m / 1000, ref };
}

// rede dos trechos cortada nos pontos e nos nós de grau diferente de 2
function cortarCadeias(usadas: Map<number, Aresta>, nosDosPontos: number[]): Cadeia[] {
  const viz = vizinhanca(usadas.values());
  const grau = (no: number) => (viz.get(no) ?? []).reduce((g, a) => g + (a.a === a.b ? 2 : 1), 0);
  const vertices = new Set(nosDosPontos.filter((n) => viz.has(n)));
  for (const no of viz.keys()) if (grau(no) !== 2) vertices.add(no);
  const visto = new Set<number>();
  const cadeias: Cadeia[] = [];
  for (const v of vertices) {
    for (const primeira of viz.get(v)!) {
      if (visto.has(primeira.id)) continue;
      visto.add(primeira.id);
      const passos: Passo[] = [{ aresta: primeira, de: v }];
      let no = outraPonta(primeira, v);
      while (!vertices.has(no)) {
        const anterior = passos[passos.length - 1].aresta;
        const proxima = viz.get(no)!.find((a) => a.id !== anterior.id)!;
        visto.add(proxima.id);
        passos.push({ aresta: proxima, de: no });
        no = outraPonta(proxima, no);
      }
      cadeias.push(cadeiaDe(passos));
    }
  }
  return cadeias;
}

function segmentoTocaJanela(p: Pt, q: Pt, j: Janela): boolean {
  // recorte de Liang-Barsky
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let t0 = 0;
  let t1 = 1;
  const lados: [number, number][] = [[-dx, p[0] - j.x0], [dx, j.x1 - p[0]], [-dy, p[1] - j.y0], [dy, j.y1 - p[1]]];
  for (const [d, folga] of lados) {
    if (d === 0) {
      if (folga < 0) return false;
      continue;
    }
    const r = folga / d;
    if (d < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

const tocaJanela = (pts: Pt[], j: Janela) => pts.some((p, k) => k > 0 && segmentoTocaJanela(pts[k - 1], p, j));

export function montarRede(base: Base, pontos: PontoRede[], janela: Janela, mPorU: number): Rede {
  const componente = maiorComponente(base.arestas);
  const encaixes = pontos.map((p) => {
    const e = encaixar(p.ponto, componente);
    if (!e || (p.tipo === 'obra' && e.dist > LONGE)) throw new Error(ERRO_FORA);
    return e;
  });
  const { arestas, noDoPonto } = cortar(componente, encaixes);
  const viz = vizinhanca(arestas);
  const arvores = noDoPonto.map((no) => dijkstra(viz, no));
  const colado = COLADO_U * mPorU;

  const trechos: Pt[][] = [];
  const usadas = new Map<number, Aresta>();
  for (let i = 0; i < pontos.length; i++) {
    for (let k = i + 1; k < pontos.length; k++) {
      const destino = noDoPonto[k];
      const custo = arvores[i].custo.get(destino);
      const passos = caminho(arvores[i], destino);
      if (custo === undefined || passos.length === 0) continue;
      const linha = linhaDe(passos);
      const terceiros = pontos.map((_, c) => c).filter((c) => c !== i && c !== k);
      // terceiro ponto junto de uma das pontas não conta como colado: quem decide é a regra de 1,08
      const naPonta = (c: number) =>
        Math.min(distancia(pontos[c].ponto, pontos[i].ponto), distancia(pontos[c].ponto, pontos[k].ponto)) < colado;
      if (terceiros.some((c) => !naPonta(c) && distanciaALinha(pontos[c].ponto, linha) < colado)) continue;
      const desvio = (c: number) =>
        (arvores[i].custo.get(noDoPonto[c]) ?? Infinity) + (arvores[c].custo.get(destino) ?? Infinity);
      if (terceiros.some((c) => desvio(c) < DESVIO * custo)) continue;
      const m = passos.reduce((s, p) => s + p.aresta.m, 0);
      const trilha = passos.reduce((s, p) => s + (ehTrilha(p.aresta) ? p.aresta.m : 0), 0);
      if (trilha > TRILHA_MAX * m) continue;
      trechos.push(linha);
      for (const p of passos) usadas.set(p.aresta.id, p.aresta);
    }
  }

  const viasRef = base.arestas
    .filter((a) => a.ref && CLASSES_REF.includes(a.classe) && tocaJanela(a.pts, janela))
    .map((a) => a.pts);
  return { trechos, cadeias: cortarCadeias(usadas, noDoPonto), viasRef };
}

// arestas da base cuja caixa chega a LONGE da caixa dos pontos
// (laço, não Math.min(...): rota com muitos pontos estoura a pilha)
function arestasPerto(base: Base, pts: Pt[]): Aresta[] {
  const caixa: Janela = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) {
    caixa.x0 = Math.min(caixa.x0, x - LONGE);
    caixa.y0 = Math.min(caixa.y0, y - LONGE);
    caixa.x1 = Math.max(caixa.x1, x + LONGE);
    caixa.y1 = Math.max(caixa.y1, y + LONGE);
  }
  return base.arestas.filter((a) => a.pts.some((p, k) => k > 0 && segmentoTocaJanela(a.pts[k - 1], p, caixa)));
}

const ateArestas = (p: Pt, arestas: Aresta[]) => arestas.reduce((m, a) => Math.min(m, distanciaALinha(p, a.pts)), Infinity);

// rota com pontos e nenhum deles a até LONGE de alguma aresta da base: está fora da base
export function conferirRota(base: Base, rota: Pt[][]): void {
  const pts = rota.flat();
  if (pts.length === 0) return;
  const perto = arestasPerto(base, pts);
  if (!pts.some((p) => perto.some((a) => distanciaALinha(p, a.pts) <= LONGE))) throw new Error(ERRO_FORA);
}

// ponto da obra na rede. Obra a até LONGE da base: a própria obra. Mais longe (acesso por estrada de terra ou
// carroçal), o ponto onde a rota sai da base rumo à obra: andando de cada caminho a partir da ponta mais perto
// da obra, o primeiro ponto a até NA_BASE de uma aresta; sem nenhum, o ponto da rota mais perto da base, se
// estiver a até LONGE. Nem a obra nem a rota a até LONGE da base: está fora da base.
export function chegadaNaBase(base: Base, obra: Pt, rota: Pt[][]): Pt {
  const daObra = arestasPerto(base, [obra]);
  if (ateArestas(obra, daObra) <= LONGE) return obra;
  const pts = rota.flat();
  const perto = pts.length ? arestasPerto(base, pts) : [];
  const saidas: Pt[] = [];
  for (const c of rota) {
    if (c.length === 0) continue;
    const doFim = distancia(c[c.length - 1], obra) <= distancia(c[0], obra) ? [...c].reverse() : c;
    const achado = doFim.find((p) => ateArestas(p, perto) <= NA_BASE);
    if (achado) saidas.push(achado);
  }
  if (saidas.length) return saidas.reduce((a, b) => (distancia(a, obra) <= distancia(b, obra) ? a : b));
  let melhor: Pt | null = null;
  let menor = Infinity;
  for (const p of pts) {
    const d = ateArestas(p, perto);
    if (d < menor) [melhor, menor] = [p, d];
  }
  if (!melhor || menor > LONGE) throw new Error(ERRO_FORA);
  return melhor;
}

// distância pela rede (soma de m, sem o peso de trilha) de cada origem a cada alvo, cada ponto encaixado na
// aresta da base mais perto. O caminho não entra em nó onde `passa` dá falso (origens e alvos sempre valem).
// Origem a mais de LONGE de qualquer aresta fica com a linha toda undefined; alvo a mais de LONGE, sem caminho
// ou além de `limite` fica undefined.
export function distanciasPelaRede(
  base: Base, origens: Pt[], alvos: Pt[], limite: number, passa: (p: Pt) => boolean,
): (number | undefined)[][] {
  const sem = () => alvos.map((): number | undefined => undefined);
  if (base.arestas.length === 0) return origens.map(sem);
  const encOrigens = origens.map((p) => encaixar(p, base.arestas)!);
  const encAlvos = alvos.map((p) => encaixar(p, base.arestas)!);
  const perto = (encs: { dist: number }[]) => encs.flatMap((e, k) => (e.dist <= LONGE ? [k] : []));
  const [origensPerto, alvosPerto] = [perto(encOrigens), perto(encAlvos)];
  const { arestas, noDoPonto } = cortar(base.arestas, [
    ...origensPerto.map((i) => encOrigens[i]), ...alvosPerto.map((k) => encAlvos[k]),
  ]);
  const noDaOrigem = new Map(origensPerto.map((i, n) => [i, noDoPonto[n]]));
  const noDoAlvo = new Map(alvosPerto.map((k, n) => [k, noDoPonto[origensPerto.length + n]]));
  const pos = new Map<number, Pt>();
  for (const a of arestas) {
    pos.set(a.a, a.pts[0]);
    pos.set(a.b, a.pts[a.pts.length - 1]);
  }
  const sempre = new Set(noDoPonto);
  const entra = (no: number) => sempre.has(no) || passa(pos.get(no)!);
  const viz = vizinhanca(arestas);
  return origens.map((_, i) => {
    if (!noDaOrigem.has(i)) return sem();
    const arv = dijkstra(viz, noDaOrigem.get(i)!, (a) => a.m, entra, limite);
    return alvos.map((_, k) => (noDoAlvo.has(k) ? arv.custo.get(noDoAlvo.get(k)!) : undefined));
  });
}

export interface RotaSeparada {
  naBase: Pt[][]; // pedaços da rota em cima da base (a até NA_BASE de uma aresta)
  fora: Pt[][]; // pedaços fora da base (carroçal, acesso), com o ponto da base de cada ponta
  saidas: { ponto: Pt; veio: Pt }[]; // onde a rota deixa a base, e o ponto da base logo antes (de onde veio)
}

// separa a rota em pedaços em cima da base e fora dela. Os pedaços se encostam: o último ponto em cima da
// base antes de um pedaço fora é também o primeiro ponto dele (e o mesmo na volta para a base)
export function separarRota(base: Base, rota: Pt[][]): RotaSeparada {
  const pts = rota.flat();
  const perto = pts.length ? arestasPerto(base, pts) : [];
  // caixa de cada aresta, para não medir até as que estão longe do ponto
  const caixas = perto.map((a) => {
    const xs = a.pts.map((p) => p[0]);
    const ys = a.pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  const naBase = (p: Pt) => perto.some((a, k) => {
    const [x0, y0, x1, y1] = caixas[k];
    if (p[0] < x0 - NA_BASE || p[0] > x1 + NA_BASE || p[1] < y0 - NA_BASE || p[1] > y1 + NA_BASE) return false;
    return distanciaALinha(p, a.pts) <= NA_BASE;
  });
  const r: RotaSeparada = { naBase: [], fora: [], saidas: [] };
  for (const c of rota) {
    const marca = c.map(naBase);
    let k = 0;
    while (k < c.length) {
      let fim = k;
      while (fim + 1 < c.length && marca[fim + 1] === marca[k]) fim++;
      if (marca[k]) {
        if (fim > k) r.naBase.push(c.slice(k, fim + 1));
      } else {
        // fora, com o ponto da base de cada lado
        const de = Math.max(0, k - 1);
        const ate = Math.min(c.length - 1, fim + 1);
        if (ate > de) r.fora.push(c.slice(de, ate + 1));
        // saída (e volta) com dois pontos seguidos em cima da base: dá para saber o rumo da rota na rodovia
        if (k > 1 && marca[k - 2]) r.saidas.push({ ponto: c[k - 1], veio: c[k - 2] });
        if (fim + 2 < c.length && marca[fim + 2]) r.saidas.push({ ponto: c[fim + 1], veio: c[fim + 2] });
      }
      k = fim + 1;
    }
  }
  return r;
}

// rodovia depois do ponto onde a rota sai dela: da saída, no sentido contrário ao de onde a rota veio, pelas
// arestas com a mesma ref (a mais alinhada em cada nó, sem voltar para trás) até passar da janela.
// Aresta de saída sem ref: só o resto dela.
export function continuacao(base: Base, saida: { ponto: Pt; veio: Pt }, janela: Janela): Pt[] {
  const e = encaixar(saida.ponto, arestasPerto(base, [saida.ponto]));
  if (!e || e.dist > NA_BASE) return [];
  const { aresta } = e;
  const total = comprimento(aresta.pts);
  // o ponto de onde veio, projetado na mesma aresta: antes do encaixe, a rota veio pela ponta a
  const veioAo = encaixar(saida.veio, [aresta])!.ao;
  const paraB = veioAo <= e.ao;
  const linha = paraB ? pedaco(aresta.pts, e.ao, total) : pedaco(aresta.pts, 0, e.ao).reverse();
  if (!aresta.ref) return linha;
  // aresta curta sem ref no meio da rodovia (ligação de poucos metros no OSM) não interrompe a continuação
  const viz = vizinhanca(base.arestas.filter((a) => a.ref === aresta.ref || (!a.ref && a.m <= NA_BASE)));
  const vistas = new Set([aresta.id]);
  let no = paraB ? aresta.b : aresta.a;
  const dentro = (p: Pt) => p[0] >= janela.x0 && p[0] <= janela.x1 && p[1] >= janela.y0 && p[1] <= janela.y1;
  while (dentro(linha[linha.length - 1])) {
    const ultimo = linha[linha.length - 1];
    // rumo do último pedaço; saída bem na ponta da aresta (pedaço sem comprimento): o rumo da rota
    const penultimo = linha[linha.length - 2] ?? ultimo;
    const rumo: Pt = distancia(penultimo, ultimo) > 0
      ? [ultimo[0] - penultimo[0], ultimo[1] - penultimo[1]]
      : [saida.ponto[0] - saida.veio[0], saida.ponto[1] - saida.veio[1]];
    let melhor: { pts: Pt[]; no: number; id: number } | null = null;
    let maiorCos = COS_VOLTA; // curva mais fechada que isso não serve
    for (const a of viz.get(no) ?? []) {
      if (vistas.has(a.id)) continue;
      const pts = a.a === no ? a.pts : [...a.pts].reverse();
      const v: Pt = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]];
      const n = Math.hypot(...v) * Math.hypot(...rumo);
      const cos = n === 0 ? 0 : (v[0] * rumo[0] + v[1] * rumo[1]) / n;
      if (cos > maiorCos) [maiorCos, melhor] = [cos, { pts, no: outraPonta(a, no), id: a.id }];
    }
    if (!melhor) break;
    vistas.add(melhor.id);
    linha.push(...melhor.pts.slice(1));
    no = melhor.no;
  }
  return linha;
}
