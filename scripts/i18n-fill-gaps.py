#!/usr/bin/env python3
"""
v0.4.0 follow-up — fill in translation gaps left by the main batch run.

Some short UI strings (e.g. "Edit", "Hold to record") routinely fail the
Google Translate public endpoint's anti-bot heuristics. The main script's
retry fallback returned the original English for those — visible as keys
where locale_value == en_value AND the key is one we expected to translate.

This script identifies those "still-English" keys per locale and re-tries:
   1. GoogleTranslator with longer per-call delay (1.0s instead of 0.4s)
   2. If still returns identical English → fall back to MyMemoryTranslator

USAGE
    python3 scripts/i18n-fill-gaps.py <locale> [<locale>...]
    e.g. python3 scripts/i18n-fill-gaps.py fr ko hi
"""

import json
import re
import sys
import time
from pathlib import Path

try:
    from deep_translator import GoogleTranslator, MyMemoryTranslator
except ImportError:
    print('Need deep-translator: pip3 install deep-translator', file=sys.stderr)
    sys.exit(2)

LOCALES_DIR = Path(__file__).parent.parent / 'src' / 'i18n' / 'locales'
DELAY_SEC = 1.0

PLACEHOLDER_RE = re.compile(r'\{[\w]+\}')

# Strings that are LEGITIMATELY identical English↔target in many languages —
# brand names, single-letter labels, acronyms. Skip these without trying to
# re-translate, otherwise we burn API calls on impossible-to-improve cases.
SKIP_IF_IDENTICAL = {
    'AI', 'MCP', 'OCR', 'KMS', 'JSON', 'YAML', 'PDF', 'HTML', 'CSS', 'URL',
    'API', 'HTTP', 'HTTPS', 'SSE', 'TTS', 'STT', 'SDK', 'UI', 'UX',
    'Picora', 'Moraya', 'OpenAI', 'Claude', 'Gemini', 'DeepSeek', 'Ollama',
    'Grok', 'Mistral', 'Doubao', 'GLM', 'MiniMax',
    'Edit',  # Google occasionally refuses; covered by the loop, just noisy
}

GOOGLE_LOCALE_MAP = {
    'zh-Hant': 'zh-TW',
    'zh-CN': 'zh-CN',
}

MYMEMORY_LOCALE_MAP = {
    'zh-CN': 'zh-CN',
    'zh-Hant': 'zh-TW',
    'ar': 'ar-SA',
    'de': 'de-DE',
    'es': 'es-ES',
    'fr': 'fr-FR',
    'hi': 'hi-IN',
    'ja': 'ja-JP',
    'ko': 'ko-KR',
    'pt': 'pt-PT',
    'ru': 'ru-RU',
}


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


def mask_placeholders(text):
    placeholders = PLACEHOLDER_RE.findall(text)
    masked = text
    for i, ph in enumerate(placeholders):
        masked = masked.replace(ph, f'__P{i}__', 1)
    return masked, placeholders


def unmask_placeholders(masked, placeholders):
    out = masked
    for i, ph in enumerate(placeholders):
        for variant in (f'__P{i}__', f'__p{i}__', f'__ P{i} __', f'__P {i}__', f'_P{i}_'):
            if variant in out:
                out = out.replace(variant, ph, 1)
                break
        else:
            if ph not in out:
                out = out + ' ' + ph
    return out


def try_google(text, target):
    try:
        gtarget = GOOGLE_LOCALE_MAP.get(target, target)
        result = GoogleTranslator(source='en', target=gtarget).translate(text)
        return result
    except Exception:
        return None


def try_mymemory(text, target):
    try:
        mtarget = MYMEMORY_LOCALE_MAP.get(target, target)
        result = MyMemoryTranslator(source='en-GB', target=mtarget).translate(text)
        return result
    except Exception:
        return None


def fill_locale(locale):
    en_path = LOCALES_DIR / 'en.json'
    loc_path = LOCALES_DIR / f'{locale}.json'
    en = json.loads(en_path.read_text(encoding='utf-8'))
    loc = json.loads(loc_path.read_text(encoding='utf-8'))
    en_flat = flatten(en)
    loc_flat = flatten(loc)

    # A key is a "gap" when its locale value equals the English value
    # AND it's not on our legitimate-identical skip list.
    gaps = []
    for k, en_val in en_flat.items():
        loc_val = loc_flat.get(k)
        if loc_val == en_val and en_val.strip() not in SKIP_IF_IDENTICAL:
            gaps.append((k, en_val))

    if not gaps:
        print(f'✅ {locale}: no gaps detected')
        return

    print(f'{locale}: {len(gaps)} gap(s) to fill')

    filled_google = 0
    filled_mymemory = 0
    skipped = 0
    saved_every = 25
    since_save = 0

    for i, (key, en_val) in enumerate(gaps):
        masked, phs = mask_placeholders(en_val)

        # Try Google with the longer per-call delay
        translated = try_google(masked, locale)

        # If Google failed or returned the same masked text, try MyMemory
        if translated is None or translated.strip() == masked.strip():
            translated = try_mymemory(masked, locale)
            if translated and translated.strip() != masked.strip():
                filled_mymemory += 1
            else:
                skipped += 1
                # Leave as English; nothing better available
                time.sleep(DELAY_SEC)
                continue
        else:
            filled_google += 1

        final = unmask_placeholders(translated, phs)
        set_nested(loc, key, final)

        since_save += 1
        if since_save >= saved_every:
            loc_path.write_text(
                json.dumps({k: loc[k] for k in sorted(loc.keys())}, ensure_ascii=False, indent=2) + '\n',
                encoding='utf-8',
            )
            since_save = 0
            print(f'  [{i + 1:4d}/{len(gaps)}] G={filled_google} MM={filled_mymemory} skip={skipped}')

        time.sleep(DELAY_SEC)

    loc_path.write_text(
        json.dumps({k: loc[k] for k in sorted(loc.keys())}, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(f'✅ {locale}: Google={filled_google}, MyMemory={filled_mymemory}, skipped={skipped} / {len(gaps)} total')


def main():
    if len(sys.argv) < 2:
        print(f'Usage: {sys.argv[0]} <locale> [<locale>...]', file=sys.stderr)
        sys.exit(2)
    for locale in sys.argv[1:]:
        if not (LOCALES_DIR / f'{locale}.json').exists():
            print(f'❌ {locale}.json not found, skipping', file=sys.stderr)
            continue
        print()
        print('=' * 64)
        print(f'  Filling gaps in: {locale}   {time.strftime("%H:%M:%S")}')
        print('=' * 64)
        fill_locale(locale)


if __name__ == '__main__':
    main()
