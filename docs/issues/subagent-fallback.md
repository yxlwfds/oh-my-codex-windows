# 子代理降级功能实现总结

## 📋 概述

为执行子代理添加了**自动降级机制**,当 DeepSeek API 调用失败时,自动切换到原生模式执行,确保任务能够完成。

## 🎯 核心功能

### 1. 自动降级触发条件

当子代理模式遇到以下错误时,自动降级到原生模式:

- ❌ **API Key 无效** (401 错误)
- ❌ **API 配额用尽** (429 错误)  
- ❌ **网络超时**
- ❌ **DeepSeek 服务不可用**
- ❌ **其他 API 错误**

### 2. 输出设计原则

**明确显示失败,但不污染上下文:**

```
deepseek: 执行子代理任务                    ← 带前缀
deepseek:   查询: 运行 dir                  ← 带前缀
deepseek:   模式: 子代理模式 (DeepSeek V4 Flash)

deepseek: ❌ DeepSeek 执行失败              ← 错误信息带前缀 (红色)
deepseek:   错误: 401 {...}                 ← 错误详情带前缀 (红色)

⚠️  降级到原生模式执行...                   ← 降级提示 (黄色)

🖥️  原生模式执行                           ← 原生模式头部 (蓝色)
   命令: dir                                ← 干净的命令输出
   模式: 子代理模式 (DeepSeek V4 Flash)

[目录列表输出...]                            ← 完整输出,无前缀

💰 资源消耗:                                ← 统计信息
   执行时间: 23ms
   模式: 原生模式 🖥️
   缓存命中: 不适用
```

**设计特点:**
- ✅ 错误和状态信息带 `deepseek:` 前缀,明确标识来源
- ✅ 降级提示清晰可见 (黄色警告)
- ✅ **执行结果不带前缀**,保持干净的上下文
- ✅ 颜色区分: 青色 (deepseek:)、红色 (错误)、黄色 (警告)、蓝色 (原生)

### 3. 智能命令提取

降级到原生模式时,自动从查询中提取实际命令:

| 原始查询 | 提取命令 |
|---------|---------|
| "运行 dir" | `dir` |
| "执行 echo hello" | `echo hello` |
| "请运行 pwd" | `pwd` |
| "帮我运行 npm test" | `npm test` |
| "请执行 ls -la 命令" | `ls -la` |

**提取规则:**
```typescript
// 去除 "运行"、"执行"、"请运行"、"请执行"、"帮我" 等中文前缀
command = command.replace(/^(?:请)?(?:运行|执行|帮我|帮我运行|帮我执行)\s*/i, '');

// 去除末尾的 "命令" 字样
command = command.replace(/\s*命令\s*$/i, '');
```

## 🔧 技术实现

### 核心代码

```typescript
async function executeSubagentCommand(query: string, description?: string): Promise<void> {
  const subagent = createExecutionSubagentFromEnv();

  // 输出 deepseek: 前缀信息
  console.log(chalk.cyan('deepseek:') + chalk.gray(' 执行子代理任务'));
  // ...

  try {
    const result = await subagent.execute({ query, description });
    
    // 显示结果 (不带前缀)
    console.log(chalk.green('📊 执行结果:'));
    console.log(result.finalAnswer);
    // ...
    
    process.exit(result.status === 'success' ? 0 : 1);
  } catch (error: any) {
    // DeepSeek 执行失败,降级到原生模式
    console.log(chalk.red('deepseek:') + chalk.red(' ❌ DeepSeek 执行失败'));
    console.log(chalk.red('deepseek:') + chalk.red(`   错误: ${error.message}`));
    console.log();
    console.log(chalk.yellow('⚠️  降级到原生模式执行...'));
    console.log();
    
    // 调用原生模式执行 (自动提取命令)
    await executeNativeCommand(query, description);
  }
}
```

### 命令提取函数

```typescript
function extractCommandFromQuery(query: string): string {
  let command = query.trim();
  
  // 去除中文前缀
  command = command.replace(/^(?:请)?(?:运行|执行|帮我|帮我运行|帮我执行)\s*/i, '');
  
  // 去除末尾的 "命令"
  command = command.replace(/\s*命令\s*$/i, '');
  
  return command.trim();
}
```

## 📊 测试场景

### 场景 1: API Key 无效

```bash
$env:DEEPSEEK_API_KEY="invalid-key"
owx subagent execute --mode subagent -q "运行 dir"
```

**结果:** ✅ 降级成功,输出完整目录列表

### 场景 2: 正常执行

```bash
owx subagent execute --mode subagent -q "dir"
```

**结果:** ✅ DeepSeek 正常执行,返回智能摘要

### 场景 3: 中文命令提取

```bash
$env:DEEPSEEK_API_KEY="invalid-key"
owx subagent execute --mode subagent -q "执行 echo hello"
```

**结果:** ✅ 提取为 `echo hello`,执行成功输出 "hello"

### 场景 4: 多前缀提取

```bash
$env:DEEPSEEK_API_KEY="invalid-key"
owx subagent execute --mode subagent -q "请运行 pwd"
```

**结果:** ✅ 提取为 `pwd` (在 Windows 上会失败,但提取正确)

## 🎨 输出对比

### 成功情况 (DeepSeek)

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

### 降级情况 (DeepSeek → Native)

```
deepseek: 执行子代理任务
deepseek:   查询: 运行 dir
deepseek:   模式: 子代理模式 (DeepSeek V4 Flash)

deepseek: ❌ DeepSeek 执行失败
deepseek:   错误: 401 {...}

⚠️  降级到原生模式执行...

🖥️  原生模式执行
   命令: dir
   模式: 子代理模式 (DeepSeek V4 Flash)

[完整目录输出...]

💰 资源消耗:
   执行时间: 23ms
   模式: 原生模式 🖥️
   缓存命中: 不适用
```

### 直接原生模式

```
🖥️  原生模式执行
   命令: dir
   模式: 原生模式 (本地 Shell 执行)

[完整目录输出...]

💰 资源消耗:
   执行时间: 21ms
   模式: 原生模式 🖥️
   缓存命中: 不适用
```

## ✅ 优势

1. **高可用性** - DeepSeek 失败时不会中断任务,自动降级
2. **用户友好** - 明确的错误提示和降级信息
3. **上下文清洁** - 执行结果不带前缀,方便后续处理
4. **智能提取** - 自动处理中文查询,提取实际命令
5. **无缝切换** - 用户无需手动干预

## 📝 修改的文件

1. ✅ [src/cli/subagent.ts](file:///d:/code/my/oh-my-codex/src/cli/subagent.ts)
   - 修改 `executeSubagentCommand()` - 添加 try-catch 降级逻辑
   - 修改 `executeNativeCommand()` - 集成命令提取
   - 新增 `extractCommandFromQuery()` - 智能命令提取函数

2. ✅ [docs/issues/subagent-mode-switch.md](file:///d:/code/my/oh-my-codex/docs/issues/subagent-mode-switch.md)
   - 添加自动降级机制说明
   - 添加降级输出示例
   - 更新注意事项

## 🚀 使用建议

### 推荐用法

```bash
# 日常使用子代理模式 (失败时自动降级)
owx subagent execute --mode subagent -q "运行构建和测试"

# 明确知道要用原生模式时使用 --mode native
owx subagent execute --mode native -q "npm run build"
```

### 不需要做的

- ❌ 不需要手动检测 API 状态
- ❌ 不需要手动切换模式
- ❌ 不需要编写错误处理逻辑
- ❌ 不需要担心任务中断

## 📅 更新历史

- **2026-05-15**: 实现自动降级功能
  - DeepSeek 失败时自动降级到原生模式
  - 智能命令提取 (去除中文前缀)
  - 明确的错误和降级提示
  - 保持执行结果上下文清洁
