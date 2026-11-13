import type { ArquivoGoogle, Pt } from './tipos.ts';

export interface CandidatoObra { rotulo: string; ponto: Pt; origem: 'alfinete' | 'ponta' }

// Palavra inteira OBRA, sem ligar para maiúscula nem acento: antes e depois não há letra.
function temPalavraObra(nome: string): boolean {
  const limpo = nome.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return /(^|[^a-z])obra($|[^a-z])/.test(limpo);
}

export function candidatosObra(a: ArquivoGoogle): CandidatoObra[] {
  const lista: CandidatoObra[] = a.alfinetes.map((p) => ({
    rotulo: p.nome === '' ? 'Alfinete sem nome' : p.nome,
    ponto: p.ponto,
    origem: 'alfinete',
  }));
  for (const c of a.caminhos) {
    if (c.pontos.length === 0) continue;
    const inicio = c.nome === '' ? 'Início do caminho' : `Início de ${c.nome}`;
    const fim = c.nome === '' ? 'Fim do caminho' : `Fim de ${c.nome}`;
    lista.push({ rotulo: inicio, ponto: c.pontos[0], origem: 'ponta' });
    lista.push({ rotulo: fim, ponto: c.pontos[c.pontos.length - 1], origem: 'ponta' });
  }
  return lista;
}

export function escolherObra(a: ArquivoGoogle): CandidatoObra | null {
  const alfinetes = candidatosObra(a).filter((c) => c.origem === 'alfinete');
  const comObra = alfinetes.find((c) => temPalavraObra(c.rotulo));
  if (comObra) return comObra;
  return alfinetes.length === 1 ? alfinetes[0] : null;
}

const sete = (v: number) => String(Math.round(v)).padStart(7, '0');

export function textoCoordenada(p: Pt): string {
  return `${sete(p[0])},${sete(p[1])}`;
}
