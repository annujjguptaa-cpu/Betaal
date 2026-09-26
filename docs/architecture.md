# System Architecture

```mermaid
flowchart TD
    subgraph Browser Extension
        UI[Popup UI] -->|User selects mode| Policy[Policy Store]
        UI -->|Run Agent| Capture[Capture Screenshot]
        Capture --> Pipeline[processScreenshot]
        Pipeline -->|Load Model| LoadModel["loadFaceModel (per-model cache)"]
        Pipeline -->|Detect Faces| FaceDetect[detectFaces]
        Pipeline -->|Detect PII| PIIDetect[detectSensitivePII]
        Pipeline -->|(optional) Classify| ViT[ViT Classifier]
        Pipeline -->|Redact| Redact[redactImage]
        Pipeline -->|Result| UI
    end
    
    subgraph Build Tools
        Quant[quantize_model.py] -->|Generates| FastModel[face_detector_fast.onnx]
        Quant -->|Copies| BalancedModel[face_detector_balanced.onnx]
    end
    
    Browser Extension -->|Uses| FastModel
    Browser Extension -->|Uses| BalancedModel
```

**Explanation**
- The UI lets the user pick a performance mode, which updates the policy store.
- `processScreenshot` orchestrates the pipeline; for Fast mode it skips ViT classification and loads the quantised model.
- `loadFaceModel` caches ONNX sessions per model path, avoiding repeated downloads.
- The build‑time script (`quantize_model.py`) produces the fast model and ensures the balanced copy exists.
```
