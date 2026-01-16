const { useMemo, useState } = React;

const API_BASE =
  window.location.protocol === "file:"
    ? "http://localhost:8000"
    : window.location.port === "8080"
    ? "http://localhost:8000"
    : "";

const ocrModes = [
  {
    id: "text",
    label: "Solo testo",
    helper: "Usa pdfplumber solo se il PDF contiene testo reale.",
  },
  {
    id: "fallback",
    label: "Testo + OCR fallback",
    helper: "OCR automatico solo per pagine senza testo o con bassa qualita.",
  },
  {
    id: "forced",
    label: "OCR forzato",
    helper: "Ricalcola tutto via OCR (OCRmyPDF/Tesseract o provider).",
  },
];

const presetCas = {
  name: "Preset CAS standard",
  roles: [
    {
      id: crypto.randomUUID(),
      name: "Operatore",
      cadence: "per giorno",
      step: "0,5",
      rounding: "standard",
      chunk: "7,5",
      allowRemainder: true,
      costMode: "costo orario fisso",
      costValue: "18,50",
    },
    {
      id: crypto.randomUUID(),
      name: "Coordinatore",
      cadence: "per settimana",
      step: "0,5",
      rounding: "eccesso",
      chunk: "8",
      allowRemainder: false,
      costMode: "costo da busta paga",
      costValue: "",
    },
  ],
  networks: [
    { id: crypto.randomUUID(), name: "Rete Milano" },
    { id: crypto.randomUUID(), name: "Rete Como" },
  ],
  cigs: [
    {
      id: crypto.randomUUID(),
      name: "CIG-NE-2024",
      networks: ["Rete Milano", "Rete Como"],
    },
  ],
  parsing: {
    oreOrdinarie: "(?i)ore\s+ordinarie\s+([\\d.,]+)",
    oreStraordinarie: "(?i)ore\s+straordinarie\s+([\\d.,]+)",
    reperibilita: "(?i)reperibilita\s+([\\d.,]+)",
    netto: "(?i)netto\s+([\\d.,]+)",
    pignoramento: "(?i)pignoramento\s+([\\d.,]+)",
    decimale: ",",
    migliaia: ".",
    dedup: "token match",
    fuzzyThreshold: "0,82",
  },
  excelNaming: {
    prefix: "CAS_",
    suffix: "_2024",
  },
};

const initialExtracted = [];

const initialLog = [];

const steps = [
  "Upload PDF",
  "Estrazione",
  "Config commessa",
  "Allocazione",
  "Preview",
  "Export",
];

const emptyRole = () => ({
  id: crypto.randomUUID(),
  name: "",
  cadence: "",
  step: "",
  rounding: "",
  chunk: "",
  allowRemainder: false,
  costMode: "",
  costValue: "",
});

const emptyNetwork = () => ({ id: crypto.randomUUID(), name: "" });

const emptyCig = () => ({
  id: crypto.randomUUID(),
  name: "",
  networks: [],
});

const formatConfidence = (value) => `${Math.round(value * 100)}%`;

const hasAmbiguousNumber = (value) =>
  typeof value === "string" && value.includes(",") && value.includes(".");

const looksLikeHours = (value) => {
  if (!value) return false;
  const normalized = value.replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) && num >= 0 && num <= 320;
};

const getRisk = (row) => {
  if (row.rischio) {
    return row.rischio;
  }
  const required = [row.oreOrdinarie, row.oreStraordinarie, row.reperibilita, row.netto];
  if (required.some((value) => String(value ?? "").trim() === "")) {
    return "Dato mancante";
  }
  const riskyFields = [row.oreOrdinarie, row.oreStraordinarie, row.reperibilita, row.netto];
  if (riskyFields.some((value) => hasAmbiguousNumber(value))) {
    return "Separatore ambiguo";
  }
  if (!looksLikeHours(row.oreOrdinarie) || !looksLikeHours(row.oreStraordinarie)) {
    return "Fuori range";
  }
  if (row.confidenza < 0.75) {
    return "Confidenza bassa";
  }
  return "";
};

const Badge = ({ tone, children }) => {
  const toneClass = {
    warn: "bg-ember/15 text-ember",
    ok: "bg-moss/15 text-moss",
    info: "bg-ocean/15 text-ocean",
  }[tone];

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${toneClass}`}>
      {children}
    </span>
  );
};

const SectionCard = ({ title, eyebrow, children, index }) => (
  <section
    className="glass panel p-6 md:p-8 space-y-5 reveal"
    style={{ animationDelay: `${index * 0.08}s` }}
  >
    <div className="space-y-2">
      {eyebrow && (
        <p className="uppercase tracking-[0.3em] text-xs text-ink/60">{eyebrow}</p>
      )}
      <h2 className="font-serif text-2xl md:text-3xl text-ink">{title}</h2>
    </div>
    {children}
  </section>
);

const App = () => {
  const [files, setFiles] = useState([]);
  const [ocrMode, setOcrMode] = useState("");
  const [extractedRows, setExtractedRows] = useState(initialExtracted);
  const [logRows, setLogRows] = useState(initialLog);
  const [roles, setRoles] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [cigs, setCigs] = useState([]);
  const [parsingConfig, setParsingConfig] = useState({
    oreOrdinarie: "",
    oreStraordinarie: "",
    reperibilita: "",
    netto: "",
    pignoramento: "",
    decimale: "",
    migliaia: "",
    dedup: "",
    fuzzyThreshold: "",
  });
  const [excelNaming, setExcelNaming] = useState({ prefix: "", suffix: "" });
  const [allocation, setAllocation] = useState({
    step: "",
    rounding: "",
    chunk: "",
    allowRemainder: false,
  });
  const [activeTab, setActiveTab] = useState("ruoli");
  const [activeStep, setActiveStep] = useState(0);
  const [warnings, setWarnings] = useState([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState("");
  const [exportStatus, setExportStatus] = useState("");

  const riskRows = useMemo(
    () => extractedRows.map((row) => ({ id: row.id, risk: getRisk(row) })),
    [extractedRows]
  );

  const hasBlockingIssues = useMemo(() => {
    const risk = riskRows.some((row) => row.risk);
    const missingConfig = roles.length === 0 || networks.length === 0 || cigs.length === 0;
    return risk || missingConfig || !ocrMode || files.length === 0;
  }, [riskRows, roles, networks, cigs, ocrMode, files]);

  const missingItems = useMemo(() => {
    const items = [];
    if (!files.length) items.push("Carica almeno un PDF");
    if (!ocrMode) items.push("Seleziona modalita OCR");
    if (!roles.length) items.push("Definisci almeno un ruolo");
    if (!networks.length) items.push("Definisci almeno una rete");
    if (!cigs.length) items.push("Definisci almeno un CIG");
    return items;
  }, [files, ocrMode, roles, networks, cigs]);

  const handleFileUpload = (event) => {
    const uploaded = Array.from(event.target.files || []);
    setFiles(uploaded);
  };

  const updateRow = (id, field, value) => {
    setExtractedRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const updateRole = (id, field, value) => {
    setRoles((prev) =>
      prev.map((role) => (role.id === id ? { ...role, [field]: value } : role))
    );
  };

  const updateNetwork = (id, value) => {
    setNetworks((prev) =>
      prev.map((network) => (network.id === id ? { ...network, name: value } : network))
    );
  };

  const updateCig = (id, field, value) => {
    setCigs((prev) =>
      prev.map((cig) => (cig.id === id ? { ...cig, [field]: value } : cig))
    );
  };

  const handleExtract = async () => {
    setExtractStatus("");
    setWarnings([]);
    if (!files.length || !ocrMode) {
      setExtractStatus("Carica almeno un PDF e scegli la modalita OCR.");
      return;
    }
    setIsExtracting(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("ocr_mode", ocrMode);
      formData.append("parsing_config", JSON.stringify(parsingConfig));

      const response = await fetch(`${API_BASE}/api/extract`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        setExtractStatus(text || "Errore estrazione");
        return;
      }

      const data = await response.json();
      const mappedRows = (data.extracted_rows || []).map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        oreOrdinarie: row.ore_ordinarie,
        oreStraordinarie: row.ore_straordinarie,
        reperibilita: row.reperibilita,
        netto: row.netto,
        pagina: row.pagina,
        metodo: row.metodo,
        confidenza: row.confidenza,
        rischio: row.rischio || "",
      }));
      setExtractedRows(mappedRows);
      setLogRows(data.log || []);
      setWarnings(data.warnings || []);
      setExtractStatus("Estrazione completata. Verifica e correggi i dati.");
      setActiveStep(1);
    } catch (error) {
      setExtractStatus("Errore di rete durante estrazione.");
    } finally {
      setIsExtracting(false);
    }
  };

  const applyPreset = () => {
    setRoles(presetCas.roles);
    setNetworks(presetCas.networks);
    setCigs(presetCas.cigs);
    setParsingConfig(presetCas.parsing);
    setExcelNaming(presetCas.excelNaming);
    setAllocation({
      step: presetCas.roles[0].step,
      rounding: presetCas.roles[0].rounding,
      chunk: presetCas.roles[0].chunk,
      allowRemainder: presetCas.roles[0].allowRemainder,
    });
  };

  const handleExport = async () => {
    setExportStatus("");
    try {
      const response = await fetch(`${API_BASE}/api/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: extractedRows.map((row) => ({
            name: row.name,
            role: row.role,
            ore_ordinarie: row.oreOrdinarie,
            ore_straordinarie: row.oreStraordinarie,
            reperibilita: row.reperibilita,
            netto: row.netto,
          })),
          networks: networks.map((network) => network.name).filter(Boolean),
          cigs: cigs
            .filter((cig) => cig.name)
            .map((cig) => ({ name: cig.name, networks: cig.networks })),
          excel_naming: excelNaming,
        }),
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
      link.download = "prospetti-ore-costi.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportStatus("Export completato");
    } catch (error) {
      setExportStatus("Errore di rete durante export");
    }
  };

  const riskCount = riskRows.filter((row) => row.risk).length;

  return (
    <div className="px-4 pb-16 pt-10 md:px-8 lg:px-16 max-w-6xl mx-auto space-y-8">
      <header className="glass panel p-6 md:p-10 flex flex-col gap-6 reveal">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="uppercase tracking-[0.5em] text-xs text-ink/60">prospetti ore & costi</p>
            <h1 className="font-serif text-3xl md:text-4xl text-ink">
              Commesse multi-rete con OCR controllato
            </h1>
            <p className="text-ink/70 mt-3 max-w-2xl">
              Importa buste paga in PDF, esegui estrazioni con fallback OCR e orchestra la
              configurazione per reti, CIG e ruoli. L&#39;utente decide tutto, i dati vengono sempre
              validati.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="px-5 py-2 rounded-full bg-ink text-white font-semibold"
              onClick={applyPreset}
            >
              Applica {presetCas.name}
            </button>
            <span className="text-xs text-ink/60">
              Nessun default imposto: i preset sono solo scorciatoie.
            </span>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="p-4 rounded-2xl bg-white/70">
            <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Modalita OCR</p>
            <p className="font-semibold text-ink">
              {ocrMode ? ocrModes.find((mode) => mode.id === ocrMode)?.label : "Non selezionata"}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-white/70">
            <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Righe a rischio</p>
            <p className="font-semibold text-ink">{riskCount}</p>
          </div>
          <div className="p-4 rounded-2xl bg-white/70">
            <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Prerequisiti</p>
            <p className="font-semibold text-ink">
              {missingItems.length === 0 ? "Completi" : "Da completare"}
            </p>
          </div>
        </div>
      </header>

      <div className="glass panel p-4 md:p-6 reveal" style={{ animationDelay: "0.08s" }}>
        <div className="flex flex-wrap items-center gap-3">
          {steps.map((step, index) => (
            <button
              key={step}
              type="button"
              onClick={() => setActiveStep(index)}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                activeStep === index
                  ? "bg-ink text-white"
                  : "bg-white/80 text-ink hover:bg-white"
              }`}
            >
              {index + 1}. {step}
            </button>
          ))}
        </div>
      </div>

      {activeStep === 0 && (
        <SectionCard title="1. Upload PDF" eyebrow="Wizard" index={1}>
          <div className="grid md:grid-cols-[1.2fr_1fr] gap-6">
            <div className="space-y-4">
              <label className="block text-sm font-semibold">Buste paga (PDF)</label>
              <input
                type="file"
                accept="application/pdf"
                multiple
                onChange={handleFileUpload}
                className="w-full px-4 py-3 rounded-2xl bg-white/80 border border-ink/10"
              />
              <div className="text-sm text-ink/70">
                {files.length
                  ? `${files.length} file caricati, pronti per parsing.`
                  : "Nessun file caricato. Supportate anche scansioni."}
              </div>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-semibold">Modalita OCR</label>
              <select
                value={ocrMode}
                onChange={(event) => setOcrMode(event.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-white/80 border border-ink/10 ink-ring"
              >
                <option value="" disabled>
                  Seleziona modalita
                </option>
                {ocrModes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label}
                  </option>
                ))}
              </select>
              <div className="space-y-2 text-sm text-ink/70">
                {ocrModes.map((mode) => (
                  <p key={mode.id}>
                    <span className="font-semibold text-ink">{mode.label}:</span> {mode.helper}
                  </p>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="px-5 py-2 rounded-full bg-ink text-white font-semibold disabled:opacity-60"
              onClick={handleExtract}
              disabled={isExtracting}
            >
              {isExtracting ? "Estrazione in corso..." : "Esegui estrazione"}
            </button>
            <button
              type="button"
              className="px-5 py-2 rounded-full bg-white/80 text-ink font-semibold"
              onClick={() => setActiveStep(1)}
            >
              Vai ai dati estratti
            </button>
          </div>
          {extractStatus && <p className="text-sm text-ink/70">{extractStatus}</p>}
          {warnings.length > 0 && (
            <div className="text-sm text-ember space-y-1">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {activeStep === 1 && (
        <SectionCard title="2. Dati estratti" eyebrow="Estrazione" index={2}>
        <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-sm">
              <thead>
                <tr className="text-left text-ink/70">
                  <th className="py-2">Nominativo</th>
                  <th>Ruolo</th>
                  <th>Ordinarie</th>
                  <th>Straord.</th>
                  <th>Reperibilita</th>
                  <th>Netto</th>
                  <th>Pagina</th>
                  <th>Conf.</th>
                  <th>Rischio</th>
                </tr>
              </thead>
              <tbody>
                {extractedRows.length === 0 ? (
                  <tr className="border-t border-ink/10">
                    <td colSpan={9} className="py-6 text-center text-sm text-ink/60">
                      Nessun dato estratto. Esegui l'estrazione dal passo 1.
                    </td>
                  </tr>
                ) : (
                  extractedRows.map((row) => {
                    const risk = getRisk(row);
                    return (
                      <tr key={row.id} className="border-t border-ink/10">
                        <td className="py-2">
                          <input
                            value={row.name}
                            onChange={(event) => updateRow(row.id, "name", event.target.value)}
                            className="w-full bg-transparent border-b border-ink/10 focus:border-ink/40"
                          />
                        </td>
                        <td>
                          <input
                            value={row.role}
                            onChange={(event) => updateRow(row.id, "role", event.target.value)}
                            className="w-full bg-transparent border-b border-ink/10 focus:border-ink/40"
                          />
                        </td>
                        <td>
                          <input
                            value={row.oreOrdinarie}
                            onChange={(event) =>
                              updateRow(row.id, "oreOrdinarie", event.target.value)
                            }
                            className="w-full bg-transparent border-b border-ink/10 focus:border-ink/40"
                          />
                        </td>
                        <td>
                          <input
                            value={row.oreStraordinarie}
                            onChange={(event) =>
                              updateRow(row.id, "oreStraordinarie", event.target.value)
                            }
                            className="w-full bg-transparent border-b border-ink/10 focus:border-ink/40"
                          />
                        </td>
                        <td>
                          <input
                            value={row.reperibilita}
                            onChange={(event) =>
                              updateRow(row.id, "reperibilita", event.target.value)
                            }
                            className="w-full bg-transparent border-b border-ink/10 focus:border-ink/40"
                          />
                        </td>
                        <td>
                          <input
                            value={row.netto}
                            onChange={(event) => updateRow(row.id, "netto", event.target.value)}
                            className="w-full bg-transparent border-b border-ink/10 focus:border-ink/40"
                          />
                        </td>
                        <td className="text-ink/70">{row.pagina}</td>
                        <td>{formatConfidence(row.confidenza)}</td>
                        <td>
                          {risk ? <Badge tone="warn">{risk}</Badge> : <Badge tone="ok">OK</Badge>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-white/70">
              <h3 className="font-semibold text-ink">Log confidenza</h3>
              <ul className="mt-3 space-y-3 text-sm">
                {logRows.length === 0 ? (
                  <li className="text-ink/60">Nessun log disponibile.</li>
                ) : (
                  logRows.map((entry) => (
                    <li key={entry.id} className="border-l-2 border-ink/10 pl-3">
                      <p className="font-semibold text-ink">
                        Pagina {entry.page} · {entry.field}
                      </p>
                      <p className="text-ink/70">
                        Valore: {entry.value} · Metodo: {entry.method} · {entry.rule}
                      </p>
                      <p className="text-ink/60 text-xs">
                        Confidenza {formatConfidence(entry.confidence)}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="p-4 rounded-2xl bg-white/70">
              <h3 className="font-semibold text-ink">Regola d&#39;oro</h3>
              <p className="text-sm text-ink/70 mt-2">
                Nessuna cifra viene accettata automaticamente: ogni numero deve superare
                controlli di formato, range e step. In caso di dubbio l&#39;utente deve
                confermare o correggere.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="px-5 py-2 rounded-full bg-white/80 text-ink font-semibold"
            onClick={() => setActiveStep(0)}
          >
            Indietro
          </button>
          <button
            type="button"
            className="px-5 py-2 rounded-full bg-ink text-white font-semibold"
            onClick={() => setActiveStep(2)}
          >
            Avanti
          </button>
        </div>
      </SectionCard>
      )}

      {activeStep === 2 && (
      <SectionCard title="3. Config Editor" eyebrow="L'utente decide tutto" index={3}>
        <div className="flex flex-wrap gap-3">
          {[
            { id: "ruoli", label: "Ruoli" },
            { id: "reti", label: "Reti & CIG" },
            { id: "parsing", label: "Parsing" },
            { id: "excel", label: "Excel" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-full text-sm font-semibold ${
                activeTab === tab.id
                  ? "bg-ink text-white"
                  : "bg-white/80 text-ink hover:bg-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "ruoli" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">Configurazioni per ruolo</h3>
              <button
                type="button"
                onClick={() => setRoles((prev) => [...prev, emptyRole()])}
                className="px-4 py-2 rounded-full bg-ink text-white text-sm"
              >
                Aggiungi ruolo
              </button>
            </div>
            {roles.length === 0 ? (
              <p className="text-sm text-ink/70">Nessun ruolo definito: aggiungine uno.</p>
            ) : (
              <div className="grid gap-4">
                {roles.map((role) => (
                  <div key={role.id} className="p-4 rounded-2xl bg-white/70 space-y-3">
                    <div className="grid md:grid-cols-2 gap-3">
                      <input
                        value={role.name}
                        onChange={(event) => updateRole(role.id, "name", event.target.value)}
                        placeholder="Nome ruolo"
                        className="px-4 py-2 rounded-xl border border-ink/10"
                      />
                      <input
                        value={role.cadence}
                        onChange={(event) => updateRole(role.id, "cadence", event.target.value)}
                        placeholder="Tipo fabbisogno (giorno/settimana/mese)"
                        className="px-4 py-2 rounded-xl border border-ink/10"
                      />
                    </div>
                    <div className="grid md:grid-cols-3 gap-3">
                      <input
                        value={role.step}
                        onChange={(event) => updateRole(role.id, "step", event.target.value)}
                        placeholder="Step minimo"
                        className="px-4 py-2 rounded-xl border border-ink/10"
                      />
                      <input
                        value={role.rounding}
                        onChange={(event) => updateRole(role.id, "rounding", event.target.value)}
                        placeholder="Arrotondamento"
                        className="px-4 py-2 rounded-xl border border-ink/10"
                      />
                      <input
                        value={role.chunk}
                        onChange={(event) => updateRole(role.id, "chunk", event.target.value)}
                        placeholder="Chunk allocazione"
                        className="px-4 py-2 rounded-xl border border-ink/10"
                      />
                    </div>
                    <div className="grid md:grid-cols-3 gap-3">
                      <input
                        value={role.costMode}
                        onChange={(event) => updateRole(role.id, "costMode", event.target.value)}
                        placeholder="Costo (orario/busta/ mese)"
                        className="px-4 py-2 rounded-xl border border-ink/10"
                      />
                      <input
                        value={role.costValue}
                        onChange={(event) => updateRole(role.id, "costValue", event.target.value)}
                        placeholder="Valore costo"
                        className="px-4 py-2 rounded-xl border border-ink/10"
                      />
                      <label className="flex items-center gap-2 text-sm text-ink/70">
                        <input
                          type="checkbox"
                          checked={role.allowRemainder}
                          onChange={(event) =>
                            updateRole(role.id, "allowRemainder", event.target.checked)
                          }
                        />
                        Consenti ultimo spezzone
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "reti" && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-ink">Reti</h3>
                <button
                  type="button"
                  onClick={() => setNetworks((prev) => [...prev, emptyNetwork()])}
                  className="px-4 py-2 rounded-full bg-ink text-white text-sm"
                >
                  Aggiungi rete
                </button>
              </div>
              {networks.length === 0 ? (
                <p className="text-sm text-ink/70">Nessuna rete definita.</p>
              ) : (
                <div className="space-y-2">
                  {networks.map((network) => (
                    <input
                      key={network.id}
                      value={network.name}
                      onChange={(event) => updateNetwork(network.id, event.target.value)}
                      placeholder="Nome rete"
                      className="w-full px-4 py-2 rounded-xl border border-ink/10"
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-ink">CIG</h3>
                <button
                  type="button"
                  onClick={() => setCigs((prev) => [...prev, emptyCig()])}
                  className="px-4 py-2 rounded-full bg-ink text-white text-sm"
                >
                  Aggiungi CIG
                </button>
              </div>
              {cigs.length === 0 ? (
                <p className="text-sm text-ink/70">Nessun CIG definito.</p>
              ) : (
                <div className="space-y-3">
                  {cigs.map((cig) => (
                    <div key={cig.id} className="p-3 rounded-2xl bg-white/70 space-y-2">
                      <input
                        value={cig.name}
                        onChange={(event) => updateCig(cig.id, "name", event.target.value)}
                        placeholder="Nome CIG"
                        className="w-full px-3 py-2 rounded-xl border border-ink/10"
                      />
                      <input
                        value={cig.networks.join(", ")}
                        onChange={(event) =>
                          updateCig(
                            cig.id,
                            "networks",
                            event.target.value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean)
                          )
                        }
                        placeholder="Reti collegate (separate da virgola)"
                        className="w-full px-3 py-2 rounded-xl border border-ink/10"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "parsing" && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h3 className="font-semibold text-ink">Regex estrazione</h3>
              {["oreOrdinarie", "oreStraordinarie", "reperibilita", "netto", "pignoramento"].map(
                (key) => (
                  <input
                    key={key}
                    value={parsingConfig[key]}
                    onChange={(event) =>
                      setParsingConfig((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                    placeholder={`Regex ${key}`}
                    className="w-full px-4 py-2 rounded-xl border border-ink/10"
                  />
                )
              )}
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold text-ink">Locale e dedup</h3>
              <input
                value={parsingConfig.decimale}
                onChange={(event) =>
                  setParsingConfig((prev) => ({ ...prev, decimale: event.target.value }))
                }
                placeholder="Separatore decimale"
                className="w-full px-4 py-2 rounded-xl border border-ink/10"
              />
              <input
                value={parsingConfig.migliaia}
                onChange={(event) =>
                  setParsingConfig((prev) => ({ ...prev, migliaia: event.target.value }))
                }
                placeholder="Separatore migliaia"
                className="w-full px-4 py-2 rounded-xl border border-ink/10"
              />
              <input
                value={parsingConfig.dedup}
                onChange={(event) =>
                  setParsingConfig((prev) => ({ ...prev, dedup: event.target.value }))
                }
                placeholder="Modalita dedup"
                className="w-full px-4 py-2 rounded-xl border border-ink/10"
              />
              <input
                value={parsingConfig.fuzzyThreshold}
                onChange={(event) =>
                  setParsingConfig((prev) => ({ ...prev, fuzzyThreshold: event.target.value }))
                }
                placeholder="Soglia fuzzy match"
                className="w-full px-4 py-2 rounded-xl border border-ink/10"
              />
            </div>
          </div>
        )}

        {activeTab === "excel" && (
          <div className="space-y-3">
            <h3 className="font-semibold text-ink">Naming fogli Excel</h3>
            <input
              value={excelNaming.prefix}
              onChange={(event) =>
                setExcelNaming((prev) => ({ ...prev, prefix: event.target.value }))
              }
              placeholder="Prefisso fogli"
              className="w-full px-4 py-2 rounded-xl border border-ink/10"
            />
            <input
              value={excelNaming.suffix}
              onChange={(event) =>
                setExcelNaming((prev) => ({ ...prev, suffix: event.target.value }))
              }
              placeholder="Suffisso fogli"
              className="w-full px-4 py-2 rounded-xl border border-ink/10"
            />
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="px-5 py-2 rounded-full bg-white/80 text-ink font-semibold"
            onClick={() => setActiveStep(1)}
          >
            Indietro
          </button>
          <button
            type="button"
            className="px-5 py-2 rounded-full bg-ink text-white font-semibold"
            onClick={() => setActiveStep(3)}
          >
            Avanti
          </button>
        </div>
      </SectionCard>
      )}

      {activeStep === 3 && (
        <SectionCard title="4. Allocazione" eyebrow="Regole operative" index={4}>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h3 className="font-semibold text-ink">Step e arrotondamenti</h3>
              <input
                value={allocation.step}
                onChange={(event) =>
                  setAllocation((prev) => ({ ...prev, step: event.target.value }))
                }
                placeholder="Step minimo (es. 0,5)"
                className="w-full px-4 py-2 rounded-xl border border-ink/10"
              />
              <input
                value={allocation.rounding}
                onChange={(event) =>
                  setAllocation((prev) => ({ ...prev, rounding: event.target.value }))
                }
                placeholder="Regola arrotondamento"
                className="w-full px-4 py-2 rounded-xl border border-ink/10"
              />
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold text-ink">Chunk allocazione</h3>
              <input
                value={allocation.chunk}
                onChange={(event) =>
                  setAllocation((prev) => ({ ...prev, chunk: event.target.value }))
                }
                placeholder="Chunk allocazione"
                className="w-full px-4 py-2 rounded-xl border border-ink/10"
              />
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={allocation.allowRemainder}
                  onChange={(event) =>
                    setAllocation((prev) => ({ ...prev, allowRemainder: event.target.checked }))
                  }
                />
                Consenti ultimo spezzone
              </label>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className="px-5 py-2 rounded-full bg-white/80 text-ink font-semibold"
              onClick={() => setActiveStep(2)}
            >
              Indietro
            </button>
            <button
              type="button"
              className="px-5 py-2 rounded-full bg-ink text-white font-semibold"
              onClick={() => setActiveStep(4)}
            >
              Avanti
            </button>
          </div>
        </SectionCard>
      )}

      {activeStep === 4 && (
      <SectionCard title="5. Preview & controlli" eyebrow="Simulazione" index={5}>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="p-4 rounded-2xl bg-white/70 space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Controlli blocco</p>
            <p className="font-semibold text-ink">
              {hasBlockingIssues ? "Export bloccato" : "Pronto per export"}
            </p>
            <p className="text-sm text-ink/70">
              {hasBlockingIssues
                ? "Completa configurazione o correggi righe a rischio."
                : "Tutti i dati superano le regole di validazione."}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-white/70 space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-ink/60">Reti attive</p>
            <p className="font-semibold text-ink">{networks.length}</p>
            <p className="text-sm text-ink/70">Ogni rete genera un foglio dedicato.</p>
          </div>
          <div className="p-4 rounded-2xl bg-white/70 space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-ink/60">CIG attivi</p>
            <p className="font-semibold text-ink">{cigs.length}</p>
            <p className="text-sm text-ink/70">Consolidati per commessa multi-rete.</p>
          </div>
        </div>
        {missingItems.length > 0 && (
          <div className="mt-6 p-4 rounded-2xl bg-white/70">
            <h3 className="font-semibold text-ink">Cosa manca</h3>
            <ul className="mt-2 text-sm text-ember space-y-1">
              {missingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-6 p-4 rounded-2xl bg-white/70">
          <h3 className="font-semibold text-ink">Audit consuntivo</h3>
          <p className="text-sm text-ink/70 mt-2">
            Ogni riga esportata contiene sorgente, metodo di estrazione, confidenza e correzioni
            manuali. Il log completo resta consultabile per revisione.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="px-5 py-2 rounded-full bg-white/80 text-ink font-semibold"
            onClick={() => setActiveStep(3)}
          >
            Indietro
          </button>
          <button
            type="button"
            className="px-5 py-2 rounded-full bg-ink text-white font-semibold"
            onClick={() => setActiveStep(5)}
          >
            Avanti
          </button>
        </div>
      </SectionCard>
      )}

      {activeStep === 5 && (
      <SectionCard title="6. Export" eyebrow="Output dinamico" index={6}>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="font-semibold text-ink">Template Excel dinamico</h3>
            <ul className="text-sm text-ink/70 space-y-2">
              <li>Foglio per ogni rete, naming configurabile.</li>
              <li>Foglio per CIG con aggregazione reti.</li>
              <li>Foglio Analisi_costi e Controlli automatici.</li>
              <li>Righe di fabbisogno/assegnato/diff in fondo.</li>
            </ul>
          </div>
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-white/70">
              <p className="text-sm font-semibold text-ink">Stato export</p>
              {hasBlockingIssues ? (
                <div className="mt-2 space-y-1 text-sm text-ember">
                  <p>Completa modalita OCR e configurazioni mancanti.</p>
                  <p>Correggi le righe a rischio prima di esportare.</p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-moss">
                  Tutti i controlli OK. L&#39;export e pronto.
                </p>
              )}
            </div>
            <button
              type="button"
              className={`w-full px-5 py-3 rounded-2xl font-semibold transition ${
                hasBlockingIssues
                  ? "bg-ink/20 text-ink/50 cursor-not-allowed"
                  : "bg-ink text-white"
              }`}
              disabled={hasBlockingIssues}
              onClick={handleExport}
            >
              Genera Excel
            </button>
            {exportStatus && (
              <p className="text-sm text-ink/70">{exportStatus}</p>
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="px-5 py-2 rounded-full bg-white/80 text-ink font-semibold"
            onClick={() => setActiveStep(4)}
          >
            Indietro
          </button>
        </div>
      </SectionCard>
      )}
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
