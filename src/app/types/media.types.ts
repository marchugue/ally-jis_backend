export interface MediaUploadResponse {
  url: string;
}

export interface MediaUploadResponse {
  url: string;
}

// POST /media/posts — returns one entry per uploaded file, in the same
// order they were submitted, so the caller can pair them with `position`
// when building the post_media rows.
export interface PostMediaUploadResponse {
  urls: string[];
}
