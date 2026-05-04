# ROCmPilot Agent Eval Rubric

Score each output from 1-5.

## Migration Accuracy

- 1: Misses obvious CUDA/NVIDIA assumptions.
- 3: Finds major issues but gives generic fixes.
- 5: Finds concrete blockers and gives ROCm-specific fixes.

## Patch Usefulness

- 1: Produces vague prose only.
- 3: Suggests plausible files but lacks precise edits.
- 5: Produces safe, scoped, backend-aware patch recommendations.

## AMD Credibility

- 1: Claims live AMD metrics without evidence.
- 3: Mentions ROCm/MI300X but lacks proof boundaries.
- 5: Clearly separates live evidence, estimates, and fallback demo data.

## Business Value

- 1: Purely technical with no user or buyer value.
- 3: Mentions cost or portability generally.
- 5: Explains why infra teams would adopt it and how it reduces migration risk.

## Presentation Quality

- 1: Too long, unclear, or hallucinated.
- 3: Understandable but not judge-ready.
- 5: Concise, structured, demo-friendly, and credible.
