<img src="assets/icon.svg" width="64" height="64" alt="">

# simulfinanciamento

Simulador de financiamento **SAC × PRICE** em uma página estática (HTML + JS puro, Chart.js via CDN).

- Resumo lado a lado (parcelas, prazo efetivo, juros e total desembolsado).
- **Abatimentos** únicos ou recorrentes, com efeito “reduzir prazo” ou “reduzir parcela”, e comparação com o cenário sem abatimentos.
- Gráfico comparando SAC e PRICE: parcela, saldo devedor, juros acumulados e total desembolsado.
- **Diferença das parcelas: investir ou amortizar**: com o mesmo desembolso mensal, quem paga a parcela menor investe a diferença em IPCA + x% a.a., usa para amortizar todo mês ou investe e amortiza a cada N meses (com tabela mês a mês de cada comprador e comparação com só investir). Uma tabela e um gráfico mostram as 6 combinações (SAC/PRICE × investir / investir e amortizar a cada N meses / amortizar todo mês) lado a lado, destacando a melhor, e a taxa (IPCA + x%) a partir da qual investir a diferença passa a valer mais que amortizar, para cada sistema, com gráfico da vantagem por taxa. (IR regressivo opcional, valores nominais ou em R$ de hoje). Mostra quem termina à frente, a virada das parcelas e a taxa real de empate.
- **Quando o investimento passa a pagar o financiamento**: para cada estratégia, o mês em que o rendimento mensal da carteira supera os juros do mês, o mês em que paga a parcela inteira, quando a carteira já quitaria o saldo devedor e quanto do total de juros o rendimento acumulado cobre, com gráfico de rendimento × juros mês a mês.
- **Títulos do Tesouro Direto**: importe o CSV de títulos do Tesouro Direto (botão ou arrastar e soltar; o arquivo é lido só no navegador) ou use a lista de exemplo de 17/11/2026. Cada título é convertido para IPCA + x% (prefixados pelo IPCA esperado, Selic pela Selic média esperada, descontando a custódia da B3), rende a própria taxa até o vencimento e uma taxa de reinvestimento depois, e é simulado em todas as opções para a diferença das parcelas. A tabela mostra o melhor título e a melhor opção com cada um, e “Usar” aplica a taxa média do título ao resto da página.
- **Investir ou amortizar?**: com um orçamento mensal fixo, compara SAC + investir a sobra, PRICE + investir a sobra, PRICE + investir e amortizar a cada N meses e amortizar a sobra todo mês. Mostra quando cada uma quita, os juros pagos, o patrimônio final e a taxa (IPCA + z%) a partir da qual investir passa a valer mais que amortizar. Inclui uma tabela mês a mês (da melhor estratégia ou de qualquer outra) dizendo o que fazer com a sobra: investir, amortizar ou resgatar e amortizar, com valores, IR do resgate, saldo e carteira, exportável em CSV.
- **Quitar antes do prazo**: informa quanto pagar a mais por mês (além da parcela original) para quitar em X meses, abatendo todo mês, investindo e abatendo a cada N meses ou investindo e quitando de uma vez no fim — para SAC e PRICE, com juros economizados, IR, total desembolsado, gráfico do saldo e tabela mês a mês.
- Tabela de amortização com exportação CSV. Os parâmetros ficam no endereço da página (link compartilhável).

## Uso

Abra `index.html` no navegador (funciona direto via `file://`), ou sirva a pasta:

```sh
python3 -m http.server 8000
```

## Testes

O motor de cálculo (`js/finance.js`) e o leitor do CSV do Tesouro (`js/tesouro.js`) não dependem do navegador:

```sh
node --test tests/*.test.js
```
