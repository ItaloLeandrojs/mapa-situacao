// Baixa do OpenStreetMap (Overpass) as rodovias e os lugares de cada célula da grade do Ceará.
// Uso: node scripts/base/baixar.ts   (pula as células que já estão em base-cache/osm)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GRADE } from './montar.ts';

const PASTA = resolve(import.meta.dirname, '../../base-cache/osm');
const SERVIDORES = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const TENTATIVAS = 3;
const PAUSA_MS = 3000;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function consulta(sul: number, oeste: number, norte: number, leste: number): string {
  const caixa = `${sul},${oeste},${norte},${leste}`;
  return `
[out:json][timeout:120];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${caixa})->.w;
.w out body;
node(w.w);
out skel qt;
node["place"~"^(city|town|village)$"](${caixa});
out body;
`;
}

// servidor que esgota o tempo 2 vezes seguidas sai do revezamento até o fim da execução (se sobrar outro)
const LIMITE_SEM_RESPOSTA = 2;
const semResposta = new Map<string, number>();
function servidoresAtivos(): string[] {
  const ativos = SERVIDORES.filter((s) => (semResposta.get(s) ?? 0) < LIMITE_SEM_RESPOSTA);
  return ativos.length ? ativos : SERVIDORES;
}

async function baixarCelula(texto: string, vez: number): Promise<string> {
  const erros: string[] = [];
  for (let t = 0; t < TENTATIVAS; t++) {
    const ativos = servidoresAtivos();
    const url = ativos[(vez + t) % ativos.length];
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'mapa-situacao-base/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: texto }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const bruto = await r.text();
      const dados = JSON.parse(bruto);
      if (!Array.isArray(dados.elements)) throw new Error('resposta sem elements');
      if (typeof dados.remark === 'string' && /error/i.test(dados.remark)) throw new Error(dados.remark);
      semResposta.set(url, 0);
      return bruto;
    } catch (ex) {
      erros.push(`${url}: ${(ex as Error).message}`);
      if ((ex as Error).name === 'TimeoutError') {
        const n = (semResposta.get(url) ?? 0) + 1;
        semResposta.set(url, n);
        if (n === LIMITE_SEM_RESPOSTA) console.log(`${url} não responde: fica fora do revezamento`);
      }
      if (t < TENTATIVAS - 1) await espera(PAUSA_MS * (t + 2));
    }
  }
  throw new Error(erros.join(' | '));
}

mkdirSync(PASTA, { recursive: true });
const faltando: string[] = [];
let vez = 0;
for (let lin = 0; lin < GRADE.linhas; lin++) {
  for (let col = 0; col < GRADE.colunas; col++) {
    const nome = `c${col}_l${lin}`;
    const arquivo = join(PASTA, `${nome}.json`);
    if (existsSync(arquivo)) continue;
    const oeste = GRADE.oeste + col * GRADE.celula;
    const sul = GRADE.sul + lin * GRADE.celula;
    const caixa = [sul, oeste, sul + GRADE.celula, oeste + GRADE.celula].map((v) => +v.toFixed(4));
    try {
      const bruto = await baixarCelula(consulta(caixa[0], caixa[1], caixa[2], caixa[3]), vez++);
      writeFileSync(arquivo, bruto);
      console.log(`${nome}: ${(bruto.length / 1e6).toFixed(2)} MB`);
    } catch (ex) {
      faltando.push(nome);
      console.log(`${nome}: FALHOU (${(ex as Error).message})`);
    }
    await espera(PAUSA_MS);
  }
}
console.log(faltando.length ? `Faltam ${faltando.length} células: ${faltando.join(', ')}` : 'Todas as células no cache.');
if (faltando.length) process.exitCode = 1;
