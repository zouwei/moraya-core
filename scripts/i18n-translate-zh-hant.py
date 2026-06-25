#!/usr/bin/env python3
"""
v0.4.0 — Populate zh-Hant.json from zh-CN.json via opencc S→T conversion.

zh-Hant is the easiest of the 10 non-EN/ZH locales because zh-CN is already
fully translated; we just need Simplified → Traditional Taiwan character
conversion plus the phrase-mapping table baked into opencc's `s2twp`
profile (软件→軟體, 网络→網路, 视频→影片, 默认→預設, etc).

Strategy:
1. Walk zh-CN.json, flatten into key → string
2. Same for the current zh-Hant.json
3. For every key under a __mt-flagged namespace OR missing in zh-Hant,
   take zh-CN's value, run through opencc s2twp, write into zh-Hant
4. Remove all __mt sentinels
5. Save zh-Hant.json with sorted top-level keys
"""

import json
from pathlib import Path
from opencc import OpenCC

LOCALES_DIR = Path(__file__).parent.parent / 'src' / 'i18n' / 'locales'
ZH_CN = LOCALES_DIR / 'zh-CN.json'
ZH_HANT = LOCALES_DIR / 'zh-Hant.json'

# s2twp = Simplified → Traditional Taiwan with phrase-level conversion
# (handles vocabulary like 软件 → 軟體, not just character-level).
cc = OpenCC('s2twp')


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
    """Strip __mt sentinels recursively. Mutates."""
    if isinstance(node, dict):
        node.pop('__mt', None)
        for v in node.values():
            remove_mt(v)


def main():
    zh_cn = json.loads(ZH_CN.read_text(encoding='utf-8'))
    zh_hant = json.loads(ZH_HANT.read_text(encoding='utf-8'))

    cn_flat = flatten(zh_cn)
    hant_flat = flatten(zh_hant)

    mt_namespaces = {k for k, v in zh_hant.items()
                     if isinstance(v, dict) and v.get('__mt')}

    # Keys to translate: missing OR under __mt namespace
    to_translate = set()
    for key in cn_flat:
        top = key.split('.')[0]
        if key not in hant_flat or top in mt_namespaces:
            to_translate.add(key)

    converted = 0
    for key in to_translate:
        src = cn_flat[key]
        dst = cc.convert(src)
        set_nested(zh_hant, key, dst)
        converted += 1

    # Drop __mt sentinels everywhere (translation is complete now)
    remove_mt(zh_hant)

    # Sort top-level alphabetically for diff stability
    sorted_zh_hant = {k: zh_hant[k] for k in sorted(zh_hant.keys())}

    ZH_HANT.write_text(
        json.dumps(sorted_zh_hant, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )

    print(f'✅ zh-Hant: converted {converted} keys via opencc s2twp')
    print(f'   __mt sentinels removed from {len(mt_namespaces)} namespaces')


if __name__ == '__main__':
    main()
