// composição do desenho inteiro: estradas, cidades, obra e textos, em unidade da prancha
// (porta das linhas 282 a 372 do situacao_teste.py)
import { G, type Geo } from './geom.ts';
import { chegadaNaBase, conferirRota, continuacao, montarRede, separarRota, type PontoRede } from './grafo.ts';
import {
  caixaDoDetalhe, cidadeNaReserva, comporDetalhe, obraNaReserva, reservaDoDetalhe, type EntradaDetalhe,
} from './detalhe.ts';
import { areaUtil, escala, MEDIDAS } from './medidas.ts';
import { bloco, candidatosEmVolta, larguraTexto, localDaObra, Ocupacao, textoKm, textoRef, textosDasSaidas, type Texto } from './rotulos.ts';
import { saidas } from './saidas.ts';
import { tracar } from './tracado.ts';
import type { ArquivoGoogle, Base, Desenho, Janela, Lugar, Primitiva, Pt, PtU, Quadro } from './tipos.ts';

// candidatosSaida mudou para rotulos.ts (o detalhe usa também)
export { candidatosSaida } from './rotulos.ts';

export interface Entrada {
  base: Base; arquivo: ArquivoGoogle; obra: Pt; janela: Janela; quadro: Quadro;
  ligados: string[]; // nomes dos lugares que aparecem
  ajustes: Record<string, PtU>; // id do texto -> centro escolhido à mão
  credito: boolean;
  detalhe?: EntradaDetalhe; // detalhe da chegada num canto do quadro; sem ele, o desenho é o de sempre
  // caminho sugerido já aceito, para o mapa geral quando o detalhe está desligado (com o detalhe, vem dele)
  caminhoAceito?: Pt[];
}

const FRACOES_ROTULO = [0.5, 0.4, 0.6, 0.3, 0.7];
// tentadas só quando todos os lugares acima ficam em cima de outro texto ou de estrada
const FRACOES_ROTULO_MAIS = [0.2, 0.8, 0.25, 0.75, 0.15, 0.85];
// por último, mais longe da estrada (em alturas de texto além do afastamento normal)
const AFASTA_MAIS = [0.5, 1];
const dist = (a: PtU, b: PtU) => Math.hypot(a[0] - b[0], a[1] - b[1]);

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
// um pedaço da cadeia dentro da zona só conta se a rota anda em cima dele: a distância média dele à rota fica
// abaixo disto. Cruzamento reto, em qualquer ângulo, dá média de uns TOL_ROTA / 2 (50 m); rota em cima da
// rodovia fica perto de 0. É o que separa cruzar em ângulo raso (1,2 km dentro da zona a 10°) de percorrer
const DESVIO_MAX = TOL_ROTA / 3;
const PASSO_DESVIO = 10; // amostra o pedaço a cada 10 m
export interface ZonaDaRota { rota: Geo; zona: Geo }
// a rota sobre a base e a zona em volta dela: uma vez por compor, não por cadeia
export function zonaDaRota(naBase: Pt[][]): ZonaDaRota | null {
  if (naBase.length === 0) return null;
  const rota = G.uniao(naBase.map(G.linha));
  return { rota, zona: G.engrossa(rota, TOL_ROTA) };
}
export function cadeiaDaRota(linha: Pt[], zona: ZonaDaRota | null): boolean {
  const total = G.comprimento(G.linha(linha));
  if (total === 0 || !zona) return false;
  let percorrido = 0;
  for (const pedaco of G.linhas(G.intersecao(G.linha(linha), zona.zona))) {
    const comp = G.comprimento(G.linha(pedaco));
    if (comp === 0) continue;
    const n = Math.max(1, Math.ceil(comp / PASSO_DESVIO));
    let soma = 0;
    for (let i = 0; i <= n; i++) soma += G.distancia(zona.rota, G.ponto(G.noMeio(pedaco, i / n)));
    if (soma / (n + 1) < DESVIO_MAX) percorrido += comp;
  }
  return percorrido >= total / 2 || percorrido >= PERCORRE_MIN;
}

export function compor(e: Entrada): Desenho {
  const q = e.quadro;
  const esc = escala(e.janela, q);
  const util = areaUtil(q);
  const quadroUtil = G.caixa(...util);
  // com o detalhe, a caixa dele com uma margem em volta fica fora do mapa geral: nenhuma linha passa e nenhum
  // texto livre cai nela
  const reserva = e.detalhe ? reservaDoDetalhe(caixaDoDetalhe(q, e.detalhe.opcoes.canto)) : null;
  const quadroMapa = reserva ? G.diferenca(quadroUtil, G.caixa(...reserva)) : quadroUtil;
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
  // o caminho sugerido aceito no detalhe entra no mapa geral como se viesse riscado no arquivo
  const det = e.detalhe;
  const sugerido = det
    ? (!det.opcoes.sugestaoPendente && det.chegada?.origem === 'sugerido' ? [det.chegada.caminho] : [])
    : (e.caminhoAceito ? [e.caminhoAceito] : []);
  const caminhos = [...e.arquivo.caminhos.filter((c) => c.pontos.length >= 2).map((c) => c.pontos), ...sugerido];
  conferirRota(e.base, caminhos);
  // obra longe da rodovia entra na rede pelo ponto onde a rota sai da base; o círculo fica na obra
  pontos.push({ nome: 'OBRA', ponto: chegadaNaBase(e.base, e.obra, caminhos), tipo: 'obra' });
  const rede = montarRede(e.base, pontos, e.janela, esc.mPorU);
  // rota fora da base vira carroçal; a rodovia de onde ela sai continua desenhada depois da saída
  const rota = separarRota(e.base, caminhos);
  // cidade com a caixa na área do detalhe não aparece no mapa geral: nem a caixa, nem o nome, nem como caixa onde
  // a estrada para
  const aparece = cidades.map((l) => !reserva || !cidadeNaReserva(esc.paraU(l.ponto), reserva));
  // até encostar numa estrada desenhada (a ligação de eixoLimpo junta as duas), numa cidade ou na borda
  const m = esc.mPorU;
  const encontro = {
    linhas: [...rede.trechos, ...rede.viasRef], janela: e.janela,
    caixas: cidades.filter((_, i) => aparece[i]).map(({ ponto: [x, y] }) => {
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
  const todasCaixas = G.uniao(caixas.filter((_, i) => aparece[i]).map((c) => G.caixa(c[0][0], c[0][1], c[2][0], c[2][1])));
  const tr = tracar(
    paraU(rede.trechos), paraU([...rede.viasRef, ...alem]), paraU(rota.naBase), todasCaixas, quadroMapa, paraU(rota.fora),
  );

  prims.push({ t: 'linha', camada: 'ESTRADA', pts: [[0, 0], [q.w, 0], [q.w, q.h], [0, q.h]], fechada: true });
  for (const pts of tr.contornoEstrada) prims.push({ t: 'linha', camada: 'ESTRADA', pts });
  for (const pts of tr.tracinhos) prims.push({ t: 'linha', camada: 'ESTRADA_EIXO', pts });
  for (const pts of tr.contornoCarrocal) prims.push({ t: 'linha', camada: 'CARROÇAL', pts });
  for (const pts of [...tr.contornoRota, ...tr.rotaNoCarrocal]) prims.push({ t: 'linha', camada: 'ROTA', pts, largura: MEDIDAS.larguraRota });
  caixas.forEach((pts, i) => {
    if (aparece[i]) prims.push({ t: 'linha', camada: 'CIDADE', pts, fechada: true });
  });

  const obra = esc.paraU(e.obra);
  const oc = new Ocupacao(G.caixa(...areaTextos), [
    tr.pista, todasCaixas, G.engrossa(G.ponto(obra), MEDIDAS.raioObra), ...(reserva ? [G.caixa(...reserva)] : []),
  ], reserva ? G.caixa(...reserva) : null);

  // nomes das cidades: em cima, embaixo, dos lados e nas diagonais da caixa
  for (const [i, l] of cidades.entries()) {
    if (!aparece[i]) continue;
    const [cx, cy] = esc.paraU(l.ponto);
    const dx = MEDIDAS.caixaW / 2 + larguraTexto(l.nome, MEDIDAS.texto) / 2 + MEDIDAS.folgaCidade;
    const dy = MEDIDAS.caixaH / 2 + MEDIDAS.texto;
    const lugares: PtU[] = [
      [cx, cy + dy], [cx, cy - dy], [cx + dx, cy], [cx - dx, cy],
      [cx + dx, cy + dy], [cx - dx, cy + dy], [cx + dx, cy - dy], [cx - dx, cy - dy],
    ];
    // centro cheio (estrada colada na caixa): sem lugar livre nos 8 de perto, procura em volta da caixa, do mais
    // perto para o mais longe; sem lugar livre, o que não cobre texto; por fim, o menos ruim dos 8
    const grupos = candidatosEmVolta([cx, cy], [l.nome], Math.hypot(MEDIDAS.caixaW, MEDIDAS.caixaH) / 2);
    const centro = [lugares, ...grupos].reduce<PtU | null>((r, g) => r ?? oc.colocaLivre([l.nome], g), null) ??
      oc.colocaSemCobrir([l.nome], lugares) ?? oc.coloca([l.nome], lugares);
    blocos.push(bloco('TEXTO', [`cidade:${l.nome}`], [l.nome], centro));
  }

  // local da obra (com o detalhe por cima dela, num canto escolhido à mão, só no detalhe)
  if (!reserva || !obraNaReserva(obra, reserva)) {
    const marca = localDaObra(oc, obra, e.obra, ['obra:nome', 'obra:coord']);
    prims.push(...marca.circulos);
    blocos.push(marca.textos);
  }

  // nome da estrada e distância em cada cadeia, da mais comprida para a mais curta
  const rotulados: PtU[] = [];
  const repetidos = new Map<string, number>();
  // as cadeias por onde a rota passa pegam lugar primeiro; dentro de cada grupo, a mais comprida primeiro
  const zonaRota = zonaDaRota(rota.naBase);
  const cadeias = rede.cadeias
    .map((c) => ({ ...c, rota: cadeiaDaRota(c.linha, zonaRota), linha: c.linha.map(esc.paraU) }))
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
  blocos.push(...textosDasSaidas(oc, saidas(e.base, eixoUtm, e.janela, e.ligados), esc.paraU, areaTextos, 'saida'));

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
  // o caminho sugerido ainda não aceito: no mapa geral, só na prévia (o DXF não grava) e fora da área do detalhe
  if (det?.opcoes.sugestaoPendente && det.chegada) {
    for (const pts of G.linhas(G.intersecao(G.linha(det.chegada.caminho.map(esc.paraU)), quadroMapa))) {
      prims.push({ t: 'linha', camada: 'ROTA', pts, largura: MEDIDAS.larguraRota, soPrevia: true });
    }
  }
  if (e.detalhe) {
    prims.push(...comporDetalhe({
      base: e.base, obra: e.obra, alfinetes: e.arquivo.alfinetes, ligados: e.ligados, quadro: q, detalhe: e.detalhe,
    }));
  }
  return { quadro: q, prims };
}
