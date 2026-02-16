// ファイル: src/app/realtime-dashboard/dashboard/page.tsx
// 【修正済み・全文】

"use client";
export const dynamic = "force-dynamic";
import React, { useState, useEffect, useRef, Suspense, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { Socket } from "socket.io-client";
import { getSocket } from "@/lib/socket";
import { apiBaseUrl } from '@/lib/apiConfig';

/**
 * 型定義
 */
interface AnswerDataWithDetails {
  student_id: number;
  lesson_id: number;
  answer_correctness: number | null;
  answer_status: number | null; // 0:未回答, 1:解答中, 2:解答済
  answer_start_unix: number | null;
  answer_start_timestamp: string | null;  // フォールバック用のタイムスタンプ文字列
  answer_end_unix: number | null;
  question: {
    lesson_question_id: number; // <-- キー名を修正
    question_label: string;
  };
}

// 画面表示用の型 - 各問題の解答状況
interface QuestionStatus {
  status: string;          // '', 'pencil', 'correct', 'wrong'
  progress: number;        // 0-100
  startUnix: number | null;
}

// 画面表示用の型 - 生徒情報
interface Student {
  id: number; // student_idと一致させる
  students_number: number; // students_tableの出席番号
  name: string;
  // 最大16問分の解答状況（動的配列）
  questions: QuestionStatus[];
}

// 問題IDからquestionsインデックスへのマッピング
type QuestionIndexMap = { [questionId: number]: number };


interface LessonThemeBlock {
  lesson_theme_id: number;
  lesson_theme_name: string;
  material_name: string;
  part_name: string | null;
  chapter_name: string | null;
  unit_name: string | null;
  lesson_question_status?: number;  // 1=READY, 2=ACTIVE, 3=ENDED
}

interface LessonInformation {
  // ▼▼▼ 【修正】 class_id を追加 ▼▼▼
  class_id: number;
  // ▲▲▲ 【修正】 ▲▲▲
  date: string;
  day_of_week: string;
  period: number;
  lesson_name: string | null;
  lesson_theme: LessonThemeBlock[];  // APIはListを返す
}

// /grades/raw_data のレスポンスアイテムの型定義
// (initializeStudents では使わなくなったが、他で使われる可能性を考慮し残置)
interface RawDataItemFromGrades {
  student: {
    student_id: number;
    students_number: number;
    name: string;
  };
}


/**
 * ダッシュボード主要コンポーネント
 */
function DashboardPageContent() {
  const router = useRouter();

  const socketRef = useRef<Socket | null>(null);


  const searchParams = useSearchParams();
  const lessonIdStr = searchParams.get("lesson_id");
  const lessonId = lessonIdStr ? parseInt(lessonIdStr, 10) : null;
  const [lessonInfo, setLessonInfo] = useState<LessonInformation | null>(null);
  const [lessonMeta] = useState<{
    date: string;
    day_of_week: string;
    period: number;
    lesson_name: string | null;
  } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const s = sessionStorage.getItem("selectedLessonMeta");
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  });
  const [selectedContent, setSelectedContent] = useState<LessonThemeBlock | null>(null);

  useEffect(() => {
    try {
      const s = sessionStorage.getItem("selectedContentInfo");
      if (s) setSelectedContent(JSON.parse(s));
    } catch { }
  }, []);
  useEffect(() => {
    if (!lessonId || !apiBaseUrl) return;
    (async () => {
      try {
        const res = await fetch(
          `${apiBaseUrl}/lesson_attendance/lesson_information?lesson_id=${lessonId}`
        );
        if (!res.ok) {
          console.error(`lesson_information API failed: ${res.status}`);
          return;
        }
        const d = (await res.json()) as LessonInformation;
        setLessonInfo(d);

        // ★追加: lesson_question_statusから演習状態を復元
        // 選択中のテーマまたは最初のテーマのステータスを確認
        const currentTheme = d.lesson_theme?.[0];
        if (currentTheme?.lesson_question_status === 2) {
          // ACTIVE状態なら演習アクティブ（ポーリング開始）
          console.log('演習がACTIVE状態のため、ポーリングを開始します');
          setIsExerciseActive(true);
        }

        // ★追加: テーマの問題数を取得
        if (currentTheme?.lesson_theme_id) {
          try {
            const qRes = await fetch(
              `${apiBaseUrl}/api/lesson_themes/${currentTheme.lesson_theme_id}/questions/count`
            );
            if (qRes.ok) {
              const qData = await qRes.json() as {
                lesson_theme_id: number;
                question_count: number;
                question_ids: number[];
              };
              console.log(`問題数取得: ${qData.question_count}問`, qData.question_ids);

              // totalQuestionsを設定
              setTotalQuestions(qData.question_count);

              // questionIndexMapを生成（問題IDから配列インデックスへのマッピング）
              const newMap: QuestionIndexMap = {};
              qData.question_ids.forEach((qId, index) => {
                newMap[qId] = index;
              });
              setQuestionIndexMap(newMap);
            } else {
              console.error(`問題数取得APIエラー: ${qRes.status}`);
            }
          } catch (qErr) {
            console.error('問題数取得エラー:', qErr);
          }
        }
      } catch (err) {
        console.error('lesson_information fetch error:', err);
      }
    })();

  }, [lessonId]);

  // 修正2: 生徒データを保持する State と、動的マップ用の State/Ref を定義
  const [students, setStudents] = useState<Student[]>([]);
  const studentsRef = useRef(students);
  // 問題IDから配列インデックスへのマッピング（最大16問対応）
  const [questionIndexMap, setQuestionIndexMap] = useState<QuestionIndexMap | null>(null);
  const questionIndexMapRef = useRef(questionIndexMap);
  // 問題の総数を保持
  const [totalQuestions, setTotalQuestions] = useState<number>(0);

  // サーバー時刻とクライアント時刻のオフセットを保存（ミリ秒単位）
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const timeOffsetRef = useRef(timeOffset);

  // サーバー時刻を取得する関数（クライアント時刻のズレを考慮）
  const getServerUnixTime = useCallback(() => {
    return Math.floor((Date.now() + timeOffsetRef.current) / 1000);
  }, []);

  // 修正3: State が変更されたら Ref にも同期
  useEffect(() => {
    studentsRef.current = students;
  }, [students]);
  useEffect(() => {
    questionIndexMapRef.current = questionIndexMap;
  }, [questionIndexMap]);
  useEffect(() => {
    timeOffsetRef.current = timeOffset;
  }, [timeOffset]);

  // ▼▼▼▼▼ 【修正】 生徒リストの初期化処理 (lessonInfo取得後に実行) ▼▼▼▼▼
  useEffect(() => {
    // lessonId と lessonInfo (特に lessonInfo.class_id) がないと実行できない
    if (!lessonId || !apiBaseUrl || !lessonInfo) return;

    // 生徒リストを取得する非同期関数
    const initializeStudents = async () => {
      try {
        // ★修正★ /classes/{class_id}/students APIを叩く
        const res = await fetch(
          `${apiBaseUrl}/classes/${lessonInfo.class_id}/students`
        );
        if (!res.ok) {
          // クラスに生徒がいない場合、APIは空リスト[]を返す（classes.py L.43 参照）
          // もし404や他のエラーが返った場合
          if (res.status === 404) {
            console.warn(`生徒データが見つかりません (class_id: ${lessonInfo.class_id})`);
            setStudents([]); // 空のリストをセット
            return;
          }
          throw new Error(`Failed to fetch student list (Status: ${res.status})`);
        }

        // ★修正★ /classes/{class_id}/students のレスポンス型 (StudentInfo[])
        // schemas.py L.226 StudentInfo (student_id, name, class_id, students_number)
        const data: {
          student_id: number;
          name: string;
          class_id: number;
          students_number: number;
        }[] = await res.json();

        // 取得した生徒データで students state を初期化
        // questions配列は空で初期化し、後でAPIレスポンスから動的に設定される
        const initialStudents: Student[] = data.map(item => ({
          id: item.student_id,
          students_number: item.students_number,
          name: item.name,
          questions: [], // 空配列で初期化、後でAPIレスポンスから問題数を取得して拡張
        }));

        // APIは既に出席番号順でソートされているはず (classes.py L.38)
        setStudents(initialStudents); // 生徒リストをセット

      } catch (err) {
        console.error('Failed to fetch student data:', err);
        setStudents([]); // エラー時も空リストをセット
      }
    };

    initializeStudents();
  }, [lessonId, lessonInfo, apiBaseUrl]); // ★ lessonInfo と apiBaseUrl を依存配列に追加
  // ▲▲▲▲▲ 【修正】 ここまで ▲▲▲▲▲


  const srcDate = lessonInfo ?? lessonMeta;
  const dateInfoQuery = srcDate
    ? `${srcDate.date} (${srcDate.day_of_week}) / ${srcDate.period}限目 ${srcDate.lesson_name ?? ""}`
    : "ロード中...";
  const firstTheme = lessonInfo?.lesson_theme?.[0];
  const src = selectedContent ?? firstTheme;
  const contentInfoQuery = src
    ? `${src.material_name}/${src.part_name ?? ""}/${src.chapter_name ?? ""}/${src.unit_name ?? ""}/${src.lesson_theme_name}`.trim()
    : "";
  const timerQuery = searchParams.get("timer") || "5";

  const defaultMinutes = parseInt(timerQuery, 10) || 5;
  const [secondsLeft, setSecondsLeft] = useState(defaultMinutes * 60);
  const [isRunning, setIsRunning] = useState(false);  // タイマーが動いているか
  const [isExerciseActive, setIsExerciseActive] = useState(false);  // 演習がアクティブか（ポーリング用）

  const [isLessonStarted] = useState(true);

  // メッセージ表示ロジック
  let message = "演習開始のボタンを押してください";
  if (isExerciseActive && !isRunning && secondsLeft <= 0) {
    message = "タイマー終了：演習終了ボタンを押してください";
  } else if (isRunning) {
    message = "時間になったら演習終了を押してください";
  } else if (!isRunning && secondsLeft > 0 && secondsLeft < defaultMinutes * 60) {
    message = "一時停止中...";
  }

  useEffect(() => {
    if (!isRunning) return;
    if (secondsLeft <= 0) {
      setIsRunning(false);
      return;
    }
    const t = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [isRunning, secondsLeft]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const timeStr = `${mm}:${ss}`;

  const handleChangeTimer = () => {
    const newValStr = prompt("タイマーを何分にしますか？", timerQuery);
    if (newValStr) {
      const newVal = parseInt(newValStr, 10);
      if (!isNaN(newVal) && newVal > 0) {
        setSecondsLeft(newVal * 60);
      }
    }
  };

  const startTimer = async () => {
    if (!isLessonStarted) {
      alert("授業が開始されていません。前の画面に戻って授業を開始してください。");
      return;
    }

    const themeId = selectedContent?.lesson_theme_id ?? firstTheme?.lesson_theme_id;

    if (!themeId) {
      alert("演習のテーマIDが見つかりません。");
      return;
    }

    if (!apiBaseUrl) {
      alert("APIのベースURLが設定されていません。");
      return;
    }

    try {
      const res = await fetch(`${apiBaseUrl}/api/lesson_themes/${lessonId}/${themeId}/start_exercise`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errorData.message || `HTTP error ${res.status}`);
      }

      const data = await res.json();
      console.log('API Response:', data.message);

      setIsRunning(true);
      setIsExerciseActive(true);  // ★追加: 演習アクティブ
      const msg = `exercise_start,${themeId}`;
      socketRef.current?.emit("to_flutter", msg);
      console.log("🌐 Web send to server →", msg);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert(`演習開始に失敗しました: ${errorMessage}`);
      console.error(err);
    }
  };

  const stopTimer = async () => {
    const themeId = selectedContent?.lesson_theme_id ??
      firstTheme?.lesson_theme_id;

    if (!themeId) {
      alert("演習のテーマIDが見つかりません。");
      setIsRunning(false);
      return;
    }

    if (!apiBaseUrl) {
      alert("APIのベースURLが設定されていません。");
      setIsRunning(false);
      return;
    }

    try {
      // 要件⑤: バックエンドAPIを呼び出す
      const res = await fetch(`${apiBaseUrl}/api/lesson_themes/${lessonId}/${themeId}/end_exercise`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errorData.message || `HTTP error ${res.status}`);
      }

      const data = await res.json();
      console.log('API Response:', data.message);

      // API成功後にタイマーを停止し、新しい形式でWebSocketメッセージを送信
      setIsRunning(false);
      setIsExerciseActive(false);  // ★追加: 演習終了
      const message = `exercise_end,${themeId}`; // 新しいメッセージ形式
      socketRef.current?.emit("to_flutter", message);
      console.log("🌐 Web send to server →", message);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert(`演習終了に失敗しました: ${errorMessage}`);
      console.error(err);
      // API失敗時もUIのタイマーは停止する
      setIsRunning(false);
    }
  };

  // ヘルパー関数: answer_start_unixまたはanswer_start_timestampからUnixタイムスタンプを取得
  const getStartUnix = useCallback((d?: AnswerDataWithDetails): number | null => {
    if (!d) return null;

    // answer_start_unixが設定されていればそれを使用
    if (d.answer_start_unix != null && d.answer_start_unix > 0) {
      const clientNowUnix = Math.floor(Date.now() / 1000);

      // 初回APIレスポンス時にサーバー時刻のオフセットを計算
      if (timeOffsetRef.current === 0) {
        // タイムスタンプが現在時刻と大きくずれている場合、オフセットを設定
        // answer_start_unixは最近の時刻のはずなので、1時間以上のズレがあれば異常
        const rawDiff = clientNowUnix - d.answer_start_unix;

        // マイナス（未来）の場合、またはプラスで大きすぎる場合
        if (rawDiff < -3600 || (rawDiff < 0 && Math.abs(rawDiff) > 60)) {
          const estimatedOffset = (d.answer_start_unix - clientNowUnix) * 1000; // ミリ秒に変換
          console.log(`🕐 Detected time offset: ${(estimatedOffset / 1000 / 60).toFixed(1)} minutes (${(estimatedOffset / 1000).toFixed(0)}s). Adjusting client time.`);
          setTimeOffset(estimatedOffset);
          timeOffsetRef.current = estimatedOffset;
        }
      }

      const serverNowUnix = getServerUnixTime();
      const diff = serverNowUnix - d.answer_start_unix;

      // console.log(`📅 Using answer_start_unix: ${d.answer_start_unix}, client: ${clientNowUnix}, server: ${serverNowUnix}, diff: ${diff}s (${(diff/60).toFixed(1)}min), offset: ${timeOffsetRef.current/1000}s`);

      // 未来のタイムスタンプや異常な値の警告（サーバー時刻基準）
      if (diff < -60) {
        console.warn(`⚠️ WARNING: Timestamp is in the future by ${Math.abs(diff)}s!`);
      } else if (diff > 86400) {
        console.warn(`⚠️ WARNING: Timestamp is more than 24 hours old!`);
      }

      return d.answer_start_unix;
    }

    // answer_start_timestampが設定されていればそれを変換して使用
    if (d.answer_start_timestamp) {
      try {
        // Flutter側から "2025-11-01 23:44:23.820" のような形式で来る場合に対応
        // ISO 8601形式に変換 (スペースをTに置換、Zを追加してUTCとして扱う)
        let isoString = d.answer_start_timestamp.trim();

        // スペース区切りの場合、ISO形式に変換
        if (isoString.includes(' ')) {
          isoString = isoString.replace(' ', 'T');
        }

        // タイムゾーン情報がない場合、ローカルタイムとして扱う
        const date = new Date(isoString);

        // 日付が無効でないかチェック
        if (isNaN(date.getTime())) {
          console.error('Invalid timestamp format:', d.answer_start_timestamp);
          return null;
        }

        const unixTimestamp = Math.floor(date.getTime() / 1000);
        // const nowUnix = Math.floor(Date.now() / 1000);
        // const diff = nowUnix - unixTimestamp;
        // console.log(`Converted timestamp: ${d.answer_start_timestamp} -> ${unixTimestamp}, diff: ${diff}s`);

        return unixTimestamp;
      } catch (error) {
        console.error('Error parsing timestamp:', d.answer_start_timestamp, error);
        return null;
      }
    }

    return null;
  }, [getServerUnixTime]);

  // calcIcon: 解答のステータスに応じたアイコンを返す
  // answer_start_unixまたはanswer_start_timestampが設定されているかチェック
  const calcIcon = useCallback((d?: AnswerDataWithDetails) => {
    if (!d || d.answer_status === 0) return "";
    // 開始タイムスタンプが設定されていない場合は、まだ解答開始していない
    const startUnix = getStartUnix(d);
    if (startUnix == null || startUnix === 0) return "";
    if (d.answer_status === 1) return "pencil";
    if (d.answer_status === 2) {
      if (d.answer_correctness === 0) return "wrong";
      if (d.answer_correctness === 1) return "correct";
    }
    return "";
  }, [getStartUnix]);

  const calcProgress = useCallback((d?: AnswerDataWithDetails) => {
    const startUnix = getStartUnix(d);
    if (!d || startUnix == null || startUnix === 0) return 0;

    if (d.answer_end_unix != null && d.answer_end_unix > 0) {
      const diff = d.answer_end_unix - startUnix;
      return Math.min(100, (diff / (defaultMinutes * 60)) * 100);
    }

    if (d.answer_status === 1) {
      const nowUnix = getServerUnixTime(); // サーバー時刻を使用
      const diff = nowUnix - startUnix;

      return Math.min(100, (diff / (defaultMinutes * 60)) * 100);
    }

    return 0;
  }, [defaultMinutes, getStartUnix, getServerUnixTime]);

  // ▼▼▼▼▼ 【修正】 fetchAllStudentsData を修正 (最大16問の動的配列対応) ▼▼▼▼▼
  const fetchAllStudentsData = useCallback(async () => {
    if (!lessonId || !apiBaseUrl) return;
    const currentStudents = studentsRef.current;
    if (currentStudents.length === 0) {
      return; // 生徒データがまだない場合は何もしない
    }

    // (A) 全生徒の回答データを1回のAPI呼び出しで取得
    let allAnswersData: AnswerDataWithDetails[] = [];
    try {
      const url = `${apiBaseUrl}/api/answers/?lesson_id=${lessonId}`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          console.log("回答データがまだありません (404)");
          allAnswersData = [];
        } else {
          console.error(`Error fetching all answers data: ${res.status}`);
          return;
        }
      } else {
        allAnswersData = await res.json();
      }

      if (allAnswersData.length > 0) {
        console.log('🔍 Raw API response (ALL STUDENTS):', allAnswersData.length, 'records');
      }

    } catch (error) {
      console.error(`Error fetching all answers data:`, error);
      return;
    }

    // (B) 問題IDからインデックスへのマッピングを決定
    let currentMap = questionIndexMapRef.current;
    if (!currentMap) {
      // マップがまだない場合、取得したデータから動的に生成する
      const questionIds = new Set<number>();
      allAnswersData.forEach(answer => {
        questionIds.add(answer.question.lesson_question_id);
      });

      // 取得した問題IDをソート（最大16問）
      const sortedQuestionIds = Array.from(questionIds).sort((a, b) => a - b).slice(0, 16);

      const newMap: QuestionIndexMap = {};
      sortedQuestionIds.forEach((qId, index) => {
        newMap[qId] = index;
      });

      console.log("動的マッピングを生成:", newMap, `問題数: ${sortedQuestionIds.length}`);
      setQuestionIndexMap(newMap);
      setTotalQuestions(sortedQuestionIds.length);
      currentMap = newMap;
    }

    // (C) 画面更新 (全生徒データをマッピング)
    setStudents(prevStudents => {
      // 回答データを生徒IDごとにグループ化
      const answersByStudent = new Map<number, AnswerDataWithDetails[]>();
      allAnswersData.forEach(answer => {
        if (!answersByStudent.has(answer.student_id)) {
          answersByStudent.set(answer.student_id, []);
        }
        answersByStudent.get(answer.student_id)!.push(answer);
      });

      // マップ内の問題数を確認（最大インデックス+1）
      const numQuestions = currentMap ? Math.max(...Object.values(currentMap)) + 1 : 0;

      return prevStudents.map(student => {
        const answers = answersByStudent.get(student.id);

        // 問題数分のquestions配列を初期化（既存データがあれば保持）
        const existingQuestions = [...student.questions];
        // 配列サイズが足りない場合は拡張
        const emptySlots = Array.from(
          { length: Math.max(0, numQuestions - existingQuestions.length) },
          () => ({ status: '', progress: 0, startUnix: null })
        );
        const newQuestions: QuestionStatus[] = [...existingQuestions, ...emptySlots];

        // この生徒の回答データがない場合は初期化済みの配列を返す
        if (!answers || answers.length === 0) {
          return { ...student, questions: newQuestions };
        }

        // 回答データを処理
        answers.forEach(answer => {
          const qIndex = currentMap ? currentMap[answer.question.lesson_question_id] : undefined;

          if (qIndex !== undefined && qIndex < newQuestions.length) {
            const currentStatus = newQuestions[qIndex].status;
            const newProgress = calcProgress(answer);
            const newStatus = calcIcon(answer);
            const startUnixValue = getStartUnix(answer);

            // プログレスバーを常に更新
            newQuestions[qIndex] = { ...newQuestions[qIndex], progress: newProgress };

            // startUnixを保存
            newQuestions[qIndex].startUnix = startUnixValue;

            // 現在のstatusが「correct」または「wrong」の場合は上書きしない
            if (currentStatus !== 'correct' && currentStatus !== 'wrong') {
              newQuestions[qIndex].status = newStatus;
            }
          }
        });

        return { ...student, questions: newQuestions };
      });
    });
  }, [lessonId, calcIcon, calcProgress, getStartUnix, apiBaseUrl]);
  // ▲▲▲▲▲ 【修正】 ここまで ▲▲▲▲▲

  // ▼▼▼▼▼ 【新規】 60秒ポーリング用: DBの値で全問題を強制上書き ▼▼▼▼▼
  const fetchAndOverwriteAllData = useCallback(async () => {
    if (!lessonId || !apiBaseUrl) return;
    const currentStudents = studentsRef.current;
    if (currentStudents.length === 0) return;

    console.log('🔄 60秒ポーリング: 全問題をDBの値で強制上書き開始');

    let allAnswersData: AnswerDataWithDetails[] = [];
    try {
      const url = `${apiBaseUrl}/api/answers/?lesson_id=${lessonId}`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          allAnswersData = [];
        } else {
          console.error(`Error fetching all answers data: ${res.status}`);
          return;
        }
      } else {
        allAnswersData = await res.json();
      }
    } catch (error) {
      console.error(`Error fetching all answers data:`, error);
      return;
    }

    const currentMap = questionIndexMapRef.current;
    if (!currentMap) {
      console.log('60秒ポーリング: マップがまだ生成されていないためスキップ');
      return;
    }

    // DBの値で強制上書き（保護ロジックなし）
    setStudents(prevStudents => {
      const answersByStudent = new Map<number, AnswerDataWithDetails[]>();
      allAnswersData.forEach(answer => {
        if (!answersByStudent.has(answer.student_id)) {
          answersByStudent.set(answer.student_id, []);
        }
        answersByStudent.get(answer.student_id)!.push(answer);
      });

      const numQuestions = Math.max(...Object.values(currentMap)) + 1;

      return prevStudents.map(student => {
        const answers = answersByStudent.get(student.id);

        // 問題数分のquestions配列を初期化
        const existingQuestions = [...student.questions];
        const emptySlots = Array.from(
          { length: Math.max(0, numQuestions - existingQuestions.length) },
          () => ({ status: '', progress: 0, startUnix: null })
        );
        const newQuestions: QuestionStatus[] = [...existingQuestions, ...emptySlots];

        if (!answers || answers.length === 0) {
          return { ...student, questions: newQuestions };
        }

        answers.forEach(answer => {
          const qIndex = currentMap[answer.question.lesson_question_id];
          if (qIndex !== undefined && qIndex < newQuestions.length) {
            // DBの値で強制上書き（保護なし）
            newQuestions[qIndex] = {
              status: calcIcon(answer),
              progress: calcProgress(answer),
              startUnix: getStartUnix(answer)
            };
          }
        });

        return { ...student, questions: newQuestions };
      });
    });

    console.log('🔄 60秒ポーリング: 強制上書き完了');
  }, [lessonId, calcIcon, calcProgress, getStartUnix, apiBaseUrl]);
  // ▲▲▲▲▲ 【新規】 ここまで ▲▲▲▲▲

  // Socket.IOイベントの購読ロジック
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    if (!socket.connected) {
      socket.connect();
    }

    const handleSocketMessage = (data: string) => {
      console.log("🌐 Web recv from Flutter:", data);

      // バックエンドから 'student_answered,lessonId,studentId,answerDataId' 形式で飛んでくる
      const parts = data.split(',');
      const eventType = parts[0];

      // イベントタイプをチェック
      if (eventType === 'student_answered') {
        const receivedLessonId = parseInt(parts[1], 10);

        // 現在開いているダッシュボードの授業IDと一致する場合のみデータを再取得
        if (receivedLessonId === lessonId) {
          console.log(`Matching answer update received for lesson ${lessonId}. Refetching data.`);
          // ポーリングを待たずに即時データ取得を実行
          fetchAllStudentsData();
        } else {
          console.log(`Ignoring answer update for different lesson: ${receivedLessonId}`);
        }
      }

      // 他のイベントタイプ（例：'student_question'など）もここで処理できる
    };

    socket.on("connect", () =>
      console.log("🌐 Web connected (Dashboard)")
    );

    socket.on("from_flutter", handleSocketMessage);

    return () => {
      if (socketRef.current) {
        socketRef.current.off("connect");
        socketRef.current.off("from_flutter", handleSocketMessage);
      }
    };
  }, [fetchAllStudentsData, lessonId]);

  // 修正6: 演習がアクティブな間ポーリングを実行（タイマー切れ後も継続）
  useEffect(() => {
    // isExerciseActive が false の時、または生徒リストが未ロードの時は何もしない
    if (!lessonId || !isExerciseActive || students.length === 0) return;

    // 演習開始時にまず1回実行
    fetchAllStudentsData();

    // 5秒ごとのポーリング（解答中の進捗更新用）
    // correct/wrongは保護されたまま、pencilの問題のみ更新される
    const fastIntervalId = setInterval(fetchAllStudentsData, 5000);

    // 60秒ごとのポーリング（全問題を強制上書き）
    // DBの値を正として、correct/wrongも含め全問題を上書き
    const slowIntervalId = setInterval(fetchAndOverwriteAllData, 60000);

    // クリーンアップ関数
    return () => {
      clearInterval(fastIntervalId);
      clearInterval(slowIntervalId);
    };
  }, [lessonId, isExerciseActive, fetchAllStudentsData, fetchAndOverwriteAllData, students.length]);


  // リアルタイム進捗バー更新: 解答中（status='pencil'）の問題の進捗をリアルタイムに更新
  useEffect(() => {
    if (!isRunning) return;

    const nowMs = Date.now();
    const nowUnix = Math.floor(nowMs / 1000);
    const nowDate = new Date(nowMs);
    console.log('🔄 Real-time progress update timer started');
    console.log('🕐 Browser current time:', {
      unix: nowUnix,
      iso: nowDate.toISOString(),
      local: nowDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });

    const timer = setInterval(() => {
      const currentMap = questionIndexMapRef.current;

      // マップがない場合はスキップ
      if (!currentMap) return;

      setStudents(prevStudents =>
        prevStudents.map(student => {
          const newQuestions = [...student.questions];
          let hasUpdate = false;

          // 各問題に対して進捗を更新
          newQuestions.forEach((q, index) => {
            // 解答中（status='pencil'）かつstartUnixが設定されている場合のみ更新
            if (q.status === 'pencil' && q.startUnix != null && q.startUnix > 0) {
              const nowUnix = getServerUnixTime();
              const diff = nowUnix - q.startUnix;
              const newProgress = Math.min(100, (diff / (defaultMinutes * 60)) * 100);

              // 進捗が変わった場合のみ更新
              if (newProgress !== q.progress) {
                newQuestions[index] = { ...q, progress: newProgress };
                hasUpdate = true;
              }
            }
          });

          // 更新がある場合のみ新しいオブジェクトを返す
          return hasUpdate ? { ...student, questions: newQuestions } : student;
        })
      );
    }, 5000); // 5秒ごとに実行

    return () => clearInterval(timer);
  }, [isRunning, defaultMinutes, getServerUnixTime]);


  function CellWithBar({ icon, progress }: { icon: string; progress: number }) {
    const pct = Math.max(0, Math.min(100, progress));
    return (
      <div className="flex items-center gap-1 px-1">
        <div
          className="h-3 flex-1 rounded-full bg-[#F0F0F0] relative overflow-hidden"
          style={{ minWidth: 30 }}
        >
          <div
            className="absolute left-0 top-0 h-full bg-[#1CADFE]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="flex-none">{renderIcon(icon)}</span>
      </div>
    );
  }

  function renderIcon(st: string) {
    switch (st) {
      // "done" は使われていないようなのでコメントアウト
      // case "done":
      //   return <span className="text-green-600 font-bold">〇</span>;
      case "correct":
        return <span className="text-green-600 font-bold">○</span>;
      case "wrong":
        return <span className="text-red-500 font-bold">×</span>;
      case "pencil":
        return <span className="text-[#555454]">✎</span>;
      // "checked" も使われていないようなのでコメントアウト
      // case "checked":
      //   return <span className="font-bold text-[#555454]">〇</span>;
      default:
        // 空白または初期状態を表す場合は何も表示しないか、'-' などを表示
        return <span className="text-gray-400">-</span>; // 例: 未回答時にハイフン表示
    }
  }


  // 特定の問題インデックスの正答率を計算
  function calcQAPercentage(arr: Student[], questionIndex: number): number {
    let correctCount = 0;
    let wrongCount = 0;
    for (const st of arr) {
      const q = st.questions[questionIndex];
      if (q?.status === "correct") correctCount++;
      if (q?.status === "wrong") wrongCount++;
    }
    const sum = correctCount + wrongCount;
    if (sum === 0) return 0;
    return (correctCount / sum) * 100;
  }

  // 正解・不正解に応じた背景色を返す関数
  function bgColorQA(status: string) {
    if (status === "correct") {
      return "p-2 border border-[#979191] bg-[#C6EFD0]"; // 正解: 緑背景
    }
    if (status === "wrong") {
      return "p-2 border border-[#979191] bg-[#FFD0D0]"; // 不正解: 赤背景
    }
    // デフォルトは白背景
    return "p-2 border border-[#979191] bg-white";
  }

  // 高視認性の解答状況セル（教室後方からも見やすい）
  function AnswerStatusCell({ label, status }: { label: string; status: string }) {
    // 正解: 鮮やかな緑 + チェックマーク
    if (status === "correct") {
      return (
        <div className="flex flex-col items-center justify-center rounded-md bg-emerald-500 text-white h-full min-h-[50px]">
          <span className="text-xs font-medium opacity-80">Q{label}</span>
          <span className="text-2xl font-bold">〇</span>
        </div>
      );
    }
    // 不正解: 鮮やかな赤 + バツマーク
    if (status === "wrong") {
      return (
        <div className="flex flex-col items-center justify-center rounded-md bg-red-500 text-white h-full min-h-[50px]">
          <span className="text-xs font-medium opacity-80">Q{label}</span>
          <span className="text-2xl font-bold">×</span>
        </div>
      );
    }
    // 解答中: 黄色 + 鉛筆アイコン
    if (status === "pencil") {
      return (
        <div className="flex flex-col items-center justify-center rounded-md bg-amber-400 text-white h-full min-h-[50px]">
          <span className="text-xs font-medium opacity-80">Q{label}</span>
          <span className="text-xl">✎</span>
        </div>
      );
    }
    // 未回答: グレー
    return (
      <div className="flex flex-col items-center justify-center rounded-md bg-gray-200 text-gray-500 h-full min-h-[50px]">
        <span className="text-xs font-medium opacity-60">Q{label}</span>
        <span className="text-xl">─</span>
      </div>
    );
  }

  // コンパクトなステータスバッジ（人数が多い時用）
  function StatusBadge({ status }: { status: string }) {
    if (status === "correct") {
      return (
        <div className="flex items-center justify-center rounded bg-[#C6EFD0] text-[#22C55E] h-6 text-sm font-bold">
          〇
        </div>
      );
    }
    if (status === "wrong") {
      return (
        <div className="flex items-center justify-center rounded bg-[#FFD0D0] text-[#EF4444] h-6 text-sm font-bold">
          ×
        </div>
      );
    }
    if (status === "pencil") {
      return (
        <div className="flex items-center justify-center rounded bg-amber-100 text-amber-600 h-6 text-xs">
          ✎</div>
      );
    }
    return (
      <div className="flex items-center justify-center rounded bg-gray-100 text-gray-400 h-6 text-xs">
        ─
      </div>
    );
  }

  // 大きな正誤表示セル（後方からも見やすい） - プレミアムデザイン版
  function LargeStatusCell({ label, status }: { label: string; status: string }) {
    if (status === "correct") {
      return (
        <div className="flex items-center justify-center rounded-lg min-h-[36px]" style={{ background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)', boxShadow: '0 2px 4px rgba(34,197,94,0.3)' }}>
          <span className="text-lg font-black leading-none text-white drop-shadow-sm">〇</span>
        </div>
      );
    }
    if (status === "wrong") {
      return (
        <div className="flex items-center justify-center rounded-lg min-h-[36px]" style={{ background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)', boxShadow: '0 2px 4px rgba(239,68,68,0.3)' }}>
          <span className="text-lg font-black leading-none text-white drop-shadow-sm">×</span>
        </div>
      );
    }
    if (status === "pencil") {
      return (
        <div className="flex items-center justify-center rounded-lg min-h-[36px]" style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)', boxShadow: '0 2px 4px rgba(245,158,11,0.3)' }}>
          <span className="text-base leading-none text-white drop-shadow-sm">✎</span>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center rounded-lg min-h-[36px] bg-gray-100 text-gray-300">
        <span className="text-base leading-none">─</span>
      </div>
    );
  }

  function EmptyQuestionCell() {
    return (
      <div className="flex items-center justify-center rounded-lg min-h-[36px] bg-gray-50 text-gray-200">
        <span className="text-base leading-none">─</span>
      </div>
    );
  }


  function ProgressBarBar({
    color,
    bg,
    percentage,
  }: {
    color: "green"; // 今は緑固定
    bg: "gray" | "red";
    percentage: number;
  }) {
    // パーセンテージを0-100の範囲に収める
    const clamped = Math.max(0, Math.min(100, percentage));
    return (
      <div className="relative h-3 bg-gray-200 rounded-full overflow-hidden mx-2">
        {/* 背景色（不正解部分）*/}
        {bg === "red" && (
          <div className="absolute top-0 left-0 w-full h-full bg-[#E76568]" /> // 赤背景
        )}
        {/* 背景色（未回答など、今は使われていない）*/}
        {bg === "gray" && (
          <div className="absolute top-0 left-0 w-full h-full bg-[#DBDBDB]" /> // グレー背景
        )}
        {/* 正解率バー */}
        {color === "green" && (
          <div
            className="absolute top-0 left-0 h-full bg-[#4CB64B]" // 緑バー
            style={{ width: `${clamped}%` }}
          />
        )}

        {/* 中央にパーセンテージ表示 */}
        <div className="absolute w-full h-full flex items-center justify-center text-xs text-white font-bold">
          {Math.round(clamped)}%
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #F0F4FF 0%, #E8ECF5 100%)' }}>
      {/* 上部: 戻るボタン、タイトル、メッセージ */}
      <div className="flex items-center gap-4 mb-1 justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-[#285AC8] font-bold hover:underline"
          >
            &lt; 戻る
          </button>
          <span className="text-xl font-black text-gray-800">ダッシュボード</span>
        </div>
        <div className="px-6 py-2 rounded-full text-sm font-bold text-[#285AC8]" style={{ background: 'linear-gradient(135deg, #E0EDFF 0%, #D0E0FF 100%)', border: '1px solid #B8D0FF' }}>
          {message}
        </div>
      </div>

      {/* 授業情報とタイマー */}
      <div className="text-gray-600 mb-1 flex justify-between items-center">
        <div>
          <div className="text-lg font-bold text-gray-700">{dateInfoQuery}</div>
          <div className="text-sm text-gray-500">{contentInfoQuery}</div>
        </div>
        {/* タイマー表示 */}
        <div className="flex items-center gap-4">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-black cursor-pointer transition-transform hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #285AC8 0%, #1E40AF 100%)', color: 'white', boxShadow: '0 4px 15px rgba(40,90,200,0.35)' }}
            title="クリックして時間を変更"
            onClick={handleChangeTimer}
          >
            {timeStr}
          </div>
          <div className="flex gap-2">
            <button
              className={`px-6 py-3 rounded-xl text-lg font-bold text-white transition-all ${!isLessonStarted || isRunning
                ? 'bg-gray-300 cursor-not-allowed'
                : 'hover:scale-105'}`}
              style={!isLessonStarted || isRunning ? {} : { background: 'linear-gradient(135deg, #285AC8 0%, #1E40AF 100%)', boxShadow: '0 4px 12px rgba(40,90,200,0.3)' }}
              onClick={startTimer}
              disabled={!isLessonStarted || isRunning}
            >
              演習開始
            </button>
            <button
              className={`px-6 py-3 rounded-xl text-lg font-bold text-white transition-all ${!isRunning
                ? 'bg-gray-300 cursor-not-allowed'
                : 'hover:scale-105'}`}
              style={!isRunning ? {} : { background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)', boxShadow: '0 4px 12px rgba(239,68,68,0.3)' }}
              onClick={stopTimer}
              disabled={!isRunning}
            >
              演習終了
            </button>
          </div>
        </div>
      </div>

      {/* 正答率サマリーバー - プレミアムデザイン */}
      <div className="flex items-center gap-4 mb-1.5 px-4 py-1.5 rounded-xl" style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #F8FAFF 100%)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E2E8F0' }}>
        <span className="text-lg font-black whitespace-nowrap" style={{ color: '#285AC8' }}>正答率</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1 flex-1">
          {Array.from({ length: totalQuestions }).map((_, qIndex) => {
            const pct = Math.round(calcQAPercentage(students, qIndex));
            return (
              <div key={qIndex} className="flex items-center gap-1.5">
                <span className="text-sm font-black text-gray-500 w-6">Q{qIndex + 1}</span>
                <div className="w-20 h-5 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: pct >= 70 ? 'linear-gradient(90deg, #22C55E, #16A34A)' : pct >= 40 ? 'linear-gradient(90deg, #F59E0B, #D97706)' : 'linear-gradient(90deg, #EF4444, #DC2626)' }}
                  />
                </div>
                <span className={`text-sm font-black w-10 text-right ${pct >= 70 ? 'text-green-600' : pct >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
        <span className="text-sm font-bold text-gray-400 whitespace-nowrap">
          回答者: {students.filter(s => s.questions[0]?.status === 'correct' || s.questions[0]?.status === 'wrong' || s.questions[0]?.status === 'pencil').length}/{students.length}
        </span>
      </div>

      {/* 生徒一覧 - 10列プレミアムグリッド */}
      <div
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(10, minmax(0, 1fr))`
        }}
      >
        {students.map((st) => (
          <div
            key={st.id}
            className="rounded-xl overflow-hidden transition-transform hover:scale-[1.02]"
            style={{ background: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '1px solid #E2E8F0' }}
          >
            {/* 出席番号と名前 - グラデーションヘッダー */}
            <div className="flex items-center gap-1 px-1.5 py-0.5" style={{ background: 'linear-gradient(135deg, #285AC8 0%, #3B6FD9 100%)' }}>
              <span className="text-3xl font-black text-white leading-tight" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.2)' }}>{st.students_number}</span>
              <span className="text-base font-bold text-white truncate flex-1 leading-tight" style={{ opacity: 0.95 }}>{st.name}</span>
            </div>
            {/* 問題の正誤表示 - 4問ごとに行を分割 */}
            <div className="p-0.5">
              {Array.from({ length: Math.ceil(totalQuestions / 4) || 1 }).map((_, rowIndex) => (
                <div key={rowIndex} className="grid grid-cols-4 gap-0.5 mb-0.5 last:mb-0">
                  {[0, 1, 2, 3].map(colIndex => {
                    const qIndex = rowIndex * 4 + colIndex;
                    const hasQuestion = qIndex < totalQuestions;

                    if (!hasQuestion) {
                      return <EmptyQuestionCell key={qIndex} />;
                    }

                    const q = st.questions[qIndex];
                    return <LargeStatusCell key={qIndex} label={String(qIndex + 1)} status={q?.status || ''} />;
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * デフォルトエクスポート: Suspense で DashboardPageContent をラップ
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DashboardPageContent />
    </Suspense>
  );
}