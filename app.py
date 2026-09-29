"""
CarbonIQ - Hugging Face Spaces entry point.

HF Spaces (Gradio SDK) executes this file as the main process.
We start uvicorn directly so FastAPI is served on port 7860 (the port HF exposes).
"""
import os
import sys
import subprocess

# Resolve paths
ROOT = os.path.dirname(os.path.abspath(__file__))
API_DIR = os.path.join(ROOT, "services", "api")

# Inject services/api onto sys.path so app.* imports resolve
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

# Environment defaults (overridden by HF Space secrets)
os.environ.setdefault("ENVIRONMENT", "production")
os.environ.setdefault("DEBUG", "false")
os.environ.setdefault("TRUSTED_HOSTS", "*")
os.environ.setdefault("CORS_ALLOWED_ORIGINS", "*")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "60")
os.environ.setdefault("REFRESH_TOKEN_EXPIRE_DAYS", "30")
os.environ.setdefault("MAX_REQUEST_BODY_BYTES", "1048576")

# Validate required secrets are present
missing = [v for v in ("DATABASE_URL", "JWT_SECRET_KEY") if not os.environ.get(v)]
if missing:
    print(f"[CarbonIQ] ERROR: Missing required env vars: {missing}", flush=True)
    print("[CarbonIQ] Set them as HF Space secrets.", flush=True)
    sys.exit(1)

# Start uvicorn
print("[CarbonIQ] Starting FastAPI via uvicorn on port 7860 ...", flush=True)

cmd = [
    sys.executable, "-m", "uvicorn",
    "app.main:app",
    "--host", "0.0.0.0",
    "--port", "7860",
    "--workers", "1",
    "--log-level", "info",
]

result = subprocess.run(cmd, cwd=API_DIR)
sys.exit(result.returncode)
