
## Correção aplicada e verificação

A aplicação agora seleciona o nível mais alto disponível para o realizado, agrupa N1 por Gestão + Módulo e usa o maior valor quando a SQL repete o total do módulo em mais de uma PPSA N1. Em N2/N3/N4, a deduplicação ocorre por PPSA + nível.

A mesma regra foi aplicada ao resumo Gestão/Módulo, Cronograma Semanal, tendência, Curva S e totalizadores de período. Planejamento N1 usa `HORAS_MODULO_PLANEJADAS` quando disponível; não se soma o mesmo planejamento de módulo repetido em cada linha N1.

Os dois projetos de referência foram republicados com o snapshot atual scoped da API:

- Lote `1170001`, 812 linhas, 2 projetos.
- #122: planejado `6.960,00 h`; realizado canônico `1.374,45 h`; módulo Gestão 30 / Implantação = `22,50 h` (duas linhas N1 de `22:30` não viram `45,00 h`).
- #200: planejado `18.160,00 h`; realizado canônico `4.053,06 h`.

A API scoped acessível no momento não retornou uma linha N1/module total de `10.935,2 h` para o #200; ela retornou 435 linhas e o nível N1/módulo totalizou `4.053,07 h`. O sistema não deve inventar `10.935,2 h`: quando o endpoint publicar esse valor em `HORAS_TOTAL` no nível N1 por módulo, a regra o preservará uma única vez.
