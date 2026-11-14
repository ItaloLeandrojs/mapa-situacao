// prévia do DXF em SVG: mesmas camadas e cores do arquivo, em unidade da prancha
import type { CandidatoObra } from '../nucleo/obra.ts';
import type { ArquivoGoogle, Camada, Desenho, Pt } from '../nucleo/tipos.ts';

const SVG = 'http://www.w3.org/2000/svg';
export const FUNDO_PREVIA = '#1f2933';

// cor de cada camada do DXF (30 laranja, 7 branco, 2 amarelo, 1 vermelho)
export const CORES: Record<Camada, string> = {
  ESTRADA: '#ff7f00', ESTRADA_EIXO: '#ffffff', ROTA: '#ffff00', CIDADE: '#ffffff',
  TEXTO: '#ffffff', LOCAL_DA_OBRA: '#ff0000', TITULO: '#ffffff',
};
const CAMADAS = Object.keys(CORES) as Camada[];

const num = (v: number) => String(Number(v.toFixed(4)));

function elemento<K extends keyof SVGElementTagNameMap>(nome: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, nome);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, typeof v === 'number' ? num(v) : v);
  return el;
}

function svgVazio(w: number, h: number): SVGSVGElement {
  const svg = elemento('svg', { viewBox: `0 0 ${num(w)} ${num(h)}` });
  svg.style.background = FUNDO_PREVIA;
  return svg;
}

// viewBox "0 0 w h" com o eixo y invertido (no DXF y cresce para cima); uma <g> por camada
export function desenharSvg(d: Desenho): SVGSVGElement {
  const { w, h } = d.quadro;
  const svg = svgVazio(w, h);
  const ponto = ([x, y]: [number, number]) => `${num(x)},${num(h - y)}`;
  const grupos = new Map<Camada, SVGGElement>();
  for (const c of CAMADAS) {
    const g = elemento('g', { 'data-camada': c, stroke: CORES[c], fill: 'none' });
    grupos.set(c, g);
    svg.append(g);
  }
  for (const p of d.prims) {
    const g = grupos.get(p.camada)!;
    if (p.t === 'linha') {
      const el = elemento(p.fechada ? 'polygon' : 'polyline', { points: p.pts.map(ponto).join(' ') });
      if (p.largura !== undefined) el.setAttribute('stroke-width', num(p.largura));
      else el.setAttribute('vector-effect', 'non-scaling-stroke');
      g.append(el);
    } else if (p.t === 'circulo') {
      g.append(elemento('circle', { cx: p.centro[0], cy: h - p.centro[1], r: p.r, 'vector-effect': 'non-scaling-stroke' }));
    } else {
      const t = elemento('text', {
        'data-id': p.id, x: p.centro[0], y: h - p.centro[1], 'font-size': p.h, 'font-family': 'Arial, Helvetica, sans-serif',
        'text-anchor': 'middle', 'dominant-baseline': 'central', fill: CORES[p.camada], stroke: 'none',
      });
      t.textContent = p.txt;
      g.append(t);
    }
  }
  return svg;
}

// antes de escolher a obra: a rota e os pontos que podem ser a obra, para clicar
export function desenharEscolha(arquivo: ArquivoGoogle, candidatos: CandidatoObra[], aoEscolher: (p: Pt) => void): SVGSVGElement {
  const pts = [...arquivo.caminhos.flatMap((c) => c.pontos), ...candidatos.map((c) => c.ponto)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const lado = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 500);
  const folga = lado * 0.12;
  const [x0, y1] = [Math.min(...xs) - folga, Math.max(...ys) + folga];
  const w = Math.max(...xs) + folga - x0, h = y1 - (Math.min(...ys) - folga);
  const k = 100 / Math.max(w, h); // a escolha cabe num quadro de 100 de lado maior
  const svg = svgVazio(w * k, h * k);
  const ponto = ([x, y]: Pt) => `${num((x - x0) * k)},${num((y1 - y) * k)}`;
  const rota = elemento('g', { 'data-camada': 'ROTA', stroke: CORES.ROTA, fill: 'none' });
  for (const c of arquivo.caminhos) {
    rota.append(elemento('polyline', { points: c.pontos.map(ponto).join(' '), 'stroke-width': 0.6 }));
  }
  svg.append(rota);
  const opcoes = elemento('g', { 'data-camada': 'LOCAL_DA_OBRA', stroke: CORES.LOCAL_DA_OBRA, fill: FUNDO_PREVIA });
  for (const c of candidatos) {
    const [x, y] = ponto(c.ponto).split(',').map(Number);
    const alvo = elemento('g', { class: 'candidato', role: 'button', tabindex: '0', 'aria-label': `Usar ${c.rotulo} como obra` });
    alvo.append(elemento('circle', { cx: x, cy: y, r: 2.2, 'stroke-width': 0.5 }));
    const t = elemento('text', { x, y: y - 3.6, 'font-size': 2.6, 'text-anchor': 'middle', fill: '#ffffff', stroke: 'none', 'font-family': 'Arial, Helvetica, sans-serif' });
    t.textContent = c.rotulo;
    alvo.append(t);
    alvo.addEventListener('click', () => aoEscolher(c.ponto));
    alvo.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') aoEscolher(c.ponto);
    });
    opcoes.append(alvo);
  }
  svg.append(opcoes);
  return svg;
}
