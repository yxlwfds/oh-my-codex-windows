# omx-winmux / `owx` 使用与架构文档

> 本文档说明 oh-my-codex 在 **native Windows** 上替代 `tmux` 的方案：常驻
> daemon `omx-winmux` 与独立 CLI `owx`。WSL2 / MSYS / Git Bash 等仍然走原
> 生 `tmux`，本文不涉及。

---

## 1. 这是什么 / 为什么需要它

`tmux` 在原生 Windows 上没有官方移植，社区方案 `psmux` 仅是 PowerShell 脚本
胶水，无法承担 OMX 多 worker 编排所需的 PTY / capture-pane / send-keys
语义。为此 OMX 实现了一套与 `tmux` 等价但 Windows-原生的多路复用器：

| 组件 | 作用 |
|---|---|
| **omx-winmux daemon** | 常驻进程；持有所有 PTY，统一管理输出缓冲、订阅广播、生命周期。 |
| **`owx` CLI** | Windows 上 `omx` 的等价入口；零参数同样进 Codex 对话，并额外承载 winmux 管理子命令。 |
| **`WinMuxProvider`** | OMX 内部的 Provider 实现，让 `runTmux` / `execTmux` 在 win32 上自动改走 daemon，源码无感切换。 |

设计目标：

- **`owx` 与 `omx` 行为一致** —— 在 Windows 上把 `owx` 当作主入口即可。所有
  非 winmux 子命令（`exec`、`setup`、`team`、零参数交互……）原样透传给 `omx`
  主入口；只有 winmux 专属动词（`start / stop / status / ls / capture / attach`）
  被 `owx` 自己处理。`omx` 主 CLI 不再含 `winmux` 子命令。
- **零 zombie 进程内核担保** —— 借助 Win32 Job Object 的 `KILL_ON_JOB_CLOSE`
  标志位，daemon 任何路径退出（包括 `taskkill /F`）时，OS 同步回收所有被
  assign 的子进程。
- **不回退** —— 在原生 Windows 上 `WinMuxProvider` 是唯一受支持的多路复用器。
  `psmux` 别名已下线、不再做 `tmux` 后备探测；任何失败都通过
  `MultiplexerProvider.isAvailable() === false` 显式上抛。

---

## 2. 安装与构建

### 依赖

```text
runtime  : node >= 20
optional : node-pty (Windows pty 后端；npm 安装时按平台选装)
ffi      : koffi  (调用 Win32 Job Object API)
```

`koffi` 是普通 dependency，`node-pty` 是 `optionalDependencies`，npm 在
非 Windows 上若编译失败不会阻断安装；daemon 在启动时会显式校验
`node-pty` 是否可用，缺失则**直接 fail**（不静默退化）。

### 构建

```powershell
npm install
npm run build
```

构建产物：

```text
dist/cli/omx.js              # 主 CLI（不再含 winmux 子命令）
dist/cli/owx.js              # 独立 winmux CLI
dist/winmux/daemon/index.js  # daemon 入口（owx 自动拉起）
dist/winmux/client/cli.js    # 客户端命令分发
```

`package.json` 注册了两个 bin：

```json
"bin": {
  "omx": "dist/cli/omx.js",
  "owx": "dist/cli/owx.js"
}
```

`npm install -g .` 之后就可以直接在 shell 里调用 `owx <subcommand>`。

---

## 3. `owx` CLI 用法

`owx` 在 Windows 上等价于 `omx`，并额外内置 winmux 管理子命令。argv[0] 路由
规则如下：

```text
owx <argv[0]> [args]

  ┌─ 命中 winmux 动词 ─→ owx 自己处理（与 daemon RPC）
  │   start | stop | status | ls | capture | attach | daemon
  │
  ├─ 命中 help/--help/-h ─→ 先打印 winmux 子命令简介，再透传给 owx 显示完整帮助
  │
  └─ 其它（含零参数）─→ 透传给 `omx` 主入口（与 `owx <args>` 完全一致）
```

### winmux 子命令

```text
  start             确保 daemon 在运行（若未运行则 detached spawn）
  stop              请求 daemon 优雅关闭
  status            打印 pid / 命名管道路径 / 活跃 session 数
  ls                列出活跃 session（paneId、pid、cmd、dead 标志）
  capture <pane>    打印某个 pane 的最近 N 行（--lines N，默认 200）
  attach <pane>     只读流式跟随 pane 输出（Ctrl+C 仅 detach，不杀 session）
```

> `daemon` 是内部命令，由 `owx start` 自动调用，普通用户无需直接使用。

### 与 owx 的命名冲突

`status` 与 `help` 在 `omx` 主 CLI 中也存在。在 `owx` 入口下，这两个动词
**优先解释为 winmux 语义**：

- `owx status` = daemon 状态。需要 OMX 自身的 `status` 时请直接调用 `owx status`。
- `owx help` = winmux 子命令简介 + owx 完整帮助（合并输出）。

### 典型用法

```powershell
# 与 owx 一致的部分（直接进对话 / 跑子命令）
owx                              # 等价 `omx`，启动交互式 Codex
owx exec --skip-git-repo-check . "hello"  # 等价 `owx exec ...`
owx setup                        # 等价 `owx setup`

# winmux 管理
owx start              # 启动 daemon
owx status             # 检查 daemon
owx ls                 # 列 session
owx capture %1 --lines 50
owx attach %1          # Ctrl+C 仅 detach
owx stop               # 关 daemon（同步回收所有 session）
```

### 退出码约定（winmux 子命令）

| 命令 | 0 | 1 |
|---|---|---|
| `start` | daemon 已就绪 | spawn 或 handshake 失败 |
| `stop` | shutdown ack 收到（含「daemon 早已不在」） | 真实 RPC 错误 |
| `status` | daemon 在运行 | daemon 不在 / 不响应 |
| `ls`/`capture` | RPC 成功 | RPC 失败 |
| `attach` | session 自然退出 | 找不到 session / 管道异常 |

`status` 故意把"daemon 不在"映射为非零，方便监控脚本直接 `if owx status; then ...`。
透传到 `omx` 的子命令保留 `omx` 自身的退出码语义。

---

## 4. 环境变量

只有在你需要隔离多份 daemon、定制路径或调试时才需要设置。

| 变量 | 含义 | 默认值 |
|---|---|---|
| `OMX_WINMUX_PIPE` | 命名管道路径 | `\\.\pipe\omx-winmux-<userScopeDigest>` |
| `OMX_WINMUX_STATE_DIR` | 锁文件 / 日志目录 | `%LOCALAPPDATA%\omx-winmux\` |
| `OMX_WINMUX_DAEMON_ENTRY` | daemon JS 入口路径 | 自动从 `dist/` 解析 |
| `OMX_WINMUX_BUFFER_BYTES` | 单 session 输出环形缓冲容量 | `524288` (512 KiB)，下限 32 KiB |
| `OMX_MULTIPLEXER` | `auto` / `winmux` / `tmux`，覆盖 provider 选择 | `auto`（win32 → winmux，其它 → tmux） |
| `OMX_FORCE_WINMUX` | `=1` 强制选 WinMuxProvider（任意平台） | 未设置 |
| `OMX_FORCE_TMUX` | `=1` 强制选 TmuxProvider（即使 win32） | 未设置 |

`<userScopeDigest>` 是当前用户名的哈希前缀，避免多用户 / 多账户在同一台机器上撞管道。

---

## 5. 架构概览

```text
┌──────────────────────────────────────────────────────────────┐
│ OMX 业务代码 (team / notifications / hud / hooks)            │
│   runTmux(args) ─┐    execTmux(args) ─┐                      │
└──────────────────┼─────────────────────┼─────────────────────┘
                   ▼                     ▼
        getMultiplexerProvider()  ── select-provider.ts
                   │
       ┌───────────┴────────────┐
       ▼                        ▼
  TmuxProvider              WinMuxProvider          (POSIX vs win32)
  (POSIX: spawn tmux)       (win32: sync-rpc)
                                  │
                        worker_threads + Atomics      ← sync-rpc.ts
                                  │  (异步管道 → 同步接口)
                                  ▼
                       Named Pipe IPC (framed JSON)
                                  │
        ┌─────────────────────────┴───────────────────────────┐
        │                  omx-winmux daemon                  │
        │  ┌──────────┐  ┌────────────────┐  ┌──────────────┐ │
        │  │ Server   │→ │ SessionManager │→ │ JobObject    │ │
        │  │ (pipe)   │  │ (PTY+ringbuf)  │  │ KILL_ON_CLOSE│ │
        │  └──────────┘  └────────┬───────┘  └──────────────┘ │
        │                         ▼                           │
        │                  node-pty PTY 子进程                │
        └─────────────────────────────────────────────────────┘
```

### 关键模块

| 路径 | 职责 |
|---|---|
| `src/winmux/provider/multiplexer-provider.ts` | 抽象接口、错误类型、`RunResult` |
| `src/winmux/provider/tmux-provider.ts` | POSIX 上调用 `tmux` 二进制 |
| `src/winmux/provider/winmux-provider.ts` | win32 上把 tmux 风格 args 翻译成 daemon RPC |
| `src/winmux/provider/args-router.ts` | tmux argv → daemon action 的纯函数路由器 |
| `src/winmux/provider/select-provider.ts` | 选择器（含 `selectMultiplexerProvider` 纯函数 + 缓存版） |
| `src/winmux/daemon/index.ts` | daemon bootstrap：lockfile → JobObject → node-pty 预加载 → IPC server |
| `src/winmux/daemon/session-manager.ts` | PTY 创建 / kill、订阅广播、JobObject.assign |
| `src/winmux/daemon/buffer.ts` | 字节级环形缓冲，`tailBytes` / `tailLines` |
| `src/winmux/daemon/lifecycle.ts` | 单入口幂等 `shutdown()`，所有信号 / 异常都汇聚至此 |
| `src/winmux/daemon/server.ts` | 命名管道 IPC server |
| `src/winmux/win-job/koffi-loader.ts` | `koffi` + kernel32 懒加载（ESM 兼容） |
| `src/winmux/win-job/job-object.ts` | `KILL_ON_JOB_CLOSE` Job Object 包装 |
| `src/winmux/client/ensure-daemon.ts` | 检测 / 拉起 daemon、handshake、retry |
| `src/winmux/client/rpc.ts` | 异步 RPC 客户端（每次新建短连接） |
| `src/winmux/client/sync-rpc.ts` | `worker_threads` + `Atomics.wait` 同步桥 |
| `src/winmux/client/cli.ts` | `owx` 子命令分发器 |
| `src/winmux/client/attach.ts` | 只读 attach，subscriber 自动清理 |
| `src/cli/owx.ts` | 独立 bin 入口，转发到 `winmuxCli` |

### 零 zombie 担保细节

1. daemon 启动时通过 `koffi` 调用 `CreateJobObjectW`，再用 `SetInformationJobObject`
   设置 `JOBOBJECT_BASIC_LIMIT_INFORMATION.LimitFlags |= JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`。
2. 每次 `node-pty.spawn` 之后立刻 `AssignProcessToJobObject(child.pid)`。
3. daemon 进程持有该 Job Handle 至生命终结。
4. **任何**导致 daemon handle 关闭的事件（正常 exit、SIGINT、SIGTERM、未捕获异常、
   `taskkill /F`、电源事件）都会让 OS 内核同步遍历 Job 内所有进程并 terminate。
5. 即便 Node 层 `lifecycle.ts` 的清理逻辑因 bug 早退，子进程也不会逃逸。

### 同步 / 异步桥（`sync-rpc`）

OMX 大量历史代码以 `runTmux(args): Result` 的同步形式调用，但管道 IPC 天然
异步。`WinMuxProvider.run` 路径如下：

1. 主线程通过 `MessageChannel` 发送 RPC 请求到 worker 线程。
2. Worker 线程在异步 IO 中等待响应，写回 `SharedArrayBuffer`，并 `Atomics.notify`。
3. 主线程 `Atomics.wait` 阻塞至 worker 完成或超时，从 `SharedArrayBuffer` 解码结果。

第一次调用约 35ms（worker 启动 + handshake），后续亚毫秒。worker 在
`disposeSyncRpcWorker()` 时清理。

---

## 6. 真实测试方法

### A. 最简：CLI 端到端

```powershell
node ./dist/cli/owx.js start
node ./dist/cli/owx.js status
node ./dist/cli/owx.js ls
node ./dist/cli/owx.js stop
```

### B. 跑真实 PTY，验证捕获

把以下保存为 `_smoke.cjs` 后 `node _smoke.cjs`：

```js
(async () => {
  const ensure = await import('./dist/winmux/client/ensure-daemon.js');
  const rpc = await import('./dist/winmux/client/rpc.js');
  await ensure.ensureDaemonRunning({ timeoutMs: 8000 });

  const r = await rpc.sendRequest({
    action: 'new-session',
    params: {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'dir & echo HELLO_WINMUX & ping -n 2 127.0.0.1 >NUL'],
      cwd: process.cwd(), cols: 100, rows: 30,
    },
  });
  console.log('paneId =', r.data.session.paneId);
  await new Promise(r => setTimeout(r, 1500));

  const cap = await rpc.sendRequest({
    action: 'capture-pane',
    params: { paneId: r.data.session.paneId, lines: 30 },
  });
  console.log(cap.data.data); // 应包含 HELLO_WINMUX 与 dir 输出（含 ANSI）

  await rpc.sendRequest({ action: 'shutdown', params: {} });
})();
```

### C. 验证零 zombie 内核担保

这是最关键的测试 —— 直接证明 Job Object 生效：

```powershell
# 1) 起 daemon + 一个长跑 PTY
owx start

# 2) 启一个不会自然结束的 ping，记下子进程 pid
$out = node -e "(async()=>{
  const r = await import('./dist/winmux/client/rpc.js');
  const s = await r.sendRequest({
    action:'new-session',
    params:{command:'cmd.exe',args:['/d','/s','/c','ping -t 127.0.0.1'],
            cwd:process.cwd(),cols:80,rows:24}
  });
  console.log(JSON.stringify(s.data.session));
})()"
$childPid = ($out | ConvertFrom-Json).pid
Write-Host "child pid = $childPid"

# 3) 找到 daemon pid 并 SIGKILL（不给优雅退出机会）
$daemonPid = (owx status | Select-String 'pid=(\d+)' | %{ $_.Matches[0].Groups[1].Value })[0]
taskkill /F /PID $daemonPid

# 4) 立刻检查子进程：应已被内核回收
Get-Process -Id $childPid -ErrorAction SilentlyContinue
# 期望输出: 空。Job Object 在 daemon handle 关闭瞬间同步杀掉了子进程。
```

如果你看到 `Get-Process` 仍返回 `ping` 进程对象，说明 Job Object 没生效，需要排查
`koffi` / kernel32 加载链路。

### D. 单元测试套件

```powershell
node --test `
  dist/winmux/daemon/__tests__/buffer.test.js `
  dist/winmux/ipc/__tests__/framing.test.js `
  dist/winmux/provider/__tests__/select-provider.test.js
```

预期 19 个测试全部通过。

### E. Provider 路由验证

```powershell
node -e "const m = require('./dist/winmux/provider/select-provider.js');
console.log('win32  ->', m.selectMultiplexerProvider({platform:'win32'}).name);
console.log('linux  ->', m.selectMultiplexerProvider({platform:'linux'}).name);
console.log('darwin ->', m.selectMultiplexerProvider({platform:'darwin'}).name);
console.log('forced winmux on linux ->',
  m.selectMultiplexerProvider({platform:'linux', env:{OMX_FORCE_WINMUX:'1'}}).name);"
```

期望输出：

```text
win32  -> winmux
linux  -> tmux
darwin -> tmux
forced winmux on linux -> winmux
```

---

## 7. 故障排查

### `owx start` 失败：`cannot resolve daemon entry`

`dist/winmux/daemon/index.js` 不存在。运行 `npm run build`，或显式设
`OMX_WINMUX_DAEMON_ENTRY=<绝对路径>`。

### `owx start` 失败：`node-pty not available`

`node-pty` 未编译成功。常见原因：缺少 Visual Studio Build Tools 或 Python。
重新 `npm install`，看 `node-pty` 编译日志；或安装 `windows-build-tools` 后再装。

> 设计上故意 hard-fail：**没有 PTY 就没有 winmux**，不允许静默退化为别的实现。

### `owx status` 输出 `daemon : NOT RUNNING` 但 `owx start` 报错说"已在运行"

锁文件残留。删除 `%LOCALAPPDATA%\omx-winmux\daemon-*.pid`，再 `owx start`。

### 子进程没被回收（zombie）

按 §6.C 的验证步骤复现；若复现稳定，按以下顺序排查：

1. `node -e "require('koffi')"` 是否报错（FFI 模块本身坏了）。
2. 在 daemon 日志（`%LOCALAPPDATA%\omx-winmux\daemon-*.log`）里搜
   `"job-object"`、`"AssignProcessToJobObject"` 是否有调用记录。
3. `tasklist /FI "PID eq <child>"` 看 ParentProcessID —— 若已被重 parent 到
   csrss/services，说明 Job assign 失败、但子进程已游离。

### `WinMuxProvider.run` 第一次很慢

worker thread 冷启动开销（约 35ms），属正常。后续调用是亚毫秒级。如果想完全
绕开 sync 桥，确认调用方代码可改成异步、直接走 `client/rpc.ts`。

---

## 8. 与原 `tmux` 的兼容性矩阵

`WinMuxProvider` 通过 `args-router.ts` 把 tmux argv 翻译成 daemon RPC，
覆盖 OMX 实际使用的子命令；超出该集合的会返回 no-op 或错误。

| `tmux` argv | winmux 行为 | 状态 |
|---|---|---|
| `-V` | 返回 `omx-winmux 0.1.0` | ✅ |
| `new-session -d -s NAME` | 创建 detached session | ✅ |
| `list-sessions -F "#{session_name}"` | 列出 paneId | ✅ |
| `list-panes -t TARGET -F ...` | 列出 panes（含 dead/pid 字段） | ✅ |
| `capture-pane -p -t PANE [-S -N]` | 返回缓冲区尾部 | ✅ |
| `send-keys -t PANE TEXT [Enter]` | 写入 PTY stdin | ✅ |
| `kill-pane -t PANE` | 杀 session（同 kill-session） | ✅ |
| `set-option ... ` / `display-message ...` | no-op 成功返回 | ✅（OMX 不依赖结果） |
| `split-window` | no-op | ⚠️ Windows 上 OMX 改为多 session 而非分屏 |
| 其它 | `{ ok: false, stderr: "unsupported tmux command" }` | ⚠️ |

OMX 主线代码已避开了不支持的命令；如果你在自定义脚本里用到列表外的命令，
请用 `owx` 直接调 RPC。

---

## 9. FAQ

**Q：为什么不直接做 `tmux` 的 Cygwin 编译版？**
A：要求用户装 Cygwin / MSYS2 是巨大的 onboarding 负担；且 Cygwin tmux 与
原生 Codex CLI 的 PTY 行为有差异（信号、PATH、行结尾），调试成本远超
重写一个 daemon。

**Q：能在 Linux/macOS 上用 `owx` 吗？**
A：技术上可以（设 `OMX_FORCE_WINMUX=1`），但毫无意义 —— `tmux` 在那些平台
原生且稳定，性能与生态都更好。`owx` 仅为 Windows 设计。

**Q：daemon 会不会随机崩？输出会不会丢？**
A：`buffer.ts` 是字节级环形缓冲，每个 session 默认 512 KiB。超出后旧数据被
丢弃（不阻塞写入）。daemon 崩溃时缓冲全部丢失（in-memory 设计），但 Job
Object 担保所有子进程同步退出，不会留游离 PTY。

**Q：能否多 daemon 实例？**
A：每用户单实例（pipe / lockfile 都按用户哈希）。如需隔离测试，用
`OMX_WINMUX_PIPE` 与 `OMX_WINMUX_STATE_DIR` 自定义路径即可。

---

## 10. 参考

- 计划与决策：用户对话明确了 "headless + 简单 attach"、"Provider 抽象重构"、
  "OMX 自动拉起"、"只读 attach"、"不回退、零 zombie" 五项硬需求。
- Win32 Job Objects: <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
- node-pty Windows 后端: <https://github.com/microsoft/node-pty#windows>
- koffi FFI: <https://koffi.dev/>
