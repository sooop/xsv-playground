/**
 * Markdown 모드 반응형 상태 — `shell/shell.svelte.ts`, `shell/theme.svelte.ts`와 같은 문체의
 * 모듈 싱글턴. 테마·토스트·다이얼로그는 셸/공용 lib가 따로 갖고 있으므로 여기서 다루지 않는다.
 */
import { load, save } from '../../lib/util/storage'
import type { MdFileRecord } from './lib/db'

/** 실제로 열려 있는 문서는 항상 id가 있다(저장 왕복을 지난 레코드). */
export type MdDocRecord = MdFileRecord & { id: number }

export interface MdTypography {
  width: string
  fontSize: number
}

export interface MdSearchOptions {
  term: string
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}

const DEFAULT_TYPOGRAPHY: MdTypography = { width: '720px', fontSize: 15.5 }
const DEFAULT_SEARCH_OPTIONS: MdSearchOptions = { term: '', regex: false, caseSensitive: false, wholeWord: false }

class MdStateController {
  currentDoc = $state<MdDocRecord | null>(null)

  dirty = $state(false)
  saveStatus = $state<'' | 'saving' | 'saved'>('')

  sidebarOpen = $state(true)
  tocOpen = $state(true)
  searchOpen = $state(false)
  editMode = $state(false)
  paletteOpen = $state(false)
  lightboxSrc = $state<string | null>(null)

  searchOptions = $state<MdSearchOptions>({ ...DEFAULT_SEARCH_OPTIONS })

  typography = $state<MdTypography>(load('md.typography', DEFAULT_TYPOGRAPHY))

  /** 열람 이력(사이드바) — openedAt 내림차순은 `lib/db.ts#getAll`이 보장한다. */
  history = $state<MdFileRecord[]>([])

  setCurrentDoc(doc: MdDocRecord | null): void {
    this.currentDoc = doc
  }

  /** 현재 문서 일부 필드 갱신 + 사이드바 이력의 이름도 함께 맞춘다. */
  patchCurrentDoc(patch: Partial<Omit<MdDocRecord, 'id'>>): void {
    if (!this.currentDoc) return
    const id = this.currentDoc.id
    this.currentDoc = { ...this.currentDoc, ...patch }
    if (patch.name !== undefined) {
      const name = patch.name
      this.history = this.history.map((f) => (f.id === id ? { ...f, name } : f))
    }
  }

  setHistory(list: MdFileRecord[]): void {
    this.history = list
  }

  setDirty(v: boolean): void {
    this.dirty = v
  }

  setSaveStatus(v: '' | 'saving' | 'saved'): void {
    this.saveStatus = v
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen
  }

  toggleToc(): void {
    this.tocOpen = !this.tocOpen
  }

  toggleSearch(v?: boolean): void {
    this.searchOpen = v ?? !this.searchOpen
  }

  toggleEdit(): void {
    this.editMode = !this.editMode
  }

  togglePalette(v?: boolean): void {
    this.paletteOpen = v ?? !this.paletteOpen
  }

  openLightbox(src: string): void {
    this.lightboxSrc = src
  }

  closeLightbox(): void {
    this.lightboxSrc = null
  }

  setSearchOption<K extends keyof MdSearchOptions>(key: K, value: MdSearchOptions[K]): void {
    this.searchOptions = { ...this.searchOptions, [key]: value }
  }

  setTypography(patch: Partial<MdTypography>): void {
    this.typography = { ...this.typography, ...patch }
    save('md.typography', this.typography)
  }

  /** 새 문서를 여는 시점에 이전 문서에 종속된 오버레이·편집 상태를 정리한다. */
  resetForNewDoc(): void {
    this.searchOpen = false
    this.searchOptions = { ...this.searchOptions, term: '' }
    this.paletteOpen = false
    this.lightboxSrc = null
    this.editMode = false
    this.dirty = false
    this.saveStatus = ''
  }
}

export const mdState = new MdStateController()
