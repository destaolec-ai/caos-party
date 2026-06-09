# Caos Party V13 Conexão Fix

Base: V10 Resgate.

Correções:
- Corrige o problema de "Conectando ao servidor..." infinito com mensagens de erro melhores.
- Mantém o carregamento do Socket.io pelo servidor.
- Adiciona rota `/health` para testar se o servidor está vivo.
- Usa conexão polling primeiro e depois websocket, mais compatível com Render/celular.
- Input do jogador enviado de forma mais confiável.
- Estado do jogo menor para melhorar host/cliente.
- Personagens com visual melhor, sem bolinha.
- Powerups com ícones próprios e menor frequência.

Estrutura correta:

```txt
server.js
package.json
README.md
public/
  index.html
```

Teste:
```txt
https://caos-party.onrender.com/health
```

Se aparecer:
```json
{"ok":true,"version":"v13"}
```

o servidor está rodando.

Jogo:
```txt
https://caos-party.onrender.com?v=13
```
