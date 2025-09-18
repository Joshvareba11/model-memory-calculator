# GGUF Metadata Reader (Browser)

A single-file, static web app to read GGUF model metadata directly in the browser and estimate memory usage (RAM/VRAM) for a chosen context window and KV cache quantization.

- Works with remote URLs that support HTTP Range requests (e.g., many Hugging Face files)
- Works with local `.gguf` files (drag-and-drop via file picker)
- Detects sharded models (e.g., `-00001-of-00013`) and sums total size
- No server required; everything runs client-side

## Quick Start

Option A: Open the file directly
1. Open `index.html` in a modern browser (Chrome, Edge, Safari).
2. Paste a GGUF URL or choose a local `.gguf` file and click the corresponding button.

Option B: Serve locally (helps with some CORS setups)
```bash
cd path/to/model-memory-calculator
python -m http.server 8000
# Then open http://localhost:8000 in your browser
```

## Usage

- GGUF URL: Paste a direct link to a `.gguf` (e.g., a Hugging Face “resolve/main” URL). Many hosts allow partial download via HTTP Range.
- Or choose a local GGUF file: Uses the browser’s File API; no upload leaves your machine.
- Context size (tokens): Select the desired context window (e.g., 4K, 16K, 128K).
- KV cache quantization: Choose how keys/values are stored in memory. Options show approximate bytes per value.
- Verbose: Prints debug logs of what’s read and how size is determined.

Click “Read URL” or “Read File”. If successful, you’ll see:
- Extracted params: `attention_heads`, `kv_heads`, `hidden_layers`, `hidden_size`, `split_count` (if present)
- Memory estimate: model size + KV cache size at your chosen context/quantization

## How It Works

- GGUF parsing: Reads just enough of the GGUF header to extract:
  - `.attention.head_count`
  - `.attention.head_count_kv`
  - `.block_count`
  - `.embedding_length`
  - `split.count` (if present)
- Remote file size:
  - Tries `HEAD` to get `Content-Length`.
  - Falls back to a `Range: bytes=0-0` request and reads `Content-Range`.
- Sharded models:
  - Detects `-00001-of-000NN` style patterns in URLs or uses `split.count` metadata.
  - Sums sizes across parts (remote) or estimates total from a single shard (local) when possible.
- KV cache estimate:
  - Uses a simplified formula: `bytes_per_value × hidden_size × hidden_layers × context_tokens`.
  - Shows total as: `Model + KV` (MB/GB). Actual usage can vary by backend/implementation.

## Notes & Limitations

- GGUF versions: Supports GGUF v1–v3 headers for the fields listed above.
- CORS & Range: Remote hosts must allow cross-origin requests and HTTP Range. If not, size detection may fail; download the file and use the local option instead.
- Range ignored: Some servers respond `200` without honoring `Range`. The app avoids downloading the full body for size only; estimates can fail in this case.
- Sanity limits: Very long strings/arrays in metadata are bounded to avoid huge reads.
- Estimates only: KV cache math is intentionally simplified. Different runtimes store KV differently (e.g., layout, precision, per-head factors).

## Troubleshooting

- “Failed to read params.”
  - The file may not be GGUF or uses unsupported/unexpected metadata. Try another file or update the URL.
- “Could not determine file size or compute usage (CORS/Range?).”
  - The remote host may block CORS or not report size via `HEAD`/`Range`. Try serving the page locally, a different host, or the local file picker.
- Split detection issues
  - Ensure URLs use a stable pattern (e.g., `-00001-of-000xx`) or that `split.count` is present in metadata.

## Privacy

- The local file option never uploads your file; parsing happens entirely in your browser.
- For remote URLs, the app performs small range requests to read the header and determine file size. It aborts early once required metadata is read.

## Development

- No build step required. The app is a single page:
  - `index.html` — All logic and UI
- Open in a browser or serve with any static server.

## License

This project is licensed under the terms in `LICENSE`.
