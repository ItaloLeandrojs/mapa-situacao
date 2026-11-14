// estado da tela: o que a pessoa escolheu, a base carregada e o último desenho bom
import { aproximar, lugaresLigadosDePartida, mover, proporArea } from '../nucleo/area.ts';
import { carregarBase, type Buscar } from '../nucleo/base.ts';
import { compor } from '../nucleo/compor.ts';
import { lerArquivoGoogle } from '../nucleo/kml.ts';
import { escala, MEDIDAS } from '../nucleo/medidas.ts';
import { candidatosObra, escolherObra as obraAutomatica, type CandidatoObra } from '../nucleo/obra.ts';
import type { ArquivoGoogle, Base, Desenho, Janela, Lugar, Primitiva, Pt, PtU, Quadro } from '../nucleo/tipos.ts';

export interface Estado {
  arquivo: ArquivoGoogle | null; obra: Pt | null; candidatos: CandidatoObra[];
  janela: Janela | null; quadro: Quadro; ligados: string[]; lugaresNaJanela: Lugar[];
  ajustes: Record<string, PtU>; credito: boolean;
  desenho: Desenho | null; aviso: string | null; ocupado: boolean;
}

type Texto = Extract<Primitiva, { t: 'texto' }>;

export const QUADRO_PADRAO: Quadro = { w: 124.6, h: 113 };
const ALCANCE_SAIDAS = 80000; // m: as saídas P/ procuram a sede até 80 km da borda (saidas.ts)
const MARGEM_CARGA = 100000; // m: a base carregada cobre a janela mais 100 km (20 km de folga para mover)

const crescer = (j: Janela, m: number): Janela => ({ x0: j.x0 - m, y0: j.y0 - m, x1: j.x1 + m, y1: j.y1 + m });
const contem = (fora: Janela, dentro: Janela) =>
  fora.x0 <= dentro.x0 && fora.y0 <= dentro.y0 && fora.x1 >= dentro.x1 && fora.y1 >= dentro.y1;
const naJanela = (p: Pt, j: Janela) => p[0] >= j.x0 && p[0] <= j.x1 && p[1] >= j.y0 && p[1] <= j.y1;

function caixaDe(pts: Pt[]): Janela {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// mesma área com o centro mantido, crescendo o lado que falta para a proporção da área útil do quadro
function naProporcao(j: Janela, q: Quadro): Janela {
  const alvo = (q.w - 2 * MEDIDAS.margem) / (q.h - MEDIDAS.margem - MEDIDAS.topo);
  const cx = (j.x0 + j.x1) / 2, cy = (j.y0 + j.y1) / 2;
  let w = j.x1 - j.x0, h = j.y1 - j.y0;
  if (w / h < alvo) w = h * alvo;
  else h = w / alvo;
  return aproximar({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 }, 1); // lado maior no limite
}

// ids das linhas que andam junto quando a primeira linha do bloco é ajustada (os blocos de compor.ts)
export function idsDoBloco(id: string): string[] {
  if (id === 'obra:nome') return [id, 'obra:coord'];
  if (id.startsWith('trecho:') && !id.endsWith(':km')) return [id, `${id}:km`];
  return [id];
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
    for (const outro of idsDoBloco(id).slice(1)) {
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

// tudo o que a pessoa escolheu; só passa a valer quando o desenho novo sai sem erro
interface Escolhas {
  arquivo: ArquivoGoogle | null; candidatos: CandidatoObra[]; obra: Pt | null; janela: Janela | null;
  quadro: Quadro; credito: boolean; ajustes: Ajustes;
  ligadosAMao: Set<string>; desligadosAMao: Set<string>;
}

// deixa o navegador pintar o "ocupado" antes da composição, que trava a página por até 1,5 s
const respirar = () =>
  new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));

export function criarEstado(buscar: Buscar) {
  let atual: Escolhas = {
    arquivo: null, candidatos: [], obra: null, janela: null, quadro: QUADRO_PADRAO, credito: true, ajustes: {},
    ligadosAMao: new Set(), desligadosAMao: new Set(),
  };
  const s: Estado = {
    arquivo: null, obra: null, candidatos: [], janela: null, quadro: QUADRO_PADRAO, ligados: [], lugaresNaJanela: [],
    ajustes: {}, credito: true, desenho: null, aviso: null, ocupado: false,
  };
  const ouvintes: ((e: Estado) => void)[] = [];
  let base: Base | null = null;
  let cobre: Janela | null = null; // área em que a base carregada vale
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

  function publicar(e: Escolhas, extra: Pick<Estado, 'ligados' | 'lugaresNaJanela' | 'desenho'>) {
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
  async function aplicar(pedido: Escolhas, limpaAjustes = false): Promise<void> {
    const comAjustesDeAgora = () => (limpaAjustes ? pedido : { ...pedido, ajustes: atual.ajustes });
    if (!pedido.arquivo || !pedido.obra || !pedido.janela) {
      semAjustes = null;
      publicar(comAjustesDeAgora(), { ligados: [], lugaresNaJanela: [], desenho: null });
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
    await respirar();
    const d = compor({
      base: b, arquivo: pedido.arquivo, obra: pedido.obra, janela, quadro: pedido.quadro, ligados, ajustes: {}, credito: pedido.credito,
    });
    semAjustes = d;
    const ordem = (l: Lugar) => (l.tipo === 'sede' ? 0 : 1);
    const agora = comAjustesDeAgora();
    const e = { ...agora, ajustes: soOsDoDesenho(agora.ajustes, d) };
    publicar(e, {
      ligados,
      lugaresNaJanela: lugares.sort((a, c) => ordem(a) - ordem(c) || a.nome.localeCompare(c.nome, 'pt-BR')),
      desenho: aplicarAjustes(d, naPrancha(e.ajustes, janela, e.quadro)),
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
    await aplicar({ ...e, obra, janela, ajustes: {} }, true);
  }

  const comJanela = (f: (j: Janela) => Janela) =>
    executar(async () => {
      if (atual.janela) await aplicar({ ...atual, janela: f(atual.janela) });
    });

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
          ligadosAMao: new Set(), desligadosAMao: new Set(),
        };
        const auto = obraAutomatica(arquivo);
        if (auto) await comObra(novo, auto.ponto);
        else await aplicar(novo, true); // sem obra: a prévia mostra a rota e os candidatos
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
      atual = { ...atual, ajustes: soOsDoDesenho({ ...atual.ajustes, [id]: guardado }, semAjustes) };
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
        await aplicar({ ...atual, quadro: q, janela: atual.janela && naProporcao(atual.janela, q) });
      });
    },

    mudarCredito(v: boolean): void {
      void executar(async () => {
        await aplicar({ ...atual, credito: v });
      });
    },
  };
}

export type EstadoDaTela = ReturnType<typeof criarEstado>;
