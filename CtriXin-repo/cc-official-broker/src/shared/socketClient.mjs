export function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    const handleOpen = () => {
      cleanup()
      resolve()
    }
    const handleError = event => {
      cleanup()
      reject(event.error || new Error("websocket open failed"))
    }
    const cleanup = () => {
      socket.removeEventListener("open", handleOpen)
      socket.removeEventListener("error", handleError)
    }

    socket.addEventListener("open", handleOpen, { once: true })
    socket.addEventListener("error", handleError, { once: true })
  })
}

export function createSocketInbox(socket) {
  const queue = []
  const waiters = []
  let closedError = null

  function tryMatch() {
    if (!queue.length || !waiters.length) {
      return
    }

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const payload = queue[queueIndex]
      const waiterIndex = waiters.findIndex(waiter => waiter.predicate(payload))
      if (waiterIndex === -1) {
        continue
      }

      const [waiter] = waiters.splice(waiterIndex, 1)
      queue.splice(queueIndex, 1)
      waiter.resolve(payload)
      queueIndex -= 1
    }
  }

  socket.addEventListener("message", event => {
    const payload = JSON.parse(event.data)
    queue.push(payload)
    tryMatch()
  })

  socket.addEventListener("error", event => {
    closedError = event.error || new Error("websocket error")
    while (waiters.length) {
      waiters.shift().reject(closedError)
    }
  })

  socket.addEventListener("close", () => {
    if (!closedError) {
      closedError = new Error("websocket closed before expected message")
    }
    while (waiters.length) {
      waiters.shift().reject(closedError)
    }
  })

  return {
    next(predicate = () => true) {
      const queueIndex = queue.findIndex(predicate)
      if (queueIndex !== -1) {
        return Promise.resolve(queue.splice(queueIndex, 1)[0])
      }
      if (closedError) {
        return Promise.reject(closedError)
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject, predicate })
      })
    }
  }
}
