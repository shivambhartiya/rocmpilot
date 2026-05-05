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
    {
        "category": "NVIDIA monitoring command",
        "severity": "medium",
        "file": "scripts/healthcheck.sh",
        "snippets": [
            "nvidia-smi --query-gpu=name,memory.used --format=csv",
            "watch -n 1 nvidia-smi",
            "python server.py && nvidia-smi",
            "if ! command -v nvidia-smi; then exit 1; fi",
        ],
        "finding": "The validation path depends on nvidia-smi, so it cannot prove GPU visibility on AMD ROCm systems.",
        "recommendation": "Add an AMD-aware health check that captures rocm-smi or amd-smi output and keeps nvidia-smi only in a CUDA-specific script.",
    },
    {
        "category": "CUDA extension build path",
        "severity": "high",
        "file": "setup.py",
        "snippets": [
            "from torch.utils.cpp_extension import CUDAExtension\nsetup(ext_modules=[CUDAExtension('kernels', ['kernel.cu'])])",
            "extra_compile_args={'nvcc': ['-O3', '--use_fast_math']}",
            "sources=['ops/attention.cpp', 'ops/attention_cuda.cu']",
            "CUDA_HOME = os.environ['CUDA_HOME']",
        ],
        "finding": "The project builds CUDA-specific extensions, which may not compile on ROCm without HIP-compatible kernels or alternate wheels.",
        "recommendation": "Isolate CUDA extension builds behind backend flags and add a ROCm path using HIP-compatible kernels, prebuilt ROCm wheels, or a documented CPU fallback.",
    },
    {
        "category": "Distributed runtime assumes NCCL/CUDA",
        "severity": "high",
        "file": "scripts/train_distributed.sh",
        "snippets": [
            "export NCCL_DEBUG=INFO\nexport CUDA_VISIBLE_DEVICES=0,1,2,3\ntorchrun --nproc_per_node=4 train.py",
            "deepspeed --include localhost:0,1,2,3 train.py",
            "os.environ['NCCL_P2P_DISABLE']='0'\ninit_process_group(backend='nccl')",
            "accelerate launch --gpu_ids 0,1,2,3 train.py",
        ],
        "finding": "The distributed launch path assumes CUDA/NCCL semantics and needs explicit ROCm validation before MI300X scaling claims.",
        "recommendation": "Document ROCm distributed environment variables, validate torch.distributed on HIP-backed PyTorch, and keep launch profiles per backend.",
    },
    {
        "category": "CUDA-only attention optimization",
        "severity": "high",
        "file": "requirements.txt",
        "snippets": [
            "flash-attn==2.6.3 --no-build-isolation",
            "triton==2.3.1\nxformers==0.0.27.post2",
            "attn_implementation='flash_attention_2'",
            "from flash_attn import flash_attn_func",
        ],
        "finding": "The workload relies on CUDA-oriented attention optimizations that may fail or behave differently on ROCm.",
        "recommendation": "Add backend-aware attention configuration and test ROCm-supported alternatives before claiming equivalent performance.",
    },
    {
        "category": "Docker Compose GPU reservation",
        "severity": "high",
        "file": "docker-compose.yml",
        "snippets": [
            "deploy:\n  resources:\n    reservations:\n      devices:\n        - driver: nvidia\n          count: all",
            "runtime: nvidia\nenvironment:\n  - NVIDIA_VISIBLE_DEVICES=all",
            "device_requests:\n  - driver: nvidia\n    capabilities: [gpu]",
            "command: docker run --runtime=nvidia app",
        ],
        "finding": "The Compose/runtime configuration requests NVIDIA devices directly, so it will not map cleanly onto AMD Developer Cloud.",
        "recommendation": "Create a ROCm Compose profile with AMD device access and backend-specific environment variables instead of reusing NVIDIA reservations.",
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
    {
        "finding": "Health check runs nvidia-smi.",
        "patch": "Add scripts/healthcheck-rocm.sh that records rocm-smi or amd-smi output, torch.version.hip, and a small inference request.",
    },
    {
        "finding": "setup.py builds CUDAExtension from .cu files.",
        "patch": "Add a backend-gated extension build path and document ROCm-safe alternatives instead of forcing CUDAExtension during install.",
    },
    {
        "finding": "docker-compose.yml reserves driver: nvidia.",
        "patch": "Add compose.rocm.yml with AMD-specific device/env settings and keep the NVIDIA Compose file as a separate profile.",
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
    {
        "evidence": "The repo has distributed launch scripts but no multi-GPU proof.",
        "plan": "Run one single-GPU smoke test first, then a small multi-GPU torch.distributed check with backend, rank count, memory, and throughput logs.",
    },
    {
        "evidence": "The repo uses FlashAttention and reports only latency.",
        "plan": "Benchmark with backend-aware attention settings, record the selected attention implementation, and compare latency only after functional parity is proven.",
    },
]


MEMORY_CASES = [
    {
        "conversation": [
            "Repo Doctor found nvidia-smi in scripts/healthcheck.sh.",
            "Build Runner said this blocks AMD proof because rocm-smi or amd-smi is needed.",
            "Report Agent must not claim live AMD validation until logs are captured.",
        ],
        "memory": "Store that NVIDIA monitoring commands must be replaced with AMD SMI evidence before the report claims ROCm validation.",
    },
    {
        "conversation": [
            "Migration Planner proposed deleting CUDA support entirely.",
            "Build Runner objected because maintainers need dual-backend support.",
            "Orchestrator chose separate ROCm files and profiles.",
        ],
        "memory": "Store that ROCmPilot should preserve CUDA as an optional backend and add separate ROCm paths instead of destructive rewrites.",
    },
    {
        "conversation": [
            "Benchmark Agent saw estimated MI300X numbers.",
            "Report Agent asked how to label them.",
            "Consensus: estimates are static profiles until AMD Developer Cloud logs exist.",
        ],
        "memory": "Store that estimated metrics must be labeled as static ROCmPilot profiles and replaced by live AMD logs when available.",
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


def memory_examples() -> list[dict]:
    rows = []
    for case in MEMORY_CASES:
        rows.append(
            {
                "task": "memory_agent",
                "input": {
                    "conversation": case["conversation"],
                    "memory_scope": "cross-run ROCm migration memory",
                },
                "expected": {
                    "memory_write": case["memory"],
                    "reuse_rule": "Recall this memory in later reports or patch plans when the same blocker appears.",
                },
            }
        )
    return rows


def main() -> None:
    rows = (
        migration_examples()
        + patch_examples()
        + report_examples()
        + benchmark_examples()
        + memory_examples()
    )
    with OUT_PATH.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")
    print(f"Wrote {len(rows)} examples to {OUT_PATH}")


if __name__ == "__main__":
    main()
