// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Buscar } from '../src/nucleo/base';
import { escala } from '../src/nucleo/medidas';
import { paraUtm } from '../src/nucleo/utm';
import type { Desenho, Janela, Primitiva, PtU, Quadro } from '../src/nucleo/tipos';
import { criarEstado } from '../src/tela/estado';

type Texto = Extract<Primitiva, { t: 'texto' }>;

const fixture = (nome: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', nome));
// buscar de mentira: lê os arquivos da base (public/base) do disco, sem rede
const buscarDoDisco: Buscar = async (caminho) =>
  JSON.parse(readFileSync(join(process.cwd(), 'public', 'base', caminho), 'utf8'));
const buscarQueFalha: Buscar = async () => {
  throw new Error('sem rede');
};

const KML_CE397 = new Uint8Array(fixture('ce397.kml'));
const textoKml = fixture('ce397.kml').toString('utf8');
// o mesmo arquivo sem o alfinete LOCAL DA OBRA
const SEM_ALFINETE = new TextEncoder().encode(
  textoKml.replace(/<Placemark>\s*<name>LOCAL DA OBRA<\/name>[\s\S]*?<\/Placemark>/, ''),
);
// rota no mar, a nordeste de Fortaleza: dentro da grade da base, longe de qualquer estrada
const NO_MAR = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Rota</name><LineString><coordinates>-37.30,-3.20,0 -37.25,-3.18,0</coordinates></LineString></Placemark>
<Placemark><name>OBRA</name><Point><coordinates>-37.30,-3.20,0</coordinates></Point></Placemark>
</Document></kml>`);

const textos = (d: Desenho) => d.prims.filter((p): p is Texto => p.t === 'texto');
const texto = (d: Desenho, id: string) => textos(d).find((t) => t.id === id);
const caixasDeCidade = (d: Desenho) => d.prims.filter((p) => p.t === 'linha' && p.camada === 'CIDADE').length;

test('abrirArquivo com ce397.kml: obra do alfinete, janela proposta, desenho pronto, sem aviso', async () => {
  const e = criarEstado(buscarDoDisco);
  const vistos: boolean[] = [];
  e.aoMudar((s) => vistos.push(s.ocupado));
  await e.abrirArquivo(KML_CE397);
  const s = e.ler();
  expect(s.aviso).toBeNull();
  expect(s.ocupado).toBe(false);
  expect(vistos).toContain(true); // avisou que estava ocupado
  const [ox, oy] = paraUtm(-39.0688912, -7.5393172);
  expect(s.obra![0]).toBeCloseTo(ox, 3);
  expect(s.obra![1]).toBeCloseTo(oy, 3);
  expect(s.candidatos.map((c) => c.origem)).toEqual(['alfinete', 'ponta', 'ponta']);
  // a janela contém a obra e está na proporção da área útil do quadro padrão
  const j = s.janela!;
  expect(j.x0 < ox && ox < j.x1 && j.y0 < oy && oy < j.y1).toBe(true);
  expect((j.x1 - j.x0) / (j.y1 - j.y0)).toBeCloseTo((124.6 - 6) / (113 - 17), 6);
  expect(s.desenho).not.toBeNull();
  expect(s.desenho!.quadro).toEqual({ w: 124.6, h: 113 });
  expect(texto(s.desenho!, 'obra:nome')?.txt).toBe('LOCAL DA OBRA');
  expect(s.ligados).toContain('PORTEIRAS');
  expect(s.lugaresNaJanela.map((l) => l.nome)).toEqual(expect.arrayContaining(s.ligados));
}, 30000);

test('arquivo sem alfinete: obra null, candidatos com as 2 pontas, desenho null', async () => {
  const e = criarEstado(buscarDoDisco);
  await e.abrirArquivo(SEM_ALFINETE);
  const s = e.ler();
  expect(s.aviso).toBeNull();
  expect(s.obra).toBeNull();
  expect(s.janela).toBeNull();
  expect(s.candidatos).toHaveLength(2);
  expect(s.candidatos.map((c) => c.rotulo)).toEqual(['Início de Rota', 'Fim de Rota']);
  expect(s.desenho).toBeNull();
});

test('escolherObra depois disso gera o desenho', async () => {
  const e = criarEstado(buscarDoDisco);
  await e.abrirArquivo(SEM_ALFINETE);
  const ponta = e.ler().candidatos[0].ponto;
  await e.escolherObra(ponta);
  const s = e.ler();
  expect(s.aviso).toBeNull();
  expect(s.obra).toEqual(ponta);
  expect(s.janela).not.toBeNull();
  expect(s.desenho).not.toBeNull();
  expect(textos(s.desenho!).some((t) => t.id === 'obra:coord')).toBe(true);
}, 30000);

describe('com o ce397 aberto', () => {
  const e = criarEstado(buscarDoDisco);
  beforeAll(() => e.abrirArquivo(KML_CE397), 30000);

  test('ligarLugar(JAMACARU, false) tira a caixa e o nome', async () => {
    const antes = e.ler().desenho!;
    expect(e.ler().ligados).toContain('JAMACARU');
    expect(texto(antes, 'cidade:JAMACARU')).toBeDefined();
    await e.ligarLugar('JAMACARU', false);
    const s = e.ler();
    expect(s.ligados).not.toContain('JAMACARU');
    expect(texto(s.desenho!, 'cidade:JAMACARU')).toBeUndefined();
    expect(caixasDeCidade(s.desenho!)).toBe(caixasDeCidade(antes) - 1);
    // continua na lista para ligar de novo
    expect(s.lugaresNaJanela.map((l) => l.nome)).toContain('JAMACARU');
  }, 30000);

  test('moverArea mantém os lugares desligados à mão', async () => {
    expect(e.ler().ligados).not.toContain('JAMACARU');
    const j0 = e.ler().janela!;
    await e.moverArea(2, 1);
    const s = e.ler();
    expect(s.aviso).toBeNull();
    expect(s.janela!.x0).toBeGreaterThan(j0.x0);
    expect(s.janela!.y0).toBeGreaterThan(j0.y0);
    expect(s.lugaresNaJanela.map((l) => l.nome)).toContain('JAMACARU');
    expect(s.ligados).not.toContain('JAMACARU');
    expect(texto(s.desenho!, 'cidade:JAMACARU')).toBeUndefined();
  }, 30000);

  test('ajustarTexto sobrevive a moverArea', async () => {
    const d = e.ler().desenho!;
    // rótulo de estrada de duas linhas: o ajuste da primeira leva a segunda junto
    const km = textos(d).find((t) => t.id.endsWith(':km'))!;
    const id = km.id.slice(0, -3);
    const primeira = texto(d, id)!;
    e.ajustarTexto(id, [60, 60]);
    e.ajustarTexto('titulo', [20, 30]);
    const ajustado = e.ler().desenho!;
    // o rótulo de estrada guarda o ajuste em metros: a volta para a prancha só difere no arredondamento
    expect(texto(ajustado, id)!.centro[0]).toBeCloseTo(60, 9);
    expect(texto(ajustado, id)!.centro[1]).toBeCloseTo(60, 9);
    const kmAjustado = texto(ajustado, km.id)!.centro;
    expect(kmAjustado[0] - 60).toBeCloseTo(km.centro[0] - primeira.centro[0], 9);
    expect(kmAjustado[1] - 60).toBeCloseTo(km.centro[1] - primeira.centro[1], 9);
    expect(Object.keys(e.ler().ajustes).sort()).toEqual([id, 'titulo'].sort());

    // a janela anda 2 para a esquerda e 1 para baixo: o rótulo de estrada anda com o mapa, SEM ESCALA fica
    await e.moverArea(-2, -1);
    const s = e.ler();
    expect(Object.keys(s.ajustes).sort()).toEqual([id, 'titulo'].sort());
    expect(s.ajustes[id][0]).toBeCloseTo(62, 9);
    expect(s.ajustes[id][1]).toBeCloseTo(61, 9);
    expect(s.ajustes.titulo).toEqual([20, 30]);
    expect(texto(s.desenho!, 'titulo')!.centro).toEqual([20, 30]);

    e.desfazerAjustes();
    expect(e.ler().ajustes).toEqual({});
    expect(texto(e.ler().desenho!, 'titulo')!.centro).not.toEqual([20, 30]);
  }, 30000);

  test('arquivo ruim: aviso com a mensagem e o desenho anterior continua', async () => {
    const antes = e.ler().desenho;
    await e.abrirArquivo(new TextEncoder().encode('isto não é um kml'));
    const s = e.ler();
    expect(s.aviso).toBe('Este arquivo não é um KML nem um KMZ');
    expect(s.ocupado).toBe(false);
    expect(s.desenho).toBe(antes);
  });
});

describe('ajuste de texto preso ao mapa (R20)', () => {
  const e = criarEstado(buscarDoDisco);
  beforeAll(() => e.abrirArquivo(KML_CE397), 30000);
  // onde o ponto da prancha `p` da área `de` vai parar na área `para`
  const seguir = (p: PtU, de: [Janela, Quadro], para: [Janela, Quadro]): PtU =>
    escala(...para).paraU(escala(...de).paraMetros(p));
  const agora = (): [Janela, Quadro] => [e.ler().janela!, e.ler().quadro];

  test('nome de cidade e LOCAL DA OBRA acompanham o mapa ao mover e aproximar; SEM ESCALA fica na prancha', async () => {
    const d = e.ler().desenho!;
    // a cidade mais perto do meio da área útil, para continuar na área depois de aproximar
    const meio: PtU = [124.6 / 2, 3 + (113 - 17) / 2];
    const cidade = textos(d).filter((t) => t.id.startsWith('cidade:'))
      .sort((x, y) => Math.hypot(x.centro[0] - meio[0], x.centro[1] - meio[1]) - Math.hypot(y.centro[0] - meio[0], y.centro[1] - meio[1]))[0];
    const obra = texto(d, 'obra:nome')!;
    const pedidoCidade: PtU = [cidade.centro[0] + 3, cidade.centro[1] + 2];
    const pedidoObra: PtU = [obra.centro[0] - 4, obra.centro[1] + 1];
    e.ajustarTexto(cidade.id, pedidoCidade);
    e.ajustarTexto('obra:nome', pedidoObra);
    e.ajustarTexto('titulo', [20, 30]);
    const a0 = agora();

    await e.moverArea(2, 1);
    const a1 = agora();
    let s = e.ler();
    expect(s.aviso).toBeNull();
    for (const [id, pedido] of [[cidade.id, pedidoCidade], ['obra:nome', pedidoObra]] as [string, PtU][]) {
      const esperado = seguir(pedido, a0, a1);
      const c = texto(s.desenho!, id)!.centro;
      expect(c[0]).toBeCloseTo(esperado[0], 6);
      expect(c[1]).toBeCloseTo(esperado[1], 6);
      expect(s.ajustes[id][0]).toBeCloseTo(esperado[0], 6);
    }
    expect(texto(s.desenho!, cidade.id)!.centro[0]).toBeCloseTo(pedidoCidade[0] - 2, 6); // a janela andou 2 para a direita
    expect(texto(s.desenho!, 'titulo')!.centro).toEqual([20, 30]);
    // a coordenada da obra anda junto com o nome
    const coord0 = texto(d, 'obra:coord')!.centro;
    const coord = texto(s.desenho!, 'obra:coord')!.centro;
    const nome = texto(s.desenho!, 'obra:nome')!.centro;
    expect(coord[0] - nome[0]).toBeCloseTo(coord0[0] - obra.centro[0], 6);

    await e.aproximarArea(1.25);
    const a2 = agora();
    s = e.ler();
    const esperado = seguir(pedidoCidade, a0, a2);
    expect(texto(s.desenho!, cidade.id)!.centro[0]).toBeCloseTo(esperado[0], 6);
    expect(texto(s.desenho!, cidade.id)!.centro[1]).toBeCloseTo(esperado[1], 6);
    expect(texto(s.desenho!, 'titulo')!.centro).toEqual([20, 30]);
  }, 60000);

  test('mudarQuadro: o nome ajustado continua no mesmo ponto do mapa', async () => {
    const id = Object.keys(e.ler().ajustes).find((k) => k.startsWith('cidade:'))!;
    const antes = agora();
    const pedido = e.ler().ajustes[id];
    await e.mudarQuadro({ w: 200, h: 150 });
    const s = e.ler();
    expect(s.aviso).toBeNull();
    const esperado = seguir(pedido, antes, agora());
    const c = texto(s.desenho!, id)!.centro;
    expect(c[0]).toBeCloseTo(esperado[0], 6);
    expect(c[1]).toBeCloseTo(esperado[1], 6);
    expect(texto(s.desenho!, 'titulo')!.centro).toEqual([20, 30]);
    await e.mudarQuadro({ w: 124.6, h: 113 });
  }, 60000);

  test('ajuste de texto que sumiu do desenho é descartado e não liga o Desfazer', async () => {
    e.desfazerAjustes();
    const nome = e.ler().ligados.find((n) => texto(e.ler().desenho!, `cidade:${n}`))!;
    const c = texto(e.ler().desenho!, `cidade:${nome}`)!.centro;
    e.ajustarTexto(`cidade:${nome}`, [c[0] + 2, c[1]]);
    expect(Object.keys(e.ler().ajustes)).toEqual([`cidade:${nome}`]);
    await e.ligarLugar(nome, false);
    expect(e.ler().ajustes).toEqual({});
    // ligado de novo, volta no lugar automático: o ajuste foi descartado
    await e.ligarLugar(nome, true);
    expect(e.ler().ajustes).toEqual({});
    expect(texto(e.ler().desenho!, `cidade:${nome}`)!.centro).toEqual(c);
  }, 60000);
});

describe('ajuste de texto durante a recomposição', () => {
  // buscar que segura as células enquanto `trava` estiver de pé; avisa quando alguém pediu
  let trava: Promise<void> | null = null;
  let soltar = () => {};
  let pediu = () => {};
  const buscarLento: Buscar = async (caminho) => {
    if (trava && caminho.startsWith('rodovias/')) {
      pediu();
      await trava;
    }
    return buscarDoDisco(caminho);
  };
  const segurar = () => {
    trava = new Promise<void>((r) => (soltar = () => { trava = null; r(); }));
    return new Promise<void>((r) => (pediu = r));
  };
  const e = criarEstado(buscarLento);
  beforeAll(() => e.abrirArquivo(KML_CE397), 30000);
  // 160 unidades da prancha (cerca de 100 km) para o norte: sai da base carregada e obriga a buscar células de novo,
  // e a rota ainda fica dentro da base nova
  const LONGE_U = 160;

  test('ajustarTexto feito enquanto moverArea espera a base sobrevive quando a etapa termina', async () => {
    const pedido = segurar();
    const etapa = e.moverArea(0, LONGE_U);
    await pedido; // a etapa já começou e está esperando as células
    e.ajustarTexto('titulo', [20, 30]);
    soltar();
    await etapa;
    const s = e.ler();
    expect(s.aviso).toBeNull();
    expect(s.ajustes).toEqual({ titulo: [20, 30] });
    expect(texto(s.desenho!, 'titulo')!.centro).toEqual([20, 30]);
  }, 30000);

  test('desfazerAjustes feito enquanto moverArea espera a base sobrevive quando a etapa termina', async () => {
    expect(e.ler().ajustes).toEqual({ titulo: [20, 30] });
    const pedido = segurar();
    const etapa = e.moverArea(0, -LONGE_U);
    await pedido;
    e.desfazerAjustes();
    soltar();
    await etapa;
    const s = e.ler();
    expect(s.aviso).toBeNull();
    expect(s.ajustes).toEqual({});
    expect(texto(s.desenho!, 'titulo')!.centro).not.toEqual([20, 30]);
  }, 30000);
});

test('buscar que falha: aviso "Não consegui carregar a base de estradas. Confira a internet e tente de novo"', async () => {
  const e = criarEstado(buscarQueFalha);
  await e.abrirArquivo(KML_CE397);
  const s = e.ler();
  expect(s.aviso).toBe('Não consegui carregar a base de estradas. Confira a internet e tente de novo');
  expect(s.desenho).toBeNull();
  expect(s.ocupado).toBe(false);
});

test('rota fora da base: aviso "Esta rota fica fora da base do Ceará"', async () => {
  const e = criarEstado(buscarDoDisco);
  await e.abrirArquivo(NO_MAR);
  const s = e.ler();
  expect(s.aviso).toBe('Esta rota fica fora da base do Ceará');
  expect(s.desenho).toBeNull();
}, 30000);
