---
title: "强化学习"
published: 2026-11-04
description: '智能体通过与环境交互、以奖励为信号学习策略。'
image: ''
tags: ["强化学习"]
category: '基础知识/强化学习'
draft: false
lang: ''
---

## 什么是强化学习

强化学习研究智能体（agent）如何在与环境（environment）的交互中，通过试错获得最大化累积奖励的策略。

## 核心要素

- **状态 State**：环境在某一时刻的描述。
- **动作 Action**：智能体可以执行的操作。
- **奖励 Reward**：环境对动作的即时反馈。
- **策略 Policy**：从状态到动作的映射 $\pi(a\mid s)$。

## 目标

最大化期望累积回报：

$$
G_t = \sum_{k=0}^{\infty} \gamma^k r_{t+k+1}
$$

其中 $\gamma \in [0, 1]$ 为折扣因子。
