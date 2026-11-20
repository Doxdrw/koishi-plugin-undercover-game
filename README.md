# koishi-plugin-undercover-game

Koishi 的多人「谁是卧底」游戏插件。支持经典、群雄逐鹿（鹿）和海龟汤（龟）三种模式，包含固定座位、发言、投票、加时、武将、踢人补位和可选积分结算。

武将可按局启用，主持人可自定义阵营与武将分配；管理员可替换、查看或恢复默认卡面。支持图文发言、分轮历史回放，以及发题和待处理提示的重新获取。

## 安装

在 Koishi 控制台的插件市场搜索 `undercover-game` 并安装；也可以在 Koishi 项目目录执行：

```bash
npm install koishi-plugin-undercover-game
```

运行环境：Node.js 20 及以上、Koishi 4.18.9 及以上，并启用 `database` 服务。完整开局还需要当前适配器支持向主持人和玩家发送私聊；具体能力以所用适配器为准。安装后在 Koishi 控制台启用插件，在群里发送 `卧底` 开始一局。

插件可以独立运行。启用 [koishi-plugin-xp-points](https://github.com/Doxdrw/koishi-plugin-xp-points) 后，可使用统一管理昵称、共享或独立积分主体和周期积分榜；没有该服务时仍可正常游戏。

## 快速开始

1. 主持人在群里发送 `卧底`。
2. 玩家发送半角 `1` 加入，人数达到要求后主持人发送 `开始`。
3. 主持人按私聊提示填写题面；玩家按座位号发言并私聊投票。
4. 游戏结束后，在原群发送 `总结` 或 `复盘` 查看结果。

主持人可以在发题开始前发送 `经典模式`、`鹿模式`、`龟模式`，也可以使用 `开始鹿模式`、`开始龟模式`。新局是否使用武将由 `heroesByDefault` 决定，主持人可用 `普通局` 或 `武将局` 覆盖。

## 文档导航

- [完整游戏指南](GAME_GUIDE.md)：模式、配置阶段、投票、武将、历史和常用指令。
- [ChatLuna 工具接入](CHATLUNA.md)：按需规则／状态工具与公开信息边界说明。
- [贡献指南](https://github.com/Doxdrw/koishi-plugin-undercover-game/blob/main/CONTRIBUTING.md)：本地检查、Pull Request 和 Issue 信息。
- [安全策略](https://github.com/Doxdrw/koishi-plugin-undercover-game/blob/main/SECURITY.md)：隐私数据和安全问题报告方式。

## 模式

- 经典模式：主持人设置好人词条、卧底词条及各自雷点；玩家在群里发言、私聊投票。
- 鹿模式：主持人设置双方选人规则和公共易混。玩家私聊选词，主持人审核通过后发言；白板只收到易混，不选词。
- 龟模式：主持人设置汤面和两阵营实际词条；玩家在群里提问，主持人在群内回答。龟模式不使用白板。

具体规则、武将说明和指令见[游戏指南](GAME_GUIDE.md)。

玩家和主持人均可发送 `待办`、`待处理` 或 `待审` 查看各自当前任务；群内查询的详情转私聊。`题面`、`武将`、`重发信息` 可补取本局信息，原有长名称仍可使用，补取不重置时限。

## 常用配置

配置页面按游戏、开局、时限、鹿模式重选、主持人超时、提醒、积分、历史和卡面分组。常用选项包括：

| 配置 | 作用 |
| --- | --- |
| `enabledSpecialModes` | 开启鹿模式或龟模式 |
| `heroesByDefault` | 新局默认是否使用武将，默认开启 |
| `minPlayers` | 开局所需的最少玩家数，默认 6 |
| `enabledHeroes` | 武将局可随机使用的武将 |
| `deerHostTimeoutAction` / `boomHostTimeoutAction` | 鹿选词审核／自爆判定超时的自动处理、协同主持招募或终止策略 |
| `scoreSystemKey` | xp-points 中使用的积分系统 key |
| `enablePersistentScoring` | 是否写入 xp-points，默认开启 |
| `history.enabled` | 是否保存正式局历史 |
| `history.sandbox` | 是否保存沙盒局历史，默认关闭 |
| `history.mediaRetention` | 多媒体保留到下一局、永久保留或按天清理 |
| `history.winrateMinimumGames` | 胜率榜最低参赛局数，默认 5；个人查询不设门槛 |
| `reportImages.enabled` | 总结／复盘和选词公布优先发送图片，默认开启；Puppeteer 服务可选 |
| `aiTools.enabled` | 提供 ChatLuna 只读规则与当前群状态工具，默认关闭 |
| `aiTools.history.enabled` | 允许 ChatLuna 按需读取本群已归档的完成局，独立开关，默认关闭 |
| `aiTools.history.pageSize` / `aiTools.history.maxChars` | AI 历史的每页条数和单次返回字符上限，默认 5 条／2,500 字符 |

时限、通知、白板、积分分值和卡面限制也可以在配置页面调整；实际数值以当前配置为准。

开启积分并接入 xp-points 后，默认的 `undercover` 群积分系统会自动创建；使用自定义 `scoreSystemKey` 时，先在 xp-points 中创建对应系统。累计榜可用 `积分.排行 undercover` 查询，月榜可用 `积分.排行 undercover 月`；自定义 key 时相应替换。

## 历史与隐私

`胜率` 查看自己的累计胜率，也可 `胜率 @玩家 上周`、`胜率 模式=鹿 武将=袁崇焕`；`胜率榜 上月 好人` 查看本群榜单。周期查询需要 xp-points 0.3.0 及以上，复用当前绑定系统的周期设置；累计查询无需积分插件。

在插件市场安装并启用 `puppeteer` 后，`总结`／`复盘` 和 `公布选人` 默认输出图片，长内容自动分图；发言里的表情和多媒体随图保留。未提供浏览器服务、渲染失败或投递明确失败时，回退到完整文字。投递超时或缺少回执只标为「发送未确认」，不会自动重发。本次只看文字可发送 `总结 -t`、`复盘 编号 -t` 或 `公布选人 -t`。`回放` 保持合并转发。

正式局可以保存题面、分轮发言、问答、投票、技能结果和结算；沙盒默认不保存。历史查询只在原群或对应主持人、参赛者的私聊中开放，鹿模式选词记录单独管理，不会混入普通复盘或关键词搜索。

常用指令：

```text
历史对局 [页码]
复盘 [对局编号]
回放 [对局编号]
选人记录 [页码]
公布选人 [对局编号]
隐藏选人 [对局编号]
```

管理员可在原群预览并清理历史。发言中的图片、QQ 表情等按配置保存为结构化引用；清理媒体不会删除文字历史。详情见[游戏指南](GAME_GUIDE.md)。

## 订阅叫人

`订阅`（或 `叫我`）保存长期召唤意愿，`取订` 删除订阅。`叫人` 每次都会读取当前群成员，只 @ 仍在群内、未被管理员暂停、不是调用者且尚未入局的订阅者；成员读取失败时不会发送不可靠的 @。

## AI 工具接入

开启 `aiTools.enabled` 后，支持工具调用的 ChatLuna 会话可按需查阅本插件规则和当前群公开状态。规则直接读取随包指南；工具只返回已公开的游戏信息，接入与使用边界见[工具接入说明](CHATLUNA.md)。

## 开发

```bash
npm ci
npm run typecheck
npm test
npm run build
```

源码和文档采用 MPL-2.0，默认卡面使用单独的素材许可，详见 [LICENSE.md](LICENSE.md)、[NOTICE.md](NOTICE.md) 和 `uc-pics/ASSET-LICENSE.md`。

## 支持

使用中遇到可复现的问题，请先查阅[完整游戏指南](GAME_GUIDE.md)，再在 [GitHub Issues](https://github.com/Doxdrw/koishi-plugin-undercover-game/issues) 提供插件版本、Koishi/Node.js 版本、最小复现步骤和期望结果。安全问题请按[安全策略](https://github.com/Doxdrw/koishi-plugin-undercover-game/blob/main/SECURITY.md)私下报告，不要公开发布账号、群组或私聊内容。
