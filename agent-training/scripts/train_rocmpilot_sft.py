# /// script
# dependencies = ["trl>=0.12.0", "peft>=0.7.0", "datasets>=3.0.0", "transformers>=4.46.0", "accelerate>=1.0.0", "trackio>=0.2.0"]
# ///
"""LoRA SFT training script for the polished ROCmPilot agents.

This script is designed for Hugging Face Jobs. Configure with env vars:

  BASE_MODEL=Qwen/Qwen2.5-Coder-0.5B-Instruct
  DATASET_ID=Shivam311/rocmpilot-agent-sft
  OUTPUT_MODEL=Shivam311/rocmpilot-agent-qwen-lora
  MAX_STEPS=320
  LORA_R=32
  LEARNING_RATE=0.00012
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
MAX_STEPS = int(os.environ.get("MAX_STEPS", "260"))
MAX_LENGTH = int(os.environ.get("MAX_LENGTH", "896"))
LORA_R = int(os.environ.get("LORA_R", "32"))
LORA_ALPHA = int(os.environ.get("LORA_ALPHA", str(LORA_R * 2)))
LORA_DROPOUT = float(os.environ.get("LORA_DROPOUT", "0.05"))
LEARNING_RATE = float(os.environ.get("LEARNING_RATE", "1.2e-4"))
WARMUP_RATIO = float(os.environ.get("WARMUP_RATIO", "0.06"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "1"))
GRADIENT_ACCUMULATION_STEPS = int(os.environ.get("GRADIENT_ACCUMULATION_STEPS", "8"))
EVAL_STEPS = int(os.environ.get("EVAL_STEPS", "25"))
LOGGING_STEPS = int(os.environ.get("LOGGING_STEPS", "5"))
SEED = int(os.environ.get("SEED", "42"))
SAVE_STRATEGY = os.environ.get("SAVE_STRATEGY", "no")
RUN_NAME = os.environ.get("RUN_NAME", "rocmpilot-sft-lora-v3")
TRACKIO_PROJECT = os.environ.get("TRACKIO_PROJECT", "rocmpilot-agent-training")


def main() -> None:
    dataset = load_dataset(DATASET_ID, split="train")
    split = dataset.train_test_split(test_size=0.12, seed=SEED) if len(dataset) >= 50 else None
    bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    fp16 = torch.cuda.is_available() and not bf16

    trainer = SFTTrainer(
        model=BASE_MODEL,
        train_dataset=split["train"] if split else dataset,
        eval_dataset=split["test"] if split else None,
        peft_config=LoraConfig(
            r=LORA_R,
            lora_alpha=LORA_ALPHA,
            lora_dropout=LORA_DROPOUT,
            target_modules="all-linear",
            task_type="CAUSAL_LM",
        ),
        args=SFTConfig(
            output_dir="rocmpilot-agent",
            push_to_hub=True,
            hub_model_id=OUTPUT_MODEL,
            max_steps=MAX_STEPS,
            max_length=MAX_LENGTH,
            per_device_train_batch_size=BATCH_SIZE,
            gradient_accumulation_steps=GRADIENT_ACCUMULATION_STEPS,
            learning_rate=LEARNING_RATE,
            warmup_ratio=WARMUP_RATIO,
            logging_steps=LOGGING_STEPS,
            eval_strategy="steps" if split else "no",
            eval_steps=EVAL_STEPS,
            save_strategy=SAVE_STRATEGY,
            save_steps=80,
            save_total_limit=2,
            report_to="trackio",
            project=TRACKIO_PROJECT,
            run_name=RUN_NAME,
            bf16=bf16,
            fp16=fp16,
            gradient_checkpointing=True,
            seed=SEED,
        ),
    )

    trainer.train()
    trainer.push_to_hub()


if __name__ == "__main__":
    main()
