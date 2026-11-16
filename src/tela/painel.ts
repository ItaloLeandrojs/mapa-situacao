// painel da esquerda, barra de status e aviso: liga os controles ao estado e mostra o estado
import { paraDxf, nomeDoArquivo } from '../nucleo/dxf.ts';
import { escala, MEDIDAS } from '../nucleo/medidas.ts';
import { textoCoordenada } from '../nucleo/obra.ts';
import type { Canto, Pt } from '../nucleo/tipos.ts';
import type { Estado, EstadoDaTela } from './estado.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const decimal = (v: number) => String(Number(v.toFixed(2))).replace('.', ',');
const mesmoPonto = (a: Pt | null, b: Pt) => a !== null && a[0] === b[0] && a[1] === b[1];

export function montarPainel(estado: EstadoDaTela, vista: { aproximar(fator: number): void }, fatorZoom: number) {
  const entrada = $<HTMLInputElement>('entrada');
  const largura = $<HTMLInputElement>('largura');
  const altura = $<HTMLInputElement>('altura');
  let nomeArquivo = '';

  async function abrir(f: File) {
    await estado.abrirArquivo(new Uint8Array(await f.arrayBuffer()));
    if (estado.ler().aviso === null) nomeArquivo = f.name;
    mostrar(estado.ler());
  }

  // arquivo: botão Abrir ou soltar em qualquer lugar da página
  $('abrir').addEventListener('click', () => entrada.click());
  entrada.addEventListener('change', () => {
    const f = entrada.files?.[0];
    entrada.value = '';
    if (f) void abrir(f);
  });
  document.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    document.body.classList.add('soltando');
  });
  document.addEventListener('dragleave', (ev) => {
    if (ev.relatedTarget === null) document.body.classList.remove('soltando');
  });
  document.addEventListener('drop', (ev) => {
    ev.preventDefault();
    document.body.classList.remove('soltando');
    const f = ev.dataTransfer?.files[0];
    if (f) void abrir(f);
  });

  // área
  for (const [id, f] of [['afastar', 1 / fatorZoom], ['aproximar', fatorZoom], ['menos', 1 / fatorZoom], ['mais', fatorZoom]] as const) {
    $(id).addEventListener('click', () => vista.aproximar(f));
  }
  $('proposta').addEventListener('click', () => {
    const { obra } = estado.ler();
    if (obra) void estado.escolherObra(obra);
  });
  $('centralizar').addEventListener('click', () => {
    const { obra, janela, quadro } = estado.ler();
    if (!obra || !janela) return;
    const k = escala(janela, quadro).k;
    void estado.moverArea((obra[0] - (janela.x0 + janela.x1) / 2) * k, (obra[1] - (janela.y0 + janela.y1) / 2) * k);
  });
  $('desfazer').addEventListener('click', () => estado.desfazerAjustes());

  // quadro: só aceita medida que deixa área útil para o mapa
  function lerQuadro() {
    const w = Number(largura.value.replace(',', '.'));
    const h = Number(altura.value.replace(',', '.'));
    const atual = estado.ler().quadro;
    if (Number.isFinite(w) && Number.isFinite(h) && w > 2 * MEDIDAS.margem + 10 && h > MEDIDAS.margem + MEDIDAS.topo + 10) {
      if (w !== atual.w || h !== atual.h) void estado.mudarQuadro({ w, h });
    } else mostrar(estado.ler());
  }
  largura.addEventListener('change', lerQuadro);
  altura.addEventListener('change', lerQuadro);
  $<HTMLInputElement>('credito').addEventListener('change', (ev) => estado.mudarCredito((ev.target as HTMLInputElement).checked));

  // detalhe da chegada
  $<HTMLInputElement>('det-ligado').addEventListener('change', (ev) => void estado.ligarDetalhe((ev.target as HTMLInputElement).checked));
  const cantos = [...document.querySelectorAll<HTMLButtonElement>('#det-cantos button')];
  for (const b of cantos) {
    b.addEventListener('click', () => void estado.mudarCanto(b.dataset.canto === 'auto' ? null : (b.dataset.canto as Canto)));
  }
  $('det-afastar').addEventListener('click', () => void estado.aproximarDetalhe(1 / fatorZoom));
  $('det-aproximar').addEventListener('click', () => void estado.aproximarDetalhe(fatorZoom));
  $('det-proposta').addEventListener('click', () => void estado.propostaDetalhe());
  $('det-aceitar').addEventListener('click', () => void estado.aceitarSugestao());
  $('det-recusar').addEventListener('click', () => void estado.recusarSugestao());

  $('baixar').addEventListener('click', () => {
    const { desenho } = estado.ler();
    if (!desenho) return;
    const url = URL.createObjectURL(new Blob([paraDxf(desenho) as Uint8Array<ArrayBuffer>], { type: 'application/dxf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeDoArquivo(new Date());
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function mostrarObra(e: Estado) {
    const escolhido = e.candidatos.find((c) => mesmoPonto(e.obra, c.ponto));
    $('obra-nome').textContent = !e.arquivo
      ? 'Sem arquivo'
      : e.obra
        ? (escolhido?.rotulo ?? 'Ponto escolhido')
        : 'Escolha a obra na prévia ou na lista';
    $('obra-coord').textContent = e.obra ? textoCoordenada(e.obra) : '';
    const outros = $<HTMLDetailsElement>('obra-outros');
    outros.hidden = e.candidatos.length === 0;
    if (!e.obra && e.arquivo) outros.open = true;
    $('obra-lista').replaceChildren(
      ...e.candidatos.map((c) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', String(mesmoPonto(e.obra, c.ponto)));
        b.append(c.rotulo);
        const code = document.createElement('code');
        code.textContent = textoCoordenada(c.ponto);
        b.append(code);
        b.addEventListener('click', () => void estado.escolherObra(c.ponto));
        li.append(b);
        return li;
      }),
    );
  }

  // ficha de liga e desliga; chave: o que identifica a ficha entre uma mostra e outra, para o foco ficar nela
  function ficha(chave: string, texto: string, ligado: boolean, aoMudar: (v: boolean) => void, classe = 'ficha', titulo = '') {
    const foco = (document.activeElement as HTMLInputElement | null)?.dataset?.ficha;
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.className = classe;
    if (titulo) label.title = titulo;
    const caixa = document.createElement('input');
    caixa.type = 'checkbox';
    caixa.checked = ligado;
    caixa.dataset.ficha = chave;
    caixa.addEventListener('change', () => aoMudar(caixa.checked));
    const span = document.createElement('span');
    span.textContent = texto;
    label.append(caixa, span);
    li.append(label);
    if (chave === foco) queueMicrotask(() => caixa.focus());
    return li;
  }

  function mostrarFichas(e: Estado) {
    const ligados = new Set(e.ligados);
    const nomes = [...new Set(e.lugaresNaJanela.map((l) => l.nome))];
    $('contagem').textContent = nomes.length ? `${nomes.filter((n) => ligados.has(n)).length} de ${nomes.length} ligadas` : '';
    $('fichas').replaceChildren(
      ...nomes.map((nome) => {
        const sede = e.lugaresNaJanela.find((l) => l.nome === nome)!.tipo === 'sede';
        return ficha(`lugar:${nome}`, nome, ligados.has(nome), (v) => void estado.ligarLugar(nome, v),
          sede ? 'ficha' : 'ficha distrito', sede ? 'Sede de município' : 'Distrito');
      }),
    );
  }

  function mostrarDetalhe(e: Estado) {
    const d = e.detalhe;
    const ligado = $<HTMLInputElement>('det-ligado');
    ligado.checked = d.ligado;
    ligado.disabled = !d.disponivel;
    $('det-sem').hidden = d.disponivel || !e.obra;
    for (const b of cantos) {
      b.disabled = !d.ligado;
      b.setAttribute('aria-pressed', String(b.dataset.canto === 'auto' ? d.automatico : !d.automatico && b.dataset.canto === d.canto));
    }
    for (const id of ['det-afastar', 'det-aproximar', 'det-proposta']) $<HTMLButtonElement>(id).disabled = !d.ligado;
    $('det-sugestao').hidden = !d.ligado || d.sugestao !== 'pendente';
    const desligadas = new Set(d.viradasDesligadas);
    $('det-viradas-grupo').hidden = !d.ligado || d.viradas.length === 0;
    $('det-viradas').replaceChildren(
      ...d.viradas.map((v) => ficha(`virada:${v.id}`, textoCoordenada(v.ponto), !desligadas.has(v.id), (on) => void estado.ligarVirada(v.id, on))),
    );
    const refsDesligadas = new Set(d.refsDesligadas);
    $('det-refs-grupo').hidden = !d.ligado || d.refs.length === 0;
    $('det-refs').replaceChildren(
      ...d.refs.map((nome) => ficha(`ref:${nome}`, nome, !refsDesligadas.has(nome), (on) => void estado.ligarRef(nome, on))),
    );
  }

  function mostrar(e: Estado) {
    $('arquivo-nome').textContent = e.arquivo ? nomeArquivo || 'Arquivo aberto' : 'Nenhum arquivo';
    $('arquivo-det').textContent = e.arquivo ? 'Solte outro KML ou KMZ aqui' : 'Solte o KML ou KMZ do Google Earth aqui';
    mostrarObra(e);
    mostrarFichas(e);
    mostrarDetalhe(e);
    if (document.activeElement !== largura) largura.value = decimal(e.quadro.w);
    if (document.activeElement !== altura) altura.value = decimal(e.quadro.h);
    $<HTMLInputElement>('credito').checked = e.credito;

    const semArea = !e.janela;
    for (const id of ['afastar', 'aproximar', 'proposta', 'menos', 'mais', 'centralizar']) {
      $<HTMLButtonElement>(id).disabled = semArea;
    }
    $<HTMLButtonElement>('desfazer').disabled = Object.keys(e.ajustes).length === 0;
    $<HTMLButtonElement>('baixar').disabled = !e.desenho || e.ocupado;

    const aviso = $('aviso');
    aviso.hidden = e.aviso === null;
    aviso.textContent = e.aviso ?? '';

    $('st-obra').textContent = e.obra ? textoCoordenada(e.obra) : 'sem obra';
    $('st-area').textContent = e.janela
      ? `${decimal((e.janela.x1 - e.janela.x0) / 1000)} × ${decimal((e.janela.y1 - e.janela.y0) / 1000)} km`
      : 'sem área';
    $('st-quadro').textContent = `${decimal(e.quadro.w)} × ${decimal(e.quadro.h)}`;
    $('st-situacao').textContent = e.ocupado ? 'Compondo o mapa' : e.aviso ? 'Com aviso' : e.desenho ? 'Pronto' : 'Aguardando';
  }

  return { mostrar };
}
