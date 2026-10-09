"""Runs every test_*.py in this folder against the running app (http://localhost:5173) and sums up."""
import glob, os, re, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
ok = bad = 0
for f in sorted(glob.glob(os.path.join(here, "test_*.py"))):
    print(f"\n=== {os.path.basename(f)} ===", flush=True)
    out = subprocess.run([sys.executable, f], capture_output=True, text=True, cwd=here)
    print("\n".join(l for l in (out.stdout + out.stderr).splitlines() if re.match(r"\s+(ok|FAIL)\b|Traceback|\w*Error", l)))
    m = re.search(r"(\d+) ok, (\d+) failed", out.stdout)
    if m: ok += int(m.group(1)); bad += int(m.group(2))
    else: bad += 1; print("  FAIL (test crashed)")
print(f"\n{ok} passed, {bad} failed")
sys.exit(1 if bad else 0)
