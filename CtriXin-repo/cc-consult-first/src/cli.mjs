import process from "node:process"

import { getMissingRequiredConfig, getSafeConfigView, loadConfig } from "./config.mjs"
import { consultRemoteBrain, fetchSessionState, readContextFile } from "./consult/client.mjs"

function parseArgs(argv = []) {
  const flags = {}
  const positionals = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) {
      positionals.push(token)
      continue
    }

    const [name, inlineValue] = token.slice(2).split("=", 2)
    if (inlineValue !== undefined) {
      flags[name] = inlineValue
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith("--")) {
      flags[name] = true
      continue
    }

    flags[name] = next
    index += 1
  }

  return { flags, positionals }
}

async function readStdinText() {
  if (process.stdin.isTTY) {
    return ""
  }

  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8").trim()
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function printHelp() {
  process.stdout.write(`cc-consult-first commands\n\n`)
  process.stdout.write(`  npm run doctor\n`)
  process.stdout.write(`  npm run consult -- "your prompt"\n`)
  process.stdout.write(`  npm run consult -- --session demo-1 --context-file ./tmp/context.md "your prompt"\n`)
  process.stdout.write(`  npm run session:state -- --session demo-1\n`)
}

async function runDoctor(config) {
  return {
    ok: true,
    missing: getMissingRequiredConfig(config),
    config: getSafeConfigView(config)
  }
}

async function runConsult(config, argv) {
  const { flags, positionals } = parseArgs(argv)
  const prompt = flags.prompt || positionals.join(" ") || (await readStdinText())

  if (!prompt) {
    throw new Error("prompt is required")
  }

  const contextText = flags["context-file"] ? await readContextFile(String(flags["context-file"])) : ""
  const result = await consultRemoteBrain(config, {
    prompt,
    contextText,
    sessionId: flags.session ? String(flags.session) : "",
    endpoint: flags.endpoint ? String(flags.endpoint) : ""
  })

  if (flags.raw) {
    return result
  }

  return {
    ok: true,
    endpoint: result.endpoint,
    routing: result.routing,
    remote_session_id: result.remote_session_id,
    response_id: result.response_id,
    output: result.output,
    usage: result.usage
  }
}

async function runSessionState(config, argv) {
  const { flags } = parseArgs(argv)
  return fetchSessionState(config, {
    sessionId: flags.session ? String(flags.session) : ""
  })
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const [command = "help", ...rest] = argv
  const config = loadConfig(env)

  if (command === "help") {
    printHelp()
    return 0
  }

  if (command === "doctor") {
    printJson(await runDoctor(config))
    return 0
  }

  const missing = getMissingRequiredConfig(config)
  if (missing.length) {
    throw new Error(`missing required config: ${missing.join(", ")}`)
  }

  if (command === "consult") {
    const result = await runConsult(config, rest)
    if (result.output && !result.raw) {
      process.stdout.write(`${result.output}\n`)
      return 0
    }
    printJson(result)
    return 0
  }

  if (command === "session:state") {
    printJson(await runSessionState(config, rest))
    return 0
  }

  throw new Error(`unknown command: ${command}`)
}
