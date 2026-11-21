import copy
import json
from pathlib import Path
import re
import subprocess

from jsonschema import Draft202012Validator, FormatChecker

from app.server import default_dashboard_state, validate_dashboard_state


ROOT = Path(__file__).resolve().parents[1]


def test_generic_defaults_preserve_custom_names_and_private_stager_compatibility():
    app = (ROOT / "web/app.js").read_text(encoding="utf-8")
    html = (ROOT / "web/index.html").read_text(encoding="utf-8")
    default = re.search(r'const DEFAULT_CHILD_NAME = "([^"\r\n]+)";', app)
    assert default and default[1] == "친구야"
    assert re.search(r'\[([^\]\r\n]+)\]\.includes\(childName\) \? DEFAULT_CHILD_NAME', app)
    assert "친구야" in html
    assert default_dashboard_state()["childName"] == "친구야"
    assert validate_dashboard_state({"childName": "사용자 호칭"})["childName"] == "사용자 호칭"
    script = f"""
      import assert from 'node:assert/strict';
      import {{createDefaultState, normalizeDailyState}} from {json.dumps((ROOT / 'web/app.js').as_uri())};
      const day = '2026-11-21';
      assert.equal(createDefaultState(day).childName, '친구야');
      const custom = normalizeDailyState({{...createDefaultState(day), childName:'사용자 호칭'}}, day);
      assert.equal(custom.childName, '사용자 호칭');
    """
    run = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, timeout=20)
    assert run.returncode == 0


def test_integrated_release_graph_and_pages_bundle_stamping_are_consistent():
    web = ROOT / "web"
    html = (web / "index.html").read_text(encoding="utf-8")
    sw = (web / "sw.js").read_text(encoding="utf-8")
    release = re.search(r'name="family-dashboard-release" content="([a-z0-9-]+)"', html)[1]
    assert f'const CACHE_VERSION = "{release}";' in sw
    for name in ("index.html", "app.js", "styles.css", "stamp-audio.js"):
        versions = re.findall(r"[?&]release=([a-z0-9-]+)", (web / name).read_text(encoding="utf-8"))
        assert all(version == release for version in versions)
    for asset in re.findall(r'^  "\./([^"?]+)",$', sw, re.MULTILINE):
        assert (web / asset).is_file(), asset
    workflow = (ROOT / ".github/workflows/deploy-pages.yml").read_text(encoding="utf-8")
    assert 'path: "_site"' in workflow
    assert 'text.replace(f"?release={template}", f"?release={release}")' in workflow
    assert '"tests/**"' in workflow and '"contracts/**"' in workflow
    for source in (web / "app.js", web / "styles.css", web / "index.html", web / "sw.js"):
        assert not re.search(r"^(<<<<<<< |=======\s*$|>>>>>>> )", source.read_text(encoding="utf-8"), re.MULTILINE)


def test_canonical_public_response_variants_and_private_fields_are_bounded():
    schema = json.loads((ROOT / "contracts/api/supplies.schema.json").read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    ready = json.loads((ROOT / "tests/fixtures/supplies-today.json").read_text(encoding="utf-8"))
    validator.validate(ready)
    for state in ("EMPTY", "NEEDS_REVIEW", "AUTH_REQUIRED", "PENDING"):
        data = {**ready, "state": state, "items": [], "complete": state == "EMPTY"}
        if state != "EMPTY":
            data.update(checkedAt=None, publishedAt=None)
        validator.validate(data)
    data = {**ready, "state": "NEEDS_REVIEW", "items": [], "complete": False,
            "guardianConfirmation": {"source": "GUARDIAN", "sourceDate": ready["targetDate"]},
            "dailyAssessment": {"blockers": ["DAILY_CHECK_FAILED"], "documentIssues": {
                "unread": 0, "detailUnverified": 1, "attachmentUnverified": 0, "instructionsUnverified": 0}},
            "bulletins": [{"kind": "INFORMATION", "status": "REVIEW_REQUIRED", "date": None,
                           "title": "합성 안내", "detail": "", "sourceDate": ready["targetDate"]}]}
    validator.validate(data)
    for invalid in (
        {key: value for key, value in ready.items() if key != "evaluatedAt"},
        {**ready, "rawBody": "unsupported"},
        {**data, "guardianConfirmation": {"source": "OTHER", "sourceDate": ready["targetDate"]}},
        {**data, "dailyAssessment": {"blockers": ["UNKNOWN_CODE"], "documentIssues": data["dailyAssessment"]["documentIssues"]}},
    ):
        assert not validator.is_valid(invalid)
    invalid = copy.deepcopy(ready)
    invalid["items"][0]["originalUrl"] = "unsupported"
    assert not validator.is_valid(invalid)
