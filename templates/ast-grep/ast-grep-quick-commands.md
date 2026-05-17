# ast-grep Quick Commands

1. Java exception pattern
```bash
sg --lang java -p 'new ServiceException($$$)' .
```
2. Java null-check pattern
```bash
sg --lang java -p 'if ($COND == null) { $$$ }' .
```
3. MyBatis XML select
```bash
sg --lang xml -p '<select $$$> $$$ </select>' .
```
4. UniApp / TS console log
```bash
sg --lang ts -p 'console.log($$$)' .
```
5. Bulk rewrite + verify
```bash
sg --lang java -p 'oldCall($$$)' -r 'newCall($$$)' . && sg --lang java -p 'oldCall($$$)' .
```
