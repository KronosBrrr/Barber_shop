// MÓDULO EQUIPE — desenha os barbeiros ativos (a foto é cadastrada pelo dono)
function desenharEquipe() {
  const el = $("listaEquipe");
  if (!el) return;
  el.innerHTML = BARBEIROS.map((b) => `
    <div class="membro">
      ${fotoOuInicial(b, "enorme")}
      <h3>${esc(b.nome)}</h3>
      <p class="sub">${esc(b.especialidade || "Barbeiro")}</p>
    </div>`).join("") || `<p class="sub">Em breve.</p>`;
}
quandoConfig(desenharEquipe);
