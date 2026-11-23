import { GitCompare, Play, RotateCcw, Save, Trash2, X } from "lucide-react";
import { diffStats, diffLines } from "./diff";

export interface Version {
  id: number;
  ts: number;
  name: string;
  text: string;
}

interface Props {
  versions: Version[];
  currentText: string;
  onClose(): void;
  onSave(): void;
  onRestore(v: Version): void;
  onDelete(id: number): void;
  onCompare(v: Version): void;
  onRunVersion(v: Version): void;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function VersionsDialog({ versions, currentText, onClose, onSave, onRestore, onDelete, onCompare, onRunVersion }: Props) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">版本管理</div>
            <div className="modal-sub">编辑停顿后自动存快照（最多 30 个），也可手动保存；恢复前会先把当前内容存一份。</div>
          </div>
          <button className="bar-btn tiny" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="versions-body thin">
          <button className="bar-btn accented versions-save" onClick={onSave}>
            <Save size={13} />
            保存当前为新版本
          </button>
          {versions.length === 0 && <div className="diagram-empty">还没有版本。点上面的按钮存第一份。</div>}
          {versions.map((v) => {
            const st = diffStats(diffLines(v.text, currentText));
            return (
              <div key={v.id} className="version-row">
                <div className="version-main">
                  <div className="version-name">{v.name}</div>
                  <div className="version-meta">
                    {fmtTime(v.ts)} · {v.text.length} 字符 · 相对当前 +{st.add} / -{st.del} 行
                  </div>
                </div>
                <button className="mini-btn" onClick={() => onCompare(v)}>
                  <GitCompare size={11} />
                  对比
                </button>
                <button className="mini-btn" onClick={() => onRunVersion(v)} title="编译运行这个版本里的第一段 C++ 代码">
                  <Play size={11} />
                  运行
                </button>
                <button className="mini-btn" onClick={() => onRestore(v)}>
                  <RotateCcw size={11} />
                  恢复
                </button>
                <button className="mini-btn" onClick={() => onDelete(v.id)} title="删除这个版本">
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
