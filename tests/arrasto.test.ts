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

test('arrasto que começa dentro do quadrinho chama moverDetalhe, fora chama moverArea', async () => {
  // quadrinho no canto inferior esquerdo (ie): caixa [3, 3, 53, 48] na prancha, com o título do detalhe no desenho
  const comDetalhe: Desenho = {
    quadro: D.quadro,
    prims: [...D.prims, { t: 'texto', camada: 'TITULO', id: 'detalhe:titulo', txt: 'DETALHE DA CHEGADA', centro: [28, 46], h: 1.152 }],
  };
  const palco = document.createElement('div');
  const svg = desenharSvg(comDetalhe);
  svg.classList.add('desenho');
  palco.append(svg);
  document.body.append(palco);
  svg.getBoundingClientRect = () => ({ width: 1246, height: 1130, x: 0, y: 0, top: 0, left: 0, right: 1246, bottom: 1130, toJSON: () => ({}) }) as DOMRect;
  palco.setPointerCapture = () => {};
  const chamadas: [string, number, number][] = [];
  const estado = {
    ler: () => ({ quadro: D.quadro, desenho: comDetalhe, detalhe: { canto: 'ie', ligado: true, disponivel: true } }),
    moverArea: async (x: number, y: number) => void chamadas.push(['moverArea', x, y]),
    moverDetalhe: async (x: number, y: number) => void chamadas.push(['moverDetalhe', x, y]),
    aproximarArea: async () => {},
    aproximarDetalhe: async () => {},
  } as unknown as EstadoDaTela;
  ligarArrasto(palco, estado);
  // dentro: (20, 20) da prancha fica em (200, 930) px; arrasta 50 px para a direita e 20 px para baixo
  svg.dispatchEvent(ponteiro('pointerdown', 200, 930));
  palco.dispatchEvent(ponteiro('pointermove', 250, 950));
  palco.dispatchEvent(ponteiro('pointerup', 250, 950));
  await new Promise((r) => setTimeout(r, 300));
  expect(chamadas).toHaveLength(1);
  expect(chamadas[0][0]).toBe('moverDetalhe');
  expect(chamadas[0][1]).toBeCloseTo(-5, 9); // o mapa vai para a direita: a área anda para a esquerda
  expect(chamadas[0][2]).toBeCloseTo(2, 9); // para baixo na tela: a área sobe
  // fora: (90, 90) da prancha fica em (900, 230) px
  svg.dispatchEvent(ponteiro('pointerdown', 900, 230));
  palco.dispatchEvent(ponteiro('pointermove', 950, 250));
  palco.dispatchEvent(ponteiro('pointerup', 950, 250));
  await new Promise((r) => setTimeout(r, 300));
  expect(chamadas).toHaveLength(2);
  expect(chamadas[1][0]).toBe('moverArea');
  expect(chamadas[1][1]).toBeCloseTo(-5, 9);
  expect(chamadas[1][2]).toBeCloseTo(2, 9);
  palco.remove();
});
