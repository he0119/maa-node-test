import * as vscode from "vscode";
import {parseHitEntries, truncateInlayLabel} from "../core/hits";
import {describePipelineNode} from "../core/pipeline";
import type {PipelineNode} from "../core/pipeline";
import type {RepoIndex} from "../core/repoIndex";

/**
 * 在 `hits` 的每个节点名后面贴一段灰色注释（pipeline 里的 `desc`），点一下跳到定义。
 *
 * 内联提示比悬浮更省事：一屏里能同时看到好几个节点各自是干什么的，不用一个个悬停。
 */
export class NodeTestInlayHintsProvider implements vscode.InlayHintsProvider {
    constructor(
        private readonly indexOf: () => RepoIndex | null,
        private readonly enabled: () => boolean = () => true,
    ) {}

    provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
        if (!this.enabled()) return [];

        const index = this.indexOf();
        if (!index) return [];

        const hints: vscode.InlayHint[] = [];
        for (const entry of parseHitEntries(document.getText())) {
            // 提示贴在字符串末尾，只处理当前可见范围内那几条（一屏之外的不必算）
            const position = document.positionAt(entry.offset + entry.length);
            if (!range.contains(position)) continue;

            const info = index.nodeInfo(entry.name);
            if (!info) continue;

            const summary = describePipelineNode(info);
            if (!summary) continue;

            hints.push(buildHint(position, info, summary));
        }
        return hints;
    }
}

function buildHint(position: vscode.Position, info: PipelineNode, summary: string): vscode.InlayHint {
    const where = vscode.workspace.asRelativePath(vscode.Uri.file(info.filePath));
    // 提示文本本身要能点：`InlayHint` 没有 command 字段，得挂在 LabelPart 上
    const part = new vscode.InlayHintLabelPart(truncateInlayLabel(summary));
    part.tooltip = new vscode.MarkdownString(`${summary}\n\n定义在 \`${where}:${info.line}\` · 点击跳过去`);
    part.command = {
        title: "跳到定义",
        command: "vscode.open",
        // 用行号定位就够了，不用先把目标文件打开
        arguments: [
            vscode.Uri.file(info.filePath),
            {selection: jumpRange(info.line)},
        ],
    };

    const hint = new vscode.InlayHint(position, [part], vscode.InlayHintKind.Type);
    hint.paddingLeft = true;
    hint.tooltip = part.tooltip;
    return hint;
}

/** 目标文件里要选中的位置（全在行首，够用来定位） */
function jumpRange(line: number): vscode.Range {
    const target = new vscode.Position(Math.max(line - 1, 0), 0);
    return new vscode.Range(target, target);
}
