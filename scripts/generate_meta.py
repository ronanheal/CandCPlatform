#!/usr/bin/env python3
"""
Generates changelog.json, platform_meta.json, and work_in_progress.json
from index.html for the Google Sheet auto-sync.
Run automatically as part of the GitHub Actions push workflow.
"""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

OUT_DIR = Path("streamtime-data")
OUT_DIR.mkdir(exist_ok=True)

src = Path("index.html").read_text(encoding="utf-8")

# ── Extract APP_VERSION ───────────────────────────────────────────────────
version_match = re.search(r"const APP_VERSION='([^']+)'", src)
app_version = version_match.group(1) if version_match else "unknown"

# ── Extract CHANGELOG array ───────────────────────────────────────────────
# Find the raw JS between CHANGELOG=[ and the matching ];
cl_start = src.find("const CHANGELOG=[")
cl_end   = src.find("];", cl_start) + 2
cl_raw   = src[cl_start:cl_end]

# Parse each release object: {version:'x', date:'y', title:'z', items:[...]}
releases = []
for m in re.finditer(
    r"\{version:'([^']+)',date:'([^']+)',title:'([^']+)',items:\[(.*?)\]\}",
    cl_raw, re.DOTALL
):
    ver, date, title, items_raw = m.groups()
    items = re.findall(r"'((?:[^'\\]|\\.)*)'", items_raw)
    # Infer sections from item text
    sections = set()
    section_keywords = {
        "Todo": ["todo","task","card","done","drag","divid","zone","bucket","week"],
        "Jobs": ["job","phase","item","budget","plan","label","paused","archive"],
        "Dashboard": ["dashboard","kpi","greeting","alert","deadline"],
        "Reporting": ["report","chart","csv","billable"],
        "Boards": ["board","kanban","column"],
        "Settings": ["settings","team","person","config","publish","sync"],
        "Jobs → Invoices": ["invoice"],
        "Jobs → Quotes": ["quote"],
        "Jobs → Clients": ["client","company","website"],
        "Jobs → Time": ["time","logged","minutes","approval"],
        "Data": ["streamtime","st data","api","sync","json"],
    }
    for item in items:
        il = item.lower()
        for sec, kws in section_keywords.items():
            if any(kw in il for kw in kws):
                sections.add(sec)
    releases.append({
        "version": ver,
        "date": date,
        "title": title,
        "items": items,
        "sections": sorted(sections),
    })

changelog = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "current_version": app_version,
    "releases": releases,
}
(OUT_DIR / "changelog.json").write_text(json.dumps(changelog, indent=2, ensure_ascii=False))
print(f"changelog.json: {len(releases)} releases, current version {app_version}")

# ── Platform meta ─────────────────────────────────────────────────────────
meta_path = OUT_DIR / "platform_meta.json"
existing_meta = {}
if meta_path.exists():
    try:
        existing_meta = json.loads(meta_path.read_text())
    except Exception:
        pass

platform_meta = {
    "version": app_version,
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "vercel_url": "https://cand-c-platform.vercel.app",
    "repo": "ronanheal/CandCPlatform",
    "data_branch": "streamtime-data",
    # Preserve work_in_progress from previous meta if not overridden
    "work_in_progress": existing_meta.get("work_in_progress", []),
}
meta_path.write_text(json.dumps(platform_meta, indent=2, ensure_ascii=False))
print(f"platform_meta.json: version {app_version}")
