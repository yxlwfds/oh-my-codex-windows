1. 使用中文输出;
2. 编辑文件时,先读取当前要编辑的文件，然后用补丁方式更新内容（不删文件、不覆盖丢失历史）;
3. 路由统一返回值，异常或正常相同字段，没有的设置为"";
4. 写md文件时,markdown文件放在 docs文件夹下,并进行二次归类到不同文件夹;
5. 不要误删;
6. js文件如果可以放单独文件中;
7. 尽量不要使用Get-Content或cat这种低效的获取文件内容的方式,优先使用Fast Context或其它高效的方式;
8. 在powershell中使用grep的时候可以使用"rg".
9.我是在windows11中使用,工具选择时执行的命令需要兼容.
10.本机所有仓库默认优先使用 `ast-grep` 做语法感知搜索/结构化重写，优先使用 `semble` 做语义搜索/索引；能用时先用它们。
11.修改 `AGENTS.md` 或任何生成 `AGENTS.md` 的模板时，如果不是明确替代关系，不要删除已有的有意义内容；优先补充细化，而不是重写覆盖。
12.同步来源以 `D:\code\my\oh-my-codex\templates\AGENTS.md` 和 `D:\code\my\oh-my-codex\templates\code-intelligence\AGENTS-entry.md` 为准。
