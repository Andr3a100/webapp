from __future__ import annotations

import re
from typing import Dict, List

from .models import PersonInput

ALIASES = {
    "SALAZAR JOSVELINE": "SALAZAR JOSVELYN",
}

ROLE_KEYWORDS = {
    "DIRETTORE": "DIRETTORE",
    "OS": "OS",
    "OPERATORE SOCIALE": "OS",
    "MEDIATORE": "MEDIATORE",
    "OG": "OG",
    "OPERATORE GENERICO": "OG",
}


def normalize_name(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", name.strip())
    cleaned = cleaned.replace("'", "").replace("`", "")
    return cleaned.upper()


def apply_alias(name: str) -> str:
    normalized = normalize_name(name)
    return ALIASES.get(normalized, normalized)


def parse_float(value: str) -> float:
    if not value:
        return 0.0
    normalized = value.replace(".", "").replace(",", ".")
    try:
        return float(normalized)
    except ValueError:
        return 0.0


def parse_text_block(text: str) -> List[PersonInput]:
    blocks = re.split(r"BUSTA\s+PAGA\s*\d+", text, flags=re.IGNORECASE)
    people: List[PersonInput] = []

    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue

        name = ""
        ore_ord = ore_str = ore_rep = cost = 0.0
        roles: List[str] = []
        forfait_total = 0.0

        for line in lines:
            name_match = re.search(r"Nome\s*[:\-]\s*(.+)", line, flags=re.IGNORECASE)
            if name_match:
                name = apply_alias(name_match.group(1))
                continue

            if not name:
                possible_name = re.match(r"^[A-Z][A-Z\s'`.-]{3,}$", line)
                if possible_name:
                    name = apply_alias(possible_name.group(0))

            ore_ord_match = re.search(r"ore\s+ordinarie\s*[:\-]?\s*([\d.,]+)", line, flags=re.IGNORECASE)
            if ore_ord_match:
                ore_ord = parse_float(ore_ord_match.group(1))

            ore_str_match = re.search(r"ore\s+straordinarie\s*[:\-]?\s*([\d.,]+)", line, flags=re.IGNORECASE)
            if ore_str_match:
                ore_str = parse_float(ore_str_match.group(1))

            ore_rep_match = re.search(r"reperibilita\s*[:\-]?\s*([\d.,]+)", line, flags=re.IGNORECASE)
            if ore_rep_match:
                ore_rep = parse_float(ore_rep_match.group(1))

            cost_match = re.search(r"costo\s+orario\s*[:\-]?\s*([\d.,]+)", line, flags=re.IGNORECASE)
            if cost_match:
                cost = parse_float(cost_match.group(1))

            forfait_match = re.search(r"forfait\s*[:\-]?\s*([\d.,]+)", line, flags=re.IGNORECASE)
            if forfait_match:
                forfait_total = parse_float(forfait_match.group(1))

            for key, role in ROLE_KEYWORDS.items():
                if key in line.upper() and role not in roles:
                    roles.append(role)

        if not name:
            continue

        roles = apply_fixed_rules(name, roles)

        people.append(
            PersonInput(
                name=name,
                ore_ordinarie=ore_ord,
                ore_straordinarie=ore_str,
                ore_reperibilita=ore_rep,
                costo_orario=cost,
                roles=roles,
                forfait_total=forfait_total,
            )
        )

    return people


def apply_fixed_rules(name: str, roles: List[str]) -> List[str]:
    normalized = normalize_name(name)
    if normalized == "CLAUDIO ALI":
        return ["OG"]
    if normalized == "DOMENICA MOIO":
        return ["DIRETTORE"]
    return roles


def merge_people(people: List[PersonInput]) -> List[PersonInput]:
    merged: Dict[str, PersonInput] = {}
    for person in people:
        key = normalize_name(person.name)
        if key not in merged:
            merged[key] = person
            continue
        existing = merged[key]
        existing.ore_ordinarie += person.ore_ordinarie
        existing.ore_straordinarie += person.ore_straordinarie
        existing.ore_reperibilita += person.ore_reperibilita
        existing.costo_orario = max(existing.costo_orario, person.costo_orario)
        existing.roles = sorted(set(existing.roles + person.roles))
        existing.forfait_total = max(existing.forfait_total, person.forfait_total)
        merged[key] = existing
    return list(merged.values())
