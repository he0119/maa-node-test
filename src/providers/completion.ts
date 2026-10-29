import * as vscode from "vscode";
import {parseTestDocument} from "../core/document";
import {candidatesFor, completionContextAt, insertTextOf} from "../core/completion";
import type {Candidate, CompletionContext} from "../core/completion";
import type {RepoIndex} from "../core/repoIndex";

/**
 * 测试文件里的补全：`controller` / `resource` 给 loader 里登记过的名字，`image` 给测试集里真实存在的
 * 截图，`hits` 给 pipeline 里的节点名，另外各级对象的键也能补。
 */
/** 带懒加载钩子的补全项：展开时才去查节点注释，省掉每次输入都拼上千段文字 */
interface DetailItem extends vscode.CompletionItem {
    fillDetail?: () => string | undefined;
}

export class NodeTestCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private readonly indexOf: () => RepoIndex | null) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionItem[] | undefined {
        const index = this.indexOf();
        if (!index) return undefined;

        const text = document.getText();
        const context = completionContextAt(text, document.offsetAt(position));
        if (!context) return undefined;

        // 按本文件声明的平台和子目录查找截图候选。
        const configs = parseTestDocument(text).configs;
        const declared = configs.controller;
        const candidates = candidatesFor(context, index, declared, configs.imageRoot);
        if (candidates.length === 0) return undefined;

        return candidates.map((candidate) => toCompletionItem(candidate, context, index, declared));
    }

    /** 展开候选时才把节点注释填进去（照参考实现的做法） */
    resolveCompletionItem(item: DetailItem): vscode.CompletionItem {
        const text = item.fillDetail?.();
        if (text) item.documentation = new vscode.MarkdownString(text);
        return item;
    }
}

function toCompletionItem(
    candidate: Candidate,
    context: CompletionContext,
    index: RepoIndex,
    declared: readonly string[],
): vscode.CompletionItem {
    const item: DetailItem = new vscode.CompletionItem(candidate.label, kindOf(candidate));
    item.insertText = insertTextOf(candidate, context);
    if (candidate.detail) item.detail = candidate.detail;
    // 节点候选：注释 + Reco/Act + 定义位置，展开候选时才查
    if (candidate.nodeName) item.fillDetail = () => index.describeNode(candidate.nodeName ?? "", declared);
    return item;
}

function kindOf(candidate: Candidate): vscode.CompletionItemKind {
    switch (candidate.kind) {
        case "key":
            return vscode.CompletionItemKind.Property;
        case "image":
            return vscode.CompletionItemKind.File;
        case "node":
            return vscode.CompletionItemKind.Reference;
        default:
            return vscode.CompletionItemKind.EnumMember;
    }
}
