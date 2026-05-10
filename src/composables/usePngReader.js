const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]

export function usePngReader() {
  function readPngTextChunks(buffer) {
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

      if (type === 'IEND') break

      if (type === 'tEXt') {
        const chunk = readTextChunk(bytes.subarray(dataStart, dataEnd), type)
        if (chunk) chunks.push(chunk)
      } else if (type === 'iTXt') {
        const chunk = readInternationalTextChunk(bytes.subarray(dataStart, dataEnd), type)
        if (chunk) chunks.push(chunk)
      } else if (type === 'zTXt') {
        const chunk = readCompressedTextChunk(bytes.subarray(dataStart, dataEnd), type)
        if (chunk) chunks.push(chunk)
      }

      offset = dataEnd + 4
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

  function readCompressedTextChunk(data, type) {
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
      value: inflateZlibText(compressedText, 'latin1'),
    }
  }

  function readInternationalTextChunk(data, type) {
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
        ? inflateZlibText(textBytes, 'utf-8', compressionMethod)
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
    return String.fromCharCode(...bytes.subarray(start, start + length))
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

  return {
    readPngTextChunks,
    parseCommentContent,
  }
}
