"""Locate this self-contained bundle's models; no outside fallbacks."""
from pathlib import Path

def default_model_dir():
    return Path(__file__).resolve().parents[1] / "models"
