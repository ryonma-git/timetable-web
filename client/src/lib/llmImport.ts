// llmImport.ts
// LLM連携機能: 画像からの時間割・時程表読み取り支援
// JSONテンプレート生成・LLM向けプロンプト生成・ファイルダウンロード

import { SemesterMeta } from "./timetableFile";

// ─── 時間割JSONテンプレート ──────────────────────────────────────

export interface TimetableImportTemplate {
  _description: string;
  _instructions: string;
  weekdays: {
    Mon: Record<number, string | null>;
    Tue: Record<number, string | null>;
    Wed: Record<number, string | null>;
    Thu: Record<number, string | null>;
    Fri: Record<number, string | null>;
    Sat?: Record<number, string | null>;
    Sun?: Record<number, string | null>;
  };
}

export function generateTimetableTemplate(semester: SemesterMeta): TimetableImportTemplate {
  const periods = [1, 2, 3, 4, 5, 6];
  const makeDay = (): Record<number, string | null> => {
    const d: Record<number, string | null> = {};
    periods.forEach(p => { d[p] = null; });
    return d;
  };

  const template: TimetableImportTemplate = {
    _description: "時間割インポート用JSONテンプレート（Timetable Manager）",
    _instructions: [
      "各コマに授業クラス名（例: '1年1組'）または教科名（例: '国語'）を入力してください。",
      "授業なしのコマはnullのままにしてください。",
      "このファイルをLLMに渡して画像から自動入力することもできます。",
      `利用可能なクラス: ${semester.classList?.join(", ") ?? "（クラスリストなし）"}`,
    ].join(" / "),
    weekdays: {
      Mon: makeDay(),
      Tue: makeDay(),
      Wed: makeDay(),
      Thu: makeDay(),
      Fri: makeDay(),
    },
  };

  if (semester.hasSaturday) template.weekdays.Sat = makeDay();
  if (semester.hasSunday) template.weekdays.Sun = makeDay();

  return template;
}

// ─── 時程表JSONテンプレート ──────────────────────────────────────

export interface PeriodTimesImportTemplate {
  _description: string;
  _instructions: string;
  mode: "shared" | "by_day";
  shared: Record<number, { start: string; end: string }>;
  by_day?: {
    Mon?: Record<number, { start: string; end: string }>;
    Tue?: Record<number, { start: string; end: string }>;
    Wed?: Record<number, { start: string; end: string }>;
    Thu?: Record<number, { start: string; end: string }>;
    Fri?: Record<number, { start: string; end: string }>;
    Sat?: Record<number, { start: string; end: string }>;
    Sun?: Record<number, { start: string; end: string }>;
  };
}

export function generatePeriodTimesTemplate(semester: SemesterMeta): PeriodTimesImportTemplate {
  const periods = [1, 2, 3, 4, 5, 6];
  const makeShared = (): Record<number, { start: string; end: string }> => {
    const d: Record<number, { start: string; end: string }> = {};
    periods.forEach(p => { d[p] = { start: "HH:MM", end: "HH:MM" }; });
    return d;
  };

  return {
    _description: "時程表インポート用JSONテンプレート（Timetable Manager）",
    _instructions: [
      "shared: 全曜日共通の時程を入力してください（HH:MM形式、例: '08:50'）。",
      "曜日ごとに時程が異なる場合は mode を 'by_day' に変更し、by_day に各曜日の時程を入力してください。",
      "by_day に入力した曜日はその時程が優先されます。入力しない曜日は shared の時程が使われます。",
    ].join(" / "),
    mode: "shared",
    shared: makeShared(),
    by_day: {
      Mon: makeShared(),
      Tue: makeShared(),
      Wed: makeShared(),
      Thu: makeShared(),
      Fri: makeShared(),
    },
  };
}

// ─── LLM向けプロンプト生成 ──────────────────────────────────────

export function generateTimetablePrompt(semester: SemesterMeta): string {
  const classList = semester.classList?.join("、") ?? "（クラスリストなし）";
  return `あなたは学校の時間割を読み取るアシスタントです。
添付された時間割の画像を見て、以下のJSONテンプレートに情報を入力してください。

【入力ルール】
- 各コマ（period）に対応するクラス名を入力してください。
- 利用可能なクラス: ${classList}
- 授業がないコマはnullのままにしてください。
- 曜日キーは Mon（月）、Tue（火）、Wed（水）、Thu（木）、Fri（金）です。
- periodは1〜6の数字です（1限〜6限）。
- JSONの_descriptionと_instructionsフィールドはそのままにしてください。
- 読み取れない場合はnullにしてください。

【出力形式】
入力済みのJSONのみを出力してください。説明文は不要です。`;
}

// 学級担任モード専用: 授業コマ設定＋教科設定を同時に行うプロンプト
export function generateHomeroomTimetablePrompt(semester: SemesterMeta): string {
  const subjectExamples = '国語、算数、理科、社会、音楽、図工、体育、生活、道徳、特活、英語、数学、理科、社会、外国語';
  const homeroomClass = semester.homeroomClass ? `担任クラス: ${semester.homeroomClass}` : '（担任クラス未設定）';
  return `あなたは学校の時間割を読み取るアシスタントです。
添付された時間割の画像を見て、以下のJSONテンプレートに情報を入力してください。

これは「学級担任モード」の時間割です。${homeroomClass}

【入力ルール】
- 各コマ（period）に授業の「教科名」を入力してください。
  例: ${subjectExamples}
- 授業がないコマ（空っぽ、欠課、休みなど）はnullのままにしてください。
- 曜日キーは Mon（月）、Tue（火）、Wed（水）、Thu（木）、Fri（金）です。
- periodは1～6の数字です（1限～6限）。
- JSONの_descriptionと_instructionsフィールドはそのままにしてください。
- 読み取れない場合はnullにしてください。

【出力形式】
入力済みのJSONのみを出力してください。説明文は不要です。`;
}

export function generatePeriodTimesPrompt(): string {
  return `あなたは学校の時程表を読み取るアシスタントです。
添付された時程表の画像を見て、以下のJSONテンプレートに情報を入力してください。

【入力ルール】
- 各コマ（period）の開始時刻（start）と終了時刻（end）をHH:MM形式で入力してください。
  例: "08:50"、"09:35"
- 全曜日で時程が同じ場合は mode を "shared" のままにして、shared フィールドのみ入力してください。
- 曜日ごとに時程が異なる場合は mode を "by_day" に変更し、by_day の各曜日に入力してください。
- 読み取れない場合は "HH:MM" のままにしてください。

【出力形式】
入力済みのJSONのみを出力してください。説明文は不要です。`;
}

// ─── 年間予定表JSONテンプレート（v91: events + ops 2層構造） ─────────────────────

export interface ScheduleEventEntry {
  date: string;             // YYYY-MM-DD
  title: string;            // イベント名（例: "運動会", "職員会議"）
  category?: "ceremony" | "event" | "work" | "student" | "holiday" | "other";
  notes?: string;
  timeStart?: string;       // HH:MM（任意）
  timeEnd?: string;
  affectsClasses?: boolean; // 授業に影響するか（メタ情報、ops生成のヒント）
}

export interface ScheduleImportTemplate {
  _description: string;
  _instructions: string;
  _available_classes: string[];
  _override_op_types: string;
  user_rules: string;
  /** v91: その日に予定されているすべてのイベント（コマ影響の有無に関わらず） */
  events: ScheduleEventEntry[];
  /** 既存: ユーザールールに基づくコマ削除等の操作 */
  ops: Array<{
    op: string;
    date: string;
    period?: number | "all";
    class?: string | null;
    target_class?: string | null;
    reason?: string;
    clear_all_classes?: boolean;
  }>;
}

export function generateScheduleTemplate(semester: SemesterMeta): ScheduleImportTemplate {
  return {
    _description: "年間予定表インポート用JSONテンプレート（Timetable Manager v91）",
    _instructions: [
      "【Step 1】events配列 → 年間予定表に書かれているすべての予定（始業式・運動会・職員会議・避難訓練など）を、授業への影響の有無に関わらずすべて列挙してください。",
      "【Step 2】ops配列 → user_rules に基づき、授業を実際にカット・変更すべきものだけをOverrideOp形式で記述してください。",
      "events.category: ceremony(式典: 始業式・卒業式) / event(行事: 運動会・遠足・参観日) / work(業務: 職員会議・研修) / student(学級: 懇談・避難訓練・健康診断) / holiday(休日) / other",
      "ops.op: 'clear_period_class' → コマを休講にする / 'set_day_reason' → 日全体に理由 / 'set_period_reason' → 特定コマに理由",
      "【重要】1日まるごと（全コマ）休講にする場合は、periodフィールドを付けず省略し、clear_all_classes: true だけを設定してください（period: 1 のように指定すると『1限だけ』休講になってしまいます）。特定のコマだけ休講にする場合はperiodに1〜6を指定してください。",
      "date: YYYY-MM-DD形式 / target_class: nullの場合は全クラス対象",
    ].join(" / "),
    _available_classes: semester.classList ?? [],
    _override_op_types: "clear_period_class | set_day_reason | set_period_reason",
    user_rules: "（任意：行事ごとのコマ削除ルールを記入。例：運動会は全コマ休講、遠足は午前のみ休講、職員会議はコマに影響なし、など）",
    events: [
      { date: "YYYY-MM-DD", title: "始業式", category: "ceremony", affectsClasses: true },
      { date: "YYYY-MM-DD", title: "職員会議", category: "work", affectsClasses: false },
      { date: "YYYY-MM-DD", title: "運動会", category: "event", affectsClasses: true },
      { date: "YYYY-MM-DD", title: "避難訓練", category: "student", affectsClasses: false },
    ],
    ops: [
      {
        // 例1: 1日まるごと休講（始業式など）→ periodを省略する
        op: "clear_period_class",
        date: "YYYY-MM-DD",
        target_class: null,
        reason: "始業式",
        clear_all_classes: true,
      },
      {
        // 例2: 特定コマだけ休講（校外学習の午前中のみ、など）→ periodを指定する
        op: "clear_period_class",
        date: "YYYY-MM-DD",
        period: 1,
        target_class: null,
        reason: "校外学習",
        clear_all_classes: true,
      },
      {
        op: "set_day_reason",
        date: "YYYY-MM-DD",
        reason: "運動会",
      },
    ],
  };
}

export function generateSchedulePrompt(semester: SemesterMeta, userRules: string): string {
  const classList = semester.classList?.join("、") ?? "（クラスリストなし）";
  const startDate = semester.startDate ?? "（開始日未設定）";
  const endDate = semester.endDate ?? "（終了日未設定）";
  const rulesSection = userRules.trim()
    ? `\n【コマ削除ルール（ユーザー指定）】\n${userRules.trim()}\n`
    : "\n（コマ削除ルールが指定されていません。授業に影響しそうな行事はaffectsClasses:trueにしますが、ops生成は控えめにしてください。）\n";
  return `あなたは学校の年間予定表を読み取り、JSON化するアシスタントです。
添付された年間予定表の画像を見て、テンプレートの2つの配列を以下の手順で埋めてください。

【学期情報】
- 学期期間: ${startDate} 〜 ${endDate}
- 利用可能なクラス: ${classList}
${rulesSection}
【Step 1: events配列を埋める】
年間予定表に記載されている**すべての予定**を列挙してください。
- 授業への影響の有無は関係ありません。職員会議・PTA・避難訓練・式典など、書かれているものは全て拾います。
- 各イベント: { date, title, category, affectsClasses }
  - date: YYYY-MM-DD（複数日にまたがる行事は各日に1件ずつ）
  - title: 行事名そのまま（例: "運動会", "始業式", "個人懇談"）
  - category: **必ず以下の6つから選んでください**。当てはまらない or 迷う場合は "other" にしてください（独自カテゴリ名は作らない）。
    - ceremony : 式典（始業式・終業式・入学式・卒業式 など）
    - event    : 行事（運動会・遠足・参観日・全校集会・文化祭 など）
    - work     : 業務（職員会議・研修・PTA・教員業務 など）
    - student  : 学級（個人懇談・家庭訪問・避難訓練・健康診断 など、児童に関する活動）
    - holiday  : 休日（休校日・祝日・振替休日）
    - other    : 上記いずれにも明確に該当しない場合
  - affectsClasses: その行事が通常授業を中断しそうなら true、そうでなければ false
- カレンダー左欄の「祝日」「振替休日」もevents配列に含めてください（category: "holiday"）。

【Step 2: ops配列を埋める】
**コマ削除ルール**に該当する行事のみ、OverrideOp形式で記述してください。
- ルール未指定または影響なしの行事はopsに含めません。
- 【重要】1日まるごと（全コマ）休講にする場合: periodフィールドを付けず省略し、clear_all_classes: true だけを設定する。
  ※ period: 1 のように書いてしまうと「1限だけ」休講になり、2〜6限が授業のまま残ってしまいます。絶対にperiodを付けないでください。
- 特定コマだけ休講にする場合: period指定 (1〜6) + clear_all_classes: true
- 特定クラスのみ: target_class指定
- 日全体に理由を残したい: op: 'set_day_reason'

【出力形式】
テンプレートの構造を保ったまま、入力済みのJSONのみを出力してください。説明文・コメント・余計な装飾は不要です。`;
}

// ─── ファイルダウンロード ────────────────────────────────────────

export function downloadJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
