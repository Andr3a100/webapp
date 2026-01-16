# CAS Prospetti WebApp

Webapp per generare prospetti mensili ore/costi per commessa CAS su 5 reti (RETE1-RETE5), con parsing testo, calcolo fabbisogni e export Excel.

## Stack

- Backend: FastAPI
- Frontend: React + Tailwind (via CDN)
- Export: openpyxl + pandas
- OCR: OCRmyPDF + Tesseract (Docker)
- Persistenza: file su disco (storage)

## Avvio locale (senza Docker)

Backend:

```
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Frontend:

```
python3 -m http.server 8080
```

Apri `http://localhost:8080`.

## Avvio con Docker

```
docker-compose up --build
```

- Frontend: http://localhost:8080
- Backend: http://localhost:8000

## Test

```
cd backend
pytest
```

## API

- `POST /parse-text` -> parsing testo incollato
- `POST /compute` -> calcolo consuntivo, pivot, check fabbisogno
- `POST /upload-template` -> upload template Excel (.xlsx)
- `POST /export` -> zip con 2 Excel

## Note

- Il template Excel viene salvato in `backend/storage/templates/template.xlsx`.
- I dati restano su disco, pronti per migrazione a DB.
