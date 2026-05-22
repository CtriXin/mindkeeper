# 一次对话为什么需要 Broker

## 一句话结论

Broker 的作用不是替模型思考，而是把“远端推理”和“本地动手”安全地串起来。

## 关键流程

- 用户先在 client MMS 输入需求
- MMS 根据 profile 连接到 Broker
- Broker 把 routing 信息继续往后传给远端层
- 远端 official Claude/Opus 负责主推理
- 如果只是聊天，答案直接回流
- 如果需要本地读文件、搜索、bash 或 git：
  - 远端不会直接碰你电脑
  - 而是经由 Broker 调用 Local Runner
  - Local Runner 在你本机执行后，再把结果经由 Broker 回给远端
- 远端拿到结果后，继续完成推理并输出最终回答

## 为什么不能少 Broker

- 没有 Broker，远端和本地工具之间没有统一调度点
- 多设备 / 多 workspace 隔离会很难做
- usage 统计、session truth、权限边界也会散掉

## 这张图最想说明的点

- Remote 负责“想”
- Runner 负责“动手”
- Broker 负责“把想和动手接起来”
