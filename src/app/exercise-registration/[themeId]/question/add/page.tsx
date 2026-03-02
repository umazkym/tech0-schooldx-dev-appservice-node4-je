"use client"
import React, { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { apiBaseUrl } from '@/lib/apiConfig'

/**
 * 演習問題登録フォーム（新規追加）
 * 
 * 画像（問題文 + 選択肢①②③④を含む）をアップロードし、
 * 正解番号を選択して登録する。
 */

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

export default function QuestionAddPage() {
    const params = useParams()
    const router = useRouter()
    const themeId = Number(params?.themeId)

    const [themeName, setThemeName] = useState("")
    const [imageFile, setImageFile] = useState<File | null>(null)
    const [imagePreview, setImagePreview] = useState("")
    const [correctAnswer, setCorrectAnswer] = useState<number>(0) // 0-3
    const [error, setError] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [questionNumber, setQuestionNumber] = useState(1)

    const optionLabels = ["①", "②", "③", "④"]

    // テーマ情報と問題数を取得
    const fetchThemeInfo = useCallback(async () => {
        if (!apiBaseUrl || !themeId) return
        try {
            // テーマ名を取得
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
                        break
                    }
                }
            }

            // 問題数を取得して次の問題番号を算出
            const countRes = await fetch(
                `${apiBaseUrl}/api/lesson_themes/${themeId}/questions/count`,
                { method: "GET", mode: "cors", redirect: "follow" }
            )
            if (countRes.ok) {
                const countData = await countRes.json()
                setQuestionNumber(countData.question_count + 1)
            }
        } catch (err) {
            console.error(err)
        }
    }, [themeId])

    useEffect(() => {
        fetchThemeInfo()
    }, [fetchThemeInfo])

    // ============================================================
    // 画像アップロードハンドラ
    // ============================================================
    function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (file) {
            setImageFile(file)
            const reader = new FileReader()
            reader.onloadend = () => {
                setImagePreview(reader.result as string)
            }
            reader.readAsDataURL(file)
        }
    }

    function handleRemoveImage() {
        setImageFile(null)
        setImagePreview("")
    }

    // ============================================================
    // 送信処理
    // ============================================================
    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError("")

        if (!imageFile) {
            setError("問題画像をアップロードしてください")
            return
        }

        if (!apiBaseUrl) {
            setError("APIのベースURLが設定されていません。")
            return
        }

        try {
            setSubmitting(true)

            // FormDataで送信
            const formData = new FormData()
            formData.append("file", imageFile)
            formData.append("correctness_number", correctAnswer.toString())
            formData.append("lesson_question_label", `問題${questionNumber}`)

            const res = await fetch(
                `${apiBaseUrl}/api/exercise_questions/?lesson_theme_id=${themeId}`,
                {
                    method: "POST",
                    mode: "cors",
                    redirect: "follow",
                    body: formData,
                }
            )

            if (!res.ok) {
                const msg = await res.text()
                throw new Error(`登録失敗: ${res.status}, ${msg}`)
            }

            // 成功 → テーマ詳細ページに戻る
            router.push(`/exercise-registration/${themeId}`)
        } catch (err) {
            console.error(err)
            setError(err instanceof Error ? err.message : "エラーが発生しました")
        } finally {
            setSubmitting(false)
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
                        onClick={() => router.push(`/exercise-registration/${themeId}`)}
                        className="font-bold hover:underline mr-4"
                    >
                        &lt; 戻る
                    </button>
                </div>
                <div
                    className="border border-blue-100 bg-blue-50 py-2 px-4 rounded text-gray-700 text-center"
                    style={{ minWidth: '500px' }}
                >
                    演習問題{questionNumber}を登録 — {themeName}
                </div>
            </div>

            <div className="max-w-3xl mx-auto">
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* 画像アップロード */}
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h3 className="font-bold text-md mb-2">📷 問題画像（問題文・選択肢を含む）</h3>
                        <div className="bg-blue-50 border border-blue-100 rounded p-3 mb-4 text-sm text-blue-700">
                            画像には問題文と4つの選択肢（①、②、③、④）を含めてください
                        </div>

                        <div className="mb-4">
                            <label
                                htmlFor="image-upload"
                                className="block text-sm font-medium text-gray-700 mb-1"
                            >
                                画像をアップロード
                            </label>
                            <input
                                id="image-upload"
                                type="file"
                                accept="image/*"
                                onChange={handleImageUpload}
                                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100 cursor-pointer"
                            />
                        </div>

                        {imagePreview && (
                            <div className="relative">
                                <div className="aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden">
                                    <img
                                        src={imagePreview}
                                        alt="プレビュー"
                                        className="w-full h-full object-contain"
                                        onError={() => {
                                            setImagePreview("")
                                            setError("画像を読み込めませんでした")
                                        }}
                                    />
                                </div>
                                <button
                                    type="button"
                                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-red-600"
                                    onClick={handleRemoveImage}
                                >
                                    ✕
                                </button>
                            </div>
                        )}
                    </div>

                    {/* 正解選択 */}
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h3 className="font-bold text-md mb-4">✅ 正解を選択</h3>
                        <div className="grid grid-cols-2 gap-4">
                            {optionLabels.map((label, index) => (
                                <div
                                    key={index}
                                    className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all cursor-pointer ${correctAnswer === index
                                            ? "border-blue-500 bg-blue-50"
                                            : "border-gray-200 hover:border-gray-300"
                                        }`}
                                    onClick={() => setCorrectAnswer(index)}
                                >
                                    <input
                                        type="radio"
                                        name="correctAnswer"
                                        value={index}
                                        checked={correctAnswer === index}
                                        onChange={() => setCorrectAnswer(index)}
                                        className="w-5 h-5 text-blue-600"
                                    />
                                    <label className="flex-1 cursor-pointer text-lg font-medium">
                                        選択肢 {label}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* アクションボタン */}
                    <div className="flex gap-4">
                        <button
                            type="button"
                            onClick={() => router.push(`/exercise-registration/${themeId}`)}
                            className="flex-1 bg-white border border-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-50 font-medium"
                        >
                            キャンセル
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className={`flex-1 py-3 rounded-lg font-medium text-white ${submitting
                                    ? "bg-gray-400 cursor-not-allowed"
                                    : "bg-blue-500 hover:bg-blue-600"
                                }`}
                        >
                            {submitting ? "登録中..." : "💾 登録"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
