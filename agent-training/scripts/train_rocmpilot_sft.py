# /// script
# dependencies = ["trl>=0.12.0", "peft>=0.7.0", "datasets>=3.0.0", "transformers>=4.46.0", "accelerate>=1.0.0", "trackio"]
# ///
"""LoRA SFT training script for the polished ROCmPilot agents.

This script is designed for Hugging Face Jobs. Configure with env vars:

  BASE_MODEL=Qwen/Qwen2.5-Coder-0.5B-Instruct
  DATASET_ID=Shivam311/rocmpilot-agent-sft
  OUTPUT_MODEL=Shivam311/rocmpilot-agent-qwen-lora
"""

from __future__ import annotations

import os

from datasets import load_dataset
from peft import LoraConfig
import torch
from trl import SFTConfig, SFTTrainer


BASE_MODEL = os.environ.get("BASE_MODEL", "Qwen/Qwen2.5-Coder-0.5B-Instruct")
DATASET_ID = os.environ.get("DATASET_ID", "Shivam311/rocmpilot-agent-sft")
OUTPUT_MODEL = os.environ.get("OUTPUT_MODEL", "Shivam311/rocmpilot-agent-qwen-lora")
MAX_STEPS = int(os.environ.get("MAX_STEPS", "80"))


def main() -> None:
    dataset = load_dataset(DATASET_ID, split="train")
    bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    fp16 = torch.cuda.is_available() and not bf16

    trainer = SFTTrainer(
        model=BASE_MODEL,
        train_dataset=dataset,
        peft_config=LoraConfig(
            r=16,
            lora_alpha=32,
            lora_dropout=0.05,
            target_modules="all-linear",
            task_type="CAUSAL_LM",
        ),
        args=SFTConfig(
            output_dir="rocmpilot-agent",
            push_to_hub=True,
            hub_model_id=OUTPUT_MODEL,
            max_steps=MAX_STEPS,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=4,
            learning_rate=2e-4,
            warmup_ratio=0.05,
            logging_steps=5,
            save_steps=40,
            report_to="trackio",
            project="rocmpilot",
            run_name="rocmpilot-sft-lora",
            bf16=bf16,
            fp16=fp16,
        ),
    )

    trainer.train()
    trainer.push_to_hub()


if __name__ == "__main__":
    main()
