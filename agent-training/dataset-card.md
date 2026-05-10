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

The examples teach ROCmPilot's production-facing agent behaviors:

- `repo_doctor`: scan repository evidence for CUDA/NVIDIA assumptions
- `migration_planner`: identify CUDA/NVIDIA migration blockers and recommend ROCm-safe fixes
- `patch_planner`: convert findings into scoped patch recommendations
- `benchmark_agent`: prepare AMD validation plans without overstating proof
- `report_agent`: write credible migration report sections with clear fallback/live-evidence boundaries
- `memory_agent`: turn agent discussions into reusable long-context memories
- `cuda_rocm_coach`: answer user questions about CUDA, ROCm, PyTorch, vLLM, and proof boundaries
- `endpoint_troubleshooter`: diagnose AMD ROCm/vLLM endpoint states and fallback behavior
- `migration_kit`: plan downloadable migration kits and validation files
- `agent_discussion`: model useful lead/helper agent conversations with memory writes

Current seed size: 297 synthetic examples.

This is still a synthetic seed dataset, but it now covers the full ROCmPilot MVP workflow. Production training should continue adding real repository scans, human-reviewed patch previews, endpoint logs, and post-demo user feedback.
