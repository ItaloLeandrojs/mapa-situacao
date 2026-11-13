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

const comp = (l: PtU[]) => G.comprimento(G.linha(l));
const doMaiorParaOMenor = (ls: PtU[][]) => [...ls].sort((a, b) => comp(b) - comp(a));

// um eixo só por estrada: tira pista dupla e trevo, simplifica curvinhas e arredonda
function eixoLimpo(trechos: PtU[][], viasRef: PtU[][], rota: PtU[][], quadroUtil: Geo): Geo {
  const candidatos = doMaiorParaOMenor(trechos);
  if (viasRef.length > 0) candidatos.push(...doMaiorParaOMenor(G.linhas(G.costura(G.uniao(viasRef.map(G.linha))))));
  candidatos.push(...rota);

  const aceitas: PtU[][] = [];
  let zona: Geo | null = null;
  for (const c of candidatos) {
    const dentro = G.intersecao(G.linha(c), quadroUtil);
    const resto = zona === null ? dentro : G.diferenca(dentro, zona);
    const novos = G.linhas(resto).filter((r) => comp(r) >= MEDIDAS.pedacoMin);
    if (novos.length > 0) {
      aceitas.push(...novos);
      zona = G.engrossa(G.uniao(aceitas.map(G.linha)), MEDIDAS.junta, SEGMENTOS_SHAPELY);
    }
  }

  // ponta solta perto da rede já pronta ganha um pedaço até ela
  const prontas: PtU[][] = [];
  for (const r of aceitas) {
    const cs = G.linhas(G.simplifica(G.linha(r), MEDIDAS.simplifica))[0] ?? r;
    if (prontas.length > 0) {
      const rede = prontas.map(G.linha);
      for (const noInicio of [true, false]) {
        const p = noInicio ? cs[0] : cs[cs.length - 1];
        let menor = Infinity;
        let alvo = rede[0];
        for (const l of rede) {
          const d = G.distancia(l, G.ponto(p));
          if (d < menor) [menor, alvo] = [d, l];
        }
        if (LIGA_MIN < menor && menor < MEDIDAS.liga) {
          const q = G.maisPerto(alvo, p);
          if (noInicio) cs.unshift(q);
          else cs.push(q);
        }
      }
    }
    prontas.push(cs);
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
