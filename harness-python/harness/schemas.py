"""Typed results that each stage hands to the next."""
from typing import List, Literal

from pydantic import BaseModel, Field


class Plan(BaseModel):
    files_to_change: List[str] = Field(min_length=1)
    tests_to_add: List[str] = Field(min_length=1)
    risks: List[str] = []


class ImplementResult(BaseModel):
    branch: str
    tests_passed: bool
    summary: str


class ReviewResult(BaseModel):
    verdict: Literal["approve", "request_changes"]
    findings: List[str] = []
