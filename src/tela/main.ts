/// <reference types="vite/client" />
// entrada do site: estado, painel, prévia e arrasto
import type { Buscar, Indice } from '../nucleo/base.ts';
import { ligarArrasto, FATOR_ZOOM } from './arrasto.ts';
import { criarEstado, type Estado } from './estado.ts';
import { montarPainel } from './painel.ts';
import { desenharEscolha, desenharSvg } from './previa.ts';
import './estilo.css';

// só os arquivos de base/ do próprio site; o KML nunca sai do navegador
const buscar: Buscar = async (caminho) => {
  const r = await fetch(new URL(`base/${caminho}`, new URL(import.meta.env.BASE_URL, location.origin)));
  if (!r.ok) throw new Error(`${caminho}: ${r.status}`);
  return r.json();
};

const estado = criarEstado(buscar);
const palco = document.getElementById('palco')!;
const vazio = document.getElementById('vazio')!;
const vista = ligarArrasto(palco, estado);
const painel = montarPainel(estado, vista, FATOR_ZOOM);

// a prévia só é refeita quando muda o que ela mostra
let mostrado: unknown = null;
function mostrarPrevia(e: Estado) {
  palco.classList.toggle('ocupado', e.ocupado);
  const fonte = e.desenho ?? (e.arquivo && !e.obra ? e.candidatos : null);
  if (fonte === mostrado) return;
  mostrado = fonte;
  let svg: SVGSVGElement | null = null;
  if (e.desenho) {
    svg = desenharSvg(e.desenho);
    svg.classList.add('desenho');
    svg.setAttribute('aria-label', 'Prévia do mapa de situação');
  } else if (e.arquivo && !e.obra) {
    svg = desenharEscolha(e.arquivo, e.candidatos, (p) => void estado.escolherObra(p));
    svg.classList.add('escolha');
    svg.setAttribute('aria-label', 'Rota do arquivo: escolha o ponto da obra');
  }
  if (svg) {
    svg.setAttribute('role', 'img');
    const [, , w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    palco.style.setProperty('--proporcao', String(w / h));
    palco.replaceChildren(svg);
  } else palco.replaceChildren(vazio);
}

estado.aoMudar((e) => {
  painel.mostrar(e);
  mostrarPrevia(e);
});
painel.mostrar(estado.ler());

// data da base no cabeçalho e no rodapé
void (async () => {
  try {
    const indice = (await buscar('indice.json')) as Indice;
    const data = indice.data.split('-').reverse().join('/');
    document.getElementById('base-data')!.textContent = `Base do Ceará de ${data}`;
    document.getElementById('credito-data')!.textContent = `Base de ${data}.`;
  } catch {
    // sem a data: o aviso de carga aparece quando abrir um arquivo
  }
})();
