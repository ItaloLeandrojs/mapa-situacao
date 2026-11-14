export type Pt = [number, number]; // UTM 24S em metros (E, N)
export type PtU = [number, number]; // unidade da prancha; origem no canto inferior esquerdo do quadro
export interface Caminho { nome: string; pontos: Pt[] }
export interface Alfinete { nome: string; ponto: Pt }
export interface ArquivoGoogle { caminhos: Caminho[]; alfinetes: Alfinete[] }
export type Classe = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary';
// a, b: ids dos nós das pontas; m: comprimento real em metros; pts inclui as duas pontas
export interface Aresta { id: number; a: number; b: number; ref: string; classe: Classe; m: number; pts: Pt[] }
export interface Lugar { nome: string; tipo: 'sede' | 'distrito'; osm: 'city' | 'town' | 'village'; ponto: Pt }
export interface Base { data: string; nos: Map<number, Pt>; arestas: Aresta[]; lugares: Lugar[] }
export interface Janela { x0: number; y0: number; x1: number; y1: number } // UTM
export interface Quadro { w: number; h: number }
export type Camada = 'ESTRADA' | 'ESTRADA_EIXO' | 'CARROÇAL' | 'ROTA' | 'CIDADE' | 'TEXTO' | 'LOCAL_DA_OBRA' | 'TITULO';
export type Primitiva =
  | { t: 'linha'; camada: Camada; pts: PtU[]; fechada?: boolean; largura?: number }
  | { t: 'texto'; camada: Camada; id: string; txt: string; centro: PtU; h: number }
  | { t: 'circulo'; camada: Camada; centro: PtU; r: number };
export interface Desenho { quadro: Quadro; prims: Primitiva[] }
