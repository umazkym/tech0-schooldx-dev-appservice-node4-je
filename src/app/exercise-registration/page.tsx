"use client"
import React, { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { AiFillFolder, AiFillFolderOpen } from "react-icons/ai"
import { IoChevronDown, IoChevronForward } from "react-icons/io5"
import { apiBaseUrl } from '@/lib/apiConfig'

/**
 * 演習問題登録 - テーマ一覧ページ
 *
 * 左側: 教材階層ツリー (part > chapter > unit) - 折りたたみ対応
 * 右側: 選択した単元の lesson_themes を一覧表示
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

type SubjectData = {
    subject_id: number
    subject_name: string
}

type MaterialData = {
    material_id: number
    material_name: string
    subject_id?: number
}

export default function ExerciseRegistrationPage() {
    const [subjects, setSubjects] = useState<SubjectData[]>([])
    const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null)
    const [allMaterials, setAllMaterials] = useState<MaterialData[]>([])
    const [materials, setMaterials] = useState<MaterialData[]>([])
    const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null)

    const [parts, setParts] = useState<PartGroup[]>([])
    const [unitMap, setUnitMap] = useState<Record<number, UnitItemFromContent>>({})
    const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null)
    const [questionCounts, setQuestionCounts] = useState<Record<number, QuestionCountResponse>>({})
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(true)

    // 折りたたみ状態管理
    const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set())
    const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())


    // ============================================================
    // 科目・教科書データ取得
    // ============================================================
    const fetchSubjects = useCallback(async () => {
        if (!apiBaseUrl) return
        try {
            const res = await fetch(`${apiBaseUrl}/subjects/`, { method: "GET", mode: "cors" })
            if (!res.ok) throw new Error(`科目一覧の取得に失敗: ${res.status}`)
            const data: SubjectData[] = await res.json()
            setSubjects(data)
            if (data.length > 0) {
                setSelectedSubjectId(data[0].subject_id)
            }
        } catch (err) {
            console.error(err)
        }
    }, [])

    const fetchMaterials = useCallback(async () => {
        if (!apiBaseUrl) return
        try {
            const res = await fetch(`${apiBaseUrl}/lesson_registrations/all`, { method: "GET", mode: "cors" })
            if (!res.ok) throw new Error(`教科書一覧の取得に失敗: ${res.status}`)
            const data = await res.json()
            setAllMaterials(data.materials || [])
        } catch (err) {
            console.error(err)
        }
    }, [])

    // 科目が変更されたら教科書をフィルタ
    useEffect(() => {
        if (selectedSubjectId != null) {
            const filtered = allMaterials.filter(
                (m) => m.subject_id === selectedSubjectId
            )
            // subject_idがまだ教科書データに無い場合は全件表示（互換性）
            const result = filtered.length > 0 ? filtered : allMaterials
            setMaterials(result)
            // 最初の教科書を自動選択
            if (result.length > 0) {
                setSelectedMaterialId(result[0].material_id)
            } else {
                setSelectedMaterialId(null)
            }
        } else {
            setMaterials(allMaterials)
            if (allMaterials.length > 0) {
                setSelectedMaterialId(allMaterials[0].material_id)
            }
        }
    }, [selectedSubjectId, allMaterials])

    // ============================================================
    // コンテンツデータ取得（教科書選択時）
    // ============================================================
    const fetchContentData = useCallback(async (materialId: number) => {
        if (!apiBaseUrl) {
            setError("APIのベースURLが設定されていません。")
            return
        }
        setError("")
        setLoading(true)
        try {
            const contentRes = await fetch(`${apiBaseUrl}/content/by_id/${materialId}`, {
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

            // 初期状態: すべて展開
            const allParts = new Set(groupedParts.map(p => p.part_name))
            const allChapters = new Set(
                groupedParts.flatMap(p => p.chapters.map(c => `${p.part_name}::${c.chapter_name}`))
            )
            setExpandedParts(allParts)
            setExpandedChapters(allChapters)

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

    // 教科書が変更されたらコンテンツを再取得
    useEffect(() => {
        if (selectedMaterialId != null) {
            fetchContentData(selectedMaterialId)
        } else {
            setParts([])
            setUnitMap({})
            setSelectedUnitId(null)
            setLoading(false)
        }
    }, [selectedMaterialId, fetchContentData])

    // 初回読み込み
    useEffect(() => {
        fetchSubjects()
        fetchMaterials()
    }, [fetchSubjects, fetchMaterials])

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

    // 折りたたみトグル
    function togglePart(partName: string) {
        setExpandedParts(prev => {
            const next = new Set(prev)
            if (next.has(partName)) {
                next.delete(partName)
                // 子チャプターもすべて閉じる
                const part = parts.find(p => p.part_name === partName)
                if (part) {
                    part.chapters.forEach(c => {
                        const key = `${partName}::${c.chapter_name}`
                        expandedChapters.delete(key)
                    })
                    setExpandedChapters(new Set(expandedChapters))
                }
            } else {
                next.add(partName)
            }
            return next
        })
    }

    function toggleChapter(partName: string, chapterName: string) {
        const key = `${partName}::${chapterName}`
        setExpandedChapters(prev => {
            const next = new Set(prev)
            if (next.has(key)) {
                next.delete(key)
            } else {
                next.add(key)
            }
            return next
        })
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

            {/* 科目・教科書選択 */}
            {!loading && !error && (
                <div className="flex items-center gap-4 mb-4">
                    <div>
                        <label className="text-sm mr-2">科目:</label>
                        <select
                            className="border border-gray-300 rounded px-2 py-1 text-sm"
                            value={selectedSubjectId ?? ""}
                            onChange={(e) => setSelectedSubjectId(parseInt(e.target.value, 10) || null)}
                        >
                            <option value="">選択</option>
                            {subjects.map((s) => (
                                <option key={s.subject_id} value={s.subject_id}>
                                    {s.subject_name}
                                </option>
                            ))}
                        </select>
                    </div>
                    {materials.length > 1 && (
                        <div>
                            <label className="text-sm mr-2">教科書:</label>
                            <select
                                className="border border-gray-300 rounded px-2 py-1 text-sm"
                                value={selectedMaterialId ?? ""}
                                onChange={(e) => setSelectedMaterialId(parseInt(e.target.value, 10) || null)}
                            >
                                <option value="">選択</option>
                                {materials.map((m) => (
                                    <option key={m.material_id} value={m.material_id}>
                                        {m.material_name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            )}

            <div className="flex">
                {/* 左側ツリー（折りたたみ対応） */}
                <div className="w-64 border-r border-gray-200 pr-2">
                    <h2 className="font-bold text-lg mb-2">
                        {materials.find(m => m.material_id === selectedMaterialId)?.material_name ?? "教科書を選択してください"}
                    </h2>
                    {parts.map((p) => {
                        const isPartExpanded = expandedParts.has(p.part_name)
                        return (
                            <div key={p.part_name} className="mb-1">
                                {/* 編（Part）ヘッダー */}
                                <div
                                    className="flex items-center gap-1 cursor-pointer py-1 hover:bg-gray-50 rounded px-1"
                                    onClick={() => togglePart(p.part_name)}
                                >
                                    {isPartExpanded
                                        ? <IoChevronDown className="text-gray-500 flex-shrink-0" size={14} />
                                        : <IoChevronForward className="text-gray-500 flex-shrink-0" size={14} />
                                    }
                                    <span className="text-sm font-bold">{p.part_name}</span>
                                </div>

                                {/* 章（Chapter）*/}
                                {isPartExpanded && p.chapters.map((ch) => {
                                    const chapterKey = `${p.part_name}::${ch.chapter_name}`
                                    const isChapterExpanded = expandedChapters.has(chapterKey)
                                    return (
                                        <div key={ch.chapter_name} className="ml-4 mb-1">
                                            {/* 章ヘッダー */}
                                            <div
                                                className="flex items-center gap-1 cursor-pointer py-1 hover:bg-gray-50 rounded px-1"
                                                onClick={() => toggleChapter(p.part_name, ch.chapter_name)}
                                            >
                                                {isChapterExpanded
                                                    ? <IoChevronDown className="text-gray-500 flex-shrink-0" size={12} />
                                                    : <IoChevronForward className="text-gray-500 flex-shrink-0" size={12} />
                                                }
                                                <span className="text-sm font-semibold">{ch.chapter_name}</span>
                                            </div>

                                            {/* 単元（Unit） */}
                                            {isChapterExpanded && (
                                                <div className="ml-4">
                                                    {ch.units.map((u) => {
                                                        const isSelected = u.units_id === selectedUnitId
                                                        return (
                                                            <div
                                                                key={u.units_id}
                                                                className={`flex items-center mb-1 cursor-pointer py-0.5 px-1 rounded ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"
                                                                    }`}
                                                                onClick={() => handleUnitClick(u.units_id)}
                                                            >
                                                                {isSelected
                                                                    ? <AiFillFolderOpen style={{ color: "#FFB700" }} className="mr-1 flex-shrink-0" />
                                                                    : <AiFillFolder style={{ color: "#FFB700" }} className="mr-1 flex-shrink-0" />
                                                                }
                                                                <span className={`text-sm ${isSelected ? "font-bold" : ""}`}>
                                                                    {u.unit_name}
                                                                </span>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })}
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
