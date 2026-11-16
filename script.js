// Add real company contact details before publishing; the server handles submissions.
const SITE_CONFIG = {
  phone: "",
  email: "",
  formEndpoint: "/api/leads"
};

const menuToggle = document.querySelector(".menu-toggle");
const primaryNav = document.querySelector("#primary-nav");
const form = document.querySelector("#lead-form");
const formStatus = document.querySelector("#form-status");

document.querySelector("#current-year").textContent = String(new Date().getFullYear());

if (SITE_CONFIG.phone) {
  document.querySelectorAll('[data-contact="phone"]').forEach((link) => {
    link.href = `tel:${SITE_CONFIG.phone.replace(/[^\d+]/g, "")}`;
    link.textContent = SITE_CONFIG.phone;
  });
} else {
  document.querySelector('[data-contact="phone"]').closest("div").hidden = true;
}

if (SITE_CONFIG.email) {
  document.querySelectorAll('[data-contact="email"]').forEach((link) => {
    link.href = `mailto:${SITE_CONFIG.email}`;
    link.textContent = SITE_CONFIG.email;
  });
} else {
  document.querySelector('[data-contact="email"]').closest("div").hidden = true;
}

menuToggle.addEventListener("click", () => {
  const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isExpanded));
  menuToggle.setAttribute("aria-label", isExpanded ? "Открыть меню" : "Закрыть меню");
  primaryNav.classList.toggle("is-open", !isExpanded);
});

primaryNav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Открыть меню");
    primaryNav.classList.remove("is-open");
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formStatus.textContent = "";
  formStatus.removeAttribute("data-state");

  if (!form.reportValidity()) return;

  if (!SITE_CONFIG.formEndpoint && SITE_CONFIG.email) {
    const data = Object.fromEntries(new FormData(form));
    const body = [
      `Имя: ${data.name}`,
      `Телефон: ${data.phone}`,
      `Сообщение: ${data.message || "—"}`
    ].join("\n");
    window.location.href = `mailto:${SITE_CONFIG.email}?subject=${encodeURIComponent("Заявка на проект дома")}&body=${encodeURIComponent(body)}`;
    formStatus.textContent = "Черновик заявки открыт в почтовой программе. Отправьте письмо, чтобы заявка дошла.";
    return;
  }

  if (!SITE_CONFIG.formEndpoint) {
    formStatus.dataset.state = "error";
    formStatus.textContent = "Заявка пока не отправлена: подключите форму в настройках script.js. Инструкция — в README.";
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  formStatus.textContent = "Отправляем заявку…";

  try {
    const response = await fetch(SITE_CONFIG.formEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Сервис заявок ответил с кодом ${response.status}.`);
    if (result.ok !== true) throw new Error("Сервис не подтвердил отправку заявки.");

    form.reset();
    formStatus.textContent = "Спасибо! Заявка отправлена. Мы свяжемся с вами.";
  } catch (error) {
    console.error("Не удалось отправить заявку:", error);
    formStatus.dataset.state = "error";
    formStatus.textContent = error instanceof TypeError
      ? "Сервис заявок недоступен. Попробуйте позже или свяжитесь с нами по телефону."
      : error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
  }
});
