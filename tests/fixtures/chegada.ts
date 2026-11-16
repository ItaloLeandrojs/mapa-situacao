import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { distanciaALinha, projetar } from '../../src/nucleo/grafo';
import { lerArquivoGoogle } from '../../src/nucleo/kml';
import type { ArquivoGoogle, Base, Estradinha, Pt } from '../../src/nucleo/tipos';
import { montarTerra } from '../../scripts/base/montar-terra';
import { baseCariri } from './v4';

const ler = (nome: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', nome));
const NA_RODOVIA = 30; // m: ponta de estradinha a até isso da CE-397 "encosta" nela
const LONGE_DA_BASE = 500; // m: outra ponta da estradinha escolhida fica pelo menos isso de qualquer aresta da base
const NA_BEIRA_DO_CASO = 200; // m (igual a NA_BEIRA de chegada.ts): abaixo disso a obra não teria detalhe

export const terraCariri = (): Estradinha[] => montarTerra(JSON.parse(ler('terra-cariri.json').toString('utf8')), 3);
export const rotaCe397 = (): ArquivoGoogle => lerArquivoGoogle(new Uint8Array(ler('ce397.kml')));

const comprimento = (pts: Pt[]) => pts.reduce((s, p, k) => (k ? s + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0), 0);
const ateBase = (base: Base, p: Pt) => base.arestas.reduce((m, a) => Math.min(m, distanciaALinha(p, a.pts)), Infinity);

export interface CasoAfastado {
  base: Base;
  terra: Estradinha[];
  arquivo: ArquivoGoogle;
  obra: Pt;
  rota: Pt[][];
  encontro: Pt; // onde o caminho riscado sai da CE-397
  estradinha: Estradinha; // a estradinha escolhida, da ponta na CE-397 para a outra ponta (a obra)
  distObraBase: number; // m da obra até a aresta mais perto da base
}

// Sintético, não é obra de verdade: a estradinha mais comprida que encosta na CE-397 (ponta a até 30 m dela e
// outra ponta a mais de 500 m de qualquer aresta da base, para a obra ficar de fato afastada). O caminho riscado
// vai do encontro com a CE-397 até a outra ponta; o alfinete OBRA fica nessa ponta.
export function casoAfastado(): CasoAfastado {
  const base = baseCariri(3);
  const terra = terraCariri();
  const ce397 = base.arestas.filter((a) => a.ref === 'CE-397');
  const ateCe397 = (p: Pt) => ce397.reduce((m, a) => Math.min(m, distanciaALinha(p, a.pts)), Infinity);
  const candidatas = terra.flatMap((e) => {
    const [ini, fim] = [e.pts[0], e.pts[e.pts.length - 1]];
    const sentidos: Pt[][] = [];
    if (ateCe397(ini) <= NA_RODOVIA) sentidos.push(e.pts);
    if (ateCe397(fim) <= NA_RODOVIA) sentidos.push([...e.pts].reverse());
    return sentidos
      .filter((pts) => ateBase(base, pts[pts.length - 1]) > LONGE_DA_BASE)
      .map((pts) => ({ e: { ...e, pts }, m: comprimento(pts) }));
  });
  if (candidatas.length === 0) throw new Error('fixture: nenhuma estradinha afastada encosta na CE-397');
  const { e: estradinha } = candidatas.reduce((a, b) => (b.m > a.m ? b : a));
  // encontro: ponto da CE-397 mais perto da ponta da estradinha
  let encontro: Pt = estradinha.pts[0];
  let menor = Infinity;
  for (const a of ce397) {
    for (let k = 1; k < a.pts.length; k++) {
      const q = projetar(estradinha.pts[0], a.pts[k - 1], a.pts[k]).q;
      const d = Math.hypot(q[0] - estradinha.pts[0][0], q[1] - estradinha.pts[0][1]);
      if (d < menor) [encontro, menor] = [q, d];
    }
  }
  const obra = estradinha.pts[estradinha.pts.length - 1];
  const rota = rotaCe397();
  const arquivo: ArquivoGoogle = {
    caminhos: [...rota.caminhos, { nome: 'Terra', pontos: [encontro, ...estradinha.pts] }],
    alfinetes: [{ nome: 'OBRA', ponto: obra }],
  };
  const distObraBase = ateBase(base, obra);
  if (distObraBase <= NA_BEIRA_DO_CASO) throw new Error('fixture: obra na beira da rodovia');
  return { base, terra, arquivo, obra, rota: arquivo.caminhos.map((c) => c.pontos), encontro, estradinha, distObraBase };
}

// o mesmo caso, sem o caminho de terra riscado (só a rota da CE-397)
export function semRiscado(): CasoAfastado {
  const c = casoAfastado();
  const arquivo: ArquivoGoogle = { caminhos: c.arquivo.caminhos.slice(0, 1), alfinetes: c.arquivo.alfinetes };
  return { ...c, arquivo, rota: arquivo.caminhos.map((x) => x.pontos) };
}
