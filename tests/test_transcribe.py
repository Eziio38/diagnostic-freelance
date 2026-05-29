"""Unit tests for transcribe.py — all external I/O is mocked."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import transcribe


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_segment(start: float, end: float, text: str, speaker: str | None = None) -> dict:
    seg = {"start": start, "end": end, "text": text}
    if speaker is not None:
        seg["speaker"] = speaker
    return seg


# ---------------------------------------------------------------------------
# _fmt_time
# ---------------------------------------------------------------------------

class TestFmtTime:
    def test_zero(self):
        assert transcribe._fmt_time(0) == "00:00:00.000"

    def test_seconds_only(self):
        assert transcribe._fmt_time(5.5) == "00:00:05.500"

    def test_minutes_and_seconds(self):
        assert transcribe._fmt_time(90.25) == "00:01:30.250"

    def test_hours_minutes_seconds(self):
        assert transcribe._fmt_time(3661.0) == "01:01:01.000"


# ---------------------------------------------------------------------------
# to_txt
# ---------------------------------------------------------------------------

class TestToTxt:
    def test_no_speaker(self):
        segs = [_make_segment(0, 5, "Hello world")]
        output = transcribe.to_txt(segs)
        assert "[00:00:00.000 --> 00:00:05.000]" in output
        assert "Hello world" in output
        assert "[SPEAKER" not in output

    def test_with_speaker(self):
        segs = [_make_segment(0, 3, "Hi there", speaker="SPEAKER_00")]
        output = transcribe.to_txt(segs)
        assert "[SPEAKER_00]" in output

    def test_multiple_segments(self):
        segs = [
            _make_segment(0, 2, "First"),
            _make_segment(2, 5, "Second"),
        ]
        lines = transcribe.to_txt(segs).splitlines()
        assert len(lines) == 2
        assert "First" in lines[0]
        assert "Second" in lines[1]


# ---------------------------------------------------------------------------
# to_json
# ---------------------------------------------------------------------------

class TestToJson:
    def test_valid_json(self):
        segs = [_make_segment(0, 3, "Test")]
        result = json.loads(transcribe.to_json(segs))
        assert "segments" in result
        assert result["segments"][0]["text"] == "Test"

    def test_preserves_speaker(self):
        segs = [_make_segment(0, 3, "Hi", speaker="SPEAKER_01")]
        result = json.loads(transcribe.to_json(segs))
        assert result["segments"][0]["speaker"] == "SPEAKER_01"

    def test_unicode_preserved(self):
        segs = [_make_segment(0, 2, "Réunion équipe")]
        result = json.loads(transcribe.to_json(segs))
        assert result["segments"][0]["text"] == "Réunion équipe"


# ---------------------------------------------------------------------------
# check_ffmpeg
# ---------------------------------------------------------------------------

class TestCheckFfmpeg:
    def test_returns_true_when_present(self):
        with patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            assert transcribe.check_ffmpeg() is True

    def test_returns_false_when_absent(self, capsys):
        with patch("shutil.which", return_value=None):
            result = transcribe.check_ffmpeg()
        assert result is False
        err = capsys.readouterr().err
        assert "ffmpeg" in err.lower()


# ---------------------------------------------------------------------------
# transcribe_file (mocked WhisperModel)
# ---------------------------------------------------------------------------

class TestTranscribeFile:
    def _mock_segment(self, start, end, text):
        seg = MagicMock()
        seg.start = start
        seg.end = end
        seg.text = f"  {text}  "  # extra whitespace — should be stripped
        return seg

    def test_returns_segments(self, tmp_path):
        fake_audio = tmp_path / "meet.mp3"
        fake_audio.write_bytes(b"fake")

        mock_seg = self._mock_segment(0.0, 3.5, "Hello meeting")
        mock_info = MagicMock()
        mock_info.language = "en"
        mock_info.language_probability = 0.99

        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([mock_seg], mock_info)

        with patch("transcribe.load_whisper", return_value=mock_model):
            result = transcribe.transcribe_file(str(fake_audio))

        assert len(result) == 1
        assert result[0]["text"] == "Hello meeting"
        assert result[0]["start"] == 0.0
        assert result[0]["end"] == 3.5

    def test_strips_whitespace(self, tmp_path):
        fake_audio = tmp_path / "meet.wav"
        fake_audio.write_bytes(b"fake")

        mock_seg = self._mock_segment(1.0, 2.0, "  padded  ")
        mock_info = MagicMock()
        mock_info.language = "fr"
        mock_info.language_probability = 0.95

        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([mock_seg], mock_info)

        with patch("transcribe.load_whisper", return_value=mock_model):
            result = transcribe.transcribe_file(str(fake_audio))

        assert result[0]["text"] == "padded"


# ---------------------------------------------------------------------------
# add_speakers
# ---------------------------------------------------------------------------

class TestAddSpeakers:
    def test_assigns_dominant_speaker(self):
        segments = [_make_segment(0.0, 4.0, "Text")]

        mock_turn_a = MagicMock()
        mock_turn_a.start = 0.0
        mock_turn_a.end = 3.0  # 3s overlap

        mock_turn_b = MagicMock()
        mock_turn_b.start = 3.0
        mock_turn_b.end = 5.0  # 1s overlap

        mock_diarization = MagicMock()
        mock_diarization.itertracks.return_value = [
            (mock_turn_a, None, "SPEAKER_00"),
            (mock_turn_b, None, "SPEAKER_01"),
        ]

        mock_pipeline = MagicMock(return_value=mock_diarization)

        mock_pyannote = MagicMock()
        mock_pyannote.Pipeline.from_pretrained.return_value = mock_pipeline

        with patch.dict(sys.modules, {"pyannote.audio": mock_pyannote}):
            result = transcribe.add_speakers("fake.mp4", "token", segments)

        assert result[0]["speaker"] == "SPEAKER_00"

    def test_unknown_when_no_overlap(self):
        segments = [_make_segment(10.0, 12.0, "Silence gap")]

        mock_diarization = MagicMock()
        mock_diarization.itertracks.return_value = []

        mock_pipeline = MagicMock(return_value=mock_diarization)
        mock_pyannote = MagicMock()
        mock_pyannote.Pipeline.from_pretrained.return_value = mock_pipeline

        with patch.dict(sys.modules, {"pyannote.audio": mock_pyannote}):
            result = transcribe.add_speakers("fake.mp4", "token", segments)

        assert result[0]["speaker"] == "UNKNOWN"


# ---------------------------------------------------------------------------
# to_txt — plain mode
# ---------------------------------------------------------------------------

class TestToTxtPlain:
    def test_plain_omits_timestamps(self):
        segs = [_make_segment(0, 5, "Hello")]
        output = transcribe.to_txt(segs, plain=True)
        assert "-->" not in output
        assert "Hello" in output

    def test_plain_with_speaker(self):
        segs = [_make_segment(0, 3, "Hi", speaker="SPEAKER_00")]
        output = transcribe.to_txt(segs, plain=True)
        assert "[SPEAKER_00]" in output
        assert "-->" not in output


# ---------------------------------------------------------------------------
# _fmt_time — negative values
# ---------------------------------------------------------------------------

class TestFmtTimeNegative:
    def test_negative_clamped_to_zero(self):
        assert transcribe._fmt_time(-1.0) == "00:00:00.000"

    def test_small_negative_clamped(self):
        assert transcribe._fmt_time(-0.001) == "00:00:00.000"


# ---------------------------------------------------------------------------
# CLI — main()
# ---------------------------------------------------------------------------

class TestMain:
    def test_missing_file_returns_1(self):
        rc = transcribe.main(["nonexistent_file.mp4"])
        assert rc == 1

    def test_diarize_without_token_returns_1(self, tmp_path):
        f = tmp_path / "meet.mp4"
        f.write_bytes(b"fake")
        with patch.dict("os.environ", {}, clear=True):
            # Remove HF_TOKEN if present
            import os
            os.environ.pop("HF_TOKEN", None)
            rc = transcribe.main([str(f), "--diarize"])
        assert rc == 1

    def test_txt_output(self, tmp_path):
        f = tmp_path / "meet.mp3"
        f.write_bytes(b"fake")
        out = tmp_path / "out.txt"

        mock_seg = MagicMock()
        mock_seg.start = 0.0
        mock_seg.end = 2.0
        mock_seg.text = "Bonjour"

        mock_info = MagicMock()
        mock_info.language = "fr"
        mock_info.language_probability = 0.97

        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([mock_seg], mock_info)

        with patch("transcribe.load_whisper", return_value=mock_model), \
             patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            rc = transcribe.main([str(f), "--output", str(out)])

        assert rc == 0
        assert out.exists()
        content = out.read_text(encoding="utf-8")
        assert "Bonjour" in content
        assert "-->" in content

    def test_json_output(self, tmp_path):
        f = tmp_path / "meet.mp3"
        f.write_bytes(b"fake")
        out = tmp_path / "out.json"

        mock_seg = MagicMock()
        mock_seg.start = 1.0
        mock_seg.end = 3.0
        mock_seg.text = "Hello"

        mock_info = MagicMock()
        mock_info.language = "en"
        mock_info.language_probability = 0.99

        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([mock_seg], mock_info)

        with patch("transcribe.load_whisper", return_value=mock_model), \
             patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            rc = transcribe.main([str(f), "--format", "json", "--output", str(out)])

        assert rc == 0
        data = json.loads(out.read_text(encoding="utf-8"))
        assert data["segments"][0]["text"] == "Hello"

    def test_output_collision_renames(self, tmp_path):
        """Input file.txt with --format txt must not overwrite itself."""
        f = tmp_path / "meeting.txt"
        f.write_text("original", encoding="utf-8")

        mock_seg = MagicMock()
        mock_seg.start = 0.0
        mock_seg.end = 1.0
        mock_seg.text = "Transcribed"
        mock_info = MagicMock()
        mock_info.language = "en"
        mock_info.language_probability = 0.9
        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([mock_seg], mock_info)

        with patch("transcribe.load_whisper", return_value=mock_model), \
             patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            rc = transcribe.main([str(f), "--format", "txt"])

        assert rc == 0
        assert f.read_text(encoding="utf-8") == "original"  # input not overwritten
        renamed = tmp_path / "meeting_transcribed.txt"
        assert renamed.exists()

    def test_output_parent_dir_created(self, tmp_path):
        f = tmp_path / "meet.mp3"
        f.write_bytes(b"fake")
        out = tmp_path / "subdir" / "nested" / "out.txt"

        mock_seg = MagicMock()
        mock_seg.start = 0.0
        mock_seg.end = 1.0
        mock_seg.text = "Hello"
        mock_info = MagicMock()
        mock_info.language = "en"
        mock_info.language_probability = 0.9
        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([mock_seg], mock_info)

        with patch("transcribe.load_whisper", return_value=mock_model), \
             patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            rc = transcribe.main([str(f), "--output", str(out)])

        assert rc == 0
        assert out.exists()

    def test_default_output_path(self, tmp_path):
        f = tmp_path / "recording.mp4"
        f.write_bytes(b"fake")

        mock_seg = MagicMock()
        mock_seg.start = 0.0
        mock_seg.end = 1.0
        mock_seg.text = "Test"

        mock_info = MagicMock()
        mock_info.language = "en"
        mock_info.language_probability = 0.9

        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([mock_seg], mock_info)

        with patch("transcribe.load_whisper", return_value=mock_model), \
             patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            rc = transcribe.main([str(f)])

        assert rc == 0
        expected = f.with_suffix(".txt")
        assert expected.exists()
