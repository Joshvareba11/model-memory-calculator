# Memory Calculation Methodology

## Overview

This document describes the mathematical foundation for calculating the total memory requirements of Large Language Models (LLMs) in GGUF format during inference. The total memory consumption consists of two primary components: **model weights** and **KV cache**.

## Mathematical Formulation

### Total Memory Requirement

The total memory required for inference is given by:

$$
M_{\text{total}} = M_{\text{model}} + M_{\text{KV}}
$$

where:
- $M_{\text{total}}$ = Total memory requirement (in bytes)
- $M_{\text{model}}$ = Memory occupied by model weights (in bytes)
- $M_{\text{KV}}$ = Memory occupied by Key-Value cache (in bytes)

---

## 1. Model Memory ($M_{\text{model}}$)

The model memory is determined by the size of the quantized weight file(s):

$$
M_{\text{model}} = \sum_{i=1}^{n} S_i
$$

where:
- $S_i$ = Size of the $i$-th model shard file (in bytes)
- $n$ = Number of split/shard files

**For single-file models:** $n = 1$, so $M_{\text{model}} = S_1$

**For multi-shard models:** The metadata field `split.count` indicates the total number of shards, and all shards must be summed.

---

## 2. KV Cache Memory ($M_{\text{KV}}$)

The KV cache stores intermediate key and value tensors for each attention layer during inference. Its size depends on:

1. **Model Architecture Parameters**
2. **Context Length**
3. **Quantization Precision**

### Formula

$$
M_{\text{KV}} = 2 \times n_{\text{layers}} \times n_{\text{heads}}^{\text{KV}} \times d_{\text{head}} \times C \times b_{\text{KV}}
$$

where:
- $n_{\text{layers}}$ = Number of transformer layers (from GGUF metadata: `*.block_count`)
- $n_{\text{heads}}^{\text{KV}}$ = Number of key-value attention heads (from GGUF metadata: `*.attention.head_count_kv`)
- $d_{\text{head}}$ = Dimension per attention head
- $C$ = Context size in tokens (user-specified)
- $b_{\text{KV}}$ = Bytes per value for KV cache quantization (user-specified)
- Factor of 2 accounts for both **Key** and **Value** tensors

### Simplification Using Hidden Size

In practice, the calculation can be simplified using the **hidden size** ($d_{\text{model}}$):

$$
d_{\text{model}} = n_{\text{heads}} \times d_{\text{head}}
$$

where $n_{\text{heads}}$ is the total number of attention heads (from GGUF metadata: `*.attention.head_count`).

For models with **Grouped Query Attention (GQA)** or **Multi-Query Attention (MQA)**, the KV heads may differ from the query heads. The effective KV dimension is:

$$
d_{\text{KV}} = n_{\text{heads}}^{\text{KV}} \times d_{\text{head}} = d_{\text{model}} \times \frac{n_{\text{heads}}^{\text{KV}}}{n_{\text{heads}}}
$$

Thus, the KV cache formula becomes:

$$
M_{\text{KV}} = 2 \times n_{\text{layers}} \times d_{\text{model}} \times \frac{n_{\text{heads}}^{\text{KV}}}{n_{\text{heads}}} \times C \times b_{\text{KV}}
$$

### Practical Implementation

Since $d_{\text{model}}$ (stored as `*.embedding_length` in GGUF metadata) is directly available, the implementation uses:

$$
M_{\text{KV}} = 2 \times b_{\text{KV}} \times d_{\text{model}} \times n_{\text{layers}} \times C
$$

**Note:** This assumes the ratio $\frac{n_{\text{heads}}^{\text{KV}}}{n_{\text{heads}}} = 1$ for standard Multi-Head Attention. For GQA/MQA models, this ratio should be explicitly accounted for if the hidden size reflects query heads only.

---

## 3. KV Cache Quantization ($b_{\text{KV}}$)

The precision of the KV cache significantly impacts memory usage. Supported quantization formats:

| Format | Precision | Bytes per Value ($b_{\text{KV}}$) |
|--------|-----------|-------------------------------------|
| **FP32** | 32-bit floating point | 8.0 |
| **FP16/BF16** | 16-bit floating point | 4.0 |
| **INT8** | 8-bit integer | 2.0 |
| **Q6** | 6-bit quantized | 1.5 |
| **Q5** | 5-bit quantized | 1.25 |
| **Q4** | 4-bit quantized | 1.0 |

**Note:** The factor of 2 (accounting for separate Key and Value storage) effectively doubles these values in the final calculation.

---

## 4. GGUF Metadata Extraction

The calculator extracts the following parameters from GGUF file metadata:

| Parameter | GGUF Metadata Key | Symbol | Description |
|-----------|-------------------|--------|-------------|
| **Attention Heads** | `*.attention.head_count` | $n_{\text{heads}}$ | Total number of query heads |
| **KV Heads** | `*.attention.head_count_kv` | $n_{\text{heads}}^{\text{KV}}$ | Number of key-value heads (for GQA/MQA) |
| **Hidden Layers** | `*.block_count` | $n_{\text{layers}}$ | Number of transformer blocks/layers |
| **Hidden Size** | `*.embedding_length` | $d_{\text{model}}$ | Model embedding dimension |
| **Split Count** | `split.count` | $n$ | Number of model shards (optional) |

**Fallback Logic:**
- If `*.attention.head_count_kv` is not present, the calculator assumes $n_{\text{heads}}^{\text{KV}} = n_{\text{heads}}$ (standard MHA).

---

## 5. Example Calculation

### Given Parameters:
- Model file size: $M_{\text{model}} = 15{,}000$ MB
- Context size: $C = 8{,}192$ tokens
- Hidden layers: $n_{\text{layers}} = 32$
- Hidden size: $d_{\text{model}} = 4{,}096$
- KV cache quantization: FP16 ($b_{\text{KV}} = 4.0$ bytes/value)

### KV Cache Calculation:

$$
\begin{align*}
M_{\text{KV}} &= 2 \times b_{\text{KV}} \times d_{\text{model}} \times n_{\text{layers}} \times C \\
&= 2 \times 4.0 \times 4{,}096 \times 32 \times 8{,}192 \\
&= 8.0 \times 4{,}096 \times 32 \times 8{,}192 \\
&= 8{,}589{,}934{,}592 \text{ bytes} \\
&= 8{,}589.93 \text{ MB} \\
&\approx 8.59 \text{ GB}
\end{align*}
$$

### Total Memory:

$$
\begin{align*}
M_{\text{total}} &= M_{\text{model}} + M_{\text{KV}} \\
&= 15{,}000 \text{ MB} + 8{,}589.93 \text{ MB} \\
&= 23{,}589.93 \text{ MB} \\
&\approx 23.59 \text{ GB}
\end{align*}
$$

**Result:** The model requires approximately **23.6 GB** of memory for inference at 8K context.

---

## 6. Implementation Notes

### Memory Unit Conversion

The calculator uses the following conversion:

$$
1 \text{ MB} = 1{,}000{,}000 \text{ bytes} \quad (\text{decimal, not binary})
$$

$$
1 \text{ GB} = 1{,}000 \text{ MB} = 1{,}000{,}000{,}000 \text{ bytes}
$$

### Split/Sharded Models

For models distributed across multiple files (shards):

1. Parse split pattern from filename: `*-XXXXX-of-YYYYY.gguf`
2. Read `split.count` from metadata of the first shard
3. Sum file sizes: $M_{\text{model}} = \sum_{i=1}^{n} S_i$
4. Calculate KV cache using parameters from **any shard** (all shards share the same architecture)

### HTTP Range Requests

For remote files (URLs), the calculator:
1. Uses HTTP Range requests to read only the file header and metadata
2. Extracts file size from `Content-Length` or `Content-Range` headers
3. Minimizes data transfer by aborting after metadata extraction

---

## 7. Optimization Considerations

### Reducing KV Cache Memory

To reduce $M_{\text{KV}}$, one can:

1. **Decrease context size** ($C$): Linear relationship
   $$M_{\text{KV}} \propto C$$

2. **Use aggressive KV quantization** ($b_{\text{KV}}$): Linear relationship
   - Switching from FP16 (4.0 bytes) to Q4 (1.0 bytes) reduces KV cache by **75%**

3. **Model architecture selection**: Choose models with fewer layers ($n_{\text{layers}}$) or smaller hidden size ($d_{\text{model}}$)

### Trade-offs

| Optimization | Memory Savings | Quality Impact |
|--------------|----------------|----------------|
| Reduce context size | High | None (within capacity) |
| KV quantization (Q8) | Moderate | Minimal |
| KV quantization (Q4) | High | Moderate (precision loss) |
| Smaller model | High | Significant (capacity loss) |

---

## References

- **GGUF Format Specification**: [ggml/docs/gguf.md](https://github.com/ggerganov/ggml/blob/master/docs/gguf.md)
- **Transformer Architecture**: Vaswani et al., "Attention Is All You Need" (2017)
- **KV Cache Optimization**: Pope et al., "Efficiently Scaling Transformer Inference" (2022)

---

## Version History

- **v1.0** (2025-10-02): Initial documentation with mathematical formulation and examples
