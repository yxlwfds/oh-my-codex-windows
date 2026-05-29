---
name: database-migrations
description: guanghe-cloud 项目 MySQL/PolarDB-X 数据库设计规约、不使用外键的关联设计、Expand-Contract 无停机数据演进、以及 script/sql/sync_guang_he_app.py 的自动化同步技能。
origin: ECC_Windsurf_Refactored
---

# guanghe-cloud 数据库演进与自动同步规约

本技能用于在 guanghe-cloud 研发中，指导 AI 进行 MySQL / PolarDB-X 的表结构设计、写增量 SQL、以及利用本地脚本自动化同步数据库。

## 1. 核心设计原则

1. **绝对禁止物理外键**：
   - 表与表之间不创建任何物理外键关联（FOREIGN KEY），所有的关联关系、最终一致性在**后端代码（Java/Dubbo 服务）**中处理。这是微服务高并发和数据库横向扩展的基础铁律。
2. **实体承袭**：
   - 所有的数据库实体类（Entity）必须继承 BaseEntity 公共基类，继承创建时间、更新时间、操作人等公共字段。
3. **安全第一，拒绝手动**：
   - 绝不允许手动在生产数据库中运行 DDL。所有 schema 变更必须写成 SQL 增量脚本，放置在 script/sql/update/ 下。
4. **幂等性编写**：
   - 所有 SQL 增量脚本必须具有**幂等性**（即重复运行不会报错）。例如使用 CREATE TABLE IF NOT EXISTS。

---

## 2. MySQL / PolarDB-X 高并发安全 DDL 规范

### 增加字段（安全非锁表）
在大表上增加字段，如果设置了 NOT NULL 但没有提供 DEFAULT 默认值，会导致 MySQL 锁表并全表重写，极其危险：

`sql
-- GOOD: Nullable 字段，瞬间完成
ALTER TABLE gh_order ADD COLUMN extra_remark VARCHAR(255) NULL;

-- GOOD: 带有默认值的非空字段
ALTER TABLE gh_order ADD COLUMN status INT NOT NULL DEFAULT 0;

-- BAD: 容易锁表的写法
ALTER TABLE gh_order ADD COLUMN config_data TEXT NOT NULL;
`

### 分布式大表分区键设计
由于线上使用 PolarDB-X（分布式数据库），涉及单表数据超千万的大表（如订单表、支付明细表），必须指定合理的**分区键**（如按 create_time 进行自动分区改造），防止单点物理限制。

---

## 3. Expand-Contract（扩展-收缩）无停机演进模式

当必须修改/重命名线上大表的核心字段时，禁止直接 RENAME（会导致线上服务中断）。必须遵循以下“三阶段扩展收缩”步骤：

`	ext
Phase 1: EXPAND (扩展)
  - 1. DDL: 增加新列 
ew_column (允许空)
  - 2. Deploy: 后端 Java 同时向 old_column and 
ew_column 双写
  - 3. DML: 跑后台跑批脚本，把旧数据逐步 Backfill 回填到新列

Phase 2: MIGRATE (迁移)
  - 4. Deploy: 后端 Java 切换为：只读 
ew_column，但依然双写
  - 5. Verify: 验证业务和数据一致性

Phase 3: CONTRACT (收缩)
  - 6. Deploy: 后端 Java 彻底移除 old_column 的一切引用（只读写 
ew_column）
  - 7. DDL: 单独跑一个 SQL，Drop 掉旧的 old_column
`

---

## 4. 自动化同步机制：sync_guang_he_app.py

本仓库提供了一套全自动、极度智能的数据库同步脚本：
- **同步脚本路径**：script/sql/sync_guang_he_app.py

### 💡 自动 IP 白名单自愈机制
由于 PolarDB-X 云数据库有极严格的访问控制，非公司/非本地公网 IP 会连接超时：
- **自愈逻辑**：脚本在运行检测到超时（Timeout）时，会**自动通过 aliyun CLI 获取本机当前的公网 IP，并调用阿里云 API 自动将本机 IP 临时加入 PolarDB-X 的白名单分组 gs**，然后自愈重试连接。无需人工干预！
- **前提要求**：本地环境已安装并配置好 liyun CLI（liyun configure）。

### 🛠️ 运行同步命令

当你在开发中新增了 DDL 脚本后，必须在 Windsurf 中运行同步，让数据库实际生效：

`powershell
# 运行默认增量同步模式 (Incremental)
python script/sql/sync_guang_he_app.py
`

---

## 5. 常见防坑 checklist

- [ ] 新表是否使用了物理外键？（必须勾掉，在 Java 逻辑层中做 Dubbo 关联）
- [ ] 实体类是否继承了 BaseEntity ?
- [ ] 增量 SQL 脚本是否放到了 script/sql/update/ 下？
- [ ] SQL 是否是幂等的（重复运行不报错）？
- [ ] 如果是千万级大表，DDL 是否会锁表？分区键是否已规划？
