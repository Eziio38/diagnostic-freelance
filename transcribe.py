#!/usr/bin/env python3
"""Google Meet audio/video to text transcription CLI."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

SUPPORTED_FORMATS = {".mp4", ".webm", ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".mpeg", ".mpga"}


def check_ffmpeg() -> bool:
    if shutil.which("ffmpeg"):
        return True
    print(
        "Warning: ffmpeg not found in PATH. Video files (.mp4, .webm) and some audio "
        "formats may fail.\nInstall: https://ffmpeg.org/download.html",
        file=sys.stderr,
    )
    return False


def load_whisper(model_size: str, device: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "Error: faster-whisper not installed.\nRun: pip install faster-whisper",
            file=sys.stderr,
        )
        sys.exit(1)

    compute_type = "float16" if device == "cuda" else "int8"
    print(f"Loading Whisper model '{model_size}' on {device}...", file=sys.stderr)
    return WhisperModel(model_size, device=device, compute_type=compute_type)


def transcribe_file(
    input_path: str,
    model_size: str = "small",
    language: str | None = None,
    device: str = "cpu",
) -> list[dict]:
    """Return list of {start, end, text} dicts for the given media file."""
    model = load_whisper(model_size, device)
    print(f"Transcribing: {input_path}", file=sys.stderr)
    segments, info = model.transcribe(
        input_path,
        language=language,
        beam_size=5,
        vad_filter=True,
    )
    print(
        f"Language: {info.language} (confidence {info.language_probability:.0%})",
        file=sys.stderr,
    )
    return [
        {"start": seg.start, "end": seg.end, "text": seg.text.strip()}
        for seg in segments
    ]


def add_speakers(input_path: str, hf_token: str, segments: list[dict]) -> list[dict]:
    """Assign speaker labels to segments using pyannote diarization."""
    try:
        from pyannote.audio import Pipeline
    except ImportError:
        print(
            "Error: pyannote.audio not installed.\nRun: pip install pyannote.audio torch",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Loading speaker diarization model...", file=sys.stderr)
    try:
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=hf_token,
        )
    except Exception as exc:
        msg = str(exc)
        if "401" in msg or "403" in msg or "gated" in msg.lower():
            print(
                "Error: HuggingFace token rejected or model access not granted.\n"
                "Accept terms at: https://hf.co/pyannote/speaker-diarization-3.1",
                file=sys.stderr,
            )
        else:
            print(f"Error loading diarization model: {exc}", file=sys.stderr)
        sys.exit(1)

    print("Running diarization...", file=sys.stderr)
    diarization = pipeline(input_path)

    for seg in segments:
        speaker_overlap: dict[str, float] = {}
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            overlap = min(turn.end, seg["end"]) - max(turn.start, seg["start"])
            if overlap > 0:
                speaker_overlap[speaker] = speaker_overlap.get(speaker, 0.0) + overlap
        seg["speaker"] = max(speaker_overlap, key=speaker_overlap.get) if speaker_overlap else "UNKNOWN"

    return segments


def _fmt_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def to_txt(segments: list[dict], plain: bool = False) -> str:
    lines = []
    for seg in segments:
        if plain:
            speaker = f"[{seg['speaker']}] " if "speaker" in seg else ""
            lines.append(f"{speaker}{seg['text']}")
        else:
            ts = f"[{_fmt_time(seg['start'])} --> {_fmt_time(seg['end'])}]"
            speaker = f" [{seg['speaker']}]" if "speaker" in seg else ""
            lines.append(f"{ts}{speaker} {seg['text']}")
    return "\n".join(lines)


def to_json(segments: list[dict]) -> str:
    return json.dumps({"segments": segments}, ensure_ascii=False, indent=2)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="transcribe.py",
        description="Convert Google Meet recordings to full text transcription.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python transcribe.py meeting.mp4
  python transcribe.py meeting.webm --model medium --language fr
  python transcribe.py meeting.mp4 --diarize --hf-token YOUR_TOKEN
  python transcribe.py meeting.mp4 --format json --output transcript.json
  python transcribe.py meeting.mp4 --device cuda --model large-v3
        """,
    )
    parser.add_argument("input", help="Input file (.mp4 .webm .mp3 .wav .m4a …)")
    parser.add_argument(
        "--model",
        default="small",
        choices=["tiny", "base", "small", "medium", "large-v2", "large-v3"],
        help="Whisper model size (default: small). Larger = more accurate but slower.",
    )
    parser.add_argument(
        "--language",
        default=None,
        metavar="CODE",
        help="Language code, e.g. fr, en, es. Auto-detected when omitted.",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        choices=["cpu", "cuda"],
        help="Inference device (default: cpu).",
    )
    parser.add_argument(
        "--diarize",
        action="store_true",
        help="Identify speakers (requires --hf-token or HF_TOKEN env var).",
    )
    parser.add_argument(
        "--hf-token",
        dest="hf_token",
        default=None,
        metavar="TOKEN",
        help="HuggingFace token for speaker diarization.",
    )
    parser.add_argument(
        "--format",
        default="txt",
        choices=["txt", "json"],
        help="Output format (default: txt).",
    )
    parser.add_argument(
        "--plain",
        action="store_true",
        help="Omit timestamps from TXT output (ignored for JSON).",
    )
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        metavar="FILE",
        help="Output file path. Defaults to <input>.<format>.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: file not found: {args.input}", file=sys.stderr)
        return 1

    suffix = input_path.suffix.lower()
    if suffix not in SUPPORTED_FORMATS:
        print(
            f"Warning: '{suffix}' is not a known supported format. Attempting anyway...",
            file=sys.stderr,
        )

    check_ffmpeg()

    hf_token = args.hf_token or os.environ.get("HF_TOKEN")
    if args.diarize and not hf_token:
        print(
            "Error: --diarize requires a HuggingFace token.\n"
            "Pass --hf-token TOKEN or set the HF_TOKEN environment variable.",
            file=sys.stderr,
        )
        return 1

    if args.output:
        output_path = Path(args.output)
    else:
        output_path = input_path.with_suffix(f".{args.format}")
        if output_path.resolve() == input_path.resolve():
            output_path = input_path.with_stem(input_path.stem + "_transcribed").with_suffix(
                f".{args.format}"
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    segments = transcribe_file(
        str(input_path),
        model_size=args.model,
        language=args.language,
        device=args.device,
    )

    if args.diarize:
        segments = add_speakers(str(input_path), hf_token, segments)

    text = to_json(segments) if args.format == "json" else to_txt(segments, plain=args.plain)

    output_path.write_text(text, encoding="utf-8")
    print(f"Saved: {output_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
