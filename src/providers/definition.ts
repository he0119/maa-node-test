import * as vscode from "vscode";
import {findNodeAtOffset, getNodePath, parseTree} from "jsonc-parser";
import {resolveNodeTestWorkspace} from "../config";
import {findImageFieldAt, parseTestDocument} from "../core/document";
import {resolveControllerDir} from "../core/loaderMaps";
import {isHitsEntryPath} from "../core/hits";
import type {RepoIndex} from "../core/repoIndex";
import {locateImage, orderImageLocations} from "../core/screenshots";

/**
 * 测试文件里有两处可以 Ctrl+Click / F12 跳转，**有多处结果时返回列表**（VS Code 会弹 peek 让人挑）：
 *
 * - `image` 字段（键或值都算）→ 这张截图在各平台的副本，顺序跟本文件 `configs.controller` 一致。
 *   很多时候只是想确认某个平台的图，列表里直接挑那个平台即可；
 * - `hits` 里的节点名（`cases[n].hits[m]` 及其 `.node` 写法）→ 它在 pipeline 里的定义（可能有多层覆盖）。
 *
 * 其它位置不跳 —— 免得在 `name` 字段里点到同名文字就乱跳。
 */
export class NodeTestDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly indexOf: () => RepoIndex | null) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<vscode.Location[] | undefined> {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const index = this.indexOf();

        const image = imageLocation(text, offset, index);
        if (image) return image;

        if (!index) return undefined;

        const root = parseTree(text);
        if (!root) return undefined;

        const node = findNodeAtOffset(root, offset);
        if (!node || node.type !== "string" || typeof node.value !== "string") return undefined;
        if (!isHitsEntryPath(getNodePath(node))) return undefined;

        const infos = index.nodeInfos(node.value, parseTestDocument(text).configs.controller);
        if (infos.length === 0) return undefined;

        // 目标文件可能没被打开过，位置要按它自己的文本算，不能拿当前文档的 positionAt
        const locations: vscode.Location[] = [];
        for (const info of infos) {
            const targetUri = vscode.Uri.file(info.filePath);
            const target = await vscode.workspace.openTextDocument(targetUri);
            locations.push(new vscode.Location(targetUri, target.positionAt(info.keyOffset)));
        }
        return locations;
    }
}

/**
 * 光标落在 `image` 字段上时，指向对应的截图文件。
 * 多个平台都有这张图时，按声明顺序返回各位置，供跳转列表选择。
 */
function imageLocation(text: string, offset: number, index: RepoIndex | null): vscode.Location[] | undefined {
    const parsed = parseTestDocument(text);
    const field = findImageFieldAt(parsed, offset);
    if (!field) return undefined;

    const workspace = resolveNodeTestWorkspace();
    if (!workspace) return undefined;

    // 别名（Win32-Front → Win32）先换成目录名，才能按声明顺序把对应平台排在前面
    const resolvePlatform = (controller: string): string =>
        index ? resolveControllerDir(index.maps(), controller) : controller;

    const ordered = orderImageLocations(
        locateImage(workspace.testsetRoot, field.value, parsed.configs.imageRoot),
        parsed.configs.controller,
        resolvePlatform,
    ).filter((location) => location.filePath !== null);
    if (ordered.length === 0) return undefined;

    // 图片没有「第几行」，给文件开头就行，VS Code 会按图片预览打开
    return ordered.map(
        (location) => new vscode.Location(vscode.Uri.file(location.filePath ?? ""), new vscode.Position(0, 0)),
    );
}
