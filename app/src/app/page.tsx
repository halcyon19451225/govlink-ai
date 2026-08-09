import { redirect } from 'next/navigation'

export default function Home() {
  // 公開面はサービス紹介（料金）ページに集約する（完全有償化）
  redirect('/pricing')
}
