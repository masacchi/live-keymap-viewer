/**
 * キーボード定義の展開。
 *
 * Cornix LP V1.12の定義ブロックはXZコンテナだった(docs/PROTOCOL.md §3)。
 * vial-guiはPythonのlzma.decompressに自動判別させているので、念のため
 * LZMA-alone(先頭0x5D)が来たときはそれと分かるエラーにしてある。
 */
import { XzReadableStream } from 'xz-decompress'

const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]

export function looksLikeXz(data: Uint8Array): boolean {
  return XZ_MAGIC.every((byte, i) => data[i] === byte)
}

export function looksLikeLzmaAlone(data: Uint8Array): boolean {
  // properties byteが0x5D(lc=3, lp=0, pb=2)なのが一般的
  return data[0] === 0x5d && data[1] === 0x00 && data[2] === 0x00
}

export async function decompressDefinition(data: Uint8Array): Promise<Uint8Array> {
  if (!looksLikeXz(data)) {
    if (looksLikeLzmaAlone(data)) {
      throw new Error('キーボード定義がLZMA-alone形式でした。このアプリはXZにしか対応していません')
    }
    throw new Error('キーボード定義の圧縮形式が判別できませんでした')
  }

  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    }
  })
  const buffer = await new Response(new XzReadableStream(source)).arrayBuffer()
  return new Uint8Array(buffer)
}
