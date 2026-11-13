import type { Aresta, Classe, Lugar, Pt } from '../../src/nucleo/tipos.ts';
import { paraUtm } from '../../src/nucleo/utm.ts';

export interface Ibge { municipios: string[]; distritos: string[] }
export interface Ajustes {
  remover: string[];
  forcarSede: string[];
  acrescentar: { nome: string; tipo: 'sede' | 'distrito'; lon: number; lat: number }[];
}

// grade da base: células de 0,5° cobrindo o Ceará mais uns 40 km de vizinhos (usada por baixar.ts e gerar.ts)
export const GRADE = { celula: 0.5, oeste: -41.9, sul: -8.2, colunas: 10, linhas: 12 };

const CLASSES: readonly string[] = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const LUGARES_OSM: readonly string[] = ['city', 'town', 'village'];

// maiúsculas, sem acento, espaços simples
export function normalizar(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// nome guardado: maiúsculas com acento, espaços simples
const maiusculas = (nome: string) => nome.toLocaleUpperCase('pt-BR').replace(/\s+/g, ' ').trim();

const distancia = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);

function distanciaAoSegmento(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return distancia(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Douglas-Peucker sem recursão, mantendo as pontas
function simplificar(pts: Pt[], tolerancia: number): Pt[] {
  if (tolerancia <= 0 || pts.length <= 2) return pts.slice();
  const fica = new Array<boolean>(pts.length).fill(false);
  fica[0] = fica[pts.length - 1] = true;
  const pilha: [number, number][] = [[0, pts.length - 1]];
  while (pilha.length) {
    const [i, j] = pilha.pop()!;
    let maior = -1;
    let onde = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distanciaAoSegmento(pts[k], pts[i], pts[j]);
      if (d > maior) [maior, onde] = [d, k];
    }
    if (onde >= 0 && maior > tolerancia) {
      fica[onde] = true;
      pilha.push([i, onde], [onde, j]);
    }
  }
  return pts.filter((_, k) => fica[k]);
}

function montarArestas(elementos: any[], tolerancia: number) {
  const coord = new Map<number, Pt>();
  for (const e of elementos) if (e.type === 'node') coord.set(e.id, paraUtm(e.lon, e.lat));
  const vias = elementos
    .filter((e) => e.type === 'way' && CLASSES.includes(e.tags?.highway))
    .sort((p, q) => p.id - q.id);

  // entroncamento: aparece mais de uma vez (na mesma via ou em vias diferentes) ou é ponta de via
  const usos = new Map<number, number>();
  const entroncamento = new Set<number>();
  for (const v of vias) {
    for (const id of v.nodes as number[]) usos.set(id, (usos.get(id) ?? 0) + 1);
    entroncamento.add(v.nodes[0]).add(v.nodes[v.nodes.length - 1]);
  }
  for (const [id, n] of usos) if (n > 1) entroncamento.add(id);

  const nos = new Map<number, Pt>();
  const arestas: Aresta[] = [];
  for (const v of vias) {
    const ids: number[] = v.nodes;
    for (const id of ids) if (!coord.has(id)) throw new Error(`Nó ${id} da via ${v.id} não veio no OSM`);
    let inicio = 0;
    for (let k = 1; k < ids.length; k++) {
      if (!entroncamento.has(ids[k])) continue;
      const pedaco = ids.slice(inicio, k + 1).map((id) => coord.get(id)!);
      let m = 0;
      for (let i = 1; i < pedaco.length; i++) m += distancia(pedaco[i - 1], pedaco[i]);
      const a = ids[inicio];
      const b = ids[k];
      nos.set(a, coord.get(a)!).set(b, coord.get(b)!);
      arestas.push({
        id: arestas.length + 1,
        a,
        b,
        ref: v.tags.ref ?? '',
        classe: v.tags.highway as Classe,
        m,
        pts: simplificar(pedaco, tolerancia),
      });
      inicio = k;
    }
  }
  return { nos: [...nos].map(([id, [x, y]]) => [id, x, y] as [number, number, number]), arestas };
}

// ordem para escolher sedes quando há mais candidatos que municípios com o nome:
// tem ref:LOCODE, depois tem wikidata, depois city > town > village, depois o menor id
function melhorSede(p: any, q: any): number {
  const pontos = (e: any) => [e.tags['ref:LOCODE'] ? 0 : 1, e.tags.wikidata ? 0 : 1, LUGARES_OSM.indexOf(e.tags.place), e.id];
  const a = pontos(p);
  const b = pontos(q);
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k];
  return 0;
}

// sede: nome em forcarSede, ou nome de município com sinal de sede no OSM (ref:LOCODE ou wikidata),
// no máximo tantas quantos municípios do IBGE têm o nome; quem sobra cai na regra de distrito
function escolherSedes(nos: { e: any; chave: string }[], ibge: Ibge, forcar: Set<string>): Set<number> {
  const teto = new Map<string, number>();
  for (const m of ibge.municipios) teto.set(normalizar(m), (teto.get(normalizar(m)) ?? 0) + 1);
  const sedes = new Set<number>();
  const candidatos = new Map<string, any[]>();
  for (const { e, chave } of nos) {
    if (forcar.has(chave)) sedes.add(e.id);
    else if (teto.has(chave) && (e.tags['ref:LOCODE'] || e.tags.wikidata)) {
      if (!candidatos.has(chave)) candidatos.set(chave, []);
      candidatos.get(chave)!.push(e);
    }
  }
  for (const [chave, lista] of candidatos) {
    for (const e of lista.sort(melhorSede).slice(0, teto.get(chave))) sedes.add(e.id);
  }
  return sedes;
}

function montarLugares(elementos: any[], ibge: Ibge, ajustes: Ajustes): Lugar[] {
  const conjunto = (nomes: string[]) => new Set(nomes.map(normalizar));
  const distritos = conjunto(ibge.distritos);
  const remover = conjunto(ajustes.remover);
  const nos = elementos
    .filter((e) => e.type === 'node' && LUGARES_OSM.includes(e.tags?.place) && typeof e.tags.name === 'string' && e.tags.name.trim())
    .map((e) => ({ e, chave: normalizar(e.tags.name) }))
    .filter(({ chave }) => !remover.has(chave));
  const sedes = escolherSedes(nos, ibge, conjunto(ajustes.forcarSede));
  const lugares: Lugar[] = [];
  for (const { e, chave } of nos) {
    const tipo = sedes.has(e.id) ? 'sede' : distritos.has(chave) ? 'distrito' : null;
    if (!tipo) continue;
    lugares.push({ nome: maiusculas(e.tags.name), tipo, osm: e.tags.place, ponto: paraUtm(e.lon, e.lat) });
  }
  // lugar acrescentado não tem classe no OSM: entra como village, a menor
  for (const l of ajustes.acrescentar) {
    lugares.push({ nome: maiusculas(l.nome), tipo: l.tipo, osm: 'village', ponto: paraUtm(l.lon, l.lat) });
  }
  return lugares;
}

export function montarBase(
  osm: { elements: any[] },
  ibge: Ibge,
  ajustes: Ajustes,
  tolerancia = 10,
): { nos: [number, number, number][]; arestas: Aresta[]; lugares: Lugar[] } {
  return { ...montarArestas(osm.elements, tolerancia), lugares: montarLugares(osm.elements, ibge, ajustes) };
}
