// mexer na prévia com o mouse: arrastar texto (ajuste), arrastar o fundo (mover a área), roda e botões (aproximar).
// Dentro do quadrinho do detalhe, o fundo e a roda mexem na área do detalhe
import { MEDIDAS } from '../nucleo/medidas.ts';
import type { PtU } from '../nucleo/tipos.ts';
import { caixaDoDetalheNaTela, idsDoBloco, type EstadoDaTela } from './estado.ts';

export const FATOR_ZOOM = 1.25;
const ESPERA = 150; // ms sem mexer antes de recompor
const MINIMO = 3; // px: menos que isso é clique, não arrasto

export function ligarArrasto(palco: HTMLElement, estado: EstadoDaTela) {
  // o que já foi pedido e ainda não foi composto: deslocamento em px na tela e fator de aproximação
  let pendente = { tx: 0, ty: 0, fator: 1 };
  let relogio: ReturnType<typeof setTimeout> | undefined;
  // aproximação do detalhe pedida pela roda e ainda não composta
  let fatorDetalhe = 1;
  let relogioDetalhe: ReturnType<typeof setTimeout> | undefined;

  const svg = () => palco.querySelector<SVGSVGElement>('svg.desenho');
  // px por unidade da prancha, sem contar a aproximação ainda pendente
  const pxPorU = (s: SVGSVGElement) => s.getBoundingClientRect().width / pendente.fator / estado.ler().quadro.w;

  function mostrar() {
    const s = svg();
    if (!s) return;
    // aproxima em volta do centro da área útil, como aproximar() faz com a janela
    const q = estado.ler().quadro;
    const meioY = (MEDIDAS.topo + (q.h - MEDIDAS.margem - MEDIDAS.topo) / 2) / q.h;
    s.style.transformOrigin = `50% ${(meioY * 100).toFixed(2)}%`;
    s.style.transform = `translate(${pendente.tx}px, ${pendente.ty}px) scale(${pendente.fator})`;
  }

  async function compor() {
    clearTimeout(relogio);
    const s = svg();
    const { tx, ty, fator } = pendente;
    if (!s || (tx === 0 && ty === 0 && fator === 1)) return;
    const px = pxPorU(s);
    pendente = { tx: 0, ty: 0, fator: 1 };
    // o mapa vai para a direita: a janela anda para a esquerda; para baixo na tela: a janela sobe (y da prancha para cima)
    if (tx !== 0 || ty !== 0) await estado.moverArea(-tx / px, ty / px);
    if (fator !== 1) await estado.aproximarArea(fator);
    s.style.transform = ''; // se deu erro a prévia antiga fica, sem o deslocamento
  }

  const agendar = () => {
    clearTimeout(relogio);
    relogio = setTimeout(() => void compor(), ESPERA);
  };

  function aproximar(fator: number) {
    if (!svg()) return;
    if (pendente.tx !== 0 || pendente.ty !== 0) void compor(); // um tipo de pedido por vez
    pendente.fator *= fator;
    mostrar();
    agendar();
  }

  // o ponteiro está dentro do quadrinho do detalhe? (a prévia como está na tela, já com o que está pendente)
  function noDetalhe(s: SVGSVGElement, ev: MouseEvent): boolean {
    const e = estado.ler();
    const c = caixaDoDetalheNaTela(e);
    if (!c) return false;
    const r = s.getBoundingClientRect();
    const px = r.width / e.quadro.w;
    const [x, y] = [(ev.clientX - r.left) / px, e.quadro.h - (ev.clientY - r.top) / px];
    return x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3];
  }

  function aproximarDetalhe(fator: number) {
    fatorDetalhe *= fator;
    clearTimeout(relogioDetalhe);
    relogioDetalhe = setTimeout(() => {
      const f = fatorDetalhe;
      fatorDetalhe = 1;
      void estado.aproximarDetalhe(f);
    }, ESPERA);
  }

  palco.addEventListener(
    'wheel',
    (ev) => {
      const s = svg();
      if (!s) return;
      ev.preventDefault();
      const fator = ev.deltaY < 0 ? FATOR_ZOOM : 1 / FATOR_ZOOM;
      if (noDetalhe(s, ev)) aproximarDetalhe(fator);
      else aproximar(fator);
    },
    { passive: false },
  );

  palco.addEventListener('pointerdown', (ev) => {
    const s = svg();
    if (!s || ev.button !== 0) return;
    const alvo = (ev.target as Element).closest<SVGTextElement>('text[data-id]');
    if (alvo) arrastarTexto(ev, s, alvo);
    else if (noDetalhe(s, ev)) arrastarDetalhe(ev, s);
    else arrastarFundo(ev, s);
  });

  // durante o arrasto o bloco anda junto; ao soltar o ajuste vai para o estado
  function arrastarTexto(ev: PointerEvent, s: SVGSVGElement, alvo: SVGTextElement) {
    ev.preventDefault();
    const id = alvo.dataset.id!;
    const texto = estado.ler().desenho?.prims.find((p) => p.t === 'texto' && p.id === id);
    if (!texto || texto.t !== 'texto') return;
    const ids = (estado.ler().desenho?.prims ?? []).flatMap((p) => (p.t === 'texto' ? [p.id] : []));
    const bloco = idsDoBloco(id, ids)
      .map((i) => s.querySelector<SVGTextElement>(`text[data-id="${CSS.escape(i)}"]`))
      .filter((e): e is SVGTextElement => e !== null);
    // px por unidade do desenho como ele está na tela agora, já com a aproximação pendente:
    // o texto anda junto com o ponteiro e o ajuste vale para o desenho que está na tela
    const px = pxPorU(s) * pendente.fator;
    const [x0, y0] = [ev.clientX, ev.clientY];
    let [du, dv] = [0, 0];
    palco.setPointerCapture(ev.pointerId);
    const mover = (m: PointerEvent) => {
      [du, dv] = [(m.clientX - x0) / px, (m.clientY - y0) / px];
      for (const e of bloco) e.setAttribute('transform', `translate(${du} ${dv})`);
    };
    const soltar = (m: PointerEvent) => {
      palco.removeEventListener('pointermove', mover);
      palco.removeEventListener('pointerup', soltar);
      palco.removeEventListener('pointercancel', soltar);
      const longe = Math.hypot(m.clientX - x0, m.clientY - y0) >= MINIMO;
      if (longe && m.type === 'pointerup') {
        const centro: PtU = [texto.centro[0] + du, texto.centro[1] - dv];
        estado.ajustarTexto(id, centro);
      } else for (const e of bloco) e.removeAttribute('transform');
    };
    palco.addEventListener('pointermove', mover);
    palco.addEventListener('pointerup', soltar);
    palco.addEventListener('pointercancel', soltar);
  }

  function arrastarFundo(ev: PointerEvent, s: SVGSVGElement) {
    if (pendente.fator !== 1) void compor(); // um tipo de pedido por vez
    const [x0, y0] = [ev.clientX, ev.clientY];
    const [tx0, ty0] = [pendente.tx, pendente.ty];
    palco.setPointerCapture(ev.pointerId);
    palco.classList.add('arrastando');
    const mover = (m: PointerEvent) => {
      pendente.tx = tx0 + m.clientX - x0;
      pendente.ty = ty0 + m.clientY - y0;
      if (svg() === s) mostrar();
    };
    const soltar = () => {
      palco.removeEventListener('pointermove', mover);
      palco.removeEventListener('pointerup', soltar);
      palco.removeEventListener('pointercancel', soltar);
      palco.classList.remove('arrastando');
      if (Math.hypot(pendente.tx - tx0, pendente.ty - ty0) < MINIMO) {
        [pendente.tx, pendente.ty] = [tx0, ty0];
        mostrar();
      }
      agendar();
    };
    palco.addEventListener('pointermove', mover);
    palco.addEventListener('pointerup', soltar);
    palco.addEventListener('pointercancel', soltar);
  }

  // arrastar o fundo dentro do quadrinho: ao soltar, a área do detalhe anda (sem prévia durante o arrasto)
  function arrastarDetalhe(ev: PointerEvent, s: SVGSVGElement) {
    ev.preventDefault();
    // px por unidade da prancha medido agora: a prévia pode ser trocada (outra composição) antes de soltar
    const px = s.getBoundingClientRect().width / estado.ler().quadro.w;
    if (pendente.tx !== 0 || pendente.ty !== 0 || pendente.fator !== 1) void compor(); // um pedido por vez
    const [x0, y0] = [ev.clientX, ev.clientY];
    palco.setPointerCapture(ev.pointerId);
    palco.classList.add('arrastando');
    const soltar = (m: PointerEvent) => {
      palco.removeEventListener('pointerup', soltar);
      palco.removeEventListener('pointercancel', soltar);
      palco.classList.remove('arrastando');
      const [dx, dy] = [m.clientX - x0, m.clientY - y0];
      if (m.type !== 'pointerup' || Math.hypot(dx, dy) < MINIMO) return;
      // o mapa vai para a direita: a área anda para a esquerda; para baixo na tela: a área sobe
      void estado.moverDetalhe(-dx / px, dy / px);
    };
    palco.addEventListener('pointerup', soltar);
    palco.addEventListener('pointercancel', soltar);
  }

  return { aproximar };
}
