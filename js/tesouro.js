/*
 * Leitura do CSV de títulos do Tesouro Direto e conversão das taxas para "IPCA + x%".
 * Funciona no navegador (window.Tesouro) e no Node (module.exports).
 */
(function (root) {
  'use strict';

  /** Decodifica o arquivo: UTF-8 se for válido, senão Windows-1252 (Latin-1), comum em CSVs brasileiros. */
  function decodeCSV(buffer) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (_) {
      return new TextDecoder('windows-1252').decode(buffer);
    }
  }

  /** "1.234,56" -> 1234.56 (aceita "R$", espaços e espaço não separável). */
  function parseNumBR(s) {
    if (s === undefined || s === null) return NaN;
    const limpo = String(s).replace(/[^\d,.\-]/g, '');
    if (!limpo) return NaN;
    return Number(limpo.replace(/\./g, '').replace(',', '.'));
  }

  /** Interpreta o rendimento: "IPCA + 7,80%", "SELIC + 0,1083%", "SELIC", "14,90%". */
  function parseRendimento(s) {
    const t = String(s || '').trim();
    let m = t.match(/^IPCA\s*\+\s*([\d.,]+)\s*%?$/i);
    if (m) return { indexador: 'IPCA', taxa: parseNumBR(m[1]) / 100 };
    m = t.match(/^SELIC(?:\s*\+\s*([\d.,]+)\s*%?)?$/i);
    if (m) return { indexador: 'SELIC', taxa: m[1] ? parseNumBR(m[1]) / 100 : 0 };
    m = t.match(/^([\d.,]+)\s*%$/);
    if (m) return { indexador: 'PRE', taxa: parseNumBR(m[1]) / 100 };
    return null;
  }

  /** "15/08/2032" -> Date (UTC). */
  function parseData(s) {
    const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
  }

  const semAcento = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

  function splitLinha(linha, sep) {
    // CSV simples com aspas opcionais
    const out = [];
    let cur = '';
    let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === '"') {
        if (aspas && linha[i + 1] === '"') {
          cur += '"';
          i++;
        } else aspas = !aspas;
      } else if (c === sep && !aspas) {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  }

  /**
   * Lê o CSV do Tesouro Direto. Reconhece as colunas pelo nome (mesmo com acentos corrompidos)
   * e, se não reconhecer, usa a ordem padrão: título; rendimento; mínimo; preço unitário; vencimento.
   * @returns {{titulos: Array, ignorados: Array<{linha: number, texto: string, motivo: string}>}}
   */
  function parseTesouroCSV(texto) {
    const linhas = String(texto || '')
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .filter((l) => l.trim());
    if (!linhas.length) return { titulos: [], ignorados: [] };
    const sep = linhas[0].includes(';') ? ';' : linhas[0].includes('\t') ? '\t' : ',';
    const header = splitLinha(linhas[0], sep).map(semAcento);
    const acha = (fn, padrao) => {
      const k = header.findIndex(fn);
      return k >= 0 ? k : padrao;
    };
    const temCabecalho = header.some((h) => h.includes('rendimento') || h.includes('vencimento'));
    const col = {
      rendimento: acha((h) => h.includes('rendimento'), 1),
      vencimento: acha((h) => h.includes('vencimento'), 4),
      minimo: acha((h) => /investimento m/.test(h), 2),
      preco: acha((h) => h.includes('unit'), 3),
    };
    col.nome = acha((h, k) => /t.?.?tulo|titulo|nome/.test(h) && k !== col.rendimento && k !== col.vencimento, 0);

    const titulos = [];
    const ignorados = [];
    linhas.slice(temCabecalho ? 1 : 0).forEach((linha, k) => {
      const v = splitLinha(linha, sep);
      const nome = v[col.nome];
      const rend = parseRendimento(v[col.rendimento]);
      const nLinha = k + (temCabecalho ? 2 : 1);
      if (!nome || !rend || !isFinite(rend.taxa)) {
        ignorados.push({ linha: nLinha, texto: linha, motivo: !nome ? 'sem nome' : 'rendimento não reconhecido' });
        return;
      }
      const n = semAcento(nome);
      titulos.push({
        nome,
        rendimentoTexto: v[col.rendimento],
        indexador: rend.indexador,
        taxa: rend.taxa,
        minimo: parseNumBR(v[col.minimo]),
        preco: parseNumBR(v[col.preco]),
        vencimento: parseData(v[col.vencimento]),
        renda: /renda\+|educa\+/.test(n), // pagam renda mensal após a conversão
        cupom: n.includes('juros semestrais'),
      });
    });
    return { titulos, ignorados };
  }

  /**
   * Converte o rendimento do título em taxa real equivalente (IPCA + x), já descontada a custódia.
   * @param {object} t título (parseTesouroCSV)
   * @param {object} p { ipca, selic, custodia } anuais em decimal
   */
  function taxaReal(t, { ipca, selic, custodia = 0 }) {
    let nominal;
    if (t.indexador === 'IPCA') nominal = (1 + ipca) * (1 + t.taxa) - 1;
    else if (t.indexador === 'SELIC') nominal = (1 + selic) * (1 + t.taxa) - 1;
    else nominal = t.taxa;
    const liquidoCustodia = (1 + nominal) * (1 - custodia) - 1;
    return { nominal, nominalLiquido: liquidoCustodia, real: (1 + liquidoCustodia) / (1 + ipca) - 1 };
  }

  const api = { decodeCSV, parseNumBR, parseRendimento, parseData, parseTesouroCSV, taxaReal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tesouro = api;
})(typeof window !== 'undefined' ? window : globalThis);
