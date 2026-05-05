# /// script
# dependencies = ["datasets>=3.0.0", "huggingface_hub>=0.24.0"]
# ///
"""Prepare and optionally push the ROCmPilot SFT seed dataset.

Usage:
  python agent-training/scripts/prepare_dataset.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "seed-examples.jsonl"


def example_to_messages(row: dict) -> dict:
    task = row["task"]
    input_payload = json.dumps(row["input"], indent=2)
    expected = json.dumps(row["expected"], indent=2)

    if task == "migration_planner":
        user = (
            "You are ROCmPilot's Migration Planner Agent. Analyze this repository "
            "evidence and return a precise ROCm migration finding.\n\n"
            f"Evidence:\n{input_payload}"
        )
    elif task == "patch_planner":
        user = (
            "You are ROCmPilot's Patch Planner Agent. Convert this migration finding "
            "into a safe, scoped ROCm patch recommendation. Do not claim that files "
            "were changed unless a patch was actually applied.\n\n"
            f"Finding:\n{input_payload}"
        )
    elif task == "benchmark_agent":
        user = (
            "You are ROCmPilot's Benchmark Agent. Convert this workload evidence into "
            "a credible AMD validation plan. Clearly separate estimates from live AMD "
            "measurements.\n\n"
            f"Evidence:\n{input_payload}"
        )
    elif task == "memory_agent":
        user = (
            "You are ROCmPilot's Memory Agent. Convert this agent discussion into a "
            "durable long-context memory that can be reused across later migration "
            "runs. Keep the memory precise and action-oriented.\n\n"
            f"Discussion:\n{input_payload}"
        )
    else:
        user = (
            "You are ROCmPilot's Report Agent. Write a credible AMD ROCm migration "
            "report section without overstating live GPU evidence.\n\n"
            f"Run data:\n{input_payload}"
        )

    return {
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are ROCmPilot, an expert agent for migrating PyTorch and "
                    "vLLM workloads from CUDA/NVIDIA assumptions to AMD ROCm readiness."
                ),
            },
            {"role": "user", "content": user},
            {"role": "assistant", "content": expected},
        ],
        "task": task,
    }


def load_seed_rows() -> list[dict]:
    rows = []
    with SEED_PATH.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(ROOT / "rocmpilot-sft-preview.jsonl"))
    parser.add_argument("--push", action="store_true")
    parser.add_argument("--repo-id", default="Shivam311/rocmpilot-agent-sft")
    args = parser.parse_args()

    rows = [example_to_messages(row) for row in load_seed_rows()]
    with Path(args.output).open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")
    print(f"Wrote {len(rows)} examples to {args.output}")

    if args.push:
        from datasets import Dataset

        dataset = Dataset.from_list(rows)
        dataset.push_to_hub(args.repo_id, private=False)
        print(f"Pushed {len(rows)} examples to https://huggingface.co/datasets/{args.repo_id}")


if __name__ == "__main__":
    main()
