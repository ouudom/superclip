"""Agent workspace routes."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth_headers import resolve_authenticated_user_id
from ...config import get_config
from ...database import get_db
from ...services.agent_service import AgentService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agents", tags=["agents"])


async def _get_user_id(request: Request, db: AsyncSession) -> str:
    return await resolve_authenticated_user_id(request, db, get_config())


@router.get("/templates")
async def list_agent_templates(request: Request, db: AsyncSession = Depends(get_db)):
    await _get_user_id(request, db)
    return {"templates": AgentService.list_templates()}


@router.get("/runs")
async def list_agent_runs(
    request: Request,
    task_id: str | None = None,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
):
    user_id = await _get_user_id(request, db)
    service = AgentService(db)
    runs = await service.list_runs(user_id, task_id=task_id, limit=limit)
    return {"runs": runs, "total": len(runs)}


@router.post("/runs")
async def create_agent_run(request: Request, db: AsyncSession = Depends(get_db)):
    user_id = await _get_user_id(request, db)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be an object")
    service = AgentService(db)
    try:
        run = await service.create_run(
            user_id=user_id,
            template_key=str(payload.get("template_key") or ""),
            task_id=payload.get("task_id") if isinstance(payload.get("task_id"), str) else None,
            goal=payload.get("goal") if isinstance(payload.get("goal"), str) else None,
            output_text=(
                payload.get("output_text")
                if isinstance(payload.get("output_text"), str)
                else None
            ),
        )
        return {"run": run}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("Error creating agent run: %s", exc)
        raise HTTPException(status_code=500, detail=f"Error creating agent run: {exc}")


@router.get("/runs/{run_id}")
async def get_agent_run(
    run_id: str, request: Request, db: AsyncSession = Depends(get_db)
):
    user_id = await _get_user_id(request, db)
    run = await AgentService(db).get_run(user_id, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return {"run": run}


@router.patch("/runs/{run_id}")
async def update_agent_run(
    run_id: str, request: Request, db: AsyncSession = Depends(get_db)
):
    user_id = await _get_user_id(request, db)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be an object")
    service = AgentService(db)
    run = await service.update_run(
        user_id=user_id,
        run_id=run_id,
        status=payload.get("status") if isinstance(payload.get("status"), str) else None,
        output_text=(
            payload.get("output_text")
            if isinstance(payload.get("output_text"), str)
            else None
        ),
        error_message=(
            payload.get("error_message")
            if isinstance(payload.get("error_message"), str)
            else None
        ),
    )
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return {"run": run}


@router.get("/tasks/{task_id}/context")
async def get_task_agent_context(
    task_id: str,
    request: Request,
    format: str = "json",
    db: AsyncSession = Depends(get_db),
):
    user_id = await _get_user_id(request, db)
    service = AgentService(db)
    try:
        context = await service.build_task_context(user_id, task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if format == "markdown":
        return PlainTextResponse(service.build_context_markdown(context))
    return {"context": context}


@router.post("/tasks/{task_id}/prompt")
async def build_task_agent_prompt(
    task_id: str, request: Request, db: AsyncSession = Depends(get_db)
):
    user_id = await _get_user_id(request, db)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be an object")
    service = AgentService(db)
    try:
        context = await service.build_task_context(user_id, task_id)
        prompt = service.build_prompt(
            template_key=str(payload.get("template_key") or ""),
            context=context,
            goal=payload.get("goal") if isinstance(payload.get("goal"), str) else None,
        )
        return {"prompt": prompt, "context": context}
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc))
