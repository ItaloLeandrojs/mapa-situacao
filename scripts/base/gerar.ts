// Junta as células baixadas do OSM, monta a base e grava public/base com um relatório.
// Uso: node scripts/base/gerar.ts   (depois de baixar.ts e ibge.ts)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  caixaDaCelula,
  caixasSeTocam,
  nomeDaCelula,
  type ArestaArquivo,
  type CelulaArquivo,
  type CidadeArquivo,
  type Indice,
  type NoArquivo,
} from '../../src/nucleo/base.ts';
import type { Aresta, Janela } from '../../src/nucleo/tipos.ts';
import { GRADE, montarBase, normalizar, type Ajustes, type Ibge } from './montar.ts';

const TOLERANCIA = 10; // metros; sobe para 20 se public/base passar de 40 MB
const RAIZ = resolve(import.meta.dirname, '../..');
const CACHE = join(RAIZ, 'base-cache');
const SAIDA = join(RAIZ, 'public', 'base');
const lerJson = (arquivo: string) => JSON.parse(readFileSync(arquivo, 'utf8'));

// 1. junta as células do cache (elemento repetido entre células entra uma vez)
const elementos = new Map<string, any>();
const faltando: string[] = [];
let dataOsm = '';
for (let lin = 0; lin < GRADE.linhas; lin++) {
  for (let col = 0; col < GRADE.colunas; col++) {
    const arquivo = join(CACHE, 'osm', `c${col}_l${lin}.json`);
    if (!existsSync(arquivo)) {
      faltando.push(`c${col}_l${lin}`);
      continue;
    }
    const osm = lerJson(arquivo);
    for (const e of osm.elements) elementos.set(`${e.type}/${e.id}`, e);
    const data = String(osm.osm3s?.timestamp_osm_base ?? '').slice(0, 10);
    if (data && (!dataOsm || data < dataOsm)) dataOsm = data; // a célula mais antiga
  }
}
if (faltando.length) throw new Error(`Faltam células no cache (rode base:baixar): ${faltando.join(', ')}`);

// 2. monta a base
const ibge: Ibge = lerJson(join(CACHE, 'ibge.json'));
const ceara: string[] = lerJson(join(CACHE, 'ibge-ce.json'));
const ajustes: Ajustes = lerJson(join(import.meta.dirname, 'ajustes-lugares.json'));
const base = montarBase({ elements: [...elementos.values()] }, ibge, ajustes, TOLERANCIA);

// 3. reparte as arestas pelas células que a caixa delas toca
const indice: Indice = { data: dataOsm || new Date().toISOString().slice(0, 10), ...GRADE };
const coordNo = new Map(base.nos.map(([id, x, y]) => [id, [x, y]]));
const caixaDaAresta = (a: Aresta): Janela => {
  const xs = a.pts.map((p) => p[0]);
  const ys = a.pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const caixas = base.arestas.map(caixaDaAresta);
const gravar = (relativo: string, dados: unknown) => {
  const arquivo = join(SAIDA, relativo);
  writeFileSync(arquivo, JSON.stringify(dados));
  return statSync(arquivo).size;
};
mkdirSync(join(SAIDA, 'rodovias'), { recursive: true });

const tamanhos: [string, number][] = [];
for (let lin = 0; lin < GRADE.linhas; lin++) {
  for (let col = 0; col < GRADE.colunas; col++) {
    const caixa = caixaDaCelula(indice, col, lin);
    const celula: CelulaArquivo = { nos: [], arestas: [] };
    const nosDaCelula = new Set<number>();
    base.arestas.forEach((a, k) => {
      if (!caixasSeTocam(caixas[k], caixa)) return;
      nosDaCelula.add(a.a).add(a.b);
      const plano = a.pts.flatMap((p) => [Math.round(p[0]), Math.round(p[1])]);
      celula.arestas.push([a.id, a.a, a.b, a.ref, a.classe, Math.round(a.m), plano] satisfies ArestaArquivo);
    });
    for (const id of nosDaCelula) {
      const [x, y] = coordNo.get(id)!;
      celula.nos.push([id, Math.round(x), Math.round(y)] satisfies NoArquivo);
    }
    tamanhos.push([nomeDaCelula(col, lin), gravar(nomeDaCelula(col, lin), celula)]);
  }
}
const cidades: CidadeArquivo[] = base.lugares.map((l) => ({
  n: l.nome,
  t: l.tipo,
  o: l.osm,
  x: Math.round(l.ponto[0]),
  y: Math.round(l.ponto[1]),
}));
tamanhos.push(['cidades.json', gravar('cidades.json', cidades)]);
tamanhos.push(['indice.json', gravar('indice.json', indice)]);

// 4. relatório
const mb = (b: number) => `${(b / 1e6).toFixed(2)} MB`;
const sedes = base.lugares.filter((l) => l.tipo === 'sede');
const contagem = new Map<string, number>();
for (const l of sedes) contagem.set(normalizar(l.nome), (contagem.get(normalizar(l.nome)) ?? 0) + 1);
const semPonto = ceara.filter((m) => !contagem.has(normalizar(m)));
const repetidos = [...contagem].filter(([, n]) => n > 1).map(([nome, n]) => `${nome} (${n})`);
const total = tamanhos.reduce((s, [, b]) => s + b, 0);

console.log(`Data dos dados do OSM: ${indice.data} | tolerância: ${TOLERANCIA} m`);
console.log(`Elementos do OSM juntados: ${elementos.size}`);
console.log(`Arestas: ${base.arestas.length} | nós: ${base.nos.length}`);
console.log(`Lugares: ${base.lugares.length} (${sedes.length} sedes, ${base.lugares.length - sedes.length} distritos)`);
console.log('Tamanho de cada arquivo:');
for (const [nome, b] of tamanhos) console.log(`  ${nome}: ${mb(b)}`);
console.log(`Total de public/base: ${mb(total)}${total > 40e6 ? ' (PASSOU DE 40 MB)' : ''}`);
console.log(`Municípios do Ceará com sede achada: ${ceara.length - semPonto.length} de ${ceara.length}`);
console.log(`Municípios do Ceará sem ponto no OSM (${semPonto.length}): ${semPonto.join(', ') || 'nenhum'}`);
console.log(`Nomes de sede repetidos (${repetidos.length}): ${repetidos.join(', ') || 'nenhum'}`);
