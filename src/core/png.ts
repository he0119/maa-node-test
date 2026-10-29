// PNG 尺寸：只读文件头（签名 + IHDR 的宽高），全仓库就这一份实现。
// 悬浮预览使用尺寸计算图片的显示高度。

import {closeSync, openSync, readSync} from "node:fs";

/** PNG 的像素尺寸 */
export interface PngSize {
    width: number;
    height: number;
}

/** 从 PNG 文件头读尺寸（24 字节：签名 8 + 块长度 4 + IHDR 4 + 宽高 8）。不是 PNG 或头不对返回 null。 */
export function readPngSize(buffer: Uint8Array | null | undefined): PngSize | null {
    const head = buffer ?? null;
    if (!head || head.length < 24) return null;
    const view = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
    // PNG 签名：\x89 P N G \r \n \x1a \n
    if (view.readUInt32BE(0) !== 0x89504e47 || view.readUInt32BE(4) !== 0x0d0a1a0a) return null;
    // 紧接着是 IHDR 块，宽度和高度都是大端 32 位
    if (view.toString("ascii", 12, 16) !== "IHDR") return null;
    const width = view.readUInt32BE(16);
    const height = view.readUInt32BE(20);
    if (width <= 0 || height <= 0) return null;
    return {width, height};
}

/** 读一个 PNG 文件的尺寸。文件读不了、不是 PNG 都返回 null，不影响调用方流程。 */
export function readPngSizeFromFile(filePath: string): PngSize | null {
    let fd: number | undefined;
    try {
        fd = openSync(filePath, "r");
        const head = Buffer.alloc(24);
        const read = readSync(fd, head, 0, 24, 0);
        return readPngSize(read >= 24 ? head : head.subarray(0, read));
    } catch {
        return null;
    } finally {
        if (fd !== undefined) {
            try {
                closeSync(fd);
            } catch {
                // 关闭失败就算了，不影响上面的结果
            }
        }
    }
}
