# 一二布布素材工程交接

## 已做的决定

一二布布使用 **黄小B的原版 PNG/GIF 或符合原版造型的授权素材**。不使用此前 AI 生成、人物比例和五官不准确的 SVG。UI 代码中的角色组件只负责加载与显示素材，不负责重新画角色。

## 此交付包中实际附带的是什么？

`docs/design/reference/preview.html` 是**离线自包含的 UI 演示稿**，里面嵌入了最初参考图的低清裁剪素材，用于说明“角色图片与界面组件分离”。这些只是设计占位，**不作为生产可发布角色资产**。目前仓库没有验收通过的高清 PNG/GIF。

## 生产素材路径约定

```text
apps/desktop/src/renderer/assets/mascot/
  original/
    duo-welcome.webp          # 高清透明双角色
    avatar-brown.png          # 单角色清晰头像
    avatar-white.png
    thinking.gif              # 思考中，可用静态 PNG 替代
    searching.gif             # 找文件
    working.gif               # 整理文件
    waiting.png               # 待确认
    success.gif               # 完成
    error.png                 # 错误/疑惑
  asset-manifest.json         # 每张原图的来源、作者、授权依据、规格
```

替换前检查：原版造型、像素尺寸、透明通道、是否带白边或文字、GIF 帧数/体积与循环次数、透出/暗色问题、来源及二次分发条件。不要把角色资产声明为随 MIT 软件源码无限制可转授权。

- Hero：PNG/WebP 最大 320×200 显示，不强制裁切、禁止扭曲；人物右侧，左边文字由 HTML 绘制。
- Avatar：角色正面 PNG 32×32 显示，保证可辨认。
- Sidebar：双角色 100×75 以内，保持低调。
- Task Card：角色尺寸 80–110，不能遮住状态与操作信息。
- 动图可降级为同状态静态图，照顾 `prefers-reduced-motion`。

## 推荐在线候选来源

整理好的页面链接见 [`ASSET-CANDIDATES.md`](ASSET-CANDIDATES.md)。候选列表**仅确认来源线索**，不等于这些图片已经被下载、验收、可任意再分发。用户已说明原作者支持不损害 IP 形象的二创；准备公开发行时，仍应把原作者允许的具体使用条件和素材来源保存到仓库。
