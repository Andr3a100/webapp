from __future__ import annotations

from dataclasses import dataclass
from typing import List


@dataclass
class PersonInput:
    name: str
    ore_ordinarie: float
    ore_straordinarie: float
    ore_reperibilita: float
    costo_orario: float
    roles: List[str]
    forfait_total: float = 0.0


@dataclass
class AllocationRow:
    name: str
    network: str
    role: str
    hours: float
    cost_hour: float
    amount: float


@dataclass
class DemandSummary:
    role: str
    network: str
    demand: float
    allocated: float
    diff: float
    ok: bool
