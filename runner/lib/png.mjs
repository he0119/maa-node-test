// 从 PNG 文件头读像素尺寸。
//
// 为什么要这个：节点测试截图基准是 1280×720，尺寸不对时 MaaFramework 会自动缩放，
// 识别结果可能和作者预期不同。dry-run 把尺寸打出来，能让人一眼看出「图是不是放错了」。
// 只读文件头 24 字节，不整张读进内存。

const PNG_SIGNATURE = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
];

/**
 * 解析 PNG 头部缓冲区，返回 { width, height }；不是 PNG 或数据不够长返回 null。
 * PNG 布局：8 字节签名 + 4 字节块长度 + 4 字节 "IHDR" + 4 字节宽 + 4 字节高。
 */
export function readPngSize(buffer) {
    if (!buffer || typeof buffer.length !== "number" || buffer.length < 24) return null;
    for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
        if (buffer[index] !== PNG_SIGNATURE[index]) return null;
    }
    // IHDR 必须是第一个块，否则不是我们认识的 PNG
    if (buffer.toString("latin1", 12, 16) !== "IHDR") return null;
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}
