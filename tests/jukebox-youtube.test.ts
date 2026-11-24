import test from 'node:test';
import assert from 'node:assert/strict';
import { STREAM, checkStreamUrl, trackTitle, youtubeId } from '../src/shared/jukebox.js';

test('YouTube links of every shape give the video they point at', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `  https://youtu.be/${id}  `,
  ])
    assert.equal(youtubeId(url), id, url);
});

test('anything else is not a YouTube video', () => {
  for (const url of ['https://example.com/song.mp3', 'https://www.youtube.com/', 'https://www.youtube.com/watch?v=short', 'https://notyoutube.com/watch?v=dQw4w9WgXcQ', 'not a link', undefined])
    assert.equal(youtubeId(url), null, String(url));
});

test('a YouTube link passes the stream check and shows as a YouTube video', () => {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  assert.deepEqual(checkStreamUrl(url), { url });
  assert.equal(trackTitle({ track: STREAM, url }), 'YouTube video');
  assert.equal(trackTitle({ track: STREAM, url: 'https://radio.example/live.mp3' }), 'radio.example · live.mp3');
});
