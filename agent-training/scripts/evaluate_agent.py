# /// script
# dependencies = ["requests>=2.32.0"]
# ///
"""Tiny smoke-eval harness for ROCmPilot report/migration agents.

It calls an OpenAI-compatible endpoint and checks whether outputs respect the
core product rules: concrete ROCm guidance, no fake AMD benchmark claims, and
business value.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import requests


PROMPTS = [
    {
        "name": "cuda_device",
        "prompt": "A repo contains `model.cuda()` and `torch.device('cuda')`. Give a ROCmPilot finding and fix.",
        "must_include": ["ROCm", "device", "backend"],
        "must_not_include": ["live MI300X benchmark", "guaranteed"],
    },
    {
        "name": "fallback_report",
        "prompt": "Write a report summary when the app used Hugging Face fallback and AMD_QWEN_BASE_URL is not configured.",
        "must_include": ["fallback", "AMD", "configure"],
        "must_not_include": ["measured on MI300X", "live AMD run completed"],
    },
]


def call_model(base_url: str, model: str, prompt: str, token: str | None) -> str:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    response = requests.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers=headers,
        timeout=45,
        json={
            "model": model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": "You are ROCmPilot, a ROCm migration expert."},
                {"role": "user", "content": prompt},
            ],
        },
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("EVAL_BASE_URL", "https://router.huggingface.co/v1"))
    parser.add_argument("--model", default=os.environ.get("EVAL_MODEL", "Qwen/Qwen2.5-Coder-7B-Instruct"))
    parser.add_argument("--token", default=os.environ.get("HF_TOKEN"))
    args = parser.parse_args()

    results = []
    failed = False
    for item in PROMPTS:
        output = call_model(args.base_url, args.model, item["prompt"], args.token)
        missing = [term for term in item["must_include"] if term.lower() not in output.lower()]
        forbidden = [term for term in item["must_not_include"] if term.lower() in output.lower()]
        passed = not missing and not forbidden
        failed = failed or not passed
        results.append({"name": item["name"], "passed": passed, "missing": missing, "forbidden": forbidden})

    print(json.dumps(results, indent=2))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
