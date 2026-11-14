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
const ALTURA_MAIUSCULA = 1467;
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

export class Ocupacao {
  private util: Geo;
  private ocupado: { g: Geo; env: Env }[] = [];

  constructor(quadroUtil: Geo, ocupado: Geo[]) {
    this.util = quadroUtil;
    for (const g of ocupado) this.ocupa(g);
  }

  ocupa(g: Geo): void {
    this.ocupado.push({ g, env: G.envelope(g) });
  }

  // área da caixa que cai em cima do ocupado (cada pedaço contado uma vez)
  private encosta(caixa: Geo, env: Env): number {
    const pedacos = this.ocupado.filter((o) => cruza(o.env, env)).map((o) => G.intersecao(caixa, o.g));
    return pedacos.length === 0 ? 0 : G.area(G.uniao(pedacos));
  }

  // entre os centros candidatos, o que menos encosta no ocupado; o que sai do quadro útil pesa 5 vezes;
  // empate fica com o primeiro. Devolve o centro do bloco e marca o lugar (com respiro) como ocupado.
  coloca(linhas: string[], candidatos: PtU[], h: number = MEDIDAS.texto): PtU {
    const w = Math.max(...linhas.map((t) => larguraTexto(t, h)));
    const alt = linhas.length * h * MEDIDAS.entrelinha;
    let melhor: { c: PtU; caixa: Geo } | null = null;
    let menor = Infinity;
    for (const c of candidatos) {
      const env: Env = [c[0] - w / 2, c[1] - alt / 2, c[0] + w / 2, c[1] + alt / 2];
      const caixa = G.caixa(...env);
      const fora = G.area(caixa) - G.area(G.intersecao(caixa, this.util));
      const nota = this.encosta(caixa, env) + 5 * fora;
      // folga de 1e-9 só para o ruído da conta não trocar candidatos iguais
      if (nota < menor - 1e-9) [melhor, menor] = [{ c, caixa }, nota];
    }
    if (!melhor) throw new Error('coloca sem candidatos');
    this.ocupa(G.engrossa(melhor.caixa, MEDIDAS.respiroTexto));
    return melhor.c;
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
