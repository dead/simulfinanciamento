const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../js/tesouro.js');

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtido ${a}`);
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'rendimento-investir.csv'));

test('lê o CSV do Tesouro Direto (cabeçalho com acentos corrompidos)', () => {
  const { titulos, ignorados } = T.parseTesouroCSV(T.decodeCSV(fixture));
  assert.equal(ignorados.length, 0);
  assert.equal(titulos.length, 37);
  const selic = titulos[0];
  assert.equal(selic.nome, 'Tesouro Selic 2031');
  assert.equal(selic.indexador, 'SELIC');
  close(selic.taxa, 0.001083);
  close(selic.minimo, 202.31);
  close(selic.preco, 20231.37);
  assert.equal(selic.vencimento.toISOString().slice(0, 10), '2031-03-01');
  const pre = titulos.find((t) => t.nome === 'Tesouro Prefixado 2029');
  assert.equal(pre.indexador, 'PRE');
  close(pre.taxa, 0.149);
  const ipca = titulos.find((t) => t.nome === 'Tesouro IPCA+ 2032');
  assert.equal(ipca.indexador, 'IPCA');
  close(ipca.taxa, 0.078);
  assert.ok(titulos.find((t) => t.nome.includes('Juros Semestrais')).cupom);
  assert.ok(titulos.find((t) => t.nome.includes('Renda+')).renda);
  assert.ok(titulos.find((t) => t.nome.includes('Educa+')).renda);
  const reserva = titulos.find((t) => t.nome === 'Tesouro Reserva 2036');
  assert.equal(reserva.indexador, 'SELIC');
  assert.equal(reserva.taxa, 0);
});

test('aceita arquivo em Latin-1 e sem cabeçalho; ignora linhas inválidas', () => {
  const latin1 = Buffer.from('Título;Rendimento anual do título;Vencimento do Título\r\nTesouro IPCA+ 2035;IPCA + 7,1%;15/05/2035\r\nLinha quebrada;???;01/01/2030\r\n', 'latin1');
  const r = T.parseTesouroCSV(T.decodeCSV(latin1));
  assert.equal(r.titulos.length, 1);
  assert.equal(r.titulos[0].vencimento.getUTCFullYear(), 2035);
  assert.equal(r.ignorados.length, 1);
  assert.equal(r.ignorados[0].linha, 3);
  const sem = T.parseTesouroCSV('Tesouro Prefixado 2030;13,5%;R$ 30,00;R$ 900,00;01/01/2030');
  assert.equal(sem.titulos.length, 1);
  close(sem.titulos[0].taxa, 0.135);
});

test('converte rendimentos para IPCA + x (com custódia)', () => {
  const p = { ipca: 0.045, selic: 0.11, custodia: 0 };
  close(T.taxaReal({ indexador: 'IPCA', taxa: 0.078 }, p).real, 0.078, 1e-12);
  close(T.taxaReal({ indexador: 'PRE', taxa: 0.149 }, p).real, 1.149 / 1.045 - 1, 1e-12);
  close(T.taxaReal({ indexador: 'SELIC', taxa: 0.001 }, p).nominal, 1.11 * 1.001 - 1, 1e-12);
  const comCustodia = T.taxaReal({ indexador: 'IPCA', taxa: 0.078 }, { ...p, custodia: 0.002 });
  close(comCustodia.real, 1.078 * 0.998 - 1, 1e-12);
});
