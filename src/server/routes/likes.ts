// Liked songs ("hartje") — works from every source, including web radio,
// because the server likes whatever is playing right now rather than
// whatever the caller sends. See src/services/likedTracks.ts for how a song
// is identified across sources and db.ts for the liked_tracks table.
import express from 'express';
import { deleteLikedTrack, getLikedTracks, saveLikedTrack } from '../../../db.ts';
import { describeLikeSource, isLikeable, likeKey } from '../../services/likedTracks.ts';
import { pushLikeToListener } from '../../services/listenerClient.ts';
import { broadcastWebSocket, externalSourceState, hubConfig, playbackState, requireAudioPermission } from '../state.ts';

const router = express.Router();

// One event carrying the whole list: every screen (web, kiosk, cast) just
// replaces what it has, so there's no merge logic to keep in sync in three
// places for a list this small.
function broadcastLikes(): void {
  broadcastWebSocket({ event: 'likes_updated', timestamp: Date.now(), data: { likes: getLikedTracks() } });
}

router.get('/api/likes', (req, res) => {
  res.json({ success: true, likes: getLikedTracks() });
});

// No body: the Hub already knows what's playing and which source it came
// from. A kiosk screen can call this with its scoped audio:control key.
router.post('/api/likes', requireAudioPermission('audio:control'), (req, res) => {
  const externalLabel = externalSourceState.active ? externalSourceState.sourceLabel || 'Externe bron' : null;
  const track = externalLabel ? externalSourceState.track : playbackState.currentTrack;

  if (!isLikeable(track)) {
    res.status(400).json({ error: 'Er speelt nu geen nummer om te bewaren' });
    return;
  }

  const { source, sourceDetail } = describeLikeSource(track, externalLabel);
  const like = {
    likeKey: likeKey(track!.artist, track!.title),
    title: track!.title.trim(),
    artist: track!.artist.trim(),
    album: track!.album || '',
    coverUrl: track!.highResCoverUrl || track!.coverUrl || '',
    source,
    sourceDetail,
    spotifyId: track!.spotifyId || (track!.uri?.startsWith('spotify:track:') ? track!.uri.split(':')[2] : null),
    // A radio like's uri is the stream, not the song — worthless for playing
    // it back later, so it isn't kept. Spotify/NAS uris are.
    uri: source === 'radio' ? null : track!.uri || null,
    likedAt: Date.now(),
  };

  saveLikedTrack(like);
  broadcastLikes();

  // Fire-and-forget on purpose: the like is already saved, and Listener
  // being down, slow or misconfigured must never make this request fail.
  if (hubConfig.listenerPushLikes) {
    void pushLikeToListener(
      { url: hubConfig.listenerUrl, integrationKey: hubConfig.listenerIntegrationKey },
      { title: like.title, artist: like.artist, spotifyId: like.spotifyId },
    );
  }

  res.json({ success: true, like });
});

router.delete('/api/likes/:key', requireAudioPermission('audio:control'), (req, res) => {
  const removed = deleteLikedTrack(decodeURIComponent(req.params.key));
  if (removed) broadcastLikes();
  res.json({ success: true, removed });
});

export default router;
