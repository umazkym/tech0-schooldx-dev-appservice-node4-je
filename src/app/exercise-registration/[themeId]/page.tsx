"use client"
import React, { useEffect, useState, useCallback, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { apiBaseUrl } from '@/lib/apiConfig'

/**
 * 演習問題登録 - テーマ詳細ページ（8スロット固定版）
 *
 * 8問分のスロットを常に表示し、画像アップロード・正解選択をローカルstateで管理。
 * 「確定/更新」ボタンを押した時のみDBとBlobを更新する。
 * 未保存変更がある場合、戻るボタンやブラウザ閉じ時に警告を出す。
 */

const TOTAL_SLOTS = 8
const optionLabels = ["①", "②", "③", "④"]

type QuestionSlot = {
    lesson_question_id: number | null
    is_registered: boolean
    question_image_url: string | null
    correctness_number: number | null
    // ローカル編集用
    localImageFile: File | null
    localImagePreview: string | null
    localCorrectnessNumber: number | null
    // 変更追跡
    isChanged: boolean
    // 削除フラグ（登録済みを未登録にする）
    isMarkedForDeletion: boolean
}

type QuestionFromAPI = {
    lesson_question_id: number
    is_registered: boolean
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
        is_registered: false,
        question_image_url: null,
        correctness_number: null,
        localImageFile: null,
        localImagePreview: null,
        localCorrectnessNumber: null,
        isChanged: false,
        isMarkedForDeletion: false,
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

    // 未保存変更の追跡
    const isDirty = slots.some(s => s.isChanged || s.isMarkedForDeletion)

    // ファイルinput用のref配列
    const fileInputRefs = useRef<(HTMLInputElement | null)[]>(
        Array.from({ length: TOTAL_SLOTS }, () => null)
    )

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
            // テーマ情報を取得（コンテンツAPIから逆引き）
            // TODO: material_idを動的にする（科目対応後）
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

            // 8問分のデータを取得
            // バックエンドAPI完成前は questions/count から取得してフォールバック
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
                        questionsFromApi = countData.question_ids.map((qid: number, idx: number) => ({
                            lesson_question_id: qid,
                            is_registered: true,
                            question_image_url: null,
                            correctness_number: null,
                            lesson_question_label: `問題${idx + 1}`,
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
                    return {
                        lesson_question_id: apiData.lesson_question_id,
                        is_registered: apiData.is_registered,
                        question_image_url: apiData.question_image_url,
                        correctness_number: apiData.correctness_number,
                        localImageFile: null,
                        localImagePreview: apiData.question_image_url,
                        localCorrectnessNumber: apiData.correctness_number,
                        isChanged: false,
                        isMarkedForDeletion: false,
                    }
                }
                return createEmptySlot()
            })
            setSlots(newSlots)
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
                    isChanged: true,
                    isMarkedForDeletion: false,
                }
                return next
            })
        }
        reader.readAsDataURL(file)
    }

    function handleRemoveImage(slotIndex: number) {
        setSlots(prev => {
            const next = [...prev]
            const slot = next[slotIndex]
            next[slotIndex] = {
                ...slot,
                localImageFile: null,
                localImagePreview: null,
                localCorrectnessNumber: null,
                isChanged: slot.is_registered, // 既に登録済みなら変更扱い
                isMarkedForDeletion: slot.is_registered,
            }
            return next
        })
        // ファイルinputもリセット
        const input = fileInputRefs.current[slotIndex]
        if (input) input.value = ""
    }

    function handleChangeCorrectness(slotIndex: number, value: number) {
        setSlots(prev => {
            const next = [...prev]
            next[slotIndex] = {
                ...next[slotIndex],
                localCorrectnessNumber: value,
                isChanged: true,
            }
            return next
        })
    }

    // ============================================================
    // 確定/更新
    // ============================================================
    async function handleSubmit() {
        if (!apiBaseUrl || !themeId) return

        // バリデーション: 画像あるなら正解も必要
        for (let i = 0; i < TOTAL_SLOTS; i++) {
            const slot = slots[i]
            if (slot.isChanged && !slot.isMarkedForDeletion) {
                if (slot.localImagePreview && slot.localCorrectnessNumber === null) {
                    alert(`問題${i + 1}: 画像が設定されていますが、正解が選択されていません。`)
                    return
                }
            }
        }

        setSubmitting(true)
        setError("")

        try {
            const changedSlots = slots
                .map((slot, idx) => ({ slot, idx }))
                .filter(({ slot }) => slot.isChanged || slot.isMarkedForDeletion)

            // 変更された問題を並列で送信
            const promises = changedSlots.map(async ({ slot, idx }) => {
                if (!slot.lesson_question_id) {
                    console.warn(`問題${idx + 1}: IDがないため更新スキップ`)
                    return
                }

                const formData = new FormData()

                if (slot.isMarkedForDeletion) {
                    // 削除（is_registered=false にする）
                    formData.append("is_registered", "false")
                    formData.append("correctness_number", "")
                } else {
                    // 登録/更新
                    formData.append("is_registered", "true")
                    formData.append("correctness_number", String(slot.localCorrectnessNumber ?? 0))
                    formData.append("lesson_question_label", `問題${idx + 1}`)
                    if (slot.localImageFile) {
                        formData.append("file", slot.localImageFile)
                    }
                }

                const res = await fetch(
                    `${apiBaseUrl}/api/exercise_questions/${slot.lesson_question_id}`,
                    {
                        method: "PUT",
                        mode: "cors",
                        redirect: "follow",
                        body: formData,
                    }
                )

                if (!res.ok) {
                    const msg = await res.text()
                    throw new Error(`問題${idx + 1}の更新に失敗: ${res.status}, ${msg}`)
                }
            })

            await Promise.all(promises)
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
    // カウント
    // ============================================================
    const registeredCount = slots.filter(s =>
        (s.is_registered && !s.isMarkedForDeletion) ||
        (!s.is_registered && s.localImagePreview && s.isChanged)
    ).length

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
                        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-800 flex items-center justify-between">
                            <span>⚠ 未保存の変更があります。「確定/更新」ボタンを押して保存してください。</span>
                        </div>
                    )}

                    {/* 8スロットグリッド */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
                        {slots.map((slot, idx) => {
                            const hasImage = slot.localImagePreview != null
                            const isRegistered = slot.is_registered && !slot.isMarkedForDeletion
                            const isNewRegistration = !slot.is_registered && hasImage && slot.isChanged
                            const showAsRegistered = isRegistered || isNewRegistration

                            return (
                                <div
                                    key={idx}
                                    className={`bg-white border rounded-lg overflow-hidden transition-shadow ${slot.isChanged || slot.isMarkedForDeletion
                                            ? "border-yellow-400 shadow-md"
                                            : "border-gray-200 hover:shadow-md"
                                        }`}
                                >
                                    {/* カードヘッダー */}
                                    <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                                        <span className="font-bold text-md">問題{idx + 1}</span>
                                        {showAsRegistered ? (
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

                                        {/* 正解選択 */}
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
