// textos do mapa: formato de km e de ref, e a escolha do lugar de cada texto sem cair em cima do que já existe
// (porta das funções largura e coloca e de fmt_km do situacao_teste.py)
import { G, type Geo } from './geom.ts';
import { MEDIDAS } from './medidas.ts';
import { textoCoordenada } from './obra.ts';
import type { Saida } from './saidas.ts';
import type { Camada, Primitiva, Pt, PtU } from './tipos.ts';

export type Texto = Extract<Primitiva, { t: 'texto' }>;

type Env = [number, number, number, number];

const cruza = (a: Env, b: Env) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// avanço de cada caractere no Arial (tabela hmtx do arial.ttf do Windows, em unidades de 2048 por em),
// agrupado por largura. O AutoCAD desenha fonte TrueType com a altura do texto igual à altura da maiúscula
// (sCapHeight = 1467 no arial.ttf), então a largura é avanço / 1467 × altura.
export const ALTURA_MAIUSCULA = 1467;
export const UNIDADES_DO_EM = 2048;
const AVANCOS: [number, string][] = [
  [391, "'"],
  [455, "ijl"],
  [532, "|"],
  [569, " !,./:;I[\\]ftÍÌÎÏíìîï"],
  [682, "()-`r"],
  [684, "{}"],
  [727, "\""],
  [748, "º"],
  [758, "ª"],
  [797, "*"],
  [819, "°"],
  [961, "^"],
  [1024, "Jcksvxyzç"],
  [1139, "#$0123456789?L_abdeghnopquáàâãäéèêëóòôõöúùûüñ"],
  [1196, "+<=>~"],
  [1251, "FTZ"],
  [1366, "&ABEKPSVXYÁÀÂÃÄÉÈÊË"],
  [1479, "CDHNRUwÚÙÛÜÇÑ"],
  [1593, "GOQÓÒÔÕÖ"],
  [1706, "Mm"],
  [1821, "%"],
  [1933, "W"],
  [2079, "@"],
];
const AVANCO = new Map(AVANCOS.flatMap(([a, cs]) => [...cs].map((c) => [c, a] as const)));
const AVANCO_OUTROS = 1366; // caractere fora da tabela: o de uma maiúscula comum (A, B, E)

// largura da linha de texto desenhada em Arial com altura h (sem kerning, como o AutoCAD)
export const larguraTexto = (txt: string, h: number) =>
  ([...txt].reduce((s, c) => s + (AVANCO.get(c) ?? AVANCO_OUTROS), 0) / ALTURA_MAIUSCULA) * h;

// folga da tinta para o ocupado de partida: a rota amarela é desenhada grossa, meia largura para cada lado
const FOLGA_LIVRE = MEDIDAS.larguraRota / 2;

export class Ocupacao {
  private util: Geo;
  private utilEnv: Env;
  // toca: teste rápido de "encosta ou não" (só no ocupado de partida, que é grande: a pista cobre o mapa todo)
  private ocupado: { g: Geo; env: Env; toca?: (caixa: Geo) => boolean }[] = [];
  private fixos: { g: Geo; env: Env; toca: (caixa: Geo) => boolean }[] = []; // pista, caixas, círculo da obra
  private textos: Env[] = []; // tinta de cada bloco de texto já posto
  private proibida: Geo | null;
  private tocaProibida: ((caixa: Geo) => boolean) | null;

  // proibida: área onde nenhum texto deve cair (a reserva do detalhe): lugar que encosta nela não é separado nem
  // livre, e na escolha do menos ruim o que cai nela pesa 5 vezes, como o que sai do quadro útil
  constructor(quadroUtil: Geo, ocupado: Geo[], proibida: Geo | null = null) {
    this.util = quadroUtil;
    this.proibida = proibida;
    this.tocaProibida = proibida ? G.encostaCaixa(proibida) : null;
    this.utilEnv = G.envelope(quadroUtil);
    this.fixos = ocupado.map((g) => ({ g, env: G.envelope(g), toca: G.encostaCaixa(g) }));
    this.ocupado = [...this.fixos];
  }

  ocupa(g: Geo): void {
    this.ocupado.push({ g, env: G.envelope(g) });
  }

  // área da caixa que cai em cima do ocupado (cada pedaço contado uma vez)
  private encosta(caixa: Geo, env: Env): number {
    const pedacos = this.ocupado
      .filter((o) => cruza(o.env, env) && (!o.toca || o.toca(caixa)))
      .map((o) => G.intersecao(caixa, o.g));
    return pedacos.length === 0 ? 0 : G.area(G.uniao(pedacos));
  }

  // caixa do bloco de texto centrado em c; tinta: só a altura das letras, sem o espaço da entrelinha
  private envDoBloco(linhas: string[], c: PtU, h: number, tinta = false): Env {
    const w = Math.max(...linhas.map((t) => larguraTexto(t, h)));
    const alt = tinta ? (linhas.length - 1) * h * MEDIDAS.entrelinha + h : linhas.length * h * MEDIDAS.entrelinha;
    return [c[0] - w / 2, c[1] - alt / 2, c[0] + w / 2, c[1] + alt / 2];
  }

  // a tinta cai na tinta de um texto já posto?
  private cobre(e: Env): boolean {
    return this.textos.some((t) => Math.min(e[2], t[2]) - Math.max(e[0], t[0]) > 1e-9 && Math.min(e[3], t[3]) - Math.max(e[1], t[1]) > 1e-9);
  }

  // a tinta fica dentro do quadro útil e longe dos outros textos: uma altura de texto de lado e uma e meia em
  // cima e embaixo (mais perto, os dois parecem um bloco só; um em cima do outro a uma altura ainda lê como nome
  // de duas linhas)?
  private separado(linhas: string[], c: PtU, h: number): boolean {
    const t = this.envDoBloco(linhas, c, h, true);
    const u = this.utilEnv;
    if (t[0] < u[0] - 1e-9 || t[1] < u[1] - 1e-9 || t[2] > u[2] + 1e-9 || t[3] > u[3] + 1e-9) return false;
    if (this.tocaProibida?.(G.caixa(...t))) return false;
    return !this.cobre([t[0] - h, t[1] - 1.5 * h, t[2] + h, t[3] + 1.5 * h]);
  }

  // separado e, com a folga da rota, fora da pista, das caixas e do círculo?
  private livre(linhas: string[], c: PtU, h: number): boolean {
    if (!this.separado(linhas, c, h)) return false;
    const t = this.envDoBloco(linhas, c, h, true);
    const env: Env = [t[0] - FOLGA_LIVRE, t[1] - FOLGA_LIVRE, t[2] + FOLGA_LIVRE, t[3] + FOLGA_LIVRE];
    const caixa = G.caixa(...env);
    return !this.fixos.some((f) => cruza(f.env, env) && f.toca(caixa));
  }

  // entre os centros candidatos, o que menos encosta no ocupado; o que sai do quadro útil pesa 5 vezes;
  // empate fica com o primeiro. Devolve o centro do bloco e marca o lugar (com respiro) como ocupado.
  coloca(linhas: string[], candidatos: PtU[], h: number = MEDIDAS.texto): PtU {
    let melhor: { c: PtU; env: Env } | null = null;
    let menor = Infinity;
    for (const c of candidatos) {
      const env = this.envDoBloco(linhas, c, h);
      const caixa = G.caixa(...env);
      const fora = G.area(caixa) - G.area(G.intersecao(caixa, this.util));
      const naProibida = this.proibida ? G.area(G.intersecao(caixa, this.proibida)) : 0;
      const nota = this.encosta(caixa, env) + 5 * fora + 5 * naProibida;
      // folga de 1e-9 só para o ruído da conta não trocar candidatos iguais
      if (nota < menor - 1e-9) [melhor, menor] = [{ c, env }, nota];
    }
    if (!melhor) throw new Error('coloca sem candidatos');
    this.ocupa(G.engrossa(G.caixa(...melhor.env), MEDIDAS.respiroTexto));
    this.textos.push(this.envDoBloco(linhas, melhor.c, h, true));
    return melhor.c;
  }

  // como coloca, mas só entre os candidatos cuja tinta não cai na tinta de um texto já posto;
  // se não sobrar nenhum, não coloca (null) e não ocupa nada
  colocaSemCobrir(linhas: string[], candidatos: PtU[], h: number = MEDIDAS.texto): PtU | null {
    const livres = candidatos.filter((c) => !this.cobre(this.envDoBloco(linhas, c, h, true)) &&
      !this.tocaProibida?.(G.caixa(...this.envDoBloco(linhas, c, h, true))));
    return livres.length === 0 ? null : this.coloca(linhas, livres, h);
  }

  // como coloca, mas só entre os candidatos livres: a tinta não encosta na pista, nas caixas nem no círculo da
  // obra, fica longe dos outros textos (uma altura de lado, uma e meia em cima e embaixo) e não sai do quadro
  // útil; se não sobrar nenhum, não coloca (null)
  colocaLivre(linhas: string[], candidatos: PtU[], h: number = MEDIDAS.texto): PtU | null {
    const livres = candidatos.filter((c) => this.livre(linhas, c, h));
    return livres.length === 0 ? null : this.coloca(linhas, livres, h);
  }

  // como colocaLivre, mas pode encostar na pista, nas caixas e no círculo (fica no que menos encosta): para o
  // texto que sempre sai, sem lugar livre, não grudar em outro texto
  colocaSeparado(linhas: string[], candidatos: PtU[], h: number = MEDIDAS.texto): PtU | null {
    const separados = candidatos.filter((c) => this.separado(linhas, c, h));
    return separados.length === 0 ? null : this.coloca(linhas, separados, h);
  }
}

// 20 -> "20Km", 12.5 -> "12,5Km", 0.45 -> "450m"
export function textoKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  const s = km.toFixed(1).replace('.', ',');
  return (s.endsWith(',0') ? s.slice(0, -2) : s) + 'Km';
}

// "CE-397" -> "CE397", "BR-116;CE-293" -> "BR116/CE293"
export function textoRef(ref: string): string {
  return ref.replaceAll('-', '').replaceAll(';', '/');
}

// linhas de um bloco de texto em volta do centro, uma entrelinha entre elas
export function bloco(camada: Camada, ids: string[], txts: string[], centro: PtU, h: number = MEDIDAS.texto): Texto[] {
  const meio = (txts.length - 1) / 2;
  return txts.map((txt, k) => ({
    t: 'texto', camada, id: ids[k], txt, h,
    centro: [centro[0], centro[1] + (meio - k) * h * MEDIDAS.entrelinha] as PtU,
  }));
}

// anéis do rótulo em volta de um círculo, em alturas de texto além da folga do círculo
const ANEIS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6];

// lugares para o bloco de texto em volta de um círculo de raio `raio`: primeiro os 6 de perto (dos lados, um pouco
// abaixo e acima, e em cima e embaixo), depois anéis cada vez mais longe em 32 direções. A largura que conta é
// `largura` (de partida, a da primeira linha: no bloco da obra, "LOCAL DA OBRA")
export function candidatosEmVolta(
  centro: PtU, linhas: string[], raio: number, largura = larguraTexto(linhas[0], MEDIDAS.texto),
): PtU[][] {
  const [ox, oy] = centro;
  const dx = raio + largura / 2 + MEDIDAS.folgaObra;
  const dy = raio + MEDIDAS.texto * 1.8;
  const perto: PtU[] = [
    [ox + dx, oy - dy * 0.6], [ox + dx, oy + dy * 0.6], [ox - dx, oy - dy * 0.6],
    [ox - dx, oy + dy * 0.6], [ox, oy - dy], [ox, oy + dy],
  ];
  const meiaW = largura / 2;
  // altura da tinta do bloco (linhas.length - 1 entrelinhas mais uma letra)
  const meiaH = (((linhas.length - 1) * MEDIDAS.entrelinha + 1) * MEDIDAS.texto) / 2;
  const aneis = ANEIS.map((k) => {
    const r = raio + MEDIDAS.folgaObra + k * MEDIDAS.texto;
    return Array.from({ length: 32 }, (_, i): PtU => {
      const a = -Math.PI / 8 - (i * Math.PI) / 16; // começa embaixo à direita, como o primeiro de perto
      return [ox + Math.cos(a) * (meiaW + r), oy + Math.sin(a) * (meiaH + r)];
    });
  });
  return [perto, ...aneis];
}

// o grupo mais perto de candidatosEmVolta que tiver lugar livre; centro cheio: dos 6 de perto, o que não cobre
// texto, senão o menos ruim. apertado (o detalhe): os lugares contam a largura da linha mais larga do bloco (a
// coordenada da ENTRADA é bem mais larga que "ENTRADA": medindo só a primeira, os lugares dos lados batem no
// círculo e os anéis só se afastam dele de verdade lá longe), e sem lugar livre procura também nos anéis, do mais
// perto para o mais longe, um lugar que não cubra texto antes de aceitar o menos ruim. O mapa geral fica com a
// primeira linha, para o desenho aprovado não mudar
export function colocaEmVolta(oc: Ocupacao, linhas: string[], centro: PtU, raio: number, apertado = false): PtU {
  const largura = apertado ? Math.max(...linhas.map((t) => larguraTexto(t, MEDIDAS.texto))) : undefined;
  const grupos = candidatosEmVolta(centro, linhas, raio, largura);
  return grupos.reduce<PtU | null>((c, g) => c ?? oc.colocaLivre(linhas, g), null) ??
    (apertado ? grupos : grupos.slice(0, 1)).reduce<PtU | null>((c, g) => c ?? oc.colocaSemCobrir(linhas, g), null) ??
    oc.coloca(linhas, grupos[0]);
}

// o local da obra: os dois círculos e o bloco "LOCAL DA OBRA" + coordenada em volta deles
export function localDaObra(
  oc: Ocupacao, centro: PtU, obra: Pt, ids: [string, string], apertado = false,
): { circulos: Primitiva[]; textos: Texto[] } {
  const linhas = ['LOCAL DA OBRA', textoCoordenada(obra)];
  return {
    circulos: [
      { t: 'circulo', camada: 'LOCAL_DA_OBRA', centro, r: MEDIDAS.raioObra },
      { t: 'circulo', camada: 'LOCAL_DA_OBRA', centro, r: MEDIDAS.raioObraDentro },
    ],
    textos: bloco('LOCAL_DA_OBRA', ids, linhas, colocaEmVolta(oc, linhas, centro, MEDIDAS.raioObra, apertado)),
  };
}

// até quantas alturas de linha o P/ anda ao longo da borda procurando lugar livre (mais longe, ele já parece
// ser de outra estrada)
const PASSOS_SAIDA = [1, 2, 3, 4];

// centros para o texto de uma saída: logo para dentro da borda de `area` mais perto do cruzamento, dos dois
// lados da estrada; cada centro preso para a caixa do texto caber inteira em `area` (perto do canto).
// mais: também mais longe ao longo da borda, de uma em uma altura de linha, do mais perto para o mais longe
export function candidatosSaida(
  [px, py]: PtU, txt: string, area: readonly [number, number, number, number], mais = false,
): PtU[] {
  const w = larguraTexto(txt, MEDIDAS.texto) / 2;
  const h = (MEDIDAS.texto * MEDIDAS.entrelinha) / 2;
  // borda mais perto: [distância, normal para dentro]
  const [x0, y0, x1, y1] = area;
  const lados: [number, number, number][] = [[px - x0, 1, 0], [x1 - px, -1, 0], [py - y0, 0, 1], [y1 - py, 0, -1]];
  const [, nx, ny] = lados.reduce((a, b) => (b[0] < a[0] ? b : a));
  const [meioNormal, meioBorda] = nx !== 0 ? [w, h] : [h, w];
  const [cx, cy] = [px + nx * (meioNormal + MEDIDAS.folgaSaida), py + ny * (meioNormal + MEDIDAS.folgaSaida)];
  const [bx, by] = [Math.abs(ny), Math.abs(nx)]; // ao longo da borda
  // área menor que o texto: fica no meio
  const prende = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  const dentro = ([x, y]: PtU): PtU => [prende(x, x0 + w, x1 - w), prende(y, y0 + h, y1 - h)];
  const candidatos: PtU[] = [];
  const linha = MEDIDAS.texto * MEDIDAS.entrelinha;
  const passos = mais ? PASSOS_SAIDA.map((k) => k * linha).filter((p) => Math.abs(p - 2 * meioBorda) > 1e-9) : [];
  for (const passo of [0, 2 * meioBorda, ...passos].sort((a, b) => a - b)) {
    const d = MEDIDAS.meiaEstrada + MEDIDAS.folgaRotulo + meioBorda + passo;
    candidatos.push(dentro([cx + bx * d, cy + by * d]), dentro([cx - bx * d, cy - by * d]));
  }
  return candidatos;
}

// "P/ CIDADE" logo para dentro da borda, dos dois lados da estrada; ids `${prefixo}:DESTINO` (o mesmo destino
// em outra borda: :2, :3... para o ajuste achar cada um)
export function textosDasSaidas(
  oc: Ocupacao, lista: Saida[], paraU: (p: Pt) => PtU, area: readonly [number, number, number, number], prefixo: string,
): Texto[][] {
  const destinos = new Map<string, number>();
  return lista.map((s) => {
    const txt = `P/ ${s.destino}`;
    const candidatos = candidatosSaida(paraU(s.ponto), txt, area);
    const mais = candidatosSaida(paraU(s.ponto), txt, area, true);
    const n = (destinos.get(s.destino) ?? 0) + 1;
    destinos.set(s.destino, n);
    const id = n === 1 ? `${prefixo}:${s.destino}` : `${prefixo}:${s.destino}:${n}`;
    // de preferência sem encostar em estrada nem em outro texto, mais longe ao longo da borda se preciso;
    // sem lugar livre, perto da saída e separado dos outros textos mesmo encostando em estrada; depois sem cobrir
    // texto; senão, no menos ruim (P/ sempre sai)
    let livre: PtU | null = null;
    // o par (um de cada lado da estrada) mais perto da saída que tiver lugar livre
    for (let k = 0; k < mais.length && !livre; k += 2) livre = oc.colocaLivre([txt], mais.slice(k, k + 2));
    const centro = livre ?? oc.colocaSeparado([txt], candidatos) ?? oc.colocaSemCobrir([txt], candidatos) ??
      oc.coloca([txt], candidatos);
    return bloco('TEXTO', [id], [txt], centro);
  });
}
