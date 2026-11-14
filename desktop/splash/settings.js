// Settings window. Talks to the desktop shell through Tauri commands. Everything from the shell is
// written with textContent, never innerHTML, so a setting name or value cannot inject markup.
(function () {
  const invoke = window.__TAURI__.core.invoke;

  const form = document.getElementById("form");
  const nameInput = document.getElementById("name");
  const valueInput = document.getElementById("value");
  const secretInput = document.getElementById("secret");
  const secretHint = document.getElementById("secretHint");
  const rows = document.getElementById("rows");
  const empty = document.getElementById("empty");
  const errorBox = document.getElementById("error");
  const savedNotice = document.getElementById("saved");

  let editingSecret = false;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
    savedNotice.style.display = "none";
  }

  function showNotice(message) {
    errorBox.hidden = true;
    savedNotice.textContent = message;
    savedNotice.style.display = "block";
  }

  function resetForm() {
    nameInput.value = "";
    valueInput.value = "";
    secretInput.checked = false;
    editingSecret = false;
    nameInput.readOnly = false;
    updateSecretHint();
  }

  function updateSecretHint() {
    secretHint.textContent = secretInput.checked
      ? "Secret: stored in the keychain. Leave the value empty to keep the stored one."
      : "";
    valueInput.type = secretInput.checked ? "password" : "text";
  }

  function edit(row) {
    nameInput.value = row.name;
    nameInput.readOnly = true;
    secretInput.checked = row.secret;
    valueInput.value = row.secret ? "" : row.value || "";
    valueInput.placeholder = row.secret ? "leave empty to keep the stored value" : "";
    editingSecret = row.secret;
    updateSecretHint();
    valueInput.focus();
  }

  function cell(text, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function tag(text, missing) {
    const span = document.createElement("span");
    span.className = missing ? "tag missing" : "tag";
    span.textContent = text;
    return span;
  }

  function render(settings) {
    rows.replaceChildren();
    empty.hidden = settings.length > 0;
    for (const row of settings) {
      const tr = document.createElement("tr");
      tr.appendChild(cell(row.name));

      if (row.secret) {
        tr.appendChild(cell(row.stored ? "•••••••• (keychain)" : "not set", "value"));
      } else {
        tr.appendChild(cell(row.value, "value"));
      }

      const typeTd = document.createElement("td");
      typeTd.appendChild(row.secret
        ? tag(row.stored ? "secret" : "secret, not set", !row.stored)
        : tag("setting"));
      tr.appendChild(typeTd);

      const actions = document.createElement("td");
      const wrap = document.createElement("div");
      wrap.className = "actions";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => edit(row));
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => remove(row.name));
      wrap.append(editButton, removeButton);
      actions.appendChild(wrap);
      tr.appendChild(actions);

      rows.appendChild(tr);
    }
  }

  async function refresh() {
    try {
      render(await invoke("list_settings"));
    } catch (err) {
      showError(String(err));
    }
  }

  async function remove(name) {
    try {
      await invoke("remove_setting", { name });
      showNotice("Removed. Applying to the server…");
      await refresh();
    } catch (err) {
      showError(String(err));
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const secret = secretInput.checked;
    const value = valueInput.value;
    try {
      await invoke("save_setting", {
        name: nameInput.value.trim(),
        value: secret && value === "" ? null : value,
        secret,
      });
      showNotice("Saved. Applying to the server…");
      resetForm();
      await refresh();
    } catch (err) {
      showError(String(err));
    }
  });

  document.getElementById("clear").addEventListener("click", resetForm);
  secretInput.addEventListener("change", () => {
    if (!editingSecret) valueInput.value = "";
    updateSecretHint();
  });
  // The shell reports each apply: success after the server restarts, or the error to fix.
  window.__TAURI__.event.listen("server-status", ({ payload }) => {
    if (payload.ok) {
      showNotice(payload.message || "Applied.");
    } else {
      showError("The server could not start with these settings:\n" + payload.message);
    }
  });

  invoke("startup_error").then((message) => {
    if (message) showError("The server could not start:\n" + message);
  });
  refresh();
})();
