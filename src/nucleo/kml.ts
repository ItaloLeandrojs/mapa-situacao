import { unzipSync } from 'fflate';
import type { Alfinete, ArquivoGoogle, Caminho, Pt } from './tipos.ts';
import { paraUtm } from './utm.ts';

const ERRO_FORMATO = 'Este arquivo não é um KML nem um KMZ';
const ERRO_SEM_CAMINHO = 'Não achei nenhum caminho neste arquivo';

type Geo = [number, number]; // lon, lat

const nomeLocal = (el: Element): string => (el.localName || el.tagName).split(':').pop() ?? '';
const descendentes = (raiz: Element, nome: string): Element[] =>
  Array.from(raiz.getElementsByTagName('*')).filter((e) => nomeLocal(e) === nome);

function textoDoKml(bytes: Uint8Array): string {
  const ehZip = bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  if (!ehZip) return new TextDecoder('utf-8').decode(bytes);
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(bytes);
  } catch {
    throw new Error(ERRO_FORMATO);
  }
  const nomes = Object.keys(arquivos);
  const nome = nomes.find((n) => n.toLowerCase() === 'doc.kml') ?? nomes.find((n) => n.toLowerCase().endsWith('.kml'));
  if (!nome) throw new Error(ERRO_FORMATO);
  return new TextDecoder('utf-8').decode(arquivos[nome]);
}

function lerDocumento(texto: string): Document {
  const limpo = texto.replace(/^\uFEFF/, '');
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(limpo, 'text/xml');
  } catch {
    throw new Error(ERRO_FORMATO);
  }
  const raiz = doc.documentElement;
  if (!raiz || nomeLocal(raiz) !== 'kml' || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(ERRO_FORMATO);
  }
  return doc;
}

// Aceita "lon,lat[,alt]" (KML) ou "lon lat [alt]" (gx:coord). Devolve null se malformada.
function lerPar(partes: string[]): Geo | null {
  if (partes.length < 2 || partes[0].trim() === '' || partes[1].trim() === '') return null;
  const lon = Number(partes[0]);
  const lat = Number(partes[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function montarCaminho(nome: string, geos: Geo[]): Caminho | null {
  const unicos = geos.filter((g, i) => i === 0 || g[0] !== geos[i - 1][0] || g[1] !== geos[i - 1][1]);
  if (unicos.length < 2) return null;
  return { nome, pontos: unicos.map(([lon, lat]): Pt => paraUtm(lon, lat)) };
}

export function lerArquivoGoogle(bytes: Uint8Array): ArquivoGoogle {
  const doc = lerDocumento(textoDoKml(bytes));
  const caminhos: Caminho[] = [];
  const alfinetes: Alfinete[] = [];

  for (const placemark of descendentes(doc.documentElement, 'Placemark')) {
    const filhoNome = Array.from(placemark.children).find((e) => nomeLocal(e) === 'name');
    const nome = (filhoNome?.textContent ?? '').trim();

    for (const geom of Array.from(placemark.getElementsByTagName('*'))) {
      const tipo = nomeLocal(geom);
      if (tipo === 'LineString') {
        const coords = descendentes(geom, 'coordinates')[0]?.textContent ?? '';
        const geos = coords
          .split(/\s+/)
          .map((trio) => lerPar(trio.split(',')))
          .filter((g): g is Geo => g !== null);
        const c = montarCaminho(nome, geos);
        if (c) caminhos.push(c);
      } else if (tipo === 'Track') {
        const geos = descendentes(geom, 'coord')
          .map((e) => lerPar((e.textContent ?? '').trim().split(/\s+/)))
          .filter((g): g is Geo => g !== null);
        const c = montarCaminho(nome, geos);
        if (c) caminhos.push(c);
      } else if (tipo === 'Point') {
        const coords = descendentes(geom, 'coordinates')[0]?.textContent ?? '';
        const g = lerPar(coords.trim().split(','));
        if (g) alfinetes.push({ nome, ponto: paraUtm(g[0], g[1]) });
      }
    }
  }

  if (caminhos.length === 0) throw new Error(ERRO_SEM_CAMINHO);
  return { caminhos, alfinetes };
}
