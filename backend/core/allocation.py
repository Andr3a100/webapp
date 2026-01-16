from __future__ import annotations

import calendar
from dataclasses import asdict
from typing import Dict, List, Tuple

from .models import AllocationRow, DemandSummary, PersonInput
from .parsing import normalize_name

ROLE_DEFAULTS = {
    "OG": {"type": "PER_DAY", "value": 12, "chunk": 7.5, "fallback": None},
    "MEDIATORE": {"type": "PER_WEEK", "value": 20, "chunk": 7.5, "fallback": "OG"},
    "OS": {"type": "PER_WEEK", "value": 28, "chunk": 7.5, "fallback": "OG"},
    "DIRETTORE": {"type": "PER_WEEK", "value": 8, "chunk": 8.0, "fallback": None},
    "MEDICO": {"type": "PER_DAY", "value": 3, "chunk": 8.0, "fallback": None},
    "REPERIBILITA": {"type": "PER_DAY", "value": 8, "chunk": 8.0, "fallback": None},
}

REPERIBILITA_COST = 1.5


def month_meta(year: int, month: int) -> Tuple[int, float]:
    days = calendar.monthrange(year, month)[1]
    weeks = days / 7.0
    return days, weeks


def round_up_step(value: float, step: float = 0.5) -> float:
    if step <= 0:
        return value
    return (int((value + step - 1e-9) / step)) * step


def compute_demands(networks: List[str], year: int, month: int) -> Dict[str, Dict[str, float]]:
    days, weeks = month_meta(year, month)
    demands: Dict[str, Dict[str, float]] = {}
    for role, cfg in ROLE_DEFAULTS.items():
        role_demands: Dict[str, float] = {}
        for network in networks:
            base = cfg["value"]
            if cfg["type"] == "PER_DAY":
                total = base * days
            elif cfg["type"] == "PER_WEEK":
                total = base * weeks
            else:
                total = base
            role_demands[network] = round_up_step(total, 0.5)
        demands[role] = role_demands
    return demands


def director_distribution(hours: float, networks: List[str]) -> Dict[str, float]:
    if not networks:
        return {}
    per = round_up_step(hours / len(networks), 0.5)
    distribution = {network: per for network in networks}
    return distribution


def allocate_hours(
    people: List[PersonInput],
    networks: List[str],
    year: int,
    month: int,
    consume_all: bool = True,
    medico_total: float = 0.0,
) -> Tuple[List[AllocationRow], List[DemandSummary]]:
    demands = compute_demands(networks, year, month)
    allocations: List[AllocationRow] = []

    for person in people:
        name = normalize_name(person.name)
        day_hours = person.ore_ordinarie + person.ore_straordinarie
        rep_hours = person.ore_reperibilita

        roles = list(person.roles)
        if name == "CLAUDIO ALI":
            roles = ["OG"]
        if name == "DOMENICA MOIO":
            roles = ["DIRETTORE"]

        if "DIRETTORE" in roles and day_hours > 0:
            distribution = director_distribution(day_hours, networks)
            for network, hours in distribution.items():
                allocations.append(
                    AllocationRow(
                        name=name,
                        network=network,
                        role="DIRETTORE",
                        hours=hours,
                        cost_hour=person.costo_orario,
                        amount=hours * person.costo_orario,
                    )
                )
                demands["DIRETTORE"][network] = max(
                    0.0, demands["DIRETTORE"][network] - hours
                )
            day_hours = 0.0

        for role in prioritize_roles(roles):
            if role == "DIRETTORE":
                continue
            day_hours = allocate_role(
                name,
                role,
                day_hours,
                person.costo_orario,
                networks,
                demands,
                allocations,
                consume_all,
            )

        if rep_hours > 0:
            rep_hours = allocate_reperibilita(
                name,
                rep_hours,
                networks,
                demands,
                allocations,
                consume_all,
            )

    total_rep_demand = sum(demands["REPERIBILITA"].values())
    if total_rep_demand > 0:
        fallback_name = "ALESSANDRO RICHARD"
        missing = total_rep_demand
        allocate_reperibilita(
            fallback_name,
            missing,
            networks,
            demands,
            allocations,
            True,
        )

    if "MEDICO" in demands:
        total_medico_hours = sum(demands["MEDICO"].values())
        cost_hour = (medico_total / total_medico_hours) if total_medico_hours else 0.0
        for network, hours in demands["MEDICO"].items():
            allocations.append(
                AllocationRow(
                    name="DOTT. ENRICO CHIARA",
                    network=network,
                    role="MEDICO",
                    hours=hours,
                    cost_hour=cost_hour,
                    amount=hours * cost_hour,
                )
            )
            demands["MEDICO"][network] = 0.0

    summary: List[DemandSummary] = []
    for role, role_demands in demands.items():
        for network, remaining in role_demands.items():
            allocated = compute_allocated(allocations, role, network)
            demand = compute_demands(networks, year, month)[role][network]
            diff = allocated - demand
            summary.append(
                DemandSummary(
                    role=role,
                    network=network,
                    demand=demand,
                    allocated=allocated,
                    diff=diff,
                    ok=abs(diff) < 0.01,
                )
            )
    return allocations, summary


def prioritize_roles(roles: List[str]) -> List[str]:
    ordered: List[str] = []
    if "DIRETTORE" in roles:
        ordered.append("DIRETTORE")
    if "MEDIATORE" in roles:
        ordered.append("MEDIATORE")
        if "OG" in roles:
            ordered.append("OG")
    if "OS" in roles:
        ordered.append("OS")
        if "OG" in roles and "OG" not in ordered:
            ordered.append("OG")
    if "OG" in roles and "OG" not in ordered:
        ordered.append("OG")
    for role in roles:
        if role not in ordered:
            ordered.append(role)
    return ordered


def allocate_role(
    name: str,
    role: str,
    hours: float,
    cost_hour: float,
    networks: List[str],
    demands: Dict[str, Dict[str, float]],
    allocations: List[AllocationRow],
    consume_all: bool,
) -> float:
    if hours <= 0 or role not in demands:
        return hours

    chunk = ROLE_DEFAULTS.get(role, {}).get("chunk", 7.5)
    network_idx = 0

    while hours > 0:
        network = pick_network(demands[role], networks, network_idx, consume_all)
        if not network:
            break
        remaining_demand = demands[role][network]
        if remaining_demand <= 0 and not consume_all:
            break
        assign = min(chunk, hours)
        if assign < chunk:
            assign = round_up_step(assign, 0.5)
        allocations.append(
            AllocationRow(
                name=name,
                network=network,
                role=role,
                hours=assign,
                cost_hour=cost_hour,
                amount=assign * cost_hour,
            )
        )
        demands[role][network] = max(0.0, demands[role][network] - assign)
        hours -= assign
        network_idx += 1
    return hours


def allocate_reperibilita(
    name: str,
    hours: float,
    networks: List[str],
    demands: Dict[str, Dict[str, float]],
    allocations: List[AllocationRow],
    consume_all: bool,
) -> float:
    role = "REPERIBILITA"
    chunk = ROLE_DEFAULTS[role]["chunk"]
    network_idx = 0

    while hours > 0:
        network = pick_network(demands[role], networks, network_idx, consume_all)
        if not network:
            break
        remaining_demand = demands[role][network]
        if remaining_demand <= 0 and not consume_all:
            break
        assign = min(chunk, hours)
        if assign < chunk:
            assign = round_up_step(assign, 0.5)
        allocations.append(
            AllocationRow(
                name=name,
                network=network,
                role=role,
                hours=assign,
                cost_hour=REPERIBILITA_COST,
                amount=assign * REPERIBILITA_COST,
            )
        )
        demands[role][network] = max(0.0, demands[role][network] - assign)
        hours -= assign
        network_idx += 1
    return hours


def pick_network(
    demand_map: Dict[str, float],
    networks: List[str],
    start_idx: int,
    consume_all: bool,
) -> str | None:
    if not networks:
        return None
    if consume_all:
        ordered = networks[start_idx % len(networks) :] + networks[: start_idx % len(networks)]
        return ordered[0]
    return max(demand_map, key=demand_map.get)


def compute_allocated(allocations: List[AllocationRow], role: str, network: str) -> float:
    return sum(row.hours for row in allocations if row.role == role and row.network == network)


def allocations_to_dicts(rows: List[AllocationRow]) -> List[dict]:
    return [asdict(row) for row in rows]


def summary_to_dicts(rows: List[DemandSummary]) -> List[dict]:
    return [asdict(row) for row in rows]
