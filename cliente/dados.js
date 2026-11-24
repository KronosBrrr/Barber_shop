// ===== Configuração da barbearia =====
// Agora tudo vem do banco de dados, pelo servidor (servidor/servidor.py).
// Os valores iniciais (serviços, barbeiros, produtos...) ficam no servidor.

const CONFIG = {
  servicos: [],
  barbeiros: [],
  produtos: [],
  funcionamento: { intervalo: 30, diasParaAgendar: 14, semana: [], datasFechadas: [] },
};

// O app do cliente só enxerga o que está ativo
let SERVICOS = [];
let BARBEIROS = [];
let PRODUTOS = [];
let FUNCIONAMENTO = CONFIG.funcionamento;

function aplicarConfig(c) {
  CONFIG.servicos = c.servicos;
  CONFIG.barbeiros = c.barbeiros;
  CONFIG.produtos = c.produtos;
  CONFIG.funcionamento = c.funcionamento;
  CONFIG.pagamentos = c.pagamentos || {};
  FUNCIONAMENTO = c.funcionamento;
  SERVICOS = c.servicos.filter((s) => s.ativo !== false);
  BARBEIROS = c.barbeiros.filter((b) => b.ativo !== false);
  PRODUTOS = c.produtos.filter((p) => p.ativo !== false);
}
