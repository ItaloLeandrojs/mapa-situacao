// Rascunho do "DETALHE DA CHEGADA" com a base de verdade (public/base e public/base/estradinhas), para conferir a
// olho. Compõe quatro casos e grava DXF e imagem em dist-teste/detalhe/:
//   afastado: o caso afastado do Cariri (rota da CE-397 + caminho de terra riscado + OBRA), como tests/fixtures/chegada.ts
//   sem-riscado: o mesmo, sem o caminho riscado, com o caminho sugerido aceito
//   caso-real: dist-teste/diag/caso.kmz, se existir (pasta ignorada)
//   sobral: obra sintética a 1,5 km de uma rodovia perto de Sobral, sem caminho riscado, com o sugerido aceito
// Uso: node scripts/gerar-detalhe.ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { Window } from 'happy-dom';
import { montarBase, type Ibge } from './base/montar.ts';
import { montarTerra } from './base/montar-terra.ts';
import { REGIOES, rotaSintetica } from './gerar-regioes.ts';
import { lugaresLigadosDePartida, proporArea } from '../src/nucleo/area.ts';
import { carregarBase, type Buscar } from '../src/nucleo/base.ts';
import { BUSCA_TERRA, caminhoRiscado, entradaMaisPerto, obraNaBeira, sugerirCaminho, viradas, type Chegada } from '../src/nucleo/chegada.ts';
import { compor, type Entrada } from '../src/nucleo/compor.ts';
import { cantoMaisVazio, proporJanelaDetalhe } from '../src/nucleo/detalhe.ts';
import { paraDxf } from '../src/nucleo/dxf.ts';
import { carregarEstradinhas } from '../src/nucleo/estradinhas.ts';
import { distanciaALinha, projetar, separarRota } from '../src/nucleo/grafo.ts';
import { lerArquivoGoogle } from '../src/nucleo/kml.ts';
import { escolherObra } from '../src/nucleo/obra.ts';
import type { ArquivoGoogle, Base, Estradinha, Janela, Pt } from '../src/nucleo/tipos.ts';

(globalThis as any).DOMParser = new Window().DOMParser; // o núcleo lê KML com o DOMParser global

const RAIZ = resolve(import.meta.dirname, '..');
const PASTA_BASE = join(RAIZ, 'public', 'base');
const FIXTURES = join(RAIZ, 'tests', 'fixtures');
const CASO_REAL = join(RAIZ, 'dist-teste', 'diag', 'caso.kmz');
const SAIDA = join(RAIZ, 'dist-teste', 'detalhe');
const QUADRO = { w: 124.6, h: 113 };
const ALCANCE_SAIDAS = 80000; // m, como na tela (src/tela/estado.ts)
const MARGEM_CARGA = 100000; // m, como na tela
const MARGEM_TERRA = 8000; // m de estradinhas em volta da obra e do caminho riscado (o lado maior da janela do detalhe)
const OBRA_SOBRAL = 1500; // m da rodovia até a obra sintética de Sobral
const FOLGA_SOBRAL = 100; // m: a rodovia mais perto dela fica entre 1400 e 1600 m
const RAIO_MAX_SOBRAL = 6000; // m da ponta da rota: até onde se procura a obra de Sobral

const buscar: Buscar = async (caminho) => JSON.parse(readFileSync(join(PASTA_BASE, caminho), 'utf8'));
const crescer = (j: Janela, m: number): Janela => ({ x0: j.x0 - m, y0: j.y0 - m, x1: j.x1 + m, y1: j.y1 + m });
const caixaDe = (pts: Pt[]): Janela => ({
  x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])),
});
const contem = (fora: Janela, dentro: Janela) =>
  fora.x0 <= dentro.x0 && fora.y0 <= dentro.y0 && fora.x1 >= dentro.x1 && fora.y1 >= dentro.y1;
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const comprimento = (pts: Pt[]) => pts.reduce((s, p, k) => (k ? s + dist(pts[k - 1], p) : 0), 0);
const ateLinhas = (linhas: Pt[][], p: Pt) => linhas.reduce((m, l) => Math.min(m, distanciaALinha(p, l)), Infinity);
const ateBase = (base: Base, p: Pt) => ateLinhas(base.arestas.map((a) => a.pts), p);

// ---- caso afastado do Cariri: a mesma montagem do arquivo de tests/fixtures/chegada.ts (a fixture importa sem
// extensão e não roda no Node), com a base reduzida do Cariri só para escolher a estradinha. Sintético: a
// estradinha mais comprida que encosta na CE-397 (ponta a até 30 m) e termina a mais de 500 m da base

function arquivoAfastado(): ArquivoGoogle {
  const ler = (nome: string) => readFileSync(join(FIXTURES, nome), 'utf8');
  const ibge: Ibge = JSON.parse(ler('ibge-cariri.json'));
  const b = montarBase(JSON.parse(ler('osm-cariri.json')), ibge, { remover: [], forcarSede: [], acrescentar: [] }, 3);
  const base: Base = { data: 'teste', nos: new Map(), arestas: b.arestas, lugares: b.lugares };
  const terra = montarTerra(JSON.parse(ler('terra-cariri.json')), 3);
  const ce397 = base.arestas.filter((a) => a.ref === 'CE-397').map((a) => a.pts);
  const candidatas = terra.flatMap((e) => {
    const sentidos: Pt[][] = [];
    if (ateLinhas(ce397, e.pts[0]) <= 30) sentidos.push(e.pts);
    if (ateLinhas(ce397, e.pts[e.pts.length - 1]) <= 30) sentidos.push([...e.pts].reverse());
    return sentidos.filter((pts) => ateBase(base, pts[pts.length - 1]) > 500).map((pts) => ({ pts, m: comprimento(pts) }));
  });
  const { pts } = candidatas.reduce((a, c) => (c.m > a.m ? c : a));
  // encontro: ponto da CE-397 mais perto da ponta da estradinha
  let encontro: Pt = pts[0];
  let menor = Infinity;
  for (const l of ce397) {
    for (let k = 1; k < l.length; k++) {
      const q = projetar(pts[0], l[k - 1], l[k]).q;
      if (dist(q, pts[0]) < menor) [encontro, menor] = [q, dist(q, pts[0])];
    }
  }
  const rota = lerArquivoGoogle(new Uint8Array(readFileSync(join(FIXTURES, 'ce397.kml'))));
  return {
    caminhos: [...rota.caminhos, { nome: 'Terra', pontos: [encontro, ...pts] }],
    alfinetes: [{ nome: 'OBRA', ponto: pts[pts.length - 1] }],
  };
}

// ---- caso real (KML ou KMZ do Google Earth); o happy-dom não aceita CDATA, então cada CDATA vira texto escapado

function arquivoReal(caminho: string): ArquivoGoogle {
  const bytes = new Uint8Array(readFileSync(caminho));
  let texto = new TextDecoder().decode(bytes);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const z = unzipSync(bytes);
    texto = new TextDecoder().decode(z[Object.keys(z).find((n) => n.toLowerCase().endsWith('.kml'))!]);
  }
  const escapa = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return lerArquivoGoogle(new TextEncoder().encode(texto.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t) => escapa(t))));
}

// ---- obra sintética perto de Sobral: rota curta sobre a rodovia mais perto do ponto de Sobral (como em
// gerar-regioes) e o alfinete OBRA a 1,5 km de uma rodovia. Procura em volta da ponta final da rota, em anéis de
// 100 em 100 m a partir de 1500 m, cada anel em 24 direções (de 15 em 15°, a partir do leste, no sentido
// anti-horário): o primeiro ponto cuja rodovia mais perto fica entre 1400 e 1600 m e que tem estradinha a até
// BUSCA_TERRA (500 m)

async function arquivoSobral(): Promise<ArquivoGoogle> {
  const ponto = REGIOES.find((r) => r.nome === 'sobral')!.ponto;
  const base = await carregarBase(crescer(caixaDe([ponto]), ALCANCE_SAIDAS), buscar, MARGEM_CARGA);
  const rota = rotaSintetica(base, ponto);
  const ponta = rota[rota.length - 1];
  const terra = await carregarEstradinhas(crescer(caixaDe([ponta]), RAIO_MAX_SOBRAL + BUSCA_TERRA), buscar);
  const arestas = base.arestas.filter((a) => a.pts.some((p) => dist(p, ponta) < 2 * RAIO_MAX_SOBRAL)).map((a) => a.pts);
  for (let raio = OBRA_SOBRAL; raio <= RAIO_MAX_SOBRAL; raio += 100) {
    for (let grau = 0; grau < 360; grau += 15) {
      const ang = (grau * Math.PI) / 180;
      const obra: Pt = [Math.round(ponta[0] + raio * Math.cos(ang)), Math.round(ponta[1] + raio * Math.sin(ang))];
      if (Math.abs(ateLinhas(arestas, obra) - OBRA_SOBRAL) > FOLGA_SOBRAL) continue;
      if (ateLinhas(terra.map((e) => e.pts), obra) > BUSCA_TERRA) continue;
      console.log(`sobral: obra em [${obra}] (${raio} m da ponta da rota, a ${grau}° do leste)`);
      return { caminhos: [{ nome: 'ROTA', pontos: rota }], alfinetes: [{ nome: 'OBRA', ponto: obra }] };
    }
  }
  throw new Error('sobral: nenhum ponto a 1,5 km de uma rodovia com estradinha perto');
}

// ---- composição, como a tela vai orquestrar: obra na beira → sem detalhe; senão o caminho riscado, e sem ele o
// sugerido (aceito); janela proposta; canto mais vazio

async function montar(arquivo: ArquivoGoogle): Promise<{ entrada: Entrada; resumo: string }> {
  const obra = escolherObra(arquivo)!.ponto;
  const rota = arquivo.caminhos.map((c) => c.pontos);
  // como a tela: base com 100 km de margem em volta do que a área proposta pode alcançar
  let alvo = crescer(caixaDe([obra, ...rota.flat()]), ALCANCE_SAIDAS);
  let base = await carregarBase(alvo, buscar, MARGEM_CARGA);
  const janela = proporArea(obra, rota, base.lugares, QUADRO);
  if (!contem(crescer(alvo, MARGEM_CARGA), crescer(janela, ALCANCE_SAIDAS))) {
    alvo = janela;
    base = await carregarBase(alvo, buscar, MARGEM_CARGA);
  }
  const ligados = lugaresLigadosDePartida(base.lugares, janela);
  const entrada: Entrada = { base, arquivo, obra, janela, quadro: QUADRO, ligados, ajustes: {}, credito: false };
  if (obraNaBeira(base, obra)) return { entrada, resumo: 'obra na beira da rodovia: sem detalhe' };

  const riscado = caminhoRiscado(base, obra, rota);
  const terra: Estradinha[] = await carregarEstradinhas(crescer(caixaDe([obra, ...(riscado?.caminho ?? [])]), MARGEM_TERRA), buscar);
  // sugerirCaminho lança erro se a rota não toca a base
  const tocaBase = separarRota(base, rota).naBase.length > 0;
  const chegada: Chegada | null = riscado ?? (tocaBase ? sugerirCaminho(base, terra, obra, rota) : null);
  const ponta = chegada?.entrada ?? entradaMaisPerto(base, obra);
  const janelaDetalhe = proporJanelaDetalhe(obra, chegada, ponta, QUADRO);
  const canto = cantoMaisVazio(base, janela, QUADRO, obra, rota, ligados);
  entrada.detalhe = {
    terra, chegada,
    opcoes: { canto, janela: janelaDetalhe, viradasDesligadas: [], refsDesligadas: [], sugestaoPendente: false },
  };
  const lado = Math.max(janelaDetalhe.x1 - janelaDetalhe.x0, janelaDetalhe.y1 - janelaDetalhe.y0);
  const resumo = [
    `obra a ${Math.round(ateBase(base, obra))} m da base`, `${terra.length} estradinhas`,
    chegada ? `caminho ${chegada.origem} de ${chegada.metros} m` : 'sem caminho',
    `${chegada ? viradas(chegada, terra).length : 0} viradas`, `canto ${canto}`, `janela do detalhe ${Math.round(lado)} m`,
  ].join(', ');
  return { entrada, resumo };
}

async function gravar(nome: string, arquivo: ArquivoGoogle) {
  const { entrada, resumo } = await montar(arquivo);
  const desenho = compor(entrada);
  const dxf = join(SAIDA, `${nome}.dxf`);
  writeFileSync(dxf, paraDxf(desenho));
  execFileSync('python', [join(RAIZ, 'scripts', 'imagem-dxf.py'), dxf, join(SAIDA, `${nome}.png`)]);
  const numeradas = desenho.prims.filter((p) => p.t === 'texto' && p.id.endsWith(':num')).length;
  console.log(`${nome}: ${resumo}${numeradas ? ' (numeradas, com lista)' : ''}; ${desenho.prims.length} primitivas`);
}

mkdirSync(SAIDA, { recursive: true });
const afastado = arquivoAfastado();
await gravar('afastado', afastado);
await gravar('sem-riscado', { caminhos: afastado.caminhos.slice(0, 1), alfinetes: afastado.alfinetes });
if (existsSync(CASO_REAL)) await gravar('caso-real', arquivoReal(CASO_REAL));
else console.warn(`aviso: ${CASO_REAL} não existe; caso real pulado`);
await gravar('sobral', await arquivoSobral());
