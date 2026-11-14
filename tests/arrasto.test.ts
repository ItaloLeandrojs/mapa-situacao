// @vitest-environment happy-dom
import type { Desenho, PtU } from '../src/nucleo/tipos';
import { ligarArrasto } from '../src/tela/arrasto';
import type { EstadoDaTela } from '../src/tela/estado';
import { desenharSvg } from '../src/tela/previa';

const D: Desenho = {
  quadro: { w: 124.6, h: 113 },
  prims: [{ t: 'texto', camada: 'TEXTO', id: 'cidade:JARDIM', txt: 'JARDIM', centro: [40, 50], h: 1.152 }],
};
const PX_POR_U = 10; // a prévia sem aproximação ocupa 1246 px

function montar() {
  const palco = document.createElement('div');
  const svg = desenharSvg(D);
  svg.classList.add('desenho');
  palco.append(svg);
  document.body.append(palco);
  // largura na tela: a da prévia vezes a aproximação que está no transform (como o navegador mede)
  svg.getBoundingClientRect = () => {
    const m = /scale\(([\d.]+)\)/.exec(svg.style.transform);
    const w = 124.6 * PX_POR_U * (m ? Number(m[1]) : 1);
    return { width: w, height: w, x: 0, y: 0, top: 0, left: 0, right: w, bottom: w, toJSON: () => ({}) } as DOMRect;
  };
  palco.setPointerCapture = () => {};
  const ajustes: [string, PtU][] = [];
  const estado = {
    ler: () => ({ quadro: D.quadro, desenho: D }),
    ajustarTexto: (id: string, c: PtU) => ajustes.push([id, c]),
    moverArea: async () => {},
    aproximarArea: async () => {},
  } as unknown as EstadoDaTela;
  return { palco, svg, ajustes, arrasto: ligarArrasto(palco, estado) };
}

const ponteiro = (tipo: string, x: number, y: number) =>
  new PointerEvent(tipo, { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1 });

test('arrastar texto com aproximação pendente: o texto anda o mesmo que o ponteiro na tela', () => {
  const { palco, svg, ajustes, arrasto } = montar();
  arrasto.aproximar(1.25); // ainda não composto: a prévia está com scale(1.25)
  const alvo = svg.querySelector('text[data-id="cidade:JARDIM"]')!;
  alvo.dispatchEvent(ponteiro('pointerdown', 100, 100));
  palco.dispatchEvent(ponteiro('pointermove', 150, 100));
  palco.dispatchEvent(ponteiro('pointerup', 150, 100));
  // 50 px na tela com 12,5 px por unidade (10 × 1,25): 4 unidades no desenho que está na tela
  expect(ajustes).toHaveLength(1);
  expect(ajustes[0][0]).toBe('cidade:JARDIM');
  expect(ajustes[0][1][0]).toBeCloseTo(44, 9);
  expect(ajustes[0][1][1]).toBeCloseTo(50, 9);
  palco.remove();
});
