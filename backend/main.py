from __future__ import annotations

import io
import json
import re
import tempfile
import uuid
from enum import Enum
from pathlib import Path
import pdfplumber
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openpyxl import Workbook

app = FastAPI(title="Prospetti Ore & Costi API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class OcrMode(str, Enum):
    text = "text"
    fallback = "fallback"
    forced = "forced"


class ParsingConfig(BaseModel):
    ore_ordinarie_regex: str = ""
    ore_straordinarie_regex: str = ""
    reperibilita_regex: str = ""
    netto_regex: str = ""
    pignoramento_regex: str = ""
    decimal_separator: str = ","
    thousands_separator: str = "."


class ExtractedRow(BaseModel):
    id: str
    name: str
    role: str
    ore_ordinarie: str
    ore_straordinarie: str
    reperibilita: str
    netto: str
    pagina: int | None
    metodo: str
    confidenza: float
    rischio: str = ""


class ExtractionLog(BaseModel):
    id: str
    page: int | None
    value: str
    field: str
    rule: str
    method: str
    confidence: float


class ExtractionResponse(BaseModel):
    extracted_rows: list[ExtractedRow]
    log: list[ExtractionLog]
    warnings: list[str]


class ExcelNaming(BaseModel):
    prefix: str = ""
    suffix: str = ""


class CigConfig(BaseModel):
    name: str
    networks: list[str]


class ExportRow(BaseModel):
    name: str
    role: str
    ore_ordinarie: str
    ore_straordinarie: str
    reperibilita: str
    netto: str


class ExportRequest(BaseModel):
    rows: list[ExportRow]
    networks: list[str]
    cigs: list[CigConfig]
    excel_naming: ExcelNaming


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/extract", response_model=ExtractionResponse)
async def extract_data(
    files: list[UploadFile] = File(...),
    ocr_mode: OcrMode = Form(...),
    parsing_config: str | None = Form(None),
) -> ExtractionResponse:
    parsed_config = ParsingConfig()
    if parsing_config:
        try:
            parsed_config = ParsingConfig(**json.loads(parsing_config))
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid parsing_config JSON") from exc

    extracted_rows: list[ExtractedRow] = []
    log_entries: list[ExtractionLog] = []
    warnings: list[str] = []

    for file in files:
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            warnings.append(f"File ignorato (non PDF): {file.filename}")
            continue

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir) / f"{uuid.uuid4()}.pdf"
            temp_path.write_bytes(await file.read())
            file_rows, file_logs, file_warnings = parse_pdf(
                temp_path,
                file.filename,
                ocr_mode,
                parsed_config,
            )
            extracted_rows.extend(file_rows)
            log_entries.extend(file_logs)
            warnings.extend(file_warnings)

    return ExtractionResponse(extracted_rows=extracted_rows, log=log_entries, warnings=warnings)


@app.post("/api/export")
async def export_excel(payload: ExportRequest) -> StreamingResponse:
    if not payload.rows:
        raise HTTPException(status_code=400, detail="Nessuna riga da esportare")
    if not payload.networks or not payload.cigs:
        raise HTTPException(status_code=400, detail="Reti e CIG sono obbligatori")

    workbook = Workbook()
    workbook.remove(workbook.active)

    def sheet_name(base: str) -> str:
        return f"{payload.excel_naming.prefix}{base}{payload.excel_naming.suffix}"[:31]

    headers = [
        "Nominativo",
        "Ruolo",
        "Ore ordinarie",
        "Ore straordinarie",
        "Reperibilita",
        "Netto",
    ]

    def add_summary_rows(ws):
        ws.append([])
        ws.append(["Fabbisogno", "", "", "", "", ""])
        ws.append(["Assegnato", "", "", "", "", ""])
        ws.append(["Diff", "", "", "", "", ""])
        ws.append(["Controllo", "OK/KO", "", "", "", ""])

    for network in payload.networks:
        ws = workbook.create_sheet(title=sheet_name(network))
        ws.append(headers)
        for row in payload.rows:
            ws.append(
                [
                    row.name,
                    row.role,
                    row.ore_ordinarie,
                    row.ore_straordinarie,
                    row.reperibilita,
                    row.netto,
                ]
            )
        add_summary_rows(ws)

    for cig in payload.cigs:
        ws = workbook.create_sheet(title=sheet_name(cig.name))
        ws.append(headers)
        for row in payload.rows:
            ws.append(
                [
                    row.name,
                    row.role,
                    row.ore_ordinarie,
                    row.ore_straordinarie,
                    row.reperibilita,
                    row.netto,
                ]
            )
        add_summary_rows(ws)

    ws_costi = workbook.create_sheet(title=sheet_name("Analisi_costi"))
    ws_costi.append(["Nominativo", "Costo totale", "Note"])

    ws_controlli = workbook.create_sheet(title=sheet_name("Controlli"))
    ws_controlli.append(["Check", "Esito", "Note"])

    output = io.BytesIO()
    workbook.save(output)
    output.seek(0)

    filename = "prospetti-ore-costi.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def parse_pdf(
    path: Path,
    original_name: str,
    ocr_mode: OcrMode,
    config: ParsingConfig,
) -> tuple[list[ExtractedRow], list[ExtractionLog], list[str]]:
    extracted_rows: list[ExtractedRow] = []
    log_entries: list[ExtractionLog] = []
    warnings: list[str] = []

    with pdfplumber.open(path) as pdf:
        page_texts: list[str] = []
        for page in pdf.pages:
            text = page.extract_text() or ""
            page_texts.append(text)

    has_text = any(text.strip() for text in page_texts)

    if not has_text and ocr_mode == OcrMode.text:
        warnings.append(
            f"{original_name}: PDF senza testo, OCR disattivato (nessuna estrazione)."
        )
        return extracted_rows, log_entries, warnings

    ocr_used_pages = set()
    if ocr_mode in {OcrMode.fallback, OcrMode.forced}:
        for idx, text in enumerate(page_texts):
            if ocr_mode == OcrMode.forced or not text.strip():
                page_texts[idx] = ""
                ocr_used_pages.add(idx + 1)

    combined_text = "\n".join(page_texts)

    def find_value(regex: str, field: str) -> tuple[str, int | None]:
        if not regex:
            return "", None
        try:
            pattern = re.compile(regex)
        except re.error:
            warnings.append(f"Regex non valida per {field}: {regex}")
            return "", None

        for idx, page_text in enumerate(page_texts):
            match = pattern.search(page_text)
            if match:
                return match.group(1), idx + 1

        match = pattern.search(combined_text)
        if match:
            return match.group(1), None
        return "", None

    extracted = {
        "ore_ordinarie": find_value(config.ore_ordinarie_regex, "ore ordinarie"),
        "ore_straordinarie": find_value(config.ore_straordinarie_regex, "ore straordinarie"),
        "reperibilita": find_value(config.reperibilita_regex, "reperibilita"),
        "netto": find_value(config.netto_regex, "netto"),
    }

    confidenza = 0.9 if has_text else 0.6
    if ocr_used_pages:
        confidenza = 0.65

    risk = detect_risk(extracted, confidenza)

    extracted_rows.append(
        ExtractedRow(
            id=str(uuid.uuid4()),
            name="Nominativo da completare",
            role="Ruolo da completare",
            ore_ordinarie=extracted["ore_ordinarie"][0],
            ore_straordinarie=extracted["ore_straordinarie"][0],
            reperibilita=extracted["reperibilita"][0],
            netto=extracted["netto"][0],
            pagina=extracted["ore_ordinarie"][1],
            metodo="pdfplumber" if has_text else "ocr",
            confidenza=confidenza,
            rischio=risk,
        )
    )

    for field, (value, page) in extracted.items():
        if not value:
            continue
        log_entries.append(
            ExtractionLog(
                id=str(uuid.uuid4()),
                page=page,
                value=value,
                field=field,
                rule="regex",
                method="pdfplumber" if has_text else "ocr",
                confidence=confidenza,
            )
        )

    if ocr_used_pages:
        warnings.append(
            f"OCR richiesto per {original_name}: pagine {sorted(ocr_used_pages)}."
        )

    return extracted_rows, log_entries, warnings


def detect_risk(extracted: dict[str, tuple[str, int | None]], confidenza: float) -> str:
    values = [value for value, _ in extracted.values() if value]
    if any("," in value and "." in value for value in values):
        return "Separatore ambiguo"

    def parse_number(value: str) -> float | None:
        if not value:
            return None
        normalized = value.replace(".", "").replace(",", ".")
        try:
            return float(normalized)
        except ValueError:
            return None

    for key in ("ore_ordinarie", "ore_straordinarie", "reperibilita"):
        num = parse_number(extracted[key][0])
        if num is not None and not (0 <= num <= 320):
            return "Fuori range"

    if confidenza < 0.75:
        return "Confidenza bassa"

    return ""


if __name__ == "__main__":
    try:
        import uvicorn
    except ImportError:
        raise SystemExit(
            "Uvicorn non installato. Installa con: pip install -r requirements.txt"
        )
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
