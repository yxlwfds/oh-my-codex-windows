---
name: hf-download
description: Download Hugging Face models with proxy support and auto-resume
---

# HF Model Download Skill

从 Hugging Face 下载模型文件到全局 HF 缓存目录（`~/.cache/huggingface/hub/`），自动支持代理和断点续传。

适用场景：`hf download` / `huggingface_hub` 因网络或代理 SSL 兼容性问题无法正常下载时使用。

## 用法

```
/hf-download <model_id> [--proxy <proxy_url>]
```

参数：
- `model_id`：模型名称，如 `nomic-ai/CodeRankEmbed`
- `--proxy`：HTTP 代理地址，默认 `http://127.0.0.1:8087`

## 工作原理

1. 通过 Python `httpx` 库直接调用 Hugging Face API（绕过 `huggingface_hub` 的 httpcore 代理兼容问题）
2. 流式下载 + 进度条显示
3. 支持 HTTP Range 断点续传
4. 下载到全局 HF 缓存目录 `~/.cache/huggingface/hub/models--{org}--{repo}/snapshots/{commit}/`

## 下载流程

执行以下 Python 脚本（uv 管理依赖 + 代理环境变量）：

```powershell
$env:HTTP_PROXY = "<proxy_url>"
$env:HTTPS_PROXY = "<proxy_url>"

uv run --with httpx --with tqdm python -c "
import os, json
os.environ['HTTP_PROXY'] = '<proxy_url>'
os.environ['HTTPS_PROXY'] = '<proxy_url>'

import httpx
from pathlib import Path
from tqdm import tqdm

MODEL_ID = '<model_id>'
PROXY = '<proxy_url>'

client = httpx.Client(timeout=httpx.Timeout(30, read=600), follow_redirects=True)

# Get model metadata
r = client.get(f'https://huggingface.co/api/models/{MODEL_ID}')
data = r.json()
sha = data.get('sha', 'main')
siblings = data.get('siblings', [])
files = [s['rfilename'] for s in siblings if s.get('rfilename')]
print(f'Model: {MODEL_ID}')
print(f'Commit: {sha}')
print(f'Files: {len(files)}')

# Cache path: ~/.cache/huggingface/hub/models--org--repo/snapshots/COMMIT/
home = Path.home()
org_repo = MODEL_ID.replace('/', '--')
cache_dir = home / '.cache' / 'huggingface' / 'hub' / f'models--{org_repo}'
snapshot_dir = cache_dir / 'snapshots' / sha
snapshot_dir.mkdir(parents=True, exist_ok=True)

# Update refs
refs_dir = cache_dir / 'refs'
refs_dir.mkdir(parents=True, exist_ok=True)
(refs_dir / 'main').write_text(sha)

for fname in files:
    url = f'https://huggingface.co/{MODEL_ID}/resolve/main/{fname}'
    fpath = snapshot_dir / fname
    fpath.parent.mkdir(parents=True, exist_ok=True)
    
    head = client.head(url)
    total = int(head.headers.get('content-length', 0))
    existing = fpath.stat().st_size if fpath.exists() else 0
    
    if total > 0 and existing >= total:
        print(f'{fname}: already complete ({total} bytes)')
        continue
    
    if existing > 0 and total > 0:
        print(f'{fname}: resuming from {existing} / {total} bytes')
    else:
        print(f'{fname}: downloading...')
    
    headers = {}
    if existing > 0 and total > 0:
        headers['Range'] = f'bytes={existing}-'
    
    with client.stream('GET', url, headers=headers) as r:
        r.raise_for_status()
        mode = 'ab' if existing > 0 else 'wb'
        initial = existing if existing > 0 else 0
        with open(fpath, mode) as f:
            with tqdm(total=total, initial=initial, unit='B', unit_scale=True, desc=fname, miniters=1) as pbar:
                for chunk in r.iter_bytes(chunk_size=65536):
                    f.write(chunk)
                    pbar.update(len(chunk))
    print(f'  OK')

print(f'\nDownloaded to: {snapshot_dir}')
"
```

## 代理配置

常用代理端口：
- Clash / Clash Verge：`http://127.0.0.1:7890`
- V2Ray / Shadowsocks：`http://127.0.0.1:1080`
- 自定义：`http://127.0.0.1:<端口>`

如果无需代理（网络直连 HF），设置 `PROXY = ''` 并跳过环境变量设置。

## 缓存位置

下载完成后模型位于 HF 标准缓存目录：

```
~/.cache/huggingface/hub/
├── models--{org}--{repo}/
│   ├── refs/
│   │   └── main          # 包含 commit hash
│   └── snapshots/
│       └── {commit_hash}/
│           ├── model.safetensors
│           ├── config.json
│           ├── tokenizer.json
│           └── ...
```

诸如 `sentence-transformers` 等库会自动从此目录加载模型。

## 故障排查

- **`ConnectTimeout`**：代理不可用，检查代理地址或尝试更换
- **`SSL UNEXPECTED_EOF`**：代理 SSL 中间人问题，本 skill 通过 httpx 绕过
- **`RemoteProtocolError`**：大文件下载中断，重新运行脚本自动续传
- **`getaddrinfo failed`**：DNS 失败，检查网络连接或换用镜像

## 已知问题

`huggingface_hub` 库（包括 `hf` CLI）在某些 HTTPS 代理环境下（如 8087 端口）会出现 `httpcore.ConnectError: SSL UNEXPECTED_EOF_WHILE_READING` 错误。这是因为 `httpcore` 的 `http_proxy.py` 模块在通过代理建立 TLS 隧道时与部分代理存在兼容性问题。

**本 skill 使用 `httpx` 直接请求绕过此问题**，已证实可靠。
