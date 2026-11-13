import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { montarBase, type Ibge } from '../../scripts/base/montar';
import type { Base, Janela, Pt, PtU } from '../../src/nucleo/tipos';

// mapa aprovado (v4, teste da CE-397 no Cariri)
export const JANELA_V4: Janela = { x0: 460295.86, y0: 9153272.74, x1: 511041.06, y1: 9207456.95 };
export const OBRA_V4: Pt = [492399.97, 9166630.19];

// nomes como saem na base (maiúsculas com acento); Jamacaru é distrito, as outras são sedes
export const CIDADES_V4 = [
  'JUAZEIRO DO NORTE',
  'BARBALHA',
  'MISSÃO VELHA',
  'MILAGRES',
  'ABAIARA',
  'JAMACARU',
  'BREJO SANTO',
  'PORTEIRAS',
  'JARDIM',
];

// [ref, km] das cadeias rotuladas na v4
export const CADEIAS_V4: [string, number][] = [
  ['CE-060', 36.5], ['CE-397', 26.4], ['CE-153', 20], ['CE-292', 18.9], ['CE-293', 17.3], ['CE-293', 13.9],
  ['CE-397', 12.7], ['CE-153', 12.5], ['CE-060', 12.2], ['', 11.5], ['BR-116', 10.9], ['BR-116', 10.5], ['CE-153', 10],
  ['CE-293', 9.7], ['CE-393', 8.6], ['CE-393', 6.7], ['CE-293', 5.2], ['CE-397', 4.4], ['CE-293', 3.9],
];

// centro de cada cidade na prancha da v4 (unidade da prancha)
export const CENTROS_CIDADES_V4: Record<string, PtU> = {
  BARBALHA: [34.59, 71.15],
  'JUAZEIRO DO NORTE': [36.13, 92.76],
  'MISSÃO VELHA': [58.67, 86.04],
  MILAGRES: [98.45, 74.11],
  ABAIARA: [78.1, 58.98],
  'BREJO SANTO': [98.01, 36.14],
  JARDIM: [32.98, 20.58],
  PORTEIRAS: [58.34, 27.68],
  JAMACARU: [68.67, 52.08],
};

const lerFixture = (nome: string) => JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', nome), 'utf8'));

// base do Cariri no formato que o núcleo recebe
export function baseCariri(tolerancia: number): Base {
  const ibge: Ibge = lerFixture('ibge-cariri.json');
  const b = montarBase(lerFixture('osm-cariri.json'), ibge, { remover: [], forcarSede: [], acrescentar: [] }, tolerancia);
  return {
    data: 'teste',
    nos: new Map(b.nos.map(([id, x, y]) => [id, [x, y] as Pt])),
    arestas: b.arestas,
    lugares: b.lugares,
  };
}
