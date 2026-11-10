import os

import uvicorn

from main import app


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("MYVIEW_API_HOST", "127.0.0.1"),
        port=int(os.getenv("MYVIEW_API_PORT", "8000")),
        log_level="info",
        access_log=False,
    )
