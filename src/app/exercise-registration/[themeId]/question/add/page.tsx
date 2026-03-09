"use client"
import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

/**
 * 旧・問題追加ページ
 * 8スロット固定UIへの移行に伴い、テーマ詳細ページにリダイレクトする。
 */
export default function QuestionAddRedirect() {
    const params = useParams()
    const router = useRouter()
    const themeId = params?.themeId

    useEffect(() => {
        router.replace(`/exercise-registration/${themeId}`)
    }, [router, themeId])

    return <p className="text-gray-500">リダイレクト中...</p>
}
