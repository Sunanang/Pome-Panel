# Provider response variants

These are sanitized, reduced response samples for parser regression tests. Quota amounts and dates are illustrative; they are not a live reading of a user's account. No credentials or account identifiers are included.

- `copilot-unlimited.json`: root reset dates, a finite Premium allowance, and unlimited Chat/Completions buckets whose numeric fields are zero. Shape: [aiusg Copilot fixtures](https://github.com/abnegate/aiusg/blob/138ac6d33fbf37d17886be7948bb871ecef6de84/src/provider/copilot.rs).
- `grokbot-iso.json`: ISO period/reset timestamps. Shape: [aiusg Grok Bot fixture](https://github.com/abnegate/aiusg/blob/138ac6d33fbf37d17886be7948bb871ecef6de84/src/provider/grokbot.rs).
- `antigravity-summary.json`: `summary` wrapper, name/id aliases, protobuf oneof remaining fraction, known zero, disabled and unknown buckets. Shapes: [CodexBar quota-summary parser](https://github.com/steipete/CodexBar/blob/92acf2eac671ef172b1509abaa0487786aa1c3a7/Sources/CodexBarCore/Providers/Antigravity/AntigravityQuotaSummaryParser.swift).
