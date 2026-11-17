import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import { chaikin, G } from '../src/nucleo/geom';
import type { PtU } from '../src/nucleo/tipos';

const perto = (a: PtU, b: PtU, tol = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;

test('engrossa de uma linha de comprimento 10 por 1 tem área entre 23 e 23,2', () => {
  const a = G.area(G.engrossa(G.linha([[0, 0], [10, 0]]), 1));
  expect(a).toBeGreaterThan(23);
  expect(a).toBeLessThan(23.2);
});

test('diferenca de linha por polígono devolve só o que sobra', () => {
  const sobra = G.diferenca(G.linha([[0, 0], [10, 0]]), G.caixa(3, -1, 6, 1));
  expect(G.comprimento(sobra)).toBeCloseTo(7, 9);
  const pedacos = G.linhas(sobra)
    .map((l) => [Math.min(l[0][0], l[l.length - 1][0]), Math.max(l[0][0], l[l.length - 1][0])])
    .sort((a, b) => a[0] - b[0]);
  expect(pedacos).toEqual([[0, 3], [6, 10]]);
  // nada do que sobra fica dentro da caixa
  expect(G.comprimento(G.intersecao(sobra, G.caixa(3.001, -1, 5.999, 1)))).toBe(0);
});

test('costura junta duas linhas que se tocam na ponta', () => {
  const duas = G.uniao([G.linha([[0, 0], [5, 0]]), G.linha([[5, 0], [5, 4]])]);
  expect(G.linhas(duas)).toHaveLength(2);
  const uma = G.linhas(G.costura(duas));
  expect(uma).toHaveLength(1);
  expect(uma[0]).toHaveLength(3);
  expect(G.comprimento(G.linha(uma[0]))).toBeCloseTo(9, 9);
  const pontas = [uma[0][0], uma[0][2]];
  expect(pontas.some((p) => perto(p, [0, 0]))).toBe(true);
  expect(pontas.some((p) => perto(p, [5, 4]))).toBe(true);
});

test('semBuracos fecha buraco menor que o mínimo e mantém o maior', () => {
  // quadrado 20 × 20 com um buraco de 1 × 1 e outro de 5 × 5
  const furado = G.diferenca(G.caixa(0, 0, 20, 20), G.uniao([G.caixa(2, 2, 3, 3), G.caixa(10, 10, 15, 15)]));
  expect(G.area(furado)).toBeCloseTo(400 - 1 - 25, 9);
  expect(G.area(G.semBuracos(furado, 4))).toBeCloseTo(400 - 25, 9);
  expect(G.area(G.semBuracos(furado, 30))).toBeCloseTo(400, 9);
  expect(G.area(G.semBuracos(furado, 0.5))).toBeCloseTo(400 - 1 - 25, 9);
});

test('trecho e noMeio em linha quebrada', () => {
  const l: PtU[] = [[0, 0], [3, 0], [3, 4]]; // comprimento 7
  const t = G.trecho(l, 2, 5);
  expect(t).toHaveLength(3);
  expect(perto(t[0], [2, 0])).toBe(true);
  expect(perto(t[1], [3, 0])).toBe(true);
  expect(perto(t[2], [3, 2])).toBe(true);
  expect(perto(G.noMeio(l, 0.5), [3, 0.5])).toBe(true);
  expect(perto(G.noMeio(l, 0), [0, 0])).toBe(true);
  expect(perto(G.noMeio(l, 1), [3, 4])).toBe(true);
});

test('chaikin mantém as pontas e multiplica os pontos', () => {
  const l: PtU[] = [[0, 0], [4, 0], [4, 4]];
  const uma = chaikin(l, 1);
  expect(uma).toHaveLength(6);
  expect(uma[0]).toEqual([0, 0]);
  expect(uma[uma.length - 1]).toEqual([4, 4]);
  expect(perto(uma[1], [1, 0])).toBe(true);
  expect(perto(uma[2], [3, 0])).toBe(true);
  const duas = chaikin(l);
  expect(duas).toHaveLength(12);
  expect(duas[0]).toEqual([0, 0]);
  expect(duas[duas.length - 1]).toEqual([4, 4]);
});

test('envelope de linha quebrada e de geometria vazia', () => {
  expect(G.envelope(G.linha([[1, 5], [4, 2], [3, 7]]))).toEqual([1, 2, 4, 7]);
  expect(G.envelope(G.engrossa(G.ponto([0, 0]), 2))).toEqual([-2, -2, 2, 2]);
  const [x0, y0, x1, y1] = G.envelope(G.uniao([]));
  expect(x0 > x1 && y0 > y1).toBe(true);
});

test('distancia e maisPerto', () => {
  const l = G.linha([[0, 0], [10, 0]]);
  expect(G.distancia(l, G.ponto([4, 3]))).toBeCloseTo(3, 9);
  expect(perto(G.maisPerto(l, [4, 3]), [4, 0])).toBe(true);
});

test('encostaCaixa: diz se a caixa encosta, contra polígono, buraco, coleção mista e vazio', () => {
  const pista = G.uniao([G.caixa(0, 0, 10, 1), G.caixa(0, 5, 10, 6)]);
  const toca = G.encostaCaixa(pista);
  expect(toca(G.caixa(2, 0.5, 3, 2))).toBe(true);
  expect(toca(G.caixa(2, 2, 3, 4))).toBe(false);
  // caixa toda dentro do polígono e caixa dentro do buraco
  const anel = G.diferenca(G.caixa(0, 0, 10, 10), G.caixa(3, 3, 7, 7));
  expect(G.encostaCaixa(anel)(G.caixa(1, 1, 2, 2))).toBe(true);
  expect(G.encostaCaixa(anel)(G.caixa(4, 4, 5, 5))).toBe(false);
  const mista = G.uniao([G.caixa(0, 0, 1, 1), G.linha([[5, 5], [6, 6]])]);
  expect(G.encostaCaixa(mista)(G.caixa(5.4, 5.4, 5.6, 5.6))).toBe(true);
  expect(G.encostaCaixa(mista)(G.caixa(3, 3, 4, 4))).toBe(false);
  expect(G.encostaCaixa(G.uniao([]))(G.caixa(0, 0, 1, 1))).toBe(false);
});

// Achado na conferência das regiões (iguatu): duas linhas num MultiLineString, a segunda terminando em cima da
// primeira, contra o polígono de uma pista. O JSTS lançava TopologyException (non-noded intersection) na diferença
// com o conjunto, e cada linha sozinha passava.
const LINHA_1: PtU[] = [
  [47.94927687554944, 88.39094160593056],
  [48.2948254654962, 88.20087373287477],
  [48.9429147050093, 88.06642066420616],
  [49.540955168172545, 87.7912584298252],
  [50.08894685498595, 87.37538702973188],
  [50.58688976544953, 86.81880646392622],
  [51.03478389956328, 86.12151673240825],
  [51.38671586715881, 85.45264452644481],
  [51.642685668236126, 84.81218984603595],
  [51.802693302795234, 84.20015269118164],
  [51.866738770836115, 83.61653306188191],
  [52.03618356873237, 83.07416125885354],
  [52.31102769648399, 82.57303728209655],
  [52.69127115409097, 82.11316113161091],
  [53.17691394155332, 81.69453280739663],
  [53.68376383763849, 81.07676973321418],
  [54.211820842346455, 80.25987190906352],
  [54.76108495567724, 79.2438393349447],
  [55.33155617763083, 78.02867201085769],
  [55.91655426899105, 77.0190015693257],
  [56.516079229757885, 76.21482801034875],
  [57.13013105993135, 75.61615133392681],
  [57.75870975951145, 75.22297154005992],
  [58.327590448318325, 74.7966026211983],
  [58.83677312635199, 74.33704457734203],
  [59.28625779361245, 73.84429740849103],
  [59.6760444500997, 73.31836111464534],
  [59.99658989693348, 72.3731602833267],
  [60.24789413411377, 71.00869491453508],
  [60.4299571616406, 69.22496500827053],
  [60.542778979513955, 67.02197056453302],
  [60.70342282733174, 65.32126648852677],
  [60.91188870509396, 64.12285278025176],
  [61.16817661280062, 63.426729439708026],
  [61.47228655045172, 63.23289646689554],
  [61.89102091020911, 62.77174788989253],
  [62.424379692072776, 62.04328370869901],
  [63.07236289604274, 61.04750392331496],
  [63.834970522118994, 59.7844085337404],
  [64.40374517538277, 58.67877592569019],
  [64.77868685583405, 57.730606099164355],
  [64.95979556347285, 56.93989905416288],
  [64.94707129829916, 56.30665479068577],
  [65.24380457845098, 55.41763333667106],
  [65.84999540392832, 54.27283469211875],
  [66.76564377473115, 52.87225885702884],
  [67.99074969085949, 51.21590583140133],
  [68.90957912795574, 49.973641062180704],
  [69.52213208601991, 49.14546454936695],
  [69.82840856505199, 48.73137629296007],
];
const LINHA_2: PtU[] = [
  [70.1, 53.718508001484494],
  [69.95651162303942, 53.614223575579935],
  [69.66953486911827, 53.40565472377082],
  [69.23906973823654, 53.092801446057166],
  [68.66511623039423, 52.67566374243895],
  [68.21726601790503, 52.34995175284433],
  [67.89551910076895, 52.115665477273325],
  [67.69987547898597, 51.97280491572593],
  [67.6303351525561, 51.92137006820214],
  [67.5781799077337, 51.88279393255929],
  [67.54340974451878, 51.8570765087974],
  [67.52602466291131, 51.844217796916446],
];
const POLIGONO: PtU[] = [
  [79.38216722562262, 59.71340948034914],
  [79.17752630533154, 59.63027410648089],
  [68.87317267414718, 52.17455279259742],
  [68.73687601942237, 52.073161378716755],
  [68.73309341123367, 52.07037336730593],
  [68.48466132988042, 51.88895257105455],
  [68.46834664978199, 51.87590082697581],
  [68.44864704566109, 51.86088019893723],
  [68.01113348680983, 51.543124001085395],
  [68.00690321471929, 51.53914256852959],
  [67.95692286420903, 51.49756096834784],
  [67.90602580351428, 51.460236457171696],
  [67.71800992548947, 51.3725478810238],
  [67.51074893869571, 51.36348476182737],
  [67.31579644954684, 51.43442687732269],
  [67.16283220726706, 51.574573933517485],
  [67.07514363111916, 51.762589811542306],
  [67.06608051192273, 51.96985079833606],
  [67.13702262741806, 52.16480328748493],
  [67.27716968361285, 52.3177675297647],
  [67.30180304475829, 52.33583199460468],
  [67.30692806152437, 52.340655539796295],
  [67.35888571932158, 52.38368017770099],
  [67.81372073138647, 52.71401655507659],
  [67.82949446656004, 52.726635543215444],
  [67.84807467630911, 52.74084095173377],
  [68.10405565303806, 52.92777442816083],
  [68.24128914153941, 53.02986275497282],
  [68.24696062231185, 53.034023790744335],
  [78.60620904238212, 60.529464262390334],
  [78.71777064096752, 60.59130016258638],
  [79.04351182941389, 60.72363252039271],
  [79.17094356009584, 60.75773827490457],
  [79.97002741300332, 60.86801523974318],
  [80.17712289151154, 60.85573845035272],
  [80.36375604147857, 60.76514416736709],
  [80.50151365765561, 60.61002454913165],
  [80.56942339175563, 60.4139951513599],
  [80.55714660236517, 60.20689967285167],
  [80.46655231937955, 60.020266522884654],
  [80.3114327011441, 59.882508906707606],
  [80.11540330337235, 59.81459917260759],
  [79.38216722562262, 59.71340948034914],
];

test('diferenca de duas linhas que se tocam num MultiLineString contra um polígono não lança e tira o mesmo de cada linha', () => {
  const fab = new GeometryFactory();
  const co = (pts: PtU[]) => pts.map(([x, y]) => new Coordinate(x, y));
  const multi = fab.createMultiLineString([LINHA_1, LINHA_2].map((l) => fab.createLineString(co(l))));
  const poligono = fab.createPolygon(co(POLIGONO));
  const sobra = G.diferenca(multi, poligono);
  const separadas = [LINHA_1, LINHA_2].map((l) => G.comprimento(G.diferenca(G.linha(l), poligono)));
  expect(G.comprimento(sobra)).toBeCloseTo(separadas[0] + separadas[1], 6);
  expect(G.comprimento(sobra)).toBeGreaterThan(0);
});
