// saídas "P/ CIDADE": onde o eixo das estradas cruza a borda da janela, a primeira sede que se alcança
// seguindo a rede para fora dela
import { distanciasPelaRede } from './grafo.ts';
import type { Base, Janela, Pt } from './tipos.ts';

export interface Saida { ponto: Pt; destino: string }

const ALCANCE = 80000; // m pela rede, da borda até a sede
const MESMA_SAIDA = 5000; // m: cruzamentos com o mesmo destino mais perto que isso contam como um
const NA_BORDA = 1; // m: vértice a menos disso da borda está nela (arredondamento da ida e volta prancha-UTM)

const distancia = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);
const dentro = (p: Pt, j: Janela) => p[0] > j.x0 && p[0] < j.x1 && p[1] > j.y0 && p[1] < j.y1;
// distância em linha reta do ponto até a janela (0 dentro dela)
const ateJanela = (p: Pt, j: Janela) =>
  Math.hypot(Math.max(j.x0 - p[0], 0, p[0] - j.x1), Math.max(j.y0 - p[1], 0, p[1] - j.y1));

// pontos em que o eixo cruza ou toca a borda: vértices em cima dela e segmentos que a atravessam
function cruzamentos(eixo: Pt[][], j: Janela): Pt[] {
  const entre = (v: number, a: number, b: number) => v >= a - NA_BORDA && v <= b + NA_BORDA;
  const naBorda = ([x, y]: Pt) =>
    (entre(y, j.y0, j.y1) && (Math.abs(x - j.x0) <= NA_BORDA || Math.abs(x - j.x1) <= NA_BORDA)) ||
    (entre(x, j.x0, j.x1) && (Math.abs(y - j.y0) <= NA_BORDA || Math.abs(y - j.y1) <= NA_BORDA));
  const pontos: Pt[] = [];
  for (const l of eixo) {
    for (const p of l) if (naBorda(p)) pontos.push(p);
    for (let k = 1; k < l.length; k++) {
      const [p, q] = [l[k - 1], l[k]];
      // eixo 0 cruza x = c (eixo 1: y = c) com as duas pontas de lados opostos
      for (const [eixoN, c] of [[0, j.x0], [0, j.x1], [1, j.y0], [1, j.y1]] as const) {
        const [a, b] = [p[eixoN] - c, q[eixoN] - c];
        if (a * b >= 0) continue;
        const t = a / (a - b);
        const outro = 1 - eixoN;
        const v = p[outro] + t * (q[outro] - p[outro]);
        const [lo, hi] = eixoN === 0 ? [j.y0, j.y1] : [j.x0, j.x1];
        if (v < lo || v > hi) continue;
        pontos.push(eixoN === 0 ? [c, v] : [v, c]);
      }
    }
  }
  return pontos;
}

export function saidas(base: Base, eixoUtm: Pt[][], janela: Janela, ligados: string[]): Saida[] {
  const pontos = cruzamentos(eixoUtm, janela);
  if (pontos.length === 0) return [];
  const ja = new Set(ligados);
  // sede fora da janela, que ainda não está no mapa e que pode estar a até 80 km da borda
  const sedes = base.lugares.filter(
    (l) => l.tipo === 'sede' && !ja.has(l.nome) && !dentro(l.ponto, janela) && ateJanela(l.ponto, janela) <= ALCANCE,
  );
  if (sedes.length === 0) return [];
  const dist = distanciasPelaRede(base, pontos, sedes.map((s) => s.ponto), ALCANCE, (p) => !dentro(p, janela));

  const lista: Saida[] = [];
  pontos.forEach((ponto, i) => {
    let melhor = -1;
    dist[i].forEach((d, k) => {
      if (d !== undefined && (melhor < 0 || d < dist[i][melhor]!)) melhor = k;
    });
    if (melhor < 0) return;
    const destino = sedes[melhor].nome;
    if (lista.some((s) => s.destino === destino && distancia(s.ponto, ponto) < MESMA_SAIDA)) return;
    lista.push({ ponto, destino });
  });
  return lista;
}
