import type { Janela, Pt, PtU, Quadro } from './tipos.ts';

// tudo em unidade da prancha (valores do teste em metros × 0,00177231)
export const MEDIDAS = {
  texto: 1.152, entrelinha: 1.45,
  meiaEstrada: 0.5317, fecha: 0.4431, buracoMin: 9.423, alisaContorno: 0.0709,
  caixaW: 4.608, caixaH: 3.013, raioObra: 1.329, raioObraDentro: 1.037,
  junta: 0.2658, simplifica: 0.3545, pedacoMin: 1.2406, liga: 0.8862,
  zonaRota: 0.9394, larguraRota: 0.22,
  traco: 0.6735, vao: 0.4608, tracoMin: 0.1063,
  folgaRotulo: 0.4431, entreRotulos: 2.658, cadeiaMin: 2.658, folgaCidade: 0.6203,
  respiroTexto: 0.2127, margemCanto: 1.418, folgaObra: 0.5317,
  textoCredito: 0.8, // altura do crédito "Base: OpenStreetMap" (não existe no teste)
  folgaSaida: 0.4431, // espaço entre a borda do mapa e o texto "P/ CIDADE" (não existe no teste)
  // rodovia depois da saída do carroçal (não existem no teste). Em unidade da prancha, para o pedaço ter o
  // mesmo tamanho no papel em qualquer escala: procura encontro até 8,862 (5 km na escala do teste, uns 7% da
  // largura do mapa); sem encontro, desenha um toco de 2,658 (o tamanho mínimo de cadeia rotulada)
  continuaMax: 8.862, tocoContinua: 2.658,
  margem: 3, topo: 14,
  // detalhe da chegada (não existe no teste): tamanho máximo do quadrinho, faixa do título dentro dele, margem
  // entre a borda e o mapa dele (e entre ele e o mapa geral) e raio do círculo da entrada, das viradas e das referências
  detalheW: 50, detalheH: 45, tituloDetalhe: 4, margemDetalhe: 1.5, raioMarca: 0.35,
} as const;

export interface Escala {
  k: number; // unidades da prancha por metro
  mPorU: number; // metros por unidade da prancha
  paraU(p: Pt): PtU;
  paraMetros(p: PtU): Pt;
}

// área útil do mapa [x0, y0, x1, y1]: folga de margem em volta e de topo em cima (título da prancha)
export function areaUtil(q: Quadro): [number, number, number, number] {
  return [MEDIDAS.margem, MEDIDAS.margem, q.w - MEDIDAS.margem, q.h - MEDIDAS.topo];
}

// mapa centrado na caixa [x0, y0, x1, y1] da prancha
export function escalaNaCaixa(j: Janela, caixa: readonly [number, number, number, number]): Escala {
  const [x0, y0, x1, y1] = caixa;
  const caixaW = x1 - x0;
  const caixaH = y1 - y0;
  const larg = j.x1 - j.x0;
  const alt = j.y1 - j.y0;
  const k = Math.min(caixaW / larg, caixaH / alt);
  const ox = x0 + (caixaW - larg * k) / 2;
  const oy = y0 + (caixaH - alt * k) / 2;
  return {
    k,
    mPorU: 1 / k,
    paraU: (p) => [(p[0] - j.x0) * k + ox, (p[1] - j.y0) * k + oy],
    paraMetros: (p) => [(p[0] - ox) / k + j.x0, (p[1] - oy) / k + j.y0],
  };
}

// mapa centrado na área útil
export function escala(j: Janela, q: Quadro): Escala {
  return escalaNaCaixa(j, areaUtil(q));
}
