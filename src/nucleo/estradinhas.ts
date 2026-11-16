import { caixaDaCelula, caixasSeTocam, type Buscar } from './base.ts';
import type { ClasseTerra, Estradinha, Janela, Pt } from './tipos.ts';

export interface IndiceTerra { data: string; celula: number; oeste: number; sul: number; colunas: number; linhas: number; cheias: string[] }
export type EstradinhaArquivo = [number, 0 | 1 | 2, number, number, ...number[]]; // id, classe (0 track, 1 unclassified, 2 residential), x0, y0, depois dx, dy inteiros

export const ERRO_CARGA_TERRA = 'Não consegui carregar as estradinhas. O mapa saiu sem o detalhe da chegada';

const CLASSES: readonly ClasseTerra[] = ['track', 'unclassified', 'residential'];

export const nomeDaCelulaTerra = (col: number, lin: number) => `estradinhas/c${col}_l${lin}.json`;

// grava com deltas inteiros: o primeiro ponto inteiro, os demais como diferença para o anterior
export function paraArquivo(e: Estradinha): EstradinhaArquivo {
  const [x0, y0] = e.pts[0];
  const saida: EstradinhaArquivo = [e.id, CLASSES.indexOf(e.classe) as 0 | 1 | 2, x0, y0];
  for (let k = 1; k < e.pts.length; k++) saida.push(e.pts[k][0] - e.pts[k - 1][0], e.pts[k][1] - e.pts[k - 1][1]);
  return saida;
}

export function deArquivo([id, classe, x0, y0, ...deltas]: EstradinhaArquivo): Estradinha {
  const pts: Pt[] = [[x0, y0]];
  for (let k = 0; k < deltas.length; k += 2) {
    const [x, y] = pts[pts.length - 1];
    pts.push([x + deltas[k], y + deltas[k + 1]]);
  }
  return { id, classe: CLASSES[classe], pts };
}

export async function carregarEstradinhas(j: Janela, buscar: Buscar, margem = 2000): Promise<Estradinha[]> {
  try {
    const indice = (await buscar('estradinhas/indice.json')) as IndiceTerra;
    const alvo = { x0: j.x0 - margem, y0: j.y0 - margem, x1: j.x1 + margem, y1: j.y1 + margem };
    // só células que têm estradinha (as outras nem existem no servidor) e cuja caixa toca a janela
    const pedir = indice.cheias.filter((nome) => {
      const m = /c(\d+)_l(\d+)\.json$/.exec(nome);
      return m !== null && caixasSeTocam(caixaDaCelula(indice, Number(m[1]), Number(m[2])), alvo);
    });
    const celulas = (await Promise.all(pedir.map((nome) => buscar(nome)))) as EstradinhaArquivo[][];
    const vistas = new Map<number, Estradinha>();
    for (const celula of celulas) {
      for (const a of celula) if (!vistas.has(a[0])) vistas.set(a[0], deArquivo(a));
    }
    return [...vistas.values()];
  } catch (e) {
    // a pessoa vê a mensagem; o erro de verdade (rede ou programa) fica em cause para o console
    throw new Error(ERRO_CARGA_TERRA, { cause: e });
  }
}
