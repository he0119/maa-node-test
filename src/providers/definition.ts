import * as vscode from "vscode";
import {findNodeAtOffset, getNodePath, parseTree} from "jsonc-parser";
import {isHitsEntryPath} from "../core/pipeline";
import type {RepoIndex} from "../core/repoIndex";

/**
 * `hits` 里写的节点名可以 Ctrl+Click / F12 跳到它在 pipeline 里的定义。
 *
 * 只认 `cases[n].hits[m]`（字符串写法）和 `cases[n].hits[m].node`（对象写法）这两个位置，
 * 别的地方点到同名文字不跳 —— 免得在 `name` 字段里误跳。
 */
export class NodeTestDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly indexOf: () => RepoIndex | null) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<vscode.Location | undefined> {
        const index = this.indexOf();
        if (!index) return undefined;

        const root = parseTree(document.getText());
        if (!root) return undefined;

        const node = findNodeAtOffset(root, document.offsetAt(position));
        if (!node || node.type !== "string" || typeof node.value !== "string") return undefined;
        if (!isHitsEntryPath(getNodePath(node))) return undefined;

        const info = index.nodeInfo(node.value);
        if (!info) return undefined;

        // 目标文件可能没被打开过，位置要按它自己的文本算，不能拿当前文档的 positionAt
        const targetUri = vscode.Uri.file(info.filePath);
        const target = await vscode.workspace.openTextDocument(targetUri);
        return new vscode.Location(targetUri, target.positionAt(info.keyOffset));
    }
}
