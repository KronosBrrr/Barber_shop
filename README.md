# Barber_shop ✂

Sistema para barbearia: o cliente marca horário e compra produtos pelo app, e o dono controla agenda, barbeiros, pagamentos e lucro.

## Como rodar

Precisa só do **Python 3** (não precisa instalar mais nada).

- No Windows: dê dois cliques em `iniciar.bat`
- Ou no terminal, dentro desta pasta: `python servidor/servidor.py`

Depois acesse:

- **App do cliente:** http://localhost:8000
- **Painel do dono:** http://localhost:8000/dono

Na primeira vez o banco de dados (`servidor/barbearia.db`) é criado sozinho, já com dados de exemplo.

### Contas de teste

| Quem | Login | Senha |
|---|---|---|
| Dono | usuário `admin` | `admin123` |
| Cliente | WhatsApp `(11) 99999-9999` | `1234` |

### Opções do servidor

- `python servidor/servidor.py --resetar`: apaga o banco e cria de novo com os dados de teste
- `python servidor/servidor.py --rede`: deixa celulares no mesmo Wi-Fi acessarem

## Pagamentos

- **Pix:** gera o QR code e o código "copia e cola" no padrão do Banco Central, com a chave Pix da barbearia (cadastrada pelo dono em *Funcionamento → Pagamentos*). O dinheiro cai direto na conta da chave. O dono confirma o recebimento no painel (botão **⚡ Pix recebido**).
- **Cartão de crédito (até 3x) e débito:** formulário com validação do número, validade e CVV, e identificação da bandeira. **Está em modo de teste, ou seja, não cobra de verdade.** Para cobrar de verdade é preciso contratar um intermediador (Mercado Pago, PagSeguro, Stone…) e ligar em `servidor/pagamentos.py`.
- Os dados do cartão **nunca são guardados**: só a bandeira e os 4 últimos números.
- Cancelou um pedido pago no cartão? O valor é estornado automaticamente.

Cartões de teste: `4111 1111 1111 1111` (aprovado) e `4000 0000 0000 0002` (recusado), com qualquer validade futura e CVV `123`.

> ⚠ A chave Pix que vem no banco de teste é só um exemplo. Troque pela chave real antes de usar.

## O que o sistema faz

**Visual:** tema preto e dourado, com botão ☀️/🌙 para alternar entre modo escuro e claro (a escolha fica salva no aparelho). No painel do dono, o menu fica do lado direito.

**App do cliente**
- Login e cadastro com WhatsApp e senha
- Pagamento por Pix (QR code), cartão de crédito, débito ou na barbearia
- Tela inicial com o próximo horário e os pedidos anteriores
- Agendamento em 5 passos: serviço → barbeiro → dia e horário → produtos (entregues no dia do atendimento) → confirmação
- Cancelar um horário e "agendar de novo"

**Painel do dono**
- **Painel:** resumo do dia, lucro do mês, alertas e produtos para separar
- **Agenda:** marcar atendido, falta, cancelar, trocar barbeiro e agendar no balcão
- **Barbeiros:** adicionar, editar comissão e folgas, pagar e remover (só depois de pagar tudo)
- **Financeiro:** receita, comissões, custo dos produtos, despesas e lucro por mês
- **Funcionamento:** dias e horários da semana, feriados, senha e backup
- **Serviços e produtos:** preços, custo, margem e estoque
- **Clientes:** histórico e quem está sumido há mais de 30 dias

## Estrutura

```
cliente/            sites (HTML, CSS, JavaScript)
  index.html        app do cliente
  dono.html         painel do dono
  comum.js          funções usadas pelos dois
servidor/
  servidor.py       API + servidor (Python, sem bibliotecas extras)
  pagamentos.py     Pix (BR Code) e cartão (modo de teste)
  schema.sql        tabelas do banco de dados (SQLite)
iniciar.bat         liga o servidor no Windows
```
