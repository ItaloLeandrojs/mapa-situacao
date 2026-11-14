// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { lerArquivoGoogle } from '../src/nucleo/kml';
import { paraUtm } from '../src/nucleo/utm';

function lerFixture(nome: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', nome)));
}
const texto = (s: string) => new TextEncoder().encode(s);
const kml = (corpo: string) =>
  texto(`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>${corpo}</Document></kml>`);
const linha = (nome: string, coords: string) =>
  `<Placemark>${nome ? `<name>${nome}</name>` : ''}<LineString><coordinates>${coords}</coordinates></LineString></Placemark>`;

test('KML: um caminho e um alfinete', () => {
  const a = lerArquivoGoogle(lerFixture('ce397.kml'));
  expect(a.caminhos).toHaveLength(1);
  expect(a.caminhos[0].nome).toBe('Rota');
  expect(a.caminhos[0].pontos.length).toBeGreaterThan(150);
  expect(a.caminhos[0].pontos[0][0]).toBeCloseTo(492399.97, 1);
  expect(a.alfinetes).toEqual([{ nome: 'LOCAL DA OBRA', ponto: expect.any(Array) }]);
});

test('KMZ dá o mesmo que o KML', () => {
  expect(lerArquivoGoogle(lerFixture('ce397.kmz'))).toEqual(lerArquivoGoogle(lerFixture('ce397.kml')));
});

test('pontos repetidos em sequência saem uma vez só', () => {
  const a = lerArquivoGoogle(kml(linha('R', '-39.1,-7.5,0 -39.1,-7.5,0 -39.2,-7.6,0')));
  expect(a.caminhos[0].pontos).toEqual([paraUtm(-39.1, -7.5), paraUtm(-39.2, -7.6)]);
});

test('pasta dentro de pasta, MultiGeometry e gx:Track viram caminhos', () => {
  const a = lerArquivoGoogle(
    kml(
      `<Folder><Folder>${linha('A', '-39.1,-7.5 -39.2,-7.6')}</Folder></Folder>` +
        `<Placemark><name>M</name><MultiGeometry>` +
        `<LineString><coordinates>-39.1,-7.5 -39.3,-7.6</coordinates></LineString>` +
        `<LineString><coordinates>-39.4,-7.5 -39.5,-7.6</coordinates></LineString></MultiGeometry></Placemark>` +
        `<Placemark><name>T</name><gx:Track><when>x</when><when>y</when>` +
        `<gx:coord>-39.1 -7.5 0</gx:coord><gx:coord>-39.2 -7.6 0</gx:coord></gx:Track></Placemark>`,
    ),
  );
  expect(a.caminhos.map((c) => c.nome)).toEqual(['A', 'M', 'M', 'T']);
  expect(a.caminhos).toHaveLength(4);
  expect(a.caminhos[3].pontos).toEqual([paraUtm(-39.1, -7.5), paraUtm(-39.2, -7.6)]);
});

test('coordenada malformada é pulada e caminho com menos de 2 pontos não entra', () => {
  const a = lerArquivoGoogle(
    kml(linha('ok', '-39.1,-7.5 ,  -39.15 abc,def -39.2,-7.6') + linha('curto', '-39.1,-7.5 lixo')),
  );
  expect(a.caminhos).toHaveLength(1);
  expect(a.caminhos[0].pontos).toHaveLength(2);
});

test('alfinete sem <name> fica com nome vazio', () => {
  const a = lerArquivoGoogle(
    kml(linha('R', '-39.1,-7.5 -39.2,-7.6') + '<Placemark><Point><coordinates>-39.1,-7.5,0</coordinates></Point></Placemark>'),
  );
  expect(a.alfinetes).toEqual([{ nome: '', ponto: paraUtm(-39.1, -7.5) }]);
});

test('KMZ sem doc.kml usa o primeiro .kml que achar', () => {
  const zip = zipSync({ 'leia.txt': texto('oi'), 'pasta/outro.kml': kml(linha('R', '-39.1,-7.5 -39.2,-7.6')) });
  expect(lerArquivoGoogle(zip).caminhos).toHaveLength(1);
});

test('texto com BOM e acentos em UTF-8', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...kml(linha('  Estrada Simão ', '-39.1,-7.5 -39.2,-7.6'))]);
  expect(lerArquivoGoogle(bytes).caminhos[0].nome).toBe('Estrada Simão');
});

test('sem caminho: erro "Não achei nenhum caminho neste arquivo"', () => {
  expect(() => lerArquivoGoogle(kml(''))).toThrow('Não achei nenhum caminho neste arquivo');
});

test('arquivo qualquer: erro "Este arquivo não é um KML nem um KMZ"', () => {
  expect(() => lerArquivoGoogle(texto('isto não é xml'))).toThrow('Este arquivo não é um KML nem um KMZ');
  expect(() => lerArquivoGoogle(texto('<html><body>oi</body></html>'))).toThrow('Este arquivo não é um KML nem um KMZ');
  expect(() => lerArquivoGoogle(zipSync({ 'a.txt': texto('x') }))).toThrow('Este arquivo não é um KML nem um KMZ');
});

// rota do Google Earth Pro (coordenadas inventadas): partida e chegada com endereço, passos com instrução
const ponto = (estilo: string, miolo: string, lonlat: string) =>
  `<Placemark>${miolo}<styleUrl>#${estilo}</styleUrl><Point><coordinates>${lonlat},0</coordinates></Point></Placemark>`;
const ROTA_DO_EARTH = kml(
  `<Folder><name>Rotas</name><Folder id="results">` +
    ponto('dir_startpoint', '<address>Rua A, Cidade X</address>', '-39.10,-7.50') +
    ponto('dir_endpoint', '<address>Sítio B, Cidade X</address>', '-39.20,-7.60') +
    ponto('dir_step', '<name>Vire à direita</name><description>Vire à direita</description>' +
      '<LookAt><longitude>-39.15</longitude><latitude>-7.55</latitude><range>500</range></LookAt>', '-39.15,-7.55') +
    `<Placemark><name>Route</name><styleUrl>#dir_route</styleUrl><LineString><coordinates>` +
    `-39.10,-7.50,0 -39.15,-7.55,0 -39.20,-7.60,0</coordinates></LineString></Placemark>` +
    `</Folder></Folder>` +
    `<Placemark><name>LOCAL DA OBRA</name><styleUrl>#m_ylw-pushpin</styleUrl><Point><coordinates>-39.21,-7.61,0</coordinates></Point></Placemark>`,
);

test('passos da rota do Google (dir_step) não viram alfinete; partida, chegada e o alfinete da obra ficam', () => {
  const a = lerArquivoGoogle(ROTA_DO_EARTH);
  expect(a.caminhos.map((c) => c.nome)).toEqual(['Route']);
  expect(a.alfinetes).toEqual([
    { nome: '', ponto: paraUtm(-39.1, -7.5) },
    { nome: '', ponto: paraUtm(-39.2, -7.6) },
    { nome: 'LOCAL DA OBRA', ponto: paraUtm(-39.21, -7.61) },
  ]);
});

test('alfinete comum do usuário com nome de instrução continua alfinete', () => {
  const a = lerArquivoGoogle(kml(linha('R', '-39.1,-7.5 -39.2,-7.6') +
    ponto('m_ylw-pushpin', '<name>Vire à direita</name>', '-39.15,-7.55')));
  expect(a.alfinetes.map((p) => p.nome)).toEqual(['Vire à direita']);
});
