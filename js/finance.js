/*
 * Motor de cálculo: SAC, PRICE, abatimentos e investimento da diferença.
 * Sem dependências. Funciona no navegador (window.Finance) e no Node (module.exports).
 */
(function (root) {
  'use strict';

  const EPS = 0.005; // meio centavo: abaixo disso o saldo é considerado quitado

  /** Taxa anual efetiva -> mensal equivalente (juros compostos). */
  function annualToMonthly(a) {
    return Math.pow(1 + a, 1 / 12) - 1;
  }

  /** Parcela PRICE para valor presente pv, taxa i e n períodos. */
  function pmt(pv, i, n) {
    if (n <= 0) return pv;
    if (i === 0) return pv / n;
    return (pv * i) / (1 - Math.pow(1 + i, -n));
  }

  /** Número de períodos para quitar pv pagando `payment` por período. */
  function nper(pv, payment, i) {
    if (pv <= 0) return 0;
    if (i === 0) return pv / payment;
    const x = 1 - (pv * i) / payment;
    if (x <= 0) return Infinity;
    return -Math.log(x) / Math.log(1 + i);
  }

  /**
   * Expande a lista de abatimentos em um mapa mês -> [{valor, modo}].
   * Cada abatimento: { mes, valor, repetir (0 = único), ate (opcional), modo: 'prazo' | 'parcela' }
   */
  function expandExtras(extras, months) {
    const map = new Map();
    (extras || []).forEach((e) => {
      const valor = Number(e.valor) || 0;
      const inicio = Math.max(1, Math.floor(Number(e.mes) || 1));
      const passo = Math.max(0, Math.floor(Number(e.repetir) || 0));
      const fim = Math.min(months, e.ate ? Math.floor(Number(e.ate)) : months);
      if (valor <= 0 || inicio > months) return;
      const modo = e.modo === 'parcela' ? 'parcela' : 'prazo';
      for (let m = inicio; m <= fim; m += passo || Infinity) {
        if (!map.has(m)) map.set(m, []);
        map.get(m).push({ valor, modo });
        if (!passo) break;
      }
    });
    return map;
  }

  /**
   * Simula um financiamento.
   * @param {object} p
   * @param {number} p.principal   valor financiado
   * @param {number} p.monthlyRate taxa mensal (decimal)
   * @param {number} p.months      prazo contratado em meses
   * @param {'SAC'|'PRICE'} p.system
   * @param {Array}  [p.extras]    abatimentos (ver expandExtras)
   */
  function simulate({ principal, monthlyRate, months, system, extras }) {
    const i = monthlyRate;
    const extrasMap = expandExtras(extras, months);
    let saldo = principal;
    let endMonth = months; // mês em que o contrato termina (muda com "reduzir prazo")
    let amortSAC = principal / months;
    let parcelaPRICE = pmt(principal, i, months);
    const rows = [];

    for (let k = 1; k <= endMonth && saldo > EPS; k++) {
      const juros = saldo * i;
      let amort = system === 'SAC' ? amortSAC : parcelaPRICE - juros;
      if (k === endMonth || amort > saldo) amort = saldo;
      const parcela = amort + juros;
      saldo -= amort;
      if (saldo < EPS) saldo = 0;

      let extra = 0;
      const doMes = extrasMap.get(k) || [];
      for (const e of doMes) {
        if (saldo <= 0) break;
        const v = Math.min(e.valor, saldo);
        saldo -= v;
        extra += v;
        if (saldo < EPS) {
          saldo = 0;
          break;
        }
        if (e.modo === 'parcela') {
          // mantém o prazo, recalcula a parcela
          const restantes = Math.max(1, endMonth - k);
          if (system === 'SAC') amortSAC = saldo / restantes;
          else parcelaPRICE = pmt(saldo, i, restantes);
        } else {
          // mantém a parcela (amortização no SAC), encurta o prazo
          const n = system === 'SAC' ? saldo / amortSAC : nper(saldo, parcelaPRICE, i);
          endMonth = k + Math.max(1, Math.ceil(n - 1e-9));
        }
      }

      rows.push({ mes: k, parcela, juros, amort, extra, saldo });
    }

    return { system, rows, summary: summarize(rows, principal), params: { principal, monthlyRate, months, extras } };
  }

  function summarize(rows, principal) {
    let totalParcelas = 0;
    let totalJuros = 0;
    let totalExtras = 0;
    let maior = 0;
    rows.forEach((r) => {
      totalParcelas += r.parcela;
      totalJuros += r.juros;
      totalExtras += r.extra;
      if (r.parcela > maior) maior = r.parcela;
    });
    return {
      principal,
      prazo: rows.length,
      primeira: rows.length ? rows[0].parcela : 0,
      ultima: rows.length ? rows[rows.length - 1].parcela : 0,
      maior,
      totalParcelas,
      totalJuros,
      totalExtras,
      totalPago: totalParcelas + totalExtras,
    };
  }

  /** Alíquota de IR regressiva (renda fixa) pela idade da aplicação em meses. */
  function irRate(ageMonths) {
    const dias = ageMonths * 30;
    if (dias <= 180) return 0.225;
    if (dias <= 360) return 0.2;
    if (dias <= 720) return 0.175;
    return 0.15;
  }

  /**
   * Valor de resgate no mês t de uma série de aportes mensais (aportes[j] feito no fim do mês j+1).
   * Com IR, cada aporte é tributado pela própria idade (tabela regressiva).
   */
  function valueAt(aportes, r, t, applyIR) {
    let total = 0;
    for (let j = 0; j < t && j < aportes.length; j++) {
      const c = aportes[j];
      if (!c) continue;
      const age = t - (j + 1);
      const bruto = c * Math.pow(1 + r, age);
      if (applyIR && age > 0) total += bruto - (bruto - c) * irRate(age);
      else total += bruto;
    }
    return total;
  }

  /**
   * Valor de resgate (líquido de IR, se applyIR) de lotes [{mes, valor}] no mês t.
   * G é o fator acumulado de rendimento: G[k] = (1 + r1)(1 + r2)...(1 + rk), o que permite taxa variável.
   */
  function lotsValue(lots, G, t, applyIR) {
    let total = 0;
    for (const l of lots) {
      const age = t - l.mes;
      const bruto = (l.valor * G[t]) / G[l.mes];
      total += applyIR && age > 0 ? bruto - (bruto - l.valor) * irRate(age) : bruto;
    }
    return total;
  }

  /**
   * Simula mês a mês um comprador com um orçamento (fixo ou por mês) e uma política para a sobra:
   * paga a parcela obrigatória (e os abatimentos cadastrados) e a sobra do orçamento
   *  - 'investir':  vai para o investimento;
   *  - 'amortizar': amortiza o saldo, reduzindo o prazo. Com periodo = 1 amortiza todo mês;
   *                 com periodo = N, investe e a cada N meses resgata tudo (pagando IR) e amortiza.
   * Depois de quitar, toda a sobra vai para o investimento.
   * Com finalOnly, a carteira só é avaliada no último mês (para buscas de taxa de empate).
   */
  function runPolicy({
    principal, monthlyRate, months, horizon = months, system, extras, budget, mode, periodo = 1,
    ipca, real, applyIR, finalOnly = false, resgateFinal, pararAoQuitar = false, taxaInicial,
  }) {
    const i = monthlyRate;
    const r = annualToMonthly((1 + ipca) * (1 + real) - 1);
    // taxaInicial = { real, meses }: rende IPCA + taxaInicial.real nos primeiros `meses` (ex.: até o
    // vencimento de um título) e IPCA + real depois (reinvestimento)
    const r0 = taxaInicial ? annualToMonthly((1 + ipca) * (1 + taxaInicial.real) - 1) : r;
    const m0 = taxaInicial ? taxaInicial.meses : 0;
    const G = [1];
    for (let k = 1; k <= horizon; k++) G[k] = G[k - 1] * (1 + (k <= m0 ? r0 : r));
    const ipcaM = annualToMonthly(ipca);
    const budgetAt = typeof budget === 'function' ? budget : () => budget;
    const extrasMap = expandExtras(extras, months);
    let saldo = principal;
    let endMonth = months;
    let amortSAC = principal / months;
    let parcelaPRICE = pmt(principal, i, months);
    let lots = [];
    let jurosAcum = 0;
    let quitacao = null;
    const series = [];
    const quitou = (k) => {
      if (saldo < EPS) {
        saldo = 0;
        if (quitacao === null) quitacao = k;
      }
      return saldo === 0;
    };
    // amortização que mantém a parcela (SAC: a amortização) e encurta o prazo
    const encurtar = (k) => {
      if (saldo <= 0) return;
      const n = system === 'SAC' ? saldo / amortSAC : nper(saldo, parcelaPRICE, i);
      endMonth = k + Math.max(1, Math.ceil(n - 1e-9));
    };

    for (let k = 1; k <= horizon; k++) {
      let parcela = 0;
      let juros = 0;
      let amort = 0;
      let abatimento = 0; // abatimentos cadastrados pelo usuário
      const ativo = saldo > 0;
      if (ativo) {
        juros = saldo * i;
        amort = system === 'SAC' ? amortSAC : parcelaPRICE - juros;
        if (amort > saldo || k >= endMonth) amort = saldo;
        parcela = amort + juros;
        jurosAcum += juros;
        saldo -= amort;
        quitou(k);
        for (const e of extrasMap.get(k) || []) {
          if (saldo <= 0) break;
          const v = Math.min(e.valor, saldo);
          saldo -= v;
          abatimento += v;
          if (quitou(k)) break;
          if (e.modo === 'parcela') {
            const restantes = Math.max(1, endMonth - k);
            if (system === 'SAC') amortSAC = saldo / restantes;
            else parcelaPRICE = pmt(saldo, i, restantes);
          } else encurtar(k);
        }
      }
      // pararAoQuitar: depois de quitar não há mais orçamento (plano de quitação antecipada)
      const sobra = pararAoQuitar && !ativo ? 0 : Math.max(0, budgetAt(k) - parcela - abatimento);
      let investido = 0; // aporte novo no mês
      let resgate = 0; // valor resgatado da carteira e usado para amortizar
      let ir = 0; // IR pago nesse resgate
      let amortExtra = 0;
      let acao;

      if (mode === 'amortizar' && saldo > 0) {
        if (periodo <= 1) {
          amortExtra = Math.min(sobra, saldo);
          saldo -= amortExtra;
          investido = sobra - amortExtra;
          if (investido > 0) lots.push({ mes: k, valor: investido });
          acao = investido > 0 ? 'quitar' : 'amortizar';
          if (!quitou(k)) encurtar(k);
        } else {
          investido = sobra;
          if (sobra > 0) lots.push({ mes: k, valor: sobra });
          acao = 'investir';
          if ((k % periodo === 0 || k === resgateFinal) && lots.length) {
            const liquido = lotsValue(lots, G, k, applyIR);
            ir = lotsValue(lots, G, k, false) - liquido;
            lots = [];
            amortExtra = Math.min(liquido, saldo);
            saldo -= amortExtra;
            const resto = liquido - amortExtra;
            if (resto > 0) lots.push({ mes: k, valor: resto });
            resgate = amortExtra;
            acao = resto > 0 ? 'resgatarQuitar' : 'resgatar';
            if (!quitou(k)) encurtar(k);
          }
        }
      } else {
        investido = sobra;
        if (sobra > 0) lots.push({ mes: k, valor: sobra });
        acao = !ativo ? (pararAoQuitar ? 'livre' : 'quitado') : saldo === 0 ? 'ultima' : 'investir';
      }
      if (ativo && sobra === 0 && resgate === 0 && (acao === 'investir' || acao === 'amortizar')) acao = 'parcela';

      const carteira = finalOnly && k < horizon ? 0 : lotsValue(lots, G, k, applyIR);
      series.push({
        mes: k, acao, ativo, parcela, juros, amort, abatimento, sobra, investido, resgate, ir, amortExtra,
        saldo, carteira, patrimonio: carteira - saldo, jurosAcum, deflator: Math.pow(1 + ipcaM, k),
      });
    }
    const last = series[series.length - 1];
    return { series, quitacao, totalJuros: jurosAcum, final: last.patrimonio, deflator: last.deflator };
  }

  /** Estratégia com orçamento mensal fixo (ver runPolicy). */
  function budgetStrategy(p) {
    return runPolicy(p);
  }

  /** Bisseção de f(real) = 0 em [lo, hi]; null se não houver troca de sinal. */
  function solveReal(f, lo = -0.2, hi = 0.5, iters = 40) {
    let flo = f(lo);
    const fhi = f(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0 || Math.max(Math.abs(flo), Math.abs(fhi)) < 1) return null;
    for (let it = 0; it < iters; it++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (fm * flo <= 0) hi = mid;
      else {
        lo = mid;
        flo = fm;
      }
    }
    return (lo + hi) / 2;
  }

  /**
   * Compara o comprador SAC com o comprador PRICE com o mesmo desembolso mensal
   * (o maior entre as duas parcelas + abatimentos do contrato original): em cada mês,
   * quem paga a parcela menor direciona a diferença conforme a política (`mode`/`periodo`):
   * investir, amortizar todo mês ou investir e amortizar a cada N meses.
   *
   * @param {object} p
   * @param {object} p.sac   resultado de simulate() para SAC
   * @param {object} p.price resultado de simulate() para PRICE
   * @param {number} p.months horizonte (meses)
   * @param {number} p.ipca  IPCA anual esperado (decimal)
   * @param {number} p.real  taxa real anual acima do IPCA (decimal)
   * @param {boolean} p.applyIR descontar IR regressivo no resgate
   * @param {'investir'|'amortizar'} [p.mode]
   * @param {number} [p.periodo] 1 = amortiza todo mês; N = investe e amortiza a cada N meses
   */
  function compareInvestment(p) {
    const { sac, price, months, ipca, real, applyIR, mode = 'investir', periodo = 1, finalOnly = false, light = false, taxaInicial } = p;
    const H = Math.max(months, sac.rows.length, price.rows.length);
    const desembolso = (rows, k) => {
      const row = rows[k - 1];
      return row ? row.parcela + row.extra : 0;
    };
    const budget = (k) => Math.max(desembolso(sac.rows, k), desembolso(price.rows, k));
    const run = (sim) =>
      runPolicy({ ...sim.params, horizon: H, system: sim.system, budget, mode, periodo, ipca, real, applyIR, finalOnly, taxaInicial });
    const runs = { SAC: run(sac), PRICE: run(price) };
    const S = runs.SAC.series;
    const P = runs.PRICE.series;

    const series = [];
    const acc = { aportadoSac: 0, aportadoPrice: 0, amortizadoSac: 0, amortizadoPrice: 0 };
    for (let k = 0; k < H; k++) {
      const s = S[k];
      const q = P[k];
      acc.aportadoSac += s.investido;
      acc.aportadoPrice += q.investido;
      acc.amortizadoSac += s.amortExtra;
      acc.amortizadoPrice += q.amortExtra;
      const prevS = k ? S[k - 1].carteira : 0;
      const prevP = k ? P[k - 1].carteira : 0;
      series.push({
        mes: k + 1,
        diferenca: q.sobra - s.sobra, // >0: comprador PRICE direciona a diferença; <0: comprador SAC
        ...acc,
        carteiraSac: s.carteira,
        carteiraPrice: q.carteira,
        // rendimento do mês = variação da carteira - aporte + resgate (líquido de IR se applyIR)
        rendimentoSac: s.carteira - prevS - s.investido + s.resgate,
        rendimentoPrice: q.carteira - prevP - q.investido + q.resgate,
        jurosSac: s.juros,
        jurosPrice: q.juros,
        parcelaSac: s.parcela,
        parcelaPrice: q.parcela,
        saldoSac: s.saldo,
        saldoPrice: q.saldo,
        ativoSac: s.ativo,
        ativoPrice: q.ativo,
        patrimonioSac: s.patrimonio,
        patrimonioPrice: q.patrimonio,
        deflator: s.deflator,
      });
    }

    // Primeiro mês em que o desembolso da SAC fica menor que o da PRICE (contratos originais).
    let virada = null;
    for (let k = 1; k <= H; k++) {
      if (desembolso(price.rows, k) > desembolso(sac.rows, k) + 0.005) {
        virada = k;
        break;
      }
    }

    const last = series[series.length - 1];
    const out = {
      monthlyRate: annualToMonthly((1 + ipca) * (1 + real) - 1),
      horizon: H,
      mode,
      periodo,
      virada,
      series,
      runs,
      summary: {
        aportadoSac: last.aportadoSac,
        aportadoPrice: last.aportadoPrice,
        amortizadoSac: last.amortizadoSac,
        amortizadoPrice: last.amortizadoPrice,
        quitacaoSac: runs.SAC.quitacao,
        quitacaoPrice: runs.PRICE.quitacao,
        finalSac: last.carteiraSac,
        finalPrice: last.carteiraPrice,
        vantagemPrice: last.patrimonioPrice - last.patrimonioSac,
        deflator: last.deflator,
      },
    };
    if (!finalOnly && !light) {
      out.marcos = { SAC: milestones(series, 'Sac'), PRICE: milestones(series, 'Price') };
      // taxa real em que PRICE e SAC empatam no fim do horizonte
      out.breakEven = solveReal((x) => compareInvestment({ ...p, real: x, finalOnly: true }).summary.vantagemPrice);
    }
    return out;
  }

  /**
   * Todas as combinações sistema × política para a diferença das parcelas (mesmo desembolso mensal):
   * SAC/PRICE × investir / investir e amortizar a cada N meses / amortizar todo mês.
   * Cada opção traz a série mês a mês do comprador (ver runPolicy).
   */
  function compareAllPolicies(p) {
    const policies = [
      { policy: 'investir', mode: 'investir', periodo: 1 },
      { policy: 'periodico', mode: 'amortizar', periodo: p.periodo || 12 },
      { policy: 'amortizar', mode: 'amortizar', periodo: 1 },
    ].filter((pol) => pol.policy !== 'periodico' || pol.periodo > 1); // N = 1 é o mesmo que amortizar todo mês
    const options = [];
    policies.forEach((pol) => {
      const c = compareInvestment({ ...p, mode: pol.mode, periodo: pol.periodo, light: true });
      ['SAC', 'PRICE'].forEach((system) => {
        const run = c.runs[system];
        options.push({
          id: system + '-' + pol.policy,
          system,
          policy: pol.policy,
          periodo: pol.periodo,
          series: run.series,
          quitacao: run.quitacao,
          totalJuros: run.totalJuros,
          ir: run.series.reduce((a, m) => a + m.ir, 0),
          final: run.final,
          deflator: run.deflator,
        });
      });
    });
    return options;
  }

  /**
   * Que taxa real (IPCA + x) o investimento precisa render para que investir a diferença das
   * parcelas valha mais do que amortizar todo mês (patrimônio no fim do horizonte), por sistema.
   * Também devolve uma varredura do patrimônio final por taxa, para o gráfico.
   */
  function investVsAmortize({ sac, price, months, ipca, applyIR, periodo = 12, sweep = [0, 0.12, 0.005] }) {
    const fim = (real, mode, per) => {
      const c = compareInvestment({ sac, price, months, ipca, real, applyIR, mode, periodo: per, finalOnly: true });
      const l = c.series[c.series.length - 1];
      return { SAC: l.patrimonioSac, PRICE: l.patrimonioPrice, deflator: l.deflator };
    };
    // varredura do patrimônio final por taxa real
    const [ini, max, passo] = sweep;
    const pontos = [];
    const ponto = (real) => {
      const inv = fim(real, 'investir', 1);
      const am = fim(real, 'amortizar', 1);
      const per = periodo > 1 ? fim(real, 'amortizar', periodo) : null;
      return {
        real,
        deflator: inv.deflator,
        sacInv: inv.SAC,
        priceInv: inv.PRICE,
        sacPer: per && per.SAC,
        pricePer: per && per.PRICE,
        amortSac: am.SAC,
        amortPrice: am.PRICE,
      };
    };
    const vantagem = (pt, sys) => (sys === 'SAC' ? pt.sacInv - pt.amortSac : pt.priceInv - pt.amortPrice);
    const empateNaVarredura = (sys) => pontos.findIndex((pt, k) => k > 0 && vantagem(pontos[k - 1], sys) < 0 && vantagem(pt, sys) >= 0);
    let fimVarredura = max;
    for (let k = 0; ; k++) {
      const real = Math.round((ini + k * passo) * 10000) / 10000;
      if (real > fimVarredura + 1e-9) break;
      pontos.push(ponto(real));
      // estende a varredura até passar dos dois empates com 2 p.p. de folga (no máximo IPCA + 40%)
      if (real >= fimVarredura - 1e-9 && fimVarredura < 0.4) {
        const ks = ['SAC', 'PRICE'].map(empateNaVarredura);
        if (ks.some((k) => k < 0)) fimVarredura += passo;
        else fimVarredura = Math.max(fimVarredura, Math.max(...ks.map((k) => pontos[k].real)) + 0.02);
      }
    }

    // empate: refina por bisseção dentro do intervalo da varredura em que o sinal troca
    const breakEven = {};
    ['SAC', 'PRICE'].forEach((sys) => {
      const k = empateNaVarredura(sys);
      if (k < 0) {
        breakEven[sys] = vantagem(pontos[0], sys) >= 0 ? pontos[0].real : null; // já vale desde o início, ou nunca
        return;
      }
      const f = (x) => fim(x, 'investir', 1)[sys] - fim(x, 'amortizar', 1)[sys];
      let lo = pontos[k - 1].real;
      let hi = pontos[k].real;
      for (let it = 0; it < 12; it++) {
        const mid = (lo + hi) / 2;
        if (f(mid) >= 0) hi = mid;
        else lo = mid;
      }
      breakEven[sys] = (lo + hi) / 2;
    });
    return { breakEven, sweep: pontos };
  }

  /**
   * Para cada taxa real (ex.: títulos do Tesouro convertidos para IPCA + x), o patrimônio no fim
   * de cada opção para a diferença das parcelas, e a melhor delas.
   * @param {Array<{real: number, meses?: number}>} p.rates  taxa real anual (decimal) e, opcionalmente, por quantos
   *        meses ela vale (ex.: até o vencimento do título); depois disso rende `reinvestimento`.
   *        Os demais campos de cada item são mantidos.
   * @param {number} [p.reinvestimento] taxa real anual após `meses` (padrão: a própria taxa)
   */
  function rankRates({ sac, price, months, ipca, applyIR, periodo = 12, rates, reinvestimento }) {
    return rates.map((item) => {
      const H = Math.max(months, sac.rows.length, price.rows.length);
      const meses = item.meses === undefined ? H : Math.max(0, Math.min(H, item.meses));
      const depois = reinvestimento === undefined ? item.real : reinvestimento;
      const taxa = meses >= H ? { real: item.real } : { real: depois, taxaInicial: { real: item.real, meses } };
      // taxa constante equivalente no período (média geométrica)
      const media = Math.pow(Math.pow(1 + item.real, meses) * Math.pow(1 + depois, H - meses), 1 / H) - 1;
      const fim = (mode, per) => {
        const c = compareInvestment({ sac, price, months, ipca, ...taxa, applyIR, mode, periodo: per, finalOnly: true });
        const l = c.series[c.series.length - 1];
        return { SAC: l.patrimonioSac, PRICE: l.patrimonioPrice, deflator: l.deflator };
      };
      const inv = fim('investir', 1);
      const am = fim('amortizar', 1);
      const per = periodo > 1 ? fim('amortizar', periodo) : null;
      const opcoes = [
        { id: 'SAC-investir', final: inv.SAC },
        { id: 'PRICE-investir', final: inv.PRICE },
      ];
      if (per) opcoes.push({ id: 'SAC-periodico', final: per.SAC }, { id: 'PRICE-periodico', final: per.PRICE });
      opcoes.push({ id: 'amortizar', final: am.PRICE });
      const melhor = opcoes.reduce((a, b) => (b.final > a.final ? b : a));
      return { ...item, mesesTaxa: meses, reinvestimento: meses < H ? depois : null, media, opcoes, melhor, amortizar: am.PRICE, deflator: inv.deflator };
    });
  }

  /**
   * Quanto é preciso pôr a mais por mês (valor fixo além da parcela original do contrato) para quitar
   * o financiamento até o mês `target`. O desembolso mensal é o mesmo em todas as opções
   * (parcela original + extra); o que exceder a parcela devida vai para:
   *  - 'abater':    amortizar todo mês;
   *  - 'periodico': investe o extra e a cada `periodo` meses (e no mês-alvo) resgata e amortiza;
   *  - 'fim':       investe o extra e quita tudo de uma vez no mês-alvo.
   * Considera os abatimentos cadastrados (`extras`). Retorna o menor extra (em centavos) que quita a tempo.
   */
  function payoffPlan({ principal, monthlyRate, months, system, extras, target, ipca, real, applyIR, periodo = 12 }) {
    const base = { principal, monthlyRate, months, system, extras, ipca, real, applyIR, budget: 0, pararAoQuitar: true };
    const contrato = runPolicy({ ...base, mode: 'investir' });
    const original = (k) => {
      const m = contrato.series[k - 1];
      return m && m.ativo ? m.parcela + m.abatimento : 0;
    };
    const budgetCom = (E) => (k) => original(k) + E;
    const T = Math.max(1, Math.min(Math.round(target), months));
    const opcoes = [
      { id: 'abater', mode: 'amortizar', periodo: 1 },
      { id: 'periodico', mode: 'amortizar', periodo, resgateFinal: T },
      { id: 'fim', mode: 'amortizar', periodo: T, resgateFinal: T },
    ].filter((o) => o.id !== 'periodico' || (periodo > 1 && periodo < T));

    const out = opcoes.map((o) => {
      const quitaAte = (E) => {
        const r = runPolicy({ ...base, ...o, budget: budgetCom(E), horizon: T, finalOnly: true });
        return r.quitacao !== null && r.quitacao <= T;
      };
      let E = 0;
      if (!quitaAte(0)) {
        let lo = 0;
        let hi = principal;
        while (!quitaAte(hi)) hi *= 2;
        while (hi - lo > 0.005) {
          const mid = (lo + hi) / 2;
          if (quitaAte(mid)) hi = mid;
          else lo = mid;
        }
        E = Math.ceil(hi * 100) / 100;
      }
      const run = runPolicy({ ...base, ...o, budget: budgetCom(E) });
      let totalDesembolsado = 0;
      let ir = 0;
      run.series.forEach((m) => {
        if (m.ativo) totalDesembolsado += m.parcela + m.abatimento + m.sobra;
        ir += m.ir;
      });
      const q = run.quitacao;
      const primeiro = run.series[0];
      return {
        id: system + '-' + o.id,
        system,
        opcao: o.id,
        periodo: o.periodo,
        extra: E,
        run,
        quitacao: q,
        totalJuros: run.totalJuros,
        jurosEconomizados: contrato.totalJuros - run.totalJuros,
        ir,
        totalDesembolsado,
        primeiroDesembolso: primeiro.parcela + primeiro.abatimento + primeiro.sobra,
        budget: budgetCom(E),
        sobraCarteira: q ? run.series[q - 1].carteira : 0, // o que sobra investido ao quitar
      };
    });
    return { target: T, contrato: { quitacao: contrato.quitacao, totalJuros: contrato.totalJuros, series: contrato.series }, options: out };
  }

  /**
   * Compara as estratégias de orçamento fixo e calcula a taxa real (IPCA + z) a partir da qual
   * investir passa a valer mais que amortizar todo mês.
   */
  function compareStrategies(p) {
    const minBudget = p.principal / p.months + p.principal * p.monthlyRate; // 1ª parcela SAC
    const budget = Math.max(p.budget || 0, minBudget);
    const base = { ...p, budget };
    const list = [
      { id: 'sacInv', nome: 'SAC + investir a sobra', system: 'SAC', mode: 'investir' },
      { id: 'priceInv', nome: 'PRICE + investir a sobra', system: 'PRICE', mode: 'investir' },
      { id: 'pricePer', nome: 'PRICE + investir e amortizar a cada ' + p.periodo + ' meses', system: 'PRICE', mode: 'amortizar', periodo: p.periodo },
      { id: 'amortMes', nome: 'Amortizar a sobra todo mês (SAC ou PRICE)', system: 'PRICE', mode: 'amortizar', periodo: 1 },
    ].filter((st) => st.id !== 'pricePer' || p.periodo > 1).map((s) => ({ ...s, ...budgetStrategy({ ...base, system: s.system, mode: s.mode, periodo: s.periodo || 1 }) }));

    const finalAt = (real) => {
      const q = { ...base, real };
      const amort = budgetStrategy({ ...q, system: 'PRICE', mode: 'amortizar', periodo: 1 }).final;
      const inv = Math.max(
        budgetStrategy({ ...q, system: 'SAC', mode: 'investir' }).final,
        budgetStrategy({ ...q, system: 'PRICE', mode: 'investir' }).final
      );
      return inv - amort;
    };
    let lo = -0.1;
    let hi = 0.4;
    let flo = finalAt(lo);
    let breakEven = null;
    if (flo * finalAt(hi) <= 0) {
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        const fm = finalAt(mid);
        if (fm * flo <= 0) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      breakEven = (lo + hi) / 2;
    }
    return { budget, minBudget, strategies: list, breakEven };
  }

  /**
   * Marcos da carteira de uma estratégia enquanto o financiamento está ativo
   * (primeiro mês em que cada condição ocorre; null se não ocorrer):
   *  - rendeJuros:   rendimento do mês >= juros da parcela do mês
   *  - rendeParcela: rendimento do mês >= parcela inteira
   *  - quita:        carteira >= saldo devedor (daria para quitar o financiamento)
   */
  function milestones(series, suf) {
    const out = { rendeJuros: null, rendeParcela: null, quita: null };
    for (const s of series) {
      if (!s['ativo' + suf]) break;
      const rend = s['rendimento' + suf];
      if (out.rendeJuros === null && rend > 0 && rend >= s['juros' + suf]) out.rendeJuros = s.mes;
      if (out.rendeParcela === null && rend > 0 && rend >= s['parcela' + suf]) out.rendeParcela = s.mes;
      const saldo = s['saldo' + suf];
      if (out.quita === null && saldo > 0 && s['carteira' + suf] >= saldo) out.quita = s.mes;
    }
    return out;
  }

  const api = {
    annualToMonthly,
    pmt,
    nper,
    expandExtras,
    simulate,
    irRate,
    valueAt,
    compareInvestment,
    compareAllPolicies,
    investVsAmortize,
    rankRates,
    payoffPlan,
    milestones,
    budgetStrategy,
    compareStrategies,
    runPolicy,
    solveReal,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = api;
})(typeof window !== 'undefined' ? window : globalThis);
