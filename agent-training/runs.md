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
