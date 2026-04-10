import { createAnthropic } from '@ai-sdk/anthropic'

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  return createAnthropic({ apiKey })
}

export function getParserModel() {
  return getAnthropicClient()('claude-haiku-4-5-20251001')
}
