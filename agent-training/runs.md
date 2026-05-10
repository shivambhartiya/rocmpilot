# ROCmPilot Training Runs

## Smoke LoRA SFT Run

- Date: 2026-05-04
- Job ID: `69f8d3049d85bec4d76f2451`
- Job URL: https://huggingface.co/jobs/Shivam311/69f8d3049d85bec4d76f2451
- Dataset: https://huggingface.co/datasets/Shivam311/rocmpilot-agent-sft
- Output model: https://huggingface.co/Shivam311/rocmpilot-agent-qwen-lora
- Base model: `Qwen/Qwen2.5-Coder-0.5B-Instruct`
- Hardware: `t4-small`
- Timeout: `45m`
- Max steps: `80`

Purpose: prove the Hugging Face training pipeline and produce a first LoRA adapter. This is not expected to be a production-quality model because the dataset currently has 57 synthetic seed examples.

Result: failed at checkpoint sync. Training reached step 40/80, then Trackio crashed while writing checkpoint metadata to Parquet (`rank_pattern` empty struct). The trainer was patched to disable Trackio and checkpoint saving for the smoke run; final push happens only after training completes.

## 2026-05-04 smoke run fix

- Job: https://huggingface.co/jobs/Shivam311/69f8d50998a8d679adfb9076
- Dataset: `Shivam311/rocmpilot-agent-sft`
- Base model: `Qwen/Qwen2.5-Coder-0.5B-Instruct`
- Output model: `Shivam311/rocmpilot-agent-qwen-lora`
- Hardware: Hugging Face Jobs `t4-small`
- Max steps: `50`

Result: completed. The run finished all 50 SFT steps and pushed the LoRA adapter, tokenizer, and training arguments to the output model repo.

## 2026-05-05 dataset expansion

- Dataset size: 95 examples
- Added categories:
  - NVIDIA monitoring commands such as `nvidia-smi`
  - CUDA extension builds using `CUDAExtension` or `.cu` sources
  - distributed launch assumptions around CUDA/NCCL
  - FlashAttention/Triton/xFormers portability risks
  - Docker Compose NVIDIA GPU reservations
  - Memory Agent examples for Synap-style long-context decisions
- Training script changes:
  - increased default `MAX_STEPS` to `160`
  - added eval split when the dataset has at least 50 examples
  - added checkpointing and Trackio reporting
  - added `MAX_LENGTH` env control

Recommended next run:

```bash
hf jobs uv run \
  --flavor t4-small \
  --timeout 90m \
  --secrets HF_TOKEN \
  --env DATASET_ID=Shivam311/rocmpilot-agent-sft \
  --env OUTPUT_MODEL=Shivam311/rocmpilot-agent-qwen-lora-v2 \
  --env MAX_STEPS=160 \
  agent-training/scripts/train_rocmpilot_sft.py
```

## 2026-05-10 polished 1.5B adapter run

- Job: https://huggingface.co/jobs/Shivam311/6a0012de317220dbbd1a74a9
- Dataset: https://huggingface.co/datasets/Shivam311/rocmpilot-agent-sft
- Dataset size: 297 examples
- Base model: `Qwen/Qwen2.5-Coder-1.5B-Instruct`
- Output model: `Shivam311/rocmpilot-agent-qwen25-coder-1.5b-lora-v3`
- Hardware: Hugging Face Jobs `t4-small`
- Timeout: `2h`
- Max steps: `260`
- Max length: `896`
- LoRA: `r=32`, `alpha=64`, `dropout=0.05`
- Learning rate: `1.2e-4`
- Gradient accumulation: `8`
- Checkpoint strategy: `no`, final model push only

Purpose: train a more serious ROCmPilot adapter over the expanded agent curriculum, including Repo Doctor scans, CUDA/ROCm Coach answers, Migration Kit generation, endpoint troubleshooting, proof-boundary reporting, and multi-agent memory behavior.

Status: submitted; initial HF stage was `SCHEDULING`.
