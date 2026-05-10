# ROCmPilot Agent Training Plan

This folder is the seed for the polished version of ROCmPilot. The MVP uses deterministic fixtures plus optional HF/AMD model calls. The next version should improve the agent through supervised examples, evals, and deployment feedback.

## Training Goal

Make the Migration Planner and Report Agent better at:

- Detecting CUDA/NVIDIA assumptions in PyTorch, vLLM, Docker, and shell scripts.
- Producing ROCm-safe migration steps without overstating live benchmark claims.
- Writing concise judge-ready reports with technical proof and business value.

## Data Flywheel

1. Collect repo snippets, Dockerfiles, launch scripts, benchmark logs, and expected ROCm recommendations.
2. Store high-quality examples as JSONL in `seed-examples.jsonl`.
3. Run weekly evals against the rubric in `eval-rubric.md`.
4. Fine-tune or adapter-train a Qwen Coder model on Hugging Face infrastructure when enough examples exist.
5. Serve the trained model through Hugging Face for polish, then swap to AMD ROCm/vLLM when MI300X access is ready.

## Backend Priority

The app already supports this model route order:

1. AMD ROCm/vLLM endpoint via `AMD_QWEN_BASE_URL`
2. Hugging Face Inference Router via `HF_TOKEN`
3. Static fallback report

That means training/polish can happen on Hugging Face now without blocking the later AMD story.

## Practical HF Workflow

1. Create or reuse a Hugging Face dataset repo:

```bash
uv run agent-training/scripts/prepare_dataset.py --push --repo-id Shivam311/rocmpilot-agent-sft
```

2. Launch a small LoRA training job after confirming HF Jobs/paid hardware is available:

```bash
hf jobs uv run \
  --flavor t4-small \
  --timeout 45m \
  --secrets HF_TOKEN \
  --env DATASET_ID=Shivam311/rocmpilot-agent-sft \
  --env OUTPUT_MODEL=Shivam311/rocmpilot-agent-qwen-lora \
  agent-training/scripts/train_rocmpilot_sft.py
```

3. Run the smoke eval against HF Router or a deployed endpoint:

```bash
uv run agent-training/scripts/evaluate_agent.py
```

## Current Polished Run

The current curriculum has 297 examples across:

- Repo Doctor CUDA/NVIDIA scans
- Migration Planner ROCm recommendations
- CUDA/ROCm Coach answers
- Migration Kit downloadable file planning
- AMD endpoint troubleshooting
- Benchmark proof-boundary planning
- Report Agent summaries
- Memory Agent durable decisions
- Multi-agent discussion patterns

The current higher-quality adapter run uses:

```bash
hf jobs uv run \
  --flavor t4-small \
  --timeout 2h \
  --secrets HF_TOKEN \
  --env BASE_MODEL=Qwen/Qwen2.5-Coder-1.5B-Instruct \
  --env DATASET_ID=Shivam311/rocmpilot-agent-sft \
  --env OUTPUT_MODEL=Shivam311/rocmpilot-agent-qwen25-coder-1.5b-lora-v3 \
  --env MAX_STEPS=260 \
  --env MAX_LENGTH=896 \
  --env LORA_R=32 \
  --env LORA_ALPHA=64 \
  --env LEARNING_RATE=1.2e-4 \
  --env GRADIENT_ACCUMULATION_STEPS=8 \
  --env SAVE_STRATEGY=no \
  agent-training/scripts/train_rocmpilot_sft.py
```

`SAVE_STRATEGY=no` avoids the previous intermediate checkpoint metadata issue while still pushing the final LoRA adapter to the Hub at the end of the run.
