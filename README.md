# Token Launch Radar

A radar over the protocols that record no token yet, ranked by what their
token would be worth if it traded at the multiple the market already pays for
live tokens. Built for make.fun's `token-radar-01` ($1,325).

## What it hands in

- `main.ts` — the entrypoint. Reads the sealed snapshot, scores every
  pre-token protocol, writes `board.json`, `data.js`, the dashboard, the
  screenshots and `dossier.json`.
- `lib/radar.ts` — the model, the board builder, the farm plans and the
  dashboard dataset.
- `dashboard/` — a static page (no network, no framework): the ranked board,
  a detail view per protocol, filters and sorting, and the live-token view.
- `screenshots/` — three renders of the dashboard: the board, a protocol
  detail, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for
  byte from the kit (the scorer runs this same file).

## The model (radar-2)

```
implied value = TVL × market multiple × growth factor × age factor
```

- **Market multiple.** The anchor is computed from the snapshot itself at run
  time: the median market-cap / TVL of the live-token protocols it carries.
  Per category, when that category has at least 3 traded peers, its own
  median is used, shrunk toward the market-wide median with a prior weight
  of 6; otherwise the market-wide median applies. Multiples are clamped to
  0.05–0.60. This snapshot's market-wide median is 0.204.
- **Growth factor.** The 7-day TVL change, clamped to −50%…+100%, worth
  `1 + growth × 0.6`.
- **Age factor.** How long the protocol has run with no token:
  `0.75 + 0.25 × min(age, 1460 days) / 1460`. Unknown age scores 0.87.

No protocol name is ever special-cased: the same three factors score every
row. Live-token protocols are never ranked; the dashboard shows them apart,
at the market's own value.

## The board

198 rows: all 40 watchlist protocols plus every other rankable pre-token
protocol in the snapshot (pre-token, not an exchange, not a versioned pool,
not a wrapped / staked / bridged product of a token that already trades).
Each row carries its farm plan: six concrete steps with a cost and a time,
built from the protocol's own category, chain, size and age.

## Run it

```sh
node main.ts --input <snapshot.json|directory> --output <directory>
```

With no flags it reads `/input/snapshot.json` and writes `/output`; outside
the grader `MAKEFUN_OUTPUT_DIR` stands in for `/output`. Node 22+,
standard library only, no install, no network.

## The dashboard

Open `dashboard/index.html` with `data.js` beside it (the program writes
both). Deep links: `#detail=<slug>`, `#cat=<category>`, `#q=<text>`,
`#view=live`.

## A note on what this claims

An implied value is this entry's model output, not a prediction that a token
will be issued, or when. “Records no token” is what the snapshot says, not
proof a protocol has none.
