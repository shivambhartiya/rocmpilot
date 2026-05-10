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

## 2026-05-10 AMD MI300X 7B adapter run

- Hardware: AMD Developer Cloud `MI300X`, 1 GPU
- Runtime: ROCm PyTorch inside AMD quick-start `rocm` container
- Base model: `Qwen/Qwen2.5-Coder-7B-Instruct`
- Dataset: https://huggingface.co/datasets/Shivam311/rocmpilot-agent-sft
- Dataset size: 297 examples
- Output model: `Shivam311/rocmpilot-agent-qwen25-coder-7b-lora-amd-mi300x-v1`
- Max steps: `160`
- Max length: `896`
- LoRA: `r=32`, `alpha=64`, `dropout=0.05`
- Learning rate: `1.0e-4`
- Gradient accumulation: `8`
- Checkpoint strategy: `no`, final model push only
- Trackio project: `rocmpilot-amd-mi300x-training`
- Reporting mode: `none` for the final rerun, to avoid the known Trackio Parquet sync issue

Purpose: prove that ROCmPilot's training path can run on AMD infrastructure, not only Hugging Face/NVIDIA Jobs. The run uses the expanded agent curriculum and trains a Qwen Coder 7B LoRA adapter directly on MI300X/ROCm.

Initial proof captured:

- ROCm PyTorch reports HIP support.
- `rocm-smi` shows `AMD Instinct MI300X VF`.
- During training, `rocm-smi` showed roughly `98%` GPU utilization and active VRAM use.

First attempt result: training completed, but final Hub push was blocked by a Trackio Parquet export bug on an empty PEFT pattern field. The final rerun disabled Trackio reporting and called `trainer.save_model()` before Hub push.

Final result: completed and pushed to https://huggingface.co/Shivam311/rocmpilot-agent-qwen25-coder-7b-lora-amd-mi300x-v1

Final metrics from the successful AMD rerun:

- Runtime: `279s`
- Train loss: `0.497`
- Train steps/sec: `0.574`
- Final eval loss: about `0.0447`
- Final eval mean token accuracy: about `0.9816`
- Adapter size: about `323 MB`

After training, the AMD vLLM endpoint was restarted and tested successfully with `Qwen/Qwen2.5-Coder-7B-Instruct`.

The trained LoRA adapter was also loaded in vLLM as `rocmpilot` with:

```bash
--enable-lora \
--max-lora-rank 32 \
--lora-modules rocmpilot=Shivam311/rocmpilot-agent-qwen25-coder-7b-lora-amd-mi300x-v1
```

Direct inference against `model=rocmpilot` succeeded on the MI300X endpoint. The public Vercel app remains configured to use the base `Qwen/Qwen2.5-Coder-7B-Instruct` report model for now because the current SFT adapter is intentionally optimized for structured agent behaviors and emits schema-like outputs. The next dataset revision should add more natural markdown report completions before switching the production report panel to the adapter.

Status: completed.
