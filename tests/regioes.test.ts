// conferência com a base de verdade (public/base) em seis regiões do Ceará, cada uma com uma rota curta
// sintética sobre a rodovia mais perto (scripts/gerar-regioes.ts), e o mesmo ponto com a obra afastada, no fim de
// uma estradinha da base, com o detalhe da chegada
import { caixaDoDetalhe } from '../src/nucleo/detalhe';
import { distanciaALinha } from '../src/nucleo/grafo';
import { MEDIDAS } from '../src/nucleo/medidas';
import { larguraTexto } from '../src/nucleo/rotulos';
import type { Desenho, Primitiva } from '../src/nucleo/tipos';
import { montarRegiao, montarRegiaoDetalhe, REGIOES } from '../scripts/gerar-regioes';
import { encostaEm, PISTA_E_CAIXA, separados } from './fixtures/tinta';

type Texto = Extract<Primitiva, { t: 'texto' }>;
const textos = (d: Desenho) => d.prims.filter((p): p is Texto => p.t === 'texto');

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

// ---- obra afastada: a obra no fim de uma estradinha da base, de 1 a 2 km da rodovia, com o caminho riscado por ela

describe.each(REGIOES)('região $nome, obra afastada com detalhe', ({ nome, ponto }) => {
  let r: Awaited<ReturnType<typeof montarRegiaoDetalhe>>;
  // escolher a estradinha numa janela de 40 km e compor leva até uns 10 s por região
  beforeAll(async () => {
    r = await montarRegiaoDetalhe(nome, ponto);
  }, 90000);

  test('a estradinha escolhida termina de 1 a 2 km da rodovia e o caminho vem riscado por ela', () => {
    expect(r.afastada.relaxada).toBe(false);
    expect(r.afastada.distancia).toBeGreaterThanOrEqual(1000);
    expect(r.afastada.distancia).toBeLessThanOrEqual(2000);
    expect(r.chegada.origem).toBe('riscado');
    expect(r.chegada.caminho[r.chegada.caminho.length - 1]).toEqual(r.entrada.obra);
  });

  test('o detalhe sai, com o título, a entrada e a obra', () => {
    const ids = textos({ quadro: r.desenho.quadro, prims: r.detalhe }).map((t) => t.id);
    expect(ids).toContain('detalhe:titulo');
    expect(ids).toContain('detalhe:entrada');
    expect(ids).toContain('detalhe:obra');
    expect(r.entrada.detalhe).toBeDefined();
  });

  test('tudo do detalhe fica dentro da caixa do quadrinho', () => {
    const [x0, y0, x1, y1] = caixaDoDetalhe(r.desenho.quadro, r.entrada.detalhe!.opcoes.canto);
    const dentro = (x: number, y: number) => x >= x0 - 1e-9 && x <= x1 + 1e-9 && y >= y0 - 1e-9 && y <= y1 + 1e-9;
    for (const p of r.detalhe) {
      if (p.t === 'linha') for (const [x, y] of p.pts) expect(dentro(x, y), `${p.camada} ${x},${y}`).toBe(true);
      if (p.t === 'circulo') {
        expect(dentro(p.centro[0] - p.r, p.centro[1] - p.r)).toBe(true);
        expect(dentro(p.centro[0] + p.r, p.centro[1] + p.r)).toBe(true);
      }
      if (p.t === 'texto') {
        const [a, b, c, e] = caixa(p);
        expect(dentro(a, b) && dentro(c, e), `${p.txt} em ${p.centro}`).toBe(true);
      }
    }
  });

  test('a ENTRADA fica a até 50 m de uma rodovia da base', () => {
    const { base } = r.entrada;
    const ate = base.arestas.reduce((m, a) => Math.min(m, distanciaALinha(r.chegada.entrada, a.pts)), Infinity);
    expect(ate).toBeLessThanOrEqual(50);
  });

  // a caixa do quadrinho, sem a margem, é só do detalhe: nenhum texto do mapa geral cai em cima dela
  test('nenhum texto do mapa geral cai dentro da caixa do detalhe', () => {
    const [x0, y0, x1, y1] = caixaDoDetalhe(r.desenho.quadro, r.entrada.detalhe!.opcoes.canto);
    const geral = textos({ quadro: r.desenho.quadro, prims: r.desenho.prims.slice(0, r.desenho.prims.length - r.detalhe.length) });
    for (const t of geral) {
      const [a, b, c, e] = caixa(t);
      expect(Math.min(c, x1) - Math.max(a, x0) > 1e-6 && Math.min(e, y1) - Math.max(b, y0) > 1e-6, `"${t.txt}" (${t.id}) na caixa do detalhe`).toBe(false);
    }
  });

  test('nenhum texto do detalhe fica em cima de outro', () => {
    const ts = textos({ quadro: r.desenho.quadro, prims: r.detalhe }).filter((t) => t.id.startsWith('detalhe:'));
    for (const [i, a] of ts.entries()) {
      for (const b of ts.slice(i + 1)) expect(cobre(a, b), `"${a.txt}" (${a.id}) em cima de "${b.txt}" (${b.id})`).toBe(false);
    }
  });
});
