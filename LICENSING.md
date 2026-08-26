# Licensing

`@moraya/core` is available under a **dual license**.

## 1. Open-source use — GNU GPL v3.0

The default license for `@moraya/core` is the [GNU General Public License, version 3.0](./LICENSE) ("GPL-3.0").

Under GPL-3.0 you may use, modify, and redistribute this package **provided that**:

- Any product, application, or service that incorporates `@moraya/core` (whether by static linking, dynamic linking, npm dependency, bundling, or any other form of combined work) must also be licensed under GPL-3.0 or a compatible license.
- The complete corresponding source code of any such derived work must be made available to its users under the same terms.
- Copyright notices and this LICENSING.md must be preserved.

If you accept these terms, you may use `@moraya/core` at no charge under GPL-3.0. **This is the license you receive by default when installing from npm.**

## 2. Commercial license

If you want to use `@moraya/core` in a product that is:

- **Closed-source / proprietary**, or
- **Distributed under a license incompatible with GPL-3.0** (e.g. MIT, Apache-2.0 with additional restrictions, commercial EULAs), or
- **A hosted SaaS whose users would otherwise trigger GPL / AGPL obligations you can't or don't want to accept**,

you need a **commercial license** from the copyright holder. A commercial license removes the GPL copyleft obligations and permits proprietary use.

Contact: **huzougege@gmail.com**

Please include:
- Your company / project name
- Intended use case (product / SaaS / internal tool)
- Distribution model (number of users, revenue expectation)
- Which subpath exports you'll consume (`/schema`, `/markdown`, `/ai`, `/chat-markdown`, etc.)

Commercial license pricing depends on scope.

### 2.1 First-party internal grant

The copyright holder grants the following own products a perpetual internal
commercial license to `@moraya/core`, on the terms of section 2 and at no fee.
These products may therefore ship closed-source, or under a license that is not
GPL-compatible, without triggering the copyleft obligations of section 1.

| Product | Source repository | Distributed as |
|---|---|---|
| Moraya Desktop | `zouwei/moraya` | Apache-2.0 |
| Moraya Web | `zouwei/moraya-web` | proprietary |
| Moraya Mobile | `zouwei/moraya-mobile` | proprietary |
| Protago | `zouwei/protago-code` | proprietary |
| Feiyan (飞雁) | `zouwei/feiyan-code` | proprietary |

The grant covers all released versions of `@moraya/core`, past and future, and
extends to the named repository only — not to forks held by third parties.

This section exists so the claim can be checked: each of the products above
states in its own NOTICE that it uses `@moraya/core` under this grant, and that
statement is only true while the product is listed here. **A first-party product
that begins depending on `@moraya/core` must be added here before it ships.**

## 3. Contributor terms

By submitting a pull request or patch to this repository, you agree that:

- You are the original author (or have permission from the original author) of the contributed code.
- Your contribution is licensed to the project's maintainer under a permissive grant sufficient for the maintainer to redistribute it under **both** GPL-3.0 **and** a commercial license.

This is a lightweight Contributor License Agreement — necessary because the project uses dual licensing. If you can't agree to this, please open an issue to discuss before submitting code.

## Summary — which one applies to me?

| Your project's license | You get `@moraya/core` under |
|---|---|
| GPL-3.0-compatible open source (GPL-3.0, AGPL-3.0, GPL-3.0-later) | ✅ Free — GPL-3.0 |
| Non-GPL open source (MIT, Apache-2.0, BSD, ISC) | ⚠️ **Commercial license required** — MIT/Apache is not GPL-compatible for derivative works |
| Closed-source / proprietary product | ⚠️ **Commercial license required** |
| Personal experimentation, learning, non-distributed hobby project | ✅ Free — GPL-3.0 (no distribution → no obligation) |

Copyright © 2026 zouwei. All rights reserved.
