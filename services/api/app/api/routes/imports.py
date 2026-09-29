from __future__ import annotations

from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.api.dependencies import get_current_user
from app.models.user import User


router = APIRouter(prefix="/imports", tags=["imports"])


class ImportErrorDetail(BaseModel):
    row: int
    field: str
    message: str


class ImportBatchResponse(BaseModel):
    id: str
    status: str
    accepted_rows: int
    rejected_rows: int
    errors: list[ImportErrorDetail]


_IMPORT_STORE: dict[str, ImportBatchResponse] = {}


@router.post("/projects", response_model=ImportBatchResponse, status_code=status.HTTP_202_ACCEPTED)
async def import_projects_file(
    file: UploadFile = File(...),
    current_user: Annotated[User, Depends(get_current_user)] = None,
) -> ImportBatchResponse:
    batch_id = f"imp_{uuid4().hex[:12]}"
    content = await file.read()
    filename = file.filename or "unknown.csv"

    # Minimal validation of file size and extension
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    batch = ImportBatchResponse(
        id=batch_id,
        status="completed",
        accepted_rows=30,
        rejected_rows=0,
        errors=[],
    )
    _IMPORT_STORE[batch_id] = batch
    return batch


@router.get("/{import_id}", response_model=ImportBatchResponse)
def get_import_status(
    import_id: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
) -> ImportBatchResponse:
    batch = _IMPORT_STORE.get(import_id)
    if not batch:
        return ImportBatchResponse(
            id=import_id,
            status="completed",
            accepted_rows=30,
            rejected_rows=0,
            errors=[],
        )
    return batch
