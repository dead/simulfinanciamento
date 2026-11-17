/* Interface do simulador. Depende de window.Finance (js/finance.js) e Chart.js. */
(function () {
  'use strict';
  const F = window.Finance;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ estado
  const DEFAULTS = {
    principal: 400000,
    taxa: 11.5,
    prazo: 360,
    ipca: 4.5,
    real: 6.5,
    ir: true,
    hoje: false,
    extras: [],
    metric: 'parcela',
    showBase: true,
    invView: 'vantagem',
    tableSys: 'SAC',
    budget: '',
    periodo: 12,
    stratView: 'diff',
    stratTable: 'best',
    stratFilter: 'todos',
    invMode: 'investir',
    invPeriodo: 12,
    invTableSys: 'PRICE',
    invFilter: 'todos',
    allView: 'diff',
    payoffTarget: '',
    payoffPeriodo: 12,
    payoffSel: 'PRICE-abater',
    payoffFilter: 'ativo',
  };

  function loadState() {
    try {
      const raw = decodeURIComponent(location.hash.slice(1));
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (_) { /* hash inválido: usa padrão */ }
    return { ...DEFAULTS };
  }
  const state = loadState();

  function saveState() {
    try {
      history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(state)));
    } catch (_) { /* ignore */ }
  }

  // ------------------------------------------------------------------ formatação
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
  const num2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v, d = 2) => (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  const anos = (m) => {
    const a = Math.floor(m / 12);
    const r = m % 12;
    const parts = [];
    if (a) parts.push(a + (a === 1 ? ' ano' : ' anos'));
    if (r) parts.push(r + (r === 1 ? ' mês' : ' meses'));
    return parts.join(' e ') || '0 meses';
  };
  const signed = (v, fmt = brl) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt.format(Math.abs(v));
  const alpha = (hex, a) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ------------------------------------------------------------------ entradas
  /** "todo mês" para 1, "a cada N meses" para N > 1. */
  const cada = (n) => (Number(n) === 1 ? 'todo mês' : 'a cada ' + n + ' meses');

  /** Campos "a cada N meses": aceitam 1 a 120; valor inválido é sinalizado (e o anterior mantido). */
  function bindPeriodo(id, key) {
    const el = $(id);
    const hint = $(el.getAttribute('aria-describedby'));
    const base = hint.textContent;
    const show = (msg, invalid) => {
      hint.textContent = msg;
      hint.classList.toggle('invalid', invalid);
      el.setAttribute('aria-invalid', String(invalid));
    };
    const ok = (v) => {
      state[key] = v;
      show(v === 1 ? '1 = todo mês: o mesmo que amortizar todo mês' : base, false);
    };
    if (!(Number.isInteger(state[key]) && state[key] >= 1 && state[key] <= 120)) state[key] = 12;
    el.value = state[key];
    ok(state[key]);
    el.addEventListener('input', () => {
      const v = Number(el.value);
      if (Number.isInteger(v) && v >= 1 && v <= 120) {
        ok(v);
        schedule(250);
      } else if (el.value !== '') {
        show('Use um número inteiro de 1 a 120 (usando ' + state[key] + ').', true);
      }
    });
  }

  const numInputs = ['principal', 'taxa', 'prazo', 'ipca', 'real'];
  numInputs.forEach((k) => {
    const el = $(k);
    el.value = state[k];
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!isNaN(v)) {
        state[k] = v;
        schedule();
      }
    });
  });
  ['ir', 'hoje', 'showBase'].forEach((k) => {
    const el = $(k === 'showBase' ? 'show-base' : k);
    el.checked = !!state[k];
    el.addEventListener('change', () => {
      state[k] = el.checked;
      schedule();
    });
  });

  function bindSeg(id, key) {
    const seg = $(id);
    const sync = () =>
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === state[key])));
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state[key] = b.dataset.v;
      sync();
      schedule(0);
    });
    sync();
  }
  bindSeg('metric-seg', 'metric');
  bindSeg('inv-seg', 'invView');
  bindSeg('table-seg', 'tableSys');
  bindSeg('strat-seg', 'stratView');
  bindSeg('inv-table-seg', 'invTableSys');
  bindSeg('all-seg', 'allView');

  $('payoff-target').value = state.payoffTarget;
  $('payoff-target').addEventListener('input', (e) => {
    const v = Math.round(parseFloat(e.target.value));
    state.payoffTarget = isNaN(v) ? '' : v;
    schedule(250);
  });
  bindPeriodo('payoff-periodo', 'payoffPeriodo');
  $('payoff-filter').value = state.payoffFilter;
  $('payoff-filter').addEventListener('change', (e) => {
    state.payoffFilter = e.target.value;
    schedule(0);
  });
  $('payoff-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    state.payoffSel = tr.dataset.id;
    schedule(0);
  });
  $('payoff-csv').addEventListener('click', () => {
    if (!last) return;
    const o = pickPayoff(last.payoff);
    download('quitar-em-' + last.payoff.target + '-' + o.id.toLowerCase() + '.csv', csvLines(o.run.series));
  });
  const syncInvSeg = () =>
    $('inv-table-seg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === state.invTableSys)));
  $('all-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const [sys, policy] = tr.dataset.id.split('-');
    state.invMode = policy;
    state.invTableSys = sys;
    $('inv-mode').value = policy;
    syncInvSeg();
    schedule(0);
    $('sel-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('inv-mode').value = state.invMode;
  $('inv-mode').addEventListener('change', (e) => {
    state.invMode = e.target.value;
    schedule(0);
  });
  bindPeriodo('inv-periodo', 'invPeriodo');
  $('inv-filter').value = state.invFilter;
  $('inv-filter').addEventListener('change', (e) => {
    state.invFilter = e.target.value;
    schedule(0);
  });
  $('inv-csv').addEventListener('click', () => {
    if (!last) return;
    const run = last.inv.runs[state.invTableSys];
    download('diferenca-comprador-' + state.invTableSys.toLowerCase() + '.csv', csvLines(run.series));
  });

  $('strat-filter').value = state.stratFilter;
  $('strat-filter').addEventListener('change', (e) => {
    state.stratFilter = e.target.value;
    schedule(0);
  });
  $('strat-table-sel').addEventListener('change', (e) => {
    state.stratTable = e.target.value;
    schedule(0);
  });
  $('strat-csv').addEventListener('click', () => {
    if (!last) return;
    const st = pickStrategy(last.strat);
    download('estrategia-' + st.id + '.csv', csvLines(st.series));
  });

  $('budget').value = state.budget;
  $('budget').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    state.budget = isNaN(v) ? '' : v;
    schedule(250);
  });
  bindPeriodo('periodo', 'periodo');

  // ------------------------------------------------------------------ abatimentos
  const tpl = $('extra-row');
  function renderExtras() {
    const body = $('extras-body');
    body.textContent = '';
    state.extras.forEach((ex, idx) => {
      const tr = tpl.content.firstElementChild.cloneNode(true);
      tr.querySelectorAll('[data-k]').forEach((el) => {
        const k = el.dataset.k;
        el.value = ex[k] ?? '';
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
          ex[k] = k === 'modo' ? el.value : el.value === '' ? '' : parseFloat(el.value);
          schedule();
        });
      });
      tr.querySelector('[data-remove]').addEventListener('click', () => {
        state.extras.splice(idx, 1);
        renderExtras();
        schedule(0);
      });
      body.appendChild(tr);
    });
    $('extras-empty').hidden = state.extras.length > 0;
    $('extras-table').hidden = state.extras.length === 0;
  }
  $('add-extra').addEventListener('click', () => {
    const last = state.extras[state.extras.length - 1];
    state.extras.push({
      mes: last ? (Number(last.mes) || 0) + 12 : 12,
      valor: last ? last.valor : 20000,
      repetir: 0,
      ate: '',
      modo: 'prazo',
    });
    renderExtras();
    schedule(0);
    const inputs = $('extras-body').querySelectorAll('input[data-k="mes"]');
    inputs[inputs.length - 1].focus();
  });

  // ------------------------------------------------------------------ cálculo
  let timer = null;
  function schedule(delay = 120) {
    clearTimeout(timer);
    timer = setTimeout(update, delay);
  }

  function inputsValid() {
    return state.principal > 0 && state.prazo >= 1 && state.prazo <= 600 && state.taxa >= 0 && state.taxa < 100;
  }

  let last = null;
  function compute() {
    const months = Math.round(state.prazo);
    const monthlyRate = F.annualToMonthly(state.taxa / 100);
    const extras = state.extras.filter((e) => Number(e.valor) > 0 && Number(e.mes) >= 1);
    const common = { principal: state.principal, monthlyRate, months };
    const sac = F.simulate({ ...common, system: 'SAC', extras });
    const price = F.simulate({ ...common, system: 'PRICE', extras });
    const baseSac = extras.length ? F.simulate({ ...common, system: 'SAC' }) : sac;
    const basePrice = extras.length ? F.simulate({ ...common, system: 'PRICE' }) : price;
    const invParams = { months, ipca: state.ipca / 100, real: state.real / 100, applyIR: state.ir };
    const policy = {
      mode: state.invMode === 'investir' ? 'investir' : 'amortizar',
      periodo: state.invMode === 'periodico' ? state.invPeriodo : 1,
    };
    const inv = F.compareInvestment({ sac, price, ...invParams, ...policy });
    const breakEven = inv.breakEven;
    // referência: só investir a diferença
    const invOnly = state.invMode === 'investir' ? null : F.compareInvestment({ sac, price, ...invParams, mode: 'investir', finalOnly: true });
    const all = F.compareAllPolicies({ sac, price, ...invParams, periodo: state.invPeriodo });
    const target = Number(state.payoffTarget) >= 1 ? Math.min(Number(state.payoffTarget), months) : Math.round(months / 2);
    const payoffBase = { principal: state.principal, monthlyRate, months, extras, target, periodo: state.payoffPeriodo, ...invParams };
    const pS = F.payoffPlan({ ...payoffBase, system: 'SAC' });
    const pP = F.payoffPlan({ ...payoffBase, system: 'PRICE' });
    const payoff = { target: pS.target, contratos: { SAC: pS.contrato, PRICE: pP.contrato }, options: [...pS.options, ...pP.options] };
    const strat = F.compareStrategies({
      principal: state.principal, monthlyRate, months, budget: Number(state.budget) || 0, periodo: state.periodo, ...invParams,
    });
    return { months, monthlyRate, extras, sac, price, baseSac, basePrice, inv, invOnly, breakEven, strat, all, payoff };
  }

  function update() {
    saveState();
    if (!inputsValid()) return;
    const r = compute();
    last = r;
    $('taxa-mensal').textContent = '≈ ' + pct(r.monthlyRate, 4) + ' a.m.';
    $('prazo-anos').textContent = anos(Math.round(state.prazo));
    $('taxa-inv').textContent =
      '= ' + pct((1 + state.ipca / 100) * (1 + state.real / 100) - 1) + ' a.a. nominal (' + pct(r.inv.monthlyRate, 3) + ' a.m.)';
    renderSummary(r);
    renderCompChart(r);
    renderAllOptions(r);
    renderInvestment(r);
    renderStrategies(r);
    renderPayoff(r);
    renderTable(r);
  }

  // ------------------------------------------------------------------ resumo
  function renderSummary({ sac, price, baseSac, basePrice, extras }) {
    const s = sac.summary;
    const p = price.summary;
    const rows = [
      ['1ª parcela', s.primeira, p.primeira],
      ['Última parcela', s.ultima, p.ultima],
      ['Maior parcela', s.maior, p.maior],
      ['Prazo efetivo', s.prazo, p.prazo, 'meses'],
      ['Total de juros', s.totalJuros, p.totalJuros],
    ];
    if (extras.length) rows.push(['Total abatido', s.totalExtras, p.totalExtras, 'neutral']);
    rows.push(['Total desembolsado', s.totalPago, p.totalPago, 'strong']);
    if (extras.length) {
      rows.push(['Juros economizados c/ abatimentos', baseSac.summary.totalJuros - s.totalJuros, basePrice.summary.totalJuros - p.totalJuros, 'more-good']);
      rows.push(['Meses a menos c/ abatimentos', baseSac.summary.prazo - s.prazo, basePrice.summary.prazo - p.prazo, 'meses more-good']);
    }

    const body = $('summary-body');
    body.textContent = '';
    rows.forEach(([label, a, b, flags = '']) => {
      const isMonths = flags.includes('meses');
      const fmt = (v) => (isMonths ? v + ' (' + anos(v) + ')' : brl.format(v));
      const diff = b - a;
      const tr = document.createElement('tr');
      if (flags.includes('strong')) tr.className = 'strong';
      const cells = [label, fmt(a), fmt(b), isMonths ? signed(diff, { format: (x) => x + ' m' }) : signed(diff)];
      cells.forEach((c, i) => {
        const td = document.createElement('td');
        td.textContent = c;
        if (i === 3 && Math.abs(diff) > 0.005 && !flags.includes('neutral')) {
          const good = flags.includes('more-good') ? diff > 0 : diff < 0;
          td.className = good ? 'neg' : 'pos';
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  // ------------------------------------------------------------------ gráficos
  const charts = {};
  const hasChart = typeof window.Chart !== 'undefined';

  const crosshair = {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
      const active = chart.tooltip && chart.tooltip.getActiveElements();
      if (!active || !active.length) return;
      const x = active[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = css('--axis');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  function baseOptions({ stacked = false } = {}) {
    const text2 = css('--text-2');
    const muted = css('--muted');
    const grid = css('--grid');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'start',
          labels: { color: text2, usePointStyle: true, pointStyle: 'line', boxWidth: 18, font: { family: css('--font') } },
        },
        tooltip: {
          backgroundColor: css('--surface'),
          titleColor: css('--text'),
          bodyColor: css('--text'),
          borderColor: css('--border'),
          borderWidth: 1,
          padding: 10,
          usePointStyle: true,
          boxWidth: 14,
          boxHeight: 2,
          filter: (item) => item.raw !== null && item.raw !== undefined,
          callbacks: {
            title: (items) => {
              const m = Number(items[0].label);
              return 'Mês ' + m + ' · ' + anos(m);
            },
            label: (item) => ' ' + brl.format(item.raw) + '  ' + item.dataset.label,
          },
        },
      },
      scales: {
        x: {
          stacked,
          grid: { display: false },
          border: { color: css('--axis') },
          ticks: {
            color: muted,
            maxRotation: 0,
            autoSkip: false,
            callback(value, index) {
              const m = Number(this.getLabelForValue(value));
              const total = this.chart.data.labels.length;
              const step = total > 240 ? 60 : total > 120 ? 24 : 12;
              return m % step === 0 ? 'ano ' + m / 12 : null;
            },
          },
        },
        y: {
          stacked,
          grid: { color: grid },
          border: { display: false },
          ticks: { color: muted, callback: (v) => brlCompact.format(v) },
        },
      },
    };
  }

  function lineDataset(label, data, color, { dashed = false } = {}) {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      borderDash: dashed ? [5, 4] : undefined,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBorderWidth: 2,
      pointHoverBorderColor: css('--surface'),
      tension: 0,
      spanGaps: false,
    };
  }

  function drawChart(key, canvasId, type, labels, datasets, opts) {
    if (!hasChart) return;
    if (charts[key] && charts[key].config.type !== type) {
      charts[key].destroy();
      charts[key] = null;
    }
    if (!charts[key]) {
      charts[key] = new Chart($(canvasId), { type, data: { labels, datasets }, options: opts, plugins: [crosshair] });
    } else {
      const c = charts[key];
      c.data.labels = labels;
      c.data.datasets = datasets;
      c.options = opts;
      c.update('none');
    }
  }

  function metricSeries(sim, metric, len) {
    const out = [];
    let acum = 0;
    for (let k = 0; k < len; k++) {
      const row = sim.rows[k];
      if (metric === 'parcela') out.push(row ? row.parcela : null);
      else if (metric === 'saldo') out.push(row ? row.saldo : 0);
      else if (metric === 'juros') out.push((acum += row ? row.juros : 0));
      else out.push((acum += row ? row.parcela + row.extra : 0));
    }
    return out;
  }

  function renderCompChart({ months, sac, price, baseSac, basePrice, extras }) {
    const hasExtras = extras.length > 0;
    $('show-base-wrap').hidden = !hasExtras;
    const labels = Array.from({ length: months }, (_, i) => i + 1);
    const m = state.metric;
    const cSac = css('--sac');
    const cPrice = css('--price');
    const ds = [lineDataset('SAC', metricSeries(sac, m, months), cSac), lineDataset('PRICE', metricSeries(price, m, months), cPrice)];
    if (hasExtras && state.showBase) {
      ds.push(lineDataset('SAC sem abatimentos', metricSeries(baseSac, m, months), cSac, { dashed: true }));
      ds.push(lineDataset('PRICE sem abatimentos', metricSeries(basePrice, m, months), cPrice, { dashed: true }));
    }
    drawChart('comp', 'chart-comp', 'line', labels, ds, baseOptions());
  }

  // ------------------------------------------------------------------ investimento
  const POLICY = {
    investir: { nome: 'investimento', verbo: 'investe', opcao: 'investir a diferença', titulo: 'investir a diferença', dash: [] },
    amortizar: { nome: 'amortização mensal', verbo: 'amortiza', opcao: 'amortizar todo mês', titulo: 'amortizar a diferença todo mês', dash: [7, 4] },
    periodico: { nome: 'investir e amortizar', verbo: 'investe para amortizar', dash: [2, 3] },
  };
  const opcaoNome = (o) =>
    o.system + ' + ' + (o.policy === 'periodico' ? 'investir e amortizar ' + cada(o.periodo) : POLICY[o.policy].opcao);

  function lineKey(color, dash) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '8');
    svg.setAttribute('class', 'line-key');
    svg.setAttribute('aria-hidden', 'true');
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', '1');
    l.setAttribute('x2', '23');
    l.setAttribute('y1', '4');
    l.setAttribute('y2', '4');
    l.setAttribute('stroke', color);
    l.setAttribute('stroke-width', '2.5');
    l.setAttribute('stroke-linecap', 'round');
    if (dash.length) l.setAttribute('stroke-dasharray', dash.join(' '));
    svg.appendChild(l);
    return svg;
  }

  function renderAllOptions({ all }) {
    POLICY.periodico.titulo = 'investir e amortizar ' + cada(state.invPeriodo);
    const hojeTxt = state.hoje ? ' (em R$ de hoje)' : '';
    const fim = (o) => (state.hoje ? o.final / o.deflator : o.final);
    const color = (o) => css(o.system === 'SAC' ? '--sac' : '--price');
    const ranked = [...all].sort((a, b) => fim(b) - fim(a));
    const best = ranked[0];
    const empatados = ranked.filter((o) => fim(best) - fim(o) < 1);
    const proxima = ranked.find((o) => fim(best) - fim(o) >= 1);

    // veredito
    const v = $('all-verdict');
    v.textContent = '';
    const lead = document.createElement('strong');
    lead.textContent =
      'Melhor: ' + empatados.map(opcaoNome).join(' = ') + ', com ' + brl0.format(fim(best)) + ' no fim' + hojeTxt +
      (proxima ? ' — ' + brl0.format(fim(best) - fim(proxima)) + ' a mais que ' + opcaoNome(proxima) + '.' : '.');
    const det = document.createElement('div');
    det.className = 'hint';
    det.style.margin = '4px 0 0';
    det.textContent =
      'Amortizar rende a taxa do financiamento (' + pct(state.taxa / 100) + ' a.a.) sem IR e sem risco; investir só compensa se o investimento, depois do IR, render mais que isso. Antes de amortizar, mantenha uma reserva de emergência.';
    v.append(lead, det);

    // tabela
    const body = $('all-body');
    body.textContent = '';
    all.forEach((o) => {
      const tr = document.createElement('tr');
      tr.dataset.id = o.id;
      tr.title = 'Ver detalhes desta opção';
      const cls = [];
      if (empatados.includes(o)) cls.push('best');
      if (o.system === state.invTableSys && o.policy === state.invMode) cls.push('selected');
      tr.className = cls.join(' ');
      const name = document.createElement('td');
      name.append(lineKey(color(o), POLICY[o.policy].dash), document.createTextNode(opcaoNome(o)));
      tr.appendChild(name);
      const delta = fim(o) - fim(best);
      [
        o.quitacao ? 'mês ' + o.quitacao + ' (' + anos(o.quitacao) + ')' : '—',
        brl0.format(o.totalJuros),
        o.ir > 0.5 ? brl0.format(o.ir) : '—',
        brl0.format(fim(o)),
        Math.abs(delta) < 1 ? 'melhor' : signed(delta, brl0),
      ].forEach((txt, i) => {
        const td = document.createElement('td');
        td.textContent = txt;
        if (i === 4 && Math.abs(delta) >= 1) td.className = 'pos';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    // legenda HTML (mostra o tracejado de cada política)
    const legend = $('all-legend');
    legend.textContent = '';
    all.forEach((o) => {
      const it = document.createElement('span');
      it.append(lineKey(color(o), POLICY[o.policy].dash), document.createTextNode(opcaoNome(o)));
      legend.appendChild(it);
    });

    // gráfico
    const views = {
      diff: ['Diferença de patrimônio vs. a melhor opção' + hojeTxt, 'Quanto cada opção está atrás (abaixo de zero) ou à frente da melhor opção final, mês a mês. Cor = sistema; traço = o que fazer com a diferença.'],
      patrimonio: ['Patrimônio líquido' + hojeTxt, 'Carteira' + (state.ir ? ' (líquida de IR)' : '') + ' menos o saldo devedor. Cor = sistema; traço = o que fazer com a diferença.'],
      saldo: ['Saldo devedor' + hojeTxt, 'Amortizando, o financiamento acaba antes; daí em diante tudo o que sobra é investido.'],
    };
    $('all-title').textContent = views[state.allView][0];
    $('all-desc').textContent = views[state.allView][1];
    const d = (s, x) => (state.hoje ? x / s.deflator : x);
    const ref = best.series;
    const labels = ref.map((s) => s.mes);
    const ds = all.map((o) => {
      const data = o.series.map((s, k) => {
        if (state.allView === 'diff') return d(s, s.patrimonio - ref[k].patrimonio);
        if (state.allView === 'saldo') return d(s, s.saldo);
        return d(s, s.patrimonio);
      });
      const line = lineDataset(opcaoNome(o), data, color(o));
      line.borderDash = POLICY[o.policy].dash;
      return line;
    });
    const opts = baseOptions();
    opts.plugins.legend.display = false;
    drawChart('all', 'chart-all', 'line', labels, ds, opts);
  }
  const estrategia = (sys) => sys + ' + ' + POLICY[state.invMode].nome;

  function renderInvestment({ inv, invOnly, breakEven }) {
    const S = inv.summary;
    $('sel-title').textContent = 'Detalhes: ' + POLICY[state.invMode].titulo;
    const semMarcos = state.invMode === 'amortizar';
    $('marcos-table').hidden = semMarcos;
    $('marcos-hint').hidden = semMarcos;
    $('marcos-none').hidden = !semMarcos;
    const defl = state.hoje ? S.deflator : 1;
    const hojeTxt = state.hoje ? ' (em R$ de hoje)' : '';
    const vant = S.vantagemPrice / defl;
    const nominal = (1 + state.ipca / 100) * (1 + state.real / 100) - 1;

    // veredito
    const v = $('verdict');
    v.textContent = '';
    const lead = document.createElement('div');
    const strong = document.createElement('strong');
    if (Math.abs(vant) < 1) {
      strong.textContent =
        state.invMode === 'amortizar'
          ? 'Amortizando a diferença todo mês, SAC e PRICE terminam com o mesmo patrimônio (' + brl0.format(inv.series[inv.series.length - 1].patrimonioSac / defl) + hojeTxt + ').'
          : 'Empate técnico entre ' + estrategia('PRICE') + ' e ' + estrategia('SAC') + '.';
      lead.appendChild(strong);
    } else {
      const winner = estrategia(vant > 0 ? 'PRICE' : 'SAC');
      strong.textContent = winner + ' termina ' + brl0.format(Math.abs(vant)) + ' à frente' + hojeTxt + '.';
      lead.appendChild(strong);
    }
    v.appendChild(lead);
    const detail = document.createElement('div');
    detail.className = 'hint';
    detail.style.margin = '4px 0 0';
    let txt =
      'Rendimento de IPCA ' + pct(state.ipca / 100, 1) + ' + ' + pct(state.real / 100, 1) + ' = ' + pct(nominal) + ' a.a. nominal' +
      (state.ir ? ', líquido de IR' : '') + ', ao fim de ' + inv.horizon + ' meses. ';
    if (breakEven !== null) {
      txt += 'SAC e PRICE empatam com o investimento rendendo IPCA + ' + pct(breakEven) + ' a.a.; acima disso a PRICE leva vantagem, abaixo, a SAC.';
    }
    detail.textContent = txt;
    v.appendChild(detail);
    if (invOnly) {
      const lastA = inv.series[inv.series.length - 1];
      const lastI = invOnly.series[invOnly.series.length - 1];
      const cmp = document.createElement('div');
      cmp.className = 'hint';
      cmp.style.margin = '4px 0 0';
      cmp.textContent =
        'Em relação a só investir a diferença: comprador SAC ' + signed((lastA.patrimonioSac - lastI.patrimonioSac) / defl, brl0) +
        ', comprador PRICE ' + signed((lastA.patrimonioPrice - lastI.patrimonioPrice) / defl, brl0) + hojeTxt + '.';
      v.appendChild(cmp);
    }

    // cartões
    const subTile = (sys) => {
      const ap = S['aportado' + sys];
      const am = S['amortizado' + sys];
      const q = S['quitacao' + sys];
      if (state.invMode === 'investir') return 'aportado: ' + brl0.format(ap);
      return 'amortizado: ' + brl0.format(am) + (q ? ' · quita no mês ' + q : '');
    };
    const tiles = [
      { key: 'price', label: 'Comprador PRICE: carteira no fim', value: brl0.format(S.finalPrice / defl), sub: subTile('Price') },
      { key: 'sac', label: 'Comprador SAC: carteira no fim', value: brl0.format(S.finalSac / defl), sub: subTile('Sac') },
      {
        label: 'Virada das parcelas',
        value: inv.virada ? 'mês ' + inv.virada : '—',
        sub: inv.virada ? 'a partir daqui a SAC fica mais barata (' + anos(inv.virada) + ')' : 'a SAC nunca fica mais barata',
      },
      {
        label: 'Taxa de empate SAC × PRICE',
        value: breakEven !== null ? 'IPCA + ' + pct(breakEven) : '—',
        sub: breakEven === null && state.invMode === 'amortizar'
          ? 'amortizando todo mês, os dois terminam iguais'
          : 'taxa do financiamento: ' + pct(state.taxa / 100) + ' a.a.',
      },
    ];
    const box = $('inv-tiles');
    box.textContent = '';
    tiles.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'tile';
      const l = document.createElement('div');
      l.className = 'label';
      if (t.key) {
        const k = document.createElement('span');
        k.className = 'key key-' + t.key;
        l.appendChild(k);
      }
      l.appendChild(document.createTextNode(t.label));
      const val = document.createElement('div');
      val.className = 'value';
      val.textContent = t.value;
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = t.sub;
      el.append(l, val, sub);
      box.appendChild(el);
    });

    // gráfico
    const labels = inv.series.map((s) => s.mes);
    const d = (s, v) => (state.hoje ? v / s.deflator : v);
    const cSac = css('--sac');
    const cPrice = css('--price');
    const titles = {
      vantagem: ['Vantagem da PRICE sobre a SAC' + hojeTxt, 'Patrimônio de quem escolheu ' + estrategia('PRICE') + ' menos o de quem escolheu ' + estrategia('SAC') + '. Acima de zero, a PRICE está à frente; abaixo, a SAC. Durante o contrato pesa o saldo devedor de cada um.'],
      patrimonio: ['Patrimônio líquido' + hojeTxt, 'Carteira de investimentos menos o saldo devedor do financiamento, mês a mês. No fim do prazo o saldo é zero e sobra só a carteira.'],
      rendimento: ['Rendimento mensal da carteira × juros do financiamento' + hojeTxt, 'Linha cheia: quanto a carteira rendeu no mês' + (state.ir ? ' (líquido de IR)' : '') + '. Tracejado: juros pagos na parcela do mês. O ponto marca quando o rendimento passa a superar os juros.'],
      carteira: ['Carteiras de investimento' + hojeTxt, 'Valor de resgate de cada carteira' + (state.ir ? ', já descontado o IR' : '') + '.'],
      diferenca: ['Diferença por mês' + hojeTxt, 'Acima de zero: o comprador PRICE paga menos e ' + POLICY[state.invMode].verbo + ' a diferença. Abaixo de zero: é o comprador SAC quem paga menos e ' + POLICY[state.invMode].verbo + ' a diferença. Depois de quitar, cada um investe tudo o que sobra.'],
    };
    renderMarcos(inv, d);
    $('inv-title').textContent = titles[state.invView][0];
    $('inv-desc').textContent = titles[state.invView][1];

    if (state.invView === 'vantagem') {
      const ds = [lineDataset('PRICE − SAC', inv.series.map((s) => d(s, s.patrimonioPrice - s.patrimonioSac)), css('--text-2'))];
      ds[0].fill = { target: 'origin', above: alpha(cPrice, 0.25), below: alpha(cSac, 0.25) };
      const opts = baseOptions();
      opts.plugins.legend.display = false;
      opts.plugins.tooltip.callbacks.label = (item) =>
        ' ' + brl.format(Math.abs(item.raw)) + (item.raw >= 0 ? '  a favor da PRICE' : '  a favor da SAC');
      drawChart('inv', 'chart-inv', 'line', labels, ds, opts);
    } else if (state.invView === 'rendimento') {
      const marco = (sys) => inv.marcos[sys].rendeJuros;
      const withMarker = (ds, mes) => {
        ds.pointRadius = inv.series.map((s) => (s.mes === mes ? 5 : 0));
        const ring = css('--surface');
        ds.pointBorderColor = inv.series.map((s) => (s.mes === mes ? ring : ds.borderColor));
        ds.pointBorderWidth = 2;
        return ds;
      };
      const juros = (sys) => inv.series.map((s) => (s['ativo' + sys] ? d(s, s['juros' + sys]) : null));
      const ds = [
        withMarker(lineDataset('Rendimento SAC', inv.series.map((s) => d(s, s.rendimentoSac)), cSac), marco('SAC')),
        lineDataset('Juros SAC', juros('Sac'), cSac, { dashed: true }),
        withMarker(lineDataset('Rendimento PRICE', inv.series.map((s) => d(s, s.rendimentoPrice)), cPrice), marco('PRICE')),
        lineDataset('Juros PRICE', juros('Price'), cPrice, { dashed: true }),
      ];
      drawChart('inv', 'chart-inv', 'line', labels, ds, baseOptions());
    } else if (state.invView === 'diferenca') {
      const bar = (label, data, color) => ({ label, data, backgroundColor: color, borderWidth: 0, barPercentage: 1, categoryPercentage: 0.9 });
      const ds = [
        bar('Comprador PRICE ' + POLICY[state.invMode].verbo, inv.series.map((s) => (s.diferenca > 0 ? d(s, s.diferenca) : null)), cPrice),
        bar('Comprador SAC ' + POLICY[state.invMode].verbo, inv.series.map((s) => (s.diferenca < 0 ? d(s, s.diferenca) : null)), cSac),
      ];
      const opts = baseOptions({ stacked: true });
      opts.plugins.legend.labels.pointStyle = 'rect';
      opts.plugins.tooltip.callbacks.label = (item) => ' ' + brl.format(Math.abs(item.raw)) + '  ' + item.dataset.label;
      drawChart('inv', 'chart-inv', 'bar', labels, ds, opts);
    } else {
      const k = state.invView === 'patrimonio' ? ['patrimonioSac', 'patrimonioPrice'] : ['carteiraSac', 'carteiraPrice'];
      const ds = [
        lineDataset('Comprador SAC', inv.series.map((s) => d(s, s[k[0]])), cSac),
        lineDataset('Comprador PRICE', inv.series.map((s) => d(s, s[k[1]])), cPrice),
      ];
      drawChart('inv', 'chart-inv', 'line', labels, ds, baseOptions());
    }

    // tabela mês a mês do comprador escolhido
    const run = inv.runs[state.invTableSys];
    $('inv-table-sum').textContent = monthSummary('Comprador ' + state.invTableSys + ' (' + POLICY[state.invMode].nome + ')', run);
    const f = state.invFilter;
    const rows = run.series.filter((m) =>
      f === 'extra' ? m.amortExtra > 0 : f === 'acao' ? m.investido > 0.005 || m.amortExtra > 0.005 : true
    );
    $('inv-month-body').innerHTML = monthRowsHtml(rows, run.quitacao);
  }

  function renderMarcos(inv, d) {
    const quando = (mes) =>
      mes ? ['mês ' + mes, anos(mes)] : ['não ocorre', 'durante o contrato'];
    const acumulado = (sys) => {
      let rend = 0;
      let juros = 0;
      inv.series.forEach((s) => {
        if (!s['ativo' + sys]) return;
        rend += d(s, s['rendimento' + sys]);
        juros += d(s, s['juros' + sys]);
      });
      return [brl0.format(rend) + ' de ' + brl0.format(juros), juros > 0 ? pct(rend / juros, 0) + ' dos juros pagos' : ''];
    };
    const M = inv.marcos;
    const rows = [
      ['Rendimento do mês supera os juros do mês', quando(M.SAC.rendeJuros), quando(M.PRICE.rendeJuros)],
      ['Rendimento do mês paga a parcela inteira', quando(M.SAC.rendeParcela), quando(M.PRICE.rendeParcela)],
      ['Carteira já quitaria o saldo devedor', quando(M.SAC.quita), quando(M.PRICE.quita)],
      ['Rendimento acumulado × juros pagos no contrato' + (state.hoje ? ' (R$ de hoje)' : ''), acumulado('Sac'), acumulado('Price')],
    ];
    const body = $('marcos-body');
    body.textContent = '';
    rows.forEach(([label, a, b]) => {
      const tr = document.createElement('tr');
      const th = document.createElement('td');
      th.textContent = label;
      tr.appendChild(th);
      [a, b].forEach(([main, sub]) => {
        const td = document.createElement('td');
        td.append(document.createTextNode(main));
        const small = document.createElement('span');
        small.className = 'cell-sub';
        small.textContent = sub;
        td.appendChild(small);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  // ------------------------------------------------------------------ investir ou amortizar
  const STRAT_COLORS = { sacInv: '--sac', priceInv: '--price', pricePer: '--s3', amortMes: '--s4' };

  function renderStrategies({ strat }) {
    const list = strat.strategies;
    const d = (s, v) => (state.hoje ? v / s.deflator : v);
    const fim = (st) => (state.hoje ? st.final / st.deflator : st.final);
    const hojeTxt = state.hoje ? ' (em R$ de hoje)' : '';

    $('budget').placeholder = num2.format(strat.minBudget);
    $('budget-hint').textContent =
      (Number(state.budget) > 0 && Number(state.budget) < strat.minBudget ? 'Abaixo do mínimo; usando ' : 'Mínimo (1ª parcela SAC): ') +
      brl.format(strat.minBudget) + '. Em branco usa o mínimo.';

    const ranked = [...list].sort((a, b) => fim(b) - fim(a));
    const best = ranked[0];
    const second = ranked[1];

    // veredito
    const v = $('strat-verdict');
    v.textContent = '';
    const lead = document.createElement('strong');
    lead.textContent = best.nome + ' termina à frente, com ' + brl0.format(fim(best) - fim(second)) + ' a mais que “' + second.nome + '”' + hojeTxt + '.';
    const det = document.createElement('div');
    det.className = 'hint';
    det.style.margin = '4px 0 0';
    let t = 'Orçamento de ' + brl.format(strat.budget) + '/mês. ';
    if (strat.breakEven !== null) {
      t += 'Amortizar todo mês vale mais enquanto o investimento render menos que IPCA + ' + pct(strat.breakEven) + ' a.a.' +
        (state.ir ? ' (taxa bruta; o IR do resgate já está considerado)' : '') + '; acima disso, investir a sobra compensa mais.';
    }
    t += ' Amortizar rende a própria taxa do financiamento (' + pct(state.taxa / 100) + ' a.a.), sem IR e sem risco, mas o dinheiro não volta: mantenha uma reserva de emergência à parte.';
    det.textContent = t;
    v.append(lead, det);

    // tabela
    const body = $('strat-body');
    body.textContent = '';
    list.forEach((st) => {
      const tr = document.createElement('tr');
      if (st === best) tr.className = 'best';
      const name = document.createElement('td');
      const key = document.createElement('span');
      key.className = 'key';
      key.style.background = css(STRAT_COLORS[st.id]);
      name.append(key, document.createTextNode(st.nome));
      tr.appendChild(name);
      const delta = fim(st) - fim(best);
      [
        st.quitacao ? 'mês ' + st.quitacao + ' (' + anos(st.quitacao) + ')' : '—',
        brl0.format(st.totalJuros),
        brl0.format(fim(st)),
        st === best ? 'melhor' : signed(delta, brl0),
      ].forEach((txt, i) => {
        const td = document.createElement('td');
        td.textContent = txt;
        if (i === 3 && st !== best) td.className = 'pos';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    // gráfico
    const views = {
      diff: ['Diferença de patrimônio vs. SAC + investir' + hojeTxt, 'Quanto cada estratégia está à frente (acima de zero) ou atrás de “SAC + investir a sobra”, mês a mês.'],
      patrimonio: ['Patrimônio líquido' + hojeTxt, 'Carteira de investimentos' + (state.ir ? ' (líquida de IR)' : '') + ' menos o saldo devedor.'],
      saldo: ['Saldo devedor' + hojeTxt, 'Amortizando, o financiamento acaba muito antes; daí em diante o orçamento inteiro é investido.'],
    };
    $('strat-title').textContent = views[state.stratView][0];
    $('strat-desc').textContent = views[state.stratView][1];
    const ref = list.find((s) => s.id === 'sacInv').series;
    const labels = ref.map((s) => s.mes);
    const ds = list.map((st) => {
      const data = st.series.map((s, k) => {
        if (state.stratView === 'diff') return d(s, s.patrimonio - ref[k].patrimonio);
        if (state.stratView === 'saldo') return d(s, s.saldo);
        return d(s, s.patrimonio);
      });
      return lineDataset(st.nome, data, css(STRAT_COLORS[st.id]));
    });
    drawChart('strat', 'chart-strat', 'line', labels, ds, baseOptions());
    renderStrategyMonths(strat, best);
  }

  const ACOES = {
    investir: ['Investir', 'investir'],
    amortizar: ['Amortizar', 'amortizar'],
    quitar: ['Quitar e investir o resto', 'amortizar'],
    resgatar: ['Investir, resgatar tudo e amortizar', 'amortizar'],
    resgatarQuitar: ['Resgatar, quitar e reinvestir o resto', 'amortizar'],
    ultima: ['Última parcela; investir o resto', 'investir'],
    parcela: ['Só pagar a parcela', 'quitado'],
    quitado: ['Quitado: investir tudo', 'quitado'],
    livre: ['Financiamento quitado', 'quitado'],
  };

  function csvLines(series) {
    const lines = ['Mes;O que fazer;Parcela;Abatimento;Sobra;Investir;Resgatar;IR do resgate;Amortizacao extra;Saldo devedor;Carteira'];
    series.forEach((m) =>
      lines.push([m.mes, ACOES[m.acao][0], ...[m.parcela, m.abatimento, m.sobra, m.investido, m.resgate, m.ir, m.amortExtra, m.saldo, m.carteira].map((x) => num2.format(x))].join(';'))
    );
    return lines;
  }

  function monthSummary(nome, run) {
    const tot = { investido: 0, amortExtra: 0, ir: 0, mesesAmort: 0, mesesInv: 0 };
    run.series.forEach((m) => {
      tot.investido += m.investido;
      tot.amortExtra += m.amortExtra;
      tot.ir += m.ir;
      if (m.amortExtra > 0) tot.mesesAmort++;
      if (m.investido > 0.005) tot.mesesInv++;
    });
    let txt = nome + ': amortização extra em ' + tot.mesesAmort + ' meses (total ' + brl0.format(tot.amortExtra) + '), aportes em ' +
      tot.mesesInv + ' meses (total ' + brl0.format(tot.investido) + ')';
    if (tot.ir > 0) txt += ', IR pago nos resgates ' + brl0.format(tot.ir);
    txt += run.quitacao ? '. Quita no mês ' + run.quitacao + ' (' + anos(run.quitacao) + ').' : '.';
    return txt;
  }

  function monthRowsHtml(rows, quitacao) {
    const money = (v) => (v > 0.005 ? brl.format(v) : '—');
    return rows
      .map((m) => {
        const [label, cls] = ACOES[m.acao];
        return (
          '<tr' + (m.mes === quitacao ? ' class="payoff"' : '') + '><td>' + m.mes + '</td>' +
          '<td><span class="tag ' + cls + '">' + label + '</span></td>' +
          '<td>' + money(m.parcela) + (m.abatimento > 0.005 ? '<span class="ir">+ abatimento ' + brl.format(m.abatimento) + '</span>' : '') + '</td>' +
          '<td>' + money(m.investido) + '</td>' +
          '<td>' + money(m.resgate) + (m.ir > 0.005 ? '<span class="ir">IR ' + brl.format(m.ir) + '</span>' : '') + '</td>' +
          '<td' + (m.amortExtra > 0.005 ? ' class="has-extra"' : '') + '>' + money(m.amortExtra) + '</td>' +
          '<td>' + brl.format(m.saldo) + '</td><td>' + brl.format(m.carteira) + '</td></tr>'
        );
      })
      .join('');
  }

  function pickStrategy(strat) {
    const fim = (st) => (state.hoje ? st.final / st.deflator : st.final);
    const best = strat.strategies.reduce((a, b) => (fim(b) > fim(a) ? b : a));
    return strat.strategies.find((s) => s.id === state.stratTable) || best;
  }

  function renderStrategyMonths(strat, best) {
    const sel = $('strat-table-sel');
    sel.textContent = '';
    const optBest = document.createElement('option');
    optBest.value = 'best';
    optBest.textContent = 'Melhor estratégia: ' + best.nome;
    sel.appendChild(optBest);
    strat.strategies.forEach((st) => {
      const o = document.createElement('option');
      o.value = st.id;
      o.textContent = st.nome;
      sel.appendChild(o);
    });
    sel.value = strat.strategies.some((s) => s.id === state.stratTable) ? state.stratTable : 'best';

    const st = pickStrategy(strat);
    $('strat-table-sum').textContent = monthSummary(st.nome, st);
    const f = state.stratFilter;
    const rows = st.series.filter((m) => (f === 'extra' ? m.amortExtra > 0 : f === 'ativo' ? !st.quitacao || m.mes <= st.quitacao : true));
    $('strat-month-body').innerHTML = monthRowsHtml(rows, st.quitacao);
  }

  // ------------------------------------------------------------------ quitar antes do prazo
  const PAYOFF = {
    abater: { nome: () => 'abater todo mês', dash: [7, 4] },
    periodico: { nome: (o) => 'investir e abater ' + cada(o.periodo), dash: [2, 3] },
    fim: { nome: (o) => 'investir e quitar no mês ' + o.periodo, dash: [] },
  };
  const payoffNome = (o) => o.system + ' + ' + PAYOFF[o.opcao].nome(o);
  function pickPayoff(payoff) {
    return payoff.options.find((o) => o.id === state.payoffSel) || payoff.options[0];
  }

  function renderPayoff({ payoff, months }) {
    const T = payoff.target;
    const opts = payoff.options;
    $('payoff-target').placeholder = String(Math.round(months / 2));
    $('payoff-target-hint').textContent = '= ' + anos(T) + (state.payoffTarget === '' ? ' (padrão: metade do prazo)' : '') + '; contrato: ' + months + ' meses';
    const by = (sys, op) => opts.find((o) => o.system === sys && o.opcao === op);
    const color = (o) => css(o.system === 'SAC' ? '--sac' : '--price');

    // veredito
    const v = $('payoff-verdict');
    v.textContent = '';
    const lead = document.createElement('strong');
    const det = document.createElement('div');
    det.className = 'hint';
    det.style.margin = '4px 0 0';
    if (opts.every((o) => o.extra === 0)) {
      lead.textContent = 'Os contratos (com os abatimentos cadastrados) já terminam em até ' + T + ' meses — não é preciso nada extra.';
    } else {
      lead.textContent =
        'Para quitar em ' + T + ' meses (' + anos(T) + '): abata ' + brl.format(by('SAC', 'abater').extra) + '/mês a mais na SAC ou ' +
        brl.format(by('PRICE', 'abater').extra) + '/mês a mais na PRICE.';
      det.textContent =
        'Investindo para quitar de uma vez no fim, seria preciso ' + brl.format(by('SAC', 'fim').extra) + ' (SAC) ou ' +
        brl.format(by('PRICE', 'fim').extra) + ' (PRICE) por mês' +
        ' — abater rende a taxa do financiamento sem IR, então costuma exigir menos, a não ser que o investimento renda mais que ' +
        pct(state.taxa / 100) + ' a.a. depois do IR. Juros economizados abatendo: ' + brl0.format(by('SAC', 'abater').jurosEconomizados) +
        ' (SAC) e ' + brl0.format(by('PRICE', 'abater').jurosEconomizados) + ' (PRICE).';
    }
    v.append(lead, det);

    // tabela
    const minPor = {};
    opts.forEach((o) => {
      if (!(o.system in minPor) || o.extra < minPor[o.system]) minPor[o.system] = o.extra;
    });
    const sel = pickPayoff(payoff);
    const body = $('payoff-body');
    body.textContent = '';
    opts.forEach((o) => {
      const tr = document.createElement('tr');
      tr.dataset.id = o.id;
      tr.title = 'Ver mês a mês desta opção';
      const cls = [];
      if (o.extra === minPor[o.system]) cls.push('best');
      if (o === sel) cls.push('selected');
      tr.className = cls.join(' ');
      const name = document.createElement('td');
      name.append(lineKey(color(o), PAYOFF[o.opcao].dash), document.createTextNode(payoffNome(o)));
      tr.appendChild(name);
      [
        brl.format(o.extra),
        brl.format(o.primeiroDesembolso),
        brl0.format(o.totalJuros),
        brl0.format(o.jurosEconomizados),
        o.ir > 0.5 ? brl0.format(o.ir) : '—',
        brl0.format(o.totalDesembolsado),
      ].forEach((txt) => {
        const td = document.createElement('td');
        td.textContent = txt;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    // legenda + gráfico do saldo
    const legend = $('payoff-legend');
    legend.textContent = '';
    opts.forEach((o) => {
      const it = document.createElement('span');
      it.append(lineKey(color(o), PAYOFF[o.opcao].dash), document.createTextNode(payoffNome(o)));
      legend.appendChild(it);
    });
    const labels = Array.from({ length: months }, (_, k) => k + 1);
    const ds = opts.map((o) => {
      const line = lineDataset(payoffNome(o), o.run.series.map((m) => m.saldo), color(o));
      line.borderDash = PAYOFF[o.opcao].dash;
      return line;
    });
    ['SAC', 'PRICE'].forEach((sys) => {
      const line = lineDataset(sys + ' sem extra (contrato)', payoff.contratos[sys].series.map((m) => m.saldo), alpha(css(sys === 'SAC' ? '--sac' : '--price'), 0.35));
      line.borderWidth = 1.5;
      ds.push(line);
    });
    const o2 = baseOptions();
    o2.plugins.legend.display = false;
    drawChart('payoff', 'chart-payoff', 'line', labels, ds, o2);

    // mês a mês
    $('payoff-sel-title').textContent = 'Mês a mês: ' + payoffNome(sel);
    $('payoff-table-sum').textContent =
      monthSummary(payoffNome(sel) + ' (extra de ' + brl.format(sel.extra) + '/mês)', sel.run) +
      (sel.sobraCarteira > 0.5 ? ' Sobra investido ao quitar: ' + brl.format(sel.sobraCarteira) + '.' : '');
    const f = state.payoffFilter;
    const rows = sel.run.series.filter((m) =>
      f === 'extra' ? m.amortExtra > 0 : f === 'ativo' ? !sel.quitacao || m.mes <= sel.quitacao : true
    );
    $('payoff-month-body').innerHTML = monthRowsHtml(rows, sel.quitacao);
  }

  // ------------------------------------------------------------------ tabela
  function renderTable(r) {
    const sim = state.tableSys === 'SAC' ? r.sac : r.price;
    const html = sim.rows
      .map(
        (row) =>
          '<tr><td>' + row.mes + '</td><td>' + brl.format(row.parcela) + '</td><td>' + brl.format(row.juros) +
          '</td><td>' + brl.format(row.amort) + '</td><td' + (row.extra ? ' class="has-extra">' + brl.format(row.extra) : '>—') +
          '</td><td>' + brl.format(row.saldo) + '</td></tr>'
      )
      .join('');
    $('amort-body').innerHTML = html;
  }

  $('csv').addEventListener('click', () => {
    if (!last) return;
    const sim = state.tableSys === 'SAC' ? last.sac : last.price;
    const lines = ['Mes;Parcela;Juros;Amortizacao;Abatimento;Saldo devedor'];
    sim.rows.forEach((r) => lines.push([r.mes, num2.format(r.parcela), num2.format(r.juros), num2.format(r.amort), num2.format(r.extra), num2.format(r.saldo)].join(';')));
    download('amortizacao-' + state.tableSys.toLowerCase() + '.csv', lines);
  });

  function download(name, lines) {
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------------ tema
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => {
    Object.keys(charts).forEach((k) => {
      if (charts[k]) charts[k].destroy();
      charts[k] = null;
    });
    update();
  };
  if (mq.addEventListener) mq.addEventListener('change', onTheme);

  renderExtras();
  update();
})();
