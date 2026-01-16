const { useMemo, useState } = React;

const API_BASE =
  window.location.protocol === "file:"
    ? "http://localhost:8000"
    : window.location.port && window.location.port !== "8000"
    ? "http://localhost:8000"
    : "";

const ROLE_OPTIONS = ["DIRETTORE", "OS", "MEDIATORE", "OG"];

const emptyPerson = () => ({
  id: crypto.randomUUID(),
  name: "",
  oreOrdinarie: "",
  oreStraordinarie: "",
  oreReperibilita: "",
  costoOrario: "",
  roles: [],
});

const App = () => {
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [textInput, setTextInput] = useState("");
  const [people, setPeople] = useState([emptyPerson()]);
  const [templateFile, setTemplateFile] = useState(null);
  const [templateStatus, setTemplateStatus] = useState("");
  const [parseStatus, setParseStatus] = useState("");
  const [computeStatus, setComputeStatus] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [pivot, setPivot] = useState([]);
  const [check, setCheck] = useState([]);
  const [consuntivo, setConsuntivo] = useState([]);
  const [consumeAll, setConsumeAll] = useState(true);
  const [medicoTotal, setMedicoTotal] = useState("");

  const [alessandro, setAlessandro] = useState({
    oreOs: "",
    oreRep: "",
    forfait: "",
  });

  const alessandroCosto = useMemo(() => {
    const oreOs = Number(alessandro.oreOs || 0);
    const oreRep = Number(alessandro.oreRep || 0);
    const forfait = Number(alessandro.forfait || 0);
    if (!oreOs) return "";
    const costo = (forfait - oreRep * 1.5) / oreOs;
    if (!Number.isFinite(costo)) return "";
    return costo.toFixed(2);
  }, [alessandro]);

  const missingBasics = useMemo(() => {
    const items = [];
    if (!year || !month) items.push("Seleziona mese e anno");
    return items;
  }, [year, month]);

  const handleParse = async () => {
    setParseStatus("");
    if (!textInput.trim()) {
      setParseStatus("Inserisci testo da analizzare.");
      return;
    }
    const response = await fetch(`${API_BASE}/parse-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: textInput }),
    });
    if (!response.ok) {
      const text = await response.text();
      setParseStatus(text || "Errore parsing");
      return;
    }
    const data = await response.json();
    const parsed = (data.people || []).map((person) => ({
      id: crypto.randomUUID(),
      name: person.name,
      oreOrdinarie: String(person.ore_ordinarie ?? ""),
      oreStraordinarie: String(person.ore_straordinarie ?? ""),
      oreReperibilita: String(person.ore_reperibilita ?? ""),
      costoOrario: String(person.costo_orario ?? ""),
      roles: person.roles || [],
    }));
    setPeople(parsed.length ? parsed : [emptyPerson()]);
    setParseStatus("Parsing completato.");
  };

  const handleAddPerson = () => setPeople((prev) => [...prev, emptyPerson()]);

  const handleRemovePerson = (id) => {
    setPeople((prev) => prev.filter((person) => person.id !== id));
  };

  const handleUploadTemplate = async () => {
    setTemplateStatus("");
    if (!templateFile) {
      setTemplateStatus("Seleziona il template Excel.");
      return;
    }
    const formData = new FormData();
    formData.append("template", templateFile);
    const response = await fetch(`${API_BASE}/upload-template`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text();
      setTemplateStatus(text || "Errore upload template");
      return;
    }
    setTemplateStatus("Template caricato.");
  };

  const buildPayload = () => {
    const list = people.map((person) => ({
      name: person.name.trim(),
      ore_ordinarie: Number(person.oreOrdinarie || 0),
      ore_straordinarie: Number(person.oreStraordinarie || 0),
      ore_reperibilita: Number(person.oreReperibilita || 0),
      costo_orario: Number(person.costoOrario || 0),
      roles: person.roles,
      forfait_total: 0,
    }));

    if (alessandro.oreOs || alessandro.oreRep || alessandro.forfait) {
      list.push({
        name: "ALESSANDRO RICHARD",
        ore_ordinarie: Number(alessandro.oreOs || 0),
        ore_straordinarie: 0,
        ore_reperibilita: Number(alessandro.oreRep || 0),
        costo_orario: Number(alessandroCosto || 0),
        roles: ["OS"],
        forfait_total: Number(alessandro.forfait || 0),
      });
    }

    return {
      year: Number(year),
      month: Number(month),
      people: list,
      consume_all_hours: consumeAll,
      medico_total: Number(medicoTotal || 0),
    };
  };

  const handleCompute = async () => {
    setComputeStatus("");
    if (missingBasics.length) {
      setComputeStatus("Compila mese e anno.");
      return;
    }
    const response = await fetch(`${API_BASE}/compute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    if (!response.ok) {
      const text = await response.text();
      setComputeStatus(text || "Errore calcolo");
      return;
    }
    const data = await response.json();
    setConsuntivo(data.consuntivo || []);
    setPivot(data.pivot || []);
    setCheck(data.check || []);
    setComputeStatus("Calcolo completato.");
  };

  const handleExport = async () => {
    setExportStatus("");
    if (!templateFile) {
      setExportStatus("Carica il template Excel prima di esportare.");
      return;
    }
    const response = await fetch(`${API_BASE}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    if (!response.ok) {
      const text = await response.text();
      setExportStatus(text || "Errore export");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `CAS_EXPORT_${year}_${String(month).padStart(2, "0")}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportStatus("Export completato.");
  };

  return (
    <div className="px-4 pb-16 pt-10 md:px-8 lg:px-16 max-w-6xl mx-auto space-y-8">
      <header className="glass panel p-6 md:p-10 space-y-4 reveal">
        <p className="uppercase tracking-[0.5em] text-xs text-ink/60">CAS prospetti ore</p>
        <h1 className="font-serif text-3xl md:text-4xl text-ink">Prospetti mensili multi-rete</h1>
        <p className="text-ink/70 max-w-3xl">
          Inserisci ore e costi, calcola i fabbisogni per 5 reti e genera i due Excel richiesti.
        </p>
      </header>

      <section className="glass panel p-6 md:p-8 space-y-6 reveal">
        <h2 className="font-serif text-2xl text-ink">Dashboard</h2>
        <div className="grid md:grid-cols-4 gap-4">
          <input
            value={year}
            onChange={(event) => setYear(event.target.value)}
            placeholder="Anno"
            className="px-4 py-2 rounded-xl border border-ink/10"
          />
          <input
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            placeholder="Mese"
            className="px-4 py-2 rounded-xl border border-ink/10"
          />
          <input
            value={medicoTotal}
            onChange={(event) => setMedicoTotal(event.target.value)}
            placeholder="Costo totale medico (opzionale)"
            className="px-4 py-2 rounded-xl border border-ink/10"
          />
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              checked={consumeAll}
              onChange={(event) => setConsumeAll(event.target.checked)}
            />
            Consuma tutte le ore disponibili
          </label>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="font-semibold text-ink">Incolla testo (Busta Paga)</h3>
            <textarea
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              rows={8}
              className="w-full px-4 py-3 rounded-xl border border-ink/10"
              placeholder="Incolla qui il testo strutturato..."
            ></textarea>
            <button
              type="button"
              className="px-4 py-2 rounded-full bg-ink text-white text-sm"
              onClick={handleParse}
            >
              Parsing automatico
            </button>
            {parseStatus && <p className="text-xs text-ink/60">{parseStatus}</p>}
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold text-ink">Template Excel</h3>
            <input
              type="file"
              accept=".xlsx"
              onChange={(event) => setTemplateFile(event.target.files?.[0] || null)}
              className="w-full px-4 py-3 rounded-xl border border-ink/10"
            />
            <button
              type="button"
              className="px-4 py-2 rounded-full bg-ink text-white text-sm"
              onClick={handleUploadTemplate}
            >
              Carica template
            </button>
            {templateStatus && <p className="text-xs text-ink/60">{templateStatus}</p>}
          </div>
        </div>
      </section>

      <section className="glass panel p-6 md:p-8 space-y-6 reveal">
        <h2 className="font-serif text-2xl text-ink">Dati persone (manuale)</h2>
        <div className="space-y-3">
          {people.map((person) => (
            <div key={person.id} className="p-4 rounded-2xl bg-white/70 space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <input
                  value={person.name}
                  onChange={(event) =>
                    setPeople((prev) =>
                      prev.map((item) =>
                        item.id === person.id ? { ...item, name: event.target.value } : item
                      )
                    )
                  }
                  placeholder="Nome"
                  className="px-4 py-2 rounded-xl border border-ink/10"
                />
                <input
                  value={person.costoOrario}
                  onChange={(event) =>
                    setPeople((prev) =>
                      prev.map((item) =>
                        item.id === person.id
                          ? { ...item, costoOrario: event.target.value }
                          : item
                      )
                    )
                  }
                  placeholder="Costo orario netto"
                  className="px-4 py-2 rounded-xl border border-ink/10"
                />
              </div>
              <div className="grid md:grid-cols-3 gap-3">
                <input
                  value={person.oreOrdinarie}
                  onChange={(event) =>
                    setPeople((prev) =>
                      prev.map((item) =>
                        item.id === person.id
                          ? { ...item, oreOrdinarie: event.target.value }
                          : item
                      )
                    )
                  }
                  placeholder="Ore ordinarie"
                  className="px-4 py-2 rounded-xl border border-ink/10"
                />
                <input
                  value={person.oreStraordinarie}
                  onChange={(event) =>
                    setPeople((prev) =>
                      prev.map((item) =>
                        item.id === person.id
                          ? { ...item, oreStraordinarie: event.target.value }
                          : item
                      )
                    )
                  }
                  placeholder="Ore straordinarie"
                  className="px-4 py-2 rounded-xl border border-ink/10"
                />
                <input
                  value={person.oreReperibilita}
                  onChange={(event) =>
                    setPeople((prev) =>
                      prev.map((item) =>
                        item.id === person.id
                          ? { ...item, oreReperibilita: event.target.value }
                          : item
                      )
                    )
                  }
                  placeholder="Ore reperibilita"
                  className="px-4 py-2 rounded-xl border border-ink/10"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                {ROLE_OPTIONS.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm text-ink/70">
                    <input
                      type="checkbox"
                      checked={person.roles.includes(role)}
                      onChange={(event) =>
                        setPeople((prev) =>
                          prev.map((item) =>
                            item.id === person.id
                              ? {
                                  ...item,
                                  roles: event.target.checked
                                    ? [...item.roles, role]
                                    : item.roles.filter((r) => r !== role),
                                }
                              : item
                          )
                        )
                      }
                    />
                    {role}
                  </label>
                ))}
                <button
                  type="button"
                  className="ml-auto px-3 py-1 rounded-full bg-white/80 text-ink text-xs"
                  onClick={() => handleRemovePerson(person.id)}
                >
                  Rimuovi
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="px-4 py-2 rounded-full bg-ink text-white text-sm"
          onClick={handleAddPerson}
        >
          Aggiungi persona
        </button>
      </section>

      <section className="glass panel p-6 md:p-8 space-y-6 reveal">
        <h2 className="font-serif text-2xl text-ink">Alessandro Richard (forfait)</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <input
            value={alessandro.oreOs}
            onChange={(event) => setAlessandro((prev) => ({ ...prev, oreOs: event.target.value }))}
            placeholder="Ore OS"
            className="px-4 py-2 rounded-xl border border-ink/10"
          />
          <input
            value={alessandro.oreRep}
            onChange={(event) => setAlessandro((prev) => ({ ...prev, oreRep: event.target.value }))}
            placeholder="Ore reperibilita"
            className="px-4 py-2 rounded-xl border border-ink/10"
          />
          <input
            value={alessandro.forfait}
            onChange={(event) => setAlessandro((prev) => ({ ...prev, forfait: event.target.value }))}
            placeholder="Forfait totale"
            className="px-4 py-2 rounded-xl border border-ink/10"
          />
        </div>
        <p className="text-sm text-ink/70">Costo orario diurno calcolato: {alessandroCosto || "-"}</p>
      </section>

      <section className="glass panel p-6 md:p-8 space-y-6 reveal">
        <h2 className="font-serif text-2xl text-ink">Preview & Validazione</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="px-5 py-2 rounded-full bg-ink text-white font-semibold"
            onClick={handleCompute}
          >
            Esegui calcolo
          </button>
          {computeStatus && <p className="text-sm text-ink/60">{computeStatus}</p>}
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="p-4 rounded-2xl bg-white/70">
            <h3 className="font-semibold text-ink">Pivot ore per rete/ruolo</h3>
            <ul className="mt-3 text-sm text-ink/70 space-y-1">
              {pivot.length === 0 ? (
                <li>Nessun dato.</li>
              ) : (
                pivot.map((row) => (
                  <li key={`${row.network}-${row.role}`}>
                    {row.network} · {row.role}: {row.hours}
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="p-4 rounded-2xl bg-white/70">
            <h3 className="font-semibold text-ink">Controllo fabbisogno</h3>
            <ul className="mt-3 text-sm text-ink/70 space-y-1">
              {check.length === 0 ? (
                <li>Nessun controllo.</li>
              ) : (
                check.map((row) => (
                  <li key={`${row.network}-${row.role}`}>
                    {row.network} · {row.role}: diff {row.diff.toFixed(2)} ({row.ok ? "OK" : "KO"})
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </section>

      <section className="glass panel p-6 md:p-8 space-y-6 reveal">
        <h2 className="font-serif text-2xl text-ink">Export</h2>
        <button
          type="button"
          className="px-5 py-2 rounded-full bg-ink text-white font-semibold"
          onClick={handleExport}
        >
          Genera Excel (ZIP)
        </button>
        {exportStatus && <p className="text-sm text-ink/60">{exportStatus}</p>}
      </section>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
