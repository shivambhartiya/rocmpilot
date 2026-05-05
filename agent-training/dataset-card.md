---
license: mit
task_categories:
- text-generation
language:
- en
tags:
- rocm
- amd
- vllm
- qwen
- code
- agents
pretty_name: ROCmPilot Agent SFT
---

# ROCmPilot Agent SFT

This dataset contains seed supervised fine-tuning examples for ROCmPilot, a multi-agent tool that helps developers migrate PyTorch and vLLM workloads from CUDA/NVIDIA assumptions to AMD ROCm readiness.

The examples teach five agent behaviors:

- `migration_planner`: identify CUDA/NVIDIA migration blockers and recommend ROCm-safe fixes
- `patch_planner`: convert findings into scoped patch recommendations
- `benchmark_agent`: prepare AMD validation plans without overstating proof
- `report_agent`: write credible migration report sections with clear fallback/live-evidence boundaries
- `memory_agent`: turn agent discussions into reusable long-context memories

Current seed size: 95 synthetic examples.

This is an early smoke-training dataset. It is useful for testing the training pipeline and style alignment, but production training should expand it with real repository scans and human-reviewed outputs.
