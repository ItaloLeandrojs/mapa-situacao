// Junta as células de estradinhas baixadas do OSM, monta e grava public/base/estradinhas com um relatório.
// Uso: node scripts/base/gerar-terra.ts   (depois de baixar.ts estradinhas)
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { caixaDaCelula, caixasSeTocam } from '../../src/nucleo/base.ts';
import { nomeDaCelulaTerra, paraArquivo, type EstradinhaArquivo, type IndiceTerra } from '../../src/nucleo/estradinhas.ts';
import { GRADE } from './montar.ts';
import { CELULA_BAIXAR_TERRA, CELULA_SAIDA_TERRA, montarTerra } from './montar-terra.ts';

const TOLERANCIA = 3; // metros; sobe para 6 se public/base/estradinhas passar de 120 MB ou alguma célula de 1,5 MB
const RAIZ = resolve(import.meta.dirname, '../..');
const CACHE = join(RAIZ, 'base-cache', 'osm-terra');
const SAIDA = join(RAIZ, 'public', 'base', 'estradinhas');

// 1. junta as células do cache; way e nó repetidos entre células entram uma vez (nó só com id, lon e lat para poupar memória)
const vias = new Map<number, any>();
const nos = new Map<number, { type: 'node'; id: number; lon: number; lat: number }>();
const colunas = Math.round((GRADE.colunas * GRADE.celula) / CELULA_BAIXAR_TERRA);
const linhas = Math.round((GRADE.linhas * GRADE.celula) / CELULA_BAIXAR_TERRA);
const faltando: string[] = [];
let dataOsm = '';
for (let lin = 0; lin < linhas; lin++) {
  for (let col = 0; col < colunas; col++) {
    const arquivo = join(CACHE, `c${col}_l${lin}.json`);
    if (!existsSync(arquivo)) {
      faltando.push(`c${col}_l${lin}`);
      continue;
    }
    const osm = JSON.parse(readFileSync(arquivo, 'utf8'));
    for (const e of osm.elements) {
      if (e.type === 'way') vias.set(e.id, e);
      else if (e.type === 'node') nos.set(e.id, { type: 'node', id: e.id, lon: e.lon, lat: e.lat });
    }
    const data = String(osm.osm3s?.timestamp_osm_base ?? '').slice(0, 10);
    if (data && (!dataOsm || data < dataOsm)) dataOsm = data; // a célula mais antiga
  }
}
const lidas = colunas * linhas - faltando.length;
console.log(`Células do cache lidas: ${lidas} de ${colunas * linhas}`);
if (faltando.length) {
  console.log(`ATENÇÃO: faltam ${faltando.length} células (rode base:baixar-terra): ${faltando.slice(0, 20).join(', ')}${faltando.length > 20 ? '...' : ''}`);
  process.exitCode = 1;
}

// 2. monta
const estradinhas = montarTerra({ elements: [...vias.values(), ...nos.values()] }, TOLERANCIA);

// 3. reparte pelas células de 0,1° que a caixa de cada estradinha toca
const indice: IndiceTerra = {
  data: dataOsm || new Date().toISOString().slice(0, 10),
  celula: CELULA_SAIDA_TERRA,
  oeste: GRADE.oeste,
  sul: GRADE.sul,
  colunas: Math.round((GRADE.colunas * GRADE.celula) / CELULA_SAIDA_TERRA),
  linhas: Math.round((GRADE.linhas * GRADE.celula) / CELULA_SAIDA_TERRA),
  cheias: [],
};
const caixas = new Float64Array(estradinhas.length * 4);
estradinhas.forEach((e, k) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of e.pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  caixas.set([x0, y0, x1, y1], k * 4);
});

rmSync(SAIDA, { recursive: true, force: true });
mkdirSync(SAIDA, { recursive: true });
const tamanhos: [string, number][] = [];
const gravar = (relativo: string, dados: unknown) => {
  const arquivo = join(resolve(SAIDA, '..'), relativo);
  writeFileSync(arquivo, JSON.stringify(dados));
  return statSync(arquivo).size;
};
for (let lin = 0; lin < indice.linhas; lin++) {
  for (let col = 0; col < indice.colunas; col++) {
    const c = caixaDaCelula(indice, col, lin);
    const celula: EstradinhaArquivo[] = [];
    for (let k = 0; k < estradinhas.length; k++) {
      const caixa = { x0: caixas[k * 4], y0: caixas[k * 4 + 1], x1: caixas[k * 4 + 2], y1: caixas[k * 4 + 3] };
      if (caixasSeTocam(caixa, c)) celula.push(paraArquivo(estradinhas[k]));
    }
    if (!celula.length) continue;
    const nome = nomeDaCelulaTerra(col, lin);
    indice.cheias.push(nome);
    tamanhos.push([nome, gravar(nome, celula)]);
  }
}
tamanhos.push(['indice.json', gravar('estradinhas/indice.json', indice)]);

// 4. relatório
const mb = (b: number) => `${(b / 1e6).toFixed(2)} MB`;
const total = tamanhos.reduce((s, [, b]) => s + b, 0);
const celulas = tamanhos.filter(([nome]) => nome !== 'indice.json').sort((p, q) => q[1] - p[1]);
const porClasse = (classe: string) => estradinhas.filter((e) => e.classe === classe).length;
console.log(`Data dos dados do OSM: ${indice.data} | tolerância: ${TOLERANCIA} m`);
console.log(`Ways juntados: ${vias.size} | nós: ${nos.size}`);
console.log(`Estradinhas: ${estradinhas.length} (track ${porClasse('track')}, unclassified ${porClasse('unclassified')}, residential ${porClasse('residential')})`);
console.log(`Células gravadas: ${celulas.length}`);
console.log(`Total de public/base/estradinhas: ${mb(total)}${total > 120e6 ? ' (PASSOU DE 120 MB)' : ''}`);
console.log(`Maior célula: ${celulas[0] ? `${celulas[0][0]} com ${mb(celulas[0][1])}${celulas[0][1] > 1.5e6 ? ' (PASSOU DE 1,5 MB)' : ''}` : 'nenhuma'}`);
