"""AutoSubSync Engine Module.

Provides synchronization between video files (.mp4, .mkv, .avi, etc.) and
subtitles (.srt, .ass, etc.) using automated audio/speech detection engines
based on denizsafak/AutoSubSync (ffsubsync and autosubsync).
"""

import asyncio
from dataclasses import dataclass
import difflib
import logging
import os
import re
import shutil
import sys
import tempfile
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger("qbit_bot.autosubsync_engine")

VIDEO_EXTENSIONS = {
    ".mp4",
    ".mkv",
    ".avi",
    ".mov",
    ".flv",
    ".ts",
    ".webm",
    ".m4v",
    ".wmv",
    ".mpg",
    ".mpeg",
}

SUBTITLE_EXTENSIONS = {
    ".srt",
    ".ass",
    ".ssa",
    ".vtt",
}

LANG_CODES_REGEX = re.compile(
    r"[\._-](id|ind|en|eng|jp|jpn|es|spa|fr|fre|de|ger|it|ita|ru|rus|zh|chi|ko|kor|ar|ara|pt|por|nl|dut|pl|pol|tr|tur|vi|vie|th|tha)(?:[\._-]|$)",
    re.IGNORECASE,
)

QUALITY_TAGS_REGEX = re.compile(
    r"[\._-](?:1080p|720p|480p|2160p|4k|uhd|web-dl|webrip|web|bluray|bdrip|brrip|hdtv|dvdrip|x264|x265|hevc|h264|h265|aac|dts|remux|proper|repack)(?:[\._-]|$)",
    re.IGNORECASE,
)

EPISODE_REGEX = re.compile(r"(?:s\d{1,2}e\d{1,2}|\d{1,2}x\d{1,2}|ep?\d{1,3})", re.IGNORECASE)


@dataclass
class SyncResult:
    """Represents the outcome of a subtitle synchronization process."""

    success: bool
    output_path: Optional[str] = None
    video_path: str = ""
    subtitle_path: str = ""
    engine_used: str = ""
    offset_seconds: Optional[float] = None
    elapsed_seconds: float = 0.0
    error: Optional[str] = None
    file_size: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "output_path": self.output_path,
            "video_path": self.video_path,
            "subtitle_path": self.subtitle_path,
            "engine_used": self.engine_used,
            "offset_seconds": self.offset_seconds,
            "elapsed_seconds": self.elapsed_seconds,
            "error": self.error,
            "file_size": self.file_size,
        }


class AutoSubSyncEngine:
    """Core synchronization engine wrapping AutoSubSync CLI and Python tools."""

    def __init__(self):
        self._ffmpeg_ready = False

    def is_video(self, file_path: str) -> bool:
        """Checks whether a given path is an accepted video format."""
        ext = os.path.splitext(file_path)[1].lower()
        return ext in VIDEO_EXTENSIONS

    def is_subtitle(self, file_path: str) -> bool:
        """Checks whether a given path is an accepted subtitle format."""
        ext = os.path.splitext(file_path)[1].lower()
        return ext in SUBTITLE_EXTENSIONS

    def effective_basename(self, filename: str) -> str:
        """Strips extension, language codes, and quality tags for similarity matching."""
        base = os.path.splitext(os.path.basename(filename))[0]
        # Remove bracketed release group tags like [Erai-raws], [SubsPlease], (1080p)
        base = re.sub(r"\[.*?\]|\(.*?\)", " ", base)
        # Remove language tags
        base = LANG_CODES_REGEX.sub(" ", base)
        # Remove quality / rip tags
        base = QUALITY_TAGS_REGEX.sub(" ", base)
        # Normalize separators
        base = re.sub(r"[\._\s-]+", " ", base).strip().lower()
        return base

    def calculate_similarity(self, video_name: str, sub_name: str) -> float:
        """Calculates name similarity ratio (0.0 to 1.0) with episode matching boost."""
        b_vid = self.effective_basename(video_name)
        b_sub = self.effective_basename(sub_name)

        if not b_vid or not b_sub:
            return 0.0

        ratio = difflib.SequenceMatcher(None, b_vid, b_sub).ratio()

        # Check episode pattern matches (e.g. S01E05 or 1x05)
        ep_vid = [m.lower() for m in EPISODE_REGEX.findall(video_name)]
        ep_sub = [m.lower() for m in EPISODE_REGEX.findall(sub_name)]
        if ep_vid and ep_sub:
            if any(e in ep_sub for e in ep_vid):
                ratio = max(ratio, 0.95)
            else:
                # Different episode number -> lower confidence
                ratio = min(ratio, 0.35)

        return round(ratio, 3)

    def find_matching_pairs(
        self, files: List[str], min_similarity: float = 0.55
    ) -> List[Dict[str, Any]]:
        """Finds potential video-subtitle pairs from a list of files in a directory."""
        videos = [f for f in files if self.is_video(f)]
        subtitles = [f for f in files if self.is_subtitle(f)]
        pairs: List[Dict[str, Any]] = []

        used_subs = set()
        for vid in sorted(videos):
            best_sub = None
            best_score = 0.0
            for sub in subtitles:
                if sub in used_subs:
                    continue
                score = self.calculate_similarity(os.path.basename(vid), os.path.basename(sub))
                if score > best_score and score >= min_similarity:
                    best_score = score
                    best_sub = sub

            if best_sub:
                used_subs.add(best_sub)
                pairs.append({
                    "video": vid,
                    "subtitle": best_sub,
                    "video_name": os.path.basename(vid),
                    "subtitle_name": os.path.basename(best_sub),
                    "similarity": best_score,
                })

        return pairs

    def ensure_ffmpeg(self) -> Optional[str]:
        """Ensures FFmpeg is available in system PATH, using static_ffmpeg if needed."""
        ffmpeg_bin = shutil.which("ffmpeg")
        if ffmpeg_bin:
            self._ffmpeg_ready = True
            return ffmpeg_bin

        try:
            import static_ffmpeg

            static_ffmpeg.add_paths()
            ffmpeg_bin = shutil.which("ffmpeg")
            if ffmpeg_bin:
                self._ffmpeg_ready = True
                return ffmpeg_bin
        except Exception as exc:
            logger.warning(f"Could not load static_ffmpeg: {exc}")

        return None

    def determine_output_path(
        self, subtitle_path: str, custom_output: Optional[str] = None
    ) -> str:
        """Determines a safe destination output path for the synchronized subtitle."""
        if custom_output:
            return os.path.abspath(custom_output)

        dirname = os.path.dirname(os.path.abspath(subtitle_path))
        base, ext = os.path.splitext(os.path.basename(subtitle_path))

        # Check if directory is writable
        if os.access(dirname, os.W_OK):
            target = os.path.join(dirname, f"{base}.synced{ext}")
            return target

        # If original directory is read-only, use system temp directory
        temp_dir = tempfile.gettempdir()
        return os.path.join(temp_dir, f"{base}.synced{ext}")

    def _parse_offset_from_logs(self, text: str) -> Optional[float]:
        """Extracts detected offset seconds from tool logs."""
        match = re.search(r"offset[^\d+-]*([+-]?\d+\.?\d*)", text, re.IGNORECASE)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                pass
        return None

    async def _run_ffsubsync(
        self,
        video_path: str,
        subtitle_path: str,
        output_path: str,
        progress_cb: Optional[Callable[[str, float], None]] = None,
    ) -> Tuple[bool, Optional[float], str]:
        """Runs ffsubsync via isolated Python process."""
        self.ensure_ffmpeg()

        code = (
            "import sys; "
            "from ffsubsync.ffsubsync import main; "
            "sys.exit(main())"
        )
        cmd = [
            sys.executable,
            "-c",
            code,
            video_path,
            "-i",
            subtitle_path,
            "-o",
            output_path,
        ]

        if progress_cb:
            progress_cb("Menganalisis audio & mendeteksi percakapan...", 25.0)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout_bytes, stderr_bytes = await proc.communicate()
        out_text = stdout_bytes.decode(errors="replace")
        err_text = stderr_bytes.decode(errors="replace")
        combined_logs = f"{out_text}\n{err_text}".strip()

        offset = self._parse_offset_from_logs(combined_logs)
        ok = proc.returncode == 0 and os.path.isfile(output_path) and os.path.getsize(output_path) > 0
        return ok, offset, combined_logs

    async def _run_autosubsync(
        self,
        video_path: str,
        subtitle_path: str,
        output_path: str,
        progress_cb: Optional[Callable[[str, float], None]] = None,
    ) -> Tuple[bool, Optional[float], str]:
        """Runs autosubsync via isolated Python process."""
        self.ensure_ffmpeg()

        # autosubsync expects SRT format natively. If input is ASS, convert first.
        sub_ext = os.path.splitext(subtitle_path)[1].lower()
        needs_ass_reconstruct = sub_ext in (".ass", ".ssa")
        temp_srt_in = None
        temp_srt_out = None

        try:
            if needs_ass_reconstruct:
                import pysubs2

                subs_orig = pysubs2.load(subtitle_path)
                with tempfile.NamedTemporaryFile(suffix=".srt", delete=False) as f_in:
                    temp_srt_in = f_in.name
                with tempfile.NamedTemporaryFile(suffix=".srt", delete=False) as f_out:
                    temp_srt_out = f_out.name

                subs_orig.save(temp_srt_in)
                run_in = temp_srt_in
                run_out = temp_srt_out
            else:
                run_in = subtitle_path
                run_out = output_path

            if progress_cb:
                progress_cb("Mendeteksi pola suara menggunakan model autosubsync...", 35.0)

            code = (
                "import sys; "
                "from autosubsync.main import cli; "
                "sys.exit(cli(packaged_model=True))"
            )
            cmd = [
                sys.executable,
                "-c",
                code,
                video_path,
                run_in,
                run_out,
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout_bytes, stderr_bytes = await proc.communicate()
            out_text = stdout_bytes.decode(errors="replace")
            err_text = stderr_bytes.decode(errors="replace")
            combined_logs = f"{out_text}\n{err_text}".strip()

            offset = self._parse_offset_from_logs(combined_logs)
            ok = proc.returncode == 0 and os.path.isfile(run_out) and os.path.getsize(run_out) > 0

            # If original was ASS, apply the shift offset to the original ASS file
            if ok and needs_ass_reconstruct:
                import pysubs2

                synced_srt = pysubs2.load(run_out)
                orig_srt = pysubs2.load(run_in)
                if len(synced_srt) > 0 and len(orig_srt) > 0:
                    delta_ms = int(synced_srt[0].start - orig_srt[0].start)
                    subs_orig.shift(ms=delta_ms)
                    if offset is None:
                        offset = delta_ms / 1000.0
                subs_orig.save(output_path)

            return ok, offset, combined_logs

        finally:
            if temp_srt_in and os.path.exists(temp_srt_in):
                try:
                    os.remove(temp_srt_in)
                except OSError:
                    pass
            if temp_srt_out and os.path.exists(temp_srt_out):
                try:
                    os.remove(temp_srt_out)
                except OSError:
                    pass

    async def sync_subtitles(
        self,
        video_path: str,
        subtitle_path: str,
        output_path: Optional[str] = None,
        engine: str = "auto",
        progress_cb: Optional[Callable[[str, float], None]] = None,
    ) -> SyncResult:
        """Synchronizes a subtitle file with audio dialogue from a video file."""
        start_time = time.time()

        if not os.path.isfile(video_path):
            return SyncResult(
                success=False,
                video_path=video_path,
                subtitle_path=subtitle_path,
                error=f"File video tidak ditemukan: {video_path}",
            )

        if not os.path.isfile(subtitle_path):
            return SyncResult(
                success=False,
                video_path=video_path,
                subtitle_path=subtitle_path,
                error=f"File subtitle tidak ditemukan: {subtitle_path}",
            )

        dest_path = self.determine_output_path(subtitle_path, output_path)

        if progress_cb:
            progress_cb("Menyiapkan engine sinkronisasi & FFmpeg...", 10.0)

        self.ensure_ffmpeg()

        selected_engine = engine.lower() if engine else "auto"
        used_engine = "ffsubsync"
        success = False
        offset: Optional[float] = None
        logs = ""

        # 1. Try ffsubsync first (default / auto)
        if selected_engine in ("auto", "ffsubsync"):
            try:
                success, offset, logs = await self._run_ffsubsync(
                    video_path, subtitle_path, dest_path, progress_cb
                )
                used_engine = "ffsubsync"
            except Exception as exc:
                logger.warning(f"ffsubsync execution encountered error: {exc}")
                logs = str(exc)

        # 2. Fallback to autosubsync if ffsubsync failed or autosubsync requested
        if not success and selected_engine in ("auto", "autosubsync"):
            if progress_cb:
                progress_cb("Mencoba fallback dengan engine autosubsync...", 40.0)
            try:
                success, offset, logs = await self._run_autosubsync(
                    video_path, subtitle_path, dest_path, progress_cb
                )
                used_engine = "autosubsync"
            except Exception as exc:
                logger.warning(f"autosubsync execution encountered error: {exc}")
                logs = f"{logs}\nFallback error: {exc}".strip()

        elapsed = max(0.1, time.time() - start_time)

        if success and os.path.isfile(dest_path) and os.path.getsize(dest_path) > 0:
            if progress_cb:
                progress_cb("Sinkronisasi selesai! Menyimpan file...", 100.0)
            return SyncResult(
                success=True,
                output_path=dest_path,
                video_path=video_path,
                subtitle_path=subtitle_path,
                engine_used=used_engine,
                offset_seconds=offset,
                elapsed_seconds=round(elapsed, 2),
                file_size=os.path.getsize(dest_path),
            )

        err_msg = logs if logs else "Gagal menyinkronkan subtitle (proses menghasilkan returncode != 0)."
        return SyncResult(
            success=False,
            output_path=None,
            video_path=video_path,
            subtitle_path=subtitle_path,
            engine_used=used_engine,
            elapsed_seconds=round(elapsed, 2),
            error=err_msg,
        )


auto_sub_sync_engine = AutoSubSyncEngine()
