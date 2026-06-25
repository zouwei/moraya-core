#!/usr/bin/env bash
# v0.4.0 — Sequentially translate the 9 non-EN/ZH locales (zh-Hant + es
# are already done). Each takes ~30-70 min via Google Translate public
# endpoint due to throttling. Total wall time ~8 hours.
#
# Run with `nohup ./scripts/i18n-translate-all-remaining.sh > /tmp/i18n-loop.log 2>&1 &`
# Progress per-locale lands in src/i18n/locales/<loc>.json incrementally,
# so Ctrl+C and resume is safe (already-translated entries skip).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

LOCALES=(de fr pt ja ko ru hi ar)

for loc in "${LOCALES[@]}"; do
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "  Translating: $loc"
  echo "  Started: $(date)"
  echo "════════════════════════════════════════════════════════════════"
  python3 scripts/i18n-translate-via-google.py "$loc"
  rc=$?
  echo "  Finished: $loc → exit=$rc"
  if [ "$rc" -ne 0 ]; then
    echo "  ⚠ exit non-zero, continuing to next locale"
  fi
done

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  All 9 locales done at: $(date)"
echo "════════════════════════════════════════════════════════════════"
