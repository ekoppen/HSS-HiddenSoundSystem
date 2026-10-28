import React, { useState } from 'react';
import { Heart } from 'lucide-react';
import { LikedTrack, Track } from '../types';
import { isLikeable, likeKey } from '../services/likedTracks';

interface LikeButtonProps {
  /** Whatever is showing right now — the external source's track when a
   *  turntable/CD is active, otherwise the player's own current track. */
  track: Track | null;
  likes: LikedTrack[];
  size?: number;
  /** Kiosk/cast screens sit further away and are touched, not clicked. */
  variant?: 'panel' | 'kiosk';
}

// Deliberately server-driven: POST /api/likes likes whatever the Hub says is
// playing, so this button never has to know whether that came from Spotify,
// the NAS, a radio stream or the turntable. The refreshed list arrives over
// the WebSocket (likes_updated), which is also what fills the heart on every
// other screen at the same moment.
export const LikeButton: React.FC<LikeButtonProps> = ({ track, likes, size = 16, variant = 'panel' }) => {
  const [busy, setBusy] = useState(false);
  const key = track && isLikeable(track) ? likeKey(track.artist, track.title) : null;
  const liked = !!key && likes.some((l) => l.likeKey === key);

  const toggle = async () => {
    if (!key || busy) return;
    setBusy(true);
    try {
      await fetch(liked ? `/api/likes/${encodeURIComponent(key)}` : '/api/likes', {
        method: liked ? 'DELETE' : 'POST',
      });
    } catch (e) {
      // The websocket is the source of truth for the filled/empty state, so a
      // failed call simply leaves the heart as it was — nothing to roll back.
    } finally {
      setBusy(false);
    }
  };

  const disabled = !key || busy;
  const box = variant === 'kiosk' ? 44 : 32;

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      title={!key ? 'Er speelt nu geen nummer' : liked ? 'Uit favorieten halen' : 'Bewaar bij favorieten'}
      aria-label={liked ? 'Uit favorieten halen' : 'Bewaar bij favorieten'}
      aria-pressed={liked}
      style={{
        width: box,
        height: box,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        border: '1px solid ' + (liked ? 'rgba(251,113,133,0.45)' : 'var(--border-default, rgba(255,255,255,0.15))'),
        background: liked ? 'rgba(251,113,133,0.15)' : 'transparent',
        color: liked ? '#fb7185' : 'currentColor',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !liked ? 0.4 : 1,
        transition: 'background 150ms ease, color 150ms ease',
      }}
    >
      <Heart size={size} fill={liked ? '#fb7185' : 'none'} />
    </button>
  );
};
