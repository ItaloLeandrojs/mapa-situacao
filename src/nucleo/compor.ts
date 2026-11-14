// composição do desenho inteiro: estradas, cidades, obra e textos, em unidade da prancha
// (porta das linhas 282 a 372 do situacao_teste.py)
import { G } from './geom.ts';
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
// tentadas só quando todos os lugares acima ficam em cima de outro texto
const FRACOES_ROTULO_MAIS = [0.2, 0.8, 0.25, 0.75, 0.15, 0.85];
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
// lados da estrada; cada centro preso para a caixa do texto caber inteira em `area` (perto do canto)
export function candidatosSaida([px, py]: PtU, txt: string, area: readonly [number, number, number, number]): PtU[] {
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
  for (const passo of [0, 2 * meioBorda]) {
    const d = MEDIDAS.meiaEstrada + MEDIDAS.folgaRotulo + meioBorda + passo;
    candidatos.push(dentro([cx + bx * d, cy + by * d]), dentro([cx - bx * d, cy - by * d]));
  }
  return candidatos;
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
  const alem = rota.saidas.map((s) => continuacao(e.base, s, e.janela)).filter((l) => l.length >= 2);
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
  for (const pts of tr.contornoRota) prims.push({ t: 'linha', camada: 'ROTA', pts, largura: MEDIDAS.larguraRota });
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
    const centro = oc.coloca(rotObra, [
      [ox + dx, oy - dy * 0.6], [ox + dx, oy + dy * 0.6], [ox - dx, oy - dy * 0.6],
      [ox - dx, oy + dy * 0.6], [ox, oy - dy], [ox, oy + dy],
    ]);
    blocos.push(bloco('LOCAL_DA_OBRA', ['obra:nome', 'obra:coord'], rotObra, centro));
  }

  // nome da estrada e distância em cada cadeia, da mais comprida para a mais curta
  const rotulados: PtU[] = [];
  const repetidos = new Map<string, number>();
  const cadeias = rede.cadeias.map((c) => ({ ...c, linha: c.linha.map(esc.paraU) })).sort((a, b) => b.km - a.km);
  for (const c of cadeias) {
    // pedacinho de trevo, ou pista dupla já rotulada
    if (c.linha.length < 2 || c.km * 1000 * esc.k < MEDIDAS.cadeiaMin) continue;
    const meio = G.noMeio(c.linha, 0.5);
    if (rotulados.some((m) => dist(m, meio) < MEDIDAS.entreRotulos)) continue;
    const linhas = [...(c.ref ? [textoRef(c.ref)] : []), textoKm(c.km)];
    const w = Math.max(...linhas.map((t) => larguraTexto(t, MEDIDAS.texto)));
    // dos dois lados da estrada, em cada fração do comprimento
    const candidatos = (fracoes: number[]) => fracoes.flatMap((f): PtU[] => {
      const m = G.noMeio(c.linha, f);
      const m2 = G.noMeio(c.linha, Math.min(f + 0.02, 1));
      const vx = m2[0] - m[0];
      const vy = m2[1] - m[1];
      const n = Math.hypot(vx, vy) || 1; // segmento de comprimento zero: sem direção
      const [nx, ny] = [-vy / n, vx / n];
      const afast = MEDIDAS.meiaEstrada + MEDIDAS.folgaRotulo + (Math.abs(nx) * w) / 2 +
        Math.abs(ny) * linhas.length * MEDIDAS.texto * 0.75;
      return [[m[0] + nx * afast, m[1] + ny * afast], [m[0] - nx * afast, m[1] - ny * afast]];
    });
    // rótulo de estrada nunca fica em cima de outro texto: sem lugar, fica sem rótulo
    const centro = oc.colocaSemCobrir(linhas, candidatos(FRACOES_ROTULO)) ??
      oc.colocaSemCobrir(linhas, candidatos(FRACOES_ROTULO_MAIS));
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
    // o mesmo destino em outra borda: id com :2, :3... para o ajuste achar cada um
    const n = (destinos.get(s.destino) ?? 0) + 1;
    destinos.set(s.destino, n);
    const id = n === 1 ? `saida:${s.destino}` : `saida:${s.destino}:${n}`;
    // de preferência sem cobrir outro texto; sem lugar livre, fica no menos ruim (P/ sempre sai)
    const centro = oc.colocaSemCobrir([txt], candidatos) ?? oc.coloca([txt], candidatos);
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
    const centro = oc.coloca([txt], cantos(txt, MEDIDAS.textoCredito).baixo, MEDIDAS.textoCredito);
    blocos.push(bloco('TEXTO', ['credito'], [txt], centro, MEDIDAS.textoCredito));
  }

  prims.push(...aplicarAjustes(blocos, e.ajustes));
  return { quadro: q, prims };
}
