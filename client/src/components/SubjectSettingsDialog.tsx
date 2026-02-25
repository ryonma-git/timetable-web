// SubjectSettingsDialog.tsx
// Design: Swiss Grid × Japanese Functional Design
// 教科管理ダイアログ: 教科の追加・編集・削除・色設定
// homeroom/multi_subjectモードで使用

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTimetable } from "@/contexts/TimetableContext";
import { useGradeColors } from "@/contexts/GradeColorContext";
import { COLOR_PALETTE, GradeColorDef, getSubjectColor, DEFAULT_SUBJECT_COLORS } from "@/lib/gradeColors";
import { SubjectDef } from "@/lib/timetableFile";
import { cn } from "@/lib/utils";
import { Plus, Trash2, GripVertical, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── Preset subject names ─────────────────────────────────────

const PRESET_SUBJECTS = [
  "国語", "算数", "数学", "理科", "社会", "英語", "体育",
  "音楽", "図工", "美術", "家庭", "技術", "道徳", "総合",
  "学活", "特活", "生活", "外国語", "情報", "保健",
];

// ─── Main Dialog ──────────────────────────────────────────────

export function SubjectSettingsDialog({ open, onClose }: Props) {
  const { subjects, addSubject, updateSubject, removeSubject } = useTimetable();
  const { subjectColors, updateSubjectColor, removeSubjectColor } = useGradeColors();

  const [newName, setNewName] = useState("");
  const [newShort, setNewShort] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editShort, setEditShort] = useState("");
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);

  const handleAddSubject = () => {
    const name = newName.trim();
    if (!name) return;
    if (subjects.some(s => s.name === name)) {
      toast.error(`「${name}」はすでに登録されています`);
      return;
    }
    addSubject({ name, short: newShort.trim() || undefined });
    setNewName("");
    setNewShort("");
    toast.success(`「${name}」を追加しました`);
  };

  const handleAddPreset = (name: string) => {
    if (subjects.some(s => s.name === name)) {
      toast.error(`「${name}」はすでに登録されています`);
      return;
    }
    addSubject({ name });
    toast.success(`「${name}」を追加しました`);
  };

  const handleStartEdit = (subject: SubjectDef) => {
    setEditingName(subject.name);
    setEditName(subject.name);
    setEditShort(subject.short ?? "");
  };

  const handleSaveEdit = (originalName: string) => {
    const name = editName.trim();
    if (!name) return;
    if (name !== originalName && subjects.some(s => s.name === name)) {
      toast.error(`「${name}」はすでに登録されています`);
      return;
    }
    updateSubject(originalName, { name, short: editShort.trim() || undefined });
    // 色設定も名前変更に追随
    if (name !== originalName && subjectColors[originalName]) {
      updateSubjectColor(name, subjectColors[originalName]);
      removeSubjectColor(originalName);
    }
    setEditingName(null);
    toast.success("教科名を更新しました");
  };

  const handleRemove = (name: string) => {
    removeSubject(name);
    removeSubjectColor(name);
    toast.success(`「${name}」を削除しました`);
  };

  const handleColorSelect = (subjectName: string, color: GradeColorDef) => {
    updateSubjectColor(subjectName, color);
    setShowColorPicker(null);
  };

  const handleResetColor = (subjectName: string) => {
    removeSubjectColor(subjectName);
    setShowColorPicker(null);
  };

  // 未登録のプリセット
  const unregisteredPresets = PRESET_SUBJECTS.filter(
    p => !subjects.some(s => s.name === p)
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-base font-semibold">教科管理</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Registered subjects */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
              登録済み教科 ({subjects.length})
            </Label>
            {subjects.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border rounded">
                教科が登録されていません
              </p>
            ) : (
              <div className="space-y-1.5">
                {subjects.map(subject => {
                  const color = getSubjectColor(subject.name, subjectColors);
                  const isEditing = editingName === subject.name;
                  const isShowingColorPicker = showColorPicker === subject.name;

                  return (
                    <div key={subject.name} className="border border-border rounded overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2">
                        {/* Color swatch */}
                        <button
                          onClick={() => setShowColorPicker(isShowingColorPicker ? null : subject.name)}
                          className="w-5 h-5 rounded border-2 shrink-0 transition-all hover:scale-110"
                          style={{ backgroundColor: color.bg, borderColor: color.border }}
                          title="色を変更"
                        />

                        {isEditing ? (
                          <>
                            <Input
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="h-7 text-sm flex-1"
                              placeholder="教科名"
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveEdit(subject.name);
                                if (e.key === 'Escape') setEditingName(null);
                              }}
                              autoFocus
                            />
                            <Input
                              value={editShort}
                              onChange={e => setEditShort(e.target.value)}
                              className="h-7 text-sm w-16"
                              placeholder="略称"
                            />
                            <button
                              onClick={() => handleSaveEdit(subject.name)}
                              className="p-1 text-green-600 hover:text-green-700"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => setEditingName(null)}
                              className="p-1 text-muted-foreground hover:text-foreground"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span
                              className="text-sm font-medium flex-1 cursor-pointer"
                              style={{ color: color.text }}
                            >
                              {subject.name}
                              {subject.short && (
                                <span className="text-xs text-muted-foreground ml-1.5">
                                  ({subject.short})
                                </span>
                              )}
                            </span>
                            <button
                              onClick={() => handleStartEdit(subject)}
                              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                              title="編集"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => handleRemove(subject.name)}
                              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                              title="削除"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>

                      {/* Color picker */}
                      {isShowingColorPicker && (
                        <div className="px-3 pb-3 border-t border-border bg-muted/30">
                          <p className="text-[10px] text-muted-foreground mt-2 mb-1.5">色を選択</p>
                          <div className="flex flex-wrap gap-1.5">
                            {COLOR_PALETTE.map((c, i) => (
                              <button
                                key={i}
                                onClick={() => handleColorSelect(subject.name, c)}
                                className={cn(
                                  "w-6 h-6 rounded border-2 transition-all hover:scale-110",
                                  color.bg === c.bg && color.border === c.border
                                    ? "ring-2 ring-primary ring-offset-1"
                                    : ""
                                )}
                                style={{ backgroundColor: c.bg, borderColor: c.border }}
                                title={c.label}
                              />
                            ))}
                          </div>
                          {subjectColors[subject.name] && (
                            <button
                              onClick={() => handleResetColor(subject.name)}
                              className="mt-2 text-[10px] text-muted-foreground hover:text-foreground underline"
                            >
                              デフォルト色に戻す
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add new subject */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
              教科を追加
            </Label>
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="教科名（例: 国語）"
                className="h-8 text-sm flex-1"
                onKeyDown={e => e.key === 'Enter' && handleAddSubject()}
              />
              <Input
                value={newShort}
                onChange={e => setNewShort(e.target.value)}
                placeholder="略称"
                className="h-8 text-sm w-20"
              />
              <Button
                size="sm"
                className="h-8 px-3"
                onClick={handleAddSubject}
                disabled={!newName.trim()}
              >
                <Plus size={14} />
              </Button>
            </div>
          </div>

          {/* Preset subjects */}
          {unregisteredPresets.length > 0 && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                よく使う教科
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {unregisteredPresets.map(name => (
                  <button
                    key={name}
                    onClick={() => handleAddPreset(name)}
                    className="px-2.5 py-1 text-xs border border-dashed border-border rounded hover:border-primary hover:text-primary transition-colors"
                  >
                    + {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border shrink-0 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
