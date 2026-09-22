import os
import sys
import argparse
from pathlib import Path
from onnxruntime.quantization import quantize_dynamic, QuantType

def main():
    parser = argparse.ArgumentParser(description="Quantize an ONNX model for the Fast performance mode.")
    parser.add_argument('source_model', nargs='?', default='extension/models/face_detector.onnx',
                        help='Path to the original ONNX model (relative to workspace root)')
    args = parser.parse_args()

    # Resolve absolute paths
    workspace_root = Path(__file__).parent.parent  # workspace root is two levels up from scripts folder
    src_path = (workspace_root / args.source_model).resolve()
    if not src_path.is_file():
        print(f"[ERROR] Source model not found: {src_path}")
        sys.exit(1)

    models_dir = workspace_root / 'extension' / 'models'
    models_dir.mkdir(parents=True, exist_ok=True)

    # Destination paths
    balanced_path = models_dir / 'face_detector_balanced.onnx'
    fast_path = models_dir / 'face_detector_fast.onnx'

    # Copy original to balanced variant (if not already present)
    if not balanced_path.is_file():
        balanced_path.write_bytes(src_path.read_bytes())
        print(f"[INFO] Copied original model to balanced variant: {balanced_path}")
    else:
        print(f"[INFO] Balanced model already exists: {balanced_path}")

    # Quantize to produce fast model
    print(f"[INFO] Quantizing model {src_path} -> {fast_path} ...")
    quantize_dynamic(model_input=str(src_path),
                     model_output=str(fast_path),
                     weight_type=QuantType.QUInt8)

    # Log sizes
    src_size = src_path.stat().st_size
    fast_size = fast_path.stat().st_size
    bal_size = balanced_path.stat().st_size
    print(f"[RESULT] Original size: {src_size/1024:.2f} KB")
    print(f"[RESULT] Balanced copy size: {bal_size/1024:.2f} KB")
    print(f"[RESULT] Fast (quantized) size: {fast_size/1024:.2f} KB ({fast_size/src_size:.2%} of original)")

if __name__ == "__main__":
    main()
