# Agent Notes

这里放**设计取舍记录**：代码和 README 装不下的「为什么这么定、放弃了什么」。README 回答「怎么用」，代码回答「怎么实现」，Agent Note 回答「当初为什么不那样做」——防止后来的人（或 agent）把已经否决的方案又提一遍。

## 布局与命名

```text
.agents/notes/
├─ proposed/    # 评审中、还没落地的方案
│  └─ <class>/yyyy-mm-dd-topic-title.md
└─ implemented/ # 已经落地的决定
   └─ <class>/yyyy-mm-dd-topic-title.md
```

- 文件名前缀是**第一次提出**的日期；slug 用小写英文单词加连字符。
- `<class>` 取自下面这个闭集，别自造：

| class | 覆盖什么 |
| --- | --- |
| `feature` | 面向用户的/新增的能力 |
| `bug-fix` | 修缺陷、补上事后发现的漏洞 |
| `simplification` | 只删东西：删代码、删行为、删接口，不加能力 |
| `architecture` | 关于**要发布的源码**的结构决定：包/模块怎么分、运行时用什么词汇 |
| `process` | 围绕代码的工具与流程：构建、脚本、调试方式、目录放哪 |
| `testing` | 测试基础设施与策略 |

判定口径：**architecture 管发出去的源码，process 管周围的工具和流程**。没有 `refactor`：它和 `simplification` 重叠，判据都是「可观察行为有没有变」。

- 本项目只有 `proposed/` 和 `implemented/` 两个状态。**被否掉的方案不单独留文件**，写进最终 `implemented/` 那份的 `## Alternatives considered` 里；本项目规模小，不做归档区。

## 文件格式

前两行固定（英文，便于脚本识别），正文中文：

```markdown
# Agent Note: <标题>

Status: implemented

## Problem

要解决的问题，写到「不看方案也能看懂」为止。

## Decision

已经落地的做法，用现在时。写清楚具体到文件/参数的程度。

## Alternatives considered

每个真正考虑过的方案一段，加粗开头，写清为什么没选。**没有这一节的记录不合格**：只写「我们选了 A」而不写为什么不选 B，等于邀请别人重新提 B。

## Consequences

这个取舍付出了什么、又换来了什么。已知限制也写在这里。
```

`proposed/` 的正文换成 `## Proposal` → `## Acceptance criteria` → `## Risks`，落地时再改写成 `## Decision` + `## Consequences`。

## 什么时候写

- 契约、边界、目录结构、调试/构建流程有变化时；
- 同一个问题第二次讨论、有人提议推翻现有做法时；
- **不写**：纯机械改动（改名、格式化、文案微调）、已经在 README 里说清楚的用法。

改动落在已有记录的范围里时**更新那份**，不要新开一份重复的；决定本身变了就新开一份，并在两份里互相链接（用相对 Markdown 链接，不用编号或裸文件名）。

## 和 DSH 上游的差异

这套约定参照 `deepseek-harness` 的 `.agents/notes/`，但按本项目规模做了删减：不做英中双语对照文件（`.zh.md` + `.i18n.yaml`）、不做归档冻结区、没有格式校验脚本，`class` 集合也以本文件的表为准。
