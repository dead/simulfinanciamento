const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/finance.js');

const close = (a, b, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtido ${a} (tol ${tol})`);

const base = { principal: 120000, monthlyRate: 0.01, months: 120 };

test('taxa anual -> mensal', () => {
  close(F.annualToMonthly(0.12682503), 0.01, 1e-8);
});

test('SAC sem abatimentos: amortização constante e saldo zera', () => {
  const { rows, summary } = F.simulate({ ...base, system: 'SAC' });
  assert.equal(rows.length, 120);
  close(rows[0].amort, 1000);
  close(rows[0].parcela, 1000 + 1200);
  close(rows[119].parcela, 1000 + 10);
  close(rows[119].saldo, 0);
  // juros totais SAC = i * P * (n+1)/2
  close(summary.totalJuros, 0.01 * 120000 * 121 / 2);
});

test('PRICE sem abatimentos: parcela constante e saldo zera', () => {
  const { rows, summary } = F.simulate({ ...base, system: 'PRICE' });
  const p = F.pmt(120000, 0.01, 120);
  close(p, 1721.65, 0.01);
  assert.equal(rows.length, 120);
  rows.forEach((r) => close(r.parcela, p, 0.02));
  close(rows[119].saldo, 0);
  close(summary.totalPago, p * 120, 0.05);
});

test('abatimento reduzindo prazo encurta o contrato e mantém a parcela PRICE', () => {
  const semExtra = F.simulate({ ...base, system: 'PRICE' });
  const r = F.simulate({
    ...base,
    system: 'PRICE',
    extras: [{ mes: 12, valor: 20000, repetir: 0, modo: 'prazo' }],
  });
  assert.ok(r.rows.length < 120);
  close(r.rows[20].parcela, semExtra.rows[0].parcela, 0.02);
  assert.ok(r.summary.totalJuros < semExtra.summary.totalJuros);
  close(r.rows[r.rows.length - 1].saldo, 0);
});

test('abatimento reduzindo parcela mantém o prazo e reduz a parcela', () => {
  for (const system of ['SAC', 'PRICE']) {
    const semExtra = F.simulate({ ...base, system });
    const r = F.simulate({
      ...base,
      system,
      extras: [{ mes: 12, valor: 20000, repetir: 0, modo: 'parcela' }],
    });
    assert.equal(r.rows.length, 120, system);
    assert.ok(r.rows[12].parcela < semExtra.rows[12].parcela, system);
    close(r.rows[119].saldo, 0);
  }
});

test('abatimento SAC reduzindo prazo mantém a amortização', () => {
  const r = F.simulate({
    ...base,
    system: 'SAC',
    extras: [{ mes: 10, valor: 30000, repetir: 0, modo: 'prazo' }],
  });
  // saldo após mês 10: 110000 - 30000 = 80000 -> mais 80 meses
  assert.equal(r.rows.length, 90);
  close(r.rows[50].amort, 1000);
});

test('abatimento recorrente e abatimento maior que o saldo', () => {
  const map = F.expandExtras([{ mes: 6, valor: 100, repetir: 6, ate: 30 }], 120);
  assert.deepEqual([...map.keys()], [6, 12, 18, 24, 30]);
  const r = F.simulate({
    ...base,
    system: 'SAC',
    extras: [{ mes: 3, valor: 1e9, modo: 'prazo' }],
  });
  assert.equal(r.rows.length, 3);
  close(r.rows[2].extra, 117000);
});

test('investimento: quem paga menos investe a diferença; empate perto da taxa do financiamento', () => {
  const sac = F.simulate({ ...base, system: 'SAC' });
  const price = F.simulate({ ...base, system: 'PRICE' });
  const ipca = 0;
  const taxaAnual = 0.12682503; // equivale a 1% a.m.
  const inv = F.compareInvestment({ sac, price, months: 120, ipca, real: taxaAnual, applyIR: false });
  // investindo à mesma taxa do financiamento, sem IR, as duas estratégias empatam
  close(inv.summary.vantagemPrice, 0, 0.5);
  assert.ok(inv.virada > 1 && inv.virada < 120);
  close(inv.breakEven, taxaAnual, 1e-4);
  // rendendo menos que o financiamento, SAC leva vantagem
  const inv2 = F.compareInvestment({ sac, price, months: 120, ipca, real: 0.05, applyIR: false });
  assert.ok(inv2.summary.vantagemPrice < 0);
});

test('IR regressivo', () => {
  assert.equal(F.irRate(6), 0.225);
  assert.equal(F.irRate(12), 0.2);
  assert.equal(F.irRate(24), 0.175);
  assert.equal(F.irRate(25), 0.15);
  // 1000 aplicados por 24 meses a 1% a.m. -> ganho tributado a 17,5%
  const bruto = 1000 * Math.pow(1.01, 24);
  close(F.valueAt([1000], 0.01, 25, true), bruto - (bruto - 1000) * 0.175);
});

test('marcos: rendimento x juros, rendimento x parcela e quitação', () => {
  const sac = F.simulate({ principal: 400000, monthlyRate: F.annualToMonthly(0.115), months: 360, system: 'SAC' });
  const price = F.simulate({ principal: 400000, monthlyRate: F.annualToMonthly(0.115), months: 360, system: 'PRICE' });
  const inv = F.compareInvestment({ sac, price, months: 360, ipca: 0.045, real: 0.065, applyIR: false });
  const m = inv.marcos.PRICE;
  assert.ok(m.rendeJuros > 1 && m.rendeJuros < 360);
  assert.ok(m.rendeParcela === null || m.rendeParcela >= m.rendeJuros);
  const s = inv.series[m.rendeJuros - 1];
  assert.ok(s.rendimentoPrice >= s.jurosPrice);
  const antes = inv.series[m.rendeJuros - 2];
  assert.ok(antes.rendimentoPrice < antes.jurosPrice);
  if (m.quita) assert.ok(inv.series[m.quita - 1].carteiraPrice >= price.rows[m.quita - 1].saldo);
  // sem IR: aportes + rendimentos = carteira final
  const somaRend = inv.series.reduce((a, x) => a + x.rendimentoPrice, 0);
  close(inv.summary.aportadoPrice + somaRend, inv.summary.finalPrice, 0.01);
});

test('estratégias com orçamento fixo: investir x amortizar', () => {
  const base = { principal: 400000, monthlyRate: F.annualToMonthly(0.115), months: 360, periodo: 12, ipca: 0.045, applyIR: true };
  const t0 = Date.now();
  const c = F.compareStrategies({ ...base, real: 0.065 });
  assert.ok(Date.now() - t0 < 2000, 'rápido o suficiente para a interface');
  const by = Object.fromEntries(c.strategies.map((s) => [s.id, s]));
  close(c.budget, 400000 / 360 + 400000 * base.monthlyRate);
  // amortizar todo mês: SAC e PRICE dão o mesmo resultado
  const sacAmort = F.budgetStrategy({ ...base, real: 0.065, budget: c.budget, system: 'SAC', mode: 'amortizar', periodo: 1 });
  close(sacAmort.final, by.amortMes.final, 1);
  assert.equal(sacAmort.quitacao, by.amortMes.quitacao);
  // investimento rendendo menos que o financiamento: amortizar ganha; periódico fica no meio
  assert.ok(by.amortMes.final > by.sacInv.final && by.amortMes.final > by.priceInv.final);
  assert.ok(by.pricePer.final < by.amortMes.final && by.pricePer.final > by.priceInv.final);
  assert.ok(by.amortMes.quitacao < 200 && by.sacInv.quitacao === 360);
  // empate perto de IPCA + 7% com IR
  assert.ok(c.breakEven > 0.065 && c.breakEven < 0.08, String(c.breakEven));
  // rendendo bem mais, investir ganha
  const c2 = F.compareStrategies({ ...base, real: 0.09 });
  const b2 = Object.fromEntries(c2.strategies.map((s) => [s.id, s]));
  assert.ok(b2.priceInv.final > b2.amortMes.final);
  // orçamento abaixo da 1ª parcela SAC é elevado ao mínimo
  assert.equal(F.compareStrategies({ ...base, real: 0.065, budget: 100 }).budget, c.minBudget);
});

test('detalhe mensal da estratégia fecha as contas', () => {
  const p = { principal: 400000, monthlyRate: F.annualToMonthly(0.115), months: 360, ipca: 0.045, real: 0.065, applyIR: true };
  const budget = 5000;
  for (const [mode, periodo] of [['investir', 1], ['amortizar', 1], ['amortizar', 12]]) {
    const st = F.budgetStrategy({ ...p, budget, system: 'PRICE', mode, periodo });
    let saldo = p.principal;
    st.series.forEach((m) => {
      // orçamento = parcela + sobra; sobra = investido (o resto já foi amortizado)
      close(m.parcela + m.sobra, budget, 1e-6);
      if (mode === 'amortizar' && periodo === 1 && m.saldo > 0) close(m.amortExtra, m.sobra, 1e-6);
      saldo -= m.amort + m.amortExtra;
      close(Math.max(saldo, 0), m.saldo, 0.01);
    });
    if (periodo === 12) {
      const r12 = st.series[11];
      assert.equal(r12.acao, 'resgatar');
      assert.ok(r12.amortExtra > 0 && r12.ir > 0);
      assert.equal(st.series[10].acao, 'investir');
    }
    assert.ok(st.series.some((m) => m.acao === (mode === 'investir' ? 'investir' : 'quitado')));
  }
});

test('diferença das parcelas: investir x amortizar', () => {
  const p = { principal: 400000, monthlyRate: F.annualToMonthly(0.115), months: 360 };
  const sac = F.simulate({ ...p, system: 'SAC' });
  const price = F.simulate({ ...p, system: 'PRICE' });
  const q = { sac, price, months: 360, ipca: 0.045, real: 0.065, applyIR: true };
  const inv = F.compareInvestment({ ...q, mode: 'investir' });
  // investir: o comprador PRICE aporta exatamente max(0, SAC - PRICE)
  let esperado = 0;
  for (let k = 0; k < 360; k++) esperado += Math.max(0, sac.rows[k].parcela - price.rows[k].parcela);
  close(inv.summary.aportadoPrice, esperado, 0.01);
  assert.equal(inv.summary.quitacaoPrice, 360);

  const am = F.compareInvestment({ ...q, mode: 'amortizar', periodo: 1 });
  // amortizando a diferença, o saldo do comprador PRICE segue o da SAC até a virada
  for (let k = 0; k < am.virada - 1; k++) close(am.series[k].saldoPrice, am.series[k].saldoSac, 0.01);
  assert.ok(am.summary.quitacaoPrice < 360 && am.summary.quitacaoSac < 360);
  assert.ok(am.summary.amortizadoPrice > 0 && am.summary.amortizadoSac > 0);
  // investimento rendendo menos que o financiamento: amortizar deixa os dois mais ricos
  const last = (x) => x.series[x.series.length - 1];
  assert.ok(last(am).patrimonioPrice > last(inv).patrimonioPrice);
  assert.ok(last(am).patrimonioSac > last(inv).patrimonioSac);

  const per = F.compareInvestment({ ...q, mode: 'amortizar', periodo: 12 });
  assert.ok(last(per).patrimonioPrice > last(inv).patrimonioPrice && last(per).patrimonioPrice < last(am).patrimonioPrice);
  const anual = per.runs.PRICE.series[11];
  assert.equal(anual.acao, 'resgatar');
  assert.ok(anual.amortExtra > 0);
});

test('diferença das parcelas respeita os abatimentos cadastrados', () => {
  const p = { principal: 200000, monthlyRate: 0.009, months: 240, extras: [{ mes: 24, valor: 30000, repetir: 24, modo: 'parcela' }] };
  const sac = F.simulate({ ...p, system: 'SAC' });
  const price = F.simulate({ ...p, system: 'PRICE' });
  const inv = F.compareInvestment({ sac, price, months: 240, ipca: 0.04, real: 0.05, applyIR: false, mode: 'investir' });
  // no modo investir o fluxo do contrato é o mesmo de simulate()
  inv.runs.PRICE.series.forEach((m, k) => {
    const row = price.rows[k];
    if (!row) return;
    close(m.parcela, row.parcela, 1e-6);
    close(m.abatimento, row.extra, 1e-6);
    close(m.saldo, row.saldo, 0.01);
  });
});

test('todas as opções para a diferença', () => {
  const p = { principal: 400000, monthlyRate: F.annualToMonthly(0.115), months: 360 };
  const sac = F.simulate({ ...p, system: 'SAC' });
  const price = F.simulate({ ...p, system: 'PRICE' });
  const q = { sac, price, months: 360, ipca: 0.045, applyIR: true, periodo: 12 };
  const all = F.compareAllPolicies({ ...q, real: 0.065 });
  assert.equal(all.length, 6);
  const by = Object.fromEntries(all.map((o) => [o.id, o]));
  // batem com compareInvestment de cada política
  const inv = F.compareInvestment({ ...q, real: 0.065, mode: 'investir' });
  close(by['PRICE-investir'].final, inv.series[359].patrimonioPrice, 0.01);
  close(by['SAC-investir'].final, inv.series[359].patrimonioSac, 0.01);
  // amortizando todo mês, SAC e PRICE terminam iguais e são a melhor opção quando o investimento rende pouco
  close(by['SAC-amortizar'].final, by['PRICE-amortizar'].final, 1);
  const best = all.reduce((a, b) => (b.final > a.final ? b : a));
  assert.equal(best.policy, 'amortizar');
  assert.ok(by['PRICE-periodico'].ir > 0);
  // rendendo bem mais que o financiamento, investir passa a ser o melhor
  const all2 = F.compareAllPolicies({ ...q, real: 0.1 });
  assert.equal(all2.reduce((a, b) => (b.final > a.final ? b : a)).policy, 'investir');
});

test('quitar antes do prazo: extra mensal necessário', () => {
  const P = 400000;
  const i = F.annualToMonthly(0.115);
  const q = { principal: P, monthlyRate: i, months: 360, target: 180, ipca: 0.045, real: 0.065, applyIR: true, periodo: 12 };
  const price = F.payoffPlan({ ...q, system: 'PRICE' });
  const sac = F.payoffPlan({ ...q, system: 'SAC' });
  const by = (plan, id) => plan.options.find((o) => o.opcao === id);
  // abatendo todo mês, há fórmula fechada
  close(by(price, 'abater').extra, F.pmt(P, i, 180) - F.pmt(P, i, 360), 0.02);
  for (const plan of [price, sac]) {
    for (const o of plan.options) {
      assert.ok(o.quitacao <= 180, o.id + ' quita a tempo');
      // um centavo a menos não basta
      const menos = F.runPolicy({ ...q, system: o.system, budget: (k) => o.budget(k) - 0.02, mode: 'amortizar', periodo: o.periodo,
        resgateFinal: 180 });
      assert.ok(menos.quitacao === null || menos.quitacao > 180, o.id + ' é o mínimo');
      assert.ok(o.jurosEconomizados > 0);
    }
    // investimento rende menos que o financiamento e paga IR: abater exige menos por mês
    assert.ok(by(plan, 'abater').extra < by(plan, 'periodico').extra, plan.options[0].system);
    assert.ok(by(plan, 'periodico').extra < by(plan, 'fim').extra, plan.options[0].system);
    assert.ok(by(plan, 'abater').totalDesembolsado < by(plan, 'fim').totalDesembolsado);
  }
  // prazo maior que o contrato: nada extra
  assert.equal(F.payoffPlan({ ...q, system: 'PRICE', target: 360 }).options[0].extra, 0);
});

test('período 1 equivale a amortizar todo mês e não duplica opções', () => {
  const p = { principal: 400000, monthlyRate: F.annualToMonthly(0.115), months: 360 };
  const sac = F.simulate({ ...p, system: 'SAC' });
  const price = F.simulate({ ...p, system: 'PRICE' });
  const q = { sac, price, months: 360, ipca: 0.045, real: 0.065, applyIR: true };
  const all = F.compareAllPolicies({ ...q, periodo: 1 });
  assert.equal(all.length, 4);
  assert.ok(!all.some((o) => o.policy === 'periodico'));
  // modo "investir e amortizar" com N = 1 dá o mesmo que amortizar todo mês
  const per1 = F.compareInvestment({ ...q, mode: 'amortizar', periodo: 1 });
  const am = all.find((o) => o.id === 'PRICE-amortizar');
  close(per1.series[359].patrimonioPrice, am.final, 0.01);
  const strat = F.compareStrategies({ ...p, periodo: 1, ipca: 0.045, real: 0.065, applyIR: true });
  assert.equal(strat.strategies.length, 3);
  const plan = F.payoffPlan({ ...p, system: 'PRICE', target: 180, ipca: 0.045, real: 0.065, applyIR: true, periodo: 1 });
  assert.deepEqual(plan.options.map((o) => o.opcao), ['abater', 'fim']);
});
