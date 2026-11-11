# ACT 原论文插图索引

来源：用户提供的本地 PDF；图片为 180 dpi 页面裁剪，保留矢量标注、图例及图注。所有页码均为 PDF 物理页码（1–18）。未修改原图中的数字或排版错误。

优先阅读：图4、图5、表I–II、图8、图11。技能脚本已先提取57个去重位图；最终采用页面渲染裁剪，避免丢失 PDF 中的矢量箭头和文字。原始碎片保留在任务临时目录，未混入交付目录。

| 文件 | 来源 | 用途 |
|---|---|---|
| [图1：ALOHA 系统与能力展示](fig01_aloha_overview_p01.png) | PDF p.1 | 遥操作展示与自主学习实验需要区分。 |
| [图3：硬件、四视角相机及参数](fig03_hardware_p03.png) | PDF p.3 | 定位相机与关节空间遥操作设计。 |
| [图4：ACT 总体架构](fig04_act_architecture_p04.png) | PDF p.4 | 区分训练用 CVAE 编码器与推理用策略。 |
| [图5：动作分块与时间集成](fig05_chunk_temporal_p04.png) | PDF p.4 | 聚合指向同一执行时刻的多个预测。 |
| [图6：六个真实任务定义](fig06_real_tasks_p07.png) | PDF p.7 | 任务初始化、阶段与最终成功判据。 |
| [图7：两个仿真任务定义](fig07_sim_tasks_p08.png) | PDF p.8 | 物体初始化区域及阶段。 |
| [表I–II：完整主实验结果](tables01_02_results_p08.png) | PDF p.8 | 含基线、脚本/人类示范及各阶段结果。 |
| [图8：分块、时间集成、CVAE 与用户研究](fig08_ablations_p10.png) | PDF p.10 | 对应四组消融，不混合不同评估口径。 |
| [图10：执行时相机观测](fig10_camera_observations_p16.png) | PDF p.16 | 保留低对比度、遮挡和尺度信息。 |
| [图11：训练及推理详细架构](fig11_detailed_architecture_p17.png) | PDF p.17 | 图中728通道标注与正文512通道存在冲突。 |
| [表III：ACT 超参数](table03_act_hyperparameters_p18.png) | PDF p.18 | 以本地论文的 k=100 为复现起点。 |

Obsidian 中可使用 `![[fig04_act_architecture_p04.png|800]]` 嵌入；主笔记使用相对 Markdown 链接便于跨编辑器阅读。
