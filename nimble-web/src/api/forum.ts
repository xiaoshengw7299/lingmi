import request, { del, get, patch, post } from '@/utils/request'

export type ForumVisibility = 'public' | 'admin'
export type ForumStatus = 'open' | 'resolved'

export interface ForumAttachment {
  key: string
  name: string
  mime: string
  size: number
  url: string
}

export interface ForumPost {
  id: string
  title: string
  content: string
  visibility: ForumVisibility
  status: ForumStatus
  attachments: ForumAttachment[]
  authorId: number
  authorName: string
  likeCount: number
  commentCount: number
  liked: boolean
  createdAt: string
  updatedAt: string
}

export interface ForumComment {
  id: string
  postId: string
  content: string
  authorId: number
  authorName: string
  createdAt: string
}

export interface ForumDetail extends ForumPost {
  comments: ForumComment[]
}

export const FORUM_MAX_FILES = 6
export const FORUM_MAX_BYTES = 20 * 1024 * 1024

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
}

export const forumAccept = Object.keys(MIME_EXT).join(',')

/** 选文件时就能告诉用户为什么不行，避免传到一半才失败 */
export function forumFileError(file: File, count: number): string | null {
  if (count >= FORUM_MAX_FILES) return `最多 ${FORUM_MAX_FILES} 个附件`
  if (!MIME_EXT[file.type]) return '仅支持图片、视频、音频和 PDF'
  if (file.size > FORUM_MAX_BYTES) return '单个附件不能超过 20MB'
  if (!file.size) return '文件是空的'
  return null
}

export const listForumPosts = (params?: { keyword?: string; page?: number; pageSize?: number }) =>
  get<{ items: ForumPost[]; total: number; page: number; pageSize: number }>('/forum/posts', params)

export const getForumPost = (id: string) => get<ForumDetail>(`/forum/posts/${id}`)

export const uploadForumFile = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return request.post('/forum/uploads', form) as Promise<ForumAttachment>
}

export const createForumPost = (data: { title: string; content: string; visibility: ForumVisibility; attachments: Array<Pick<ForumAttachment, 'key' | 'name' | 'mime' | 'size'>> }) =>
  post<ForumPost>('/forum/posts', data)

export const updateForumPost = (id: string, data: { title: string; content: string; visibility: ForumVisibility; attachments: Array<Pick<ForumAttachment, 'key' | 'name' | 'mime' | 'size'>> }) =>
  patch<ForumPost>(`/forum/posts/${id}`, data)

export const deleteForumPost = (id: string) => del<void>(`/forum/posts/${id}`)

export const likeForumPost = (id: string) => post<{ liked: boolean; likeCount: number }>(`/forum/posts/${id}/like`)

export const commentForumPost = (id: string, content: string) => post<ForumComment>(`/forum/posts/${id}/comments`, { content })

export const deleteForumComment = (postId: string, commentId: string) => del<void>(`/forum/posts/${postId}/comments/${commentId}`)

export const setForumStatus = (id: string, status: ForumStatus) => patch<ForumPost>(`/forum/posts/${id}/status`, { status })
