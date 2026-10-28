# 依赖与调研来源

核对日期：2026-10-28。项目采用纯 TypeScript 游戏微内核，复用现成的渲染、UI、构建和音效库。

| 技术 | 使用方式 | 一手资料 |
| --- | --- | --- |
| Bun 1.3.14 | bun install、bun test、bun run；已使用该运行时验证 | [官方发布说明](https://bun.sh/blog/bun-v1.3.14) |
| Vite | 本地服务、热更新、生产构建 | [官方指南](https://vite.dev/guide/) |
| Three.js | 相机、WebGLRenderer、实例化网格、纹理和 ShaderMaterial | [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)、[ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html) |
| postprocessing | EffectComposer、RenderPass、BloomEffect | [项目源码](https://github.com/pmndrs/postprocessing) |
| React | 菜单、HUD、奖励卡片和结算 | [官方文档](https://react.dev/) |
| Tailwind CSS | Vite 插件与 CSS 工具类 | [Vite 集成](https://tailwindcss.com/docs/installation/using-vite) |
| Jotai | jotai/vanilla 的 createStore()，Provider 共用 store，派生 Atom | [Store API](https://jotai.org/docs/core/store) |
| ZzFX | 预生成音效采样，通过原生 AudioContext 缓存、播放与压缩 | [项目说明与源码](https://github.com/KilledByAPixel/ZzFX) |

Three.js 为 ShaderMaterial 提供内建属性与 uniform。实现自定义效果时应查看相应属性的实际声明与当前依赖源码。InstancedMesh 修改矩阵和颜色后需更新相应 BufferAttribute。

Jotai 提供 React 树外的 get/set/sub。本项目通过事件适配器推送 HUD，组件只订阅所需 Atom；派生属性调用核心的同一公式。组件是否渲染还与父组件、Context 和订阅方式有关，应通过实际行为验证。

## 浏览器工具

[Tabbit](https://github.com/Tabbit-Browser/Tabbit-Devtools-Skill) 的安装版 CLI 已用于实际页面求值、键盘鼠标操作、截图和游戏步进。连续命令复用 `dungeon-weaver` task 和已获取页面；只在工作结束时 finish。安装版命令以本机 skill 为准，流程见[调试文档](debugging.md)。

[ego lite](https://github.com/citrolabs/ego-lite) 保留为需要人机接管试玩时的工具选择。当前仅核对官方说明，尚未验证本项目的接入。日常调试使用已经跑通的 Tabbit。

## 证据边界

提供的参考材料启发了微内核、SoA、Hook、ASCII 房间和浏览器 Harness 的设计。训练语料倍数、固定开发行数、开发耗时、零 GC、千倍模拟速度与同屏数量等断言均未作为项目实测事实。

当前程序化精灵、房间和代码为项目原创内容；外部依赖来自包管理器，使用 `bun.lock` 重现依赖。实际功能与验证结果见[验证记录](verification.md)。
