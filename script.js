const form = document.getElementById("person-form");
const tableBody = document.getElementById("staff-table");
const totalCount = document.getElementById("total-count");
const exportButton = document.getElementById("export-button");

const STORAGE_KEY = "cooperativa_staff";

const telegramApp = window.Telegram?.WebApp;

const applyTelegramTheme = () => {
  if (!telegramApp) {
    return;
  }

  const theme = telegramApp.themeParams || {};
  document.documentElement.style.setProperty("--bg", theme.bg_color || "#f4f1ec");
  document.documentElement.style.setProperty("--card", theme.secondary_bg_color || "#ffffff");
  document.documentElement.style.setProperty("--text", theme.text_color || "#1d1f20");
  document.documentElement.style.setProperty("--muted", theme.hint_color || "#5c6668");
  document.documentElement.style.setProperty("--accent", theme.button_color || "#1f6f78");
  document.documentElement.style.setProperty("--accent-dark", theme.button_color || "#185a61");
};

const loadStaff = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    return [];
  }
};

const saveStaff = (staff) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(staff));
};

const buildCsv = (staff) => {
  const headers = ["Nome", "Ruolo", "Ore settimanali"];
  const rows = staff.map((person) => [
    person.name,
    person.role,
    person.hours,
  ]);
  const escape = (value) => {
    const text = String(value ?? "");
    if (text.includes("\"") || text.includes(",") || text.includes("\n")) {
      return `"${text.replace(/\"/g, "\"\"")}"`;
    }
    return text;
  };
  const lines = [headers.map(escape).join(",")];
  rows.forEach((row) => {
    lines.push(row.map(escape).join(","));
  });
  return lines.join("\n");
};

const renderTable = (staff) => {
  tableBody.innerHTML = "";

  if (!staff.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    row.innerHTML = "<td colspan=\"4\">Nessun personale inserito.</td>";
    tableBody.appendChild(row);
  } else {
    staff.forEach((person, index) => {
      const row = document.createElement("tr");

      const nameCell = document.createElement("td");
      nameCell.textContent = person.name;
      nameCell.setAttribute("data-label", "Nome");

      const roleCell = document.createElement("td");
      roleCell.textContent = person.role;
      roleCell.setAttribute("data-label", "Ruolo");

      const hoursCell = document.createElement("td");
      hoursCell.textContent = person.hours;
      hoursCell.setAttribute("data-label", "Ore settimanali");

      const actionCell = document.createElement("td");
      actionCell.setAttribute("data-label", "Azioni");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-button";
      deleteButton.textContent = "Elimina";
      deleteButton.addEventListener("click", () => removePerson(index));
      actionCell.appendChild(deleteButton);

      row.appendChild(nameCell);
      row.appendChild(roleCell);
      row.appendChild(hoursCell);
      row.appendChild(actionCell);

      tableBody.appendChild(row);
    });
  }

  totalCount.textContent = `${staff.length} ${staff.length === 1 ? "persona" : "persone"}`;

  if (telegramApp) {
    telegramApp.MainButton.setText(`Invia riepilogo (${staff.length})`);
    if (staff.length) {
      telegramApp.MainButton.show();
    } else {
      telegramApp.MainButton.hide();
    }
  }
};

const addPerson = (person) => {
  const staff = loadStaff();
  staff.push(person);
  saveStaff(staff);
  renderTable(staff);
};

const removePerson = (index) => {
  const staff = loadStaff();
  staff.splice(index, 1);
  saveStaff(staff);
  renderTable(staff);
};

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = form.elements.name.value.trim();
  const role = form.elements.role.value;
  const hours = Number(form.elements.hours.value);

  if (!name || !role || !hours) {
    return;
  }

  addPerson({
    name,
    role,
    hours,
  });

  form.reset();
  form.elements.name.focus();
});

exportButton.addEventListener("click", () => {
  const staff = loadStaff();
  const csv = buildCsv(staff);
  if (telegramApp) {
    telegramApp.sendData(
      JSON.stringify({
        type: "export",
        filename: "personale-cooperativa.csv",
        csv,
      })
    );
    return;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "personale-cooperativa.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

if (telegramApp) {
  telegramApp.ready();
  telegramApp.expand();
  applyTelegramTheme();

  telegramApp.MainButton.setParams({
    color: telegramApp.themeParams?.button_color || "#1f6f78",
    text_color: telegramApp.themeParams?.button_text_color || "#ffffff",
  });

  telegramApp.MainButton.onClick(() => {
    const payload = {
      total: loadStaff().length,
      staff: loadStaff(),
    };
    telegramApp.sendData(JSON.stringify(payload));
  });
}

renderTable(loadStaff());
