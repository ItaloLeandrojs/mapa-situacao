// conferência de textos do desenho: caixa da tinta de cada linha e o que ela encosta
import { larguraTexto } from '../../src/nucleo/rotulos';
import type { Camada, Desenho, Primitiva, PtU } from '../../src/nucleo/tipos';

export type Texto = Extract<Primitiva, { t: 'texto' }>;
type Env = [number, number, number, number];

// caixa de uma linha de texto: largura do Arial × altura do texto
export const tinta = (t: Texto): Env => {
  const w = larguraTexto(t.txt, t.h) / 2;
  return [t.centro[0] - w, t.centro[1] - t.h / 2, t.centro[0] + w, t.centro[1] + t.h / 2];
};

// o segmento ab passa pela caixa? (recorte de Liang-Barsky)
function corta([ax, ay]: PtU, [bx, by]: PtU, [x0, y0, x1, y1]: Env): boolean {
  let [t0, t1] = [0, 1];
  const [dx, dy] = [bx - ax, by - ay];
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return false;
      t1 = Math.min(t1, r);
    }
  }
  return true;
}

// alguma linha das camadas passa pela tinta do texto? (o retângulo do quadro não conta)
export function encostaEm(d: Desenho, t: Texto, camadas: Camada[]): boolean {
  const e = tinta(t);
  return d.prims.some((p) => {
    if (p.t !== 'linha' || !camadas.includes(p.camada) || (p.camada === 'ESTRADA' && p.fechada)) return false;
    const pts = p.fechada ? [...p.pts, p.pts[0]] : p.pts;
    return pts.some((q, k) => k > 0 && corta(pts[k - 1], q, e));
  });
}

export const PISTA: Camada[] = ['ESTRADA', 'ESTRADA_EIXO', 'CARROÇAL', 'ROTA'];
export const PISTA_E_CAIXA: Camada[] = [...PISTA, 'CIDADE'];
