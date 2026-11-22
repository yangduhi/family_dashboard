import json
import subprocess
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]


def test_supplies_schema_and_browser_consumer_contract():
    schema = json.loads((ROOT / "contracts/api/supplies.schema.json").read_text(encoding="utf-8"))
    fixture = json.loads((ROOT / "tests/fixtures/supplies-today.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    validator.validate(fixture)
    notice = {"date": "2026-11-20", "sourceDate": "2026-11-19", "kind": "PREPARATION",
              "status": "VERIFIED", "title": "여벌 옷", "detail": ""}
    validator.validate({**fixture, "weekPreparations": [notice]})
    for change in ({"date": None}, {"kind": "EVENT"}):
        assert not validator.is_valid({**fixture, "weekPreparations": [{**notice, **change}]})
    assert not validator.is_valid({**fixture, "state": "AUTH_REQUIRED", "complete": False})
    completed = subprocess.run(
        ["node", "--test", "tests/test_supplies.mjs"], cwd=ROOT,
        capture_output=True, encoding="utf-8", timeout=20,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
