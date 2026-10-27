import * as vscode from "vscode";
import {parseTestDocument} from "../core/document";
import {buildCodeLensDescriptors, RUN_CASE_COMMAND} from "../core/lens";

/** 只对 tests 下的 test_*.json / test_*.jsonc 生效，其它 JSON 不打扰。CodeLens 和 Hover 共用 */
export const TEST_FILE_SELECTOR: vscode.DocumentSelector = [
    {pattern: "**/tests/**/test_*.json"},
    {pattern: "**/tests/**/test_*.jsonc"},
];

/** 文件顶部跑整文件、每个用例开头跑单条，位置和文案都由 core/lens.ts 算好 */
export class NodeTestCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const parsed = parseTestDocument(document.getText());
        return buildCodeLensDescriptors(parsed).map((descriptor) => {
            const position = document.positionAt(descriptor.offset);
            const range = new vscode.Range(position, position);
            const command: vscode.Command = {
                title: descriptor.title,
                command: descriptor.command,
                arguments:
                    descriptor.command === RUN_CASE_COMMAND
                        ? [
                              document.uri,
                              descriptor.caseIndex ?? 0,
                          ]
                        : [document.uri],
            };
            return new vscode.CodeLens(range, command);
        });
    }
}
