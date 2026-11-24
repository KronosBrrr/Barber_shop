# Barber_shop ✂

Sistema para barbearia: o cliente marca horário e compra produtos pelo app, e o dono controla agenda, barbeiros, pagamentos e lucro.

## Como rodar

Precisa só do **Python 3** (não precisa instalar mais nada).

- No Windows: dê dois cliques em `iniciar.bat`
- Ou no terminal, dentro desta pasta: `python servidor/servidor.py`

Depois acesse:

- **Site da barbearia (página inicial + área do cliente):** http://localhost:8000
- **Painel do dono:** http://localhost:8000/dono
- **Painel do barbeiro:** http://localhost:8000/barbeiro

Na primeira vez o banco de dados (`servidor/barbearia.db`) é criado sozinho, já com dados de exemplo.

### Contas de teste

| Quem | Login | Senha |
|---|---|---|
| Dono | usuário `admin` | `admin123` |
| Cliente | WhatsApp `(11) 99999-9999` | `1234` |
| Barbeiro (João) | WhatsApp `(11) 91111-2222` | `1234` |

A conta de cada barbeiro é criada pelo dono, no cadastro do barbeiro: o login é o WhatsApp dele e o dono escolhe a senha.

### Opções do servidor

- `python servidor/servidor.py --resetar`: apaga o banco e cria de novo com os dados de teste
- `python servidor/servidor.py --rede`: deixa celulares no mesmo Wi-Fi acessarem

## Senhas e configurações

- **Configurações** em todas as áreas (cliente: botão ⚙️ no topo; barbeiro e dono: aba no menu):
  dados da conta (nome, e-mail, WhatsApp) e **trocar senha**. Ao trocar, os outros aparelhos saem da conta.
- **Esqueci minha senha** nas três telas de login: a pessoa escolhe receber um **código de 6 números por e-mail ou WhatsApp**.
  O código vale 15 minutos, aceita no máximo 5 tentativas e cada conta pode pedir até 3 códigos por hora.
- O dono configura o envio em **Painel do dono → Configurações**:
  - **E-mail:** servidor SMTP (no Gmail: `smtp.gmail.com`, porta 465, e uma *senha de app*).
  - **WhatsApp:** API oficial do WhatsApp (Meta). Precisa do token, do ID do número e de um modelo de **Autenticação** aprovado.
  - Botão **Enviar teste** para conferir. Se algum envio falhar, o erro aparece nessa tela.
- Sem envio configurado o site funciona em **modo de teste**: o código aparece na janela do servidor.
- O dono esqueceu a senha e não tem e-mail/WhatsApp cadastrado? No terminal:
  `python servidor/servidor.py --senha-dono NOVA_SENHA`

As listas longas (pedidos do cliente, agenda, clientes, despesas, pagamentos, ganhos do barbeiro)
mostram só os primeiros itens; o resto fica no botão **Ver mais**.

## Pagamentos

### Mercado Pago (cobrança e reembolso de verdade)

No painel do dono, em **Funcionamento → Mercado Pago**, cole a *Public Key* e o *Access Token*
(pegue em mercadopago.com.br/developers → Suas integrações → Credenciais). Com ele ligado:

- o **cartão** cobra de verdade (os dados do cartão vão direto para o Mercado Pago, e o nosso servidor nunca vê o número);
- o **Pix** é gerado pelo Mercado Pago e **confirmado sozinho** quando o cliente paga;
- ao cancelar um pedido pago, o **reembolso** é feito automaticamente pelo Mercado Pago (cartão ou Pix). Se falhar, o pedido aparece como *reembolso pendente* e o dono pode tentar de novo.

Use primeiro as credenciais de **teste** (começam com `TEST-`). Sem Mercado Pago, o sistema funciona assim:

- **Pix:** gera o QR code e o código "copia e cola" no padrão do Banco Central, com a chave Pix da barbearia (cadastrada pelo dono em *Funcionamento → Pagamentos*). O dinheiro cai direto na conta da chave. O dono confirma o recebimento no painel (botão **⚡ Pix recebido**).
- **Cartão de crédito (parcelas definidas pelo dono, padrão 3x) e débito:** formulário com validação do número, validade e CVV, e identificação da bandeira. **Está em modo de teste, ou seja, não cobra de verdade.** Para cobrar de verdade é preciso contratar um intermediador (Mercado Pago, PagSeguro, Stone…) e ligar em `servidor/pagamentos.py`.
- Os dados do cartão **nunca são guardados**: só a bandeira e os 4 últimos números.
- Cancelou um pedido pago no cartão? O valor é estornado automaticamente.

Cartões de teste: `4111 1111 1111 1111` (aprovado) e `4000 0000 0000 0002` (recusado), com qualquer validade futura e CVV `123`.

> ⚠ A chave Pix que vem no banco de teste é só um exemplo. Troque pela chave real antes de usar.

## O que o sistema faz

**Visual:** tema preto e dourado, com botão ☀️/🌙 para alternar entre modo escuro e claro (a escolha fica salva no aparelho). No painel do dono, o menu fica do lado direito.

**Página inicial:** apresenta a barbearia (diferenciais, como o site funciona, serviços e preços, equipe com fotos, horários) e tem os botões para o cliente agendar e para o barbeiro e o dono entrarem.

**Painel do barbeiro**
- Quanto tem a receber, ganhos do mês e o previsto para hoje
- Próximo cliente, agenda do dia e produtos para entregar
- Meus ganhos: cada atendimento com a comissão e se já foi pago ou não, e os pagamentos recebidos
- Perfil e troca de senha

**App do cliente**
- Login e cadastro com WhatsApp e senha
- Pagamento por Pix (QR code), cartão de crédito, débito ou na barbearia
- Tela inicial com o próximo horário e os pedidos anteriores
- Agendamento em 5 passos: serviço → barbeiro → dia e horário → produtos (entregues no dia do atendimento) → confirmação
- Cancelar um horário e "agendar de novo"

**Painel do dono**
- **Painel:** resumo do dia, lucro do mês, alertas e produtos para separar
- **Agenda:** marcar atendido, falta, cancelar, trocar barbeiro e agendar no balcão
- **Barbeiros:** cadastro com foto, WhatsApp/senha de acesso e chave Pix; comissão e folgas; pagar escolhendo os atendimentos (cada atendimento fica marcado como pago), inclusive **por Pix pelo próprio site** (QR code com a chave do barbeiro); remover só depois de pagar tudo
- **Financeiro:** receita, comissões, custo dos produtos, despesas e lucro por mês
- **Funcionamento:** dias e horários da semana, feriados, Pix e parcelas do cartão
- **Configurações:** dados e senha do dono, envio dos códigos de recuperação e backup
- **Página inicial:** nome da barbearia e todos os textos e listas da página inicial
- **Serviços e produtos:** preços, custo, margem e estoque
- **Clientes:** histórico e quem está sumido há mais de 30 dias

## Estrutura (módulos)

Cada parte do site tem a sua pasta com o HTML, o CSS e o JavaScript dela:

```
src/
  compartilhado/        usado por todas as páginas
    base.css            cores (tema preto e dourado / claro), botões, formulários
    painel.css          layout dos painéis do dono e do barbeiro (menu à direita)
    comum.js            funções comuns (falar com o servidor, datas, dinheiro, tema)
    config.js           carrega a configuração da barbearia do banco
  componentes/
    header/             header.html  header.css  header.js   (cabeçalho)
    footer/             footer.html  footer.css              (rodapé)
  inicio/               inicio.html  inicio.css  inicio.js   (página inicial)
  servicos/             servicos.html servicos.css servicos.js
  equipe/               equipe.html  equipe.css  equipe.js
  horarios/             horarios.html horarios.css horarios.js
  cliente/              cliente.html cliente.css cliente.js  (login e pedidos do cliente)
  agendamento/          agendamento.html .css .js            (passo a passo)
  pagamento/            pagamento.html .css .js              (Pix e cartão)
  configuracoes/        configuracoes.html .css .js          (meus dados e trocar senha, nas 3 áreas)
  recuperar-senha/      recuperar-senha.html .css .js        (janela "esqueci minha senha")
  dono/                 dono.html dono.css dono.js           (núcleo do painel do dono)
    abas/               painel.js agenda.js barbeiros.js financeiro.js
                        funcionamento.js catalogo.js clientes.js site.js configuracoes.js
  barbeiro/             barbeiro.html barbeiro.css barbeiro.js
servidor/
  servidor.py           API + servidor + montagem das páginas (Python, sem bibliotecas extras)
  pagamentos.py         Pix (BR Code), cartão em modo de teste e Mercado Pago
  mensagens.py          envio do código de recuperação por e-mail (SMTP) e WhatsApp
  schema.sql            tabelas do banco de dados (SQLite)
iniciar.bat             liga o servidor no Windows
```

| Endereço | Arquivo |
|---|---|
| `/` | `src/inicio/inicio.html` |
| `/cliente` | `src/cliente/cliente.html` |
| `/dono` | `src/dono/dono.html` |
| `/barbeiro` | `src/barbeiro/barbeiro.html` |

### Header, footer e seções: colocar ou tirar de uma página

O servidor monta cada página antes de mandar para o navegador. Uma linha `<incluir>` é trocada pelo arquivo:

```html
<!-- cabeçalho, com os links do menu entre as tags -->
<incluir src="componentes/header/header.html" subtitulo="Painel do dono">
  <a class="nav-link" href="/">Ver o site</a>
</incluir>

<!-- rodapé -->
<incluir src="componentes/footer/footer.html"></incluir>

<!-- uma seção (serviços, equipe, horários) -->
<incluir src="equipe/equipe.html"></incluir>
```

- **Para tirar** o header, o footer ou uma seção de uma página, apague a linha `<incluir>`.
- **Para colocar** em outra página, copie a linha. As seções só precisam que a página carregue
  `/compartilhado/comum.js` e `/compartilhado/config.js` no `<head>` (todas as páginas já carregam).
- Sem o header, o botão ☀️/🌙 aparece sozinho no canto da tela.
- No HTML, `{{site.nome}}` (e os outros `{{site.…}}`) viram os textos guardados no banco, e `{{ano}}` vira o ano atual.
- Por isso as páginas precisam ser abertas pelo servidor (http://localhost:8000), e não com dois cliques no arquivo.

## Dados no banco

Tudo o que aparece nas telas vem do banco (`servidor/barbearia.db`): serviços, barbeiros e fotos, produtos e estoque,
horários, agendamentos, pagamentos, despesas e também **o nome da barbearia e os textos da página inicial**
(tabela `site_itens` e chaves `site_*` em `configuracoes`), o **número de parcelas** e as **categorias de despesa**.
O dono edita os textos em **Painel do dono → Página inicial**. Escrever `{nome}` num texto coloca o nome da barbearia.
