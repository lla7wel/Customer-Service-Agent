/**
 * Content publishing adapters: Facebook Page feed + Instagram feed/carousel/
 * story. Every operation is RESUMABLE: multi-step flows (IG containers,
 * FB carousel uploads) report the child ids they created so a retry after a
 * partial failure re-uses them instead of duplicating uploads (EH-030).
 */
import { graphCall, pageId, igUserId, MetaApiError } from './graph';

export interface PublishOutcome {
  providerPostId: string | null;
  permalink: string | null;
  /** Child media ids created along the way (persist for resume). */
  children: string[];
}

/* ------------------------------ Facebook Page ------------------------------ */

export async function fbPublishSinglePhoto(args: { imageUrl: string; caption?: string }): Promise<PublishOutcome> {
  const id = pageId();
  if (!id) throw new MetaApiError('META_PAGE_ID is not configured.', { status: 0 });
  const res = await graphCall<{ id?: string; post_id?: string }>(`${id}/photos`, {
    method: 'POST',
    retries: 0,
    params: { url: args.imageUrl, caption: args.caption ?? '' },
  });
  return { providerPostId: res.post_id ?? res.id ?? null, permalink: null, children: res.id ? [res.id] : [] };
}

/** Upload one unpublished photo (carousel child). Idempotent per call-site key. */
export async function fbUploadUnpublishedPhoto(imageUrl: string): Promise<string> {
  const id = pageId();
  if (!id) throw new MetaApiError('META_PAGE_ID is not configured.', { status: 0 });
  const res = await graphCall<{ id?: string }>(`${id}/photos`, {
    method: 'POST',
    retries: 0,
    params: { url: imageUrl, published: false },
  });
  if (!res.id) throw new MetaApiError('Photo upload returned no id.', { status: 0 });
  return res.id;
}

export async function fbPublishCarousel(args: { childIds: string[]; caption?: string }): Promise<PublishOutcome> {
  const id = pageId();
  if (!id) throw new MetaApiError('META_PAGE_ID is not configured.', { status: 0 });
  const res = await graphCall<{ id?: string }>(`${id}/feed`, {
    method: 'POST',
    retries: 0,
    params: {
      message: args.caption ?? '',
      attached_media: args.childIds.map((m) => ({ media_fbid: m })),
    },
  });
  return { providerPostId: res.id ?? null, permalink: null, children: args.childIds };
}

/** Facebook Page photo Story (one frame per call). */
export async function fbPublishPhotoStory(args: { photoId: string }): Promise<PublishOutcome> {
  const id = pageId();
  if (!id) throw new MetaApiError('META_PAGE_ID is not configured.', { status: 0 });
  const res = await graphCall<{ success?: boolean; post_id?: string }>(`${id}/photo_stories`, {
    method: 'POST',
    retries: 0,
    params: { photo_id: args.photoId },
  });
  return { providerPostId: res.post_id ?? null, permalink: null, children: [args.photoId] };
}

/* ------------------------------- Instagram --------------------------------- */

/** Create an IG media container (image / story / carousel child). */
export async function igCreateContainer(args: {
  imageUrl: string;
  caption?: string;
  isStory?: boolean;
  isCarouselItem?: boolean;
}): Promise<string> {
  const ig = igUserId();
  if (!ig) throw new MetaApiError('META_IG_USER_ID is not configured.', { status: 0 });
  const params: Record<string, unknown> = { image_url: args.imageUrl };
  if (args.isStory) params.media_type = 'STORIES';
  if (args.isCarouselItem) params.is_carousel_item = true;
  if (args.caption && !args.isStory && !args.isCarouselItem) params.caption = args.caption;
  const res = await graphCall<{ id?: string }>(`${ig}/media`, { method: 'POST', retries: 0, params });
  if (!res.id) throw new MetaApiError('IG container creation returned no id.', { status: 0 });
  return res.id;
}

export async function igCreateCarouselContainer(args: { childIds: string[]; caption?: string }): Promise<string> {
  const ig = igUserId();
  if (!ig) throw new MetaApiError('META_IG_USER_ID is not configured.', { status: 0 });
  const res = await graphCall<{ id?: string }>(`${ig}/media`, {
    method: 'POST',
    retries: 0,
    params: { media_type: 'CAROUSEL', children: args.childIds.join(','), caption: args.caption ?? '' },
  });
  if (!res.id) throw new MetaApiError('IG carousel container returned no id.', { status: 0 });
  return res.id;
}

export async function igPublishContainer(containerId: string): Promise<PublishOutcome> {
  const ig = igUserId();
  if (!ig) throw new MetaApiError('META_IG_USER_ID is not configured.', { status: 0 });
  const res = await graphCall<{ id?: string }>(`${ig}/media_publish`, {
    method: 'POST',
    retries: 0,
    params: { creation_id: containerId },
  });
  return { providerPostId: res.id ?? null, permalink: null, children: [containerId] };
}

/** Check an IG container's processing status before publish. */
export async function igContainerStatus(containerId: string): Promise<'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED' | 'PUBLISHED' | null> {
  const res = await graphCall<{ status_code?: string }>(`${containerId}`, {
    params: { fields: 'status_code' },
    retries: 1,
  });
  return (res.status_code as any) ?? null;
}

export async function igMediaPermalink(mediaId: string): Promise<string | null> {
  try {
    const res = await graphCall<{ permalink?: string }>(`${mediaId}`, { params: { fields: 'permalink' }, retries: 1 });
    return res.permalink ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------- Comments --------------------------------- */

export interface ProviderComment {
  id: string;
  text: string | null;
  authorName: string | null;
  authorId: string | null;
  createdTime: string | null;
  parentId: string | null;
  /** True when the comment was written by the Page/IG account itself. */
  fromSelf: boolean;
}

export async function fbGetComments(postId: string): Promise<ProviderComment[]> {
  const page = pageId();
  const res = await graphCall<{ data?: any[] }>(`${postId}/comments`, {
    params: { fields: 'id,message,from{id,name},created_time,parent{id}', limit: 100, filter: 'stream' },
    retries: 1,
  });
  return (res.data ?? []).map((c) => ({
    id: c.id,
    text: c.message ?? null,
    authorName: c.from?.name ?? null,
    authorId: c.from?.id ?? null,
    createdTime: c.created_time ?? null,
    parentId: c.parent?.id ?? null,
    fromSelf: !!page && c.from?.id === page,
  }));
}

export async function igGetComments(mediaId: string): Promise<ProviderComment[]> {
  const ig = igUserId();
  const res = await graphCall<{ data?: any[] }>(`${mediaId}/comments`, {
    params: { fields: 'id,text,username,from{id,username},timestamp,parent_id', limit: 100 },
    retries: 1,
  });
  return (res.data ?? []).map((c) => ({
    id: c.id,
    text: c.text ?? null,
    authorName: c.from?.username ?? c.username ?? null,
    authorId: c.from?.id ?? null,
    createdTime: c.timestamp ?? null,
    parentId: c.parent_id ?? null,
    fromSelf: !!ig && c.from?.id === ig,
  }));
}

/** Reply to a comment (works for both FB and IG comment ids). */
export async function replyToComment(commentId: string, message: string): Promise<{ id: string | null }> {
  const res = await graphCall<{ id?: string }>(`${commentId}/replies`, {
    method: 'POST',
    retries: 0,
    params: { message },
  });
  return { id: res.id ?? null };
}
