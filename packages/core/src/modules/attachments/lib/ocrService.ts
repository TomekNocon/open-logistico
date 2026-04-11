import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { fromPath } from 'pdf2pic'
import { execFile } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { promisify } from 'util'

export type OcrServiceOptions = {
  apiKey?: string
  model?: string
}

export type OcrInput = {
  filePath: string
  mimeType: string | null
  model?: string
}

export type OcrResult = {
  content: string
  pageCount?: number
  processingTimeMs: number
}

const DEFAULT_MODEL = 'gpt-4o'
const PDF_OCR_DEPENDENCY_GUIDANCE =
  'PDF OCR requires GraphicsMagick (`gm`) or ImageMagick (`convert`) on PATH. Install dependencies (macOS: brew install graphicsmagick ghostscript poppler; Ubuntu/Debian: sudo apt-get install graphicsmagick ghostscript poppler-utils) or disable default OCR via OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED=false.'
const GM_MISSING_BINARY_ERROR_FRAGMENT = "gm/convert binaries can't be found"

const execFileAsync = promisify(execFile)

const DEFAULT_OCR_PROMPT = `Extract all text content from this image. Preserve the structure and formatting where possible. Output the text in markdown format. If there are tables, preserve them as markdown tables. If there is no text visible, respond with an empty string.`

type PdfBackend = 'graphicsmagick' | 'imagemagick'

let resolvedPdfBackendPromise: Promise<PdfBackend | null> | null = null
let missingPdfBackendWarningEmitted = false

function isImageMimeType(mimeType: string | null, filePath?: string): boolean {
  const normalized = (mimeType || '').toLowerCase()
  if (normalized.startsWith('image/')) return true
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase()
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff'].includes(ext)
  }
  return false
}

function isPdfMimeType(mimeType: string | null, filePath?: string): boolean {
  const normalized = (mimeType || '').toLowerCase()
  if (normalized === 'application/pdf') return true
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase()
    return ext === '.pdf'
  }
  return false
}

function getImageMediaType(mimeType: string | null, filePath: string): string {
  if (mimeType && mimeType.startsWith('image/')) {
    return mimeType
  }
  const ext = path.extname(filePath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
  }
  return mimeMap[ext] || 'image/png'
}

async function commandOutputContainsToken(command: string, args: string[], token: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 4000 })
    const output = `${stdout ?? ''}\n${stderr ?? ''}`.toLowerCase()
    return output.includes(token.toLowerCase())
  } catch {
    return false
  }
}

async function resolvePdfBackend(): Promise<PdfBackend | null> {
  if (!resolvedPdfBackendPromise) {
    resolvedPdfBackendPromise = (async () => {
      const graphicsMagickAvailable = await commandOutputContainsToken('gm', ['version'], 'graphicsmagick')
      if (graphicsMagickAvailable) return 'graphicsmagick'

      const imageMagickAvailable = await commandOutputContainsToken('convert', ['-version'], 'imagemagick')
      if (imageMagickAvailable) return 'imagemagick'

      return null
    })()
  }

  return resolvedPdfBackendPromise
}

function isMissingPdfBackendError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.message.includes('Could not execute GraphicsMagick/ImageMagick') ||
    error.message.includes(GM_MISSING_BINARY_ERROR_FRAGMENT)
  )
}

function warnMissingPdfBackendOnce(): void {
  if (missingPdfBackendWarningEmitted) return
  missingPdfBackendWarningEmitted = true
  console.warn(`[attachments.ocr] ${PDF_OCR_DEPENDENCY_GUIDANCE}`)
}

export class OcrService {
  private readonly apiKey: string | null
  private readonly defaultModel: string
  private client: ReturnType<typeof createOpenAI> | null = null

  constructor(opts: OcrServiceOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? null
    this.defaultModel = opts.model ?? process.env.OCR_MODEL ?? DEFAULT_MODEL
  }

  get available(): boolean {
    return Boolean(this.apiKey)
  }

  private ensureClient() {
    if (!this.apiKey) {
      throw new Error('[attachments.ocr] Missing OPENAI_API_KEY environment variable')
    }
    if (!this.client) {
      this.client = createOpenAI({ apiKey: this.apiKey })
    }
    return this.client
  }

  async processImage(input: OcrInput): Promise<OcrResult> {
    const startTime = Date.now()
    const { filePath, mimeType, model } = input
    const resolvedModel = model ?? this.defaultModel

    const client = this.ensureClient()
    const imageBuffer = await fs.readFile(filePath)
    const base64 = imageBuffer.toString('base64')
    const mediaType = getImageMediaType(mimeType, filePath)
    const dataUrl = `data:${mediaType};base64,${base64}`

    try {
      const result = await generateText({
        model: client(resolvedModel),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                image: dataUrl,
              },
              {
                type: 'text',
                text: process.env.OCR_DEFAULT_PROMPT ?? DEFAULT_OCR_PROMPT,
              },
            ],
          },
        ],
      })

      return {
        content: result.text.trim(),
        processingTimeMs: Date.now() - startTime,
      }
    } catch (err: any) {
      const statusCandidate =
        err?.statusCode ?? err?.status ?? err?.response?.status ?? err?.response?.statusCode
      const status =
        typeof statusCandidate === 'number'
          ? Number.isFinite(statusCandidate) ? statusCandidate : undefined
          : typeof statusCandidate === 'string'
            ? Number.parseInt(statusCandidate, 10)
            : undefined
      const apiError = err?.data?.error ?? err?.body?.error ?? err?.response?.data?.error
      const apiMessage = apiError?.message ?? err?.response?.data?.message
      const apiCode = typeof apiError?.code === 'string' ? apiError.code : undefined
      const rawMessage = typeof apiMessage === 'string'
        ? apiMessage
        : (typeof err?.message === 'string' ? err.message : 'OCR request failed')

      let guidance: string
      switch (apiCode) {
        case 'insufficient_quota':
          guidance = 'OpenAI usage quota exceeded. Please review your plan and billing.'
          break
        case 'invalid_api_key':
          guidance = 'Invalid OpenAI API key. Update the key and retry.'
          break
        case 'account_deactivated':
          guidance = 'OpenAI account is disabled. Contact OpenAI support or provide a different key.'
          break
        case 'rate_limit_exceeded':
          guidance = 'Rate limit exceeded. Please try again later.'
          break
        default:
          guidance = rawMessage.includes('https://')
            ? rawMessage
            : `${rawMessage}. Check OPENAI_API_KEY.`
      }

      const wrapped = new Error(`[attachments.ocr] ${guidance}`)
      if (typeof status === 'number' && Number.isFinite(status)) {
        const normalizedStatus = status === 401 || status === 403 ? 502 : status
        if (normalizedStatus >= 400 && normalizedStatus < 600) {
          (wrapped as any).status = normalizedStatus
        }
      }
      if (apiCode) {
        (wrapped as any).code = apiCode
      }
      (wrapped as any).cause = err
      throw wrapped
    }
  }

  async processPdf(input: OcrInput, backend: PdfBackend): Promise<OcrResult> {
    const startTime = Date.now()
    const { filePath, model } = input
    const resolvedModel = model ?? this.defaultModel

    const tempDir = path.join(os.tmpdir(), `openmercato-ocr-${randomUUID()}`)
    await fs.mkdir(tempDir, { recursive: true })

    try {
      const converter = fromPath(filePath, {
        density: 300,
        format: 'png',
        width: 2480,
        height: 3508,
        savePath: tempDir,
        saveFilename: 'page',
      })
      if (backend === 'imagemagick') {
        converter.setGMClass(true)
      }

      const pdfInfo = await converter.bulk(-1, { responseType: 'image' })
      const pageCount = pdfInfo.length

      if (pageCount === 0) {
        return {
          content: '',
          pageCount: 0,
          processingTimeMs: Date.now() - startTime,
        }
      }

      const pageContents: string[] = []

      for (let i = 0; i < pageCount; i++) {
        const pageInfo = pdfInfo[i]
        if (!pageInfo.path) {
          console.error(`[attachments.ocr] Page ${i + 1} has no path`)
          continue
        }

        try {
          const pageResult = await this.processImage({
            filePath: pageInfo.path,
            mimeType: 'image/png',
            model: resolvedModel,
          })

          if (pageResult.content) {
            if (pageCount > 1) {
              pageContents.push(`--- Page ${i + 1} ---\n\n${pageResult.content}`)
            } else {
              pageContents.push(pageResult.content)
            }
          }

          await fs.unlink(pageInfo.path).catch((err) => {
            console.error(`[attachments.ocr] Failed to cleanup page file: ${pageInfo.path}`, err)
          })
        } catch (err) {
          console.error(`[attachments.ocr] Failed to process page ${i + 1}`, err)
        }
      }

      return {
        content: pageContents.join('\n\n'),
        pageCount,
        processingTimeMs: Date.now() - startTime,
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
        console.error(`[attachments.ocr] Failed to cleanup temp directory: ${tempDir}`, err)
      })
    }
  }

  async processFile(input: OcrInput): Promise<OcrResult | null> {
    const { filePath, mimeType } = input

    if (isPdfMimeType(mimeType, filePath)) {
      console.log(`[attachments.ocr] Processing PDF: ${filePath}`)
      const backend = await resolvePdfBackend()
      if (!backend) {
        warnMissingPdfBackendOnce()
        return null
      }

      try {
        return await this.processPdf(input, backend)
      } catch (error) {
        if (isMissingPdfBackendError(error)) {
          warnMissingPdfBackendOnce()
          return null
        }
        throw error
      }
    }

    if (isImageMimeType(mimeType, filePath)) {
      console.log(`[attachments.ocr] Processing image: ${filePath}`)
      return this.processImage(input)
    }

    console.log(`[attachments.ocr] Unsupported file type: ${mimeType} (${filePath})`)
    return null
  }
}

export function shouldUseLlmOcr(mimeType: string | null, fileName: string): boolean {
  const normalized = (mimeType || '').toLowerCase()
  if (normalized === 'application/pdf') return true
  if (normalized.startsWith('image/')) return true

  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const ocrExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'pdf']
  return ocrExtensions.includes(ext)
}
