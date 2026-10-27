import {existsSync} from "node:fs";
import * as vscode from "vscode";
import {resolveNodeTestWorkspace} from "../config";
import {findImageFieldAt, parseTestDocument} from "../core/document";
import type {ImageField} from "../core/document";
import {findNodeAtOffset, getNodePath, parseTree} from "jsonc-parser";
import {buildImageHoverMarkdown} from "../core/hover";
import {describeNodeBehavior, describePipelineNode, isHitsEntryPath} from "../core/pipeline";
import type {PipelineNode} from "../core/pipeline";
import type {RepoIndex} from "../core/repoIndex";
import {locateImage} from "../core/testset";

/**
 * 光标落在用例的 image 字段（键或值都算）上时，把这个文件在各个平台/资源下的截图列出来，
 * 找到的直接内嵌预览。其它位置一律不弹。
 */
export class NodeTestHoverProvider implements vscode.HoverProvider {
    constructor(private readonly indexOf: () => RepoIndex | null = () => null) {}

    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
        const text = document.getText();
        const parsed = parseTestDocument(text);
        if (parsed.problems.length > 0) return null;

        const offset = document.offsetAt(position);
        const field = findImageFieldAt(parsed, offset);
        // 不是 image 字段就看看是不是 hits 里的节点名
        if (!field) return nodeHover(document, offset, this.indexOf());

        const workspace = resolveNodeTestWorkspace();
        if (!workspace) {
            // 没开文件夹时找不到测试集，明说一句，别让用户以为插件坏了
            const hint = new vscode.MarkdownString(
                "没有打开工作区文件夹，找不到测试集截图。先把放了 maatools.config.mts 的仓库作为工作区打开。",
                true,
            );
            return new vscode.Hover(hint, imageValueRange(document, field));
        }

        const markdown = buildImageHoverMarkdown(
            {
                imageName: field.value,
                controllers: parsed.configs.controller,
                testsetLabel: workspace.testsetDir,
                testsetExists: existsSync(workspace.testsetRoot),
                locations: locateImage(workspace.testsetRoot, field.value),
                controllerDirs: controllerDirsOf(this.indexOf()),
                imageWidth: workspace.hoverImageWidth,
            },
            toMarkdownUri,
        );

        const contents = new vscode.MarkdownString(markdown, true);
        contents.supportHtml = true;
        return new vscode.Hover(contents, imageValueRange(document, field));
    }
}

/** 显示名 → 目录名；没有索引时给空表，调用方按同名处理 */
function controllerDirsOf(index: RepoIndex | null): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of index?.controllers ?? []) map.set(entry.name, entry.dir ?? entry.name);
    return map;
}

/** hover 范围只圈住 image 的字符串值，跟着鼠标走，不会整块闪 */
function imageValueRange(document: vscode.TextDocument, field: ImageField): vscode.Range {
    return new vscode.Range(
        document.positionAt(field.valueOffset),
        document.positionAt(field.valueOffset + field.valueLength),
    );
}

/**
 * file 路径转 Markdown 链接里的 URI。括号会被 Markdown 当成链接结束，先转义掉，
 * 否则文件名里有括号的截图链接就会断。
 */
function toMarkdownUri(absolutePath: string): string {
    return vscode.Uri.file(absolutePath).toString().replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/**
 * `hits` 里的节点名悬浮：显示 pipeline 里的 desc 和定义位置，并提示可以跳转。
 * 只对 `cases[n].hits[m]`（含 `.node` 写法）生效，别的字段里点到同名文字不弹。
 */
async function nodeHover(
    document: vscode.TextDocument,
    offset: number,
    index: RepoIndex | null,
): Promise<vscode.Hover | null> {
    if (!index) return null;

    const root = parseTree(document.getText());
    if (!root) return null;

    const node = findNodeAtOffset(root, offset);
    if (!node || node.type !== "string" || typeof node.value !== "string") return null;
    const path = getNodePath(node);
    if (!isHitsEntryPath(path)) return null;

    const info = index.nodeInfo(node.value);
    if (!info) {
        const missing = new vscode.MarkdownString(
            `**${node.value}** · pipeline 里没有这个节点\n\n检查节点名有没有写错，或者是哪个 pipeline 文件还没被加载。`,
            true,
        );
        missing.supportHtml = false;
        return new vscode.Hover(missing, stringRange(document, node.offset, node.length));
    }

    const where = vscode.workspace.asRelativePath(vscode.Uri.file(info.filePath));
    const blocks = [`**${info.name}** · \`${where}:${info.line}\``];

    const summary = describePipelineNode(info);
    if (summary) blocks.push(summary);

    const behavior = describeNodeBehavior(info);
    if (behavior) blocks.push(behavior);

    // 贴上节点自己的源码片段（参考 maa-support-extension 的悬浮写法），太长就截断
    const source = await nodeSource(info);
    if (source) blocks.push("```json\n" + source + "\n```");

    blocks.push("Ctrl+Click 或 F12 跳到定义");

    const markdown = new vscode.MarkdownString(blocks.join("\n\n"), true);
    return new vscode.Hover(markdown, stringRange(document, node.offset, node.length));
}

/** JSON 字符串节点的范围（JSON.parse 的 offset/length 含引号） */
function stringRange(document: vscode.TextDocument, offset: number, length: number): vscode.Range {
    return new vscode.Range(document.positionAt(offset), document.positionAt(offset + length));
}

/** 悬浮里最多贴这么多行节点源码，再多就截断（不然悬浮框比屏幕还高） */
const HOVER_SOURCE_LINES = 40;

/** 按 offset 从 pipeline 文件里截出这段节点源码 */
async function nodeSource(info: PipelineNode): Promise<string | undefined> {
    const target = await vscode.workspace.openTextDocument(vscode.Uri.file(info.filePath));
    const text = target.getText(new vscode.Range(target.positionAt(info.keyOffset), target.positionAt(info.endOffset)));
    const lines = text.split("\n");
    if (lines.length <= HOVER_SOURCE_LINES) return text;
    return [
        ...lines.slice(0, HOVER_SOURCE_LINES),
        `    … 还有 ${lines.length - HOVER_SOURCE_LINES} 行`,
    ].join("\n");
}
