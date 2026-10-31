"""Validate the work queue (docs/pr-cards/work-index.json) without any app infrastructure.

Checks: unique IDs; every batch in the reviewed list is present; acceptance units cannot silently disappear;
dependencies exist and have no cycles; an existing card file cites the drift protocol; a card marked ready has its
file; every card names an existing design; local links in changed Markdown files resolve.
Intentional scope changes update REQUIRED_BATCHES / REQUIRED_UNITS in the same reviewed PR.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = json.loads((ROOT / 'docs/pr-cards/work-index.json').read_text())
CARDS = DATA['cards']
BY_ID = {c['id']: c for c in CARDS}
errors = []

REQUIRED_BATCHES = ['A', 'B', 'C', 'D', 'E', 'V', 'N', 'F', 'M', 'O', 'P', 'W', 'U', 'R', 'X', 'CAP']
REQUIRED_UNITS = set("""
A-1 A-2 A-3 A-4 A-5 A-6 B-1 B-2 B-3 B-4 B-5 B-6 B-7 B-8 C-1 C-2
D-1 D-2 D-3 D-4 E-1 E-2 E-3 E-4 V-1 V-2 V-3 V-4 V-5 V-6 N-1 N-2 N-3 F-1 F-2 F-3 M-1 M-2 M-3 M-4
O-1 O-2 O-3 O-4 O-5 O-5b O-6 P-1 P-2 P-3 W-1 W-2 W-3 W-4 W-5 W-6 U-1 R-1 R-1W R-2 R-3 X-1 X-2
CAP-1 CAP-2 CAP-3 CAP-4 CAP-5
""".split())

if len(BY_ID) != len(CARDS):
    errors.append('duplicate card IDs')
if DATA.get('order') != REQUIRED_BATCHES:
    errors.append(f"batch order changed: {DATA.get('order')} (update REQUIRED_BATCHES deliberately)")
if {c['batch'] for c in CARDS} != set(REQUIRED_BATCHES):
    errors.append('batch coverage changed; reconcile acceptance explicitly')
units = {u for c in CARDS for u in c['units']}
if units != REQUIRED_UNITS:
    errors.append(f'acceptance units mismatch: missing={sorted(REQUIRED_UNITS - units)} unexpected={sorted(units - REQUIRED_UNITS)}')

seen, active = set(), set()
def visit(key):
    if key in active:
        errors.append(f'dependency cycle at {key}')
        return
    if key in seen:
        return
    active.add(key)
    for dep in BY_ID[key]['dependencies']:
        if dep not in BY_ID:
            errors.append(f'{key}: missing prerequisite {dep}')
        else:
            visit(dep)
    active.discard(key)
    seen.add(key)

for c in CARDS:
    visit(c['id'])
    if not (ROOT / c['design']).is_file():
        errors.append(f"{c['id']}: design file missing: {c['design']}")
    path = ROOT / c['card']
    if c['readiness'] != 'WRITE_CARD_AT_START' and not path.is_file():
        errors.append(f"{c['id']}: card file missing: {c['card']}")
    if path.is_file():
        text = path.read_text()
        if c['status'] not in ('MERGED',) and 'Drift check' not in text:
            errors.append(f"{c['id']}: card has no drift check section")
    if not c['units']:
        errors.append(f"{c['id']}: no acceptance units")

# Local links in changed Markdown files (archive snapshots excluded).
try:
    changed = subprocess.check_output(['git', 'diff', '--name-only', 'origin/main'], cwd=ROOT, text=True,
                                      stderr=subprocess.DEVNULL).splitlines()
except subprocess.CalledProcessError:
    changed = [str(p.relative_to(ROOT)) for p in ROOT.glob('docs/**/*.md')] + ['AGENTS.md']
for name in changed:
    p = ROOT / name
    if p.suffix != '.md' or not p.exists() or '/archive/' in name:
        continue
    for target in re.findall(r'\]\(([^)#:\s]+)(?:#[^)]*)?\)', p.read_text()):
        if not (p.parent / target).exists():
            errors.append(f'{name}: broken link {target}')

if errors:
    print('\n'.join(errors))
    sys.exit(1)
print(f"work-index OK: {len(CARDS)} cards, {len(REQUIRED_BATCHES)} batches")
