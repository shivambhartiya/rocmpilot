"""Generate ROCmPilot synthetic SFT seed examples.

The goal is not to pretend we already have production data. This creates a
larger smoke-training set that teaches the agent our output style, safety
boundaries, and common CUDA-to-ROCm migration patterns.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "seed-examples.jsonl"


MIGRATION_CASES = [
    {
        "category": "NVIDIA container/runtime assumption",
        "severity": "high",
        "file": "Dockerfile",
        "snippets": [
            "FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04\nRUN pip install vllm torch",
            "FROM nvcr.io/nvidia/pytorch:24.03-py3\nCOPY . /workspace",
            "docker run --gpus all -e NVIDIA_VISIBLE_DEVICES=all app:latest",
            "services:\n  worker:\n    image: nvidia/cuda:12.2.0-devel-ubuntu22.04",
        ],
        "finding": "The repository uses NVIDIA-specific container or runtime settings that will not run cleanly on AMD ROCm infrastructure.",
        "recommendation": "Add a ROCm-specific runtime profile using a ROCm/vLLM image and move NVIDIA launch flags behind backend-specific scripts.",
    },
    {
        "category": "Hardcoded CUDA device path",
        "severity": "critical",
        "file": "src/inference/server.py",
        "snippets": [
            "device = torch.device('cuda')\nmodel = model.to(device)",
            "inputs = tokenizer(prompt, return_tensors='pt').to('cuda')",
            "model = AutoModelForCausalLM.from_pretrained(model_id).cuda()",
            "pipeline = pipeline('text-generation', model=model, device_map='cuda')",
        ],
        "finding": "The inference code hardcodes CUDA, so it needs backend-aware device handling before AMD validation.",
        "recommendation": "Introduce a device resolver that treats HIP-backed torch.cuda availability as ROCm and logs backend provenance.",
    },
    {
        "category": "CUDA-oriented dependency",
        "severity": "high",
        "file": "requirements.txt",
        "snippets": [
            "torch==2.4.0+cu124\n--extra-index-url https://download.pytorch.org/whl/cu124",
            "cupy-cuda12x==13.2.0\nbitsandbytes==0.43.3",
            "flash-attn==2.6.3\nxformers==0.0.27.post2",
            "nvidia-cublas-cu12\nnvidia-cudnn-cu12\nnvidia-nccl-cu12",
        ],
        "finding": "The dependency file pins CUDA/NVIDIA builds that can block ROCm package resolution.",
        "recommendation": "Create a ROCm dependency profile and verify PyTorch/vLLM wheel compatibility against the target ROCm version.",
    },
    {
        "category": "vLLM serving defaults need AMD profile",
        "severity": "medium",
        "file": "scripts/serve.sh",
        "snippets": [
            "python -m vllm.entrypoints.openai.api_server --model $MODEL",
            "vllm serve Qwen/Qwen2.5-Coder-7B-Instruct",
            "python serve.py --engine vllm --model $MODEL --port 8000",
            "MODEL=Qwen/Qwen2.5-Coder-7B-Instruct\npython -m vllm.entrypoints.openai.api_server --model $MODEL",
        ],
        "finding": "vLLM is present, but the launch path does not expose AMD validation knobs like model length, tensor parallelism, or metrics capture.",
        "recommendation": "Add a ROCm serve script with tensor parallelism, max model length, backend logging, and OpenAI-compatible endpoint configuration.",
    },
    {
        "category": "Benchmark evidence incomplete",
        "severity": "medium",
        "file": "benchmarks/run_latency.py",
        "snippets": [
            "start = time.time()\nclient.chat.completions.create(...)\nprint(time.time() - start)",
            "for prompt in prompts:\n    generate(prompt)\nprint('done')",
            "requests.post(endpoint, json=payload)\nprint(response.status_code)",
            "latencies.append(end - start)\nprint(sum(latencies) / len(latencies))",
        ],
        "finding": "The benchmark does not capture enough evidence to prove AMD readiness.",
        "recommendation": "Emit backend, GPU name, memory usage, tokens/sec, p50/p95 latency, model id, batch shape, and exact serve command.",
    },
    {
        "category": "GPU backend detection needs abstraction",
        "severity": "medium",
        "file": "src/config/gpu.py",
        "snippets": [
            "if torch.cuda.is_available():\n    return 'cuda'\nraise RuntimeError('CUDA required')",
            "gpu_name = torch.cuda.get_device_name(0)\nprint(gpu_name)",
            "os.environ['CUDA_VISIBLE_DEVICES'] = '0'\nrun()",
            "assert torch.cuda.is_available(), 'GPU required'",
        ],
        "finding": "The project checks GPU availability through CUDA-only assumptions and does not document ROCm behavior.",
        "recommendation": "Centralize accelerator detection and represent CUDA, ROCm, and CPU as explicit runtime modes.",
    },
]


PATCH_CASES = [
    {
        "finding": "Hardcoded CUDA device path in src/inference/server.py.",
        "patch": "Add src/rocmpilot_device.py with resolve_accelerator(), import DEVICE and GPU_BACKEND from it, and replace direct .cuda() calls with .to(DEVICE).",
    },
    {
        "finding": "Dockerfile uses nvidia/cuda.",
        "patch": "Add Dockerfile.rocm using a ROCm/vLLM base image and document it as an AMD validation target without deleting the original Dockerfile.",
    },
    {
        "finding": "requirements.txt pins cu124 wheels.",
        "patch": "Add requirements-rocm.txt and keep CUDA pins isolated in requirements-cuda.txt so CI can install backend-specific dependencies.",
    },
    {
        "finding": "Benchmark only prints average latency.",
        "patch": "Add benchmark_rocm.py that records backend, model id, prompt count, tokens/sec, p95 latency, memory, and command provenance.",
    },
]


REPORT_CASES = [
    {
        "gpu_status": "HF fallback, AMD endpoint not configured",
        "findings": ["Dockerfile uses nvidia/cuda", "torch.device('cuda') in server.py"],
        "rule": "Say the app is using Hugging Face fallback now and is ready for AMD ROCm/vLLM when AMD_QWEN_BASE_URL is configured. Do not claim live MI300X measurements.",
    },
    {
        "gpu_status": "AMD endpoint configured but benchmark estimate only",
        "findings": ["vLLM serve script lacks ROCm knobs", "benchmark misses memory metrics"],
        "rule": "State that the report model can use AMD-hosted Qwen, but benchmark values remain estimates until a live AMD validation run is captured.",
    },
    {
        "gpu_status": "AMD ROCm/vLLM connected",
        "findings": ["CUDA package pins", "nvidia-smi in smoke test"],
        "rule": "Mention that the Report Agent used the configured AMD endpoint while still separating model-generation proof from workload benchmark proof.",
    },
]


BENCHMARK_CASES = [
    {
        "evidence": "The repo serves Qwen through vLLM but has no benchmark script.",
        "plan": "Run a short OpenAI-compatible vLLM load test, record tokens/sec, p50/p95 latency, memory, model id, ROCm version, and exact command.",
    },
    {
        "evidence": "The repo benchmark uses only one prompt.",
        "plan": "Use a mixed prompt set with fixed seed, concurrency levels, warmup, and separate latency/throughput reporting.",
    },
    {
        "evidence": "The repo claims AMD readiness without logs.",
        "plan": "Require vLLM startup logs, GPU visibility, backend detection output, and one successful completion response before claiming readiness.",
    },
]


def migration_examples() -> list[dict]:
    rows = []
    for case in MIGRATION_CASES:
        for index, snippet in enumerate(case["snippets"], start=1):
            rows.append(
                {
                    "task": "migration_planner",
                    "input": {
                        "file": case["file"],
                        "snippet": snippet,
                        "context": f"case-{index}",
                    },
                    "expected": {
                        "finding": case["finding"],
                        "recommendation": case["recommendation"],
                        "severity": case["severity"],
                        "category": case["category"],
                    },
                }
            )
    return rows


def patch_examples() -> list[dict]:
    rows = []
    for case in PATCH_CASES:
        for caution in [
            "Do not mutate the repository automatically.",
            "Keep CUDA support available as an optional backend.",
            "Make the patch preview clear enough for a maintainer to review.",
        ]:
            rows.append(
                {
                    "task": "patch_planner",
                    "input": {"finding": case["finding"], "constraint": caution},
                    "expected": {
                        "patch_recommendation": case["patch"],
                        "safety_boundary": caution,
                    },
                }
            )
    return rows


def report_examples() -> list[dict]:
    rows = []
    for case in REPORT_CASES:
        for audience in ["hackathon judges", "infra lead", "open-source maintainer", "business stakeholder"]:
            rows.append(
                {
                    "task": "report_agent",
                    "input": {
                        "findings": case["findings"],
                        "gpu_status": case["gpu_status"],
                        "audience": audience,
                    },
                    "expected": {
                        "report_rule": case["rule"],
                        "tone": "concise, credible, and explicit about proof boundaries",
                    },
                }
            )
    return rows


def benchmark_examples() -> list[dict]:
    rows = []
    for case in BENCHMARK_CASES:
        for backend in ["HF fallback", "AMD endpoint configured", "live AMD validation pending"]:
            rows.append(
                {
                    "task": "benchmark_agent",
                    "input": {"evidence": case["evidence"], "backend_status": backend},
                    "expected": {
                        "validation_plan": case["plan"],
                        "proof_boundary": "Do not report estimated values as live AMD measurements.",
                    },
                }
            )
    return rows


def main() -> None:
    rows = migration_examples() + patch_examples() + report_examples() + benchmark_examples()
    with OUT_PATH.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")
    print(f"Wrote {len(rows)} examples to {OUT_PATH}")


if __name__ == "__main__":
    main()
