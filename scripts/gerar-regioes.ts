// Conferência em seis regiões do Ceará com a base de verdade (public/base): para cada ponto, uma rota curta
// sintética sobre a rodovia da base mais perto (com o alfinete OBRA na ponta), área proposta e composição.
// Cada região tem dois casos: <nome> (obra na beira da rodovia, sem detalhe) e <nome>-detalhe (obra na ponta de
// uma estradinha da base, a 1 a 2 km da rodovia, com o DETALHE DA CHEGADA e o caminho riscado por ela).
// Grava DXF e imagem em dist-teste/regioes/.
// Uso: node scripts/gerar-regioes.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lugaresLigadosDePartida, proporArea } from '../src/nucleo/area.ts';
import { carregarBase, type Buscar } from '../src/nucleo/base.ts';
import { caminhoRiscado, type Chegada } from '../src/nucleo/chegada.ts';
import { compor, type Entrada } from '../src/nucleo/compor.ts';
import { cantoMaisVazio, comporDetalhe, proporJanelaDetalhe, type EntradaDetalhe } from '../src/nucleo/detalhe.ts';
import { paraDxf } from '../src/nucleo/dxf.ts';
import { carregarEstradinhas } from '../src/nucleo/estradinhas.ts';
import { distanciaALinha, projetar } from '../src/nucleo/grafo.ts';
import { escolherObra } from '../src/nucleo/obra.ts';
import type { ArquivoGoogle, Base, Desenho, Estradinha, Janela, Primitiva, Pt } from '../src/nucleo/tipos.ts';

const RAIZ = resolve(import.meta.dirname, '..');
const PASTA_BASE = join(RAIZ, 'public', 'base');
const QUADRO = { w: 124.6, h: 113 };
const ALCANCE_SAIDAS = 80000; // m, como na tela (src/tela/estado.ts)
const MARGEM_CARGA = 100000; // m, como na tela
const ROTA_M = 4000; // comprimento da rota sintética
const ENCOSTA_NA_ROTA = 30; // m: a ponta da estradinha a até isso da rota "encosta" nela (a entrada do caminho)
const AFASTADA_MIN = 1000; // m: a outra ponta da estradinha (a obra) fica de 1 a 2 km da rodovia mais perto
const AFASTADA_MAX = 2000;
const AFASTADA_ALVO = 1500; // m: dentro da faixa, a que fica mais perto disso
const AFASTADA_RELAXADA = 1000; // m: sem nenhuma na faixa, a mais perto disso (e a mais de NA_BEIRA)
const NA_BEIRA = 200; // m, como em src/nucleo/chegada.ts
const MARGEM_TERRA = 8000; // m de estradinhas em volta do caminho (o lado maior da janela do detalhe)
const BUSCA_AFASTADA = 20000; // m: até onde se procura, em volta do ponto da região, a estradinha da obra afastada

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
// distância de p à linha mais perto; pula as linhas cuja caixa já fica mais longe que a melhor achada (são milhares)
const caixasDas = new WeakMap<Pt[][], { x0: number; y0: number; x1: number; y1: number; pts: Pt[] }[]>();
function ateLinhas(linhas: Pt[][], p: Pt): number {
  let caixas = caixasDas.get(linhas);
  if (!caixas) {
    caixas = linhas.map((pts) => ({ pts, ...caixaDe(pts) }));
    caixasDas.set(linhas, caixas);
  }
  let menor = Infinity;
  for (const c of caixas) {
    if (Math.hypot(Math.max(c.x0 - p[0], 0, p[0] - c.x1), Math.max(c.y0 - p[1], 0, p[1] - c.y1)) >= menor) continue;
    menor = Math.min(menor, distanciaALinha(p, c.pts));
  }
  return menor;
}
const caixaDe = (pts: Pt[]): Janela => ({
  x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])),
});

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

export interface Afastada { estradinha: Estradinha; pts: Pt[]; encontro: Pt; rota: Pt[]; distancia: number; relaxada: boolean }

// A rota sintética do caso afastado: pedaço de até ROTA_M da rodovia com ref mais perto de q, terminando em q (o
// encontro da estradinha com a rodovia, que cai no meio de um segmento). Devolve também q.
export function rotaAte(base: Base, p: Pt): { rota: Pt[]; q: Pt } {
  let melhor = { d: Infinity, pts: [] as Pt[], k: 1, q: p };
  for (const a of base.arestas) {
    if (!a.ref) continue;
    for (let k = 1; k < a.pts.length; k++) {
      const q = projetar(p, a.pts[k - 1], a.pts[k]).q;
      if (dist(q, p) < melhor.d) melhor = { d: dist(q, p), pts: a.pts, k, q };
    }
  }
  const { pts, k, q } = melhor;
  const lado = (vizinhos: Pt[]): Pt[] => {
    const r: Pt[] = [q];
    let andado = 0;
    for (const v of vizinhos) {
      if (andado >= ROTA_M) break;
      andado += dist(v, r[r.length - 1]);
      r.push(v);
    }
    return r;
  };
  const atras = lado(pts.slice(0, k).reverse()); // do encontro para o começo da aresta
  const frente = lado(pts.slice(k)); // do encontro para o fim da aresta
  const comp = (l: Pt[]) => l.reduce((s, v, i) => (i ? s + dist(l[i - 1], v) : 0), 0);
  const maior = comp(frente) > comp(atras) ? frente : atras;
  return { rota: maior.reverse(), q }; // o encontro fica na ponta final
}

// A estradinha da obra afastada, por critério (sem coordenada tirada à mão), entre as de `terra`: uma ponta (a
// entrada) a até ENCOSTA_NA_ROTA de uma rodovia com ref da base e a outra ponta (a obra) de 1 a 2 km da rodovia
// mais perto da base; entre elas, a de entrada mais perto do ponto da região (empate: menor id). Sem nenhuma na
// faixa de 1 a 2 km, relaxa: a de obra mais perto de 1 km da rodovia (e a mais de NA_BEIRA, senão o detalhe nem
// existiria). Devolve a polilinha da entrada até a obra e a rota sintética até o encontro.
export function escolherAfastada(base: Base, terra: Estradinha[], ponto: Pt): Afastada | null {
  // só as rodovias perto da região (a base vem com 100 km de margem): a distância até a rodovia só importa até 2 km
  const perto = caixaDoPonto(ponto, BUSCA_AFASTADA + 2 * AFASTADA_MAX);
  const daRegiao = base.arestas.filter((a) => {
    const c = caixaDe(a.pts);
    return c.x0 <= perto.x1 && c.x1 >= perto.x0 && c.y0 <= perto.y1 && c.y1 >= perto.y0;
  });
  const rodovias = daRegiao.map((a) => a.pts);
  const comRef = daRegiao.filter((a) => a.ref).map((a) => a.pts);
  const candidatas = terra.flatMap((e) => {
    const sentidos: Pt[][] = [];
    if (ateLinhas(comRef, e.pts[0]) <= ENCOSTA_NA_ROTA) sentidos.push(e.pts);
    if (ateLinhas(comRef, e.pts[e.pts.length - 1]) <= ENCOSTA_NA_ROTA) sentidos.push([...e.pts].reverse());
    return sentidos.map((pts) => ({ estradinha: e, pts, distancia: ateLinhas(rodovias, pts[pts.length - 1]) }));
  }).filter((c) => c.distancia > NA_BEIRA);
  const naFaixa = candidatas.filter((c) => c.distancia >= AFASTADA_MIN && c.distancia <= AFASTADA_MAX);
  const relaxada = naFaixa.length === 0;
  const lista = relaxada ? candidatas : naFaixa;
  if (lista.length === 0) return null;
  // nota: menor é melhor
  const nota = (c: (typeof lista)[number]) => (relaxada ? Math.abs(c.distancia - AFASTADA_RELAXADA) : dist(c.pts[0], ponto));
  const escolhida = lista.reduce((a, b) => {
    const [na, nb] = [nota(a), nota(b)];
    return nb < na || (nb === na && b.estradinha.id < a.estradinha.id) ? b : a;
  });
  const { rota, q } = rotaAte(base, escolhida.pts[0]);
  return { ...escolhida, encontro: q, rota, relaxada };
}

export interface RegiaoDetalhe extends Regiao {
  afastada: Afastada; chegada: Chegada; detalhe: Primitiva[]; // detalhe: as primitivas do quadrinho (o fim do desenho)
}

// A rota sintética até a estradinha escolhida, riscada como caminho de terra com o alfinete OBRA na ponta dela.
// A orquestração do detalhe é a da tela para obra nova: caminho riscado, janela proposta, canto mais vazio.
export async function montarRegiaoDetalhe(nome: string, ponto: Pt): Promise<RegiaoDetalhe> {
  const volta = crescer(caixaDoPonto(ponto, BUSCA_AFASTADA), ALCANCE_SAIDAS);
  let base = await carregarBase(volta, buscar, MARGEM_CARGA);
  const terra = await carregarEstradinhas(caixaDoPonto(ponto, BUSCA_AFASTADA), buscar);
  const afastada = escolherAfastada(base, terra, ponto);
  if (!afastada) throw new Error(`${nome}: nenhuma estradinha da base encosta numa rodovia e termina a mais de ${NA_BEIRA} m dela`);
  const obra = afastada.pts[afastada.pts.length - 1];
  const arquivo: ArquivoGoogle = {
    caminhos: [{ nome: 'ROTA', pontos: afastada.rota }, { nome: 'Terra', pontos: [afastada.encontro, ...afastada.pts] }],
    alfinetes: [{ nome: 'OBRA', ponto: obra }],
  };
  const rota = arquivo.caminhos.map((c) => c.pontos);
  const janela = proporArea(obra, rota, base.lugares, QUADRO);
  if (!contem(crescer(volta, MARGEM_CARGA), crescer(janela, ALCANCE_SAIDAS))) {
    base = await carregarBase(janela, buscar, MARGEM_CARGA);
  }
  const ligados = lugaresLigadosDePartida(base.lugares, janela);
  const chegada = caminhoRiscado(base, obra, rota);
  if (!chegada) throw new Error(`${nome}: o caminho riscado não saiu da base`);
  const terraDetalhe = await carregarEstradinhas(crescer(caixaDe([obra, ...chegada.caminho]), MARGEM_TERRA), buscar);
  const canto = cantoMaisVazio(base, janela, QUADRO, obra, rota, ligados);
  const detalhe: EntradaDetalhe = {
    terra: terraDetalhe, chegada,
    opcoes: { canto, janela: proporJanelaDetalhe(obra, chegada, chegada.entrada, QUADRO), viradasDesligadas: [], refsDesligadas: [], sugestaoPendente: false },
  };
  const entrada: Entrada = { base, arquivo, obra, janela, quadro: QUADRO, ligados, ajustes: {}, credito: false, detalhe };
  const desenho = compor(entrada);
  const n = comporDetalhe({ base, obra, alfinetes: arquivo.alfinetes, ligados, quadro: QUADRO, detalhe }).length;
  return { nome: `${nome}-detalhe`, entrada, desenho, afastada, chegada, detalhe: desenho.prims.slice(-n) };
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
    const d = await montarRegiaoDetalhe(r.nome, r.ponto);
    const dxfD = join(pasta, `${d.nome}.dxf`);
    writeFileSync(dxfD, paraDxf(d.desenho));
    execFileSync('python', [join(RAIZ, 'scripts', 'imagem-dxf.py'), dxfD, join(pasta, `${d.nome}.png`)]);
    const a = d.afastada;
    console.log(`${dxfD}: ${d.desenho.prims.length} primitivas; estradinha ${a.estradinha.id}, ponta a ${Math.round(a.distancia)} m da rodovia${a.relaxada ? ' (RELAXADA)' : ''}, caminho ${d.chegada.metros} m`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
