import os
import tempfile
import logging
import asyncio
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, UploadFile, HTTPException
from starlette.concurrency import run_in_threadpool
from groq import Groq
import whisperx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("reel_engine")
# Load API Key from environment variables
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

model_dict = {}
align_lock = asyncio.Semaphore(1)

MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200MB limit
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".flac", ".ogg"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Loads lightweight Wav2Vec2 Bengali phoneme alignment model from Hugging Face at startup."""
    device = "cpu"
    try:
        logger.info("Loading local CPU Wav2Vec2 Bengali forced alignment model...")
        align_model, align_metadata = whisperx.load_align_model(
            language_code="bn",
            device=device,
            model_name="arijitx/wav2vec2-large-xlsr-bengali"
        )
        model_dict["align_model"] = align_model
        model_dict["align_metadata"] = align_metadata
        logger.info("Bengali alignment model loaded successfully.")
    except Exception as e:
        logger.exception("Failed to load local alignment model.")
        raise e

    yield
    model_dict.clear()


app = FastAPI(title="Reel Engine Hybrid API", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok" if "align_model" in model_dict else "loading"}


def _align_groq_output(audio_path: str, groq_segments: list):
    """Executes CPU forced alignment to map Groq's high-precision transcript to exact audio timestamps."""
    audio = whisperx.load_audio(audio_path)
    aligned_result = whisperx.align(
        groq_segments,
        model_dict["align_model"],
        model_dict["align_metadata"],
        audio,
        device="cpu",
        return_char_alignments=False
    )
    return aligned_result


@app.post("/transcribe")
async def transcribe_media(file: UploadFile = File(...)):
    if "align_model" not in model_dict:
        raise HTTPException(status_code=503, detail="Alignment model is still loading...")

    groq_client = Groq(api_key=GROQ_API_KEY)

    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {suffix}")

    temp_path = None
    try:
        # 1. Save uploaded file safely to temporary disk storage
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            size = 0
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File size exceeds limit (200MB).")
                temp_file.write(chunk)
            temp_path = temp_file.name

        # 2. Call Groq API for ultra-fast Bengali transcription
        with open(temp_path, "rb") as audio_file:
            groq_response = groq_client.audio.transcriptions.create(
                file=(file.filename or f"audio{suffix}", audio_file.read()),
                model="whisper-large-v3",
                language="bn",
                response_format="verbose_json",
                temperature=0.0
            )

        # 3. Format Groq response segments for WhisperX aligner
        groq_segments = []
        raw_segments = getattr(groq_response, "segments", []) or []
        for seg in raw_segments:
            if isinstance(seg, dict):
                groq_segments.append({"text": seg["text"], "start": seg["start"], "end": seg["end"]})
            else:
                groq_segments.append({"text": seg.text, "start": seg.start, "end": seg.end})

        # 4. Perform local CPU forced alignment thread-safely
        async with align_lock:
            aligned_data = await run_in_threadpool(
                _align_groq_output, temp_path, groq_segments
            )

        return {
            "filename": file.filename,
            "detected_language": getattr(groq_response, "language", "bn"),
            "full_text": getattr(groq_response, "text", ""),
            "segments": aligned_data.get("segments"),
            "word_segments": aligned_data.get("word_segments"),
        }

    except HTTPException:
        raise
    except Exception as e:
        err_msg = f"{type(e).__name__}: {str(e)}"
        logger.error("Transcription pipeline failed:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Transcription error: {err_msg}")
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)