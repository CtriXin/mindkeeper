import process from "node:process"

import { runCli } from "./cli.mjs"

runCli().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
