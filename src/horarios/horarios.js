// MÓDULO HORÁRIOS — a semana começando na segunda, com o dia de hoje em destaque
function desenharHorarios() {
  const el = $("listaHorarios");
  if (!el) return;
  const semana = FUNCIONAMENTO.semana || [];
  const hoje = new Date().getDay();
  el.innerHTML = [1, 2, 3, 4, 5, 6, 0].filter((i) => semana[i]).map((i) => `
    <div class="dia-home ${semana[i].aberto ? "" : "fechado"} ${i === hoje ? "hoje" : ""}">
      <span>${DIAS_SEMANA[i]}</span><strong>${semana[i].aberto ? `${semana[i].abre} – ${semana[i].fecha}` : "Fechado"}</strong>
    </div>`).join("");
}
quandoConfig(desenharHorarios);
