// estado da tela: o que a pessoa escolheu, a base carregada e o último desenho bom
import { aproximar, lugaresLigadosDePartida, mover, proporArea } from '../nucleo/area.ts';
import { carregarBase, type Buscar } from '../nucleo/base.ts';
import { caminhoRiscado, entradaMaisPerto, obraNaBeira, sugerirCaminho, viradas, type Chegada, type Virada } from '../nucleo/chegada.ts';
import { compor } from '../nucleo/compor.ts';
import {
  areaDeDentro, caixaDoDetalhe, cantoMaisVazio, LADO_MAX as LADO_MAX_DETALHE, LADO_MIN as LADO_MIN_DETALHE, obraNaReserva,
  proporJanelaDetalhe, referencias, reservaDoDetalhe, type EntradaDetalhe,
} from '../nucleo/detalhe.ts';
import { carregarEstradinhas, ERRO_CARGA_TERRA } from '../nucleo/estradinhas.ts';
import { separarRota } from '../nucleo/grafo.ts';
import { lerArquivoGoogle } from '../nucleo/kml.ts';
import { escala, escalaNaCaixa, MEDIDAS } from '../nucleo/medidas.ts';
import { candidatosObra, escolherObra as obraAutomatica, type CandidatoObra } from '../nucleo/obra.ts';
import type { ArquivoGoogle, Base, Canto, Desenho, Estradinha, Janela, Lugar, Primitiva, Pt, PtU, Quadro } from '../nucleo/tipos.ts';

export type Sugestao = 'nenhuma' | 'pendente' | 'aceita' | 'recusada';
export interface Estado {
  arquivo: ArquivoGoogle | null; obra: Pt | null; candidatos: CandidatoObra[];
  janela: Janela | null; quadro: Quadro; ligados: string[]; lugaresNaJanela: Lugar[];
  ajustes: Record<string, PtU>; credito: boolean;
  desenho: Desenho | null; aviso: string | null; ocupado: boolean;
  detalhe: {
    disponivel: boolean; // false: obra na beira da rodovia
    ligado: boolean; canto: Canto; automatico: boolean; // automatico: o canto é o de cantoMaisVazio
    sugestao: Sugestao;
    viradas: Virada[]; viradasDesligadas: string[];
    refs: string[]; refsDesligadas: string[];
  };
}

export const SEM_ESTRADINHA = 'Não achei estradinha perto da obra. Risque o caminho de terra no Google Earth';
export const COBRE_A_OBRA = 'O detalhe está cobrindo o local da obra no mapa geral';
export const DETALHE_FALHOU = 'Não consegui desenhar o detalhe da chegada nesta área. O mapa saiu sem ele.';

type Texto = Extract<Primitiva, { t: 'texto' }>;

export const QUADRO_PADRAO: Quadro = { w: 124.6, h: 113 };
const ALCANCE_SAIDAS = 80000; // m: as saídas P/ procuram a sede até 80 km da borda (saidas.ts)
const MARGEM_CARGA = 100000; // m: a base carregada cobre a janela mais 100 km (20 km de folga para mover)
const MARGEM_TERRA = 2000; // m: as estradinhas carregadas cobrem a janela do detalhe mais 2 km
const LISTA = 'detalhe:lista:'; // linhas da lista das coordenadas das viradas: andam como um bloco só

const crescer = (j: Janela, m: number): Janela => ({ x0: j.x0 - m, y0: j.y0 - m, x1: j.x1 + m, y1: j.y1 + m });
const contem = (fora: Janela, dentro: Janela) =>
  fora.x0 <= dentro.x0 && fora.y0 <= dentro.y0 && fora.x1 >= dentro.x1 && fora.y1 >= dentro.y1;
const naJanela = (p: Pt, j: Janela) => p[0] >= j.x0 && p[0] <= j.x1 && p[1] >= j.y0 && p[1] <= j.y1;

function caixaDe(pts: Pt[]): Janela {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// mesma área com o centro mantido, crescendo o lado que falta para a proporção alvo (largura / altura)
function naProporcaoDe(j: Janela, alvo: number): Janela {
  const cx = (j.x0 + j.x1) / 2, cy = (j.y0 + j.y1) / 2;
  let w = j.x1 - j.x0, h = j.y1 - j.y0;
  if (w / h < alvo) w = h * alvo;
  else h = w / alvo;
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}
// na proporção da área útil do quadro, com o lado maior no limite
const naProporcao = (j: Janela, q: Quadro): Janela =>
  aproximar(naProporcaoDe(j, (q.w - 2 * MEDIDAS.margem) / (q.h - MEDIDAS.margem - MEDIDAS.topo)), 1);

// área de dentro do quadrinho (o tamanho é o mesmo nos quatro cantos)
const dentroDoDetalhe = (q: Quadro) => areaDeDentro(caixaDoDetalhe(q, 'id'));
// janela do detalhe aproximada pelo fator, com o lado maior entre os limites da janela proposta
function aproximarJanelaDetalhe(j: Janela, fator: number): Janela {
  const maior = Math.max(j.x1 - j.x0, j.y1 - j.y0);
  const f = Math.min(LADO_MAX_DETALHE, Math.max(LADO_MIN_DETALHE, maior / fator)) / maior / 2;
  const cx = (j.x0 + j.x1) / 2, cy = (j.y0 + j.y1) / 2;
  return { x0: cx - (j.x1 - j.x0) * f, y0: cy - (j.y1 - j.y0) * f, x1: cx + (j.x1 - j.x0) * f, y1: cy + (j.y1 - j.y0) * f };
}
function detalheNaProporcao(j: Janela, q: Quadro): Janela {
  const [x0, y0, x1, y1] = dentroDoDetalhe(q);
  return aproximarJanelaDetalhe(naProporcaoDe(j, (x1 - x0) / (y1 - y0)), 1);
}

// ids das linhas que andam junto quando a primeira linha do bloco é ajustada (os blocos de compor.ts e de
// detalhe.ts). ids: os ids de texto do desenho, para a lista das viradas, que anda inteira
export function idsDoBloco(id: string, ids: string[] = []): string[] {
  if (id === 'obra:nome') return [id, 'obra:coord'];
  if (id === 'detalhe:obra' || id === 'detalhe:entrada') return [id, `${id}:coord`];
  if (id.startsWith(LISTA)) return [id, ...ids.filter((i) => i.startsWith(LISTA) && i !== id)];
  if (id.startsWith('trecho:') && !id.endsWith(':km')) return [id, `${id}:km`];
  return [id];
}

// caixa do quadrinho na prancha, quando o desenho mostra o detalhe
export function caixaDoDetalheNaTela(e: Pick<Estado, 'desenho' | 'detalhe' | 'quadro'>): [number, number, number, number] | null {
  if (!e.desenho?.prims.some((p) => p.t === 'texto' && p.id === 'detalhe:titulo')) return null;
  return caixaDoDetalhe(e.quadro, e.detalhe.canto);
}

// ajustes de texto sobre o desenho composto sem ajustes, com a regra de compor: a primeira linha ajustada
// leva o bloco; uma linha seguinte com ajuste próprio fica no lugar dela
export function aplicarAjustes(d: Desenho, ajustes: Record<string, PtU>): Desenho {
  const original = new Map<string, PtU>();
  for (const p of d.prims) if (p.t === 'texto') original.set(p.id, p.centro);
  const novos = new Map<string, PtU>();
  for (const [id, pedido] of Object.entries(ajustes)) {
    const o = original.get(id);
    if (!o) continue;
    novos.set(id, pedido);
    for (const outro of idsDoBloco(id, [...original.keys()]).slice(1)) {
      const c = original.get(outro);
      if (c && !(outro in ajustes)) novos.set(outro, [c[0] + pedido[0] - o[0], c[1] + pedido[1] - o[1]]);
    }
  }
  if (novos.size === 0) return d;
  return {
    quadro: d.quadro,
    prims: d.prims.map((p): Primitiva => (p.t === 'texto' && novos.has(p.id) ? { ...(p as Texto), centro: novos.get(p.id)! } : p)),
  };
}

// nome de cidade, de estrada e da obra anda com o mapa: o ajuste fica guardado em metros (UTM);
// SEM ESCALA, crédito e P/ ficam presos à borda: o ajuste fica em unidade da prancha
const presoAoMapa = (id: string) => /^(cidade|trecho|obra):/.test(id);
type Ajustes = Record<string, Pt | PtU>; // id -> centro em metros (presoAoMapa) ou em unidade da prancha

// os ajustes guardados em unidade da prancha para a área e o quadro de agora
function naPrancha(ajustes: Ajustes, j: Janela, q: Quadro): Record<string, PtU> {
  const esc = escala(j, q);
  return Object.fromEntries(Object.entries(ajustes).map(([id, p]) => [id, presoAoMapa(id) ? esc.paraU(p) : p]));
}

// só os ajustes de texto que existem no desenho: o resto é descartado
function soOsDoDesenho(ajustes: Ajustes, d: Desenho): Ajustes {
  const ids = new Set(d.prims.flatMap((p) => (p.t === 'texto' ? [p.id] : [])));
  return Object.fromEntries(Object.entries(ajustes).filter(([id]) => ids.has(id)));
}

// o km do rótulo de estrada entra no id (trecho:<ref>:<km>:<n>): afastar a área muda o km e o id some. O ajuste
// passa para o rótulo de mesma ref (e da mesma linha: a de cima ou a do km) cujo centro, no desenho novo, fica mais
// perto da posição guardada, até este tanto da prancha; sem nenhum perto, segue para o descarte de soOsDoDesenho
const ALCANCE_AJUSTE_TRECHO = 15;
function religarTrechos(ajustes: Ajustes, d: Desenho, esc: ReturnType<typeof escala>): Ajustes {
  const centros = new Map<string, PtU>();
  for (const p of d.prims) if (p.t === 'texto') centros.set(p.id, p.centro);
  const refDe = (id: string) => id.split(':')[1];
  const ehKm = (id: string) => id.endsWith(':km');
  const tomados = new Set(Object.keys(ajustes).filter((id) => centros.has(id)));
  const novos: Ajustes = {};
  for (const [id, guardado] of Object.entries(ajustes)) {
    if (!id.startsWith('trecho:') || centros.has(id)) {
      novos[id] = guardado;
      continue;
    }
    const pedido = esc.paraU(guardado);
    let melhor: string | null = null;
    let menor = ALCANCE_AJUSTE_TRECHO;
    for (const [outro, centro] of centros) {
      if (!outro.startsWith('trecho:') || tomados.has(outro) || refDe(outro) !== refDe(id) || ehKm(outro) !== ehKm(id)) continue;
      const dist = Math.hypot(centro[0] - pedido[0], centro[1] - pedido[1]);
      if (dist <= menor) [melhor, menor] = [outro, dist];
    }
    if (!melhor) continue;
    tomados.add(melhor);
    novos[melhor] = guardado;
  }
  return novos;
}

// sem os ajustes dos textos do detalhe (que ficam em unidade da prancha, presos ao quadrinho)
const semDetalhe = (a: Ajustes): Ajustes => Object.fromEntries(Object.entries(a).filter(([id]) => !id.startsWith('detalhe:')));

// o detalhe da obra de agora: o que vem da obra (disponivel, falhou, chegada, ponta) e o que a pessoa escolheu
interface EscolhasDetalhe {
  disponivel: boolean; falhou: boolean; // falhou: as estradinhas não carregaram
  chegada: Chegada | null; // caminho riscado, ou o sugerido pelas estradinhas
  ponta: Pt | null; // ponto da rodovia mais perto da obra (a entrada sem caminho)
  ligado: boolean; canto: Canto | null; janela: Janela | null; // canto null: automático
  sugestao: Sugestao; viradasDesligadas: string[]; refsDesligadas: string[];
}
const SEM_DETALHE: EscolhasDetalhe = {
  disponivel: false, falhou: false, chegada: null, ponta: null, ligado: false, canto: null, janela: null,
  sugestao: 'nenhuma', viradasDesligadas: [], refsDesligadas: [],
};
const DETALHE_VAZIO: Estado['detalhe'] = {
  disponivel: false, ligado: false, canto: 'id', automatico: true, sugestao: 'nenhuma',
  viradas: [], viradasDesligadas: [], refs: [], refsDesligadas: [],
};

// tudo o que a pessoa escolheu; só passa a valer quando o desenho novo sai sem erro
interface Escolhas {
  arquivo: ArquivoGoogle | null; candidatos: CandidatoObra[]; obra: Pt | null; janela: Janela | null;
  quadro: Quadro; credito: boolean; ajustes: Ajustes;
  ligadosAMao: Set<string>; desligadosAMao: Set<string>;
  detalhe: EscolhasDetalhe;
}
// o que se apaga dos ajustes de texto ao compor: nada, tudo (arquivo ou obra nova) ou só os do detalhe
type Limpa = 'nada' | 'tudo' | 'detalhe';

// deixa o navegador pintar o "ocupado" antes da composição, que trava a página por até 1,5 s
const respirar = () =>
  new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));

export function criarEstado(buscar: Buscar) {
  let atual: Escolhas = {
    arquivo: null, candidatos: [], obra: null, janela: null, quadro: QUADRO_PADRAO, credito: true, ajustes: {},
    ligadosAMao: new Set(), desligadosAMao: new Set(), detalhe: SEM_DETALHE,
  };
  const s: Estado = {
    arquivo: null, obra: null, candidatos: [], janela: null, quadro: QUADRO_PADRAO, ligados: [], lugaresNaJanela: [],
    ajustes: {}, credito: true, desenho: null, aviso: null, ocupado: false, detalhe: DETALHE_VAZIO,
  };
  const ouvintes: ((e: Estado) => void)[] = [];
  let base: Base | null = null;
  let cobre: Janela | null = null; // área em que a base carregada vale
  let terra: Estradinha[] | null = null;
  let cobreTerra: Janela | null = null; // área em que as estradinhas carregadas valem
  let semAjustes: Desenho | null = null; // último desenho composto, antes dos ajustes de texto
  let fila: Promise<void> = Promise.resolve();

  const ler = (): Estado => ({ ...s });
  const avisar = () => {
    const e = ler();
    for (const f of ouvintes) f(e);
  };

  // recarrega só se a janela mais o alcance das saídas sair da área já carregada
  async function baseQueCobre(j: Janela): Promise<Base> {
    if (base && cobre && contem(cobre, crescer(j, ALCANCE_SAIDAS))) return base;
    base = await carregarBase(j, buscar, MARGEM_CARGA);
    cobre = crescer(j, MARGEM_CARGA);
    return base;
  }

  // estradinhas da janela do detalhe mais MARGEM_TERRA, guardadas como a base; erro: ERRO_CARGA_TERRA
  async function terraQueCobre(j: Janela): Promise<Estradinha[]> {
    if (terra && cobreTerra && contem(cobreTerra, j)) return terra;
    terra = await carregarEstradinhas(j, buscar, MARGEM_TERRA);
    cobreTerra = crescer(j, MARGEM_TERRA);
    return terra;
  }

  // obra nova: detalhe ligado se a obra não está na beira, canto automático, janela proposta; sem caminho riscado,
  // o caminho sugerido pelas estradinhas fica pendente
  async function detalheDaObra(b: Base, arquivo: ArquivoGoogle, obra: Pt, q: Quadro): Promise<EscolhasDetalhe> {
    if (obraNaBeira(b, obra)) return SEM_DETALHE;
    const rota = arquivo.caminhos.map((c) => c.pontos);
    const riscado = caminhoRiscado(b, obra, rota);
    const ponta = entradaMaisPerto(b, obra);
    const novo: EscolhasDetalhe = { ...SEM_DETALHE, disponivel: true, ligado: true, chegada: riscado, ponta };
    const janelaDe = (c: Chegada | null) => proporJanelaDetalhe(obra, c, c?.entrada ?? ponta, q);
    let t: Estradinha[];
    try {
      t = await terraQueCobre(janelaDe(riscado));
    } catch {
      return { ...novo, falhou: true, janela: janelaDe(riscado) };
    }
    // sugerirCaminho lança erro se a rota não toca a base
    const sugerido = riscado || separarRota(b, rota).naBase.length === 0 ? null : sugerirCaminho(b, t, obra, rota);
    const chegada = riscado ?? sugerido;
    return { ...novo, chegada, sugestao: sugerido ? 'pendente' : 'nenhuma', janela: janelaDe(chegada) };
  }

  // o detalhe da composição: a entrada para compor, o que a tela mostra e os avisos
  async function montarDetalhe(p: Escolhas, b: Base, janela: Janela, ligados: string[]) {
    const d = p.detalhe;
    const mostra: Estado['detalhe'] = {
      disponivel: d.disponivel, ligado: d.disponivel && d.ligado, canto: d.canto ?? s.detalhe.canto, automatico: d.canto === null,
      sugestao: d.sugestao, viradas: [], viradasDesligadas: d.viradasDesligadas,
      refs: referencias(p.arquivo!.alfinetes, p.obra!).map((a) => a.nome), refsDesligadas: d.refsDesligadas,
    };
    if (!mostra.ligado || !d.janela) return { mostra, avisos: [] };
    let t: Estradinha[];
    try {
      if (d.falhou) throw new Error(ERRO_CARGA_TERRA);
      t = await terraQueCobre(d.janela);
    } catch {
      return { mostra, avisos: [ERRO_CARGA_TERRA] }; // compõe sem detalhe
    }
    const chegada = d.sugestao === 'recusada' ? null : d.chegada;
    const desenhada = d.sugestao === 'pendente' ? null : chegada; // a pendente sai só na prévia
    const rota = [...p.arquivo!.caminhos.map((c) => c.pontos), ...(d.sugestao === 'aceita' && chegada ? [chegada.caminho] : [])];
    const canto = d.canto ?? cantoMaisVazio(b, janela, p.quadro, p.obra!, rota, ligados);
    const avisos: string[] = [];
    if (!d.chegada) avisos.push(SEM_ESTRADINHA);
    if (obraNaReserva(escala(janela, p.quadro).paraU(p.obra!), reservaDoDetalhe(caixaDoDetalhe(p.quadro, canto)))) avisos.push(COBRE_A_OBRA);
    const entrada: EntradaDetalhe = {
      terra: t, chegada,
      opcoes: {
        canto, janela: d.janela, viradasDesligadas: d.viradasDesligadas, refsDesligadas: d.refsDesligadas,
        sugestaoPendente: d.sugestao === 'pendente',
      },
    };
    return { entrada, mostra: { ...mostra, canto, viradas: desenhada ? viradas(desenhada, t) : [] }, avisos };
  }

  function publicar(e: Escolhas, extra: Pick<Estado, 'ligados' | 'lugaresNaJanela' | 'desenho' | 'detalhe' | 'aviso'>) {
    atual = e;
    Object.assign(s, {
      arquivo: e.arquivo, obra: e.obra, candidatos: e.candidatos, janela: e.janela, quadro: e.quadro,
      credito: e.credito, ajustes: e.janela ? naPrancha(e.ajustes, e.janela, e.quadro) : {}, ...extra,
    });
  }

  // o desenho atual com os ajustes de agora
  function reaplicar() {
    if (!semAjustes || !atual.janela) return;
    s.ajustes = naPrancha(atual.ajustes, atual.janela, atual.quadro);
    s.desenho = aplicarAjustes(semAjustes, s.ajustes);
  }

  // compõe com as escolhas novas; se der erro nada muda e o desenho anterior continua.
  // ajustarTexto e desfazerAjustes não esperam a fila: os ajustes publicados são os de agora, não os da
  // cópia que a etapa pegou ao começar, a não ser na etapa que limpa os ajustes (arquivo novo, obra nova)
  // (os ajustes do detalhe também se apagam quando o canto automático muda)
  async function aplicar(pedido: Escolhas, limpa: Limpa = 'nada'): Promise<void> {
    let limpaDetalhe = limpa === 'detalhe';
    const comAjustesDeAgora = () => (limpa === 'tudo'
      ? pedido
      : { ...pedido, ajustes: limpaDetalhe ? semDetalhe(atual.ajustes) : atual.ajustes });
    if (!pedido.arquivo || !pedido.obra || !pedido.janela) {
      semAjustes = null;
      publicar(comAjustesDeAgora(), { ligados: [], lugaresNaJanela: [], desenho: null, detalhe: DETALHE_VAZIO, aviso: null });
      return;
    }
    const b = await baseQueCobre(pedido.janela);
    const janela = pedido.janela;
    const lugares = b.lugares.filter((l) => naJanela(l.ponto, janela));
    const nomes = new Set(lugares.map((l) => l.nome));
    const ligados = [...new Set([
      ...lugaresLigadosDePartida(b.lugares, janela),
      ...[...pedido.ligadosAMao].filter((n) => nomes.has(n)),
    ])].filter((n) => !pedido.desligadosAMao.has(n));
    let det = await montarDetalhe(pedido, b, janela, ligados);
    await respirar();
    const comporCom = (detalhe?: EntradaDetalhe) => compor({
      base: b, arquivo: pedido.arquivo!, obra: pedido.obra!, janela, quadro: pedido.quadro, ligados, ajustes: {}, credito: pedido.credito,
      detalhe,
    });
    let d: Desenho;
    try {
      d = comporCom(det.entrada);
    } catch (erro) {
      // o detalhe que falha (erro do JSTS numa área difícil) não derruba o mapa geral: compõe de novo sem ele.
      // O detalhe mexe também no mapa geral (área reservada, caminho aceito), então é o desenho inteiro sem detalhe
      if (!det.entrada) throw erro;
      d = comporCom();
      det = { mostra: { ...det.mostra, viradas: [] }, avisos: [DETALHE_FALHOU] };
    }
    semAjustes = d;
    if (det.mostra.canto !== s.detalhe.canto) limpaDetalhe = true;
    const ordem = (l: Lugar) => (l.tipo === 'sede' ? 0 : 1);
    const agora = comAjustesDeAgora();
    const e = { ...agora, ajustes: soOsDoDesenho(religarTrechos(agora.ajustes, d, escala(janela, agora.quadro)), d) };
    publicar(e, {
      ligados,
      lugaresNaJanela: lugares.sort((a, c) => ordem(a) - ordem(c) || a.nome.localeCompare(c.nome, 'pt-BR')),
      desenho: aplicarAjustes(d, naPrancha(e.ajustes, janela, e.quadro)),
      detalhe: det.mostra,
      aviso: det.avisos.length > 0 ? det.avisos.join('. ') : null,
    });
  }

  // uma etapa por vez; erro vira aviso e a tela segue
  function executar(etapa: () => Promise<void>): Promise<void> {
    fila = fila.then(async () => {
      s.ocupado = true;
      s.aviso = null;
      avisar();
      try {
        await etapa();
      } catch (erro) {
        s.aviso = erro instanceof Error ? erro.message : String(erro);
      } finally {
        s.ocupado = false;
        avisar();
      }
    });
    return fila;
  }

  // obra nova: área proposta de novo e ajustes de texto limpos
  async function comObra(e: Escolhas, obra: Pt): Promise<void> {
    const rota = e.arquivo!.caminhos.map((c) => c.pontos);
    // a área proposta vai até a sede osm city a 80 km da obra: carregando já com essa folga, não carrega duas vezes
    const b = await baseQueCobre(crescer(caixaDe([obra, ...rota.flat()]), ALCANCE_SAIDAS));
    const janela = proporArea(obra, rota, b.lugares, e.quadro);
    const detalhe = await detalheDaObra(b, e.arquivo!, obra, e.quadro);
    await aplicar({ ...e, obra, janela, ajustes: {}, detalhe }, 'tudo');
  }

  const comJanela = (f: (j: Janela) => Janela) =>
    executar(async () => {
      if (atual.janela) await aplicar({ ...atual, janela: f(atual.janela) });
    });

  // muda o detalhe e compõe de novo; o conteúdo ou o lugar dele mudou, então os ajustes dos textos dele se apagam.
  // f devolve null quando não há o que mudar
  const comDetalhe = (f: (d: EscolhasDetalhe) => EscolhasDetalhe | null) =>
    executar(async () => {
      if (!atual.obra || !atual.detalhe.disponivel) return;
      const d = f(atual.detalhe);
      if (d) await aplicar({ ...atual, detalhe: d }, 'detalhe');
    });
  // liga ou desliga um nome numa lista de desligados
  const alternar = (lista: string[], nome: string, ligado: boolean) =>
    (ligado ? lista.filter((n) => n !== nome) : [...lista.filter((n) => n !== nome), nome]);
  const doSugerido = (d: EscolhasDetalhe) => d.chegada?.origem === 'sugerido';

  return {
    ler,
    aoMudar(f: (e: Estado) => void): void {
      ouvintes.push(f);
    },

    abrirArquivo(bytes: Uint8Array): Promise<void> {
      return executar(async () => {
        const arquivo = lerArquivoGoogle(bytes);
        const novo: Escolhas = {
          ...atual, arquivo, candidatos: candidatosObra(arquivo), obra: null, janela: null, ajustes: {},
          ligadosAMao: new Set(), desligadosAMao: new Set(), detalhe: SEM_DETALHE,
        };
        const auto = obraAutomatica(arquivo);
        if (auto) await comObra(novo, auto.ponto);
        else await aplicar(novo, 'tudo'); // sem obra: a prévia mostra a rota e os candidatos
      });
    },

    escolherObra(p: Pt): Promise<void> {
      return executar(async () => {
        if (atual.arquivo) await comObra(atual, p);
      });
    },

    // dxU, dyU: quanto a janela anda, em unidade da prancha
    moverArea(dxU: number, dyU: number): Promise<void> {
      return comJanela((j) => {
        const m = escala(j, atual.quadro).mPorU;
        return mover(j, dxU * m, dyU * m);
      });
    },

    aproximarArea(fator: number): Promise<void> {
      return comJanela((j) => aproximar(j, fator));
    },

    ligarLugar(nome: string, ligado: boolean): Promise<void> {
      return executar(async () => {
        const ligadosAMao = new Set(atual.ligadosAMao);
        const desligadosAMao = new Set(atual.desligadosAMao);
        if (ligado) {
          ligadosAMao.add(nome);
          desligadosAMao.delete(nome);
        } else {
          desligadosAMao.add(nome);
          ligadosAMao.delete(nome);
        }
        await aplicar({ ...atual, ligadosAMao, desligadosAMao });
      });
    },

    // só move o texto no desenho atual; a próxima composição completa já sai com ele no lugar.
    // centro em unidade da prancha do desenho que está na tela (área e quadro de agora)
    ajustarTexto(id: string, centro: PtU): void {
      if (!semAjustes || !atual.janela) return;
      const guardado = presoAoMapa(id) ? escala(atual.janela, atual.quadro).paraMetros(centro) : centro;
      // a lista anda inteira com um ajuste só: o da linha arrastada por último
      const outros = id.startsWith(LISTA)
        ? Object.fromEntries(Object.entries(atual.ajustes).filter(([k]) => !k.startsWith(LISTA)))
        : atual.ajustes;
      atual = { ...atual, ajustes: soOsDoDesenho({ ...outros, [id]: guardado }, semAjustes) };
      reaplicar();
      avisar();
    },

    desfazerAjustes(): void {
      atual = { ...atual, ajustes: {} };
      s.ajustes = {};
      if (semAjustes) s.desenho = semAjustes;
      avisar();
    },

    mudarQuadro(q: Quadro): Promise<void> {
      return executar(async () => {
        const d = atual.detalhe;
        await aplicar({
          ...atual, quadro: q, janela: atual.janela && naProporcao(atual.janela, q),
          detalhe: { ...d, janela: d.janela && detalheNaProporcao(d.janela, q) },
        }, 'detalhe');
      });
    },

    mudarCredito(v: boolean): void {
      void executar(async () => {
        await aplicar({ ...atual, credito: v });
      });
    },

    ligarDetalhe(v: boolean): Promise<void> {
      return comDetalhe((d) => ({ ...d, ligado: v }));
    },

    // null: automático (cantoMaisVazio)
    mudarCanto(c: Canto | null): Promise<void> {
      return comDetalhe((d) => ({ ...d, canto: c }));
    },

    // dxU, dyU: quanto a janela do detalhe anda, em unidade da prancha do quadrinho
    moverDetalhe(dxU: number, dyU: number): Promise<void> {
      return comDetalhe((d) => {
        if (!d.janela || !Number.isFinite(dxU) || !Number.isFinite(dyU)) return null; // deslocamento inválido: nada muda
        const m = escalaNaCaixa(d.janela, dentroDoDetalhe(atual.quadro)).mPorU;
        return { ...d, janela: mover(d.janela, dxU * m, dyU * m) };
      });
    },

    aproximarDetalhe(fator: number): Promise<void> {
      const valido = Number.isFinite(fator) && fator > 0;
      return comDetalhe((d) => (d.janela && valido ? { ...d, janela: aproximarJanelaDetalhe(d.janela, fator) } : null));
    },

    // janela do detalhe proposta de novo, com o caminho que está valendo
    propostaDetalhe(): Promise<void> {
      return comDetalhe((d) => {
        const c = d.sugestao === 'recusada' ? null : d.chegada;
        return { ...d, janela: proporJanelaDetalhe(atual.obra!, c, c?.entrada ?? d.ponta!, atual.quadro) };
      });
    },

    aceitarSugestao(): Promise<void> {
      return comDetalhe((d) => (doSugerido(d) ? { ...d, sugestao: 'aceita' } : null));
    },

    recusarSugestao(): Promise<void> {
      return comDetalhe((d) => (doSugerido(d) ? { ...d, sugestao: 'recusada' } : null));
    },

    ligarVirada(id: string, v: boolean): Promise<void> {
      return comDetalhe((d) => ({ ...d, viradasDesligadas: alternar(d.viradasDesligadas, id, v) }));
    },

    ligarRef(nome: string, v: boolean): Promise<void> {
      return comDetalhe((d) => ({ ...d, refsDesligadas: alternar(d.refsDesligadas, nome, v) }));
    },
  };
}

export type EstadoDaTela = ReturnType<typeof criarEstado>;
