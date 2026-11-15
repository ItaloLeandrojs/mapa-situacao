// composição do desenho inteiro: estradas, cidades, obra e textos, em unidade da prancha
// (porta das linhas 282 a 372 do situacao_teste.py)
import { G, type Geo } from './geom.ts';
import { chegadaNaBase, conferirRota, continuacao, montarRede, separarRota, type PontoRede } from './grafo.ts';
import { escala, MEDIDAS } from './medidas.ts';
import { textoCoordenada } from './obra.ts';
import { larguraTexto, Ocupacao, textoKm, textoRef } from './rotulos.ts';
import { saidas } from './saidas.ts';
import { tracar } from './tracado.ts';
import type { ArquivoGoogle, Base, Camada, Desenho, Janela, Lugar, Primitiva, Pt, PtU, Quadro } from './tipos.ts';

export interface Entrada {
  base: Base; arquivo: ArquivoGoogle; obra: Pt; janela: Janela; quadro: Quadro;
  ligados: string[]; // nomes dos lugares que aparecem
  ajustes: Record<string, PtU>; // id do texto -> centro escolhido à mão
  credito: boolean;
}

type Texto = Extract<Primitiva, { t: 'texto' }>;

const FRACOES_ROTULO = [0.5, 0.4, 0.6, 0.3, 0.7];
// tentadas só quando todos os lugares acima ficam em cima de outro texto ou de estrada
const FRACOES_ROTULO_MAIS = [0.2, 0.8, 0.25, 0.75, 0.15, 0.85];
// por último, mais longe da estrada (em alturas de texto além do afastamento normal)
const AFASTA_MAIS = [0.5, 1];
// até quantas alturas de linha o P/ anda ao longo da borda procurando lugar livre (mais longe, ele já parece
// ser de outra estrada)
const PASSOS_SAIDA = [1, 2, 3, 4];
// anéis do rótulo da obra, em alturas de texto além da folga do círculo
const ANEIS_OBRA = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6];
const dist = (a: PtU, b: PtU) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// linhas de um bloco de texto em volta do centro, uma entrelinha entre elas
function bloco(camada: Camada, ids: string[], txts: string[], centro: PtU, h: number = MEDIDAS.texto): Texto[] {
  const meio = (txts.length - 1) / 2;
  return txts.map((txt, k) => ({
    t: 'texto', camada, id: ids[k], txt, h,
    centro: [centro[0], centro[1] + (meio - k) * h * MEDIDAS.entrelinha] as PtU,
  }));
}

// o lugar ligado de cada nome; nome repetido na base fica com o mais perto do centro da janela
function lugaresLigados(lugares: Lugar[], ligados: string[], j: Janela): Lugar[] {
  const centro: Pt = [(j.x0 + j.x1) / 2, (j.y0 + j.y1) / 2];
  return [...new Set(ligados)].flatMap((nome) => {
    const achados = lugares.filter((l) => l.nome === nome);
    if (achados.length === 0) return [];
    return [achados.reduce((a, b) => (dist(a.ponto, centro) <= dist(b.ponto, centro) ? a : b))];
  });
}

// a primeira linha ajustada leva o bloco inteiro; as outras linhas ajustadas vão sozinhas
function aplicarAjustes(blocos: Texto[][], ajustes: Record<string, PtU>): Texto[] {
  return blocos.flatMap((b) => {
    const pedido = ajustes[b[0].id];
    const dx = pedido ? pedido[0] - b[0].centro[0] : 0;
    const dy = pedido ? pedido[1] - b[0].centro[1] : 0;
    return b.map((t, k) => {
      const proprio = k > 0 ? ajustes[t.id] : undefined;
      const centro: PtU = proprio ?? [t.centro[0] + dx, t.centro[1] + dy];
      return { ...t, centro };
    });
  });
}

// centros para o texto de uma saída: logo para dentro da borda de `area` mais perto do cruzamento, dos dois
// lados da estrada; cada centro preso para a caixa do texto caber inteira em `area` (perto do canto).
// mais: também mais longe ao longo da borda, de uma em uma altura de linha, do mais perto para o mais longe
export function candidatosSaida(
  [px, py]: PtU, txt: string, area: readonly [number, number, number, number], mais = false,
): PtU[] {
  const w = larguraTexto(txt, MEDIDAS.texto) / 2;
  const h = (MEDIDAS.texto * MEDIDAS.entrelinha) / 2;
  // borda mais perto: [distância, normal para dentro]
  const [x0, y0, x1, y1] = area;
  const lados: [number, number, number][] = [[px - x0, 1, 0], [x1 - px, -1, 0], [py - y0, 0, 1], [y1 - py, 0, -1]];
  const [, nx, ny] = lados.reduce((a, b) => (b[0] < a[0] ? b : a));
  const [meioNormal, meioBorda] = nx !== 0 ? [w, h] : [h, w];
  const [cx, cy] = [px + nx * (meioNormal + MEDIDAS.folgaSaida), py + ny * (meioNormal + MEDIDAS.folgaSaida)];
  const [bx, by] = [Math.abs(ny), Math.abs(nx)]; // ao longo da borda
  // área menor que o texto: fica no meio
  const prende = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  const dentro = ([x, y]: PtU): PtU => [prende(x, x0 + w, x1 - w), prende(y, y0 + h, y1 - h)];
  const candidatos: PtU[] = [];
  const linha = MEDIDAS.texto * MEDIDAS.entrelinha;
  const passos = mais ? PASSOS_SAIDA.map((k) => k * linha).filter((p) => Math.abs(p - 2 * meioBorda) > 1e-9) : [];
  for (const passo of [0, 2 * meioBorda, ...passos].sort((a, b) => a - b)) {
    const d = MEDIDAS.meiaEstrada + MEDIDAS.folgaRotulo + meioBorda + passo;
    candidatos.push(dentro([cx + bx * d, cy + by * d]), dentro([cx - bx * d, cy - by * d]));
  }
  return candidatos;
}

// longe da estrada, o rótulo parece ser de outra: só vale o lugar que não fica mais longe dela do que de outra
// estrada do eixo (até uma altura de texto de diferença, como no centro cheio de uma cidade). Sem outra estrada no
// mapa, vale todo lugar. As outras estradas só são calculadas se o filtro for usado. mesmaEstrada: linhas que
// são a mesma rodovia e não contam como outra (a continuação depois da saída do carroçal)
export function pertoDaPropria(linha: PtU[], eixo: Geo, mesmaEstrada: PtU[][] = []): (cs: PtU[]) => PtU[] {
  const propria = G.linha(linha);
  let outras: Geo | null = null;
  return (cs) => {
    outras ??= G.diferenca(eixo, G.engrossa(G.uniao([propria, ...mesmaEstrada.map(G.linha)]), MEDIDAS.meiaEstrada));
    if (G.comprimento(outras) === 0) return cs;
    return cs.filter((p) => G.distancia(propria, G.ponto(p)) <= G.distancia(outras!, G.ponto(p)) + MEDIDAS.texto);
  };
}

// a rota percorre a cadeia? Mede quanto da cadeia fica a até TOL_ROTA do trecho da rota em cima da base (o
// dobro da tolerância de "em cima da base": entre dois pontos do Google a reta corta as curvas do OSM). Conta
// quando é metade da cadeia ou mais (trecho curto todo na rota) ou pelo menos 1 km (rota que anda por parte de
// uma rodovia comprida). Cruzar uma rodovia ou tocar a ponta de uma cadeia no entroncamento dá uns 200 m e não
// conta. Tudo em metros.
const TOL_ROTA = 100;
const PERCORRE_MIN = 1000;
export function cadeiaDaRota(linha: Pt[], naBase: Pt[][]): boolean {
  const total = G.comprimento(G.linha(linha));
  if (total === 0 || naBase.length === 0) return false;
  const zona = G.engrossa(G.uniao(naBase.map(G.linha)), TOL_ROTA);
  const percorrido = G.comprimento(G.intersecao(G.linha(linha), zona));
  return percorrido >= total / 2 || percorrido >= PERCORRE_MIN;
}

export function compor(e: Entrada): Desenho {
  const q = e.quadro;
  const esc = escala(e.janela, q);
  const util = [MEDIDAS.margem, MEDIDAS.margem, q.w - MEDIDAS.margem, q.h - MEDIDAS.topo] as const;
  const quadroUtil = G.caixa(...util);
  // onde a janela cai no quadro útil: os textos ficam dentro dela, como no teste. Com a janela na
  // proporção da área útil (proporArea, mover e aproximar mantêm) é o próprio quadro útil.
  const [jx0, jy0] = esc.paraU([e.janela.x0, e.janela.y0]);
  const [jx1, jy1] = esc.paraU([e.janela.x1, e.janela.y1]);
  const areaTextos = [Math.max(util[0], jx0), Math.max(util[1], jy0), Math.min(util[2], jx1), Math.min(util[3], jy1)] as const;
  const paraU = (ls: Pt[][]) => ls.map((l) => l.map(esc.paraU));
  const prims: Primitiva[] = [];
  const blocos: Texto[][] = [];

  // rede e traçado
  const cidades = lugaresLigados(e.base.lugares, e.ligados, e.janela);
  const pontos: PontoRede[] = cidades.map((l) => ({ nome: l.nome, ponto: l.ponto, tipo: 'cidade' }));
  const caminhos = e.arquivo.caminhos.filter((c) => c.pontos.length >= 2).map((c) => c.pontos);
  conferirRota(e.base, caminhos);
  // obra longe da rodovia entra na rede pelo ponto onde a rota sai da base; o círculo fica na obra
  pontos.push({ nome: 'OBRA', ponto: chegadaNaBase(e.base, e.obra, caminhos), tipo: 'obra' });
  const rede = montarRede(e.base, pontos, e.janela, esc.mPorU);
  // rota fora da base vira carroçal; a rodovia de onde ela sai continua desenhada depois da saída
  const rota = separarRota(e.base, caminhos);
  // até encostar numa estrada desenhada (a ligação de eixoLimpo junta as duas), numa cidade ou na borda
  const m = esc.mPorU;
  const encontro = {
    linhas: [...rede.trechos, ...rede.viasRef], janela: e.janela,
    caixas: cidades.map(({ ponto: [x, y] }) => {
      const [w, h] = [(MEDIDAS.caixaW / 2) * m, (MEDIDAS.caixaH / 2) * m];
      return { x0: x - w, y0: y - h, x1: x + w, y1: y + h };
    }),
  };
  const alcance = { tol: MEDIDAS.liga * m, max: MEDIDAS.continuaMax * m, toco: MEDIDAS.tocoContinua * m };
  const alem = rota.saidas.map((s) => continuacao(e.base, s, encontro, alcance)).filter((l) => l.length >= 2);
  const caixas = cidades.map((l) => {
    const [x, y] = esc.paraU(l.ponto);
    const [w, h] = [MEDIDAS.caixaW / 2, MEDIDAS.caixaH / 2];
    return [[x - w, y - h], [x + w, y - h], [x + w, y + h], [x - w, y + h]] as PtU[];
  });
  const todasCaixas = G.uniao(caixas.map((c) => G.caixa(c[0][0], c[0][1], c[2][0], c[2][1])));
  const tr = tracar(
    paraU(rede.trechos), paraU([...rede.viasRef, ...alem]), paraU(rota.naBase), todasCaixas, quadroUtil, paraU(rota.fora),
  );

  prims.push({ t: 'linha', camada: 'ESTRADA', pts: [[0, 0], [q.w, 0], [q.w, q.h], [0, q.h]], fechada: true });
  for (const pts of tr.contornoEstrada) prims.push({ t: 'linha', camada: 'ESTRADA', pts });
  for (const pts of tr.tracinhos) prims.push({ t: 'linha', camada: 'ESTRADA_EIXO', pts });
  for (const pts of tr.contornoCarrocal) prims.push({ t: 'linha', camada: 'CARROÇAL', pts });
  for (const pts of [...tr.contornoRota, ...tr.rotaNoCarrocal]) prims.push({ t: 'linha', camada: 'ROTA', pts, largura: MEDIDAS.larguraRota });
  for (const pts of caixas) prims.push({ t: 'linha', camada: 'CIDADE', pts, fechada: true });

  const obra = esc.paraU(e.obra);
  const oc = new Ocupacao(G.caixa(...areaTextos), [tr.pista, todasCaixas, G.engrossa(G.ponto(obra), MEDIDAS.raioObra)]);

  // nomes das cidades: em cima, embaixo, dos lados e nas diagonais da caixa
  for (const l of cidades) {
    const [cx, cy] = esc.paraU(l.ponto);
    const dx = MEDIDAS.caixaW / 2 + larguraTexto(l.nome, MEDIDAS.texto) / 2 + MEDIDAS.folgaCidade;
    const dy = MEDIDAS.caixaH / 2 + MEDIDAS.texto;
    const centro = oc.coloca([l.nome], [
      [cx, cy + dy], [cx, cy - dy], [cx + dx, cy], [cx - dx, cy],
      [cx + dx, cy + dy], [cx - dx, cy + dy], [cx + dx, cy - dy], [cx - dx, cy - dy],
    ]);
    blocos.push(bloco('TEXTO', [`cidade:${l.nome}`], [l.nome], centro));
  }

  // local da obra
  prims.push({ t: 'circulo', camada: 'LOCAL_DA_OBRA', centro: obra, r: MEDIDAS.raioObra });
  prims.push({ t: 'circulo', camada: 'LOCAL_DA_OBRA', centro: obra, r: MEDIDAS.raioObraDentro });
  const rotObra = ['LOCAL DA OBRA', textoCoordenada(e.obra)];
  {
    const [ox, oy] = obra;
    const dx = MEDIDAS.raioObra + larguraTexto(rotObra[0], MEDIDAS.texto) / 2 + MEDIDAS.folgaObra;
    const dy = MEDIDAS.raioObra + MEDIDAS.texto * 1.8;
    const perto: PtU[] = [
      [ox + dx, oy - dy * 0.6], [ox + dx, oy + dy * 0.6], [ox - dx, oy - dy * 0.6],
      [ox - dx, oy + dy * 0.6], [ox, oy - dy], [ox, oy + dy],
    ];
    // centro cheio: anéis mais longe do círculo, em 32 direções, antes de aceitar ficar em cima de algo
    const meiaW = larguraTexto(rotObra[0], MEDIDAS.texto) / 2;
    const meiaH = (MEDIDAS.texto * (MEDIDAS.entrelinha + 1)) / 2;
    const aneis = ANEIS_OBRA.map((k) => {
      const r = MEDIDAS.raioObra + MEDIDAS.folgaObra + k * MEDIDAS.texto;
      return Array.from({ length: 32 }, (_, i): PtU => {
        const a = -Math.PI / 8 - (i * Math.PI) / 16; // começa embaixo à direita, como o primeiro de perto
        return [ox + Math.cos(a) * (meiaW + r), oy + Math.sin(a) * (meiaH + r)];
      });
    });
    // o anel mais perto que tiver lugar livre
    const centro = oc.colocaLivre(rotObra, perto) ??
      aneis.reduce<PtU | null>((c, anel) => c ?? oc.colocaLivre(rotObra, anel), null) ??
      oc.colocaSemCobrir(rotObra, perto) ?? oc.coloca(rotObra, perto);
    blocos.push(bloco('LOCAL_DA_OBRA', ['obra:nome', 'obra:coord'], rotObra, centro));
  }

  // nome da estrada e distância em cada cadeia, da mais comprida para a mais curta
  const rotulados: PtU[] = [];
  const repetidos = new Map<string, number>();
  // as cadeias por onde a rota passa pegam lugar primeiro; dentro de cada grupo, a mais comprida primeiro
  const cadeias = rede.cadeias
    .map((c) => ({ ...c, rota: cadeiaDaRota(c.linha, rota.naBase), linha: c.linha.map(esc.paraU) }))
    .sort((a, b) => Number(b.rota) - Number(a.rota) || b.km - a.km);
  for (const c of cadeias) {
    // pedacinho de trevo, ou pista dupla já rotulada
    if (c.linha.length < 2 || c.km * 1000 * esc.k < MEDIDAS.cadeiaMin) continue;
    const meio = G.noMeio(c.linha, 0.5);
    if (rotulados.some((m) => dist(m, meio) < MEDIDAS.entreRotulos)) continue;
    const linhas = [...(c.ref ? [textoRef(c.ref)] : []), textoKm(c.km)];
    const w = Math.max(...linhas.map((t) => larguraTexto(t, MEDIDAS.texto)));
    // dos dois lados da estrada, em cada fração do comprimento
    const candidatos = (fracoes: number[], mais = 0) => fracoes.flatMap((f): PtU[] => {
      const m = G.noMeio(c.linha, f);
      const m2 = G.noMeio(c.linha, Math.min(f + 0.02, 1));
      const vx = m2[0] - m[0];
      const vy = m2[1] - m[1];
      const n = Math.hypot(vx, vy) || 1; // segmento de comprimento zero: sem direção
      const [nx, ny] = [-vy / n, vx / n];
      const afast = MEDIDAS.meiaEstrada + MEDIDAS.folgaRotulo + (Math.abs(nx) * w) / 2 +
        Math.abs(ny) * linhas.length * MEDIDAS.texto * 0.75 + mais * MEDIDAS.texto;
      return [[m[0] + nx * afast, m[1] + ny * afast], [m[0] - nx * afast, m[1] - ny * afast]];
    });
    const todas = [...FRACOES_ROTULO, ...FRACOES_ROTULO_MAIS];
    // ao lado, acima, abaixo e nas diagonais do ponto da estrada, sem depender do rumo dela
    const gx = MEDIDAS.meiaEstrada + MEDIDAS.folgaRotulo + w / 2;
    const gy = MEDIDAS.meiaEstrada + MEDIDAS.folgaRotulo + linhas.length * MEDIDAS.texto * 0.75;
    const emVolta = (k: number) => todas.flatMap((f): PtU[] => {
      const [x, y] = G.noMeio(c.linha, f);
      const [dx, dy] = [k * gx, k * gy];
      return [
        [x + dx, y], [x - dx, y], [x, y + dy], [x, y - dy],
        [x + dx, y + dy], [x - dx, y + dy], [x + dx, y - dy], [x - dx, y - dy],
      ];
    });
    // a rodovia depois da saída do carroçal é a mesma por onde a rota veio
    const daEstrada = pertoDaPropria(c.linha, tr.eixo, c.rota ? paraU(alem) : []);
    // rótulo de estrada nunca fica em cima de outro texto nem de estrada ou caixa: sem lugar, fica sem rótulo
    const longe = [emVolta(1), emVolta(1.5), ...AFASTA_MAIS.map((m) => candidatos(todas, m))];
    const centro = oc.colocaLivre(linhas, candidatos(FRACOES_ROTULO)) ??
      oc.colocaLivre(linhas, candidatos(FRACOES_ROTULO_MAIS)) ??
      longe.reduce<PtU | null>((r, cs) => r ?? oc.colocaLivre(linhas, daEstrada(cs)), null);
    if (!centro) continue;
    rotulados.push(meio);
    const chave = `trecho:${c.ref}:${c.km.toFixed(1)}`;
    const k = repetidos.get(chave) ?? 0;
    repetidos.set(chave, k + 1);
    const id = `${chave}:${k}`;
    blocos.push(bloco('TEXTO', c.ref ? [id, `${id}:km`] : [id], linhas, centro));
  }

  // "P/ CIDADE" logo para dentro da borda, dos dois lados da estrada
  const eixoUtm = G.linhas(tr.eixo).map((l) => l.map(esc.paraMetros));
  const destinos = new Map<string, number>();
  for (const s of saidas(e.base, eixoUtm, e.janela, e.ligados)) {
    const txt = `P/ ${s.destino}`;
    const candidatos = candidatosSaida(esc.paraU(s.ponto), txt, areaTextos);
    const mais = candidatosSaida(esc.paraU(s.ponto), txt, areaTextos, true);
    // o mesmo destino em outra borda: id com :2, :3... para o ajuste achar cada um
    const n = (destinos.get(s.destino) ?? 0) + 1;
    destinos.set(s.destino, n);
    const id = n === 1 ? `saida:${s.destino}` : `saida:${s.destino}:${n}`;
    // de preferência sem encostar em estrada nem em outro texto, mais longe ao longo da borda se preciso;
    // sem lugar livre, perto da saída e separado dos outros textos mesmo encostando em estrada; depois sem cobrir
    // texto; senão, no menos ruim (P/ sempre sai)
    let livre: PtU | null = null;
    // o par (um de cada lado da estrada) mais perto da saída que tiver lugar livre
    for (let k = 0; k < mais.length && !livre; k += 2) livre = oc.colocaLivre([txt], mais.slice(k, k + 2));
    const centro = livre ?? oc.colocaSeparado([txt], candidatos) ?? oc.colocaSemCobrir([txt], candidatos) ??
      oc.coloca([txt], candidatos);
    blocos.push(bloco('TEXTO', [id], [txt], centro));
  }

  // "SEM ESCALA" no canto mais vazio (a prancha já tem o título em cima do quadro)
  const cantos = (txt: string, h: number) => {
    const w = larguraTexto(txt, h) / 2 + MEDIDAS.margemCanto;
    const a = (h * MEDIDAS.entrelinha) / 2 + MEDIDAS.margemCanto;
    const [x0, y0, x1, y1] = areaTextos;
    return {
      cima: [[x0 + w, y1 - a], [x1 - w, y1 - a]] as PtU[],
      baixo: [[x0 + w, y0 + a], [x1 - w, y0 + a]] as PtU[],
      meio: [[(x0 + x1) / 2, y1 - a], [(x0 + x1) / 2, y0 + a]] as PtU[],
    };
  };
  const ce = cantos('SEM ESCALA', MEDIDAS.texto);
  const centroTitulo = oc.coloca(['SEM ESCALA'], [...ce.cima, ...ce.baixo, ...ce.meio]);
  blocos.push(bloco('TITULO', ['titulo'], ['SEM ESCALA'], centroTitulo));

  if (e.credito) {
    const txt = 'Base: OpenStreetMap';
    // nunca em cima de outro texto: cantos de baixo, depois os de cima, depois ao longo da borda de baixo e da
    // de cima; primeiro livre de estrada e longe dos textos, depois só longe dos textos, depois só sem cobrir
    // (também ao longo das bordas dos lados); só se tudo cobre texto, o menos ruim embaixo
    const h = MEDIDAS.textoCredito;
    const cc = cantos(txt, h);
    const [[xe, yb], [xd]] = cc.baixo;
    const yc = cc.cima[0][1];
    const passos = Array.from({ length: 9 }, (_, i) => i / 8);
    const aoLongo = (y: number) => passos.map((f): PtU => [xe + f * (xd - xe), y]);
    const aoLado = (x: number) => passos.map((f): PtU => [x, yb + f * (yc - yb)]);
    const grupos = [cc.baixo, cc.cima, aoLongo(yb), aoLongo(yc)];
    const tenta = (gs: PtU[][], f: (g: PtU[]) => PtU | null) => gs.reduce<PtU | null>((c, g) => c ?? f(g), null);
    const centro = tenta(grupos, (g) => oc.colocaLivre([txt], g, h)) ??
      tenta(grupos, (g) => oc.colocaSeparado([txt], g, h)) ??
      tenta([...grupos, aoLado(xe), aoLado(xd)], (g) => oc.colocaSemCobrir([txt], g, h)) ??
      oc.coloca([txt], cc.baixo, h);
    blocos.push(bloco('TEXTO', ['credito'], [txt], centro, MEDIDAS.textoCredito));
  }

  prims.push(...aplicarAjustes(blocos, e.ajustes));
  return { quadro: q, prims };
}
