"use client"
import React, { useEffect, useState, useCallback, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { apiBaseUrl } from '@/lib/apiConfig'

/**
 * 演習問題登録 - テーマ詳細ページ（8スロット固定版）
 *
 * - 常に8スロットを表示
 * - 画像+正解がある = 登録済み、ない = 未登録
 * - 「確定/更新」で8問すべてを一括送信（DBを全上書き）
 * - is_registered フラグは使わない。DBにレコードがあるか否かで判定。
 */

const TOTAL_SLOTS = 8
const optionLabels = ["①", "②", "③", "④"]

/** 1スロット分のローカル状態 */
type QuestionSlot = {
    /** DB上のID（事前作成済みなら値あり、未作成ならnull） */
    lesson_question_id: number | null
    /** ローカルで選択/表示中の画像プレビュー（data: URL or blob URL） */
    localImagePreview: string | null
    /** ローカルで選択した画像ファイル（新規アップロード分） */
    localImageFile: File | null
    /** 正解番号（0-3、未設定ならnull） */
    localCorrectnessNumber: number | null
}

/** APIから取得する1問分のデータ */
type QuestionFromAPI = {
    lesson_question_id: number
    question_image_url: string | null
    correctness_number: number | null
    lesson_question_label: string | null
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

function createEmptySlot(): QuestionSlot {
    return {
        lesson_question_id: null,
        localImagePreview: null,
        localImageFile: null,
        localCorrectnessNumber: null,
    }
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
    const [slots, setSlots] = useState<QuestionSlot[]>(
        Array.from({ length: TOTAL_SLOTS }, () => createEmptySlot())
    )
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [submitting, setSubmitting] = useState(false)

    // 初期ロード時のスナップショット（isDirty判定用）
    const [initialSnapshot, setInitialSnapshot] = useState("")

    // ファイルinput用のref配列
    const fileInputRefs = useRef<(HTMLInputElement | null)[]>(
        Array.from({ length: TOTAL_SLOTS }, () => null)
    )

    // 未保存変更の判定
    // スロットの「意味のある状態」をシリアライズして初期値と比較
    function serializeSlots(s: QuestionSlot[]): string {
        return JSON.stringify(s.map(slot => ({
            hasImage: slot.localImagePreview != null,
            correctness: slot.localCorrectnessNumber,
            // 新しい画像ファイルがあれば変更とみなす
            hasNewFile: slot.localImageFile != null,
        })))
    }

    const isDirty = initialSnapshot !== "" && serializeSlots(slots) !== initialSnapshot

    // ============================================================
    // ブラウザ閉じ/リロード時の警告
    // ============================================================
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault()
                e.returnValue = ""
            }
        }
        window.addEventListener("beforeunload", handleBeforeUnload)
        return () => window.removeEventListener("beforeunload", handleBeforeUnload)
    }, [isDirty])

    // ============================================================
    // データ取得
    // ============================================================
    const fetchData = useCallback(async () => {
        if (!apiBaseUrl || !themeId) return
        setLoading(true)
        setError("")
        try {
            // テーマ情報を取得
            const contentRes = await fetch(`${apiBaseUrl}/content/by_id/1`, {
                method: "GET", mode: "cors", redirect: "follow",
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

            // 8問分のデータを取得
            let questionsFromApi: QuestionFromAPI[] = []

            try {
                const questionsRes = await fetch(
                    `${apiBaseUrl}/api/exercise_questions/by_theme/${themeId}`,
                    { method: "GET", mode: "cors", redirect: "follow" }
                )
                if (questionsRes.ok) {
                    questionsFromApi = await questionsRes.json()
                }
            } catch {
                // APIが未実装の場合、既存のカウントAPIでフォールバック
                console.log("by_theme API未実装、既存APIでフォールバック")
                try {
                    const countRes = await fetch(
                        `${apiBaseUrl}/api/lesson_themes/${themeId}/questions/count`,
                        { method: "GET", mode: "cors", redirect: "follow" }
                    )
                    if (countRes.ok) {
                        const countData = await countRes.json()
                        questionsFromApi = countData.question_ids.map((qid: number) => ({
                            lesson_question_id: qid,
                            question_image_url: null,
                            correctness_number: null,
                            lesson_question_label: null,
                        }))
                    }
                } catch (e) {
                    console.error("フォールバックも失敗:", e)
                }
            }

            // 8スロットにマッピング
            const newSlots: QuestionSlot[] = Array.from({ length: TOTAL_SLOTS }, (_, idx) => {
                const apiData = questionsFromApi[idx]
                if (apiData) {
                    // DBにレコードがあり、画像URLもある = 登録済み
                    const hasData = apiData.question_image_url != null
                    return {
                        lesson_question_id: apiData.lesson_question_id,
                        localImagePreview: hasData ? apiData.question_image_url : null,
                        localImageFile: null,
                        localCorrectnessNumber: hasData ? apiData.correctness_number : null,
                    }
                }
                return createEmptySlot()
            })
            setSlots(newSlots)
            setInitialSnapshot(serializeSlots(newSlots))
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
    // スロット操作
    // ============================================================
    function handleImageUpload(slotIndex: number, e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onloadend = () => {
            setSlots(prev => {
                const next = [...prev]
                next[slotIndex] = {
                    ...next[slotIndex],
                    localImageFile: file,
                    localImagePreview: reader.result as string,
                }
                return next
            })
        }
        reader.readAsDataURL(file)
    }

    function handleRemoveImage(slotIndex: number) {
        setSlots(prev => {
            const next = [...prev]
            next[slotIndex] = {
                ...next[slotIndex],
                localImageFile: null,
                localImagePreview: null,
                localCorrectnessNumber: null,
            }
            return next
        })
        const input = fileInputRefs.current[slotIndex]
        if (input) input.value = ""
    }

    function handleChangeCorrectness(slotIndex: number, value: number) {
        setSlots(prev => {
            const next = [...prev]
            next[slotIndex] = {
                ...next[slotIndex],
                localCorrectnessNumber: value,
            }
            return next
        })
    }

    // ============================================================
    // 確定/更新（8問すべてを一括送信・DB全上書き）
    // ============================================================
    async function handleSubmit() {
        if (!apiBaseUrl || !themeId) return

        // バリデーション: 画像があるなら正解も必須、かつ最低1問は登録が必要
        let hasActiveSlot = false
        for (let i = 0; i < TOTAL_SLOTS; i++) {
            const slot = slots[i]
            if (slot.localImagePreview) {
                hasActiveSlot = true
                if (slot.localCorrectnessNumber === null) {
                    alert(`問題${i + 1}: 画像が設定されていますが、正解が選択されていません。`)
                    return
                }
            }
        }

        if (!hasActiveSlot) {
            alert("最低1問は画像を登録してください。")
            return
        }

        setSubmitting(true)
        setError("")

        try {
            // FormDataに8問分のデータを詰める
            const formData = new FormData()

            for (let i = 0; i < TOTAL_SLOTS; i++) {
                const slot = slots[i]
                const prefix = `slot_${i}`

                if (slot.localImagePreview) {
                    // この問題は「登録あり」
                    formData.append(`${prefix}_status`, "active")
                    formData.append(`${prefix}_correctness_number`, String(slot.localCorrectnessNumber ?? 0))
                    formData.append(`${prefix}_label`, `問題${i + 1}`)
                    if (slot.lesson_question_id) {
                        formData.append(`${prefix}_question_id`, String(slot.lesson_question_id))
                    }
                    // 新しい画像ファイルがある場合のみ送信
                    if (slot.localImageFile) {
                        formData.append(`${prefix}_file`, slot.localImageFile)
                    }
                } else {
                    // この問題は「登録なし」→ DBレコードがあれば削除
                    formData.append(`${prefix}_status`, "empty")
                    if (slot.lesson_question_id) {
                        formData.append(`${prefix}_question_id`, String(slot.lesson_question_id))
                    }
                }
            }

            const res = await fetch(
                `${apiBaseUrl}/api/exercise_questions/bulk/${themeId}`,
                {
                    method: "PUT",
                    mode: "cors",
                    redirect: "follow",
                    body: formData,
                }
            )

            if (!res.ok) {
                const msg = await res.text()
                throw new Error(`更新失敗: ${res.status}, ${msg}`)
            }

            alert("更新が完了しました")

            // 再取得してstateをリセット
            await fetchData()
        } catch (err) {
            console.error(err)
            setError(err instanceof Error ? err.message : "更新中にエラーが発生しました")
        } finally {
            setSubmitting(false)
        }
    }

    // ============================================================
    // 戻るボタン（未保存警告）
    // ============================================================
    function handleBack() {
        if (isDirty) {
            const ok = confirm("未保存の変更があります。破棄して戻りますか？")
            if (!ok) return
        }
        router.push("/exercise-registration")
    }

    // ============================================================
    // カウント（画像がある = 登録済み）
    // ============================================================
    const registeredCount = slots.filter(s => s.localImagePreview != null).length

    // ============================================================
    // JSX
    // ============================================================
    return (
        <div>
            {/* ヘッダー */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <button
                        onClick={handleBack}
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
                                {registeredCount} / {TOTAL_SLOTS}
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                                className="bg-blue-500 h-2 rounded-full transition-all"
                                style={{ width: `${(registeredCount / TOTAL_SLOTS) * 100}%` }}
                            />
                        </div>
                    </div>

                    {/* 未保存変更の通知 */}
                    {isDirty && (
                        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-800">
                            ⚠ 未保存の変更があります。「確定/更新」ボタンを押して保存してください。
                        </div>
                    )}

                    {/* 8スロットグリッド */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
                        {slots.map((slot, idx) => {
                            const hasImage = slot.localImagePreview != null
                            return (
                                <div
                                    key={idx}
                                    className={`bg-white border rounded-lg overflow-hidden transition-shadow ${hasImage
                                            ? "border-gray-200 hover:shadow-md"
                                            : "border-gray-200"
                                        }`}
                                >
                                    {/* カードヘッダー */}
                                    <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                                        <span className="font-bold text-md">問題{idx + 1}</span>
                                        {hasImage ? (
                                            <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-semibold">
                                                登録済み
                                            </span>
                                        ) : (
                                            <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-xs">
                                                未登録
                                            </span>
                                        )}
                                    </div>

                                    {/* カードボディ */}
                                    <div className="p-3">
                                        {hasImage ? (
                                            <div className="relative">
                                                <div className="aspect-[4/3] bg-gray-100 rounded overflow-hidden mb-2">
                                                    <img
                                                        src={slot.localImagePreview!}
                                                        alt={`問題${idx + 1}`}
                                                        className="w-full h-full object-contain"
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 text-xs"
                                                    onClick={() => handleRemoveImage(idx)}
                                                    title="画像を削除"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ) : (
                                            <div
                                                className="aspect-[4/3] bg-gray-50 rounded flex flex-col items-center justify-center mb-2 border-2 border-dashed border-gray-300 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                                                onClick={() => fileInputRefs.current[idx]?.click()}
                                            >
                                                <span className="text-3xl text-gray-300 mb-1">+</span>
                                                <span className="text-gray-400 text-xs">
                                                    クリックして画像を選択
                                                </span>
                                            </div>
                                        )}

                                        {/* 隠しファイルinput */}
                                        <input
                                            ref={el => { fileInputRefs.current[idx] = el }}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => handleImageUpload(idx, e)}
                                        />

                                        {/* 正解選択（画像があるときのみ） */}
                                        {hasImage && (
                                            <div className="mt-2">
                                                <p className="text-xs text-gray-500 mb-1">正解:</p>
                                                <div className="grid grid-cols-4 gap-1">
                                                    {optionLabels.map((label, optIdx) => (
                                                        <button
                                                            key={optIdx}
                                                            type="button"
                                                            className={`text-center py-1 rounded text-xs font-medium transition-colors ${slot.localCorrectnessNumber === optIdx
                                                                    ? "bg-blue-500 text-white"
                                                                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                                                }`}
                                                            onClick={() => handleChangeCorrectness(idx, optIdx)}
                                                        >
                                                            {label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* カードフッター: 画像がない場合のアップロードボタン */}
                                    {!hasImage && (
                                        <div className="p-3 border-t border-gray-100">
                                            <button
                                                type="button"
                                                className="w-full text-center bg-blue-50 text-blue-600 px-3 py-1.5 rounded text-xs hover:bg-blue-100 transition-colors"
                                                onClick={() => fileInputRefs.current[idx]?.click()}
                                            >
                                                画像をアップロード
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>

                    {/* 確定/更新ボタン */}
                    <div className="flex justify-end gap-4">
                        <button
                            type="button"
                            onClick={handleBack}
                            className="bg-white border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50 font-medium"
                        >
                            キャンセル
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={submitting || !isDirty}
                            className={`px-8 py-3 rounded-lg font-medium text-white transition-colors ${submitting || !isDirty
                                    ? "bg-gray-400 cursor-not-allowed"
                                    : "bg-blue-500 hover:bg-blue-600"
                                }`}
                        >
                            {submitting ? "更新中..." : "確定/更新"}
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}
