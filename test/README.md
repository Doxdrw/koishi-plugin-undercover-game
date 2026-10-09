# 测试说明

测试覆盖游戏流程、武将结算、固定座位、补位、历史、订阅、积分服务边界和配置行为。

```bash
npm install
npm test
npm run test:game
npm run typecheck
npm run build
```

测试使用隔离的 Koishi 上下文和临时数据库，不读取项目实例配置、真实数据库或运行中的机器人。`test/game-automation.test.ts` 包含主持人、群聊和私聊的多用户流程；其余测试覆盖可独立验证的状态和结算函数。

新增或修改游戏行为时，请先补充能够复现该行为的测试，并同时覆盖正常完成、超时、退出、踢人、补位和重新开局等边界。
