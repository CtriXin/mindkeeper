import test from "node:test"
import assert from "node:assert/strict"

import { getMissingRequiredConfig, loadConfig } from "../src/config.mjs"

test("loadConfig normalizes service root from consult_opus URL", () => {
  const config = loadConfig(
    {
      CC_CONSULT_BASE_URL: "http://23.95.30.199:28082/consult_opus",
      CC_CONSULT_BEARER_TOKEN: "token"
    },
    { disableFallback: true }
  )

  assert.equal(config.baseUrl, "http://23.95.30.199:28082")
  assert.equal(config.endpoint, "chat.completions")
})

test("getMissingRequiredConfig reports base url and token", () => {
  const config = loadConfig({}, { disableFallback: true })
  assert.deepEqual(getMissingRequiredConfig(config), [
    "CC_CONSULT_BASE_URL",
    "CC_CONSULT_BEARER_TOKEN"
  ])
})
