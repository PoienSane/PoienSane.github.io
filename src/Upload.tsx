import { useRef } from "react";
import { Upload } from "lucide-react";

interface Props {
  /** input accept，默认收代码与数据文件 */
  accept?: string;
  label?: string;
  onText(text: string, name: string): void;
}

/** 「上传文件」小按钮：选一个本地文本文件，把内容交给调用方填进对应的框 */
export default function UploadBtn({ accept = ".cpp,.cc,.cxx,.h,.hpp,.py,.txt,.in,.out,.md", label = "上传", onText }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="bar-btn tiny" title="从本地文件读取内容填进来" onClick={() => ref.current?.click()}>
        <Upload size={12} />
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onText(await f.text(), f.name);
        }}
      />
    </>
  );
}
