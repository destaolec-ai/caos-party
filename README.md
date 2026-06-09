# Caos Party V14 Correção Real

Esta versão corrige o erro que travava a V13.

## Corrigido

- Erro de JavaScript no `public/index.html`.
- Tela presa em "Conectando ao servidor".
- Botão "Criar sala" sem resposta.
- Bloco de envio/recebimento de estado do jogo refeito.
- Servidor com rota `/health`.

## Mantido

- Base estável da V10.
- Personagens com visual melhor.
- Powerups com ícones próprios.
- Menor frequência de powerups.
- Modo desempenho.
- Conexão com Socket.io.

## Estrutura correta

```txt
server.js
package.json
README.md
public/
  index.html
```

## Teste do servidor

Depois do deploy, abre:

```txt
https://caos-party.onrender.com/health
```

Tem que aparecer:

```json
{"ok":true,"version":"v14"}
```

## Teste do jogo

```txt
https://caos-party.onrender.com?v=14
```
