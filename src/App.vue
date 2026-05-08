<script setup>
import { computed, ref } from 'vue'

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]

const fileInput = ref(null)
const fileName = ref('')
const fileSize = ref(0)
const imageUrl = ref('')
const comments = ref([])
const error = ref('')
const isDragging = ref(false)
const isReading = ref(false)

const hasResult = computed(() => fileName.value && !isReading.value && !error.value)
const formattedComments = computed(() =>
  comments.value.map((comment) => ({
    ...comment,
    content: parseCommentContent(comment.value),
  })),
)
const formattedSize = computed(() => {
  if (!fileSize.value) return ''
  if (fileSize.value < 1024) return `${fileSize.value} B`
  if (fileSize.value < 1024 * 1024) return `${(fileSize.value / 1024).toFixed(1)} KB`
  return `${(fileSize.value / 1024 / 1024).toFixed(2)} MB`
})

function resetResult() {
  comments.value = []
  error.value = ''
}

function openPicker() {
  fileInput.value?.click()
}

async function handleFileInput(event) {
  const [file] = event.target.files
  await readFile(file)
  event.target.value = ''
}

async function handleDrop(event) {
  isDragging.value = false
  const [file] = event.dataTransfer.files
  await readFile(file)
}

async function readFile(file) {
  resetResult()

  if (!file) return

  if (imageUrl.value) {
    URL.revokeObjectURL(imageUrl.value)
  }

  fileName.value = file.name
  fileSize.value = file.size
  imageUrl.value = ''

  if (file.type && file.type !== 'image/png') {
    error.value = '请选择 PNG 图片文件。'
    return
  }

  imageUrl.value = URL.createObjectURL(file)
  isReading.value = true

  try {
    const buffer = await file.arrayBuffer()
    const result = await readPngTextChunks(buffer)
    comments.value = result.filter((item) => item.keyword.toLowerCase() === 'comment')
  } catch (readError) {
    error.value = readError.message || '读取 PNG 属性失败。'
  } finally {
    isReading.value = false
  }
}

async function readPngTextChunks(buffer) {
  const bytes = new Uint8Array(buffer)

  if (!hasPngSignature(bytes)) {
    throw new Error('文件不是有效的 PNG 格式。')
  }

  const view = new DataView(buffer)
  const chunks = []
  let offset = 8

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = ascii(bytes, offset + 4, 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    if (dataEnd + 4 > bytes.length) {
      throw new Error('PNG 文件结构不完整，无法继续读取。')
    }

    if (type === 'tEXt') {
      const chunk = readTextChunk(bytes.slice(dataStart, dataEnd), type)
      if (chunk) chunks.push(chunk)
    }

    if (type === 'iTXt') {
      const chunk = await readInternationalTextChunk(bytes.slice(dataStart, dataEnd), type)
      if (chunk) chunks.push(chunk)
    }

    if (type === 'zTXt') {
      const chunk = await readCompressedTextChunk(bytes.slice(dataStart, dataEnd), type)
      if (chunk) chunks.push(chunk)
    }

    offset = dataEnd + 4
    if (type === 'IEND') break
  }

  return chunks
}

function hasPngSignature(bytes) {
  return pngSignature.every((value, index) => bytes[index] === value)
}

function readTextChunk(data, type) {
  const separator = data.indexOf(0)
  if (separator < 0) return null

  return {
    type,
    keyword: latin1(data.slice(0, separator)),
    value: latin1(data.slice(separator + 1)),
  }
}

async function readCompressedTextChunk(data, type) {
  const separator = data.indexOf(0)
  if (separator < 0 || separator + 1 >= data.length) return null

  const compressionMethod = data[separator + 1]
  if (compressionMethod !== 0) {
    return {
      type,
      keyword: latin1(data.slice(0, separator)),
      value: '暂不支持该 PNG 压缩文本格式。',
    }
  }

  const compressedText = data.slice(separator + 2)

  return {
    type,
    keyword: latin1(data.slice(0, separator)),
    value: await inflateZlibText(compressedText, 'latin1'),
  }
}

async function readInternationalTextChunk(data, type) {
  const keywordEnd = data.indexOf(0)
  if (keywordEnd < 0 || keywordEnd + 2 >= data.length) return null

  const keyword = latin1(data.slice(0, keywordEnd))
  const compressionFlag = data[keywordEnd + 1]
  const compressionMethod = data[keywordEnd + 2]
  let cursor = keywordEnd + 3

  const languageEnd = data.indexOf(0, cursor)
  if (languageEnd < 0) return null
  cursor = languageEnd + 1

  const translatedKeywordEnd = data.indexOf(0, cursor)
  if (translatedKeywordEnd < 0) return null
  cursor = translatedKeywordEnd + 1

  const textBytes = data.slice(cursor)
  const value =
    compressionFlag === 1
      ? await inflateZlibText(textBytes, 'utf-8', compressionMethod)
      : utf8(textBytes)

  return { type, keyword, value }
}

async function inflateZlibText(bytes, encoding, compressionMethod = 0) {
  if (compressionMethod !== 0) {
    return '暂不支持该 PNG 压缩文本格式。'
  }

  if (!('DecompressionStream' in window)) {
    return '当前浏览器不支持读取压缩 PNG 文本属性。'
  }

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
    const buffer = await new Response(stream).arrayBuffer()
    const inflated = new Uint8Array(buffer)
    return encoding === 'latin1' ? latin1(inflated) : utf8(inflated)
  } catch {
    return '压缩 PNG 文本属性解压失败。'
  }
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

function latin1(bytes) {
  return new TextDecoder('iso-8859-1').decode(bytes)
}

function utf8(bytes) {
  return new TextDecoder('utf-8').decode(bytes)
}

function parseCommentContent(value) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return {
      type: 'text',
      value: '',
    }
  }

  try {
    const parsedValue = JSON.parse(trimmedValue)
    const rows = toKeyValueRows(parsedValue)

    if (rows.length) {
      return {
        type: 'pairs',
        rows,
      }
    }
  } catch {
    const rows = parseLooseKeyValuePairs(trimmedValue)

    if (rows.length) {
      return {
        type: 'pairs',
        rows,
      }
    }
  }

  return {
    type: 'text',
    value: normalizeText(trimmedValue),
  }
}

function toKeyValueRows(value) {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      key: String(index),
      value: stringifyCommentValue(item),
    }))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => ({
      key,
      value: stringifyCommentValue(item),
    }))
  }

  return []
}

function parseLooseKeyValuePairs(value) {
  const rows = normalizeText(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = findLooseSeparator(line)
      if (separatorIndex < 1) return null

      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      }
    })
    .filter(Boolean)

  return rows.length ? rows : []
}

function findLooseSeparator(value) {
  const colonIndex = value.indexOf(':')
  const equalIndex = value.indexOf('=')

  if (colonIndex < 0) return equalIndex
  if (equalIndex < 0) return colonIndex
  return Math.min(colonIndex, equalIndex)
}

function stringifyCommentValue(value) {
  if (value === null) return 'null'
  if (typeof value === 'string') return normalizeText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return normalizeText(trimOuterJsonBrackets(JSON.stringify(value, null, 2), 2))
}

function trimOuterJsonBrackets(value, maxDepth = 1) {
  let nextValue = value.trim()

  for (let depth = 0; depth < maxDepth; depth++) {
    const startsWithObject = nextValue.startsWith('{') && nextValue.endsWith('}')
    const startsWithArray = nextValue.startsWith('[') && nextValue.endsWith(']')

    if (!startsWithObject && !startsWithArray) break

    nextValue = removeOneJsonWrapper(nextValue)
  }

  return nextValue
}

function removeOneJsonWrapper(value) {
  return value
    .slice(1, -1)
    .split('\n')
    .map((line) => line.replace(/^  /, ''))
    .join('\n')
    .trim()
}

function normalizeText(value) {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
}
</script>

<template>
  <main class="app-shell">
    <section class="tool-panel">
      <div class="heading-row">
        <div class="heading">
          <p class="eyebrow">NovelAI metadata reader</p>
          <h1>读取 NovelAI 属性</h1>
        </div>
        <!-- <span class="format-badge">PNG</span> -->
      </div>

      <button
        class="drop-zone"
        :class="{ active: isDragging }"
        type="button"
        @click="openPicker"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleDrop"
      >
        <span class="upload-icon" aria-hidden="true">+</span>
        <span class="drop-title">选择或拖入 PNG 文件</span>
      </button>

      <input
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept="image/png,.png"
        @change="handleFileInput"
      />

      <!-- <section v-if="fileName" class="file-summary" aria-live="polite">
        <div>
          <span class="label">文件</span>
          <strong>{{ fileName }}</strong>
        </div>
        <div>
          <span class="label">大小</span>
          <strong>{{ formattedSize }}</strong>
        </div>
      </section> -->

      <p v-if="isReading" class="status">正在读取 PNG 属性...</p>
      <p v-if="error" class="message error">{{ error }}</p>

      <div v-if="imageUrl || hasResult" class="workspace-grid">
        <section v-if="imageUrl && !error" class="image-preview" aria-label="选择的图片预览">
          <div class="section-title">
            <h2>图片预览</h2>
          </div>
          <div class="preview-frame">
            <img :src="imageUrl" :alt="fileName" />
          </div>
        </section>

        <section v-if="hasResult" class="result-area">
          <div class="section-title">
            <h2>属性</h2>
            <!-- <span>{{ formattedComments.length ? `${formattedComments.length} 组` : '未找到' }}</span> -->
          </div>

          <div v-if="formattedComments.length" class="comment-list">
            <article
              v-for="(comment, index) in formattedComments"
              :key="`${comment.type}-${index}`"
            >
              <div v-if="comment.content.type === 'pairs'" class="comment-table-wrap">
                <table class="comment-table">
                  <thead>
                    <tr>
                      <th scope="col">属性</th>
                      <th scope="col">值</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in comment.content.rows" :key="row.key">
                      <th scope="row">{{ row.key }}</th>
                      <td>
                        <pre>{{ row.value }}</pre>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <pre v-else>{{ comment.content.value }}</pre>
            </article>
          </div>

          <p v-else class="message">
            这张 PNG 中没有找到 keyword 为 Comment 的文本属性。
          </p>
        </section>
      </div>
    </section>
  </main>
</template>
