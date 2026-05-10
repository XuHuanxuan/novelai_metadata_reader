<script setup>
import { computed, ref } from 'vue'
import { usePngReader } from './composables/usePngReader.js'

const { readPngTextChunks, parseCommentContent } = usePngReader()

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
</script>

<template>
  <main class="app-shell">
    <section class="tool-panel">
      <div class="heading-row">
        <div class="heading">
          <p class="eyebrow">NovelAI metadata reader</p>
          <h1>读取 NovelAI 属性</h1>
        </div>
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
