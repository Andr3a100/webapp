from __future__ import annotations

from pathlib import Path
from typing import List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from core.allocation import allocate_hours, allocations_to_dicts, summary_to_dicts
from core.excel_export import build_export_zip
from core.models import PersonInput
from core.parsing import apply_alias, merge_people, parse_text_block

BASE_DIR = Path(__file__).parent
STORAGE_DIR = BASE_DIR / "storage"
TEMPLATE_DIR = STORAGE_DIR / "templates"

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="CAS Prospetti API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ParseTextRequest(BaseModel):
    text: str


class PersonPayload(BaseModel):
    name: str
    ore_ordinarie: float = 0.0
    ore_straordinarie: float = 0.0
    ore_reperibilita: float = 0.0
    costo_orario: float = 0.0
    roles: List[str] = Field(default_factory=list)
    forfait_total: float = 0.0


class ComputeRequest(BaseModel):
    year: int
    month: int
    people: List[PersonPayload]
    consume_all_hours: bool = True
    medico_total: float = 0.0


class ComputeResponse(BaseModel):
    consuntivo: List[dict]
    pivot: List[dict]
    check: List[dict]


@app.post("/parse-text")
async def parse_text(payload: ParseTextRequest) -> JSONResponse:
    people = merge_people(parse_text_block(payload.text))
    return JSONResponse(content={"people": [person.__dict__ for person in people]})


@app.post("/compute", response_model=ComputeResponse)
async def compute(payload: ComputeRequest) -> ComputeResponse:
    if payload.year < 2000 or payload.year > 2100:
        raise HTTPException(status_code=400, detail="Invalid year")
    if payload.month < 1 or payload.month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    validate_people(payload.people)

    people = []
    for person in payload.people:
        name = apply_alias(person.name)
        if not name:
            continue
        people.append(
            PersonInput(
                name=name,
                ore_ordinarie=person.ore_ordinarie,
                ore_straordinarie=person.ore_straordinarie,
                ore_reperibilita=person.ore_reperibilita,
                costo_orario=person.costo_orario,
                roles=person.roles,
                forfait_total=person.forfait_total,
            )
        )

    allocations, summary = allocate_hours(
        people=people,
        networks=["RETE1", "RETE2", "RETE3", "RETE4", "RETE5"],
        year=payload.year,
        month=payload.month,
        consume_all=payload.consume_all_hours,
        medico_total=payload.medico_total,
    )

    consuntivo = allocations_to_dicts(allocations)
    pivot = build_pivot(consuntivo)
    check = summary_to_dicts(summary)
    return ComputeResponse(consuntivo=consuntivo, pivot=pivot, check=check)


@app.post("/upload-template")
async def upload_template(template: UploadFile = File(...)) -> JSONResponse:
    if not template.filename or not template.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Template must be .xlsx")
    target = TEMPLATE_DIR / "template.xlsx"
    target.write_bytes(await template.read())
    return JSONResponse(content={"status": "ok", "path": str(target)})


@app.post("/export")
async def export_zip(payload: ComputeRequest) -> StreamingResponse:
    validate_people(payload.people)
    people = []
    for person in payload.people:
        name = apply_alias(person.name)
        if not name:
            continue
        people.append(
            PersonInput(
                name=name,
                ore_ordinarie=person.ore_ordinarie,
                ore_straordinarie=person.ore_straordinarie,
                ore_reperibilita=person.ore_reperibilita,
                costo_orario=person.costo_orario,
                roles=person.roles,
                forfait_total=person.forfait_total,
            )
        )

    allocations, _summary = allocate_hours(
        people=people,
        networks=["RETE1", "RETE2", "RETE3", "RETE4", "RETE5"],
        year=payload.year,
        month=payload.month,
        consume_all=payload.consume_all_hours,
        medico_total=payload.medico_total,
    )

    template_path = TEMPLATE_DIR / "template.xlsx"
    if not template_path.exists():
        raise HTTPException(status_code=400, detail="Template missing. Upload first.")
    archive = build_export_zip(allocations, payload.year, payload.month, template_path)

    filename = f"CAS_EXPORT_{payload.year}_{payload.month:02d}.zip"
    return StreamingResponse(
        iter([archive]),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def build_pivot(consuntivo: List[dict]) -> List[dict]:
    pivot: dict[tuple[str, str], float] = {}
    for row in consuntivo:
        key = (row["Rete"], row["Ruolo"]) if "Rete" in row else (row["network"], row["role"])
        hours = row.get("Ore") or row.get("hours") or 0
        pivot[key] = pivot.get(key, 0) + hours

    output = []
    for (network, role), hours in pivot.items():
        output.append({"network": network, "role": role, "hours": hours})
    return output


def validate_people(people: List[PersonPayload]) -> None:
    for person in people:
        values = [
            person.ore_ordinarie,
            person.ore_straordinarie,
            person.ore_reperibilita,
            person.costo_orario,
            person.forfait_total,
        ]
        for value in values:
            if value < 0 or value != value:
                raise HTTPException(status_code=400, detail="Invalid numeric values")


if __name__ == "__main__":
    try:
        import uvicorn
    except ImportError:
        raise SystemExit("Uvicorn not installed. Run: pip install -r requirements.txt")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
