import { paraUtm } from '../src/nucleo/utm';

const perto = (p: number[], e: number, n: number) => {
  expect(p[0]).toBeCloseTo(e, 1);
  expect(p[1]).toBeCloseTo(n, 1);
};

test('ponta da rota CE-397', () => perto(paraUtm(-39.0688912, -7.5393172), 492399.97, 9166630.19));
test('fim da rota CE-397', () => perto(paraUtm(-39.1064977, -7.5320997), 488251.04, 9167427.25));
test('Fortaleza', () => perto(paraUtm(-38.5267, -3.7319), 552556.10, 9587492.94));
test('extremo oeste do Ceará', () => perto(paraUtm(-41.42, -3.0), 231001.08, 9668109.37));
