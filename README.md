# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/huimou612/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/huimou612/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token DeFi protocols by an implied value calibrated from the market, and shows how to farm each one. It reads a sealed DefiLlama snapshot (758 protocols), scores 202 of them — every protocol on the $50M watchlist, the early pre-token protocols below that floor, and the largest live-token protocols ranked beside them by market cap — and writes a sortable, filterable dashboard with a detail view and a concrete farm plan for every row.

The model is one function of the snapshot's own figures: `implied = TVL x category multiple x (1 + 7d growth x 0.5) x maturity x chain breadth`, where the category multiple is the median market-cap-to-TVL ratio of the live-token protocols in that category. No protocol name is special-cased. Implied value is the entry's own claim, never a price.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

Node 22 or later, standard library only. The program is fully deterministic: the same snapshot always writes the same bytes to `out/` (`board.json`, `data.js`, `dashboard/`, `screenshots/`, `dossier.json`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=vy4ejv7y&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
