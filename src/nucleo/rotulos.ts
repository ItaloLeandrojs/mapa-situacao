// textos do mapa: formato de km e de ref, e a escolha do lugar de cada texto sem cair em cima do que já existe
// (porta das funções largura e coloca e de fmt_km do situacao_teste.py)
import { G, type Geo } from './geom.ts';
import { MEDIDAS } from './medidas.ts';
import type { PtU } from './tipos.ts';

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

  constructor(quadroUtil: Geo, ocupado: Geo[]) {
    this.util = quadroUtil;
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
      const nota = this.encosta(caixa, env) + 5 * fora;
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
    const livres = candidatos.filter((c) => !this.cobre(this.envDoBloco(linhas, c, h, true)));
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
