import * as vscode from "vscode";
import {parseTestDocument} from "../core/document";
import {candidatesFor, completionContextAt, insertTextOf} from "../core/completion";
import type {Candidate, CompletionContext} from "../core/completion";
import type {RepoIndex} from "../core/repoIndex";

/**
 * 测试文件里的补全：`controller` / `resource` 给 loader 里登记过的名字，`image` 给测试集里真实存在的
 * 截图，`hits` 给 pipeline 里的节点名，另外各级对象的键也能补。
 */
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

        // 已经声明了平台时按平台收窄截图列表 —— 补全里出现的图，应该就是这个文件真会跑到的图
        const declared = parseTestDocument(text).configs.controller;
        const candidates = candidatesFor(context, index, declared);
        if (candidates.length === 0) return undefined;

        return candidates.map((candidate) => toCompletionItem(candidate, context));
    }
}

function toCompletionItem(candidate: Candidate, context: CompletionContext): vscode.CompletionItem {
    const item = new vscode.CompletionItem(candidate.label, kindOf(candidate));
    item.insertText = insertTextOf(candidate, context);
    if (candidate.detail) item.detail = candidate.detail;
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
