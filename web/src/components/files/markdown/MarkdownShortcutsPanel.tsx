import { buildMarkdownEditorShortcutGroups } from "./markdownEditorShortcuts";

type Props = {
  platform?: string;
};

export function MarkdownShortcutsPanel({ platform }: Props) {
  const groups = buildMarkdownEditorShortcutGroups(platform);

  return (
    <div className="forkly-md-shortcuts">
      <p className="forkly-md-shortcuts-lead">
        以下为当前独立 Markdown 编辑页已支持的快捷键。文字格式快捷键在光标位于段落内、且选区未跨多个块时生效。
      </p>
      {groups.map((group) => (
        <section key={group.id} className="forkly-md-shortcuts-group">
          <h3 className="forkly-md-shortcuts-group-title">{group.title}</h3>
          <table className="forkly-md-shortcuts-table">
            <thead>
              <tr>
                <th scope="col">功能</th>
                <th scope="col">快捷键</th>
                <th scope="col">说明</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.action}</td>
                  <td>
                    <kbd className="forkly-md-shortcuts-keys">{row.keys}</kbd>
                  </td>
                  <td className="forkly-md-shortcuts-note">{row.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

export default MarkdownShortcutsPanel;
