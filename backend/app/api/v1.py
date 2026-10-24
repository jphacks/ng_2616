"""/api/v1 routes. Stage 1: health and capabilities are live; job routes answer 501 until wired.

Route table mirrors frontend/src/server/gateway (spec §7.1). When AI_EXECUTION=relay the gateway
forwards here with X-API-Key and X-User-Id.
"""

from fastapi import APIRouter, Depends

from ..envelope import fail, ok
from ..security import require_internal
from ..settings import Settings, get_settings

FEATURES = ["hints", "assist_modes", "bridge", "plot", "lean", "autosave", "auto_submit", "resources"]

router = APIRouter(prefix="/api/v1")


@router.get("/health")
def health(settings: Settings = Depends(get_settings)):
    return ok(
        {
            "status": "ok",
            "build_id": settings.build_id,
            "llm_configured": settings.llm_provider != "mock" and bool(settings.gemini_api_key),
            "lean_ready": False,
        }
    )


@router.get("/capabilities")
def capabilities(_owner: str = Depends(require_internal), settings: Settings = Depends(get_settings)):
    return ok(
        {
            "schema_version": "2.0.0",
            "build_id": settings.build_id,
            "features": {f: f in settings.features for f in FEATURES},
            "cas_runtime": "pyodide",
            "ai_execution": "relay",
            "llm": {"provider": settings.llm_provider, "configured": bool(settings.gemini_api_key), "mock": settings.llm_provider == "mock"},
            "lean": {"available": False},
        }
    )


def _not_yet(name: str):
    return fail("FEATURE_DISABLED", f"{name} is not implemented in the backend yet (Stage 2)", 501)


@router.post("/recognize")
def recognize(_owner: str = Depends(require_internal)):
    return _not_yet("recognize")


@router.post("/suggest")
def suggest(_owner: str = Depends(require_internal)):
    return _not_yet("suggest")


@router.post("/pdf/imports")
def pdf_imports(_owner: str = Depends(require_internal)):
    return _not_yet("pdf import")


@router.post("/resources/page")
def resources_page(_owner: str = Depends(require_internal)):
    return _not_yet("resource OCR")


@router.get("/jobs/{job_id}")
def get_job(job_id: str, _owner: str = Depends(require_internal)):
    return fail("NOT_FOUND", "job not found", 404)


@router.delete("/jobs/{job_id}")
def cancel_job(job_id: str, _owner: str = Depends(require_internal)):
    return fail("NOT_FOUND", "job not found", 404)
