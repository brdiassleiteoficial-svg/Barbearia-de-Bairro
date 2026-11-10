import { supabase, supabaseConfigured } from "./supabase.js";
import { login, register, getCurrentUser, logout } from "./auth.js";
import { getServices, getBarbers, getAvailableSlots, createAppointment } from "./booking.js";

const $ = (id) => document.getElementById(id);
$("year").textContent = new Date().getFullYear();

$("menuButton").addEventListener("click", () => {
  const open = $("mainNav").classList.toggle("open");
  $("menuButton").setAttribute("aria-expanded", String(open));
});
document.querySelectorAll("#mainNav a").forEach(link =>
  link.addEventListener("click", () => $("mainNav").classList.remove("open"))
);
$("bookingDate").min = new Date().toLocaleDateString("en-CA");

const money = value => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function showMessage(message, error = false) {
  $("bookingMessage").textContent = message;
  $("bookingMessage").style.color = error ? "#ff8d8d" : "#d1b477";
}

async function loadServices() {
  if (!supabase) { $("servicesList").textContent = "Configure o Supabase para carregar os serviços."; return; }
  const services = await getServices();
  $("servicesList").replaceChildren();
  services.forEach(service => {
    const option = document.createElement("option");
    option.value = service.id; option.textContent = `${service.name} — ${money(service.price)}`;
    $("service").append(option);
    const card = document.createElement("article"); card.className = "service-card";
    const title = document.createElement("h3"); title.textContent = service.name;
    const desc = document.createElement("p"); desc.textContent = service.description || "";
    const price = document.createElement("div"); price.className = "price"; price.textContent = money(service.price);
    const duration = document.createElement("small"); duration.textContent = `${service.duration_minutes} minutos`;
    card.append(title, desc, price, duration); $("servicesList").append(card);
  });
}
async function loadBarbers() {
  if (!supabase) { $("barbersList").textContent = "Configure o banco para carregar a equipe."; return; }
  const barbers = await getBarbers(); $("barbersList").replaceChildren();
  barbers.forEach(barber => {
    const option = document.createElement("option"); option.value = barber.id; option.textContent = barber.display_name;
    $("barber").append(option);
    const card = document.createElement("article"); card.className = "barber-card";
    const name = document.createElement("h3"); name.textContent = barber.display_name;
    const specialty = document.createElement("p"); specialty.textContent = barber.specialty || "Barbeiro";
    card.append(name, specialty); $("barbersList").append(card);
  });
}
async function updateSlots() {
  const serviceId = $("service").value, barberId = $("barber").value, date = $("bookingDate").value, select = $("bookingTime");
  select.innerHTML = '<option value="">Carregando...</option>'; select.disabled = true;
  if (!serviceId || !date || !supabase) { select.innerHTML = '<option value="">Selecione serviço e data</option>'; return; }
  try {
    const slots = await getAvailableSlots(serviceId, barberId, date);
    select.innerHTML = '<option value="">Escolha um horário</option>';
    slots.forEach(slot => {
      const option = document.createElement("option");
      option.value = slot.time; option.textContent = `${slot.time} — ${slot.barber_name}`;
      option.dataset.barberId = slot.barber_id; select.append(option);
    });
    if (!slots.length) select.innerHTML = '<option value="">Nenhum horário disponível</option>';
    else select.disabled = false;
  } catch (error) { select.innerHTML = '<option value="">Erro ao consultar horários</option>'; showMessage(error.message, true); }
}
["service","barber","bookingDate"].forEach(id => $(id).addEventListener("change", updateSlots));

$("bookingForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) { showMessage("Configure o banco de dados primeiro.", true); return; }
  const selected = $("bookingTime").selectedOptions[0];
  if (!selected?.value) { showMessage("Escolha um horário disponível.", true); return; }
  const button = event.submitter; button.disabled = true; button.textContent = "PROCESSANDO...";
  try {
    const result = await createAppointment({
      serviceId: $("service").value, barberId: selected.dataset.barberId,
      date: $("bookingDate").value, time: selected.value,
      name: $("clientName").value.trim(), phone: $("clientPhone").value.trim(),
      email: $("clientEmail").value.trim()
    });
    showMessage(result.message || "Agendamento recebido. Verifique os dados de pagamento.");
    if (result.payment?.qrCodeText) {
      const pix = document.createElement("textarea");
      pix.readOnly = true; pix.value = result.payment.qrCodeText;
      pix.setAttribute("aria-label", "Código Pix copia e cola");
      $("bookingMessage").after(pix);
    }
    $("bookingForm").reset(); $("bookingTime").disabled = true;
  } catch (error) { showMessage(error.message || "Erro no agendamento.", true); }
  finally { button.disabled = false; button.textContent = "CONFIRMAR AGENDAMENTO"; }
});

$("loginButton").addEventListener("click", async () => {
  if (!supabase) { alert("Configure o Supabase antes de entrar."); return; }
  const current = await getCurrentUser().catch(() => null);
  if (current) {
    if (confirm(`Você está conectado como ${current.email}. Deseja sair?`)) {
      await logout(); alert("Você saiu da sua conta."); $("loginButton").textContent = "Entrar";
    }
    return;
  }
  const action = prompt("Digite 1 para entrar ou 2 para criar uma conta.");
  const email = prompt("E-mail:");
  if (!email) return;
  const password = prompt("Senha (mínimo 6 caracteres):");
  if (!password) return;
  try {
    if (action === "2") {
      const name = prompt("Nome completo:"); const phone = prompt("Celular:");
      await register(email, password, name || "", phone || "");
      alert("Cadastro enviado. Se a confirmação de e-mail estiver ativa, confirme seu endereço antes de entrar.");
    } else { await login(email, password); alert("Login realizado com sucesso."); }
    $("loginButton").textContent = "Minha conta";
  } catch (error) { alert("Não foi possível concluir: " + error.message); }
});
$("profileButton").addEventListener("click", async () => {
  try { const user = await getCurrentUser(); alert("Usuário conectado: " + user.email); }
  catch { alert("Entre na sua conta para acessar o perfil."); }
});

async function initialize() {
  if (!supabaseConfigured) {
    $("servicesList").textContent = "Configure as chaves do Supabase no arquivo .env para carregar os serviços.";
    $("barbersList").textContent = "Configure as chaves do Supabase no arquivo .env para carregar os profissionais.";
    showMessage("Aplicativo em modo de configuração. O agendamento ainda não está ativo.");
    return;
  }
  try { await Promise.all([loadServices(), loadBarbers()]); }
  catch (error) { console.error(error); showMessage("Não foi possível carregar os dados.", true); }
}
initialize();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(console.error));
}
