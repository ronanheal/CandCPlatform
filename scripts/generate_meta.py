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
    "work_in_progress": existing_meta.get("work_in_progress", []),
}
meta_path.write_text(json.dumps(platform_meta, indent=2, ensure_ascii=False))
print(f"platform_meta.json: version {app_version}")

# ── Roadmap ───────────────────────────────────────────────────────────────────
roadmap_src = Path("ROADMAP.md").read_text(encoding="utf-8") if Path("ROADMAP.md").exists() else ""

roadmap_items = []
if roadmap_src:
    current_category = ""
    category_order = {"Quick Wins": 1, "Medium": 2, "Large": 3}
    for line in roadmap_src.splitlines():
        # Category headers like "### Quick Wins (1–2 days each)"
        cat_match = re.match(r"^###\s+(Quick Wins|Medium|Large)", line)
        if cat_match:
            current_category = cat_match.group(1)
            continue
        # Items like "**1. Quote value and real status from ST**" or "**0a. Dashboard...**"
        item_match = re.match(r"^\*\*(\w+)\.\s+(.+?)\*\*$", line)
        if item_match and current_category:
            num = item_match.group(1)
            title = item_match.group(2)
            roadmap_items.append({
                "id": num,
                "title": title,
                "category": current_category,
                "sort": category_order.get(current_category, 9),
                "status": "planned",
            })

# Status comes from where an id is actually mentioned in the doc, not word-overlap guessing
# (a prior version marked "Time approval workflow" and "ST write-back" done purely on keyword
# overlap with changelog text, when both are explicitly blocked/deferred with zero real
# implementation). An id can appear three ways: "| ID | ..." as a table's first cell, or
# "(#9 / ID)" inline — collect every section's ids separately, blocked taking precedence over
# done, and fall back to the keyword heuristic only for ids never explicitly mentioned again
# anywhere (last resort, since most of the doc's ids appear explicitly once shipped/blocked).
def _section_ids(src, heading_pattern):
    """Ids appearing under headings matching heading_pattern, until the next ##/### heading."""
    ids = set()
    active = False
    for line in src.splitlines():
        if re.match(heading_pattern, line):
            active = True
            continue
        if re.match(r"^#{2,3}\s", line):
            active = False
            continue
        if active:
            ids.update(_row_ids(line))
    return ids

# A table row's first cell holds the id in one of several formats this doc actually uses:
# "QW8", "M6 / #13", "L3 / #17", or a bare "#17" with no letter-prefixed id at all. Capture
# the letter-prefixed id when present (that's what the machine-readable index keys on);
# a bare "#N" with no letter id contributes nothing and relies on the fuzzy fallback instead.
def _row_ids(line):
    ids = set()
    ids.update(re.findall(r"\(#\d+\s*/\s*(\w+)\)", line))
    m = re.match(r"^\|\s*([^|]+?)\s*\|", line)
    if m:
        ids.update(re.findall(r"\b(?:[A-Za-z]+\d+|0[a-g])\b", m.group(1)))
    return ids

blocked_ids = _section_ids(roadmap_src, r"^###\s+(Blocked|Deferred)\b")
# Every id mentioned anywhere outside the machine-readable index and the blocked/deferred
# sections counts as done — the doc only references an id again once it's shipped (in a
# "Features shipped"/"Shipped (vX)" table row) or blocked (handled above).
done_ids = set()
in_index_section = False
in_blocked_section = False
for line in roadmap_src.splitlines():
    if re.match(r"^##\s+Machine-readable index", line):
        in_index_section = True
        continue
    if re.match(r"^###\s+(Blocked|Deferred)\b", line):
        in_blocked_section = True
        continue
    if re.match(r"^#{2,3}\s", line):
        in_blocked_section = False
        continue
    if in_index_section or in_blocked_section:
        continue
    done_ids.update(_row_ids(line))
done_ids -= blocked_ids

# Fuzzy keyword fallback — only for ids with no explicit mention anywhere in the doc.
# Strip surrounding punctuation before comparing, otherwise a trailing period/comma in
# changelog prose (e.g. "...pipeline funnel.") never matches the bare title word
# ("funnel") and a genuinely-shipped item can get stuck on "planned" forever.
def _clean_words(text):
    return [w for w in re.sub(r"[^\w\s-]", "", text.lower()).split() if len(w) > 4]

done_keywords = set()
for rel in releases:
    for item in rel["items"]:
        done_keywords.update(_clean_words(item))

for r in roadmap_items:
    if r["id"] in blocked_ids:
        r["status"] = "blocked"
    elif r["id"] in done_ids:
        r["status"] = "done"
    else:
        words = _clean_words(r["title"])
        if words and sum(1 for w in words if w in done_keywords) >= 2:
            r["status"] = "done"

roadmap_path = OUT_DIR / "roadmap.json"
roadmap_path.write_text(json.dumps(roadmap_items, indent=2, ensure_ascii=False))
print(f"roadmap.json: {len(roadmap_items)} items")
