// Junta as células de estradinhas baixadas do OSM, monta e grava public/base/estradinhas com um relatório.
// Uso: node scripts/base/gerar-terra.ts            (depois de baixar.ts estradinhas; aborta se faltar célula no cache)
//      node scripts/base/gerar-terra.ts --parcial   (gera mesmo com célula faltando; a saída NÃO serve para publicar)
// Para testar sem mexer nas pastas de verdade: BASE_TERRA_CACHE=pasta BASE_TERRA_SAIDA=pasta
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { caixaDaCelula, caixasSeTocam } from '../../src/nucleo/base.ts';
import { nomeDaCelulaTerra, paraArquivo, type EstradinhaArquivo, type IndiceTerra } from '../../src/nucleo/estradinhas.ts';
import type { Janela } from '../../src/nucleo/tipos.ts';
import { GRADE } from './montar.ts';
import { CELULA_BAIXAR_TERRA, CELULA_SAIDA_TERRA, montarTerra } from './montar-terra.ts';

const TOLERANCIA = 3; // metros; sobe para 6 se public/base/estradinhas passar de 120 MB ou alguma célula de 1,5 MB
const RAIZ = resolve(import.meta.dirname, '../..');
const CACHE = process.env.BASE_TERRA_CACHE ?? join(RAIZ, 'base-cache', 'osm-terra');
const SAIDA = process.env.BASE_TERRA_SAIDA ?? join(RAIZ, 'public', 'base', 'estradinhas');
const PARCIAL = process.argv.includes('--parcial');

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
  if (!PARCIAL) {
    console.log('Nada foi apagado nem gravado. Espere o download terminar, ou use --parcial para gerar só com o que há.');
    process.exit(1);
  }
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
// índice espacial: baldes de 10 km em UTM apontando para as células de 0,1° cuja caixa passa por eles
const BALDE = 10000;
const caixasDasCelulas: { col: number; lin: number; caixa: Janela }[] = [];
const baldes = new Map<string, number[]>();
for (let lin = 0; lin < indice.linhas; lin++) {
  for (let col = 0; col < indice.colunas; col++) {
    const caixa = caixaDaCelula(indice, col, lin);
    const n = caixasDasCelulas.push({ col, lin, caixa }) - 1;
    for (let bx = Math.floor(caixa.x0 / BALDE); bx <= Math.floor(caixa.x1 / BALDE); bx++) {
      for (let by = Math.floor(caixa.y0 / BALDE); by <= Math.floor(caixa.y1 / BALDE); by++) {
        const chave = `${bx},${by}`;
        if (!baldes.has(chave)) baldes.set(chave, []);
        baldes.get(chave)!.push(n);
      }
    }
  }
}
const porCelula = new Map<number, EstradinhaArquivo[]>();
for (const e of estradinhas) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of e.pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const caixa: Janela = { x0, y0, x1, y1 };
  const candidatas = new Set<number>();
  for (let bx = Math.floor(x0 / BALDE); bx <= Math.floor(x1 / BALDE); bx++) {
    for (let by = Math.floor(y0 / BALDE); by <= Math.floor(y1 / BALDE); by++) {
      for (const n of baldes.get(`${bx},${by}`) ?? []) candidatas.add(n);
    }
  }
  const arquivo = paraArquivo(e);
  for (const n of candidatas) {
    if (!caixasSeTocam(caixa, caixasDasCelulas[n].caixa)) continue;
    if (!porCelula.has(n)) porCelula.set(n, []);
    porCelula.get(n)!.push(arquivo);
  }
}

rmSync(SAIDA, { recursive: true, force: true });
mkdirSync(SAIDA, { recursive: true });
const tamanhos: [string, number][] = [];
const gravar = (relativo: string, dados: unknown) => {
  const arquivo = join(SAIDA, relativo.replace(/^estradinhas\//, ''));
  writeFileSync(arquivo, JSON.stringify(dados));
  return statSync(arquivo).size;
};
for (let n = 0; n < caixasDasCelulas.length; n++) {
  const celula = porCelula.get(n);
  if (!celula) continue;
  const nome = nomeDaCelulaTerra(caixasDasCelulas[n].col, caixasDasCelulas[n].lin);
  indice.cheias.push(nome);
  tamanhos.push([nome, gravar(nome, celula)]);
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
