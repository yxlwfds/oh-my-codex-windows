# 全局 DeepSeek 子代理开关

## 📋 概述

通过 `--nds` (No DeepSeek Subagent) 全局参数,可以在启动 `owx` 时一次性禁用 DeepSeek 子代理,整个会话都使用原生模式。

## 🎯 使用方式

### 方法 1: 短参数 (推荐)

```bash
owx --nds subagent execute -q "运行 dir"
```

### 方法 2: 长参数

```bash
owx --no-deepseek-subagent subagent execute -q "运行 dir"
```

### 效果

- ✅ **全局生效** - 整个会话中所有子代理任务都使用原生模式
- ✅ **无需环境变量** - 不需要设置 `OMX_SUBAGENT_MODE`
- ✅ **位置灵活** - 参数可以放在任何位置
- ✅ **自动清理** - 参数不会传递给子命令

## 📊 对比测试

### 使用 --nds (原生模式)

```bash
owx --nds subagent execute -q "运行 dir"
```

输出:
```
🖥️  原生模式执行
   命令: dir
   模式: 原生模式 (本地 Shell 执行)

[完整目录列表...]

💰 资源消耗:
   执行时间: 34ms
   模式: 原生模式 🖥️
   缓存命中: 不适用
```

### 不使用 --nds (DeepSeek 子代理模式)

```bash
owx subagent execute -q "dir"
```

输出:
```
deepseek: 执行子代理任务
deepseek:   查询: dir
deepseek:   模式: 子代理模式 (DeepSeek V4 Flash)

📊 执行结果:
Command: dir
Summary: Success...

💰 资源消耗:
   Token 消耗: 1,251
   执行命令数: 1
   缓存命中: 是 ✅
   思考模式: 启用 ✅
```

## 🔧 技术实现

### 核心逻辑

```typescript
// 在 main 函数最开始处理
export async function main(args: string[]): Promise<void> {
  // 检测 --nds 或 --no-deepseek-subagent 参数
  const hasNdsFlag = args.includes('--nds') || args.includes('--no-deepseek-subagent');
  
  if (hasNdsFlag) {
    // 设置环境变量,全局生效
    process.env.OMX_SUBAGENT_MODE = 'native';
    
    // 从参数中移除,避免传递给子命令
    args = args.filter(a => a !== '--nds' && a !== '--no-deepseek-subagent');
  }
  
  // ... 后续逻辑
}
```

### 优先级

```
--nds 参数 (最高) > --mode 参数 > 环境变量 > 默认值
```

## 💡 使用场景

### 场景 1: 调试时禁用 DeepSeek

```bash
# 调试问题时,使用原生模式查看完整输出
owx --nds subagent execute -q "npm run build 2>&1"
```

### 场景 2: API 配额用尽

```bash
# DeepSeek API 配额用尽时,临时使用原生模式
owx --nds subagent execute -q "运行测试"
```

### 场景 3: 批量本地命令

```bash
# 执行多个本地命令,不需要 DeepSeek 的智能摘要
owx --nds subagent execute -q "ls -la"
owx --nds subagent execute -q "cat package.json"
```

### 场景 4: CI/CD 环境

```bash
# CI/CD 环境中,不依赖外部 API
owx --nds subagent execute -q "运行构建"
```

## 🎨 与其他参数的配合

### 与 --mode 参数配合

```bash
# --nds 优先级更高,覆盖 --mode subagent
owx --nds subagent execute --mode subagent -q "dir"
# 结果: 使用原生模式 (--nds 生效)
```

### 与子命令配合

```bash
# 可以放在子命令之前或之后
owx --nds subagent status
owx subagent --nds status  # 错误: --nds 必须在 owx 后面

# 正确用法
owx --nds subagent execute -q "dir"
```

## ✅ 优势

1. **极简使用** - 只需一个参数,无需环境变量
2. **全局生效** - 一次设置,整个会话生效
3. **无副作用** - 不修改环境变量,不影响其他进程
4. **自动清理** - 参数不会污染子命令
5. **灵活位置** - 可以放在命令行的任何位置

## 📝 帮助信息

```bash
owx help
```

输出中包含:
```
Options:
  --nds          Disable DeepSeek subagent globally, use native mode for all subagent tasks
  --no-deepseek-subagent
                 Alias for --nds (disable DeepSeek subagent globally)
```

## 🐛 常见问题

### Q: --nds 和 --mode native 有什么区别?

**A:** 
- `--nds` - 全局参数,影响整个会话的所有子代理任务
- `--mode native` - 局部参数,只影响当前 `execute` 命令

```bash
# --nds: 全局生效
owx --nds subagent execute -q "任务1"  # 原生模式
owx --nds subagent execute -q "任务2"  # 原生模式

# --mode: 只影响当前命令
owx subagent execute --mode native -q "任务1"  # 原生模式
owx subagent execute -q "任务2"                # 子代理模式 (默认)
```

### Q: 设置了 --nds 后如何切换回子代理模式?

**A:** 不需要切换,`--nds` 只对当前命令生效。下次不添加 `--nds` 就会使用默认的子代理模式。

```bash
owx --nds subagent execute -q "任务1"  # 原生模式
owx subagent execute -q "任务2"        # 子代理模式 (默认)
```

### Q: --nds 会影响其他功能吗?

**A:** 不会。`--nds` 只影响子代理的执行模式,不影响其他功能。

## 📅 更新历史

- **2026-05-15**: 添加全局 DeepSeek 子代理开关
  - 支持 `--nds` 短参数
  - 支持 `--no-deepseek-subagent` 长参数
  - 全局生效,无需环境变量
  - 自动清理参数,不污染子命令
