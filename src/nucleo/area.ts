import { MEDIDAS } from './medidas.ts';
import type { Janela, Lugar, Pt, Quadro } from './tipos.ts';

export const LADO_MIN = 8000;
export const LADO_MAX = 250000;
const LADO_PROPOSTO_MIN = 20000;
const ALCANCE_CIDADE = 80000;
const FOLGA = 0.08;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const maior = (j: Janela) => Math.max(j.x1 - j.x0, j.y1 - j.y0);

// mesma janela com o centro mantido e os lados multiplicados por f
function escalar(j: Janela, f: number): Janela {
  const cx = (j.x0 + j.x1) / 2, cy = (j.y0 + j.y1) / 2;
  const hw = ((j.x1 - j.x0) * f) / 2, hh = ((j.y1 - j.y0) * f) / 2;
  return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
}

// caixa em volta da rota, da obra, das 5 sedes mais próximas e da sede osm city mais próxima em até 80 km;
// +8% de cada lado; lado maior de pelo menos 20 km; depois cresce o lado que falta até a proporção da área útil
export function proporArea(obra: Pt, rota: Pt[][], lugares: Lugar[], q: Quadro): Janela {
  const pts: Pt[] = [obra, ...rota.flat()];
  const maisPerto = (a: Lugar, b: Lugar) => dist(a.ponto, obra) - dist(b.ponto, obra);
  const sedes = lugares.filter((l) => l.tipo === 'sede').sort(maisPerto).slice(0, 5);
  pts.push(...sedes.map((l) => l.ponto));
  const cidade = lugares
    .filter((l) => l.tipo === 'sede' && l.osm === 'city' && dist(l.ponto, obra) <= ALCANCE_CIDADE)
    .sort(maisPerto)[0];
  if (cidade) pts.push(cidade.ponto);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const fx = (x1 - x0) * FOLGA, fy = (y1 - y0) * FOLGA;
  let j: Janela = { x0: x0 - fx, y0: y0 - fy, x1: x1 + fx, y1: y1 + fy };
  if (maior(j) === 0) {
    const m = LADO_PROPOSTO_MIN / 2; // caixa de tamanho zero: não dá para escalar
    j = { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
  } else if (maior(j) < LADO_PROPOSTO_MIN) j = escalar(j, LADO_PROPOSTO_MIN / maior(j));

  const alvo = (q.w - 2 * MEDIDAS.margem) / (q.h - MEDIDAS.margem - MEDIDAS.topo);
  const w = j.x1 - j.x0, h = j.y1 - j.y0;
  const cx = (j.x0 + j.x1) / 2, cy = (j.y0 + j.y1) / 2;
  if (w / h < alvo) {
    const nw = h * alvo;
    return { x0: cx - nw / 2, y0: j.y0, x1: cx + nw / 2, y1: j.y1 };
  }
  const nh = w / alvo;
  return { x0: j.x0, y0: cy - nh / 2, x1: j.x1, y1: cy + nh / 2 };
}

export function mover(j: Janela, dx: number, dy: number): Janela {
  return { x0: j.x0 + dx, y0: j.y0 + dy, x1: j.x1 + dx, y1: j.y1 + dy };
}

// fator > 1 aproxima (lados divididos pelo fator); fator < 1 afasta; o lado maior fica entre LADO_MIN e LADO_MAX
export function aproximar(j: Janela, fator: number): Janela {
  const alvo = Math.min(LADO_MAX, Math.max(LADO_MIN, maior(j) / fator));
  return escalar(j, alvo / maior(j));
}

export function lugaresLigadosDePartida(lugares: Lugar[], j: Janela): string[] {
  return lugares
    .filter((l) => l.tipo === 'sede' || l.osm === 'city' || l.osm === 'town')
    .filter((l) => l.ponto[0] >= j.x0 && l.ponto[0] <= j.x1 && l.ponto[1] >= j.y0 && l.ponto[1] <= j.y1)
    .map((l) => l.nome);
}
