import {existsSync} from "node:fs";
import * as vscode from "vscode";
import {resolveNodeTestWorkspace} from "../config";
import {findImageFieldAt, parseTestDocument} from "../core/document";
import type {ImageField} from "../core/document";
import {buildImageHoverMarkdown} from "../core/hover";
import {locateImage} from "../core/testset";

/**
 * 光标落在用例的 image 字段（键或值都算）上时，把这个文件在各个平台/资源下的截图列出来，
 * 找到的直接内嵌预览。其它位置一律不弹。
 */
export class NodeTestHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
        const parsed = parseTestDocument(document.getText());
        if (parsed.problems.length > 0) return null;

        const field = findImageFieldAt(parsed, document.offsetAt(position));
        if (!field) return null;

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
                imageWidth: workspace.hoverImageWidth,
            },
            toMarkdownUri,
        );

        const contents = new vscode.MarkdownString(markdown, true);
        contents.supportHtml = true;
        return new vscode.Hover(contents, imageValueRange(document, field));
    }
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
