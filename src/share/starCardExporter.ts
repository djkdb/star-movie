import type { Star } from '../domain/models';
import { GALAXY_POSTER_EYEBROW } from '../scene/galaxyCaptureModel';
import { posterUrl } from '../services/tmdbClient';
import { getStarAppearance } from '../scene/starVisualModel';

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

function loadPoster(posterPath?: string): Promise<HTMLImageElement | null> {
  const url = posterUrl(posterPath, 'w780');
  if (url === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    // Without this the canvas taints and toBlob fails outright.
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const char of text) {
    const candidate = current + char;
    if (context.measureText(candidate).width > maxWidth && current.length > 0) {
      lines.push(current);
      current = char;
      if (lines.length === maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current.length > 0) lines.push(current);
  if (lines.length === maxLines && current.length > 0) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, -1)}…`;
  }
  return lines;
}

/** Deterministic per-card starfield so the same work renders the same card. */
function drawStarfield(context: CanvasRenderingContext2D, seedText: string): void {
  let seed = 0x811c9dc5;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 0x01000193);
  }
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x1_0000_0000;
  };
  for (let index = 0; index < 180; index += 1) {
    const x = random() * CARD_WIDTH;
    const y = random() * CARD_HEIGHT;
    context.globalAlpha = 0.25 + random() * 0.6;
    context.fillStyle = random() < 0.8 ? '#dfe8ff' : '#ffe9c2';
    context.beginPath();
    context.arc(x, y, 0.8 + random() * 1.6, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

/**
 * Renders one star's story as a shareable 1080x1350 card — poster, rating,
 * memory fields and review over a starfield — then hands it to the system
 * share sheet, falling back to a plain download.
 */
export async function exportStarCard(star: Star): Promise<boolean> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (context === null) return false;

  const backdrop = context.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  backdrop.addColorStop(0, '#0a1230');
  backdrop.addColorStop(0.55, '#03060f');
  backdrop.addColorStop(1, '#01030a');
  context.fillStyle = backdrop;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  drawStarfield(context, star.id);

  // The work's own star — same deterministic color and spikes as in the sky —
  // blazing in the card's upper-right corner.
  {
    const appearance = getStarAppearance(star.id, star.rating, star.genre, star.rewatchCount ?? 0);
    const cx = CARD_WIDTH - 170;
    const cy = 190;
    const glow = context.createRadialGradient(cx, cy, 0, cx, cy, 150);
    glow.addColorStop(0, appearance.color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    context.globalAlpha = 0.85;
    context.fillStyle = glow;
    context.beginPath();
    context.arc(cx, cy, 150, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    const spikes = Math.max(appearance.spikeCount, 4);
    context.save();
    context.translate(cx, cy);
    context.rotate(appearance.spikeRotation);
    context.strokeStyle = 'rgba(255,255,255,0.9)';
    context.lineCap = 'round';
    for (let index = 0; index < spikes; index += 1) {
      context.rotate((Math.PI * 2) / spikes);
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(0, -26);
      context.lineTo(0, -105);
      context.stroke();
    }
    context.restore();
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(cx, cy, 20, 0, Math.PI * 2);
    context.fill();
  }

  const poster = await loadPoster(star.posterPath);
  let textTop = 200;
  if (poster !== null) {
    const posterWidth = 460;
    const posterHeight = (posterWidth / poster.width) * poster.height;
    const posterX = (CARD_WIDTH - posterWidth) / 2;
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.7)';
    context.shadowBlur = 60;
    context.drawImage(poster, posterX, 150, posterWidth, posterHeight);
    context.restore();
    textTop = 150 + posterHeight + 90;
  }

  context.textAlign = 'center';
  context.fillStyle = '#7cd6ff';
  context.font = '600 30px Pretendard, sans-serif';
  const letterSpaced = [...GALAXY_POSTER_EYEBROW].join(' ');
  context.fillText(letterSpaced, CARD_WIDTH / 2, 96);

  context.fillStyle = '#f4f7ff';
  context.font = '800 64px "Nanum Myeongjo", Pretendard, serif';
  const titleLines = wrapText(context, star.title, CARD_WIDTH - 160, 2);
  titleLines.forEach((line, index) => {
    context.fillText(line, CARD_WIDTH / 2, textTop + index * 80);
  });
  let y = textTop + titleLines.length * 80 + 10;

  context.fillStyle = '#ffd76a';
  context.font = '52px Pretendard, sans-serif';
  context.fillText('★'.repeat(star.rating) + '☆'.repeat(5 - star.rating), CARD_WIDTH / 2, y);
  y += 64;

  context.fillStyle = 'rgba(226, 236, 255, 0.75)';
  context.font = '400 34px Pretendard, sans-serif';
  const memory = [
    star.watchedDate,
    star.genre,
    ...(star.emotion === undefined ? [] : [star.emotion]),
    ...(star.watchedWith === undefined ? [] : [`with ${star.watchedWith}`]),
  ].join(' · ');
  context.fillText(memory, CARD_WIDTH / 2, y);
  y += 84;

  if (star.review.length > 0) {
    context.fillStyle = 'rgba(240, 245, 255, 0.9)';
    context.font = '400 40px "Nanum Myeongjo", Pretendard, serif';
    const reviewLines = wrapText(context, `“${star.review}”`, CARD_WIDTH - 220, 4);
    reviewLines.forEach((line, index) => {
      context.fillText(line, CARD_WIDTH / 2, y + index * 58);
    });
  }

  context.fillStyle = 'rgba(159, 220, 255, 0.55)';
  context.font = '500 28px Pretendard, sans-serif';
  context.fillText('내가 본 이야기가 별이 되어 남는 곳', CARD_WIDTH / 2, CARD_HEIGHT - 72);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (blob === null) return false;
  const file = new File([blob], `asteron-${star.watchedDate}.png`, { type: 'image/png' });

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: star.title });
      return true;
    } catch {
      // The user may cancel the sheet; fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
