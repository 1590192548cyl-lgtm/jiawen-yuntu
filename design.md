# Design — 家稳云图

这是家稳云图的统一视觉系统。后续页面改造先读取本文件；页面可以改变内容密度与结构，但不得自行更换品牌色、字体或按钮语言。

## Genre

Playful，取其“家庭友好、低压、易理解”的部分；视觉克制，不使用童趣装饰。

## Macrostructure family

- Marketing：首页使用 Workbench，以真实产品信息和示例仪表板作为主要证明。
- App：建档、工作台和 AI 顾问使用功能优先的 Workbench / Long Document 变体。
- Report：风险诊断与行动清单使用 Stat-Led，以评分和解释性结论建立层级。

## Theme

- 纸面：暖象牙色 `oklch(97% 0.014 92)`
- 主墨色：品牌深蓝 `oklch(22% 0.035 235)`
- 主强调：青绿色 `oklch(55% 0.125 177)`
- 辅助强调：仅允许在 Logo 中使用金色，不扩展成大面积页面色块。
- 页面中强调色面积不超过单个视口的 5%。

## Typography

- Display：Cormorant Garamond + Noto Serif SC / Songti SC，700，正常体。
- Body：IBM Plex Sans + PingFang SC，400。
- 标题紧凑，正文保持 `1.5–1.65` 行高；数据统一使用等宽数字特性。

## Spacing

使用 `tokens.css` 中的 4 pt 命名比例；不在页面规则中临时发明间距值。

## Motion

- 页面进入只保留一次轻微位移与淡入。
- 控件只动画 `transform` 与 `opacity`；焦点环立即出现。
- `prefers-reduced-motion` 下空间位移压缩到 150 ms 以内。

## CTA voice

- 主按钮：青绿色实心胶囊，使用具体动作，如“开始家庭体检”。
- 次按钮：暖纸色或无底色，使用“查看示例”“返回入口”等明确文本。

## What pages MUST share

- 用户提供的完整 Logo。
- 暖象牙纸面、品牌深蓝、青绿色强调。
- 锋利宋体标题与无衬线正文。
- 胶囊形主按钮、清晰焦点状态和单行按钮文本。

## What pages MAY differ on

- 首页重展示，应用页重操作，报告页重数字与解释。
- 只有营销首页允许示例仪表板；应用页不添加装饰性插画。

## Exports

CSS 变量见 `tokens.css`，它是当前静态项目的唯一 Token 源。
