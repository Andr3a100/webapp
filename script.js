const form = document.getElementById("person-form");
const tableBody = document.getElementById("staff-table");
const totalCount = document.getElementById("total-count");

const STORAGE_KEY = "cooperativa_staff";

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

renderTable(loadStaff());
