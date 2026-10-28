// 版本状态的文字表示；不依赖 VS Code，也不执行版本查询。

export interface ToolLocation {
    workspaceRoot: string;
    cliPath: string;
    resolvedCliPath?: string;
    nodePath: string;
    configPath: string;
}

export interface ToolStatus {
    kind: "checking" | "missing" | "unknown" | "ready" | "incompatible";
    location: ToolLocation;
    version?: string;
    versionSource?: "cli" | "package";
    reason?: string;
}

/** CLI 或安装包提供的值必须确实是版本号，不能拿日志首行当版本。 */
export function isToolVersion(value: unknown): value is string {
    if (typeof value !== "string" || value.trim() !== value) return false;
    const match =
        /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
            value,
        );
    return (
        match !== null &&
        (match[4] === undefined ||
            match[4].split(".").every((part) => !/^\d+$/.test(part) || part === "0" || !part.startsWith("0")))
    );
}

export function describeToolStatus(status: ToolStatus, supportedRange: string): {text: string; tooltip: string} {
    const version = status.version ?? "版本未知";
    const labels = {
        checking: {text: "maa-tools 查询中…", state: "正在查询命令行版本"},
        missing: {text: "maa-tools 未安装", state: "未找到仓库中的命令入口"},
        unknown: {
            text: status.version ? `maa-tools ${version}（未确认）` : "maa-tools 版本未知",
            state: "命令行版本查询失败",
        },
        ready: {text: `maa-tools ${version}`, state: "版本满足要求"},
        incompatible: {text: `maa-tools ${version}（不兼容）`, state: "版本不在扩展支持范围内"},
    };
    const {location} = status;
    const lines = [
        `maa-tools：${labels[status.kind].state}`,
        ...(status.version
            ? [
                  `版本：${version}（${status.versionSource === "package" ? "安装包 package.json 声明" : "命令行 --version"}）`,
              ]
            : []),
        `支持范围：${supportedRange}`,
        `被测仓库：${location.workspaceRoot}`,
        `命令入口：${location.cliPath}`,
        ...(location.resolvedCliPath && location.resolvedCliPath !== location.cliPath
            ? [`实际文件：${location.resolvedCliPath}`]
            : []),
        `Node：${location.nodePath}`,
        `配置：${location.configPath}`,
        ...(status.reason ? [status.reason] : []),
        "点击重新查询版本。",
    ];
    return {text: labels[status.kind].text, tooltip: lines.join("\n")};
}
