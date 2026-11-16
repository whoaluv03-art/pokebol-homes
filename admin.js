const list = document.querySelector("#lead-list");
const status = document.querySelector("#admin-status");

function makeLeadCard(lead) {
  const card = document.createElement("article");
  card.className = "lead-card";

  const header = document.createElement("div");
  header.className = "lead-card-header";

  const name = document.createElement("h2");
  name.textContent = lead.name;
  const date = document.createElement("time");
  date.dateTime = lead.createdAt;
  date.textContent = new Date(lead.createdAt).toLocaleString("ru-RU");
  header.append(name, date);

  const phone = document.createElement("a");
  phone.className = "lead-phone";
  phone.href = `tel:${lead.phone.replace(/[^\d+]/g, "")}`;
  phone.textContent = lead.phone;

  const message = document.createElement("p");
  message.className = "lead-message";
  message.textContent = lead.message || "Сообщение не добавлено.";

  card.append(header, phone, message);
  return card;
}

async function loadLeads() {
  const refresh = document.querySelector("#refresh-leads");
  refresh.disabled = true;
  status.textContent = "Загружаем заявки…";
  list.replaceChildren();

  try {
    const response = await fetch("/api/admin/leads", {
      headers: { Accept: "application/json" }
    });

    if (response.status === 401) {
      window.location.assign("/admin/login");
      return;
    }
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || `Сервер ответил с кодом ${response.status}.`);
    }

    const entries = await response.json();
    if (entries.length === 0) {
      status.textContent = "Заявок пока нет.";
      return;
    }

    status.textContent = `Показаны последние ${entries.length} заявок.`;
    list.replaceChildren(...entries.map(makeLeadCard));
  } catch (error) {
    console.error("Не удалось загрузить заявки:", error);
    status.textContent = "Не удалось загрузить заявки. Попробуйте обновить страницу.";
  } finally {
    refresh.disabled = false;
  }
}

document.querySelector("#refresh-leads").addEventListener("click", loadLeads);
loadLeads();
