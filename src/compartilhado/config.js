// =====================================================================
//  CONFIGURAÇÃO DA BARBEARIA
//  Tudo vem do banco de dados, pelo servidor (GET /api/config):
//  serviços, barbeiros, produtos, horários, pagamentos e os textos do site.
// =====================================================================

const CONFIG = {
  servicos: [],
  barbeiros: [],
  produtos: [],
  funcionamento: { intervalo: 30, diasParaAgendar: 14, semana: [], datasFechadas: [] },
  pagamentos: {},
  site: { textos: {}, itens: {} },
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
  CONFIG.site = c.site || { textos: {}, itens: {} };
  FUNCIONAMENTO = c.funcionamento;
  SERVICOS = c.servicos.filter((s) => s.ativo !== false);
  BARBEIROS = c.barbeiros.filter((b) => b.ativo !== false);
  PRODUTOS = c.produtos.filter((p) => p.ativo !== false);
}

// Busca a configuração no servidor e avisa as seções da página (serviços, equipe, horários...).
// Cada seção escuta o evento "barbearia:config" e se desenha sozinha, então dá para
// colocar ou tirar uma seção de qualquer página sem mexer no resto.
async function carregarConfigSite() {
  const c = await api("GET", "/api/config");
  aplicarConfig(c);
  _configCarregada = true;
  document.dispatchEvent(new CustomEvent("barbearia:config", { detail: c }));
  return c;
}

// Usado pelas seções: carrega uma vez só, mesmo que várias seções peçam
let _configCarregada = false;
let _configPedida = null;
function pedirConfigSite() {
  if (!_configPedida) _configPedida = carregarConfigSite().catch((e) => { _configPedida = null; avisar(e.message); });
  return _configPedida;
}

// Cada seção chama quandoConfig(desenhar): desenha agora se os dados já chegaram,
// e de novo sempre que a configuração for recarregada.
function quandoConfig(desenhar) {
  document.addEventListener("barbearia:config", desenhar);
  if (_configCarregada) desenhar();
  else pedirConfigSite();
}
