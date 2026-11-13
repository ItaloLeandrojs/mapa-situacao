// traçado limpo das estradas: um eixo só por estrada, a pista, os contornos e os tracinhos do eixo
// (porta das linhas 152 a 234 e 269 a 281 do situacao_teste.py, em unidade da prancha)
import { chaikin, G, type Geo } from './geom.ts';
import { MEDIDAS } from './medidas.ts';
import type { PtU } from './tipos.ts';

export interface Tracado { eixo: Geo; pista: Geo; contornoEstrada: PtU[][]; contornoRota: PtU[][]; tracinhos: PtU[][] }

// medidas pequenas do teste que não têm nome em MEDIDAS (metros do teste × 0,00177231)
const BORDA = 0.0089; // 5 m: faixa junto da borda do quadro útil que o contorno não usa
const LIGA_MIN = 0.0018; // 1 m: ponta já encostada na rede não ganha ligação
const CONTORNO_MIN = 0.0532; // 30 m: pedaço de contorno menor que isso não se desenha
const SEGMENTOS_SHAPELY = 16; // buffer sem quad_segs no teste (padrão do shapely)

type Env = [number, number, number, number];

const comp = (l: PtU[]) => G.comprimento(G.linha(l));
// comprimento calculado uma vez por linha, não a cada comparação
const doMaiorParaOMenor = (ls: PtU[][]) =>
  ls.map((l) => ({ l, c: comp(l) })).sort((a, b) => b.c - a.c).map((x) => x.l);
const cruza = (a: Env, b: Env) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const pertoDe = (e: Env, p: PtU, d: number) =>
  p[0] >= e[0] - d && p[0] <= e[2] + d && p[1] >= e[1] - d && p[1] <= e[3] + d;

// um eixo só por estrada: tira pista dupla e trevo, simplifica curvinhas e arredonda
function eixoLimpo(trechos: PtU[][], viasRef: PtU[][], rota: PtU[][], quadroUtil: Geo): Geo {
  const candidatos = doMaiorParaOMenor(trechos);
  if (viasRef.length > 0) candidatos.push(...doMaiorParaOMenor(G.linhas(G.costura(G.uniao(viasRef.map(G.linha))))));
  candidatos.push(...rota);

  // a zona junta fica como um buffer por pedaço aceito (o buffer da união é a união dos buffers):
  // cada candidato só desconta os buffers cujo envelope cruza o dele
  const aceitas: PtU[][] = [];
  const zonas: { g: Geo; env: Env }[] = [];
  for (const c of candidatos) {
    const dentro = G.intersecao(G.linha(c), quadroUtil);
    const env = G.envelope(dentro);
    const resto = zonas.reduce((r, z) => (cruza(z.env, env) ? G.diferenca(r, z.g) : r), dentro);
    const novos = G.linhas(resto).filter((r) => comp(r) >= MEDIDAS.pedacoMin);
    for (const n of novos) {
      aceitas.push(n);
      const g = G.engrossa(G.linha(n), MEDIDAS.junta, SEGMENTOS_SHAPELY);
      zonas.push({ g, env: G.envelope(g) });
    }
  }

  // ponta solta perto da rede já pronta ganha um pedaço até ela
  const prontas: PtU[][] = [];
  const rede: { g: Geo; env: Env }[] = [];
  for (const r of aceitas) {
    const cs = G.linhas(G.simplifica(G.linha(r), MEDIDAS.simplifica))[0] ?? r;
    for (const noInicio of [true, false]) {
      const p = noInicio ? cs[0] : cs[cs.length - 1];
      let menor = Infinity;
      let alvo: Geo = null;
      // linha com envelope a mais de liga da ponta não pode ser a ligação
      for (const l of rede) {
        if (!pertoDe(l.env, p, MEDIDAS.liga)) continue;
        const d = G.distancia(l.g, G.ponto(p));
        if (d < menor) [menor, alvo] = [d, l.g];
      }
      if (LIGA_MIN < menor && menor < MEDIDAS.liga) {
        const q = G.maisPerto(alvo, p);
        if (noInicio) cs.unshift(q);
        else cs.push(q);
      }
    }
    prontas.push(cs);
    const g = G.linha(cs);
    rede.push({ g, env: G.envelope(g) });
  }
  return G.uniao(prontas.map((r) => G.linha(chaikin(r))));
}

// linhas prontas para desenhar: costuradas e sem os pedacinhos
const desenhaveis = (g: Geo) => G.linhas(G.costura(g)).filter((l) => comp(l) > CONTORNO_MIN);

// eixo tracejado como geometria: tracinho de traco, vão de vao
function tracejar(centro: Geo): PtU[][] {
  const out: PtU[][] = [];
  for (const s of G.linhas(G.costura(centro))) {
    const total = comp(s);
    for (let pos = 0; pos < total; pos += MEDIDAS.traco + MEDIDAS.vao) {
      const t = G.trecho(s, pos, Math.min(pos + MEDIDAS.traco, total));
      if (comp(t) > MEDIDAS.tracoMin) out.push(t);
    }
  }
  return out;
}

export function tracar(trechos: PtU[][], viasRef: PtU[][], rota: PtU[][], caixas: Geo, quadroUtil: Geo): Tracado {
  const eixo = eixoLimpo(trechos, viasRef, rota, quadroUtil);
  const larga = G.engrossa(G.engrossa(G.engrossa(eixo, MEDIDAS.meiaEstrada), MEDIDAS.fecha), -MEDIDAS.fecha);
  const pista = G.simplifica(G.intersecao(G.semBuracos(larga, MEDIDAS.buracoMin), quadroUtil), MEDIDAS.alisaContorno);

  const borda = G.engrossa(G.contorno(quadroUtil), BORDA, SEGMENTOS_SHAPELY);
  const contorno = G.diferenca(G.diferenca(G.contorno(pista), borda), caixas);
  const zonaRota = G.engrossa(G.uniao(rota.map(G.linha)), MEDIDAS.zonaRota, SEGMENTOS_SHAPELY);

  return {
    eixo,
    pista,
    contornoEstrada: desenhaveis(G.diferenca(contorno, zonaRota)),
    contornoRota: desenhaveis(G.intersecao(contorno, zonaRota)),
    tracinhos: tracejar(G.diferenca(eixo, caixas)),
  };
}
