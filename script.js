const { useMemo, useState } = React;

const API_BASE =
  window.location.protocol === "file:"
    ? "http://localhost:8000"
    : window.location.port && window.location.port !== "8000"
    ? "http://localhost:8000"
    : "";

const ocrModes = [
  {
    id: "TEXT_ONLY",
    label: "Solo testo",
    helper: "Usa pdfplumber solo se il PDF contiene testo reale.",
  },
  {
    id: "TEXT_THEN_OCR",
    label: "Testo + OCR fallback",
    helper: "OCR automatico se testo assente o qualita bassa.",
  },
  {
    id: "OCR_FORCE",
    label: "OCR forzato",
    helper: "OCR su tutto il PDF con OCRmyPDF/Tesseract.",
  },
];

const presetCas = {
  name: "Preset CAS standard",
  roles: [
    {
      id: crypto.randomUUID(),
      name: "Operatore",
      demandType: "PER_DAY",
      demandValue: "12",
      step: "0,5",
      rounding: "CEIL",
      chunk: "7,5",
      allowRemainder: true,
      lastStep: "0,5",
      costMode: "FIXED_HOURLY",
      costValue: "18,50",
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
    nameRegex: "([A-Z][A-Z\\s'`.-]{3,})",
    oreOrdinarieRegex: "(?i)ore\\s+ordinarie\\s+([\\d.,]+)",
    oreStraordinarieRegex: "(?i)ore\\s+straordinarie\\s+([\\d.,]+)",
    reperibilitaRegex: "(?i)reperibilita\\s+([\\d.,]+)",
    nettoRegex: "(?i)netto\\s+([\\d.,]+)",
    pignoramentoRegex: "(?i)pignoramento\\s+([\\d.,]+)",
    decimale: ",",
    migliaia: ".",
  },
};

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
  demandType: "PER_MONTH",
  demandValue: "",
  step: "",
  rounding: "NEAREST",
  chunk: "",
  allowRemainder: false,
  lastStep: "0,5",
  costMode: "FROM_PAYSLIP_DERIVED",
  costValue: "",
});

const emptyNetwork = () => ({ id: crypto.randomUUID(), name: "" });

const emptyCig = () => ({
  id: crypto.randomUUID(),
  name: "",
  networks: [],
});

const hasAmbiguousNumber = (value) =>
  typeof value === "string" && value.includes(",") && value.includes(".");

const looksLikeHours = (value) => {
  if (!value) return false;
  const normalized = value.replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) && num >= 0 && num <= 320;
};

const getRisk = (row) => {
  if (row.risk) return row.risk;
  const required = [row.oreOrdinarie, row.oreStraordinarie, row.reperibilita, row.netto];
  if (required.some((value) => String(value ?? "").trim() === "")) {
    return "Dato mancante";
  }
  if ([row.oreOrdinarie, row.oreStraordinarie, row.reperibilita, row.netto].some((value) => hasAmbiguousNumber(value))) {
    return "Separatore ambiguo";
  }
  if (!looksLikeHours(row.oreOrdinarie) || !looksLikeHours(row.oreStraordinarie)) {
    return "Fuori range";
  }
  return "ok";
};

const App = () => {
  const [files, setFiles] = useState([]);
  const [uploadId, setUploadId] = useState("");
  const [pages, setPages] = useState([]);
  const [ocrMode, setOcrMode] = useState("");
  const [extractedRows, setExtractedRows] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [parsingConfig, setParsingConfig] = useState(presetCas.parsing);
  const [roles, setRoles] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [cigs, setCigs] = useState([]);
  const [period, setPeriod] = useState({ year: "", month: "", days: "30", weeks: "4", nights: "30" });
  const [consumeAllHours, setConsumeAllHours] = useState(false);
  const [configName, setConfigName] = useState("");
  const [computeResult, setComputeResult] = useState(null);
  const [activeTab, setActiveTab] = useState("ruoli");
  const [activeStep, setActiveStep] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [computeStatus, setComputeStatus] = useState("");
  const [exportStatus, setExportStatus] = useState("");

  const riskRows = useMemo(() => extractedRows.map((row) => getRisk(row)), [extractedRows]);

  const hasBlockingIssues = useMemo(() => {
    const risk = riskRows.some((risk) => risk && risk !== "ok");
    const missingConfig = roles.length === 0 || networks.length === 0 || cigs.length === 0;
    return risk || missingConfig || !ocrMode || !uploadId;
  }, [riskRows, roles, networks, cigs, ocrMode, uploadId]);

  const missingItems = useMemo(() => {
    const items = [];
    if (!uploadId) items.push("Carica almeno un PDF");
    if (!ocrMode) items.push("Seleziona modalita OCR");
    if (!roles.length) items.push("Definisci almeno un ruolo");
    if (!networks.length) items.push("Definisci almeno una rete");
    if (!cigs.length) items.push("Definisci almeno un CIG");
    return items;
  }, [uploadId, ocrMode, roles, networks, cigs]);

  const handleFileUpload = (event) => {
    const uploaded = Array.from(event.target.files || []);
    setFiles(uploaded);
  };

  const handleUpload = async () => {
    setUploadStatus("");
    setWarnings([]);
    setComputeResult(null);
    if (!files.length || !ocrMode) {
      setUploadStatus("Carica un PDF e scegli la modalita OCR.");
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("pdf", files[0]);
      formData.append("ocr_mode", ocrMode);
      formData.append(
        "parsing_config",
        JSON.stringify({
          name_regex: parsingConfig.nameRegex,
          ore_ordinarie_regex: parsingConfig.oreOrdinarieRegex,
          ore_straordinarie_regex: parsingConfig.oreStraordinarieRegex,
          reperibilita_regex: parsingConfig.reperibilitaRegex,
          netto_regex: parsingConfig.nettoRegex,
          pignoramento_regex: parsingConfig.pignoramentoRegex,
          decimal_separator: parsingConfig.decimale,
          thousands_separator: parsingConfig.migliaia,
        })
      );

      const response = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        setUploadStatus(text || "Errore upload");
        return;
      }

      const data = await response.json();
      setUploadId(data.upload_id);
      setPages(data.pages || []);
      setWarnings(data.warnings || []);
      await loadResources(data.upload_id);
      setUploadStatus("Upload completato. Verifica i dati estratti.");
      setActiveStep(1);
    } catch (error) {
      setUploadStatus("Errore di rete durante upload.");
    } finally {
      setIsUploading(false);
    }
  };

  const loadResources = async (id) => {
    const response = await fetch(`${API_BASE}/api/resources?upload_id=${id}`);
    if (!response.ok) return;
    const data = await response.json();
    const mapped = (data.rows || []).map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      oreOrdinarie: row.ore_ordinarie,
      oreStraordinarie: row.ore_straordinarie,
      reperibilita: row.reperibilita,
      netto: row.netto,
      pignoramento: row.pignoramento,
      costoOrario: row.costo_orario,
      source: row.source,
      risk: row.risk,
    }));
    setExtractedRows(mapped);
  };

  const saveResources = async () => {
    setSaveStatus("");
    if (!uploadId) {
      setSaveStatus("Carica prima un PDF.");
      return;
    }
    const payload = {
      upload_id: uploadId,
      rows: extractedRows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        ore_ordinarie: row.oreOrdinarie,
        ore_straordinarie: row.oreStraordinarie,
        reperibilita: row.reperibilita,
        netto: row.netto,
        pignoramento: row.pignoramento,
        costo_orario: row.costoOrario,
        source: row.source,
        risk: getRisk(row),
      })),
    };

    const response = await fetch(`${API_BASE}/api/resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      setSaveStatus(text || "Errore salvataggio");
      return;
    }
    setSaveStatus("Dati salvati.");
  };

  const mergeDuplicates = () => {
    const grouped = new Map();
    extractedRows.forEach((row) => {
      const key = row.name.trim().toLowerCase();
      if (!grouped.has(key)) {
        grouped.set(key, { ...row });
        return;
      }
      const existing = grouped.get(key);
      const sum = (a, b) => (Number(a.replace(",", ".")) || 0) + (Number(b.replace(",", ".")) || 0);
      existing.oreOrdinarie = String(sum(existing.oreOrdinarie, row.oreOrdinarie));
      existing.oreStraordinarie = String(sum(existing.oreStraordinarie, row.oreStraordinarie));
      existing.reperibilita = String(sum(existing.reperibilita, row.reperibilita));
      grouped.set(key, existing);
    });
    setExtractedRows(Array.from(grouped.values()));
  };

  const buildConfig = () => ({
    version: "1.0",
    period: {
      year: Number(period.year || 0),
      month: Number(period.month || 0),
      days: Number(period.days || 1),
      weeks: Number(period.weeks || 1),
      nights: Number(period.nights || 1),
    },
    consume_all_hours: consumeAllHours,
    net_locale: {
      decimal: parsingConfig.decimale,
      thousands: parsingConfig.migliaia,
      currency: "EUR",
    },
    reti: networks.map((network) => network.name).filter(Boolean),
    cig_groups: cigs
      .filter((cig) => cig.name)
      .map((cig) => ({ name: cig.name, reti: cig.networks })),
    roles: roles.map((role) => ({
      name: role.name,
      demand: { type: role.demandType, value: Number(role.demandValue || 0) },
      rounding: { step: Number(role.step || 0), mode: role.rounding },
      allocation: {
        chunk: Number(role.chunk || 0),
        allow_last_fragment: role.allowRemainder,
        last_fragment_step: Number(role.lastStep || 0),
      },
      cost: { mode: role.costMode, value: Number(role.costValue || 0) },
    })),
    people_rules: { name_aliases: {} },
  });

  const applyPreset = () => {
    setRoles(presetCas.roles);
    setNetworks(presetCas.networks);
    setCigs(presetCas.cigs);
    setParsingConfig(presetCas.parsing);
  };

  const saveConfig = async () => {
    setSaveStatus("");
    if (!configName.trim()) {
      setSaveStatus("Inserisci un nome config.");
      return;
    }
    const response = await fetch(`${API_BASE}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: configName, data: buildConfig() }),
    });
    if (!response.ok) {
      const text = await response.text();
      setSaveStatus(text || "Errore salvataggio config");
      return;
    }
    setSaveStatus("Config salvata.");
  };

  const loadConfig = async () => {
    setSaveStatus("");
    if (!configName.trim()) {
      setSaveStatus("Inserisci un nome config.");
      return;
    }
    const response = await fetch(`${API_BASE}/api/config?name=${encodeURIComponent(configName)}`);
    if (!response.ok) {
      const text = await response.text();
      setSaveStatus(text || "Config non trovata");
      return;
    }
    const data = await response.json();
    const config = data.data || {};
    setNetworks((config.reti || []).map((name) => ({ id: crypto.randomUUID(), name })));
    setCigs(
      (config.cig_groups || []).map((cig) => ({
        id: crypto.randomUUID(),
        name: cig.name,
        networks: cig.reti || [],
      }))
    );
    setRoles(
      (config.roles || []).map((role) => ({
        id: crypto.randomUUID(),
        name: role.name,
        demandType: role.demand?.type || "PER_MONTH",
        demandValue: String(role.demand?.value ?? ""),
        step: String(role.rounding?.step ?? ""),
        rounding: role.rounding?.mode || "NEAREST",
        chunk: String(role.allocation?.chunk ?? ""),
        allowRemainder: Boolean(role.allocation?.allow_last_fragment),
        lastStep: String(role.allocation?.last_fragment_step ?? ""),
        costMode: role.cost?.mode || "FROM_PAYSLIP_DERIVED",
        costValue: String(role.cost?.value ?? ""),
      }))
    );
    setConsumeAllHours(Boolean(config.consume_all_hours));
    setPeriod({
      year: String(config.period?.year ?? ""),
      month: String(config.period?.month ?? ""),
      days: String(config.period?.days ?? ""),
      weeks: String(config.period?.weeks ?? ""),
      nights: String(config.period?.nights ?? ""),
    });
    setSaveStatus("Config caricata.");
  };

  const handleCompute = async () => {
    setComputeStatus("");
    if (!uploadId) {
      setComputeStatus("Carica un PDF prima del calcolo.");
      return;
    }
    const response = await fetch(`${API_BASE}/api/compute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upload_id: uploadId,
        config: buildConfig(),
        resources: extractedRows.map((row) => ({
          id: row.id,
          name: row.name,
          role: row.role,
          ore_ordinarie: row.oreOrdinarie,
          ore_straordinarie: row.oreStraordinarie,
          reperibilita: row.reperibilita,
          netto: row.netto,
          pignoramento: row.pignoramento,
          costo_orario: row.costoOrario,
          source: row.source,
          risk: getRisk(row),
        })),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      setComputeStatus(text || "Errore calcolo");
      return;
    }
    const data = await response.json();
    setComputeResult(data);
    setComputeStatus("Calcolo completato.");
  };

  const handleExport = async () => {
    setExportStatus("");
    if (!uploadId) {
      setExportStatus("Carica un PDF prima dell'export.");
      return;
    }
    const url = new URL(`${API_BASE}/api/export/excel`);
    url.searchParams.set("upload_id", uploadId);
    if (configName.trim()) {
      url.searchParams.set("config_name", configName.trim());
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text();
      setExportStatus(text || "Errore export");
      return;
    }
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "prospetti-ore-costi.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    setExportStatus("Export completato.");
  };

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
              Carica il PDF, configura ruoli e reti, valida i dati estratti e genera il file
              Excel dinamico. Nessun dato viene inventato: tutto e editabile dall'utente.
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
        <section className="glass panel p-6 md:p-8 space-y-5 reveal">
          <h2 className="font-serif text-2xl md:text-3xl text-ink">1. Upload PDF</h2>
          <div className="grid md:grid-cols-[1.2fr_1fr] gap-6">
            <div className="space-y-4">
              <label className="block text-sm font-semibold">Buste paga (PDF unico)</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={handleFileUpload}
                className="w-full px-4 py-3 rounded-2xl bg-white/80 border border-ink/10"
              />
              <div className="text-sm text-ink/70">
                {files.length
                  ? `${files[0].name} pronto per upload.`
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
              onClick={handleUpload}
              disabled={isUploading}
            >
              {isUploading ? "Upload in corso..." : "Carica & Estrai"}
            </button>
            <button
              type="button"
              className="px-5 py-2 rounded-full bg-white/80 text-ink font-semibold"
              onClick={() => setActiveStep(1)}
            >
              Vai ai dati estratti
            </button>
          </div>
          {uploadStatus && <p className="text-sm text-ink/70">{uploadStatus}</p>}
          {warnings.length > 0 && (
            <div className="text-sm text-ember space-y-1">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </section>
      )}

      {activeStep === 1 && (
        <section className="glass panel p-6 md:p-8 space-y-5 reveal">
          <h2 className="font-serif text-2xl md:text-3xl text-ink">2. Dati estratti</h2>
          <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full text-sm">
                <thead>
                  <tr className="text-left text-ink/70">
                    <th className="py-2">Nominativo</th>
                    <th>Ruolo</th>
                    <th>Ordinarie</th>
                    <th>Straord.</th>
                    <th>Reperibilita</th>
                    <th>Netto</th>
                    <th>Pignoramento</th>
                    <th>Costo orario</th>
                    <th>Fonte</th>
                    <th>Rischio</th>
                  </tr>
                </thead>
                <tbody>
                  {extractedRows.length === 0 ? (
                    <tr className="border-t border-ink/10">
                      <td colSpan={10} className="py-6 text-center text-sm text-ink/60">
                        Nessun dato estratto. Esegui l'upload dal passo 1.
                      </td>
                    </tr>
                  ) : (
                    extractedRows.map((row) => (
                      <tr key={row.id} className="border-t border-ink/10">
                        <td className="py-2">
                          <input
                            value={row.name}
                            onChange={(event) =>
                              setExtractedRows((prev) =>
                                prev.map((item) =>
                                  item.id === row.id ? { ...item, name: event.target.value } : item
                                )
                              )
                            }
                            className="w-full bg-transparent border-b border-ink/10 focus:border-ink/40"
                          />
                        </td>
                        <td>
                          <input
                            value={row.role}
                            onChange={(event) =>
                              setExtractedRows((prev) =>
                                prev.map((item) =>
                                  item.id === row.id ? { ...item, role: event.target.value } : item
                                )
                              )
                            }
                            className="w-full bg-transparent border-b border-ink/10 focus:border-ink/40"
                          />
                        </td>
                        {["oreOrdinarie", "oreStraordinarie", "reperibilita", "netto", "pignoramento", "costoOrario"].map(
                          (field) => (
                            <td key={field}>
                              <input
                                value={row[field] || ""}
                                onChange={(event) =>
                                  setExtractedRows((prev) =>
                                    prev.map((item) =>
                                      item.id === row.id
                                        ? { ...item, [field]: event.target.value }
                                        : item
                                    )
                                  )
                                }
                                className="w-full bg-transparent border-b border-ink/10 focus:border-ink/40"
                              />
                            </td>
                          )
                        )}
                        <td className="text-xs text-ink/60">{row.source || "-"}</td>
                        <td className="text-xs text-ink/60">{getRisk(row)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-white/70">
                <h3 className="font-semibold text-ink">Pagine estratte</h3>
                <ul className="mt-3 space-y-3 text-sm">
                  {pages.length === 0 ? (
                    <li className="text-ink/60">Nessuna pagina disponibile.</li>
                  ) : (
                    pages.map((page) => (
                      <li key={page.index} className="border-l-2 border-ink/10 pl-3">
                        <p className="font-semibold text-ink">Pagina {page.index}</p>
                        <p className="text-ink/70 text-xs">
                          text_found: {String(page.text_found)} · ocr_used: {String(page.ocr_used)}
                        </p>
                        <p className="text-ink/60 text-xs">risk: {page.risk}</p>
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div className="p-4 rounded-2xl bg-white/70">
                <h3 className="font-semibold text-ink">Azioni rapide</h3>
                <div className="mt-3 space-y-2">
                  <button
                    type="button"
                    className="w-full px-4 py-2 rounded-full bg-ink text-white text-sm"
                    onClick={saveResources}
                  >
                    Salva modifiche
                  </button>
                  <button
                    type="button"
                    className="w-full px-4 py-2 rounded-full bg-white/80 text-ink text-sm"
                    onClick={mergeDuplicates}
                  >
                    Dedup per nominativo
                  </button>
                  {saveStatus && <p className="text-xs text-ink/60">{saveStatus}</p>}
                </div>
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
        </section>
      )}

      {activeStep === 2 && (
        <section className="glass panel p-6 md:p-8 space-y-5 reveal">
          <h2 className="font-serif text-2xl md:text-3xl text-ink">3. Config Editor</h2>
          <div className="flex flex-wrap gap-3">
            {[
              { id: "ruoli", label: "Ruoli" },
              { id: "reti", label: "Reti & CIG" },
              { id: "parsing", label: "Parsing" },
              { id: "periodo", label: "Periodo" },
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
                          onChange={(event) =>
                            setRoles((prev) =>
                              prev.map((item) =>
                                item.id === role.id ? { ...item, name: event.target.value } : item
                              )
                            )
                          }
                          placeholder="Nome ruolo"
                          className="px-4 py-2 rounded-xl border border-ink/10"
                        />
                        <select
                          value={role.demandType}
                          onChange={(event) =>
                            setRoles((prev) =>
                              prev.map((item) =>
                                item.id === role.id
                                  ? { ...item, demandType: event.target.value }
                                  : item
                              )
                            )
                          }
                          className="px-4 py-2 rounded-xl border border-ink/10"
                        >
                          {[
                            "PER_DAY",
                            "PER_WEEK",
                            "PER_NIGHT",
                            "PER_MONTH",
                            "FIXED_PER_RETE",
                          ].map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid md:grid-cols-3 gap-3">
                        <input
                          value={role.demandValue}
                          onChange={(event) =>
                            setRoles((prev) =>
                              prev.map((item) =>
                                item.id === role.id
                                  ? { ...item, demandValue: event.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder="Valore fabbisogno"
                          className="px-4 py-2 rounded-xl border border-ink/10"
                        />
                        <input
                          value={role.step}
                          onChange={(event) =>
                            setRoles((prev) =>
                              prev.map((item) =>
                                item.id === role.id ? { ...item, step: event.target.value } : item
                              )
                            )
                          }
                          placeholder="Step minimo"
                          className="px-4 py-2 rounded-xl border border-ink/10"
                        />
                        <select
                          value={role.rounding}
                          onChange={(event) =>
                            setRoles((prev) =>
                              prev.map((item) =>
                                item.id === role.id
                                  ? { ...item, rounding: event.target.value }
                                  : item
                              )
                            )
                          }
                          className="px-4 py-2 rounded-xl border border-ink/10"
                        >
                          {["CEIL", "FLOOR", "NEAREST"].map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid md:grid-cols-3 gap-3">
                        <input
                          value={role.chunk}
                          onChange={(event) =>
                            setRoles((prev) =>
                              prev.map((item) =>
                                item.id === role.id ? { ...item, chunk: event.target.value } : item
                              )
                            )
                          }
                          placeholder="Chunk allocazione"
                          className="px-4 py-2 rounded-xl border border-ink/10"
                        />
                        <input
                          value={role.lastStep}
                          onChange={(event) =>
                            setRoles((prev) =>
                              prev.map((item) =>
                                item.id === role.id
                                  ? { ...item, lastStep: event.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder="Step ultimo frammento"
                          className="px-4 py-2 rounded-xl border border-ink/10"
                        />
                        <label className="flex items-center gap-2 text-sm text-ink/70">
                          <input
                            type="checkbox"
                            checked={role.allowRemainder}
                            onChange={(event) =>
                              setRoles((prev) =>
                                prev.map((item) =>
                                  item.id === role.id
                                    ? { ...item, allowRemainder: event.target.checked }
                                    : item
                                )
                              )
                            }
                          />
                          Consenti ultimo spezzone
                        </label>
                      </div>
                      <div className="grid md:grid-cols-2 gap-3">
                        <select
                          value={role.costMode}
                          onChange={(event) =>
                            setRoles((prev) =>
                              prev.map((item) =>
                                item.id === role.id
                                  ? { ...item, costMode: event.target.value }
                                  : item
                              )
                            )
                          }
                          className="px-4 py-2 rounded-xl border border-ink/10"
                        >
                          {[
                            "FROM_PAYSLIP_DERIVED",
                            "FIXED_HOURLY",
                            "FIXED_TOTAL_MONTH",
                            "MANUAL_PER_PERSON",
                          ].map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <input
                          value={role.costValue}
                          onChange={(event) =>
                            setRoles((prev) =>
                              prev.map((item) =>
                                item.id === role.id
                                  ? { ...item, costValue: event.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder="Valore costo"
                          className="px-4 py-2 rounded-xl border border-ink/10"
                        />
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
                        onChange={(event) =>
                          setNetworks((prev) =>
                            prev.map((item) =>
                              item.id === network.id
                                ? { ...item, name: event.target.value }
                                : item
                            )
                          )
                        }
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
                          onChange={(event) =>
                            setCigs((prev) =>
                              prev.map((item) =>
                                item.id === cig.id
                                  ? { ...item, name: event.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder="Nome CIG"
                          className="w-full px-3 py-2 rounded-xl border border-ink/10"
                        />
                        <input
                          value={cig.networks.join(", ")}
                          onChange={(event) =>
                            setCigs((prev) =>
                              prev.map((item) =>
                                item.id === cig.id
                                  ? {
                                      ...item,
                                      networks: event.target.value
                                        .split(",")
                                        .map((value) => value.trim())
                                        .filter(Boolean),
                                    }
                                  : item
                              )
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
                {[
                  ["nameRegex", "Regex nomi"],
                  ["oreOrdinarieRegex", "Regex ore ordinarie"],
                  ["oreStraordinarieRegex", "Regex ore straordinarie"],
                  ["reperibilitaRegex", "Regex reperibilita"],
                  ["nettoRegex", "Regex netto"],
                  ["pignoramentoRegex", "Regex pignoramento"],
                ].map(([key, label]) => (
                  <input
                    key={key}
                    value={parsingConfig[key]}
                    onChange={(event) =>
                      setParsingConfig((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                    placeholder={label}
                    className="w-full px-4 py-2 rounded-xl border border-ink/10"
                  />
                ))}
              </div>
              <div className="space-y-3">
                <h3 className="font-semibold text-ink">Locale numeri</h3>
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
              </div>
            </div>
          )}

          {activeTab === "periodo" && (
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="font-semibold text-ink">Periodo</h3>
                <input
                  value={period.year}
                  onChange={(event) => setPeriod((prev) => ({ ...prev, year: event.target.value }))}
                  placeholder="Anno"
                  className="w-full px-4 py-2 rounded-xl border border-ink/10"
                />
                <input
                  value={period.month}
                  onChange={(event) => setPeriod((prev) => ({ ...prev, month: event.target.value }))}
                  placeholder="Mese"
                  className="w-full px-4 py-2 rounded-xl border border-ink/10"
                />
              </div>
              <div className="space-y-3">
                <h3 className="font-semibold text-ink">Moltiplicatori</h3>
                <input
                  value={period.days}
                  onChange={(event) => setPeriod((prev) => ({ ...prev, days: event.target.value }))}
                  placeholder="Giorni"
                  className="w-full px-4 py-2 rounded-xl border border-ink/10"
                />
                <input
                  value={period.weeks}
                  onChange={(event) => setPeriod((prev) => ({ ...prev, weeks: event.target.value }))}
                  placeholder="Settimane"
                  className="w-full px-4 py-2 rounded-xl border border-ink/10"
                />
                <input
                  value={period.nights}
                  onChange={(event) =>
                    setPeriod((prev) => ({ ...prev, nights: event.target.value }))
                  }
                  placeholder="Notti"
                  className="w-full px-4 py-2 rounded-xl border border-ink/10"
                />
              </div>
            </div>
          )}

          <div className="mt-6 grid md:grid-cols-[1.3fr_1fr] gap-4">
            <div className="p-4 rounded-2xl bg-white/70 space-y-3">
              <h3 className="font-semibold text-ink">Config JSON</h3>
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={consumeAllHours}
                  onChange={(event) => setConsumeAllHours(event.target.checked)}
                />
                Consuma tutte le ore disponibili
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  value={configName}
                  onChange={(event) => setConfigName(event.target.value)}
                  placeholder="Nome config"
                  className="flex-1 px-3 py-2 rounded-xl border border-ink/10"
                />
                <button
                  type="button"
                  className="px-4 py-2 rounded-full bg-ink text-white text-sm"
                  onClick={saveConfig}
                >
                  Salva
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-full bg-white/80 text-ink text-sm"
                  onClick={loadConfig}
                >
                  Carica
                </button>
              </div>
              {saveStatus && <p className="text-xs text-ink/60">{saveStatus}</p>}
            </div>
            <div className="p-4 rounded-2xl bg-white/70 text-sm text-ink/70">
              <p className="font-semibold text-ink">Nota</p>
              <p className="mt-2">
                La configurazione viene salvata in un file JSON locale per commessa. Puoi
                modificarla liberamente e ricaricarla quando serve.
              </p>
            </div>
          </div>

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
        </section>
      )}

      {activeStep === 3 && (
        <section className="glass panel p-6 md:p-8 space-y-5 reveal">
          <h2 className="font-serif text-2xl md:text-3xl text-ink">4. Allocazione</h2>
          <div className="p-4 rounded-2xl bg-white/70 text-sm text-ink/70">
            <p className="font-semibold text-ink">Regole core</p>
            <ul className="mt-2 space-y-1">
              <li>Mai inventare ore: usa solo dati estratti o manuali.</li>
              <li>Round-robin sulle reti piu scoperte.</li>
              <li>Chunk e frammenti finali secondo regole del ruolo.</li>
            </ul>
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
        </section>
      )}

      {activeStep === 4 && (
        <section className="glass panel p-6 md:p-8 space-y-5 reveal">
          <h2 className="font-serif text-2xl md:text-3xl text-ink">5. Preview & controlli</h2>
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
            <h3 className="font-semibold text-ink">Calcolo</h3>
            <p className="text-sm text-ink/70 mt-2">
              Avvia il calcolo per generare audit log, assegnazioni e controlli.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="px-5 py-2 rounded-full bg-ink text-white font-semibold"
                onClick={handleCompute}
              >
                Esegui calcolo
              </button>
              {computeStatus && <p className="text-sm text-ink/60">{computeStatus}</p>}
            </div>
            {computeResult && (
              <div className="mt-4 text-sm text-ink/70">
                <p>Allocazioni generate: {computeResult.allocations.length}</p>
                <p>Warning: {(computeResult.warnings || []).length}</p>
              </div>
            )}
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
        </section>
      )}

      {activeStep === 5 && (
        <section className="glass panel p-6 md:p-8 space-y-5 reveal">
          <h2 className="font-serif text-2xl md:text-3xl text-ink">6. Export</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h3 className="font-semibold text-ink">Template Excel dinamico</h3>
              <ul className="text-sm text-ink/70 space-y-2">
                <li>Foglio per ogni rete (RETE_*) e ogni CIG (CIG_*).</li>
                <li>Foglio Analisi_costi, Controlli e Audit_Log.</li>
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
                  <p className="mt-2 text-sm text-moss">Tutti i controlli OK. Export pronto.</p>
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
              {exportStatus && <p className="text-sm text-ink/70">{exportStatus}</p>}
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
        </section>
      )}
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
