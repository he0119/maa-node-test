// 版本状态的文字表示；不依赖 VS Code，也不执行版本查询。

export interface ToolLocation {
    workspaceRoot: string;
    cliPath: string;
    resolvedCliPath?: string;
    nodePath: string;
    configPath: string;
}

export interface ToolStatus {
    kind: "checking" | "missing" | "unknown" | "ready" | "outdated";
    location: ToolLocation;
    version?: string;
    versionSource?: "cli" | "package";
    reason?: string;
}

/** CLI 或安装包提供的值必须确实是版本号，不能拿日志首行当版本。 */
export function isToolVersion(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.trim() === value &&
        /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
    );
}

export function describeToolStatus(status: ToolStatus, minimumVersion: string): {text: string; tooltip: string} {
    const version = status.version ?? "版本未知";
    const labels = {
        checking: {text: "maa-tools 查询中…", state: "正在查询命令行版本"},
        missing: {text: "maa-tools 未安装", state: "未找到仓库中的命令入口"},
        unknown: {
            text: status.version ? `maa-tools ${version}（未确认）` : "maa-tools 版本未知",
            state: "命令行版本查询失败",
        },
        ready: {text: `maa-tools ${version}`, state: "版本满足要求"},
        outdated: {text: `maa-tools ${version}（过旧）`, state: "版本低于扩展最低要求"},
    };
    const {location} = status;
    const lines = [
        `maa-tools：${labels[status.kind].state}`,
        ...(status.version
            ? [
                  `版本：${version}（${status.versionSource === "package" ? "安装包 package.json 声明" : "命令行 --version"}）`,
              ]
            : []),
        `最低版本：${minimumVersion}`,
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
