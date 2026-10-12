# 子代理选模路由 × 计划模式自动切换：端到端演练报告

2026-10-07（演练环境日期以会话为准），插件 1.0.1 源码树，Node v22.23.2，vitest 3.2.7。
形态：测试级端到端演练——在同一个模拟宿主里把两条链路串成一次完整会话生命周期，而非孤立单测。新增 `tests/e2e-dispatch.spec.ts`（2 个场景），并回归既有全部套件。

## 演练脚本（对应 e2e-dispatch.spec.ts 第一场景七幕）

模拟宿主一次性装配 `installSubagentRouting` 与 `installPlanModelSwitch`，共享：
设置默认（子代理 `opencode-go-completions/deepseek-v4.1-flash`、计划 `step/step-5-preview`）、
主模型 `droid/claude-sonnet-5-5`(effort high)、路由校验器（`resolveCallConfig` 目录校验）、
会话覆盖存储、计划主模型持久化存储。

| 幕 | 操作 | 关键断言 | 结果 |
|---|---|---|---|
| 1 | 普通对话 + 无覆盖委派 | 子代理落到**设置默认**；校验器按默认路由调用 | ✅ |
| 2 | 聊天栏选择写入会话覆盖后再委派（continuable 路径） | **会话覆盖 > 设置默认** | ✅ |
| 3 | 显式委派选择（AsyncLocalStorage，模拟 list_subagent_models） | **显式 > 覆盖**；不带 effort 的显式路由丢掉覆盖的 effort（用适配器默认） | ✅ |
| 4 | 覆盖被改成无效路由 `opencode-go/deepseek-v4.1-flash` | 委派在**创建子代理之前**被拒绝，报 `Invalid model route …`；内部 start 零调用 | ✅ |
| 5 | `/plan` 进入计划模式 | 下一步请求切到 `step-5-preview`；进入前主路由（含 effort high）**先持久化**再切换 | ✅ |
| 6 | 计划起草中委派子代理 | 子代理仍按会话覆盖路由；主会话切换序列不受打扰——**两链路网独立** | ✅ |
| 7 | 批准计划（exit_plan_mode 通过） | 第一条执行请求**之前**恢复原始主路由（含 effort）；持久化记录清空；之后请求稳态不再切换 | ✅ |

尾声断言：设置默认值与会话覆盖在整个生命周期后保持原样（默认值独立于会话）。

第二场景：`/plan off` 直接退出同样恢复主模型并清空记录；`origin: 'subagent'` 的会话不参与计划切换（设计如此，README 已知限制第 3 条）。

## 运行结果

```
pnpm test  →  Test Files 12 passed (12) / Tests 65 passed (65)
```

- 新增：e2e-dispatch.spec.ts 2 项；回归：既有 10 个文件 63 项全部通过，无改动运行时代码。
- 环境备注：`pnpm install` 默认 store 的 sqlite 在本机打不开，改用 `--store-dir /tmp/pnpm-store` 安装成功。

## 演练中发现的问题（均为测试代码问题，运行时代码未改）

1. 断言内部 `start.mock` 时引用了被插件**包装后**的 `runtime.start`（包装器没有 `.mock`）——需在安装前捕获内部 vi.fn。两处假设审查后修正，印证"包装发生在 ctx.effect 安装时"。
2. `sessionController.selectModel` 的入参携带 `sessionId` 字段，`toEqual` 过严，改为 `toMatchObject` 并显式断言 `sessionId: 's1'`。

## 预先存在、与本次无关的问题

- `pnpm typecheck` 在本机失败：node_modules 同时解析到 npm registry 包与 `/root/deepseek-harness` 本地包，`AttachmentId` 等品牌类型双重身份不兼容。已用 `git stash` 验证该失败先于本次改动存在，且 tsconfig 只覆盖 `src/`，与新增测试文件无关。
- `pnpm-lock.yaml` 为本次安装新生成的未跟踪文件（仓库原本只有 package-lock.json），是否纳入版本管理留待维护者决定。

## 与实机验证文档的关系

docs/ 下既有 `three-plan-switch-verification.md`、`sonnet-subagent-verification.md` 是桌面宿主真实请求验证；本演练是其在测试层的可重复对应物，覆盖相同的路由优先级与切换时序语义，但不替代真实上游请求验证（无真实 token 流、无响应 ID）。

## 追记：本机实机闭环与 startActivation 修复（同日）

测试级演练后在本机运行中的 DSH（web profile，宿主构建源自 /root/deepseek-harness，新于 rc.2）做了真实派发闭环，发现并修复两个独立问题：

1. **子代理全部死于提示词装配（宿主侧，非本插件）**：router-jev 预设（dsh-routing-suite）persona 兜底后缀引用未注册的 `{{cwd}}` 变量；路由 shim 装配时会替换 persona 段但明确跳过子代理（router-bootstrap.mjs 的 `parentSession !== undefined` 早退），导致每个子代理在首个请求前抛 `unknown prompt variable "{{cwd}}"`。已在套件源文件去除全部 `{{cwd}}` 引用，重启后子代理可正常启动。
2. **本插件路由被静默旁路（本插件缺陷）**：当前宿主的 `dsh-subagent` 运行时已无 `start`/`startContinuable` 方法，所有委派只走 `startActivation`（tool-subagent/src/index.ts:334）。插件 1.0.1 只包装旧两个方法，等于空挂——子代理退回原生父模型继承。修复：`installSubagentRouting` 改为按存在性包装 `start` / `startContinuable` / `startActivation` 三条路径（缺失不挂载）；新增 4 项 startActivation 单测，e2e 第六幕改用 startActivation。套件 12 文件 69 项通过。

实机闭环证据：热重载（dev_reload_package）后派出标记串子代理 `48fccb3e-7b11-4b23-87ae-4cb27797efb2`，子会话 request/header 为 `clinepass / cline-pass/deepseek-v4.1-flash, reasoningEffort high`（恰为该会话覆盖），turn/end completed，回传 MODEL_DISPATCH_E2E_OK。

注意：本机 `pnpm build` 的 tsc 步骤因预存的类型双重身份问题（npm 包 vs /root/deepseek-harness 本地包）退出码非零，但 tsc 默认带错 emit，lib/subagent-routing.js 已正确产出；client bundle 未受影响（本次仅宿主侧改动）。
