# 咏智桌面工具 (YZai Desk) - 需求与架构设计文档 (v0.5.0)

**咏智桌面工具 (YZai Desk)** 是一款轻量、低能耗的 Windows 桌面效率工具。本项目采用 **Tauri v2 + React** 架构设计，旨在将系统资源占用降至最低（内存占用预计约 20-30MB），实现极致的流畅度与后台无感运行。

本项目从 **v0.1.0** 版本开始，遵循严谨的软件开发规范，将所有细节和卓越的用户体验融入设计中。

---

## 1. 软件功能需求 (Functional Requirements)

YZai Desk 核心功能划分为“桌面小挂件”、“主设置端”、以及“全局快捷面板”三大部分，并通过系统托盘及本地数据库进行深度协同。

### 1.1 桌面小挂件 (Widget)
*   **日历与天气视图**：
    *   展示精简日历网格，高亮当前日期，并通过微小的“呼吸发光点”标记有事件的日期。
    *   展示极简实时天气图标与温度（通过免费免 Key 的 Open-Meteo API 获取）。
*   **日程清单**：展示今日及未来的待办事件与提醒。
*   **极简番茄钟 (Pomodoro)**：
    *   集成一个扁平优雅的圆形倒计时进度条。
    *   支持快捷开启/暂停/重置，专注于当前工作，时间到时发出轻柔的系统铃声与弹窗提醒。
*   **快捷记事本**：支持快速记录便签 and 临时文本。
*   **快捷剪切板**：展示最近的剪切板文本，点击可快速重新复制。
*   **桌面交互模式**：
    *   **常规模式**：显示半透明拖动手柄和调整大小手柄。用户可在桌面上任意拖动位置、拉伸尺寸。
    *   **壁纸贴片模式 (锁屏/穿透)**：隐藏所有手柄，小挂件窗口置于所有窗口的最底层（Bottom Z-Order），并启用**鼠标穿透 (Click-Through)**，使其完全融入桌面壁纸，不干扰用户的日常图标点击与操作。

### 1.2 全局快捷面板 (Quick Command Panel)
*   **Alt + Space 快捷启动**：
    *   全局按下 `Alt + Space` 快捷键，可在屏幕中央唤起一个极简、半透明的指令输入框（类似 Spotlight 或 Raycast）。
    *   支持快速输入问题，直接调用后台的 DeepSeek AI 并以流式卡片形式返回简短回答。
    *   按下 `Esc` 键或失去焦点时自动隐藏，提供零打扰的 AI 辅助体验。

### 1.3 主控制与设置中心 (Settings Dashboard)
*   **日程管理 (Calendar & Events)**：
    *   完整的大日历看板。
    *   日程添加/编辑：可按“年、月、周、日、时、分”设置提醒时间，支持周期性事件（每天、每周、每月、每年）。
*   **番茄钟数据分析**：查看每日/每周累计的专注时长和番茄个数统计。
*   **便签与加密 (Encrypted Notepad)**：
    *   管理所有的便签，支持分类/标签。
    *   **安全保护**：用户可为特定敏感便签设置密码。启用加密的便签在本地数据库中以 AES-256-GCM 算法加密存储，只有在输入正确密码后才在内存中临时解密展示。
*   **剪切板管理器 (Clipboard Manager)**：
    *   查看完整的剪贴历史列表，支持搜索、一键复制、删除、固定 (Pin) 功能。
    *   **隐私防泄漏**：提供选项，可在复制敏感信息（如密码或 Token）后一定时间自动清空剪切板；支持将剪贴内容以“纯文本形式”复制，自动清除格式。
*   **DeepSeek AI 对话助手 (AI Chat)**：
    *   配置 API 密钥（API Key）、自定义接口基址 (Base URL) 以及模型名称。
    *   完整的对话面板：支持 Markdown 渲染（包含代码块高亮）、流式打字机响应效果 (Stream)。
*   **系统与备份设置 (General Settings)**：
    *   **自启动**：支持开关“开机自动启动”。
    *   **自适应天气定位**：配置天气的城市编码或自动定位。
    *   **挂件样式**：调节挂件的透明度、毛玻璃模糊度、发光主题色、字体大小等。
    *   **数据备份**：支持一键导出所有事件和文本数据为本地 JSON 文件，并支持导入覆盖/合并。

### 1.4 后台运行与提醒系统
*   **系统托盘 (Tray Icon)**：软件启动后默认在系统托盘运行。托盘右键菜单包含：“打开配置中心”、“锁定/解锁挂件布局”、“显示/隐藏挂件”、“退出”。
*   **强力提醒弹窗**：当事件或番茄钟时间到达时，后台服务会唤醒一个精致的悬浮通知弹窗（从屏幕右下角滑入，置顶显示），播放内置提示音，提供“推迟提醒 (Snooze)”与“我知道了 (Dismiss)”按钮。

### 1.5 本地化隐私与易迁移性 (Security & Portability)
*   **100% 数据本地化**：软件无任何云端服务器同步代码，除用户主动配置的 DeepSeek AI 接口外，不发起任何出站网络请求。
*   **零明文敏感数据**：用户的密码不保存在本地，只保存其单向 Hash (PBKDF2)。加密便签数据即使被他人拷贝 `data.json` 也无法强行破解。
*   **单文件零成本迁移**：导出备份将生成单一格式化 JSON 文件，其中包含完整的用户设置、便签、日程事件及剪贴历史。在新电脑上导入该文件即可无缝恢复所有配置和数据。

---

## 2. 系统架构设计 (Architecture Design)

Tauri 的多窗口架构将高性能的 Rust 后台与现代化的前端渲染完美结合：

```mermaid
graph TD
    subgraph Rust 后台 (Core)
        Tauri[Tauri App Runner]
        DB[数据管理 db.rs]
        Clip[剪切板监听 clipboard.rs]
        Alarm[时间调度器 alarm.rs]
        Startup[自启动管理 startup.rs]
        HotKey[快捷键管理器 hotkey.rs]
        
        Tauri --> DB
        Tauri --> Clip
        Tauri --> Alarm
        Tauri --> Startup
        Tauri --> HotKey
    end

    subgraph 前端渲染进程 (Vite + React)
        WidgetView[挂件视图 - Widget]
        SettingsView[配置视图 - Settings]
        NotificationView[通知视图 - Notification]
        QuickView[快捷AI面板 - QuickPanel]
    end

    Tauri <-->|IPC / Events| WidgetView
    Tauri <-->|IPC / Events| SettingsView
    Tauri <-->|IPC / Events| NotificationView
    Tauri <-->|IPC / Events| QuickView
```

### 2.1 模块技术实现方案

#### 2.1.1 窗口层级与鼠标穿透 (Windows Integration)
*   **实现原理**：
    *   小挂件窗口在创建时配置 `decorations: false`, `transparent: true`, `always_on_top: false`。
    *   **壁纸贴片模式**：利用 Windows Win32 API（在 Rust 中通过 `windows-sys` 库）将窗口的 `HWND` 样式设置为包含 `WS_EX_TRANSPARENT`（使鼠标穿透），并使用 `SetParent` 将其父窗口绑定到系统的桌面管理器窗口 `Progman` 或 `WorkerW` 上，真正使其成为壁纸贴片。
    *   **解锁模式**：移除 `WS_EX_TRANSPARENT` 样式，并将窗口父句柄设回 `NULL`，恢复标准拖拽和交互。

#### 2.1.2 快捷面板与全局快捷键 (Global Hotkey)
*   通过 Tauri 2.0 的 `tauri-plugin-global-shortcut` 注册全局热键（如 `Alt + Space`）。
*   当热键被触发时，Rust 后台直接调用 `QuickPanel` 窗口的 `.show()` 和 `.focus()` 方法，并将该无边框的指令窗置于屏幕正中央。
*   监听窗口的失焦事件 (`tauri::WindowEvent::Focused(false)`)，失焦时自动隐藏该窗口，实现无缝的使用体验。

#### 2.1.3 剪切板极简监听与格式清理 (Clipboard Monitor)
*   **监听逻辑**：
    1. 使用 Rust 中的 `arboard` 库安全读取系统剪切板文本，每隔 800ms 进行一次轻量级变化检测。
    2. 发现变化时：
        *   对符合常见敏感格式（长数字密码、API Key、Token 等）的文本打上敏感标记。
        *   将新文本存入本地 JSON 数据库。
3. **格式清理（纯文本复制）**：在前端点击纯文本复制时，调用 Tauri API 直接将无格式纯文本覆写至系统剪切板。
4. **延迟自动清理**：若用户开启“敏感内容自动清理”，后台启动一个定时器，在检测到敏感复制行为 3 分钟后，若剪切板内容未改变，自动清空剪切板。

#### 2.1.4 数据 management 与安全加密 (Database & Security)
*   **文件型 JSON 数据库**：在 Windows `AppData/Roaming/yzai-desk` 目录下维护原子写入的 `data.json`。
*   **加密便签机制 (AES-256-GCM)**：在 React 前端利用原生 **Web Crypto API** 进行加解密，密钥从主密码通过 `PBKDF2` 派生，完全本地化，安全隔离。

#### 2.1.5 任务调度与日程提醒 (Alarm Engine)
*   Rust 后台维护一个定时器，循环读取日程事件及番茄钟剩余时间。
*   当触发时，通过内置提示音配合滑入式的 `Notification` 窗口置顶弹出提示。

---

## 3. 性能优化与资源管控策略

为了将系统资源占用压缩到极致，YZai Desk 在设计上遵循以下规范：

1.  **轻量级 Rust 线程与异步 IO**：所有的文件读写、剪切板监听均在 Rust 异步运行时下执行，不阻塞 UI 渲染主线程，后台 CPU 占用低于 0.5%。
2.  **前端资源与组件按需加载**：React 前端避免加载重型第三方 UI 库，使用原生 CSS + 极简纯净 React 组件。
3.  **窗口惰性载入与隐藏**：主设置中心、快捷 AI 面板、通知弹窗在不使用时采用隐藏 (hide) 策略，避免重复冷启动产生的资源耗损。
4.  **剪切板监听休眠**：当电脑处于休眠或锁屏状态时，后台监听线程会自动减缓检测频率至每 3秒一次，降低唤醒损耗。
