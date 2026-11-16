// conferência com a base de verdade (public/base) em seis regiões do Ceará, cada uma com uma rota curta
// sintética sobre a rodovia mais perto (scripts/gerar-regioes.ts)
import { MEDIDAS } from '../src/nucleo/medidas';
import { larguraTexto } from '../src/nucleo/rotulos';
import type { Desenho, Primitiva } from '../src/nucleo/tipos';
import { montarRegiao, REGIOES } from '../scripts/gerar-regioes';
import { encostaEm, PISTA_E_CAIXA, separados } from './fixtures/tinta';

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

  // caixa de cada linha de texto: largura do Arial × altura do texto
  const caixa = (t: Texto) => {
    const w = larguraTexto(t.txt, t.h) / 2;
    return [t.centro[0] - w, t.centro[1] - t.h / 2, t.centro[0] + w, t.centro[1] + t.h / 2];
  };
  const cobre = (r: Texto, o: Texto) => {
    const [a0, b0, a1, b1] = caixa(r);
    const [c0, e0, c1, e1] = caixa(o);
    return Math.min(a1, c1) - Math.max(a0, c0) > 1e-6 && Math.min(b1, e1) - Math.max(b0, e0) > 1e-6;
  };

  test('rótulo de estrada não fica em cima de outro texto', () => {
    const ts = textos(d);
    for (const r of ts.filter((t) => t.id.startsWith('trecho:'))) {
      const bloco = r.id.replace(/:km$/, '');
      for (const o of ts) {
        if (o.id.replace(/:km$/, '') === bloco) continue; // as duas linhas do mesmo rótulo
        expect(cobre(r, o), `"${r.txt}" em cima de "${o.txt}"`).toBe(false);
      }
    }
  });

  test('P/ CIDADE não fica em cima de outro texto', () => {
    const ts = textos(d);
    for (const r of ts.filter((t) => t.id.startsWith('saida:'))) {
      for (const o of ts) if (o !== r) expect(cobre(r, o), `"${r.txt}" em cima de "${o.txt}"`).toBe(false);
    }
  });

  test('rótulo de estrada não encosta em pista nem em caixa de cidade', () => {
    for (const r of textos(d).filter((t) => t.id.startsWith('trecho:'))) {
      expect(encostaEm(d, r, PISTA_E_CAIXA), `"${r.txt}" em cima de estrada ou caixa`).toBe(false);
    }
  });

  // P/ sem lugar livre até 4 linhas da saída (mais longe, o P/ parece de outra estrada): fica perto da saída, no
  // menos ruim, e pode encostar em estrada ou ficar perto de outro texto
  const SEM_LUGAR: Record<string, string[]> = {
    crateus: ['saida:TAMBORIL'], russas: ['saida:TABULEIRO DO NORTE'], baturite: ['saida:GUAIÚBA'],
    iguatu: ['saida:DEPUTADO IRAPUAN PINHEIRO'],
    caucaia: ['saida:SÃO GONÇALO DO AMARANTE', 'saida:SÃO GONÇALO DO AMARANTE:2'],
  };
  const semLugar = (t: Texto) => (SEM_LUGAR[nome] ?? []).includes(t.id);
  test('P/ CIDADE não encosta em estrada quando há lugar livre perto da saída', () => {
    for (const r of textos(d).filter((t) => t.id.startsWith('saida:'))) {
      if (semLugar(r)) continue;
      expect(encostaEm(d, r, PISTA_E_CAIXA), `"${r.txt}" em cima de estrada ou caixa`).toBe(false);
    }
  });

  // nome de cidade sem lugar livre nos 8 lugares de perto, nos anéis em volta da caixa nem entre os que só não
  // cobrem texto: fica no menos ruim e pode encostar em estrada ou em caixa (cada um com o motivo)
  const CIDADE_SEM_LUGAR: Record<string, string[]> = {};
  test('nome de cidade não encosta em pista nem em outra caixa quando há lugar livre', () => {
    for (const r of textos(d).filter((t) => t.id.startsWith('cidade:'))) {
      if ((CIDADE_SEM_LUGAR[nome] ?? []).includes(r.id)) continue;
      expect(encostaEm(d, r, PISTA_E_CAIXA), `"${r.txt}" em cima de estrada ou caixa`).toBe(false);
    }
  });

  // texto posto em lugar livre não fica colado em outro texto (pareceria um bloco só): rótulo de estrada, P/ e
  // LOCAL DA OBRA ficam a uma altura de texto de lado (uma e meia em cima e embaixo) de cidade, rótulo, P/ e obra
  // (menos os P/ sem lugar, que ficam onde der)
  test('texto em lugar livre fica separado dos outros', () => {
    const bloco = (t: Texto) => t.id.replace(/:km$/, '').replace(/^obra:.*/, 'obra');
    const ts = textos(d).filter((t) => /^(trecho|saida|cidade|obra):/.test(t.id) && !semLugar(t));
    for (const r of ts.filter((t) => !t.id.startsWith('cidade:'))) {
      for (const o of ts) {
        if (bloco(o) === bloco(r)) continue;
        expect(separados(r, o, MEDIDAS.texto), `"${r.txt}" colado em "${o.txt}"`).toBe(true);
      }
    }
  });

  test('LOCAL DA OBRA não encosta em pista nem em caixa de cidade', () => {
    for (const r of textos(d).filter((t) => t.camada === 'LOCAL_DA_OBRA')) {
      expect(encostaEm(d, r, PISTA_E_CAIXA), `"${r.txt}" em cima de estrada ou caixa`).toBe(false);
    }
  });
});
