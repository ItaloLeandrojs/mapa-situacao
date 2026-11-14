// traçado limpo das estradas: um eixo só por estrada, a pista, os contornos e os tracinhos do eixo
// (porta das linhas 152 a 234 e 269 a 281 do situacao_teste.py, em unidade da prancha)
import { chaikin, G, type Geo } from './geom.ts';
import { MEDIDAS } from './medidas.ts';
import type { PtU } from './tipos.ts';

export interface Tracado {
  eixo: Geo; pista: Geo; contornoEstrada: PtU[][]; contornoCarrocal: PtU[][]; contornoRota: PtU[][]; tracinhos: PtU[][];
  rotaNoCarrocal: PtU[][]; // a rota amarela pelo meio do carroçal (as bordas dele ficam só na camada CARROÇAL)
}

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

// eixo do carroçal: só dentro do quadro útil, simplificado e arredondado como o das estradas
function carrocalLimpo(carrocal: PtU[][], quadroUtil: Geo): Geo {
  const pedacos = carrocal.flatMap((c) => G.linhas(G.intersecao(G.linha(c), quadroUtil)));
  return G.uniao(pedacos.map((l) => G.linha(chaikin(G.linhas(G.simplifica(G.linha(l), MEDIDAS.simplifica))[0] ?? l))));
}

// rota: a parte em cima da base (vira estrada com eixo tracejado onde a rede não passa);
// carrocal: a parte fora da base, desenhada com as duas bordas e sem eixo, derivando da estrada
export function tracar(
  trechos: PtU[][], viasRef: PtU[][], rota: PtU[][], caixas: Geo, quadroUtil: Geo, carrocal: PtU[][] = [],
): Tracado {
  const eixo = eixoLimpo(trechos, viasRef, rota, quadroUtil);
  const eixoCarrocal = carrocalLimpo(carrocal, quadroUtil);
  const semCarrocal = carrocal.length === 0; // sem carroçal, o traçado é o de sempre, operação por operação
  // pista única de estrada e carroçal: a borda da estrada abre onde o carroçal sai dela, como num entroncamento
  const todos = semCarrocal ? eixo : G.uniao([eixo, eixoCarrocal]);
  const larga = G.engrossa(G.engrossa(G.engrossa(todos, MEDIDAS.meiaEstrada), MEDIDAS.fecha), -MEDIDAS.fecha);
  // buraco pequeno é trevo e se fecha; o que toca a caixa de uma cidade é o vão entre estradas que chegam
  // nela e fica aberto (fechado, as pistas viravam um bloco só na entrada da cidade)
  const pista = G.simplifica(G.intersecao(G.semBuracos(larga, MEDIDAS.buracoMin, caixas), quadroUtil), MEDIDAS.alisaContorno);

  const borda = G.engrossa(G.contorno(quadroUtil), BORDA, SEGMENTOS_SHAPELY);
  const contorno = G.diferenca(G.diferenca(G.contorno(pista), borda), caixas);
  const zonaRota = G.engrossa(G.uniao([...rota, ...carrocal].map(G.linha)), MEDIDAS.zonaRota, SEGMENTOS_SHAPELY);
  // borda do carroçal: junto dele e fora da borda da estrada (o arredondado da entrada fica com o carroçal)
  const zonaCarrocal = semCarrocal ? G.uniao([]) : G.diferenca(
    G.engrossa(eixoCarrocal, MEDIDAS.meiaEstrada + MEDIDAS.fecha), G.engrossa(eixo, MEDIDAS.meiaEstrada + MEDIDAS.alisaContorno + BORDA),
  );

  const foraDaRota = G.diferenca(contorno, zonaRota);

  return {
    eixo,
    pista,
    contornoEstrada: desenhaveis(semCarrocal ? foraDaRota : G.diferenca(foraDaRota, zonaCarrocal)),
    contornoCarrocal: desenhaveis(G.intersecao(contorno, zonaCarrocal)),
    // borda do carroçal não sai de novo na rota: em cima do carroçal a rota é a linha do meio
    contornoRota: desenhaveis(G.intersecao(semCarrocal ? contorno : G.diferenca(contorno, zonaCarrocal), zonaRota)),
    tracinhos: tracejar(G.diferenca(eixo, caixas)),
    // a linha do meio cortada como as bordas: fora das caixas e da faixa junto da borda do quadro útil
    rotaNoCarrocal: semCarrocal ? [] : desenhaveis(G.diferenca(G.diferenca(eixoCarrocal, borda), caixas)),
  };
}
