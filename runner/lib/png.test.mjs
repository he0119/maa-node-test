import assert from "node:assert/strict";
import {test} from "node:test";

import {readPngSize} from "./png.mjs";

/** 造一个只带文件头的假 PNG：签名 + 块长度 + IHDR + 宽 + 高。 */
function pngHeader(width, height) {
    const buffer = Buffer.alloc(33);
    Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
    ]).copy(buffer, 0);
    buffer.writeUInt32BE(13, 8);
    buffer.write("IHDR", 12, "latin1");
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}

test("读出 1280x720", () => {
    assert.deepEqual(readPngSize(pngHeader(1280, 720)), {width: 1280, height: 720});
});

test("读出其它尺寸", () => {
    assert.deepEqual(readPngSize(pngHeader(1920, 1080)), {width: 1920, height: 1080});
});

test("不是 PNG 返回 null", () => {
    assert.equal(readPngSize(Buffer.from("not a png file at all, just text")), null);
});

test("数据太短返回 null", () => {
    assert.equal(readPngSize(pngHeader(1280, 720).subarray(0, 10)), null);
    assert.equal(readPngSize(Buffer.alloc(0)), null);
});

test("签名对但第一个块不是 IHDR 时返回 null", () => {
    const buffer = pngHeader(1280, 720);
    buffer.write("IDAT", 12, "latin1");
    assert.equal(readPngSize(buffer), null);
});
