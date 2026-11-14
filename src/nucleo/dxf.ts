// gravação do DXF (formato R12, bytes em Windows-1252, linhas em CRLF)
import type { Camada, Desenho } from './tipos.ts';

const CAMADAS: [Camada, number][] = [
  ['ESTRADA', 30], ['ESTRADA_EIXO', 7], ['ROTA', 2], ['CIDADE', 7], ['TEXTO', 7], ['LOCAL_DA_OBRA', 1], ['TITULO', 7],
];

// caracteres do Windows-1252 entre 0x80 e 0x9F que não existem no Latin-1
const ESPECIAIS_1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b,
  'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99,
  'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function byteDe(c: string): number {
  const cod = c.codePointAt(0)!;
  if (cod < 0x80 || (cod >= 0xa0 && cod <= 0xff)) return cod;
  return ESPECIAIS_1252[c] ?? 0x3f; // fora do Windows-1252 vira "?"
}

const n4 = (v: number): string => {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};

export function paraDxf(d: Desenho): Uint8Array {
  const l: string[] = [];
  const g = (codigo: number, valor: string | number) => l.push(String(codigo), String(valor));
  const secao = (nome: string) => { g(0, 'SECTION'); g(2, nome); };
  const fim = () => g(0, 'ENDSEC');

  secao('HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252');
  fim();

  secao('TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, n4(0));
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, CAMADAS.length);
  for (const [nome, cor] of CAMADAS) { g(0, 'LAYER'); g(2, nome); g(70, 0); g(62, cor); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 2);
  for (const [nome, arquivo] of [['STANDARD', 'txt'], ['ARIAL', 'arial.ttf']]) {
    g(0, 'STYLE'); g(2, nome); g(70, 0); g(40, n4(0)); g(41, n4(1)); g(50, n4(0)); g(71, 0); g(42, n4(2.5)); g(3, arquivo); g(4, '');
  }
  g(0, 'ENDTAB');
  fim();

  secao('ENTITIES');
  for (const p of d.prims) {
    if (p.t === 'linha') {
      g(0, 'POLYLINE'); g(8, p.camada); g(66, 1);
      g(10, n4(0)); g(20, n4(0)); g(30, n4(0));
      g(70, p.fechada ? 1 : 0);
      if (p.largura !== undefined) { g(40, n4(p.largura)); g(41, n4(p.largura)); }
      for (const [x, y] of p.pts) { g(0, 'VERTEX'); g(8, p.camada); g(10, n4(x)); g(20, n4(y)); g(30, n4(0)); }
      g(0, 'SEQEND'); g(8, p.camada);
    } else if (p.t === 'texto') {
      g(0, 'TEXT'); g(8, p.camada); g(7, 'ARIAL');
      g(10, n4(p.centro[0])); g(20, n4(p.centro[1])); g(30, n4(0));
      g(40, n4(p.h)); g(1, p.txt); g(72, 1); g(73, 2);
      g(11, n4(p.centro[0])); g(21, n4(p.centro[1])); g(31, n4(0));
    } else {
      g(0, 'CIRCLE'); g(8, p.camada);
      g(10, n4(p.centro[0])); g(20, n4(p.centro[1])); g(30, n4(0)); g(40, n4(p.r));
    }
  }
  fim();
  g(0, 'EOF');

  const texto = l.join('\r\n') + '\r\n';
  const bytes: number[] = [];
  for (const c of texto) bytes.push(byteDe(c));
  return Uint8Array.from(bytes);
}

export function nomeDoArquivo(agora: Date): string {
  const d2 = (n: number) => String(n).padStart(2, '0');
  const data = `${agora.getFullYear()}${d2(agora.getMonth() + 1)}${d2(agora.getDate())}`;
  const hora = `${d2(agora.getHours())}${d2(agora.getMinutes())}${d2(agora.getSeconds())}`;
  return `mapa-situacao-${data}-${hora}.dxf`;
}
