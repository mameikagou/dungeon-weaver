# 可复用技术调研

调研日期：2026-10-28。

## 结论

采用 React + Babylon.js + TypeScript + Vite，地牢算法和可复现随机数优先复用 rot.js。浏览器操作使用 Tabbit，自动化测试使用 Playwright。项目需要自己实现的部分集中在战斗规则、道具组合、房间内容，以及把游戏状态暴露给测试工具的薄接口。

本次通过已安装的 Tabbit skill 实际访问了 Babylon.js、rot.js、Babylon Game Starter 的 GitHub 页面，以及 Babylon.js 功能页和 Playwright 时钟文档；补充读取了官方源码、项目说明和许可证信息。下列“支持”表示已核对上游资料；集成、性能和游戏手感仍需在本项目中验证。

## 直接采用的基础能力

| 需求 | 复用项目 | 已确认的能力 | 本项目需要补充的部分 |
| --- | --- | --- | --- |
| 3D 场景和表现 | [Babylon.js](https://github.com/BabylonJS/Babylon.js) | 摄像机、模型、精灵、动画、粒子、音频、基础碰撞；Apache-2.0 | 顶视角场景、美术内容、表现与游戏状态的连接 |
| 项目初始化 | [create-babylonjs 官方脚手架](https://github.com/BabylonJS/Documentation/blob/master/content/setup/createBabylonJS.md) | 生成 TypeScript、ES modules、Vite 配置，含资源加载、渲染循环和尺寸适配示例 | React 界面入口、游戏状态及调试入口 |
| 地牢算法、寻路、随机数 | [rot.js](https://github.com/ondras/rot.js) | 地图生成、路径查找、可保存和恢复状态的随机数；BSD-3-Clause | 房间类别、奖励分配、难度预算、适合战斗的房间模板 |
| 菜单和 HUD | [React](https://github.com/facebook/react) | 组件、状态订阅、事件响应；MIT | 背包、商店、升级选择、设置和结算 |
| 实体和组件管理 | [Miniplex](https://github.com/hmans/miniplex) | 普通对象实体、按组件查询；自身不调度系统 | 明确的战斗更新顺序与实体生命周期 |
| 地面碰撞和空间查询 | [Rapier 2D](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) | TypeScript/JavaScript 的二维物理、碰撞与形状投射；Apache-2.0 | X-Z 地面映射、命中规则、冲刺及高速弹测试 |
| 配置校验 | [Zod](https://github.com/colinhacks/zod) | 运行时结构校验与 TypeScript 类型推导；MIT | 游戏资源引用完整性及房间通行检查 |
| 程序化音效 | [ZzFX](https://github.com/KilledByAPixel/ZzFX) | 参数化生成音效；MIT | 枪声、受击、拾取等音色配置 |
| 无头规则测试 | [Vitest](https://github.com/vitest-dev/vitest) | 运行 TypeScript 测试、断言和性能测试；MIT | 使用真实游戏核心的场景与输入序列 |
| 浏览器测试 | [Playwright](https://github.com/microsoft/playwright) | 页面操作、JavaScript 求值、截图、追踪和页面时钟；Apache-2.0 | 对真实战斗状态和游戏结果的断言 |

Babylon.js 的完整能力以[官方功能表](https://www.babylonjs.com/specifications/)为准。本项目的战斗在二维地面上模拟，碰撞交给独立的 Rapier 2D 世界，Babylon.js 读取结果显示。各依赖随着对应功能接入。

官方脚手架提供 Babylon.js 的启动示例；React 的挂载、销毁和界面通信仍由本项目完成。游戏发布时将依赖随构建产物提供，遵循 Babylon.js README 对公共演示 CDN 使用范围的说明。

## 可复用的游戏模块来源

[Babylon Game Starter](https://github.com/EricEisaman/babylon-game-starter) 是 MIT 许可的 Babylon.js + TypeScript + Vite 游戏基础项目。上游已经提供角色移动、摄像机、拾取物、背包、触发器、粒子、音频和移动端控制。

它适合作为角色控制和移动端输入的模块参考。接入某一模块前，读取该模块、依赖和调用方，保留所复制代码的许可声明。仓库还包含多人功能、环境切换和部署设施；模块的依赖范围必须以源码检查为准。现有资料不足以证明它包含我们需要的实时地牢战斗及道具联动系统。

本项目以官方脚手架组织自己的入口，按实际需要采用上述现成模块。这样能保留已确定的 React UI 与单局战斗结构。

## rot.js 的接入细节

已检查 [RNG 源码](https://github.com/ondras/rot.js/blob/master/src/rng.ts)、[Digger 源码](https://github.com/ondras/rot.js/blob/master/src/map/digger.ts)和 [Rogue 源码](https://github.com/ondras/rot.js/blob/master/src/map/rogue.ts)。

- RNG 提供设定种子、克隆、读取和恢复随机状态的能力，直接复用。
- 地图生成结果要转成游戏使用的可通行网格和房间数据，再附加房间类型、敌人及奖励配置。
- Rogue 提供按网格划分的房间生成方式。它的内部房间数组是私有实现；应用通过公开输出构建自己的房间信息，不依赖私有字段。
- Digger 有基于真实时钟的生成时间限制。使用该生成器时，单独验证固定种子在测试环境中的重现性；测试场景可保存具体地图数据。
- 地图、战斗和纯视觉效果分别管理随机状态，避免粒子数量改变后续掉落结果。
- rot.js 自身定位为功能已较完整的工具库。更新频率不能替代实际兼容性测试。

## Tabbit 与 ego lite

| 工具 | 能做什么 | 本次验证情况 |
| --- | --- | --- |
| [Tabbit](https://github.com/Tabbit-Browser/Tabbit-Devtools-Skill) | 通过已安装的 CLI 和 skill 操作浏览器；当前安装版提供 Playwright 页面操作、求值及截图 | 已成功导航和提取上述官方页面 |
| [ego lite](https://github.com/citrolabs/ego-lite) | 独立浏览器空间与 `ego-browser` 自动化入口 | 已阅读官方项目及安装说明，本次未进行运行验证 |

Tabbit 的本机安装版使用 `tabbit-cli nodejs --task ... --request-id ...`。实际命令以本机 skill 为准；仓库中的公开 DevTools skill 与安装版 CLI 的使用方式可能不同。

ego lite 官方说明目前提供 Windows 和 macOS 应用，Linux 在路线图中；其仓库采用 MIT，浏览器应用是另外下载的产品。不能把仓库许可证推断成整个浏览器源码的许可证。本项目选用已经跑通的 Tabbit 作为交互式调试入口。

调试工具复用浏览器提供的通信与执行能力。`window.__GAME_DEBUG__` 是游戏自己提供的 JavaScript API，外部工具通过页面求值调用它；它本身不实现 CDP 协议或另外的浏览器服务。

## 精确步进能复用到什么程度

Babylon.js 有[固定步长的动画与物理更新机制](https://doc.babylonjs.com/features/featuresDeepDive/animation/advanced_animations)。Playwright 有[页面时钟控制](https://playwright.dev/docs/clock)，可以控制定时器及动画帧的时间行为。

这些能力可以复用，但“让页面过去一秒”并不能直接证明“游戏恰好执行了 60 个模拟步”。`step(N)` 仍需由本项目接入唯一的真实游戏更新入口，记录实际 tick，并确保自动更新暂停。决定玩法的动画阶段、物理、伤害和冷却遵循同一模拟时间；表现动画读取核心输出。

Rapier 的[确定性说明](https://rapier.rs/docs/user_guides/javascript/determinism/)要求一致的初始状态、创建顺序和计算条件。它提供的能力不等于整个游戏已经具有跨平台确定性。项目先验证固定环境下相同场景和输入的可重复性，跨浏览器结果再通过实测确认。高速弹幕使用其[形状投射查询](https://rapier.rs/docs/user_guides/javascript/scene_queries/)覆盖相邻位置之间的路径，并测试薄墙与移动目标。

接口语义与验收条件见 [浏览器调试接口](debugging.md)。

## 开源与素材

项目原创代码和文档采用 MIT。第三方代码保留各自许可证与署名。模型、贴图、音乐和音效按各个素材包的授权分别登记；引擎或示例仓库的代码许可证不自动覆盖其中的全部素材。

后续加入资源时记录来源链接、作者、许可证和实际使用范围。游戏题材与美术采用原创内容或允许再分发的素材。
