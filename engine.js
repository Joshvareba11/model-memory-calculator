const logEl = document.getElementById('Log');
const logQueue = [];
let isLogging = false;

function log(...args) {
    logQueue.push(args.join(' '));
    if (!isLogging) processLogQueue();
}

function processLogQueue() {
    if (logQueue.length === 0) {
        isLogging = false;
        return;
    }
    isLogging = true;
    const text = logQueue.shift();
    const line = document.createElement('p');
    line.className = "text-14px reguler";
    line.textContent = text;
    line.style.opacity = 0;
    line.style.transition = "opacity 0.4s ease";
    logEl.appendChild(line);

    void line.offsetWidth;
    line.style.opacity = 1;
    line.scrollIntoView({ behavior: "smooth", block: "end" });

    setTimeout(processLogQueue, 100);
}
function clearLog() { logEl.textContent = ''; }

class DataSource {
    async read(buffer, size) { throw new Error('not implemented'); }
    async seek(position) { throw new Error('not implemented'); }
    eof() { throw new Error('not implemented'); }
    tell() { throw new Error('not implemented'); }
}


const BUFFER_SIZE = 1 << 20;
const CHUNK_SIZE = 1 << 18;
class UrlDataSource extends DataSource {
    constructor(url, { verbose = false } = {}) {
        super();
        this.url = url;
        this.verbose = verbose;
        this.currentPos = 0;
        this._eof = false;
        this.abortDownload = false;
        this.downloadedData = new Uint8Array(BUFFER_SIZE);
        this.bufferSize = 0;
        this.bufferPos = 0;
    }
    async _fetchRange(start, endExclusive) {
        if (this.abortDownload) return new Uint8Array(0);
        const endInclusive = endExclusive - 1;
        if (this.verbose) log(`[HTTP] GET Range: bytes=${start}-${endInclusive}`);
        const res = await fetch(this.url, { headers: { Range: `bytes=${start}-${endInclusive}` } });
        if (!res.ok && res.status !== 206 && res.status !== 200) throw new Error(`HTTP error ${res.status}`);
        const arr = new Uint8Array(await res.arrayBuffer());
        if (res.status === 200 && start > 0) {
            if (this.verbose) log('[HTTP] Warning: server ignored Range; received full body with 200.');
            if (arr.length <= start) return new Uint8Array(0);
            return arr.subarray(start, Math.min(arr.length, endExclusive));
        }
        return arr;
    }
    async read(buffer, size) {
        while (this.bufferPos + size > this.bufferSize) {
            if (this.bufferPos >= this.bufferSize) { this.bufferSize = 0; this.bufferPos = 0; }
            if (this.bufferPos > 0 && this.bufferSize > this.bufferPos) {
                this.downloadedData.copyWithin(0, this.bufferPos, this.bufferSize);
                this.bufferSize -= this.bufferPos; this.bufferPos = 0;
            }
            const wantStart = this.currentPos + this.bufferSize;
            const chunkEnd = wantStart + CHUNK_SIZE;
            const neededCapacity = this.bufferSize + CHUNK_SIZE;
            if (neededCapacity > this.downloadedData.length) {
                const newBuf = new Uint8Array(Math.max(this.downloadedData.length * 2, neededCapacity));
                newBuf.set(this.downloadedData.subarray(0, this.bufferSize), 0);
                this.downloadedData = newBuf;
            }
            if (this.abortDownload) { this._eof = true; return false; }
            const arr = await this._fetchRange(wantStart, chunkEnd);
            if (arr.length === 0) { this._eof = true; return false; }
            this.downloadedData.set(arr, this.bufferSize);
            this.bufferSize += arr.length;
        }
        const copySize = Math.min(size, this.bufferSize - this.bufferPos);
        buffer.set(this.downloadedData.subarray(this.bufferPos, this.bufferPos + copySize), 0);
        this.bufferPos += copySize;
        this.currentPos += copySize;
        return copySize === size;
    }
    async seek(position) {
        if (position >= this.currentPos - this.bufferPos && position < this.currentPos + (this.bufferSize - this.bufferPos)) {
            this.bufferPos = position - (this.currentPos - this.bufferPos);
            this.currentPos = position; return true;
        }
        this.bufferSize = 0; this.bufferPos = 0; this.currentPos = position; this._eof = false; return true;
    }
    eof() { return this._eof; }
    tell() { return this.currentPos; }
    setAbortFlag() { this.abortDownload = true; }
}

const GGUFType = Object.freeze({
    UINT8: 0,
    INT8: 1,
    UINT16: 2,
    INT16: 3,
    UINT32: 4,
    INT32: 5,
    FLOAT32: 6,
    BOOL: 7,
    STRING: 8,
    ARRAY: 9,
    UINT64: 10,
    INT64: 11,
    FLOAT64: 12,
    MAX_TYPE: 13,
});

function readUIntLE(buf, offset, byteLength) {
    let val = 0n;
    for (let i = 0; i < byteLength; i++) val |= BigInt(buf[offset + i]) << BigInt(8 * i);
    return val;
}
function formatMemorySize(mb) {
    const n = Number(mb);
    if (n >= 1000) return (n / 1000).toFixed(1) + ' GB';
    return n + ' MB';
}
async function readExact(source, size) { const buf = new Uint8Array(size); const ok = await source.read(buf, size); if (!ok) throw new Error('Failed to read required bytes'); return buf; }
async function readU32(source) { const b = await readExact(source, 4); return Number(readUIntLE(b, 0, 4)); }
async function readU64(source) { const b = await readExact(source, 8); return Number(readUIntLE(b, 0, 8)); }
async function readString(source) {
    const len = await readU64(source);
    if (len > 1024 * 1024) throw new Error(`String too long: ${len}`);
    const data = len > 0 ? await readExact(source, Number(len)) : new Uint8Array();
    return new TextDecoder().decode(data);
}
async function skipArray(source, elemType) {
    const count = await readU64(source);
    if (count > 1000000) throw new Error(`Array count too large: ${count}`);
    for (let i = 0; i < Number(count); i++) await skipValue(source, elemType);
}
async function skipValue(source, type) {
    switch (type) {
        case GGUFType.UINT8:
        case GGUFType.INT8:
            await source.seek(source.tell() + 1); break;
        case GGUFType.UINT16:
        case GGUFType.INT16:
            await source.seek(source.tell() + 2); break;
        case GGUFType.UINT32:
        case GGUFType.INT32:
        case GGUFType.FLOAT32:
            await source.seek(source.tell() + 4); break;
        case GGUFType.BOOL:
            await source.seek(source.tell() + 1); break;
        case GGUFType.STRING: {
            const length = await readU64(source);
            if (length > 1024 * 1024) throw new Error(`String too long: ${length}`);
            await source.seek(source.tell() + Number(length));
            break;
        }
        case GGUFType.ARRAY: {
            const elemTypeVal = await readU32(source);
            if (elemTypeVal >= GGUFType.MAX_TYPE) throw new Error(`Invalid array element type: ${elemTypeVal}`);
            await skipArray(source, elemTypeVal);
            break;
        }
        case GGUFType.UINT64:
        case GGUFType.INT64:
        case GGUFType.FLOAT64:
            await source.seek(source.tell() + 8); break;
        default:
            throw new Error(`Unknown GGUF type: ${type}`);
    }
}

async function readModelParams(pathOrFile, { verbose = false } = {}) {
    const isUrl = typeof pathOrFile === 'string';
    const source = isUrl ? new UrlDataSource(pathOrFile, { verbose }) : new BrowserFileDataSource(pathOrFile);

    const magic = await readU32(source);
    if (magic !== 0x46554747) { if (verbose) log(`Invalid GGUF file format. Magic number: 0x${magic.toString(16)}`); return null; }

    const version = await readU32(source);
    if (version > 3) { if (verbose) log(`Unsupported GGUF version: ${version}`); return null; }
    if (verbose) log(`GGUF version: ${version}`);

    let tensorCount = 0;
    if (version >= 1) { tensorCount = Number(await readU64(source)); if (verbose) log(`Tensor count: ${tensorCount}`); }

    const metadataCount = Number(await readU64(source));
    if (verbose) log(`Metadata count: ${metadataCount}`);

    const suffixes = [
        '.attention.head_count',
        '.attention.head_count_kv',
        '.block_count',
        '.embedding_length',
    ];

    const params = {};
    const found = { attention_heads: false, kv_heads: false, hidden_layers: false, hidden_size: false };

    for (let i = 0; i < metadataCount && !source.eof(); i++) {
        let key;
        try { key = await readString(source); } catch (e) { throw new Error(`Failed to read key: ${e.message}`); }

        const typeVal = await readU32(source);
        if (typeVal >= GGUFType.MAX_TYPE) throw new Error(`Invalid metadata type: ${typeVal} for key: ${key}`);
        const type = typeVal;
        if (verbose) log(`Key: ${key}, Type: ${type}`);

        const matchedSuffix = suffixes.find(s => key.endsWith(s));
        if (matchedSuffix) {
            if (matchedSuffix === '.attention.head_count' && (type === GGUFType.UINT32 || type === GGUFType.INT32)) {
                const value = await readU32(source); params.attention_heads = value; found.attention_heads = true; if (verbose) log(`  Found attention_heads: ${value} (from key: ${key})`);
            } else if (matchedSuffix === '.attention.head_count_kv' && (type === GGUFType.UINT32 || type === GGUFType.INT32)) {
                const value = await readU32(source); params.kv_heads = value; found.kv_heads = true; if (verbose) log(`  Found kv_heads: ${value} (from key: ${key})`);
            } else if (matchedSuffix === '.block_count' && (type === GGUFType.UINT32 || type === GGUFType.INT32)) {
                const value = await readU32(source); params.hidden_layers = value; found.hidden_layers = true; if (verbose) log(`  Found hidden_layers: ${value} (from key: ${key})`);
            } else if (matchedSuffix === '.embedding_length') {
                if (type === GGUFType.UINT64 || type === GGUFType.INT64) {
                    const value = await readU64(source); params.hidden_size = value; found.hidden_size = true; if (verbose) log(`  Found hidden_size: ${value} (from key: ${key})`);
                } else if (type === GGUFType.UINT32 || type === GGUFType.INT32) {
                    const value = await readU32(source); params.hidden_size = value; found.hidden_size = true; if (verbose) log(`  Found hidden_size: ${value} (from key: ${key})`);
                } else { await skipValue(source, type); }
            } else { await skipValue(source, type); }
        } else { await skipValue(source, type); }

        if (found.attention_heads && found.hidden_layers && found.hidden_size && (found.kv_heads || found.attention_heads)) {
            if (isUrl) { source.setAbortFlag?.(); if (verbose) log('All required metadata found, aborting download'); }
            break;
        }
    }

    if (!found.kv_heads && found.attention_heads) { params.kv_heads = params.attention_heads; found.kv_heads = true; if (verbose) log(`  Using attention_heads as kv_heads: ${params.kv_heads}`); }

    const allFound = found.attention_heads && found.hidden_layers && found.hidden_size;
    if (!allFound) { if (verbose) log('Failed to find all required model parameters.'); return null; }
    return params;
}

async function getRemoteFileSize(url, { verbose = false } = {}) {
    try {

        const head = await fetch(url, { method: 'HEAD' });
        if (head.ok) {
            const cl = head.headers.get('content-length');
            if (cl) {
                const n = Number(cl);
                if (Number.isFinite(n) && n > 0) return n;
            }
        }
    } catch (e) {
        if (verbose) log('[HEAD error]', e.message || e);
    }

    try {
        const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
        if (!res.ok && res.status !== 206 && res.status !== 200) return 0;
        const cr = res.headers.get('content-range');
        if (cr) {

            const m = cr.match(/\/(\d+)$/);
            if (m) {
                const n = Number(m[1]);
                if (Number.isFinite(n) && n > 0) return n;
            }
        }

        const cl = res.headers.get('content-length');
        if (cl) {
            const n = Number(cl);
            if (Number.isFinite(n) && n > 0) return n;
        }
    } catch (e) {
        if (verbose) log('[Range 0-0 error]', e.message || e);
    }
    return 0;
}

async function calculateMemoryUsageFromUrl(url, contextSize, { verbose = false } = {}) {
    const sizeBytes = await getRemoteFileSize(url, { verbose });
    if (!sizeBytes) return null;
    const params = await readModelParams(url, { verbose });
    if (!params) return null;
    const modelSizeMB = Math.floor(sizeBytes / 1_000_000);
    const kvBytes = 4.0 * params.hidden_size * params.hidden_layers * contextSize;
    const kvCacheMB = Math.floor(kvBytes / 1_000_000);
    const totalRequiredMB = modelSizeMB + kvCacheMB;
    const displayString = `${formatMemorySize(totalRequiredMB)} (Model: ${formatMemorySize(modelSizeMB)} + KV: ${formatMemorySize(kvCacheMB)})`;
    return { modelSizeMB, kvCacheMB, totalRequiredMB, displayString, hasEstimate: true };
}


const btnUrl = document.getElementById('Action');
const inputUrl = document.getElementById('URL');
const verboseEl = document.getElementById('Verbose');
const ctxEl = document.getElementById('ContextSize');
const resultEl = document.querySelector('.result-list');
const logContainer = document.querySelector('.result-meta');

function showParams(p) {
    if (!p) return;
    const items = resultEl.querySelectorAll('.item');
    for (const item of items) {
        const h2 = item.querySelector('h2');
        const pEl = item.querySelector('p');
        if (!h2 || !pEl) continue;
        const label = h2.textContent.trim();
        if (label === 'Attention Heads:') {
            pEl.textContent = p.attention_heads !== undefined ? p.attention_heads.toLocaleString() : '0';
        } else if (label === 'KV Heads:') {
            pEl.textContent = p.kv_heads !== undefined ? p.kv_heads.toLocaleString() : '0';
        } else if (label === 'Hidden layers:') {
            pEl.textContent = p.hidden_layers !== undefined ? p.hidden_layers.toLocaleString() : '0';
        } else if (label === 'Hidden size:') {
            pEl.textContent = p.hidden_size !== undefined ? p.hidden_size.toLocaleString() : '0';
        }
    }
}

function showUsage(u) {
    if (!u) return;
    const items = resultEl.querySelectorAll('.item');
    for (const item of items) {
        const h2 = item.querySelector('h2');
        const pEl = item.querySelector('p');
        if (!h2 || !pEl) continue;
        const label = h2.textContent.trim();
        if (label === 'Model size:') {
            pEl.textContent = formatMemorySize(u.modelSizeMB);
        } else if (label === 'KV cache:') {
            pEl.textContent = formatMemorySize(u.kvCacheMB);
        } else if (label === 'Total required:') {
            pEl.textContent = formatMemorySize(u.totalRequiredMB);
        } else if (label === 'Display:') {
            pEl.textContent = u.displayString;
        }
    }
}

async function handleUrl() {
    clearLog();
    btnUrl.textContent = "Loading...";
    btnUrl.disabled = true;
    const resultSection = document.querySelector('.result');
    if (resultSection) {
        resultSection.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const items = resultEl.querySelectorAll('.item');
    for (const item of items) {
        const h2 = item.querySelector('h2');
        const pEl = item.querySelector('p');
        if (pEl) pEl.textContent = '...';
    }
    const url = inputUrl.value.trim(); const verbose = verboseEl.checked; const ctx = Math.max(1, parseInt(ctxEl.value || '4096', 10));
    if (logContainer) {
        logContainer.style.display = verbose ? 'block' : 'none';
    }
    try {
        const params = await readModelParams(url, { verbose });
        if (!params) {
            for (const item of items) {
                const pEl = item.querySelector('p');
                if (pEl) pEl.textContent = 'Error';
            }
            btnUrl.textContent = "Action";
            btnUrl.disabled = false;
            return;
        }
        const usage = await calculateMemoryUsageFromUrl(url, ctx, { verbose });
        showParams(params);
        showUsage(usage);
        if (!usage) {
            for (const item of items) {
                const h2 = item.querySelector('h2');
                const pEl = item.querySelector('p');
                if (!h2 || !pEl) continue;
                const label = h2.textContent.trim();
                if (
                    label === 'Model size:' ||
                    label === 'KV cache:' ||
                    label === 'Total required:' ||
                    label === 'Display:'
                ) {
                    pEl.textContent = 'Error';
                }
            }
        }
        btnUrl.textContent = "Calculate";
        btnUrl.disabled = false;
    } catch (e) {
        log('[Error]', e.message || e);
        for (const item of items) {
            const pEl = item.querySelector('p');
            if (pEl) pEl.textContent = 'Error';
        }
        btnUrl.textContent = "Calculate";
        btnUrl.disabled = false;
    }
}


btnUrl.addEventListener('click', handleUrl);
