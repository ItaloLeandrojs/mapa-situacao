import type { ClasseTerra, Estradinha, Pt } from '../../src/nucleo/tipos.ts';
import { paraUtm } from '../../src/nucleo/utm.ts';
import { simplificar } from './montar.ts';

// células de download (0,25°) e de saída (0,1°) da base de estradinhas; usadas por baixar.ts e gerar-terra.ts
export const CELULA_BAIXAR_TERRA = 0.25;
export const CELULA_SAIDA_TERRA = 0.1;

// classes do OSM que entram; living_street e road são gravadas como residential
const PARA_CLASSE = new Map<string, ClasseTerra>(Object.entries({
  track: 'track',
  unclassified: 'unclassified',
  residential: 'residential',
  living_street: 'residential',
  road: 'residential',
} as Record<string, ClasseTerra>));

export function montarTerra(osm: { elements: any[] }, tolerancia: number): Estradinha[] {
  const lonlat = new Map<number, [number, number]>();
  for (const e of osm.elements) if (e.type === 'node') lonlat.set(e.id, [e.lon, e.lat]);
  const vias = osm.elements
    .filter((e) => e.type === 'way' && PARA_CLASSE.has(e.tags?.highway) && e.nodes.length >= 2)
    .sort((p, q) => p.id - q.id);

  // encontro: nó que é ponta de way ou aparece mais de uma vez; esse ponto não pode sumir na simplificação
  const usos = new Map<number, number>();
  const encontro = new Set<number>();
  for (const v of vias) {
    for (const id of v.nodes as number[]) usos.set(id, (usos.get(id) ?? 0) + 1);
    encontro.add(v.nodes[0]).add(v.nodes[v.nodes.length - 1]);
  }
  for (const [id, n] of usos) if (n > 1) encontro.add(id);

  const estradinhas: Estradinha[] = [];
  for (const v of vias) {
    const ids: number[] = v.nodes;
    const utm = ids.map((id): Pt => {
      const ll = lonlat.get(id);
      if (!ll) throw new Error(`Nó ${id} do way ${v.id} não veio no OSM`);
      return paraUtm(ll[0], ll[1]);
    });
    // corta o way nos encontros, simplifica cada pedaço e junta de volta
    const pts: Pt[] = [];
    let inicio = 0;
    for (let k = 1; k < ids.length; k++) {
      if (!encontro.has(ids[k]) && k < ids.length - 1) continue;
      const pedaco = simplificar(utm.slice(inicio, k + 1), tolerancia);
      pts.push(...(inicio === 0 ? pedaco : pedaco.slice(1)));
      inicio = k;
    }
    estradinhas.push({
      id: v.id,
      classe: PARA_CLASSE.get(v.tags.highway)!,
      pts: pts.map(([x, y]): Pt => [Math.round(x), Math.round(y)]),
    });
  }
  return estradinhas;
}
