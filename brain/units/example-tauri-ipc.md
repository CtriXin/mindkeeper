---
id: example-tauri-ipc
triggers: ["tauri", "ipc", "invoke", "序列化", "serialization", "BigInt"]
summary: Tauri IPC 不能直接传 BigInt，需要转 string
project: mms
created: 2026-03-25T00:00:00.000Z
accessCount: 0
confidence: 0.95
tags: ["tauri", "rust", "typescript"]
---

# Tauri IPC BigInt 序列化问题

## 现象

在 Tauri 应用中使用 `invoke` 传递包含 `BigInt` 的对象时，会报序列化错误。

## 原因

Tauri 的 IPC 使用 JSON 序列化，而 JSON 标准不支持 BigInt。

## 解决方案

```typescript
// 前端：发送前转换
const data = {
  id: bigIntValue.toString(),  // BigInt -> string
};
await invoke('my_command', { data });

// Rust 端：接收后转换
#[tauri::command]
fn my_command(data: MyData) -> Result<(), String> {
  let id: u64 = data.id.parse().map_err(|e| e.to_string())?;
  // ...
}
```

## 经验

语言边界 = 序列化边界 = 类型擦除点。跨语言传递数据时，优先使用 JSON 原生支持的类型。
