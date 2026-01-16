from core.allocation import compute_demands, round_up_step
from core.parsing import merge_people, parse_text_block


def test_rounding_step():
    assert round_up_step(1.01, 0.5) == 1.5
    assert round_up_step(7.5, 0.5) == 7.5


def test_compute_demands_month():
    demands = compute_demands(["RETE1"], 2025, 12)
    assert demands["OG"]["RETE1"] > 0


def test_dedup_people():
    text = """
    BUSTA PAGA 1
    Nome: Salazar Josveline
    Ore ordinarie: 10
    BUSTA PAGA 2
    Nome: SALAZAR JOSVELYN
    Ore ordinarie: 5
    """
    people = merge_people(parse_text_block(text))
    assert len(people) == 1
    assert people[0].ore_ordinarie == 15
