// Baixa do IBGE os nomes de municípios e distritos do Ceará e dos estados vizinhos.
// Uso: node scripts/base/ibge.ts   (grava base-cache/ibge.json e base-cache/ibge-ce.json)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Ibge } from './montar.ts';

const PASTA = resolve(import.meta.dirname, '../../base-cache');
const UFS = [22, 23, 24, 25, 26]; // PI, CE, RN, PB, PE
const CEARA = 23;

async function nomes(uf: number, tipo: 'municipios' | 'distritos'): Promise<string[]> {
  const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/${tipo}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'mapa-situacao-base/1.0' }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const lista = (await r.json()) as { nome: string }[];
  return lista.map((l) => l.nome);
}

const emOrdem = (nomes: string[]) => nomes.sort((p, q) => p.localeCompare(q, 'pt-BR'));
const unicos = (nomes: string[]) => emOrdem([...new Set(nomes)]);
const ibge: Ibge = { municipios: [], distritos: [] };
let ceara: string[] = [];
for (const uf of UFS) {
  const municipios = await nomes(uf, 'municipios');
  const distritos = await nomes(uf, 'distritos');
  console.log(`UF ${uf}: ${municipios.length} municípios, ${distritos.length} distritos`);
  ibge.municipios.push(...municipios);
  ibge.distritos.push(...distritos);
  if (uf === CEARA) ceara = municipios;
}
// um município por entrada: nome repetido em outra UF fica repetido (é o teto de sedes com o nome)
ibge.municipios = emOrdem(ibge.municipios);
ibge.distritos = unicos(ibge.distritos);
mkdirSync(PASTA, { recursive: true });
writeFileSync(join(PASTA, 'ibge.json'), JSON.stringify(ibge, null, 1));
writeFileSync(join(PASTA, 'ibge-ce.json'), JSON.stringify(unicos(ceara), null, 1));
console.log(`Ceará: ${ceara.length} municípios${ceara.length === 184 ? '' : ' (esperado 184)'}`);
