#!/usr/bin/env python3
"""
v0.4.0 — Generic locale-translation applier.

USAGE
    python3 scripts/i18n-apply-translations.py <locale>

For the given <locale>, reads:
    scripts/i18n-translations-<locale>.json   (the translations payload)
    src/i18n/locales/en.json                  (source of truth for keys)
    src/i18n/locales/<locale>.json            (existing locale, in-place patched)

And applies every translation under all __mt-flagged namespaces + every
missing key, then strips __mt sentinels (locale is now considered complete).

The translations file must be { "dotted.key": "translated string", ... }
and MUST cover every key in `to_translate`. Missing entries are flagged.
"""

import json
import sys
from pathlib import Path

LOCALES_DIR = Path(__file__).parent.parent / 'src' / 'i18n' / 'locales'
SCRIPTS_DIR = Path(__file__).parent


def flatten(node, prefix=''):
    out = {}
    if isinstance(node, dict):
        for k, v in node.items():
            if k.startswith('__'):
                continue
            p = f'{prefix}.{k}' if prefix else k
            if isinstance(v, str):
                out[p] = v
            elif isinstance(v, dict):
                out.update(flatten(v, p))
    return out


def set_nested(root, dotted_key, value):
    parts = dotted_key.split('.')
    node = root
    for p in parts[:-1]:
        if p not in node or not isinstance(node[p], dict):
            node[p] = {}
        node = node[p]
    node[parts[-1]] = value


def remove_mt(node):
    if isinstance(node, dict):
        node.pop('__mt', None)
        for v in node.values():
            remove_mt(v)


def main():
    if len(sys.argv) != 2:
        print(f'Usage: {sys.argv[0]} <locale>', file=sys.stderr)
        sys.exit(2)

    locale = sys.argv[1]
    en_path = LOCALES_DIR / 'en.json'
    loc_path = LOCALES_DIR / f'{locale}.json'
    tr_path = SCRIPTS_DIR / f'i18n-translations-{locale}.json'

    if not loc_path.exists():
        print(f'❌ {loc_path} not found', file=sys.stderr)
        sys.exit(1)
    if not tr_path.exists():
        print(f'❌ {tr_path} not found', file=sys.stderr)
        sys.exit(1)

    en = json.loads(en_path.read_text(encoding='utf-8'))
    loc = json.loads(loc_path.read_text(encoding='utf-8'))
    translations = json.loads(tr_path.read_text(encoding='utf-8'))

    en_flat = flatten(en)
    loc_flat = flatten(loc)
    mt_ns = {k for k, v in loc.items() if isinstance(v, dict) and v.get('__mt')}

    to_translate = {
        k for k in en_flat
        if k not in loc_flat or k.split('.')[0] in mt_ns
    }

    missing_from_payload = to_translate - set(translations.keys())
    if missing_from_payload:
        print(f'⚠ {len(missing_from_payload)} keys missing from translations file:')
        for k in sorted(missing_from_payload)[:10]:
            print(f'    {k}: en={en_flat[k]!r}')
        if len(missing_from_payload) > 10:
            print(f'    ...+{len(missing_from_payload) - 10} more')
        sys.exit(1)

    extras = set(translations.keys()) - to_translate
    if extras:
        print(f'⚠ {len(extras)} translations are for keys NOT needing translation (extras):')
        for k in sorted(extras)[:5]:
            print(f'    {k}')

    applied = 0
    for key, value in translations.items():
        if key not in to_translate:
            continue
        set_nested(loc, key, value)
        applied += 1

    remove_mt(loc)

    # Stable sort
    sorted_loc = {k: loc[k] for k in sorted(loc.keys())}

    loc_path.write_text(
        json.dumps(sorted_loc, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(f'✅ {locale}: applied {applied} translations; __mt sentinels removed')


if __name__ == '__main__':
    main()
