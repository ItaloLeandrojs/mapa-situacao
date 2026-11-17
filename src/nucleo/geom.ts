// única porta de entrada do JSTS no projeto: o resto do código usa só G
// (usa as classes de operação, sem o "monkey patch" do JSTS)
import ArrayList from 'jsts/java/util/ArrayList.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import PrecisionModel from 'jsts/org/locationtech/jts/geom/PrecisionModel.js';
import TopologyException from 'jsts/org/locationtech/jts/geom/TopologyException.js';
import LengthIndexedLine from 'jsts/org/locationtech/jts/linearref/LengthIndexedLine.js';
import BoundaryOp from 'jsts/org/locationtech/jts/operation/BoundaryOp.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js';
import LineMerger from 'jsts/org/locationtech/jts/operation/linemerge/LineMerger.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import RectangleIntersects from 'jsts/org/locationtech/jts/operation/predicate/RectangleIntersects.js';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js';
import GeometryPrecisionReducer from 'jsts/org/locationtech/jts/precision/GeometryPrecisionReducer.js';
import TopologyPreservingSimplifier from 'jsts/org/locationtech/jts/simplify/TopologyPreservingSimplifier.js';
import type { PtU } from './tipos.ts';

export type Geo = unknown; // geometria do JSTS

// o pedaço da geometria do JSTS que este arquivo usa
interface J {
  isEmpty(): boolean;
  getGeometryType(): string;
  getNumGeometries(): number;
  getGeometryN(i: number): J;
  getCoordinates(): { x: number; y: number }[];
  getArea(): number;
  getLength(): number;
  getExteriorRing(): J;
  getNumInteriorRing(): number;
  getInteriorRingN(i: number): J;
  getEnvelopeInternal(): { getMinX(): number; getMinY(): number; getMaxX(): number; getMaxY(): number };
}

const fab = new GeometryFactory();
const j = (g: Geo) => g as J;
const coord = (p: PtU) => new Coordinate(p[0], p[1]);
const vazio = (): Geo => fab.createGeometryCollection();
const lista = (gs: Geo[]) => {
  const l = new ArrayList(undefined); // o tipo do JSTS exige o argumento (coleção inicial)
  for (const g of gs) l.add(g);
  return l;
};

// coleção mista vira suas partes; Multi* e geometria simples ficam inteiras
function partes(g: J): J[] {
  if (g.isEmpty()) return [];
  if (g.getGeometryType() !== 'GeometryCollection') return [g];
  const out: J[] = [];
  for (let i = 0; i < g.getNumGeometries(); i++) out.push(...partes(g.getGeometryN(i)));
  return out;
}

// componentes simples (ponto, linha, anel, polígono)
function folhas(g: J): J[] {
  if (g.isEmpty()) return [];
  const n = g.getNumGeometries();
  if (n === 1 && g.getGeometryN(0) === g) return [g];
  const out: J[] = [];
  for (let i = 0; i < n; i++) out.push(...folhas(g.getGeometryN(i)));
  return out;
}

const pts = (g: J): PtU[] => g.getCoordinates().map((c) => [c.x, c.y] as PtU);

// grades do plano B da união, da mais fina à mais grossa (1e-8 a 1e-4 da unidade: invisível na prancha e em metros)
const GRADES_UNIAO = [1e8, 1e6, 1e4];

// UnaryUnionOp de tudo. Com linhas quase coincidentes (pista dupla e alça no centro da cidade) o JSTS pode lançar
// TopologyException (non-noded intersection): só então arredonda as coordenadas numa grade fina e une de novo
function uniao(gs: Geo[]): Geo {
  const cheias = gs.filter((g) => !j(g).isEmpty());
  if (cheias.length === 0) return vazio();
  try {
    return UnaryUnionOp.union(lista(cheias));
  } catch (erro) {
    if (!(erro instanceof TopologyException)) throw erro;
    for (const escala of GRADES_UNIAO) {
      const pm = new PrecisionModel(escala);
      try {
        return UnaryUnionOp.union(lista(cheias.map((g) => GeometryPrecisionReducer.reduce(g, pm))));
      } catch (outro) {
        if (!(outro instanceof TopologyException)) throw outro;
      }
    }
    throw erro;
  }
}

// o overlay do JSTS não aceita GeometryCollection: opera parte a parte
function diferenca(a: Geo, b: Geo): Geo {
  const tira = partes(j(b));
  return uniao(partes(j(a)).map((pa) => tira.reduce<Geo>((r, pb) => (j(r).isEmpty() ? r : tiraDe(r, pb)), pa)));
}

// OverlayOp.difference de a por b. Num Multi* com partes que se tocam (uma termina em cima da outra) o JSTS pode
// lançar TopologyException (non-noded intersection) mesmo com cada parte passando sozinha: então tira parte a parte
function tiraDe(a: Geo, b: Geo): Geo {
  try {
    return OverlayOp.difference(a, b);
  } catch (erro) {
    const n = j(a).getNumGeometries();
    if (n <= 1) throw erro;
    return uniao(Array.from({ length: n }, (_, i) => tiraDe(j(a).getGeometryN(i), b)));
  }
}

function intersecao(a: Geo, b: Geo): Geo {
  const out: Geo[] = [];
  for (const pa of partes(j(a))) for (const pb of partes(j(b))) out.push(OverlayOp.intersection(pa, pb));
  return uniao(out);
}

function linha(p: PtU[]): Geo {
  return p.length < 2 ? fab.createLineString() : fab.createLineString(p.map(coord));
}

export const G = {
  linha,
  ponto: (p: PtU): Geo => fab.createPoint(coord(p)),
  caixa: (x0: number, y0: number, x1: number, y1: number): Geo =>
    fab.createPolygon([coord([x0, y0]), coord([x1, y0]), coord([x1, y1]), coord([x0, y1]), coord([x0, y0])]),
  uniao,
  diferenca,
  intersecao,
  // buffer; segmentos por quadrante, padrão 4
  engrossa: (g: Geo, d: number, segmentos = 4): Geo => (j(g).isEmpty() ? vazio() : BufferOp.bufferOp(g, d, segmentos)),
  simplifica: (g: Geo, tol: number): Geo => (j(g).isEmpty() ? g : TopologyPreservingSimplifier.simplify(g, tol)),
  contorno: (g: Geo): Geo => (j(g).isEmpty() ? vazio() : BoundaryOp.getBoundary(g)),
  // linemerge
  costura: (g: Geo): Geo => {
    const ls = folhas(j(g)).filter((f) => f.getGeometryType() === 'LineString' || f.getGeometryType() === 'LinearRing');
    if (ls.length === 0) return vazio();
    const m = new LineMerger();
    for (const l of ls) m.add(l);
    return fab.buildGeometry(m.getMergedLineStrings());
  },
  // tira os buracos de área até areaMin; buraco que toca `abertos` fica, de qualquer tamanho
  semBuracos: (g: Geo, areaMin: number, abertos: Geo = vazio()): Geo =>
    uniao(
      folhas(j(g))
        .filter((f) => f.getGeometryType() === 'Polygon')
        .map((p) => {
          const buracos: Geo[] = [];
          for (let i = 0; i < p.getNumInteriorRing(); i++) {
            const anel = p.getInteriorRingN(i);
            const b = fab.createPolygon(anel);
            const toca = !j(abertos).isEmpty() && DistanceOp.distance(b, abertos) === 0;
            if (toca || j(b).getArea() > areaMin) buracos.push(anel);
          }
          return fab.createPolygon(p.getExteriorRing(), buracos);
        }),
    ),
  linhas: (g: Geo): PtU[][] =>
    folhas(j(g))
      .filter((f) => f.getGeometryType() === 'LineString' || f.getGeometryType() === 'LinearRing')
      .map(pts),
  // retângulo envolvente [x0, y0, x1, y1]; vazio dá um retângulo invertido, que não cruza nada
  envelope: (g: Geo): [number, number, number, number] => {
    if (j(g).isEmpty()) return [Infinity, Infinity, -Infinity, -Infinity];
    const e = j(g).getEnvelopeInternal();
    return [e.getMinX(), e.getMinY(), e.getMaxX(), e.getMaxY()];
  },
  // a caixa encosta em g? Só sim ou não, sem montar a interseção (bem mais rápido contra a pista inteira).
  // Devolve o teste para a mesma g ser usada com muitas caixas; o retângulo do JSTS vai parte a parte
  encostaCaixa: (g: Geo): ((caixa: Geo) => boolean) => {
    const ps = folhas(j(g));
    return (caixa) => ps.some((p) => RectangleIntersects.intersects(caixa, p));
  },
  area: (g: Geo): number => j(g).getArea(),
  comprimento: (g: Geo): number => j(g).getLength(),
  distancia: (a: Geo, b: Geo): number => DistanceOp.distance(a, b),
  maisPerto: (g: Geo, p: PtU): PtU => {
    const c = DistanceOp.nearestPoints(g, fab.createPoint(coord(p)))[0];
    return [c.x, c.y];
  },
  trecho: (l: PtU[], de: number, ate: number): PtU[] => pts(new LengthIndexedLine(linha(l)).extractLine(de, ate)),
  noMeio: (l: PtU[], fracao: number): PtU => {
    const g = linha(l);
    const c = new LengthIndexedLine(g).extractPoint(fracao * j(g).getLength());
    return [c.x, c.y];
  },
};

// arredonda as quinas: cada passada troca cada lado por dois pontos a 1/4 e 3/4, mantendo as pontas
export function chaikin(p: PtU[], vezes = 2): PtU[] {
  let atual = p;
  for (let v = 0; v < vezes; v++) {
    const novo: PtU[] = [atual[0]];
    for (let i = 0; i + 1 < atual.length; i++) {
      const [ax, ay] = atual[i];
      const [bx, by] = atual[i + 1];
      novo.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    novo.push(atual[atual.length - 1]);
    atual = novo;
  }
  return atual;
}
