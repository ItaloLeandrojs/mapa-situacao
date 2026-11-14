// Compõe o caso do teste de ouro (CE-397, Cariri, janela da v4) e grava dist-teste/ouro-ce397.dxf.
// Uso: node scripts/gerar-ouro.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Window } from 'happy-dom';
import { lugaresLigadosDePartida } from '../src/nucleo/area.ts';
import { compor } from '../src/nucleo/compor.ts';
import { paraDxf } from '../src/nucleo/dxf.ts';
import { lerArquivoGoogle } from '../src/nucleo/kml.ts';
import { escolherObra } from '../src/nucleo/obra.ts';
import type { Base, Janela, Pt } from '../src/nucleo/tipos.ts';
import { montarBase, type Ibge } from './base/montar.ts';

// R2: o núcleo usa o DOMParser global
(globalThis as { DOMParser?: unknown }).DOMParser = new Window().DOMParser;

const RAIZ = resolve(import.meta.dirname, '..');
const FIXTURES = join(RAIZ, 'tests', 'fixtures');
const lerJson = (nome: string) => JSON.parse(readFileSync(join(FIXTURES, nome), 'utf8'));

// mesma janela e mesma base do teste de ouro (tests/fixtures/v4.ts)
const JANELA_V4: Janela = { x0: 460295.86, y0: 9153272.74, x1: 511041.06, y1: 9207456.95 };
const ibge: Ibge = lerJson('ibge-cariri.json');
const m = montarBase(lerJson('osm-cariri.json'), ibge, { remover: [], forcarSede: [], acrescentar: [] }, 10);
const base: Base = { data: 'teste', nos: new Map(m.nos.map(([id, x, y]) => [id, [x, y] as Pt])), arestas: m.arestas, lugares: m.lugares };

const arquivo = lerArquivoGoogle(new Uint8Array(readFileSync(join(FIXTURES, 'ce397.kml'))));
const desenho = compor({
  base,
  arquivo,
  obra: escolherObra(arquivo)!.ponto,
  janela: JANELA_V4,
  quadro: { w: 124.6, h: 113 },
  ligados: lugaresLigadosDePartida(base.lugares, JANELA_V4),
  ajustes: {},
  credito: false,
});

mkdirSync(join(RAIZ, 'dist-teste'), { recursive: true });
const saida = join(RAIZ, 'dist-teste', 'ouro-ce397.dxf');
writeFileSync(saida, paraDxf(desenho));
console.log(`${saida}: ${desenho.prims.length} primitivas`);
