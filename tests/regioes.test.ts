// conferência com a base de verdade (public/base) em seis regiões do Ceará, cada uma com uma rota curta
// sintética sobre a rodovia mais perto (scripts/gerar-regioes.ts)
import { larguraTexto } from '../src/nucleo/rotulos';
import type { Desenho, Primitiva } from '../src/nucleo/tipos';
import { montarRegiao, REGIOES } from '../scripts/gerar-regioes';

type Texto = Extract<Primitiva, { t: 'texto' }>;
const textos = (d: Desenho) => d.prims.filter((p): p is Texto => p.t === 'texto');

describe.each(REGIOES)('região $nome', ({ nome, ponto }) => {
  let d: Desenho;
  // carregar a base e compor leva de 1 a 4 s por região
  beforeAll(async () => {
    d = (await montarRegiao(nome, ponto)).desenho;
  }, 30000);

  test('compõe sem erro, com pelo menos 3 cidades e 3 rótulos de estrada', () => {
    expect(d).toBeDefined();
    expect(textos(d).filter((t) => t.id.startsWith('cidade:')).length).toBeGreaterThanOrEqual(3);
    // um rótulo por cadeia: a linha da distância (com ref) ou a única linha (sem ref)
    const rotulos = textos(d).filter((t) => t.id.startsWith('trecho:') && (t.id.endsWith(':km') || !t.txt.match(/^[A-Z]/)));
    expect(rotulos.length).toBeGreaterThanOrEqual(3);
    expect(d.prims.filter((p) => p.t === 'circulo' && p.camada === 'LOCAL_DA_OBRA')).toHaveLength(2);
  });

  test('tudo cabe no quadro', () => {
    const { w: W, h: H } = d.quadro;
    const dentro = (x: number, y: number) => x >= -1e-9 && x <= W + 1e-9 && y >= -1e-9 && y <= H + 1e-9;
    for (const p of d.prims) {
      if (p.t === 'linha') for (const [x, y] of p.pts) expect(dentro(x, y), `${p.camada} ${x},${y}`).toBe(true);
      if (p.t === 'circulo') {
        expect(dentro(p.centro[0] - p.r, p.centro[1] - p.r)).toBe(true);
        expect(dentro(p.centro[0] + p.r, p.centro[1] + p.r)).toBe(true);
      }
      if (p.t === 'texto') {
        const [x, y] = p.centro;
        const w = larguraTexto(p.txt, p.h) / 2;
        expect(dentro(x - w, y - p.h / 2) && dentro(x + w, y + p.h / 2), `${p.txt} em ${x},${y}`).toBe(true);
      }
    }
  });

  test('rótulo de estrada não fica em cima de outro texto', () => {
    // caixa de cada linha de texto: largura do Arial × altura do texto
    const caixa = (t: Texto) => {
      const w = larguraTexto(t.txt, t.h) / 2;
      return [t.centro[0] - w, t.centro[1] - t.h / 2, t.centro[0] + w, t.centro[1] + t.h / 2];
    };
    const ts = textos(d);
    for (const r of ts.filter((t) => t.id.startsWith('trecho:'))) {
      const [a0, b0, a1, b1] = caixa(r);
      const bloco = r.id.replace(/:km$/, '');
      for (const o of ts) {
        if (o.id.replace(/:km$/, '') === bloco) continue; // as duas linhas do mesmo rótulo
        const [c0, e0, c1, e1] = caixa(o);
        const cobre = Math.min(a1, c1) - Math.max(a0, c0) > 1e-6 && Math.min(b1, e1) - Math.max(b0, e0) > 1e-6;
        expect(cobre, `"${r.txt}" em cima de "${o.txt}"`).toBe(false);
      }
    }
  });
});
