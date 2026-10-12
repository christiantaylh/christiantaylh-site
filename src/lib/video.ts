type ParsedVideo =
  | { provider: 'youtube'; id: string }
  | { provider: 'vimeo'; id: string }
  | { provider: 'unknown'; url: string };

export function parseVideoUrl(url: string): ParsedVideo {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      return { provider: 'youtube', id: u.pathname.slice(1) };
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const v = u.searchParams.get('v');
      if (v) return { provider: 'youtube', id: v };
      const embed = u.pathname.match(/^\/embed\/([^/?]+)/);
      if (embed) return { provider: 'youtube', id: embed[1] };
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean).pop();
      if (id && /^\d+$/.test(id)) return { provider: 'vimeo', id };
    }
  } catch {
    /* fall through */
  }
  return { provider: 'unknown', url };
}

export function youtubeThumbnail(id: string): string {
  return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
}

export function youtubeEmbedUrl(id: string, autoplay = false): string {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });
  if (autoplay) {
    params.set('autoplay', '1');
    params.set('mute', '1');
    params.set('loop', '1');
    params.set('playlist', id);
    params.set('controls', '0');
  }
  return `https://www.youtube.com/embed/${id}?${params}`;
}

export function vimeoEmbedUrl(id: string, autoplay = false): string {
  const params = new URLSearchParams({ dnt: '1' });
  if (autoplay) {
    params.set('autoplay', '1');
    params.set('muted', '1');
    params.set('loop', '1');
    params.set('background', '1');
  }
  return `https://player.vimeo.com/video/${id}?${params}`;
}
