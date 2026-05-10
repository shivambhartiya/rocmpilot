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


COACH_CASES = [
    {
        "question": "Why does torch.cuda still appear on ROCm?",
        "answer": "Explain that HIP-backed PyTorch intentionally exposes much of the torch.cuda API on ROCm, so the agent should inspect torch.version.hip, package wheels, container base image, and runtime logs before treating every torch.cuda call as a blocker.",
        "must_do": "Separate API compatibility from NVIDIA-only assumptions.",
    },
    {
        "question": "Should I delete CUDA support when adding ROCm?",
        "answer": "Recommend dual-backend support: preserve CUDA paths, add ROCm profiles, and make backend selection explicit through config, scripts, or containers.",
        "must_do": "Avoid destructive migration advice.",
    },
    {
        "question": "How do I prove the model actually ran on AMD?",
        "answer": "Ask for rocm-smi or amd-smi output, vLLM startup logs, model id, endpoint URL, one successful completion, and benchmark metadata with p50/p95 latency and tokens/sec.",
        "must_do": "Require evidence before live AMD claims.",
    },
    {
        "question": "What should replace nvidia-smi in health checks?",
        "answer": "Use rocm-smi or amd-smi for AMD visibility while keeping nvidia-smi in a CUDA-specific profile if the project supports both backends.",
        "must_do": "Preserve backend-specific health checks.",
    },
    {
        "question": "Can I use vLLM on MI300X?",
        "answer": "Guide the user toward ROCm-compatible vLLM images, conservative max model length, explicit model id, OpenAI-compatible serving, and captured logs for proof.",
        "must_do": "Tie the answer to ROCm/vLLM operational evidence.",
    },
    {
        "question": "Does a Hugging Face fallback weaken the AMD story?",
        "answer": "Say no if it is framed honestly: fallback keeps the demo reliable, while AMD endpoint logs prove the upgraded path when available.",
        "must_do": "Explain fallback without overstating AMD availability.",
    },
]


ENDPOINT_CASES = [
    {
        "status": "AMD_QWEN_BASE_URL configured but connection refused",
        "diagnosis": "The droplet or vLLM server is down, blocked by firewall, or not listening on the expected port.",
        "fix": "Verify the droplet is running, check docker ps, inspect vLLM logs, test /v1/models locally, then test the public URL.",
    },
    {
        "status": "AMD endpoint returns 401",
        "diagnosis": "The configured AMD_QWEN_API_KEY does not match the vLLM server api key.",
        "fix": "Rotate the server key or update Vercel's AMD_QWEN_API_KEY, then redeploy or redeploy the function environment.",
    },
    {
        "status": "AMD endpoint times out then HF works",
        "diagnosis": "Fallback is behaving correctly; the AMD path is unavailable or too slow for the report timeout.",
        "fix": "Keep HF fallback active for demos and only claim AMD-connected reports after the Report Agent source is amd-vllm.",
    },
    {
        "status": "Model id mismatch between app and vLLM",
        "diagnosis": "The app sent a model name that vLLM did not serve.",
        "fix": "Set AMD_QWEN_MODEL to the exact served model id from /v1/models.",
    },
    {
        "status": "vLLM loads but OOMs on first request",
        "diagnosis": "The serving profile is too aggressive for the selected model length, batch shape, or GPU memory utilization.",
        "fix": "Reduce max model length, lower gpu memory utilization, use a smaller Qwen model, and capture the new startup logs.",
    },
]


KIT_CASES = [
    {
        "repo_profile": "small PyTorch inference repo with hardcoded .cuda() calls",
        "kit": [
            "device resolver module",
            "ROCm smoke test command",
            "patch preview replacing .cuda() with .to(device)",
            "README note about HIP-backed torch.cuda behavior",
        ],
    },
    {
        "repo_profile": "vLLM serving repo using nvidia/cuda Docker base",
        "kit": [
            "Dockerfile.rocm",
            "serve-rocm.sh",
            "OpenAI-compatible curl test",
            "vLLM startup log checklist",
        ],
    },
    {
        "repo_profile": "benchmark repo with only average latency",
        "kit": [
            "benchmark_rocm.py",
            "p50 and p95 latency fields",
            "tokens/sec output",
            "backend and GPU metadata capture",
        ],
    },
    {
        "repo_profile": "Docker Compose stack reserving driver: nvidia",
        "kit": [
            "compose.rocm.yml",
            "backend-specific environment variables",
            "AMD device visibility command",
            "dual-backend launch instructions",
        ],
    },
    {
        "repo_profile": "repo with CUDAExtension and .cu kernels",
        "kit": [
            "backend-gated extension build",
            "ROCm compatibility warning",
            "prebuilt wheel fallback option",
            "HIP porting TODO list",
        ],
    },
]


DISCUSSION_CASES = [
    {
        "lead": "Repo Doctor",
        "helpers": ["Migration Planner", "Build Runner"],
        "topic": "Dockerfile uses nvidia/cuda and the launch script uses --gpus all.",
        "consensus": "Keep the NVIDIA path as a CUDA profile, add a ROCm Dockerfile and serve script, and ask Build Runner to verify AMD container startup.",
    },
    {
        "lead": "Benchmark Agent",
        "helpers": ["Report Agent", "Memory Agent"],
        "topic": "The app has only estimated throughput numbers.",
        "consensus": "Report estimates as planning profiles, store the proof boundary in memory, and require live vLLM plus ROCm logs before claiming AMD measurements.",
    },
    {
        "lead": "Migration Planner",
        "helpers": ["CUDA/ROCm Coach", "Migration Kit Agent"],
        "topic": "torch.cuda appears throughout the repo but PyTorch on ROCm may still expose that API.",
        "consensus": "Do not blindly replace every torch.cuda symbol; add backend detection, inspect torch.version.hip, and patch only NVIDIA-only assumptions.",
    },
    {
        "lead": "Report Agent",
        "helpers": ["Repo Doctor", "Benchmark Agent"],
        "topic": "The user wants a judge-ready report after AMD endpoint setup.",
        "consensus": "Mention Report Agent source only if it is amd-vllm, include model id and endpoint evidence, and avoid workload benchmark claims unless benchmark logs exist.",
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


def repo_doctor_examples() -> list[dict]:
    rows = []
    reviewer_contexts = [
        "first pass scan before planning",
        "GitHub URL audit for a maintainer",
        "pre-demo readiness triage",
    ]
    for case in MIGRATION_CASES:
        for snippet in case["snippets"]:
            for context in reviewer_contexts:
                rows.append(
                    {
                        "task": "repo_doctor",
                        "input": {
                            "file": case["file"],
                            "snippet": snippet,
                            "context": context,
                        },
                        "expected": {
                            "detected_issue": case["category"],
                            "severity": case["severity"],
                            "evidence": snippet.splitlines()[0],
                            "handoff": "Ask Migration Planner for a ROCm-safe recommendation and Build Runner for validation commands.",
                        },
                    }
                )
    return rows


def coach_examples() -> list[dict]:
    rows = []
    audiences = ["developer", "founder", "infra lead", "hackathon judge"]
    for case in COACH_CASES:
        for audience in audiences:
            rows.append(
                {
                    "task": "cuda_rocm_coach",
                    "input": {
                        "audience": audience,
                        "question": case["question"],
                    },
                    "expected": {
                        "answer": case["answer"],
                        "must_do": case["must_do"],
                        "tone": "direct, helpful, and honest about proof boundaries",
                    },
                }
            )
    return rows


def endpoint_examples() -> list[dict]:
    rows = []
    stages = ["local droplet test", "Vercel production report", "demo day fallback"]
    for case in ENDPOINT_CASES:
        for stage in stages:
            rows.append(
                {
                    "task": "endpoint_troubleshooter",
                    "input": {
                        "stage": stage,
                        "status": case["status"],
                    },
                    "expected": {
                        "diagnosis": case["diagnosis"],
                        "fix": case["fix"],
                        "fallback_rule": "If AMD fails, use Hugging Face before deterministic fallback and label the source truthfully.",
                    },
                }
            )
    return rows


def migration_kit_examples() -> list[dict]:
    rows = []
    formats = ["downloadable markdown", "maintainer checklist", "patch preview package"]
    for case in KIT_CASES:
        for output_format in formats:
            rows.append(
                {
                    "task": "migration_kit",
                    "input": {
                        "repo_profile": case["repo_profile"],
                        "output_format": output_format,
                    },
                    "expected": {
                        "kit_sections": case["kit"],
                        "safety_boundary": "Generate files and patch previews for review; do not claim the upstream repo was modified.",
                    },
                }
            )
    return rows


def agent_discussion_examples() -> list[dict]:
    rows = []
    constraints = [
        "ask at least two helper agents before finalizing",
        "store the reusable decision in memory",
        "separate live proof from fallback behavior",
        "produce one owner and one next action",
    ]
    for case in DISCUSSION_CASES:
        for constraint in constraints:
            rows.append(
                {
                    "task": "agent_discussion",
                    "input": {
                        "lead": case["lead"],
                        "helpers": case["helpers"],
                        "topic": case["topic"],
                        "constraint": constraint,
                    },
                    "expected": {
                        "discussion_pattern": f"{case['lead']} leads, asks {', '.join(case['helpers'])}, resolves objections, and records memory.",
                        "consensus": case["consensus"],
                        "next_action": constraint,
                    },
                }
            )
    return rows


def main() -> None:
    rows = (
        repo_doctor_examples()
        + migration_examples()
        + patch_examples()
        + report_examples()
        + benchmark_examples()
        + memory_examples()
        + coach_examples()
        + endpoint_examples()
        + migration_kit_examples()
        + agent_discussion_examples()
    )
    with OUT_PATH.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")
    print(f"Wrote {len(rows)} examples to {OUT_PATH}")


if __name__ == "__main__":
    main()
