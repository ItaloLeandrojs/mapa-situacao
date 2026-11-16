// Conferência em seis regiões do Ceará com a base de verdade (public/base): para cada ponto, uma rota curta
// sintética sobre a rodovia da base mais perto (com o alfinete OBRA na ponta), área proposta e composição.
// Grava DXF e imagem em dist-teste/regioes/.
// Uso: node scripts/gerar-regioes.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lugaresLigadosDePartida, proporArea } from '../src/nucleo/area.ts';
import { carregarBase, type Buscar } from '../src/nucleo/base.ts';
import { compor, type Entrada } from '../src/nucleo/compor.ts';
import { paraDxf } from '../src/nucleo/dxf.ts';
import { escolherObra } from '../src/nucleo/obra.ts';
import type { ArquivoGoogle, Base, Desenho, Janela, Pt } from '../src/nucleo/tipos.ts';

const RAIZ = resolve(import.meta.dirname, '..');
const PASTA_BASE = join(RAIZ, 'public', 'base');
const QUADRO = { w: 124.6, h: 113 };
const ALCANCE_SAIDAS = 80000; // m, como na tela (src/tela/estado.ts)
const MARGEM_CARGA = 100000; // m, como na tela
const ROTA_M = 4000; // comprimento da rota sintética

// pontos aproximados perto das cidades (UTM 24S); nenhum é obra de verdade
export const REGIOES: { nome: string; ponto: Pt }[] = [
  { nome: 'sobral', ponto: [354400, 9592700] },
  { nome: 'crateus', ponto: [314900, 9423400] },
  { nome: 'iguatu', ponto: [467100, 9301800] },
  { nome: 'russas', ponto: [608300, 9454400] },
  { nome: 'baturite', ponto: [513100, 9525500] },
  { nome: 'caucaia', ponto: [533400, 9587300] },
];

const buscar: Buscar = async (caminho) => JSON.parse(readFileSync(join(PASTA_BASE, caminho), 'utf8'));
const crescer = (j: Janela, m: number): Janela => ({ x0: j.x0 - m, y0: j.y0 - m, x1: j.x1 + m, y1: j.y1 + m });
const caixaDoPonto = (p: Pt, m: number): Janela => ({ x0: p[0] - m, y0: p[1] - m, x1: p[0] + m, y1: p[1] + m });
const contem = (fora: Janela, dentro: Janela) =>
  fora.x0 <= dentro.x0 && fora.y0 <= dentro.y0 && fora.x1 >= dentro.x1 && fora.y1 >= dentro.y1;
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// pedaço de ROTA_M da rodovia com ref mais perto do ponto, terminando no vértice dela mais perto do ponto
export function rotaSintetica(base: Base, p: Pt): Pt[] {
  let melhor = { d: Infinity, pts: [] as Pt[], k: 0 };
  for (const a of base.arestas) {
    if (!a.ref) continue;
    a.pts.forEach((q, k) => {
      const d = dist(q, p);
      if (d < melhor.d) melhor = { d, pts: a.pts, k };
    });
  }
  const { pts, k } = melhor;
  // anda para o lado da aresta que tem mais estrada
  const passo = k >= pts.length - 1 - k ? -1 : 1;
  const rota: Pt[] = [pts[k]];
  let andado = 0;
  for (let i = k + passo; i >= 0 && i < pts.length && andado < ROTA_M; i += passo) {
    andado += dist(pts[i], rota[rota.length - 1]);
    rota.push(pts[i]);
  }
  return rota.reverse(); // a obra fica na ponta final
}

export interface Regiao { nome: string; entrada: Entrada; desenho: Desenho }

export async function montarRegiao(nome: string, ponto: Pt): Promise<Regiao> {
  // como a tela: base com 100 km de margem em volta do que a área proposta pode alcançar
  let alvo = crescer(caixaDoPonto(ponto, ROTA_M), ALCANCE_SAIDAS);
  let base = await carregarBase(alvo, buscar, MARGEM_CARGA);
  const rota = rotaSintetica(base, ponto);
  const arquivo: ArquivoGoogle = {
    caminhos: [{ nome: 'ROTA', pontos: rota }],
    alfinetes: [{ nome: 'OBRA', ponto: rota[rota.length - 1] }],
  };
  const obra = escolherObra(arquivo)!.ponto;
  const janela = proporArea(obra, [rota], base.lugares, QUADRO);
  if (!contem(crescer(alvo, MARGEM_CARGA), crescer(janela, ALCANCE_SAIDAS))) {
    alvo = janela;
    base = await carregarBase(alvo, buscar, MARGEM_CARGA);
  }
  const entrada: Entrada = {
    base, arquivo, obra, janela, quadro: QUADRO,
    ligados: lugaresLigadosDePartida(base.lugares, janela), ajustes: {}, credito: false,
  };
  return { nome, entrada, desenho: compor(entrada) };
}

async function principal() {
  const pasta = join(RAIZ, 'dist-teste', 'regioes');
  mkdirSync(pasta, { recursive: true });
  for (const r of REGIOES) {
    const { desenho } = await montarRegiao(r.nome, r.ponto);
    const dxf = join(pasta, `${r.nome}.dxf`);
    writeFileSync(dxf, paraDxf(desenho));
    execFileSync('python', [join(RAIZ, 'scripts', 'imagem-dxf.py'), dxf, join(pasta, `${r.nome}.png`)]);
    console.log(`${dxf}: ${desenho.prims.length} primitivas`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
