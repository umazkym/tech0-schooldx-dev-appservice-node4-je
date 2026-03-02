"use client"
import React, { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { apiBaseUrl } from '@/lib/apiConfig'

/**
 * 演習問題登録 - テーマ詳細ページ
 * 
 * 指定されたテーマに登録されている演習問題の一覧を表示。
 * 問題の追加（最大8問）・編集・削除が可能。
 */

type QuestionData = {
    lesson_question_id: number
    lesson_question_label: string | null
    question_text1: string | null
    question_text2: string | null
    question_text3: string | null
    question_text4: string | null
    correctness_number: number | null
    question_image_url: string | null
}

type QuestionCountResponse = {
    lesson_theme_id: number
    question_count: number
    question_ids: number[]
}

type LessonThemeFromContent = {
    lesson_theme_id: number
    lesson_theme_name: string
}

type UnitItemFromContent = {
    units_id: number
    material_id: number
    part_name: string
    chapter_name: string
    unit_name: string
    lesson_themes: LessonThemeFromContent[]
}

export default function ExerciseThemeDetailPage() {
    const params = useParams()
    const router = useRouter()
    const themeId = Number(params?.themeId)

    const [themeName, setThemeName] = useState("")
    const [themeInfo, setThemeInfo] = useState<{
        part_name: string
        chapter_name: string
        unit_name: string
    } | null>(null)
    const [questions, setQuestions] = useState<QuestionData[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [deleting, setDeleting] = useState(false)

    const optionLabels = ["①", "②", "③", "④"]

    // ============================================================
    // データ取得
    // ============================================================
    const fetchData = useCallback(async () => {
        if (!apiBaseUrl || !themeId) return
        setLoading(true)
        setError("")
        try {
            // テーマ情報を取得（コンテンツAPIから逆引き）
            const contentRes = await fetch(`${apiBaseUrl}/content/by_id/1`, {
                method: "GET",
                mode: "cors",
                redirect: "follow",
            })
            if (contentRes.ok) {
                const contentData: UnitItemFromContent[] = await contentRes.json()
                for (const unit of contentData) {
                    const theme = unit.lesson_themes.find(t => t.lesson_theme_id === themeId)
                    if (theme) {
                        setThemeName(theme.lesson_theme_name)
                        setThemeInfo({
                            part_name: unit.part_name,
                            chapter_name: unit.chapter_name,
                            unit_name: unit.unit_name,
                        })
                        break
                    }
                }
            }

            // 問題数と問題IDを取得
            const countRes = await fetch(
                `${apiBaseUrl}/api/lesson_themes/${themeId}/questions/count`,
                { method: "GET", mode: "cors", redirect: "follow" }
            )
            if (!countRes.ok) {
                throw new Error(`問題データの取得に失敗しました: ${countRes.status}`)
            }
            const countData: QuestionCountResponse = await countRes.json()

            // 各問題の詳細を取得（既存のエンドポイントで取得可能な場合）
            // 現在のバックエンドには個別問題取得APIがないため、
            // 問題IDリストのみ表示し、詳細はバックエンドAPI追加後に表示する
            // ひとまず問題IDリストから仮の問題データを作成
            const questionList: QuestionData[] = countData.question_ids.map((qid, idx) => ({
                lesson_question_id: qid,
                lesson_question_label: `問題${idx + 1}`,
                question_text1: null,
                question_text2: null,
                question_text3: null,
                question_text4: null,
                correctness_number: null,
                question_image_url: null,
            }))
            setQuestions(questionList)
        } catch (err) {
            console.error(err)
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [themeId])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // ============================================================
    // 問題削除（バックエンドAPI追加後に有効化）
    // ============================================================
    async function handleDeleteQuestion(questionId: number) {
        if (!apiBaseUrl) return
        if (!confirm("この問題を削除しますか？")) return
        try {
            setDeleting(true)
            const res = await fetch(
                `${apiBaseUrl}/api/exercise_questions/${questionId}`,
                { method: "DELETE", mode: "cors", redirect: "follow" }
            )
            if (!res.ok) {
                const msg = await res.text()
                throw new Error(`削除失敗: ${res.status}, ${msg}`)
            }
            await fetchData()
        } catch (err) {
            console.error(err)
            alert(`削除失敗: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
            setDeleting(false)
        }
    }

    // ============================================================
    // JSX
    // ============================================================
    return (
        <div>
            {/* ヘッダー */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <button
                        onClick={() => router.push("/exercise-registration")}
                        className="font-bold hover:underline mr-4"
                    >
                        &lt; 戻る
                    </button>
                </div>
                <div
                    className="border border-blue-100 bg-blue-50 py-2 px-4 rounded text-gray-700 text-center"
                    style={{ minWidth: '500px' }}
                >
                    テーマ「{themeName}」の演習問題を管理
                </div>
            </div>

            {error && (
                <div className="text-red-500 mb-4 whitespace-pre-wrap">{error}</div>
            )}

            {loading ? (
                <p className="text-gray-500">読み込み中です。</p>
            ) : (
                <>
                    {/* テーマ情報カード */}
                    {themeInfo && (
                        <div className="bg-gray-50 border border-gray-200 rounded p-4 mb-4">
                            <div className="grid grid-cols-4 gap-4 text-sm">
                                <div>
                                    <span className="text-gray-500">編</span>
                                    <p className="font-medium">{themeInfo.part_name}</p>
                                </div>
                                <div>
                                    <span className="text-gray-500">章</span>
                                    <p className="font-medium">{themeInfo.chapter_name}</p>
                                </div>
                                <div>
                                    <span className="text-gray-500">単元</span>
                                    <p className="font-medium">{themeInfo.unit_name}</p>
                                </div>
                                <div>
                                    <span className="text-gray-500">テーマ</span>
                                    <p className="font-medium">{themeName}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 問題数プログレス */}
                    <div className="bg-white border border-gray-200 rounded p-4 mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-gray-700 font-medium">登録済み問題数</span>
                            <span className="text-2xl font-bold text-blue-600">
                                {questions.length} / 8
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                                className="bg-blue-500 h-2 rounded-full transition-all"
                                style={{ width: `${(questions.length / 8) * 100}%` }}
                            />
                        </div>
                    </div>

                    {/* 問題追加ボタン */}
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold">演習問題一覧</h3>
                        <Link
                            href={`/exercise-registration/${themeId}/question/add`}
                            className={`px-4 py-2 rounded text-white text-sm ${questions.length >= 8
                                ? "bg-gray-400 pointer-events-none"
                                : "bg-blue-500 hover:bg-blue-600"
                                }`}
                        >
                            ＋ 演習問題を追加
                        </Link>
                    </div>

                    {questions.length >= 8 && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm text-yellow-800">
                            問題は最大8問まで登録できます。新しい問題を追加するには、既存の問題を削除してください。
                        </div>
                    )}

                    {/* 問題一覧 */}
                    {questions.length === 0 ? (
                        <div className="text-center py-16 bg-gray-50 rounded border border-gray-200">
                            <p className="text-gray-500 mb-4">まだ演習問題が登録されていません</p>
                            <Link
                                href={`/exercise-registration/${themeId}/question/add`}
                                className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600"
                            >
                                最初の演習問題を登録
                            </Link>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {questions.map((question, index) => (
                                <div
                                    key={question.lesson_question_id}
                                    className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow"
                                >
                                    {/* カードヘッダー */}
                                    <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                                        <span className="font-bold text-md">演習問題{index + 1}</span>
                                        {question.correctness_number !== null && (
                                            <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-semibold">
                                                正解: {optionLabels[question.correctness_number]}
                                            </span>
                                        )}
                                    </div>

                                    {/* カードボディ */}
                                    <div className="p-3">
                                        {question.question_image_url ? (
                                            <div className="aspect-[4/3] bg-gray-100 rounded overflow-hidden mb-2">
                                                <img
                                                    src={question.question_image_url}
                                                    alt={`問題${index + 1}`}
                                                    className="w-full h-full object-contain"
                                                />
                                            </div>
                                        ) : (
                                            <div className="aspect-[4/3] bg-gray-50 rounded flex items-center justify-center mb-2 border border-dashed border-gray-300">
                                                <span className="text-gray-400 text-sm">
                                                    問題ID: {question.lesson_question_id}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* カードフッター */}
                                    <div className="p-3 border-t border-gray-100 flex gap-2">
                                        <Link
                                            href={`/exercise-registration/${themeId}/question/edit/${question.lesson_question_id}`}
                                            className="flex-1 text-center bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-xs hover:bg-gray-50"
                                        >
                                            編集
                                        </Link>
                                        <button
                                            className="flex-1 text-center bg-white border border-gray-300 text-red-600 px-3 py-1.5 rounded text-xs hover:bg-red-50"
                                            disabled={deleting}
                                            onClick={() => handleDeleteQuestion(question.lesson_question_id)}
                                        >
                                            削除
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
