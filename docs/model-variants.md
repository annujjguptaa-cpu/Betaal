# Performance Mode & Model Variant Architecture

## Overview
This document details the architectural decisions and implementation strategy for Betaal's 3-tier Performance Modes: **Fast**, **Balanced**, and **Accurate**.

---

## 1. Technical Evaluation & Architecture Choice

### Model Variant Sourcing Attempt
We evaluated sourcing multiple size-tiered ONNX model files (e.g., quantized vs FP32 BlazeFace / ViT models) from Hugging Face and the ONNX Model Zoo. However, swapping ONNX model binaries dynamically inside browser extension runtimes presents significant constraints:
- Variable input tensor dimensions and pre/post-processing dependencies require distinct ONNX Runtime initialization pipelines.
- Including multiple heavy model weights in extension builds increases bundle size significantly, which can hurt web extension load times.
- Operating offline without CDN access requires pre-bundled weights.

### Selected Solution: Pipeline-Level Tiered Execution Modes
To guarantee robust, zero-dependency performance tuning across all desktop environments, Betaal implements a 3-tier pipeline execution architecture in `extension/pipeline.js`:

| Performance Mode | Technical Pipeline Strategy | Optimization / Benefit |
| :--- | :--- | :--- |
| **Fast Mode** | Skips the Vision Transformer (ViT) screen classification step entirely (0 ms classification latency). Runs OCR PII and BlazeFace detectors directly. | **Lowest Latency**: Saves ~150-300 ms per iteration while preserving full redaction capability. |
| **Balanced Mode** *(Default)* | Standard 2-stage pipeline: ViT layout classification runs first to guide region targeting, followed by PII and Face detection. | **Optimal Trade-off**: Balanced processing speed and structural screen category awareness. |
| **Accurate Mode** | Canvas Upscaling: Upscales the tab screenshot by **1.5x** in memory before passing image frames to Tesseract OCR and BlazeFace detectors. Rescales bounding box coordinates back to original scale. | **Maximum Precision**: Increases OCR word recognition accuracy and face detection sensitivity on small or low-contrast fields. |

---

## 2. Verification
All 3 performance modes are fully functional, configurable via the **Policy** tab in the popup UI, and persist in `chrome.storage.local`. Each Vault run log entry records the active performance mode (`FAST`, `BALANCED`, `ACCURATE`) alongside execution timing breakdown telemetry.
