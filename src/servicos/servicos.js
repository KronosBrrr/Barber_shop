// MÓDULO SERVIÇOS — desenha os serviços ativos cadastrados pelo dono
function desenharServicos() {
  const el = $("listaServicos");
  if (!el) return;
  el.innerHTML = SERVICOS.map((s) => `
    <div class="servico-home">
      <span class="icone">${esc(s.icone)}</span>
      <div><strong>${esc(s.nome)}</strong><span class="sub">⏱ ${s.duracao} min</span></div>
      <span class="preco">${real(s.preco)}</span>
    </div>`).join("") || `<p class="sub">Em breve.</p>`;
}
quandoConfig(desenharServicos);
