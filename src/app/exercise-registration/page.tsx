"use client"
import React, { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { AiFillFolder } from "react-icons/ai"
import { apiBaseUrl } from '@/lib/apiConfig'

/**
 * 演習問題登録 - テーマ一覧ページ
 * 
 * 左側: /content/by_id/1 で取得した教材階層ツリー (part_name > chapter_name > unit_name)
 * 右側: 選択した単元の lesson_themes を一覧表示
 *       各テーマごとに「演習問題を登録」ボタンを表示
 *       既に登録済みの問題数をバッジで表示
 */

type LessonThemeFromContent = {
    lesson_theme_id: number
    lesson_theme_name: string
    units_id?: number
    lecture_videos?: unknown[]
}

type UnitItemFromContent = {
    units_id: number
    material_id: number
    part_name: string
    chapter_name: string
    unit_name: string
    lesson_themes: LessonThemeFromContent[]
}

type QuestionCountResponse = {
    lesson_theme_id: number
    question_count: number
    question_ids: number[]
}

type ChapterGroup = {
    chapter_name: string
    units: UnitItemFromContent[]
}

type PartGroup = {
    part_name: string
    chapters: ChapterGroup[]
}

export default function ExerciseRegistrationPage() {
    const [parts, setParts] = useState<PartGroup[]>([])
    const [unitMap, setUnitMap] = useState<Record<number, UnitItemFromContent>>({})
    const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null)
    const [questionCounts, setQuestionCounts] = useState<Record<number, QuestionCountResponse>>({})
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(true)

    // ============================================================
    // データ取得
    // ============================================================
    const fetchContentData = useCallback(async () => {
        if (!apiBaseUrl) {
            setError("APIのベースURLが設定されていません。")
            return
        }
        setError("")
        setLoading(true)
        try {
            const contentRes = await fetch(`${apiBaseUrl}/content/by_id/1`, {
                method: "GET",
                mode: "cors",
                redirect: "follow",
            })
            if (!contentRes.ok) {
                throw new Error(`コンテンツデータの取得に失敗しました: ${contentRes.status}`)
            }
            const contentData: UnitItemFromContent[] = await contentRes.json()

            const groupedParts = groupByPartChapter(contentData)
            setParts(groupedParts)

            const mapObj: Record<number, UnitItemFromContent> = {}
            contentData.forEach((u) => {
                mapObj[u.units_id] = u
            })
            setUnitMap(mapObj)

            // デフォルト選択
            if (groupedParts.length > 0) {
                const firstPart = groupedParts[0]
                if (firstPart.chapters.length > 0) {
                    const firstChap = firstPart.chapters[0]
                    if (firstChap.units.length > 0) {
                        setSelectedUnitId(firstChap.units[0].units_id)
                    }
                }
            }

            // 全テーマの問題数を取得
            const allThemes = contentData.flatMap(u => u.lesson_themes)
            await fetchQuestionCounts(allThemes.map(t => t.lesson_theme_id))
        } catch (err) {
            console.error(err)
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [])

    const fetchQuestionCounts = async (themeIds: number[]) => {
        if (!apiBaseUrl) return
        const counts: Record<number, QuestionCountResponse> = {}
        // 並列で問題数を取得
        const promises = themeIds.map(async (themeId) => {
            try {
                const res = await fetch(
                    `${apiBaseUrl}/api/lesson_themes/${themeId}/questions/count`,
                    { method: "GET", mode: "cors", redirect: "follow" }
                )
                if (res.ok) {
                    const data: QuestionCountResponse = await res.json()
                    counts[themeId] = data
                }
            } catch (e) {
                console.error(`問題数取得エラー (theme_id=${themeId}):`, e)
            }
        })
        await Promise.all(promises)
        setQuestionCounts(counts)
    }

    useEffect(() => {
        fetchContentData()
    }, [fetchContentData])

    // ============================================================
    // ユーティリティ
    // ============================================================
    function groupByPartChapter(allUnits: UnitItemFromContent[]): PartGroup[] {
        const partMap = new Map<string, Map<string, UnitItemFromContent[]>>()
        for (const u of allUnits) {
            if (!partMap.has(u.part_name)) {
                partMap.set(u.part_name, new Map())
            }
            const chapterMap = partMap.get(u.part_name)!
            if (!chapterMap.has(u.chapter_name)) {
                chapterMap.set(u.chapter_name, [])
            }
            chapterMap.get(u.chapter_name)!.push(u)
        }
        const result: PartGroup[] = []
        for (const [pName, chMap] of partMap.entries()) {
            const chapters: ChapterGroup[] = []
            for (const [cName, unitsArr] of chMap.entries()) {
                chapters.push({ chapter_name: cName, units: unitsArr })
            }
            result.push({ part_name: pName, chapters })
        }
        return result
    }

    function handleUnitClick(unitId: number) {
        setSelectedUnitId(unitId)
    }

    function getQuestionCount(themeId: number): number {
        return questionCounts[themeId]?.question_count ?? 0
    }

    // ============================================================
    // JSX
    // ============================================================
    const selectedUnit = selectedUnitId ? unitMap[selectedUnitId] : null

    const handleBack = () => {
        history.back()
    }

    return (
        <div>
            {/* タイトル行 */}
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
                    style={{ minWidth: '700px' }}
                >
                    演習問題を登録するテーマを選択してください
                </div>
            </div>

            {error && (
                <div className="text-red-500 mb-2 whitespace-pre-wrap">{error}</div>
            )}
            {loading && !error && (
                <p className="text-gray-500">読み込み中です。</p>
            )}

            <div className="flex">
                {/* 左側ツリー */}
                <div className="w-64 border-r border-gray-200 pr-2">
                    <h2 className="font-bold text-lg mb-2">高校1年生・物理基礎</h2>
                    {parts.map((p) => (
                        <div key={p.part_name} className="mb-2">
                            <div className="text-sm font-bold mb-1">{p.part_name}</div>
                            {p.chapters.map((ch) => (
                                <div key={ch.chapter_name} className="ml-4 mb-2">
                                    <div className="text-sm font-semibold mb-1">{ch.chapter_name}</div>
                                    <div className="ml-4">
                                        {ch.units.map((u) => {
                                            const isSelected = u.units_id === selectedUnitId
                                            return (
                                                <div
                                                    key={u.units_id}
                                                    className="flex items-center mb-1 cursor-pointer"
                                                    onClick={() => handleUnitClick(u.units_id)}
                                                >
                                                    <AiFillFolder style={{ color: "#FFB700" }} className="mr-1" />
                                                    <span className={isSelected ? "font-bold" : ""}>
                                                        {u.unit_name}
                                                    </span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>

                {/* 右テーブル */}
                <div className="flex-1 ml-4">
                    {selectedUnit ? (
                        <>
                            <div className="flex items-center justify-between mb-2">
                                <h2 className="font-bold text-md">
                                    {selectedUnit.part_name} &gt; {selectedUnit.chapter_name} &gt; {selectedUnit.unit_name}
                                </h2>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full border border-gray-200 text-sm table-fixed">
                                    <thead className="bg-gray-100">
                                        <tr>
                                            <th className="p-2 border-r border-gray-200 w-2/6">テーマ</th>
                                            <th className="p-2 border-r border-gray-200 w-1/6 text-center">登録済み問題数</th>
                                            <th className="p-2 w-1/6 text-center">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedUnit.lesson_themes.map((theme) => {
                                            const count = getQuestionCount(theme.lesson_theme_id)
                                            return (
                                                <tr key={theme.lesson_theme_id}>
                                                    <td className="p-2 border-b border-gray-200 border-r">
                                                        {theme.lesson_theme_name}
                                                    </td>
                                                    <td className="p-2 border-b border-gray-200 border-r text-center">
                                                        <span
                                                            className={`inline-block px-2 py-1 rounded text-xs font-semibold ${count >= 8
                                                                    ? "bg-green-100 text-green-700"
                                                                    : count > 0
                                                                        ? "bg-yellow-100 text-yellow-700"
                                                                        : "bg-gray-100 text-gray-500"
                                                                }`}
                                                        >
                                                            {count} / 8
                                                        </span>
                                                    </td>
                                                    <td className="p-2 border-b border-gray-200 text-center">
                                                        <Link
                                                            href={`/exercise-registration/${theme.lesson_theme_id}`}
                                                            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 text-xs"
                                                        >
                                                            演習問題を登録
                                                        </Link>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : (
                        <p className="text-gray-500">単元を選択してください</p>
                    )}
                </div>
            </div>
        </div>
    )
}
