# Contributing

感谢提交问题和改进建议。

## 本地检查

需要 Node.js 20 或更高版本。提交前请在插件目录运行：

```bash
npm install
npm run typecheck
npm test
npm run build
npm run public:check
npm run package:audit
```

行为变更应同时添加回归测试，并在 Pull Request 中说明影响的模式、阶段或配置。新模式、武将和计分行为请先在 Issue 中确认规则口径。

## Pull Request

请从 `main` 创建短期分支，保持一个主题一个 PR，并说明测试结果。不要提交数据库、运行日志、实例配置、账号信息、确认令牌或私聊内容。

## Issue

请提供 Koishi、Node.js、插件版本、最小复现步骤和期望/实际结果。隐私或安全问题不要发布到公开 Issue，请按 `SECURITY.md` 联系维护者。
