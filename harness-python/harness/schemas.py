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


class ResolveResult(BaseModel):
    """The result of the built-in resolve stage, which fixes a merge conflict."""

    summary: str


class Interview(BaseModel):
    """The result of an interview stage: a plan built from the person's answers."""

    title: str = Field(min_length=1, max_length=72)  # used for the branch name and the commit message
    goal: str
    decisions: List[str] = Field(min_length=1)  # each as "question: answer"
    files_to_change: List[str] = Field(min_length=1)
    tests_to_add: List[str] = Field(min_length=1)
    risks: List[str] = []
