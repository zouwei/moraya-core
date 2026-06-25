#!/usr/bin/env python3
"""
v0.4.0 — Batch-translate __mt-flagged namespaces + missing keys for one
non-EN locale using deep-translator (Google Translate public endpoint).

USAGE
    python3 scripts/i18n-translate-via-google.py <locale>

    e.g. python3 scripts/i18n-translate-via-google.py de

QUALITY CAVEAT
    Google Translate output is machine-translation grade — usable for first
    coverage, NOT publication-ready. Hand-review is recommended for any UI
    string that's user-facing critical (CTAs, error messages, billing copy).

PLACEHOLDER SAFETY
    `{varName}` placeholders are masked before translation (replaced with
    sentinel `__P0__` etc) and restored after, so they aren't mangled by
    the translator.

RATE LIMITS
    Google's public endpoint will 429 if hit too hard. Uses 0.4s delay
    between calls, batches of up to 30 strings via translate_batch, and
    retries with exponential backoff on failure.

INCREMENTAL PROGRESS
    Saves the locale JSON after each batch — safe to Ctrl+C and resume;
    already-translated entries (i.e. where the current locale value
    differs from en) are skipped.
"""

import json
import re
import sys
import time
from pathlib import Path

try:
    from deep_translator import GoogleTranslator
except ImportError:
    print('Need deep-translator: pip3 install deep-translator', file=sys.stderr)
    sys.exit(2)

LOCALES_DIR = Path(__file__).parent.parent / 'src' / 'i18n' / 'locales'
BATCH_SIZE = 30
DELAY_SEC = 0.4

# {varName} or {0} placeholders — pulled out before translation, restored after.
PLACEHOLDER_RE = re.compile(r'\{[\w]+\}')


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


def mask_placeholders(text):
    """Replace {var} with __P0__, __P1__, ...; return (masked_text, placeholders)."""
    placeholders = PLACEHOLDER_RE.findall(text)
    masked = text
    for i, ph in enumerate(placeholders):
        masked = masked.replace(ph, f'__P{i}__', 1)
    return masked, placeholders


def unmask_placeholders(masked, placeholders):
    """Restore __P0__ etc. with original {var} tokens. Handles MT corruption."""
    out = masked
    for i, ph in enumerate(placeholders):
        # Try exact then common MT corruptions (case, spaces, double underscore)
        for variant in (f'__P{i}__', f'__p{i}__', f'__ P{i} __', f'__P {i}__', f'_P{i}_'):
            if variant in out:
                out = out.replace(variant, ph, 1)
                break
        else:
            # Placeholder lost during translation — append at end as fallback
            if ph not in out:
                out = out + ' ' + ph
    return out


def translate_batch_safe(translator, texts, retries=3):
    """Batch translate with retry. Returns list aligned with input."""
    for attempt in range(retries):
        try:
            result = translator.translate_batch(texts)
            if result and len(result) == len(texts):
                return result
        except Exception as e:
            wait = 2 ** attempt
            print(f'    retry {attempt + 1}/{retries} after {wait}s ({type(e).__name__}: {e})')
            time.sleep(wait)
    # Final fallback: one-by-one
    out = []
    for t in texts:
        try:
            out.append(translator.translate(t))
        except Exception:
            out.append(t)  # leave English on full failure
    return out


def main():
    if len(sys.argv) != 2:
        print(f'Usage: {sys.argv[0]} <locale>', file=sys.stderr)
        sys.exit(2)

    locale = sys.argv[1]
    en_path = LOCALES_DIR / 'en.json'
    loc_path = LOCALES_DIR / f'{locale}.json'
    if not loc_path.exists():
        print(f'❌ {loc_path} not found', file=sys.stderr)
        sys.exit(1)

    en = json.loads(en_path.read_text(encoding='utf-8'))
    loc = json.loads(loc_path.read_text(encoding='utf-8'))

    en_flat = flatten(en)
    loc_flat = flatten(loc)
    mt_ns = {k for k, v in loc.items() if isinstance(v, dict) and v.get('__mt')}

    # Keys needing translation:
    # - missing entirely from the locale
    # - OR under an __mt-flagged namespace AND currently equal to the English value
    to_translate = []
    for key, en_val in en_flat.items():
        loc_val = loc_flat.get(key)
        in_mt_ns = key.split('.')[0] in mt_ns
        if loc_val is None:
            to_translate.append((key, en_val))
        elif in_mt_ns and loc_val == en_val:
            to_translate.append((key, en_val))
        # else: locale already has non-English content — leave it alone

    if not to_translate:
        print(f'✅ {locale}: nothing to translate ({len(en_flat)} keys all covered)')
        # Still strip __mt sentinels if any
        remove_mt(loc)
        sorted_loc = {k: loc[k] for k in sorted(loc.keys())}
        loc_path.write_text(json.dumps(sorted_loc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        return

    print(f'{locale}: translating {len(to_translate)} keys (batch size {BATCH_SIZE})')

    translator = GoogleTranslator(source='en', target=locale.replace('-', '-'))
    # Some locale codes need normalization for Google
    google_locale_map = {
        'zh-Hant': 'zh-TW',
        'zh-CN': 'zh-CN',
    }
    translator = GoogleTranslator(source='en', target=google_locale_map.get(locale, locale))

    applied = 0
    for batch_start in range(0, len(to_translate), BATCH_SIZE):
        batch = to_translate[batch_start:batch_start + BATCH_SIZE]
        masked_texts = []
        placeholders_list = []
        for _, en_val in batch:
            masked, phs = mask_placeholders(en_val)
            masked_texts.append(masked)
            placeholders_list.append(phs)

        translated = translate_batch_safe(translator, masked_texts)

        for (key, en_val), translated_masked, phs in zip(batch, translated, placeholders_list):
            if translated_masked is None or not isinstance(translated_masked, str):
                translated_masked = en_val
            final = unmask_placeholders(translated_masked, phs)
            set_nested(loc, key, final)
            applied += 1

        # Save incremental progress
        remove_mt(loc)
        sorted_loc = {k: loc[k] for k in sorted(loc.keys())}
        loc_path.write_text(json.dumps(sorted_loc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

        done_pct = applied * 100 // len(to_translate)
        print(f'  [{applied:4d}/{len(to_translate)}] {done_pct:3d}%')
        time.sleep(DELAY_SEC)

    print(f'✅ {locale}: {applied} keys translated, __mt sentinels removed')


if __name__ == '__main__':
    main()
