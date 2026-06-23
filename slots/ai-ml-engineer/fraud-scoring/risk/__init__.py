"""Order risk scoring for TicketForge.

The contract is `contract/risk/` — `rules.yaml` for the declarations and the
bars, `README.md` for what each rule costs in production. The grader is
`conformance/ml/`.

    python -m risk --out <dir>          # one run: fit, score, write CSV
    python -m risk --report             # fit, score a validation split, print metrics
"""

__all__ = ["contract", "features", "metrics", "model", "pipeline"]
