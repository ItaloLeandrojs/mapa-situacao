import type { Aresta, Base, Classe, Janela, Lugar, Pt } from './tipos.ts';
import { paraUtm } from './utm.ts';

export interface Indice { data: string; celula: number; oeste: number; sul: number; colunas: number; linhas: number }
export type Buscar = (caminho: string) => Promise<unknown>; // devolve o JSON já lido

// formato dos arquivos de public/base (inteiros em metros UTM)
export type NoArquivo = [number, number, number]; // id, x, y
export type ArestaArquivo = [number, number, number, string, Classe, number, number[]]; // id, a, b, ref, classe, m, x0 y0 x1 y1...
export interface CelulaArquivo { nos: NoArquivo[]; arestas: ArestaArquivo[] }
export interface CidadeArquivo { n: string; t: Lugar['tipo']; o: Lugar['osm']; x: number; y: number }

const ERRO_CARGA = 'Não consegui carregar a base de estradas. Confira a internet e tente de novo';

export const nomeDaCelula = (col: number, lin: number) => `rodovias/c${col}_l${lin}.json`;

// caixa UTM da célula: a que contém os quatro cantos dela
export function caixaDaCelula(i: Indice, col: number, lin: number): Janela {
  const oeste = i.oeste + col * i.celula;
  const sul = i.sul + lin * i.celula;
  const cantos = [
    paraUtm(oeste, sul),
    paraUtm(oeste + i.celula, sul),
    paraUtm(oeste, sul + i.celula),
    paraUtm(oeste + i.celula, sul + i.celula),
  ];
  const xs = cantos.map((c) => c[0]);
  const ys = cantos.map((c) => c[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export const caixasSeTocam = (p: Janela, q: Janela) => p.x0 <= q.x1 && q.x0 <= p.x1 && p.y0 <= q.y1 && q.y0 <= p.y1;

export function celulasDaJanela(i: Indice, j: Janela, margem: number): string[] {
  const alvo = { x0: j.x0 - margem, y0: j.y0 - margem, x1: j.x1 + margem, y1: j.y1 + margem };
  const celulas: string[] = [];
  for (let lin = 0; lin < i.linhas; lin++) {
    for (let col = 0; col < i.colunas; col++) {
      if (caixasSeTocam(caixaDaCelula(i, col, lin), alvo)) celulas.push(nomeDaCelula(col, lin));
    }
  }
  return celulas;
}

function lerAresta([id, a, b, ref, classe, m, plano]: ArestaArquivo): Aresta {
  const pts: Pt[] = [];
  for (let k = 0; k < plano.length; k += 2) pts.push([plano[k], plano[k + 1]]);
  return { id, a, b, ref, classe, m, pts };
}

export async function carregarBase(j: Janela, buscar: Buscar, margem = 60000): Promise<Base> {
  try {
    const indice = (await buscar('indice.json')) as Indice;
    const [cidades, ...celulas] = (await Promise.all([
      buscar('cidades.json'),
      ...celulasDaJanela(indice, j, margem).map((c) => buscar(c)),
    ])) as [CidadeArquivo[], ...CelulaArquivo[]];

    const nos = new Map<number, Pt>();
    const arestas = new Map<number, Aresta>();
    for (const celula of celulas) {
      for (const [id, x, y] of celula.nos) nos.set(id, [x, y]);
      for (const a of celula.arestas) if (!arestas.has(a[0])) arestas.set(a[0], lerAresta(a));
    }
    const lugares: Lugar[] = cidades.map((c) => ({ nome: c.n, tipo: c.t, osm: c.o, ponto: [c.x, c.y] }));
    return { data: indice.data, nos, arestas: [...arestas.values()], lugares };
  } catch {
    throw new Error(ERRO_CARGA);
  }
}
