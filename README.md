<div align="center">
  <img src="./logo-rounded-square.png" width="104" alt="咏智桌面工具 Logo">
  <h1>咏智桌面工具（YZai Desk）</h1>
  <p>把日程、四象限、备忘录、专注计时、剪贴板和 AI 助手放进一个轻量的 Windows 桌面工作台。</p>
  <p>
    <strong>当前版本：V0.6.6</strong>
    · Windows 10 / 11
    · 本地优先
    · Tauri + React
  </p>
</div>

## 项目简介

咏智桌面工具是一款面向个人效率场景的 Windows 桌面应用。主要数据默认保存在本机，常用功能可从主窗口、系统托盘和桌面挂件快速访问。

V0.6.6 修正 Agnes AI 服务为 OpenAI 兼容的文本生成模型，预置 `agnes-2.5-flash`、`agnes-2.0-flash`、`agnes-2.5-pro`；移除重复的协议切换按钮，仅保留“协议类型”下拉选择。DeepSeek（OpenAI / Anthropic）、Kimi、OpenAI、Anthropic 与第三方兼容服务的配置方式保持不变。

## 界面预览

### 今日总览

![今日总览](./docs/screenshots/overview.png)

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./docs/screenshots/schedule-reminders.png" alt="日期提醒"><br>
      <strong>日期提醒</strong>
    </td>
    <td align="center" width="50%">
      <img src="./docs/screenshots/four-quadrants.png" alt="四象限任务"><br>
      <strong>四象限任务</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="./docs/screenshots/notes.png" alt="备忘录"><br>
      <strong>备忘录</strong>
    </td>
    <td align="center">
      <img src="./docs/screenshots/focus-timer.png" alt="番茄时间"><br>
      <strong>番茄时间</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="./docs/screenshots/ai-assistant.png" alt="AI 助手"><br>
      <strong>AI 助手</strong>
    </td>
    <td align="center">
      <img src="./docs/screenshots/appearance-themes.png" alt="主题外观"><br>
      <strong>主题外观</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="./docs/screenshots/widget-settings.png" alt="桌面挂件设置"><br>
      <strong>桌面挂件设置</strong>
    </td>
    <td align="center">
      <img src="./docs/screenshots/desktop-widgets.png" alt="桌面挂件"><br>
      <strong>桌面挂件</strong>
    </td>
  </tr>
</table>

## 核心能力

| 模块 | 能力 |
| --- | --- |
| 今日总览 | 汇总待办、提醒、专注数据和常用入口 |
| 日期提醒 | 日历浏览、事件记录、到期提醒 |
| 四象限 | 按重要性与紧急程度组织任务 |
| 备忘录 | 本地富文本记录、自动保存、浅色与深色主题适配 |
| 剪贴板 | 保存常用文本并快速复制 |
| 番茄时间 | 工作与休息计时、桌面挂件、完成提醒 |
| AI 助手 | 自定义兼容接口、流式回答、会话记录、Markdown 导出 |
| 桌面挂件 | 时钟、日历、任务和专注计时，可独立显示与定位 |
| 系统设置 | 云雾白等主题、开机启动、快捷键、数据目录、备份与恢复 |

## 快速开始

### 环境要求

- Windows 10 / 11 x64
- Node.js 20 或更高版本
- 开发桌面端时需要 Rust 与项目对应的 Tauri 工具链

### 安装依赖

```powershell
npm.cmd install
```

### 浏览器模式

```powershell
npm.cmd run dev
```

浏览器模式适合调试界面。系统托盘、开机启动、全局快捷键、桌面挂件和原生通知等功能需要在桌面模式验证。

### 桌面开发模式

```powershell
npm.cmd run desktop:dev
```

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm.cmd run dev` | 启动 Vite 浏览器开发环境 |
| `npm.cmd run build` | 构建前端资源 |
| `npm.cmd run desktop:check` | 检查 Rust / Tauri 桌面端 |
| `npm.cmd run desktop:dev` | 启动桌面开发模式 |
| `npm.cmd run desktop:build` | 生成 Windows 安装包 |

## Windows 安装包

当前本地构建文件：

`release/YZai-Desk-v0.6.6-Windows-x64-Setup.exe`

正式发布包请从项目的 [GitHub Releases](https://github.com/wuyouseo/yzai-desk/releases) 页面下载。

| 项目 | 值 |
| --- | --- |
| 版本 | `0.6.6` |
| 文件大小 | `6,271,777` 字节 |
| SHA-256 | `C7F592570D8894407940C89B5B504BED05BEF18DA39FB866D8DCEFB9F4ABC954` |

安装包内容已检查，包含主程序、`WebView2Loader.dll` 和版本化桌面快捷方式图标。正式安装、卸载、覆盖升级及多台电脑兼容性仍需在发布前完成实机回归。

## 数据与隐私

- 日程、任务、备忘录、剪贴板、专注记录和设置默认保存在本机。
- 支持修改数据目录，以及导出、导入本地备份。
- AI 助手仅在用户主动配置接口后请求对应服务。
- API 密钥按本地配置机制保存；请勿提交个人配置、密钥或备份数据。

## 项目结构

```text
desk-tool/
├─ src/                    # React 前端与业务界面
├─ src-tauri/              # Tauri / Rust 桌面能力与打包配置
├─ docs/
│  ├─ screenshots/         # README 实机截图
│  ├─ development_progress.md
│  └─ implementation_plan.md
├─ release/                # 本地发布安装包
├─ logo-1.png              # 原始品牌图
├─ logo-rounded-square.png # 圆角方形应用图标
└─ README.md
```

## 开发与发布文档

- [开发清单与验证记录](./docs/development_progress.md)
- [实施方案](./docs/implementation_plan.md)

## 当前边界

项目目前处于内部测试阶段，尚未配置 Windows 代码签名和自动更新。发布前需要补齐真实安装、卸载、覆盖升级、多显示器、高 DPI 和不同 Windows 环境的回归测试。

## 版权

© 2026 咏智桌面工具（YZai Desk）
