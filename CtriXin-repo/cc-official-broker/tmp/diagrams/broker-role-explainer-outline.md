# Broker 是干嘛的

## 一句话结论

Broker 不是模型本身，也不是本地文件执行器；它更像“中间调度台”，负责把本地入口、远端会话和本地工具执行现场接起来。

## 结构拆解

- 你 / 多台电脑
  - 真正发起使用的人和设备
- client MMS
  - 本地入口
  - 负责选择 profile，决定这次连哪个 broker / 哪个远端池子
- Broker
  - 在中间负责鉴权、隔离、session truth、usage stats、tool bridge
- server-side MMS
  - 未来可以做多 OAuth / 多 runtime 池调度
  - 决定这次请求落到哪组远端资源
- Remote Runtime Service
  - 负责把 broker 这边的请求转成远端 runtime 可以消费的调用
- official Claude Code runtime
  - 真正持有 OAuth，真正完成推理和远端 session
- Local Runner
  - 真正操作你本地文件 / shell / git

## 关键关系

- client MMS -> Broker
  - 本地先选 profile，再进入 broker
- Broker -> server-side MMS
  - broker 可以把“这次是谁、哪个设备、哪个 workspace、哪个 session”的信息往后传
- server-side MMS -> Remote Runtime Service -> official Claude Code runtime
  - 后台决定使用哪组 OAuth / 哪个 runtime 池
- official Claude Code runtime -> Broker -> Local Runner
  - 当远端需要本地读文件、查 git、执行命令时，不是直接碰你电脑，而是通过 broker 转给 Local Runner

## 为什么需要 Broker

- 如果没有 broker：
  - 本地入口、远端会话、本地工具会直接耦合在一起
  - 很难做多设备隔离
  - 很难做 usage 统计
  - 很难把远端推理和本地执行现场桥接起来
- 有了 broker：
  - 你可以把远端“大脑”和本地“手脚”拆开
  - 也可以在未来插入 server-side MMS 做多 OAuth 调度

## 你可以怎么理解它

- client MMS = 前台点单界面
- Broker = 前台调度台 / 中控台
- server-side MMS = 后厨排班系统
- official Claude Code runtime = 真正干活的厨师
- Local Runner = 在你本机动手的工具手臂

## 备注

- 当前我们已经做到：client MMS 可以进 broker，并且 broker 可以指定远端 service 目标
- 还没完全做完的是：真正成熟的 server-side MMS 多 OAuth 调度层
- 所以后面最自然的下一步，是把 server-side MMS 作为 broker 后面的“远端池管理层”做出来
